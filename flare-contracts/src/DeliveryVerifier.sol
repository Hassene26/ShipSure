// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IWeb2Json} from "@flarenetwork/flare-periphery-contracts/coston2/IWeb2Json.sol";
import {IFdcVerification} from "@flarenetwork/flare-periphery-contracts/coston2/IFdcVerification.sol";
import {ContractRegistry} from "@flarenetwork/flare-periphery-contracts/coston2/ContractRegistry.sol";

/// @title ShipSure Delivery Verifier (FDC-Integrated)
/// @dev Verifies real-world FedEx delivery using Flare Data Connector Web2Json attestations.
///      Only releases escrow when a cryptographic Merkle proof confirms the FedEx API returned "DL" (Delivered).
contract DeliveryVerifier {

    // Emitted when a delivery is verified via FDC proof. Off-chain watcher listens to trigger XRPL escrow release.
    event DeliveryConfirmed(bytes32 indexed trackingHash, address indexed seller);

    /// @dev Matches the FDC abiSignature: tuple(string statusCode)
    struct DeliveryStatus {
        string statusCode;
    }

    struct Request {
        address seller;
        bool isRequested;
        bool isConfirmed;
    }

    mapping(bytes32 => Request) public deliveryRequests;

    /// @notice Expected URL prefix for delivery status endpoint
    /// @dev In production, set this to your public server URL.
    ///      The contract validates that the FDC proof came from this trusted source.
    string public deliveryApiPrefix;

    constructor(string memory _deliveryApiPrefix) {
        deliveryApiPrefix = _deliveryApiPrefix;
    }

    /// @notice Request proof from the external API (FedEx)
    /// @dev Records the tracking request. The actual FDC attestation is submitted separately via FdcHub.
    function requestDeliveryStatus(string memory trackingNumber, address seller) public {
        bytes32 trackingHash = keccak256(abi.encodePacked(trackingNumber));
        require(!deliveryRequests[trackingHash].isRequested, "Delivery already requested");

        deliveryRequests[trackingHash] = Request({
            seller: seller,
            isRequested: true,
            isConfirmed: false
        });
    }

    /// @notice Verify delivery using a Flare Data Connector Web2Json proof
    /// @dev The proof contains the FedEx API response attested by FDC providers.
    ///      The contract verifies the Merkle proof, decodes the response, and checks delivery status.
    /// @param trackingHash The keccak256 hash of the tracking number (must match a prior request)
    /// @param _proof The FDC Web2Json proof containing the Merkle proof and attested response data
    function verifyDelivery(
        bytes32 trackingHash,
        IWeb2Json.Proof calldata _proof
    ) external {
        Request storage req = deliveryRequests[trackingHash];
        require(req.isRequested, "Delivery not requested");
        require(!req.isConfirmed, "Delivery already confirmed");

        // Step 1: Verify the Merkle proof against the FDC on-chain Merkle root
        require(
            _isWeb2JsonProofValid(_proof),
            "Invalid FDC proof"
        );

        // Step 2: Validate the attested URL is from the FedEx API
        require(
            _startsWith(_proof.data.requestBody.url, deliveryApiPrefix),
            "Proof URL does not match trusted delivery API"
        );

        // Step 3: Decode the attested response
        // FDC encodes the response as a tuple matching the abiSignature struct
        DeliveryStatus memory delivery = abi.decode(
            _proof.data.responseBody.abiEncodedData,
            (DeliveryStatus)
        );
        string memory statusCode = delivery.statusCode;
        require(
            keccak256(bytes(statusCode)) == keccak256(bytes("DL")),
            "Package not delivered (status is not DL)"
        );

        // Step 4: Mark as confirmed and emit event
        req.isConfirmed = true;
        emit DeliveryConfirmed(trackingHash, req.seller);
    }

    /// @dev Verify the FDC Web2Json proof via the on-chain FdcVerification contract
    function _isWeb2JsonProofValid(
        IWeb2Json.Proof calldata _proof
    ) internal view returns (bool) {
        IFdcVerification fdcVerification = ContractRegistry.getFdcVerification();
        return fdcVerification.verifyWeb2Json(_proof);
    }

    /// @dev Check if a string starts with a given prefix
    function _startsWith(string memory str, string memory prefix) internal pure returns (bool) {
        bytes memory strBytes = bytes(str);
        bytes memory prefixBytes = bytes(prefix);
        if (strBytes.length < prefixBytes.length) return false;
        for (uint256 i = 0; i < prefixBytes.length; i++) {
            if (strBytes[i] != prefixBytes[i]) return false;
        }
        return true;
    }
}
