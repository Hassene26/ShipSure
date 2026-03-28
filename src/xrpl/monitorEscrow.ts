import { Client } from 'xrpl';
import * as dotenv from 'dotenv';

dotenv.config();

async function monitorEscrow() {
    const XRPL_NODE = process.env.XRPL_NODE || "wss://s.altnet.rippletest.net:51233";
    const SELLER_ADDRESS = process.env.SELLER_ADDRESS;

    if (!SELLER_ADDRESS) {
        console.error("Please set SELLER_ADDRESS in your .env file.");
        process.exit(1);
    }

    const client = new Client(XRPL_NODE);
    await client.connect();
    console.log(`Connected to XRPL Node: ${XRPL_NODE}`);

    console.log(`Monitoring Escrow transactions for Seller: ${SELLER_ADDRESS}`);

    // Subscribe to the seller's account to watch for Escrow transactions arriving
    await client.request({
        command: "subscribe",
        accounts: [SELLER_ADDRESS]
    });

    client.on("transaction", (tx) => {
        const transaction = (tx as any).transaction;
        if (!transaction) return;

        if (transaction.TransactionType === "EscrowFinish") {
            const txMeta = tx.meta as any;
            if (txMeta && txMeta.TransactionResult === "tesSUCCESS") {
                console.log("\n--- Escrow Finish Detected! ---");
                console.log("Transaction Hash:", transaction.hash);
                console.log("Status: Successfully Released Funds.");
                console.log("-------------------------------\n");
            }
        }
        else if (transaction.TransactionType === "EscrowCreate") {
            console.log("\n--- Escrow Create Detected! ---");
            console.log("Transaction Hash:", transaction.hash);
            console.log("Lock Amount (drops):", transaction.Amount);
            console.log("-------------------------------\n");
        }
    });

    // Provide a way to cleanly exit, though normally a watcher runs indefinitely
    process.on('SIGINT', async () => {
        console.log("Disconnecting...");
        await client.disconnect();
        process.exit(0);
    });
}

monitorEscrow().catch(console.error);
