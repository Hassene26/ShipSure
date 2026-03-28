// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title ShipSure Delivery Verifier
/// @dev Mocks Flare State Connector / FDC integration for a FedEx Web2 API
contract DeliveryVerifier {

    // Emitted when a delivery is verified successfully. Our off-chain Node script listens to this!
    event DeliveryConfirmed(bytes32 indexed trackingHash, address indexed seller);

    struct Request {
        address seller;
        bool isRequested;
        bool isConfirmed;
    }

    mapping(bytes32 => Request) public deliveryRequests;

    /// @notice Request proof from the external API (FedEx)
    /// @dev In a full production Flare setup, this initiates the FDC / State Connector request.
    function requestDeliveryStatus(string memory trackingNumber, address seller) public {
        bytes32 trackingHash = keccak256(abi.encodePacked(trackingNumber));
        require(!deliveryRequests[trackingHash].isRequested, "Delivery already requested");
        
        deliveryRequests[trackingHash] = Request({
            seller: seller,
            isRequested: true,
            isConfirmed: false
        });
        
        // Attestation type: 0x01 (Web2 API)
        // URL: https://apis-sandbox.fedex.com/track/v1/trackingnumbers
        // Parse response for "status": "DELIVERED"
    }

    /// @notice Verify Delivery callback
    /// @dev For this testnet MVP, we allow manual trigger with mock data to simulate Flare proof verification.
    function verifyDelivery(
        bytes32 trackingHash,
        bool isDelivered,
        uint256 deliveryTime,
        bytes memory proof
    ) external {
        Request storage req = deliveryRequests[trackingHash];
        require(req.isRequested, "Delivery not requested");
        require(!req.isConfirmed, "Delivery already confirmed");
        require(isDelivered, "Package not delivered yet");

        // In production, we would verify the "proof" parameter against the Flare StateConnector address here:
        // IStateConnector stateConnector = IStateConnector(FLARE_STATE_CONNECTOR_ADDRESS);
        // require(stateConnector.verify(proof), "Invalid Flare Proof");

        req.isConfirmed = true;

        // Emit the event so our XRPL Watcher catches it and releases the ESCROW!
        emit DeliveryConfirmed(trackingHash, req.seller);
    }
}
