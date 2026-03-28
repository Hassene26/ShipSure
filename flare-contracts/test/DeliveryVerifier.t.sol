// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test, console2} from "forge-std/Test.sol";
import {DeliveryVerifier} from "../src/DeliveryVerifier.sol";

contract DeliveryVerifierTest is Test {
    DeliveryVerifier public verifier;
    
    event DeliveryConfirmed(bytes32 indexed trackingHash, address indexed seller);

    function setUp() public {
        verifier = new DeliveryVerifier();
    }

    function test_RequestAndVerifyDelivery() public {
        string memory trackingNum = "FEDEX123456";
        address seller = address(1);
        bytes32 trackingHash = keccak256(abi.encodePacked(trackingNum));

        // 1. Request
        verifier.requestDeliveryStatus(trackingNum, seller);

        (address reqSeller, bool isRequested, bool isConfirmed) = verifier.deliveryRequests(trackingHash);
        assertTrue(isRequested);
        assertFalse(isConfirmed);
        assertEq(reqSeller, seller);

        // 2. Verify
        vm.expectEmit(true, true, false, false);
        emit DeliveryConfirmed(trackingHash, seller);
        
        verifier.verifyDelivery(trackingHash, true, block.timestamp, "0x0");

        (, , isConfirmed) = verifier.deliveryRequests(trackingHash);
        assertTrue(isConfirmed);
    }
}
