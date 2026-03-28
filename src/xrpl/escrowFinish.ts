import { Client, Wallet, EscrowFinish } from 'xrpl';
import * as dotenv from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';

dotenv.config();

async function finishEscrow() {
    const XRPL_NODE = process.env.XRPL_NODE || "wss://s.altnet.rippletest.net:51233";
    
    // In ShipSure, the Watcher / Relayer will submit the EscrowFinish. It can be any wallet paying the fee!
    // For simplicity, we just use the Buyer's wallet to pay the transaction fee.
    const WATCHER_SEED = process.env.BUYER_SEED;
    
    if (!WATCHER_SEED) {
        console.error("Please set BUYER_SEED in your .env file to act as the Watcher.");
        process.exit(1);
    }

    const secretsPath = path.join(__dirname, 'fulfillment.json');
    if (!fs.existsSync(secretsPath)) {
        console.error(`Missing ${secretsPath}. Run escrowCreate.ts first.`);
        process.exit(1);
    }

    const escrowInfo = JSON.parse(fs.readFileSync(secretsPath, 'utf8'));
    const conditionHex = escrowInfo.condition;
    const fulfillmentHex = escrowInfo.fulfillment;
    const escrowSequence = escrowInfo.escrowSequence;
    const ownerAddress = escrowInfo.ownerAddress;

    if (!escrowSequence || !ownerAddress) {
        console.error("Missing Escrow Sequence or Owner Address in fulfillment.json.");
        process.exit(1);
    }

    const client = new Client(XRPL_NODE);
    await client.connect();

    const watcherWallet = Wallet.fromSeed(WATCHER_SEED);
    console.log(`Connected as Relayer/Watcher: ${watcherWallet.address}`);

    const finishTx: EscrowFinish = {
        TransactionType: "EscrowFinish",
        Account: watcherWallet.address,
        Owner: ownerAddress,
        OfferSequence: escrowSequence,
        Condition: conditionHex,
        Fulfillment: fulfillmentHex
    };

    console.log("Submitting EscrowFinish transaction...");
    try {
        const response = await client.submitAndWait(finishTx, { wallet: watcherWallet });
        console.log("Transaction result:", (response.result.meta as any).TransactionResult);
    } catch (error) {
        console.error("Error finishing escrow:", error);
    }

    await client.disconnect();
}

finishEscrow().catch(console.error);
