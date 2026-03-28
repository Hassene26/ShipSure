import { ethers } from 'ethers';
import * as dotenv from 'dotenv';
import { execSync } from 'child_process';
import * as path from 'path';

dotenv.config();

const FLARE_RPC = process.env.FLARE_RPC || "https://coston2-api.flare.network/ext/bc/C/rpc";
const CONTRACT_ADDRESS = process.env.FLARE_CONTRACT_ADDRESS;

if (!CONTRACT_ADDRESS) {
    console.error("Please set FLARE_CONTRACT_ADDRESS in your .env file.");
    process.exit(1);
}

// Minimal ABI to listen to the event
const abi = [
    "event DeliveryConfirmed(bytes32 indexed trackingHash, address indexed seller)"
];

async function watchFlare() {
    const provider = new ethers.JsonRpcProvider(FLARE_RPC);
    const contract = new ethers.Contract(CONTRACT_ADDRESS as string, abi, provider);

    console.log(`[Watcher] Listening for DeliveryConfirmed events on Flare Coston2`);
    console.log(`[Watcher] Contract Address: ${CONTRACT_ADDRESS}`);

    contract.on("DeliveryConfirmed", async (trackingHash, seller, eventLog) => {
        console.log("\n-------------------------------------------");
        console.log("🚚 [FLARE] Delivery Confirmed Event Detected!");
        console.log(`Hash: ${trackingHash}`);
        console.log(`Seller: ${seller}`);
        console.log(`TxHash: ${eventLog.log.transactionHash}`);
        console.log("-------------------------------------------\n");

        console.log("[Watcher] Automatically triggering XRPL Escrow Release...");
        try {
            // Execute the existing escrowFinish script!
            const finishScriptPath = path.join(__dirname, '../xrpl/escrowFinish.ts');
            
            // We use stdio: 'inherit' to print the output of the release directly here
            execSync(`npx ts-node ${finishScriptPath}`, { stdio: 'inherit' });
            
            console.log("\n✅ [Watcher] Cross-Chain Escrow Release Successful!");
        } catch (error) {
            console.error("\n❌ [Watcher] Failed to release Escrow on XRPL");
        }
    });

    process.on('SIGINT', () => {
        console.log("\nDisconnecting...");
        provider.destroy();
        process.exit(0);
    });
}

watchFlare().catch(console.error);
