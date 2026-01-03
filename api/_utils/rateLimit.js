// /api/_utils/rateLimit.js
const rateMap = new Map();

export function rateLimit(req, res, policy, keyOverride = null) {
    const now = Date.now();

    const ip =
        req.headers["x-forwarded-for"] ||
        req.socket?.remoteAddress ||
        "unknown";

    const key = keyOverride || ip;

    const windowMs = policy?.windowMs ?? 60_000;
    const limit = policy?.limit ?? 60;

    if (!rateMap.has(key)) rateMap.set(key, []);

    const timestamps = rateMap.get(key).filter((t) => now - t < windowMs);
    timestamps.push(now);
    rateMap.set(key, timestamps);

    if (timestamps.length > limit) {
        res.status(429).json({
            ok: false,
            error: "RATE_LIMIT",
            retryAfterMs: windowMs,
        });
        return false;
    }

    return true;
}

