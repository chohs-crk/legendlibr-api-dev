// api/battle-status.js
export const config = {
    runtime: "nodejs"
};
import { db } from "../../firebaseAdmin.js";



// ✅ CORS
function applyCors(req, res) {
    res.setHeader("Access-Control-Allow-Origin", req.headers.origin || "*");
    res.setHeader("Access-Control-Allow-Credentials", "true");
    res.setHeader("Access-Control-Allow-Methods", "POST,OPTIONS");
    res.setHeader(
        "Access-Control-Allow-Headers",
        "Content-Type, Authorization"
    );
}

export default async function handler(req, res) {
    applyCors(req, res);

    if (req.method === "OPTIONS") return res.status(204).end();
    if (req.method !== "POST") {
        return res.status(405).json({ ok: false, error: "POST_ONLY" });
    }

    try {
        const { battleId } = req.body || {};

        if (!battleId) {
            return res.status(400).json({
                ok: false,
                error: "BATTLE_ID_REQUIRED"
            });
        }

        const battleRef = db.collection("battles").doc(battleId);

        const TIMEOUT = 60000;   // ✅ 최대 60초 대기
        const INTERVAL = 1000;  // ✅ 1초마다 DB 체크
        const startedAt = Date.now();

        console.log("⏳ [LONG POLLING START]", battleId);

        while (true) {
            const snap = await battleRef.get();

            if (snap.exists) {
                const data = snap.data();

                if (data.aiReady === true) {
                    console.log("✅ [AI READY DETECTED]", battleId);
                    return res.json({
                        ok: true,
                        ready: true
                    });
                }

                if (data.finished === true) {
                    console.log("⚠️ [BATTLE FINISHED BEFORE READY]", battleId);
                    return res.json({
                        ok: true,
                        ready: false,
                        finished: true
                    });
                }
            }

            // ✅ 타임아웃 처리
            if (Date.now() - startedAt > TIMEOUT) {
                console.log("⏱️ [LONG POLLING TIMEOUT]", battleId);
                return res.json({
                    ok: true,
                    ready: false,
                    timeout: true
                });
            }

            // ✅ 서버 내부에서만 1초 대기
            await new Promise(r => setTimeout(r, INTERVAL));
        }

    } catch (err) {
        console.error("❌ battle-status LONG POLLING ERROR:", err);
        return res.status(500).json({
            ok: false,
            error: "SERVER_ERROR"
        });
    }
}
