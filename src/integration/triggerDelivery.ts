import { ethers } from 'ethers';
import { trackPackage } from '../fedex/fedexClient';
import * as dotenv from 'dotenv';
dotenv.config();

const FLARE_RPC = process.env.FLARE_RPC || "https://coston2-api.flare.network/ext/bc/C/rpc";
const CONTRACT_ADDRESS = process.env.FLARE_CONTRACT_ADDRESS;
const PK = process.env.FLARE_PRIVATE_KEY;
const TRACKING_NUMBER = process.env.TRACKING_NUMBER || process.argv[2];

if (!CONTRACT_ADDRESS || !PK) {
    console.error("Please set FLARE_CONTRACT_ADDRESS and FLARE_PRIVATE_KEY in .env");
    process.exit(1);
}

if (!TRACKING_NUMBER) {
    console.error("No tracking number provided. Set TRACKING_NUMBER in .env or pass as CLI argument.");
    process.exit(1);
}

const abi = [
    "function requestDeliveryStatus(string trackingNumber, address seller) public",
    "function verifyDelivery(bytes32 trackingHash, bool isDelivered, uint256 deliveryTime, bytes proof) external"
];

async function run() {
    console.log(`[Delivery] Starting real FedEx verification for: ${TRACKING_NUMBER}`);

    // Step 1: Query FedEx API
    const result = await trackPackage(TRACKING_NUMBER);

    if (!result.isDelivered) {
        console.log(`[Delivery] Package NOT delivered yet. Status: ${result.rawStatus} — ${result.statusDetail}`);
        if (result.estimatedDelivery) {
            console.log(`[Delivery] Estimated delivery: ${result.estimatedDelivery}`);
        }
        console.log("[Delivery] Skipping on-chain verification. Try again later.");
        process.exit(0);
    }

    // Step 2: Package is delivered — submit to Flare contract
    console.log(`[Delivery] Package confirmed DELIVERED by FedEx. Submitting to Flare...`);

    const provider = new ethers.JsonRpcProvider(FLARE_RPC);
    const wallet = new ethers.Wallet(PK as string, provider);
    const contract = new ethers.Contract(CONTRACT_ADDRESS as string, abi, wallet);

    const trackingHash = ethers.keccak256(ethers.toUtf8Bytes(TRACKING_NUMBER));

    try {
        // Request delivery status on-chain (may already exist from previous run)
        try {
            console.log("[Delivery] Calling requestDeliveryStatus on Flare...");
            const tx1 = await contract.requestDeliveryStatus(TRACKING_NUMBER, wallet.address);
            const receipt1 = await tx1.wait();
            console.log(`[Delivery] requestDeliveryStatus tx: ${receipt1.hash}`);
        } catch (e: any) {
            console.log("[Delivery] Delivery already requested on-chain, proceeding to verify.");
        }

        // Verify delivery with real data
        console.log("[Delivery] Calling verifyDelivery on Flare...");
        const tx2 = await contract.verifyDelivery(
            trackingHash,
            true,
            result.deliveryTime || Math.floor(Date.now() / 1000),
            "0x"
        );
        const receipt2 = await tx2.wait();
        console.log(`[Delivery] verifyDelivery tx: ${receipt2.hash}`);
        console.log("[Delivery] Delivery verified on Flare! Watcher will now release XRPL escrow.");
    } catch (e: any) {
        console.error(`[Delivery] Flare contract error: ${e.message}`);
        process.exit(1);
    }
}

run().catch((e) => {
    console.error(`[Delivery] Fatal error: ${e.message}`);
    process.exit(1);
});
