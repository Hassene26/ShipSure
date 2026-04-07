# ShipSure

Cross-chain escrow platform that bridges the **XRP Ledger** and **Flare Network** to enable trustless payment for shipping. Buyer funds are locked in an XRPL escrow and automatically released only when the **FedEx Track API** confirms real-world package delivery, cryptographically verified on-chain through **Flare's Data Connector (FDC)**.

## How It Works

```
Buyer locks XRP       Seller ships package       FedEx confirms delivery
      |                      |                           |
  XRPL Escrow          Tracking number             FedEx Track API
  (crypto-conditioned)  entered in UI              queried by backend
      |                      |                           |
      |                      |                   Delivery status published
      |                      |                   to public endpoint
      |                      |                           |
      |                      |                   FDC attestation request
      |                      |                   submitted to FdcHub (MetaMask)
      |                      |                           |
      |                      |                   ~90-180s: FDC providers
      |                      |                   fetch & attest the data
      |                      |                           |
      |                      |                   Merkle proof retrieved
      |                      |                   from DA Layer
      |                      |                           |
      |                      |                   verifyDelivery(proof)
      |                      |                   signed via MetaMask
      |                      |                           |
      |                      |                   Contract verifies FDC proof,
      |                      |                   decodes status == "DL",
      |                      |                   emits DeliveryConfirmed
      |                      |                           |
      +----------------------+------ Watcher catches event, releases escrow
                                                         |
                                                  EscrowFinish on XRPL
                                                  Funds sent to Seller
```

### Step-by-step flow

1. **Buyer locks funds** - XRPL `EscrowCreate` with a PREIMAGE-SHA-256 cryptographic condition
2. **Seller ships package** - Enters the FedEx tracking number in the UI
3. **Backend verifies delivery** - Server queries the real FedEx Track API (OAuth2)
4. **Delivery status published** - If FedEx confirms delivery, the status is stored and exposed via a public endpoint for FDC providers to fetch
5. **FDC attestation submitted** - MetaMask signs the `FdcHub.requestAttestation()` transaction (pays C2FLR fee)
6. **FDC consensus** - Attestation providers independently fetch the public endpoint, reach consensus (~90-180s), and store a Merkle root on-chain
7. **Proof retrieved** - The Merkle proof is fetched from the Flare Data Availability Layer
8. **On-chain verification** - MetaMask signs `verifyDelivery(trackingHash, proof)` on the smart contract, which verifies the FDC Merkle proof, validates the URL, decodes the attested status, and checks it equals `"DL"` (Delivered)
9. **Escrow auto-releases** - The integrated watcher detects the `DeliveryConfirmed` event and submits `EscrowFinish` to XRPL

## Tech Stack

| Layer | Technology |
|---|---|
| Payment Settlement | XRP Ledger (XRPL Testnet) |
| On-Chain Oracle | Flare Data Connector - FDC (Coston2 Testnet) |
| Smart Contracts | Solidity 0.8.20 / Foundry |
| Delivery Verification | FedEx Track API (OAuth2) |
| Attestation Type | FDC Web2Json (JsonApi) |
| Backend | Node.js + TypeScript |
| Frontend | HTML5 + ethers.js + MetaMask |
| XRPL Integration | xrpl.js |
| Flare Integration | ethers.js v6 + flare-periphery-contracts |

## Project Structure

```
ShipSure/
├── src/
│   ├── xrpl/
│   │   ├── escrowCreate.ts         # Lock funds with crypto condition
│   │   ├── escrowFinish.ts         # Release funds with fulfillment
│   │   └── monitorEscrow.ts        # Real-time ledger monitoring
│   ├── fedex/
│   │   └── fedexClient.ts          # FedEx OAuth2 + Track API client
│   ├── integration/
│   │   ├── fdcAttestation.ts        # FDC attestation: prepare, submit, retrieve proof
│   │   ├── triggerDelivery.ts       # Standalone FedEx verification script
│   │   └── flareWatcher.ts          # Standalone event listener (alternative)
│   └── ui/
│       ├── server.ts                # HTTP server + integrated Flare watcher + FDC endpoints
│       └── index.html               # Frontend dashboard (6-step verification flow)
├── flare-contracts/
│   ├── src/DeliveryVerifier.sol     # FDC-integrated delivery verification contract
│   ├── test/DeliveryVerifier.t.sol  # 6 tests with mock FDC verification
│   └── script/DeliveryVerifier.s.sol
├── .env.example
└── package.json
```

## Prerequisites

- **Node.js** (v18+)
- **Foundry** - [Install](https://book.getfoundry.sh/getting-started/installation)
- **MetaMask** browser extension
- **ngrok** (or similar) - To expose your server publicly for FDC providers
- **XRPL Testnet wallet** - Get one at [XRPL Faucet](https://faucet.altnet.rippletest.net/)
- **Flare Coston2 testnet C2FLR** - Get tokens from [Coston2 Faucet](https://faucet.flare.network/coston2)
- **FedEx Developer account** - Sign up at [developer.fedex.com](https://developer.fedex.com) and create a project with the **Basic Integrated Visibility** (Track API)

## Setup

1. **Clone and install**
   ```bash
   git clone <repo-url>
   cd ShipSure
   npm install
   ```

2. **Install Flare contracts dependencies**
   ```bash
   cd flare-contracts
   forge install
   cd ..
   ```

3. **Expose your server publicly** (required for FDC providers)
   ```bash
   ngrok http 3000
   ```
   Note the public URL (e.g., `https://abc123.ngrok-free.dev`)

4. **Deploy the smart contract**
   ```bash
   cd flare-contracts
   DELIVERY_API_PREFIX="https://<your-ngrok-url>/api/public/delivery-status/" \
   forge script script/DeliveryVerifier.s.sol \
     --broadcast \
     --rpc-url https://coston2-api.flare.network/ext/bc/C/rpc \
     --private-key <your-private-key>
   ```
   Note the deployed contract address from the output.

5. **Configure environment**
   ```bash
   cp .env.example .env
   ```
   Fill in your `.env`:
   ```
   XRPL_NODE=wss://s.altnet.rippletest.net:51233
   BUYER_SEED=<your XRPL testnet seed>
   SELLER_ADDRESS=<your XRPL testnet seller address>
   FLARE_RPC=https://coston2-api.flare.network/ext/bc/C/rpc
   FLARE_CONTRACT_ADDRESS=<deployed contract address>
   FEDEX_API_KEY=<your FedEx API key>
   FEDEX_SECRET_KEY=<your FedEx secret key>
   FEDEX_API_URL=https://apis-sandbox.fedex.com
   PUBLIC_URL=https://<your-ngrok-url>
   FDC_VERIFIER_URL=https://fdc-verifiers-testnet.flare.network
   FDC_VERIFIER_API_KEY=00000000-0000-0000-0000-000000000000
   FDC_DA_LAYER_URL=https://ctn2-data-availability.flare.network
   ```

6. **Update the contract address in the frontend**

   Edit `src/ui/index.html` and set `CONTRACT_ADDRESS` to your deployed address.

7. **Add Flare Coston2 to MetaMask**
   - Network Name: `Coston2 Testnet`
   - RPC URL: `https://coston2-api.flare.network/ext/bc/C/rpc`
   - Chain ID: `114`
   - Symbol: `C2FLR`
   - Explorer: `https://coston2-explorer.flare.network`

8. **Start the server**
   ```bash
   npx ts-node src/ui/server.ts
   ```
   Open [http://localhost:3000](http://localhost:3000)

## Usage

1. Click **"Lock Funds on XRPL"** - Creates a crypto-conditioned escrow on XRPL Testnet
2. Enter a **FedEx tracking number** in the seller panel
3. Click **"Verify Delivery via FedEx"** - The 6-step flow begins:
   - **Step 1**: Backend queries FedEx API
   - **Step 2**: Backend prepares FDC attestation request
   - **Step 3**: MetaMask signs `FdcHub.requestAttestation()` (pays C2FLR fee)
   - **Step 4**: Waits ~90-180s for FDC round finalization, then retrieves Merkle proof
   - **Step 5**: MetaMask signs `requestDeliveryStatus()` on the contract
   - **Step 6**: MetaMask signs `verifyDelivery(proof)` - contract verifies FDC proof on-chain
4. The integrated **watcher** detects the `DeliveryConfirmed` event and auto-releases the XRPL escrow

If the package is **not delivered**, the flow stops at Step 1 with an alert showing the current FedEx status.

## FedEx Sandbox Test Tracking Numbers

| Tracking Number | Status |
|---|---|
| `122816215025810` | Delivered |
| `231300687629630` | On FedEx vehicle for delivery |
| `920241085725456` | At local FedEx facility |
| `568838414941` | At destination sort facility |
| `403934084723025` | Arrived at FedEx location |
| `039813852990618` | Departed FedEx location |
| `149331877648230` | Tendered |
| `020207021381215` | Picked up |
| `449044304137821` | Shipment information sent to FedEx |
| `377101283611590` | Delivery exception - Customer not available |
| `852426136339213` | Delivery exception - Local delivery restriction |
| `957794015041323` | Shipment exception - Unable to deliver |
| `076288115212522` | Returned to sender |
| `581190049992` | Clearance delay |
| `843119172384577` | Hold at location |
| `070358180009382` | Shipment canceled |

Use `122816215025810` to test the full happy path (delivered). Use any other number to verify the "not delivered" rejection flow.

## Verify Transactions On-Chain

**XRPL Testnet Explorer**: [testnet.xrpl.org](https://testnet.xrpl.org)
- Search the buyer address for `EscrowCreate` and `EscrowFinish` transactions

**Flare Coston2 Explorer**: [coston2-explorer.flare.network](https://coston2-explorer.flare.network)
- Search the contract address for `DeliveryConfirmed` events
- Verify that `verifyDelivery` transactions include a valid FDC Merkle proof

**Flare Systems Explorer**: [coston2-systems-explorer.flare.rocks](https://coston2-systems-explorer.flare.rocks)
- Check voting round finalization status for your FDC attestation

## API Endpoints

| Endpoint | Method | Description |
|---|---|---|
| `/` | GET | Serves the UI dashboard |
| `/api/status` | GET | Current escrow status + watcher state |
| `/api/logs` | GET | Server logs (last 200 entries) |
| `/api/lock` | POST | Triggers XRPL escrow creation |
| `/api/check-delivery` | POST | Queries FedEx API `{ trackingNumber }` |
| `/api/public/delivery-status/:hash` | GET | Public endpoint for FDC providers (returns `{ statusCode }`) |
| `/api/prepare-attestation` | POST | Prepares FDC attestation request `{ trackingHash }` |
| `/api/retrieve-proof` | POST | Waits for FDC finalization + retrieves Merkle proof `{ votingRoundId, abiEncodedRequest }` |
| `/api/delivery-confirmed` | POST | Notifies server after on-chain verification `{ txHash }` |

## Smart Contract

`DeliveryVerifier.sol` - FDC-integrated delivery verification

**Constructor:**
- `constructor(string _deliveryApiPrefix)` - Sets the trusted URL prefix for FDC proof validation

**Functions:**
- `requestDeliveryStatus(trackingNumber, seller)` - Registers a delivery tracking request
- `verifyDelivery(trackingHash, IWeb2Json.Proof _proof)` - Verifies an FDC Merkle proof, decodes the attested delivery status, and emits `DeliveryConfirmed` if status is `"DL"`

**On-chain verification steps (inside `verifyDelivery`):**
1. Validates the FDC Merkle proof via `ContractRegistry.getFdcVerification().verifyWeb2Json(proof)`
2. Checks the attested URL starts with the trusted `deliveryApiPrefix`
3. Decodes `abiEncodedData` into a `DeliveryStatus` struct and checks `statusCode == "DL"`
4. Emits `DeliveryConfirmed(trackingHash, seller)`

**Run contract tests:**
```bash
cd flare-contracts
forge test
```

Tests cover: valid delivery, non-delivered status, wrong URL, invalid proof, not-requested, and double-confirmation.

## Architecture

- **No private keys on the server** - All Flare transactions (FdcHub attestation + contract verification) are signed client-side via MetaMask
- **FedEx API keys stay on the backend** - OAuth2 authentication and tracking queries happen server-side
- **FDC provides cryptographic proof** - Delivery status is attested by Flare's decentralized data providers and verified on-chain via Merkle proof
- **Hybrid verification model** - FedEx API (authenticated, off-chain) publishes to a public endpoint, FDC (decentralized, on-chain) attests the public data
- **Integrated watcher** - The Flare event listener runs inside the server process, no separate terminal needed
- **Real-time logging** - All steps logged to console and available via `/api/logs`

## FDC Integration Details

The Flare Data Connector enables trustless on-chain verification of off-chain data:

| Component | Address / URL |
|---|---|
| FdcHub (Coston2) | `0x48aC463d7975828989331F4De43341627b9c5f1D` |
| FdcVerification (Coston2) | `0x075bf301fF07C4920e5261f93a0609640F53487D` |
| ContractRegistry (Coston2) | `0xaD67FE66660Fb8dFE9d6b1b4240d8650e30F6019` |
| Verifier API | `https://fdc-verifiers-testnet.flare.network` |
| DA Layer | `https://ctn2-data-availability.flare.network` |
| Systems Explorer | `https://coston2-systems-explorer.flare.rocks` |

**Attestation type:** `Web2Json` with source `PublicWeb2`

**JQ filter:** `{statusCode: .statusCode}` extracts the delivery status from the public endpoint

**ABI signature:** `tuple(string statusCode)` encodes the response for on-chain decoding
