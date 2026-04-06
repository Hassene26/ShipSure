import * as http from 'http';
import * as fs from 'fs';
import * as path from 'path';
import { exec } from 'child_process';
import { ethers } from 'ethers';
import * as dotenv from 'dotenv';
dotenv.config();

const PORT = 3000;
let escrowStatus = "Awaiting Setup";

// ── Logging ──────────────────────────────────────────────────────────
const logs: { timestamp: string; source: string; message: string }[] = [];

function log(source: string, message: string) {
    const timestamp = new Date().toISOString();
    const entry = { timestamp, source, message };
    logs.push(entry);
    // Keep last 200 logs in memory
    if (logs.length > 200) logs.shift();
    console.log(`[${timestamp}] [${source}] ${message}`);
}

// ── Flare Watcher (integrated) ───────────────────────────────────────
let watcherRunning = false;

async function startFlareWatcher() {
    const FLARE_RPC = process.env.FLARE_RPC || "https://coston2-api.flare.network/ext/bc/C/rpc";
    const CONTRACT_ADDRESS = process.env.FLARE_CONTRACT_ADDRESS;

    if (!CONTRACT_ADDRESS) {
        log("WATCHER", "FLARE_CONTRACT_ADDRESS not set in .env — watcher disabled");
        return;
    }

    const abi = [
        "event DeliveryConfirmed(bytes32 indexed trackingHash, address indexed seller)"
    ];

    const provider = new ethers.JsonRpcProvider(FLARE_RPC);
    const contract = new ethers.Contract(CONTRACT_ADDRESS, abi, provider);

    watcherRunning = true;
    log("WATCHER", `Listening for DeliveryConfirmed events on Flare Coston2`);
    log("WATCHER", `Contract: ${CONTRACT_ADDRESS}`);

    contract.on("DeliveryConfirmed", async (trackingHash: string, seller: string, eventLog: any) => {
        log("WATCHER", `DeliveryConfirmed event detected!`);
        log("WATCHER", `Tracking hash: ${trackingHash}`);
        log("WATCHER", `Seller: ${seller}`);
        log("WATCHER", `Flare TxHash: ${eventLog.log.transactionHash}`);

        escrowStatus = "Delivery Confirmed by Flare! Releasing Escrow...";
        log("WATCHER", "Triggering XRPL EscrowFinish...");

        const finishScript = path.join(__dirname, '../xrpl/escrowFinish.ts');
        exec(`npx ts-node ${finishScript}`, (error, stdout, stderr) => {
            if (error) {
                log("ESCROW-FINISH", `Error: ${stderr}`);
                escrowStatus = "Error Releasing Escrow";
            } else {
                log("ESCROW-FINISH", stdout.trim());
                escrowStatus = "Smart Contract Released Funds Successfully!";
                log("ESCROW-FINISH", "Cross-chain escrow release complete");
            }
        });
    });

    process.on('SIGINT', () => {
        log("WATCHER", "Shutting down...");
        provider.destroy();
        process.exit(0);
    });
}

// ── HTTP Server ──────────────────────────────────────────────────────
const server = http.createServer((req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        res.writeHead(204);
        res.end();
        return;
    }

    if (req.url === '/' && req.method === 'GET') {
        const filePath = path.join(__dirname, 'index.html');
        fs.readFile(filePath, (err, content) => {
            if (err) {
                res.writeHead(500);
                res.end("Error loading HTML");
            } else {
                res.writeHead(200, { 'Content-Type': 'text/html' });
                res.end(content);
            }
        });
    } else if (req.url === '/api/status' && req.method === 'GET') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: escrowStatus, watcherRunning }));
    } else if (req.url === '/api/logs' && req.method === 'GET') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ logs }));
    } else if (req.url === '/api/lock' && req.method === 'POST') {
        escrowStatus = "Locking Funds on XRPL...";
        log("ESCROW-CREATE", "Initiating XRPL escrow creation...");
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, message: "Started" }));

        exec(`npx ts-node ${path.join(__dirname, '../xrpl/escrowCreate.ts')}`, (error, stdout, stderr) => {
            if (error) {
                log("ESCROW-CREATE", `Error: ${stderr}`);
                escrowStatus = "Error Locking Funds";
            } else {
                log("ESCROW-CREATE", stdout.trim());
                escrowStatus = "Funds Locked. Awaiting Shipment.";
                log("ESCROW-CREATE", "Escrow created successfully — funds locked on XRPL");
            }
        });
    } else if (req.url === '/api/check-delivery' && req.method === 'POST') {
        // FedEx-only check — no Flare interaction. Frontend handles contract signing via MetaMask.
        let body = '';
        req.on('data', (chunk: Buffer) => { body += chunk.toString(); });
        req.on('end', async () => {
            let trackingNumber = '';
            try {
                const parsed = JSON.parse(body);
                trackingNumber = parsed.trackingNumber || '';
            } catch { }

            if (!trackingNumber) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: false, error: "trackingNumber is required" }));
                return;
            }

            log("FEDEX", `Checking delivery status for: ${trackingNumber}`);
            escrowStatus = "Querying FedEx for delivery status...";

            try {
                const { trackPackage } = await import('../fedex/fedexClient');
                const result = await trackPackage(trackingNumber);

                log("FEDEX", `Status: ${result.rawStatus} — ${result.statusDetail}`);
                log("FEDEX", `Delivered: ${result.isDelivered}`);

                if (result.isDelivered) {
                    escrowStatus = "FedEx confirmed delivery. Awaiting on-chain verification...";
                } else {
                    escrowStatus = "Package not delivered yet. Try again later.";
                }

                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({
                    success: true,
                    isDelivered: result.isDelivered,
                    rawStatus: result.rawStatus,
                    statusDetail: result.statusDetail,
                    deliveryTime: result.deliveryTime,
                    estimatedDelivery: result.estimatedDelivery,
                }));
            } catch (e: any) {
                log("FEDEX", `Error: ${e.message}`);
                escrowStatus = "Error checking FedEx status";
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: false, error: e.message }));
            }
        });
    } else if (req.url === '/api/delivery-confirmed' && req.method === 'POST') {
        // Called by frontend after MetaMask signing succeeds — updates status for the watcher
        let body = '';
        req.on('data', (chunk: Buffer) => { body += chunk.toString(); });
        req.on('end', () => {
            let txHash = '';
            try {
                const parsed = JSON.parse(body);
                txHash = parsed.txHash || '';
            } catch { }

            log("DELIVERY", `On-chain verification confirmed via MetaMask. Flare tx: ${txHash}`);
            escrowStatus = "Delivery Confirmed on Flare! Releasing Escrow...";
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: true }));
        });
    } else {
        res.writeHead(404);
        res.end("Not found");
    }
});

server.listen(PORT, async () => {
    log("SERVER", `ShipSure running at http://localhost:${PORT}`);
    log("SERVER", "Starting integrated Flare watcher...");
    await startFlareWatcher();
    log("SERVER", "All systems ready");
});
