// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Script, console2} from "forge-std/Script.sol";
import {DeliveryVerifier} from "../src/DeliveryVerifier.sol";

contract DeliveryVerifierScript is Script {
    function setUp() public {}

    function run() public {
        vm.startBroadcast();

        DeliveryVerifier verifier = new DeliveryVerifier();

        vm.stopBroadcast();
        console2.log("DeliveryVerifier deployed at:", address(verifier));
    }
}
