// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test, console2} from "forge-std/Test.sol";
import {DeliveryVerifier} from "../src/DeliveryVerifier.sol";
import {IWeb2Json} from "@flarenetwork/flare-periphery-contracts/coston2/IWeb2Json.sol";

/// @dev Mock FdcVerification that always returns true for verifyWeb2Json
contract MockFdcVerification {
    function verifyWeb2Json(IWeb2Json.Proof calldata) external pure returns (bool) {
        return true;
    }
}

/// @dev Mock FdcVerification that always returns false
contract MockFdcVerificationFail {
    function verifyWeb2Json(IWeb2Json.Proof calldata) external pure returns (bool) {
        return false;
    }
}

/// @dev Mock FlareContractRegistry that returns our mock FdcVerification address
contract MockFlareContractRegistry {
    address public fdcVerificationAddress;

    constructor(address _fdcVerification) {
        fdcVerificationAddress = _fdcVerification;
    }

    function getContractAddressByHash(bytes32 _nameHash) external view returns (address) {
        if (_nameHash == keccak256(abi.encode("FdcVerification"))) {
            return fdcVerificationAddress;
        }
        return address(0);
    }
}

contract DeliveryVerifierTest is Test {
    DeliveryVerifier public verifier;
    MockFdcVerification public mockFdc;

    address constant FLARE_REGISTRY = 0xaD67FE66660Fb8dFE9d6b1b4240d8650e30F6019;

    event DeliveryConfirmed(bytes32 indexed trackingHash, address indexed seller);

    function setUp() public {
        // Deploy mock FDC verification
        mockFdc = new MockFdcVerification();

        // Deploy mock registry that points to our mock FDC
        MockFlareContractRegistry mockRegistry = new MockFlareContractRegistry(address(mockFdc));

        // Etch the mock registry code at the hardcoded Flare registry address
        vm.etch(FLARE_REGISTRY, address(mockRegistry).code);

        // Store the fdcVerificationAddress slot (slot 0) with our mock address
        vm.store(FLARE_REGISTRY, bytes32(uint256(0)), bytes32(uint256(uint160(address(mockFdc)))));

        verifier = new DeliveryVerifier("https://myserver.com/api/public/delivery-status/");
    }

    function _buildValidProof(string memory statusCode) internal pure returns (IWeb2Json.Proof memory) {
        IWeb2Json.RequestBody memory reqBody = IWeb2Json.RequestBody({
            url: "https://myserver.com/api/public/delivery-status/0x1234",
            httpMethod: "POST",
            headers: "{}",
            queryParams: "{}",
            body: "{}",
            postProcessJq: ".output.completeTrackResults[0].trackResults[0].latestStatusDetail.code",
            abiSignature: "(string statusCode)"
        });

        IWeb2Json.ResponseBody memory resBody = IWeb2Json.ResponseBody({
            abiEncodedData: abi.encode(DeliveryVerifier.DeliveryStatus(statusCode))
        });

        IWeb2Json.Response memory response = IWeb2Json.Response({
            attestationType: bytes32(0),
            sourceId: bytes32(0),
            votingRound: 0,
            lowestUsedTimestamp: 0,
            requestBody: reqBody,
            responseBody: resBody
        });

        bytes32[] memory merkleProof = new bytes32[](0);

        return IWeb2Json.Proof({
            merkleProof: merkleProof,
            data: response
        });
    }

    function test_RequestAndVerifyDelivery() public {
        string memory trackingNum = "122816215025810";
        address seller = address(1);
        bytes32 trackingHash = keccak256(abi.encodePacked(trackingNum));

        // 1. Request
        verifier.requestDeliveryStatus(trackingNum, seller);

        (address reqSeller, bool isRequested, bool isConfirmed) = verifier.deliveryRequests(trackingHash);
        assertTrue(isRequested);
        assertFalse(isConfirmed);
        assertEq(reqSeller, seller);

        // 2. Verify with valid FDC proof (status = "DL")
        IWeb2Json.Proof memory proof = _buildValidProof("DL");

        vm.expectEmit(true, true, false, false);
        emit DeliveryConfirmed(trackingHash, seller);

        verifier.verifyDelivery(trackingHash, proof);

        (, , isConfirmed) = verifier.deliveryRequests(trackingHash);
        assertTrue(isConfirmed);
    }

    function test_RevertWhenNotDelivered() public {
        string memory trackingNum = "123456789012";
        address seller = address(2);
        bytes32 trackingHash = keccak256(abi.encodePacked(trackingNum));

        verifier.requestDeliveryStatus(trackingNum, seller);

        // Status is "IT" (In Transit), not "DL"
        IWeb2Json.Proof memory proof = _buildValidProof("IT");

        vm.expectRevert("Package not delivered (status is not DL)");
        verifier.verifyDelivery(trackingHash, proof);
    }

    function test_RevertWhenWrongUrl() public {
        string memory trackingNum = "FAKE123";
        address seller = address(3);
        bytes32 trackingHash = keccak256(abi.encodePacked(trackingNum));

        verifier.requestDeliveryStatus(trackingNum, seller);

        IWeb2Json.Proof memory proof = _buildValidProof("DL");
        // Tamper with the URL
        proof.data.requestBody.url = "https://evil.com/fake-fedex";

        vm.expectRevert("Proof URL does not match trusted delivery API");
        verifier.verifyDelivery(trackingHash, proof);
    }

    function test_RevertWhenInvalidProof() public {
        string memory trackingNum = "INVALID123";
        address seller = address(4);
        bytes32 trackingHash = keccak256(abi.encodePacked(trackingNum));

        verifier.requestDeliveryStatus(trackingNum, seller);

        // Deploy a failing mock and etch it
        MockFdcVerificationFail failMock = new MockFdcVerificationFail();
        vm.store(FLARE_REGISTRY, bytes32(uint256(0)), bytes32(uint256(uint160(address(failMock)))));

        IWeb2Json.Proof memory proof = _buildValidProof("DL");

        vm.expectRevert("Invalid FDC proof");
        verifier.verifyDelivery(trackingHash, proof);
    }

    function test_RevertWhenNotRequested() public {
        bytes32 trackingHash = keccak256(abi.encodePacked("NONEXISTENT"));
        IWeb2Json.Proof memory proof = _buildValidProof("DL");

        vm.expectRevert("Delivery not requested");
        verifier.verifyDelivery(trackingHash, proof);
    }

    function test_RevertWhenAlreadyConfirmed() public {
        string memory trackingNum = "DOUBLE123";
        address seller = address(5);
        bytes32 trackingHash = keccak256(abi.encodePacked(trackingNum));

        verifier.requestDeliveryStatus(trackingNum, seller);
        IWeb2Json.Proof memory proof = _buildValidProof("DL");
        verifier.verifyDelivery(trackingHash, proof);

        // Try again
        vm.expectRevert("Delivery already confirmed");
        verifier.verifyDelivery(trackingHash, proof);
    }
}
