import { ethers } from 'ethers';
import * as dotenv from 'dotenv';
dotenv.config();

// ── FDC Constants (Coston2) ──────────────────────────────────────────
const VERIFIER_BASE_URL = process.env.FDC_VERIFIER_URL || "https://fdc-verifiers-testnet.flare.network";
const VERIFIER_API_KEY = process.env.FDC_VERIFIER_API_KEY || "00000000-0000-0000-0000-000000000000";
const DA_LAYER_URL = process.env.FDC_DA_LAYER_URL || "https://ctn2-data-availability.flare.network";
const FDC_HUB_ADDRESS = "0x48aC463d7975828989331F4De43341627b9c5f1D";
const FDC_FEE_CONFIG_ADDRESS = "0x191a1282Ac700edE65c5B0AaF313BAcC3eA7fC7e";
const FIRST_VOTING_ROUND_START_TS = 1658430000;
const VOTING_EPOCH_DURATION_S = 90;

// Public URL where FDC providers can fetch delivery status
const PUBLIC_URL = process.env.PUBLIC_URL || "http://localhost:3000";

// ── Helpers ──────────────────────────────────────────────────────────
function toHex32(str: string): string {
    let hex = '';
    for (let i = 0; i < str.length; i++) {
        hex += str.charCodeAt(i).toString(16);
    }
    return '0x' + hex.padEnd(64, '0');
}

export interface AttestationResult {
    abiEncodedRequest: string;
    votingRoundId: number;
    proof: any; // The full proof object to pass to the contract
}

// ── Step 1: Prepare the attestation request ──────────────────────────
export async function prepareAttestationRequest(trackingHash: string): Promise<{ abiEncodedRequest: string; status: string }> {
    console.log("[FDC] Preparing attestation request...");
    console.log(`[FDC] Public URL: ${PUBLIC_URL}/api/public/delivery-status/${trackingHash}`);

    const attestationType = toHex32("Web2Json");
    const sourceId = toHex32("PublicWeb2");

    // JQ filter extracts statusCode from our public endpoint response
    const postProcessJq = '{statusCode: .statusCode}';

    // ABI signature must be a JSON ABI fragment describing a tuple struct
    const abiSignature = JSON.stringify({
        components: [
            { internalType: "string", name: "statusCode", type: "string" }
        ],
        name: "deliveryStatus",
        type: "tuple"
    });

    const requestData = {
        attestationType,
        sourceId,
        requestBody: {
            url: `${PUBLIC_URL}/api/public/delivery-status/${trackingHash}`,
            httpMethod: "GET",
            headers: "{}",
            queryParams: "{}",
            body: "{}",
            postProcessJq,
            abiSignature
        }
    };

    const response = await fetch(`${VERIFIER_BASE_URL}/verifier/web2/Web2Json/prepareRequest`, {
        method: "POST",
        headers: {
            "X-API-KEY": VERIFIER_API_KEY,
            "Content-Type": "application/json"
        },
        body: JSON.stringify(requestData)
    });

    if (!response.ok) {
        const text = await response.text();
        throw new Error(`FDC prepareRequest failed (${response.status}): ${text}`);
    }

    const result = await response.json();
    console.log(`[FDC] Request prepared. Status: ${result.status}`);

    if (result.status !== "VALID") {
        throw new Error(`FDC request is not valid: ${result.status}`);
    }

    return {
        abiEncodedRequest: result.abiEncodedRequest,
        status: result.status
    };
}

// ── Step 2: Get the attestation fee ──────────────────────────────────
export async function getAttestationFee(provider: ethers.Provider, abiEncodedRequest: string): Promise<bigint> {
    console.log("[FDC] Querying attestation fee...");

    const feeConfigAbi = ["function getRequestFee(bytes calldata _data) external view returns (uint256)"];
    const feeConfig = new ethers.Contract(FDC_FEE_CONFIG_ADDRESS, feeConfigAbi, provider);

    const fee = await feeConfig.getRequestFee(abiEncodedRequest);
    console.log(`[FDC] Attestation fee: ${ethers.formatEther(fee)} C2FLR`);
    return fee;
}

// ── Step 3: Submit attestation request (returns tx data for MetaMask) ─
export function getSubmitAttestationTxData(abiEncodedRequest: string): { to: string; data: string } {
    const iface = new ethers.Interface(["function requestAttestation(bytes calldata _data) external payable"]);
    const data = iface.encodeFunctionData("requestAttestation", [abiEncodedRequest]);
    return { to: FDC_HUB_ADDRESS, data };
}

// ── Step 4: Calculate voting round ID from block timestamp ───────────
export function calculateVotingRoundId(blockTimestamp: number): number {
    return Math.floor((blockTimestamp - FIRST_VOTING_ROUND_START_TS) / VOTING_EPOCH_DURATION_S);
}

// ── Step 5+6: Wait for finalization by polling proof retrieval ────────
// Instead of checking a status endpoint, we just try to retrieve the proof.
// If the round isn't finalized yet, the DA Layer returns an error — we retry.
export async function waitAndRetrieveProof(votingRoundId: number, abiEncodedRequest: string, maxWaitMs: number = 300000): Promise<any> {
    console.log(`[FDC] Waiting for voting round ${votingRoundId} to finalize and retrieving proof...`);
    console.log(`[FDC] Check status: https://coston2-systems-explorer.flare.rocks/voting-epoch/${votingRoundId}?tab=fdc`);

    const startTime = Date.now();
    const pollInterval = 15000; // 15 seconds

    while (Date.now() - startTime < maxWaitMs) {
        try {
            const res = await fetch(`${DA_LAYER_URL}/api/v1/fdc/proof-by-request-round`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "X-API-KEY": VERIFIER_API_KEY
                },
                body: JSON.stringify({
                    votingRoundId,
                    requestBytes: abiEncodedRequest
                })
            });

            if (res.ok) {
                const result = await res.json();
                // Check if the proof is actually present
                if (result.proof && result.response) {
                    console.log(`[FDC] Voting round ${votingRoundId} finalized! Proof retrieved.`);
                    return {
                        merkleProof: result.proof,
                        data: result.response
                    };
                }
            }

            const errText = await res.text().catch(() => '');
            const elapsed = Math.floor((Date.now() - startTime) / 1000);
            console.log(`[FDC] Not ready yet (${res.status}): ${errText.slice(0, 200)}. ${elapsed}s elapsed...`);
        } catch (e: any) {
            const elapsed = Math.floor((Date.now() - startTime) / 1000);
            console.log(`[FDC] Poll error: ${e.message}. ${elapsed}s elapsed...`);
        }

        await new Promise(resolve => setTimeout(resolve, pollInterval));
    }

    throw new Error(`Voting round ${votingRoundId} did not finalize within ${maxWaitMs / 1000}s`);
}
