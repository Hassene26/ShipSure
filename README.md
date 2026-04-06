# ShipSure

Cross-chain escrow platform that bridges the **XRP Ledger** and **Flare Network** to enable trustless payment for shipping. Buyer funds are locked in an XRPL escrow and automatically released only when the **FedEx Track API** confirms real-world package delivery, verified on-chain through Flare.

## How It Works

```
Buyer locks XRP          Seller ships package       FedEx confirms delivery
      |                        |                           |
  XRPL Escrow            Tracking number             FedEx Track API
  (crypto-conditioned)   entered in UI               queried by backend
      |                        |                           |
      |                        |                    MetaMask signs Flare tx
      |                        |                           |
      |                        |                    DeliveryConfirmed event
      |                        |                           |
      +------------------------+------ Watcher catches event, releases escrow
                                                           |
                                                    Funds sent to Seller
```

1. **Buyer locks funds** - XRPL `EscrowCreate` with a PREIMAGE-SHA-256 cryptographic condition
2. **Seller ships package** - Enters the FedEx tracking number in the UI
3. **Backend verifies delivery** - Server queries the real FedEx Track API
4. **User signs on Flare** - If FedEx confirms delivery, MetaMask prompts to sign `verifyDelivery` on the Flare smart contract
5. **Escrow auto-releases** - Integrated watcher detects `DeliveryConfirmed` event and submits `EscrowFinish` to XRPL

## Tech Stack

| Layer | Technology |
|---|---|
| Payment Settlement | XRP Ledger (XRPL Testnet) |
| Delivery Oracle | Flare Network (Coston2 Testnet) |
| Smart Contracts | Solidity 0.8.20 / Foundry |
| Delivery Verification | FedEx Track API (OAuth2) |
| Backend | Node.js + TypeScript |
| Frontend | HTML5 + ethers.js + MetaMask |
| XRPL Integration | xrpl.js |
| Flare Integration | ethers.js v6 |

## Project Structure

```
ShipSure/
├── src/
│   ├── xrpl/
│   │   ├── escrowCreate.ts       # Lock funds with crypto condition
│   │   ├── escrowFinish.ts       # Release funds with fulfillment
│   │   └── monitorEscrow.ts      # Real-time ledger monitoring
│   ├── fedex/
│   │   └── fedexClient.ts        # FedEx OAuth2 + Track API client
│   ├── integration/
│   │   ├── triggerDelivery.ts     # Real FedEx verification + Flare submission
│   │   └── flareWatcher.ts       # Standalone event listener (alternative)
│   └── ui/
│       ├── server.ts             # HTTP server + integrated Flare watcher
│       └── index.html            # Frontend dashboard
├── flare-contracts/
│   ├── src/DeliveryVerifier.sol   # Delivery verification smart contract
│   ├── test/DeliveryVerifier.t.sol
│   └── script/DeliveryVerifier.s.sol
├── .env.example
└── package.json
```

## Prerequisites

- **Node.js** (v18+)
- **MetaMask** browser extension
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

2. **Configure environment**
   ```bash
   cp .env.example .env
   ```
   Fill in your `.env`:
   ```
   XRPL_NODE=wss://s.altnet.rippletest.net:51233
   BUYER_SEED=<your XRPL testnet seed>
   SELLER_ADDRESS=<your XRPL testnet seller address>
   FLARE_RPC=https://coston2-api.flare.network/ext/bc/C/rpc
   FLARE_CONTRACT_ADDRESS=0x9518201B65b3b9a26a80Cf7605952620C9498001
   FEDEX_API_KEY=<your FedEx API key>
   FEDEX_SECRET_KEY=<your FedEx secret key>
   FEDEX_API_URL=https://apis-sandbox.fedex.com
   ```

3. **Add Flare Coston2 to MetaMask**
   - Network Name: `Coston2 Testnet`
   - RPC URL: `https://coston2-api.flare.network/ext/bc/C/rpc`
   - Chain ID: `114`
   - Symbol: `C2FLR`
   - Explorer: `https://coston2-explorer.flare.network`

4. **Start the server**
   ```bash
   npx ts-node src/ui/server.ts
   ```
   Open [http://localhost:3000](http://localhost:3000)

## Usage

1. Click **"Lock Funds on XRPL"** - Creates a crypto-conditioned escrow on XRPL Testnet
2. Enter a **FedEx tracking number** in the seller panel
3. Click **"Verify Delivery via FedEx"** - Backend queries FedEx API
4. If delivered, **MetaMask** prompts you to sign two Flare transactions
5. The integrated **watcher** detects the on-chain event and auto-releases the XRPL escrow

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

Source : [FedEx Testing Tracking Numbers](https://blog.trafficparrot.com/2022/06/how-to-get-fedex-testing-tracking-number.html#gsc.tab=0)

## Verify Transactions On-Chain

**XRPL Testnet Explorer**: [testnet.xrpl.org](https://testnet.xrpl.org)
- Search the buyer address for `EscrowCreate` and `EscrowFinish` transactions

**Flare Coston2 Explorer**: [coston2-explorer.flare.network](https://coston2-explorer.flare.network)
- Search contract `0x9518201B65b3b9a26a80Cf7605952620C9498001` for `DeliveryConfirmed` events

## API Endpoints

| Endpoint | Method | Description |
|---|---|---|
| `/` | GET | Serves the UI dashboard |
| `/api/status` | GET | Current escrow status + watcher state |
| `/api/logs` | GET | Server logs (last 200 entries) |
| `/api/lock` | POST | Triggers XRPL escrow creation |
| `/api/check-delivery` | POST | Queries FedEx API `{ trackingNumber }` |
| `/api/delivery-confirmed` | POST | Notifies server after MetaMask signing `{ txHash }` |

## Smart Contract

`DeliveryVerifier.sol` deployed on Flare Coston2 at `0x9518201B65b3b9a26a80Cf7605952620C9498001`

**Functions:**
- `requestDeliveryStatus(trackingNumber, seller)` - Registers a delivery tracking request
- `verifyDelivery(trackingHash, isDelivered, deliveryTime, proof)` - Confirms delivery, emits `DeliveryConfirmed` event

**Run contract tests:**
```bash
cd flare-contracts
forge test
```

## Architecture

- **No private keys on the server** - All Flare transactions are signed client-side via MetaMask
- **FedEx API keys stay on the backend** - OAuth2 authentication and tracking queries happen server-side
- **Integrated watcher** - The Flare event listener runs inside the server process, no separate terminal needed
- **Real-time logging** - All steps logged to console and available via `/api/logs`
