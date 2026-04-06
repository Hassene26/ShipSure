import * as dotenv from 'dotenv';
dotenv.config();

const FEDEX_API_URL = process.env.FEDEX_API_URL || "https://apis-sandbox.fedex.com";
const FEDEX_API_KEY = process.env.FEDEX_API_KEY;
const FEDEX_SECRET_KEY = process.env.FEDEX_SECRET_KEY;

export interface TrackingResult {
    isDelivered: boolean;
    deliveryTime?: number;      // unix timestamp
    rawStatus: string;          // e.g. "DELIVERED", "IN_TRANSIT", "PICKED_UP"
    statusDetail: string;       // human-readable description
    estimatedDelivery?: string; // ISO date string if available
}

// ── OAuth2 Token Cache ───────────────────────────────────────────────
let cachedToken: string | null = null;
let tokenExpiresAt = 0;

export async function authenticate(): Promise<string> {
    if (!FEDEX_API_KEY || !FEDEX_SECRET_KEY) {
        throw new Error("FEDEX_API_KEY and FEDEX_SECRET_KEY must be set in .env");
    }

    // Return cached token if still valid (with 60s buffer)
    if (cachedToken && Date.now() < tokenExpiresAt - 60_000) {
        return cachedToken;
    }

    console.log("[FedEx] Authenticating with OAuth2...");

    const response = await fetch(`${FEDEX_API_URL}/oauth/token`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
            grant_type: "client_credentials",
            client_id: FEDEX_API_KEY,
            client_secret: FEDEX_SECRET_KEY,
        }),
    });

    if (!response.ok) {
        const body = await response.text();
        throw new Error(`FedEx auth failed (${response.status}): ${body}`);
    }

    const data = await response.json();
    cachedToken = data.access_token;
    tokenExpiresAt = Date.now() + data.expires_in * 1000;

    console.log("[FedEx] Authenticated successfully (token valid for " + data.expires_in + "s)");
    return cachedToken!;
}

// ── Track Package ────────────────────────────────────────────────────
export async function trackPackage(trackingNumber: string): Promise<TrackingResult> {
    const token = await authenticate();

    console.log(`[FedEx] Tracking package: ${trackingNumber}`);

    const response = await fetch(`${FEDEX_API_URL}/track/v1/trackingnumbers`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${token}`,
            "X-locale": "en_US",
        },
        body: JSON.stringify({
            includeDetailedScans: false,
            trackingInfo: [
                {
                    trackingNumberInfo: {
                        trackingNumber: trackingNumber,
                    },
                },
            ],
        }),
    });

    if (!response.ok) {
        const body = await response.text();
        throw new Error(`FedEx track failed (${response.status}): ${body}`);
    }

    const data = await response.json();

    // Navigate the FedEx response structure
    const trackResult = data?.output?.completeTrackResults?.[0]?.trackResults?.[0];

    if (!trackResult) {
        throw new Error("No tracking results returned from FedEx");
    }

    const latestStatus = trackResult.latestStatusDetail;
    const statusCode = latestStatus?.code || "UNKNOWN";
    const statusDesc = latestStatus?.description || "No description";

    const isDelivered = statusCode === "DL"; // FedEx "DL" = Delivered

    let deliveryTime: number | undefined;
    if (isDelivered && latestStatus?.scanLocation) {
        // Use actual delivery timestamp if available
        const deliveryDate = trackResult.dateAndTimes?.find(
            (d: any) => d.type === "ACTUAL_DELIVERY"
        );
        if (deliveryDate?.dateTime) {
            deliveryTime = Math.floor(new Date(deliveryDate.dateTime).getTime() / 1000);
        }
    }
    if (!deliveryTime && isDelivered) {
        deliveryTime = Math.floor(Date.now() / 1000);
    }

    const estimatedDelivery = trackResult.dateAndTimes?.find(
        (d: any) => d.type === "ESTIMATED_DELIVERY"
    )?.dateTime;

    const result: TrackingResult = {
        isDelivered,
        deliveryTime,
        rawStatus: statusCode,
        statusDetail: statusDesc,
        estimatedDelivery,
    };

    console.log(`[FedEx] Status: ${statusCode} — ${statusDesc}`);
    console.log(`[FedEx] Delivered: ${isDelivered}`);
    if (estimatedDelivery) console.log(`[FedEx] Estimated delivery: ${estimatedDelivery}`);

    return result;
}
