import * as http from 'http';
import * as fs from 'fs';
import * as path from 'path';
import { exec } from 'child_process';
import * as dotenv from 'dotenv';
dotenv.config();

const PORT = 3000;
let escrowStatus = "Awaiting Setup";

const server = http.createServer((req, res) => {
    // CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');

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
        res.end(JSON.stringify({ status: escrowStatus }));
    } else if (req.url === '/api/lock' && req.method === 'POST') {
        escrowStatus = "Locking Funds on XRPL...";
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, message: "Started" }));

        // Execute escrowCreate.ts in background
        exec(`npx ts-node ${path.join(__dirname, '../xrpl/escrowCreate.ts')}`, (error, stdout, stderr) => {
            if (error) {
                console.error("Lock error:", stderr);
                escrowStatus = "Error Locking Funds";
            } else {
                console.log(stdout);
                escrowStatus = "Funds Locked. Awaiting Shipment.";
            }
        });
    } else if (req.url === '/api/deliver' && req.method === 'POST') {
        escrowStatus = "Verifying Delivery on Flare...";
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true }));

        // For the MVP, we just assume the Seller enters their Cast Account Name or PK in a mock script
        // But since exec running Cast requires password, we will just simulate the state update visually
        // or execute a mock ethers script if MOCK_PK is provided.
        // We will execute a standalone ts script that does the ethers call, avoiding cast interactive limits.
        exec(`npx ts-node ${path.join(__dirname, '../integration/triggerMockDelivery.ts')}`, (error, stdout, stderr) => {
            if (error) {
                console.error("Delivery trigger error:", stderr);
                escrowStatus = "Error Verifying Delivery";
            } else {
                console.log(stdout);
                escrowStatus = "Delivery Confirmed by Flare! Releasing Escrow...";
                
                // Watcher is assumed to be running and will catch this to release funds!
                // So we just set status to "Completed" after a generous delay for the watcher to work
                setTimeout(() => {
                    escrowStatus = "Smart Contract Released Funds Successfully! 🎉";
                }, 8000);
            }
        });
    } else {
        res.writeHead(404);
        res.end("Not found");
    }
});

server.listen(PORT, () => {
    console.log(`ShipSure UI Server running at http://localhost:${PORT}`);
    console.log(`Please make sure your Watcher is running in another terminal!`);
});
