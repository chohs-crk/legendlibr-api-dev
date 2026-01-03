// /api/_utils/withApi.js
import { setCors } from "./setCors.js";
import { rateLimit } from "./rateLimit.js";
import { auth } from "../../firebaseAdmin.js";

const RATE = {
    soft: { windowMs: 60_000, limit: 120 },
    normal: { windowMs: 60_000, limit: 60 },
    hard: { windowMs: 60_000, limit: 10 },
};

function getPolicy(type) {
    if (type === "expensive") return RATE.hard;
    if (type === "protected") return RATE.normal;
    // public / auth
    return RATE.soft;
}

function getSessionCookie(req) {
    const cookie = req.headers.cookie || "";
    return (
        cookie
            .split(";")
            .find((v) => v.trim().startsWith("session="))
            ?.split("=")[1] || null
    );
}

async function requireAuth(req, res) {
    const token = getSessionCookie(req);
    if (!token) {
        res.status(401).json({ ok: false, error: "NO_SESSION" });
        return null;
    }
    try {
        const decoded = await auth.verifySessionCookie(token, true);
        return decoded.uid;
    } catch {
        res.status(401).json({ ok: false, error: "INVALID_SESSION" });
        return null;
    }
}

export function withApi(type, handler) {
    return async function (req, res) {
        // 1) CORS
        if (!setCors(req, res)) return;

        // 2) 기본 RateLimit (모든 API)
        const policy = getPolicy(type);
        if (!rateLimit(req, res, policy)) return;

        const ctx = {};

        // 3) Auth (유형별)
        if (type !== "public" && type !== "auth") {
            const uid = await requireAuth(req, res);
            if (!uid) return;

            ctx.uid = uid;

            // 4) uid 기준 2차 RateLimit(권장)
            // - 계정 단위 폭주 막음
            if (!rateLimit(req, res, policy, uid)) return;
        }

        return handler(req, res, ctx);
    };
}
