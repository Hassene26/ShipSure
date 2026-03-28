import { ethers } from 'ethers';
import * as dotenv from 'dotenv';
dotenv.config();

const FLARE_RPC = process.env.FLARE_RPC || "https://coston2-api.flare.network/ext/bc/C/rpc";
const CONTRACT_ADDRESS = process.env.FLARE_CONTRACT_ADDRESS;
const PK = process.env.FLARE_PRIVATE_KEY;

if (!CONTRACT_ADDRESS || !PK) {
    console.error("Please set FLARE_CONTRACT_ADDRESS and FLARE_PRIVATE_KEY in your .env");
    process.exit(1);
}

const abi = [
    "function requestDeliveryStatus(string trackingNumber, address seller) public",
    "function verifyDelivery(bytes32 trackingHash, bool isDelivered, uint256 deliveryTime, bytes proof) external"
];

async function runMock() {
    console.log("Starting FedEx Mock Process...");
    const provider = new ethers.JsonRpcProvider(FLARE_RPC);
    const wallet = new ethers.Wallet(PK, provider);
    const contract = new ethers.Contract(CONTRACT_ADDRESS, abi, wallet);

    const trackingNumber = "FEDEX123456";
    const trackingHash = ethers.keccak256(ethers.toUtf8Bytes(trackingNumber));

    try {
        // We catch errors in case it's already requested from a previous run
        try {
            const tx1 = await contract.requestDeliveryStatus(trackingNumber, wallet.address);
            await tx1.wait();
        } catch (e) {
            console.log("Delivery likely already requested, proceeding to verify.");
        }

        const tx2 = await contract.verifyDelivery(trackingHash, true, Math.floor(Date.now() / 1000), "0x");
        await tx2.wait();
        console.log("Successfully verified delivery on Flare Contract!");
    } catch (e) {
        console.error("Failed to verify:", e.message);
        process.exit(1);
    }
}

runMock();
