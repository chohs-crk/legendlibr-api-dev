import { withApi } from "../_utils/withApi.js";
import admin from "firebase-admin";
import { db } from "../../firebaseAdmin.js";
export default withApi("protected", async (req, res, { uid }) => {
    const { id, image } = req.body;

    if (!id || !image || !image.type || !image.key) {
        return res.status(400).json({ ok: false, error: "INVALID_PARAMS" });
    }
    try {
        /* =========================
           1️⃣ 세션 인증
        ========================= */
        const sessionCookie = req.cookies?.session;
        if (!sessionCookie) {
            return res.status(401).json({ ok: false, error: "NO_SESSION" });
        }

        const decoded = await admin.auth().verifySessionCookie(sessionCookie, true);
        const uid = decoded.uid;

        /* =========================
           2️⃣ 입력값
        ========================= */
        const { id, image } = req.body;

        if (!id || !image || !image.type || !image.key) {
            return res.status(400).json({
                ok: false,
                error: "INVALID_PARAMS"
            });
        }

        /* =========================
   3️⃣ 캐릭터 소유자 검증
========================= */
        const ref = db.collection("characters").doc(id);
        const snap = await ref.get();

        if (!snap.exists) {
            return res.status(404).json({
                ok: false,
                error: "CHAR_NOT_FOUND"
            });
        }

        const char = snap.data();

        if (char.uid !== uid) {
            return res.status(403).json({
                ok: false,
                error: "NOT_OWNER"
            });
        }

        /* =========================
           🔒 AI URL 검증 추가
        ========================= */
        // AI 이미지 타입이면 — 반드시 aiImages 배열 내 url과 매칭되어야 함
        if (image.type === "ai") {
            const exists = Array.isArray(char.aiImages) &&
                char.aiImages.some(ai => ai.url === image.url);

            if (!exists) {
                return res.status(403).json({
                    ok: false,
                    error: "INVALID_AI_URL"
                });
            }
        }

        /* =========================
           4️⃣ image 필드만 업데이트
        ========================= */
        await ref.update({
            image: {
                type: image.type,
                key: image.key,
                url: image.url || ""
            }
        });


        return res.json({ ok: true });

    } catch (err) {
        console.error("characters-image ERROR:", err);
        return res.status(500).json({
            ok: false,
            error: "SERVER_ERROR"
        });
    }
});