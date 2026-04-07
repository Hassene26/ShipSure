import * as http from 'http';
import * as fs from 'fs';
import * as path from 'path';
import { exec } from 'child_process';
import { ethers } from 'ethers';
import * as dotenv from 'dotenv';
dotenv.config();

const PORT = 3000;
const PUBLIC_URL = process.env.PUBLIC_URL || `http://localhost:${PORT}`;
let escrowStatus = "Awaiting Setup";

// ── Confirmed Deliveries (public attestable data) ────────────────────
// After FedEx confirms delivery, we store the result here.
// FDC providers fetch /api/public/delivery-status/<trackingHash> to attest it.
const confirmedDeliveries: Map<string, { statusCode: string; trackingNumber: string; confirmedAt: number }> = new Map();

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
    } else if (req.url?.startsWith('/api/public/delivery-status/') && req.method === 'GET') {
        // ── Public endpoint for FDC providers to fetch ──
        // Returns delivery status that FDC attestation providers will attest on-chain.
        const trackingHash = req.url.split('/api/public/delivery-status/')[1];
        const delivery = confirmedDeliveries.get(trackingHash);

        if (!delivery) {
            res.writeHead(404, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: "Delivery not found or not yet confirmed" }));
            return;
        }

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ statusCode: delivery.statusCode }));
    } else if (req.url === '/api/check-delivery' && req.method === 'POST') {
        // FedEx check + store confirmed delivery for FDC attestation
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

                // Compute tracking hash (same as contract uses)
                const trackingHash = ethers.keccak256(ethers.toUtf8Bytes(trackingNumber));

                if (result.isDelivered) {
                    // Store for FDC providers to attest
                    confirmedDeliveries.set(trackingHash, {
                        statusCode: result.rawStatus,
                        trackingNumber,
                        confirmedAt: Math.floor(Date.now() / 1000)
                    });
                    log("FEDEX", `Delivery stored for FDC attestation: ${trackingHash}`);
                    log("FEDEX", `Public URL: ${PUBLIC_URL}/api/public/delivery-status/${trackingHash}`);
                    escrowStatus = "FedEx confirmed delivery. Ready for FDC attestation...";
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
                    trackingHash,
                }));
            } catch (e: any) {
                log("FEDEX", `Error: ${e.message}`);
                escrowStatus = "Error checking FedEx status";
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: false, error: e.message }));
            }
        });
    } else if (req.url === '/api/prepare-attestation' && req.method === 'POST') {
        // Step 1 of FDC flow: prepare the attestation request and return data for MetaMask signing
        let body = '';
        req.on('data', (chunk: Buffer) => { body += chunk.toString(); });
        req.on('end', async () => {
            let trackingHash = '';
            try {
                const parsed = JSON.parse(body);
                trackingHash = parsed.trackingHash || '';
            } catch { }

            if (!trackingHash) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: false, error: "trackingHash is required" }));
                return;
            }

            // Verify the delivery was actually confirmed by FedEx
            if (!confirmedDeliveries.has(trackingHash)) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: false, error: "Delivery not confirmed by FedEx yet" }));
                return;
            }

            log("FDC", `Preparing attestation request for hash: ${trackingHash}`);
            escrowStatus = "Preparing FDC attestation request...";

            try {
                const { prepareAttestationRequest, getAttestationFee, getSubmitAttestationTxData } = await import('../integration/fdcAttestation');
                const FLARE_RPC = process.env.FLARE_RPC || "https://coston2-api.flare.network/ext/bc/C/rpc";
                const provider = new ethers.JsonRpcProvider(FLARE_RPC);

                const prepared = await prepareAttestationRequest(trackingHash);
                log("FDC", `Attestation request prepared: ${prepared.status}`);

                const fee = await getAttestationFee(provider, prepared.abiEncodedRequest);
                log("FDC", `Attestation fee: ${ethers.formatEther(fee)} C2FLR`);

                const txData = getSubmitAttestationTxData(prepared.abiEncodedRequest);

                escrowStatus = "FDC request ready. Sign with MetaMask...";
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({
                    success: true,
                    abiEncodedRequest: prepared.abiEncodedRequest,
                    fee: fee.toString(),
                    txData,
                }));
            } catch (e: any) {
                log("FDC", `Error: ${e.message}`);
                escrowStatus = "Error preparing attestation";
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: false, error: e.message }));
            }
        });
    } else if (req.url === '/api/retrieve-proof' && req.method === 'POST') {
        // Step 2 of FDC flow: wait for finalization and retrieve proof
        let body = '';
        req.on('data', (chunk: Buffer) => { body += chunk.toString(); });
        req.on('end', async () => {
            let votingRoundId = 0;
            let abiEncodedRequest = '';
            try {
                const parsed = JSON.parse(body);
                votingRoundId = parsed.votingRoundId || 0;
                abiEncodedRequest = parsed.abiEncodedRequest || '';
            } catch { }

            if (!votingRoundId || !abiEncodedRequest) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: false, error: "votingRoundId and abiEncodedRequest are required" }));
                return;
            }

            log("FDC", `Waiting for voting round ${votingRoundId} finalization...`);
            log("FDC", `abiEncodedRequest (first 80 chars): ${abiEncodedRequest.slice(0, 80)}...`);
            log("FDC", `abiEncodedRequest length: ${abiEncodedRequest.length}`);
            escrowStatus = `Waiting for FDC round ${votingRoundId} finalization (~90-180s)...`;

            try {
                const { waitAndRetrieveProof } = await import('../integration/fdcAttestation');

                const proof = await waitAndRetrieveProof(votingRoundId, abiEncodedRequest);
                log("FDC", `Round ${votingRoundId} finalized! Proof retrieved.`);

                escrowStatus = "FDC proof ready. Verify on-chain via MetaMask...";
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: true, proof }));
            } catch (e: any) {
                log("FDC", `Error: ${e.message}`);
                escrowStatus = "Error retrieving FDC proof";
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
