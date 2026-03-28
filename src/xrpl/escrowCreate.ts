import { Client, Wallet, EscrowCreate, isoTimeToRippleTime } from 'xrpl';
const cc = require('five-bells-condition');
import * as crypto from 'crypto';
import * as dotenv from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';

dotenv.config();

async function createEscrow() {
    const XRPL_NODE = process.env.XRPL_NODE || "wss://s.altnet.rippletest.net:51233";
    const BUYER_SEED = process.env.BUYER_SEED;
    const SELLER_ADDRESS = process.env.SELLER_ADDRESS;

    if (!BUYER_SEED || !SELLER_ADDRESS) {
        console.error("Please set BUYER_SEED and SELLER_ADDRESS in your .env file.");
        process.exit(1);
    }

    const client = new Client(XRPL_NODE);
    await client.connect();

    const buyerWallet = Wallet.fromSeed(BUYER_SEED);
    console.log(`Connected as Buyer: ${buyerWallet.address}`);

    // Generate 32 random bytes for the preimage
    const preimageData = crypto.randomBytes(32);
    const myFulfillment = new cc.PreimageSha256();
    myFulfillment.setPreimage(preimageData);

    // Condition in hex format required for XRPL Escrow
    const conditionHex = myFulfillment.getConditionBinary().toString('hex').toUpperCase();
    const fulfillmentHex = myFulfillment.serializeBinary().toString('hex').toUpperCase();

    console.log("Generated PREIMAGE-SHA-256 Crypto-Condition.");
    console.log("Condition:", conditionHex);
    console.log("Fulfillment (SECRET):", fulfillmentHex);

    // Provide the directory (useful for MVP so the watcher can pick it up automatically)
    const secretsPath = path.join(__dirname, 'fulfillment.json');
    fs.writeFileSync(secretsPath, JSON.stringify({ fulfillment: fulfillmentHex, condition: conditionHex }, null, 2));
    console.log(`Saved Fulfillment data to ${secretsPath} for the watcher to use later.`);

    const escrowTx: EscrowCreate = {
        TransactionType: "EscrowCreate",
        Account: buyerWallet.address,
        Amount: "10000000", // 10 XRP for testnet drops
        Destination: SELLER_ADDRESS,
        Condition: conditionHex,
        // Wait 30 seconds before we are theoretically allowed to finish 
        // NOTE: Optional for condition-based but standard to illustrate "time + condition"
        FinishAfter: isoTimeToRippleTime(new Date(Date.now() + 30 * 1000).toISOString()),
        // CancelAfter allows funds recovery if condition is never met
        CancelAfter: isoTimeToRippleTime(new Date(Date.now() + 60 * 60 * 1000).toISOString())
    };

    console.log("Submitting EscrowCreate transaction...");
    try {
        const response = await client.submitAndWait(escrowTx, { wallet: buyerWallet });
        console.log("Transaction result:", (response.result.meta as any).TransactionResult);

        const sequence = (response.result as any).tx_json.Sequence;
        console.log("Escrow Sequence:", sequence);

        // Save sequence out so EscrowFinish can readily target it
        const escrowInfo = JSON.parse(fs.readFileSync(secretsPath, 'utf8'));
        escrowInfo.escrowSequence = sequence;
        escrowInfo.ownerAddress = buyerWallet.address;
        fs.writeFileSync(secretsPath, JSON.stringify(escrowInfo, null, 2));

    } catch (error) {
        console.error("Error creating escrow:", error);
    }

    await client.disconnect();
}

createEscrow().catch(console.error);
