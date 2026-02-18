/* =========================================================
   /api/battle-solo
   GET /api/battle-solo?id=XXX
   상태 기반 반환 구조
========================================================= */

export const config = {
    runtime: "nodejs"
};

import { withApi } from "../_utils/withApi.js";
import { db } from "../../firebaseAdmin.js";

const STREAM_ERROR_DELAY_MS = 5000; // 🔥 stream_error 후 노출 대기 시간

export default withApi("protected", async (req, res) => {

    try {
        const id = req.query.id;
        if (!id) {
            return res.status(400).json({ error: "id 필요" });
        }

        const onlyLogs = req.query.onlyLogs === "1";

        /* =========================================================
           1️⃣ logs만 요청 (done 상태에서만 사용)
        ========================================================== */
        if (onlyLogs) {

            const logSnap = await db
                .collection("battles")
                .doc(id)
                .collection("logs")
                .orderBy("createdAt", "asc")
                .get();

            const logs = logSnap.docs.map(d => ({
                text: d.data().text || ""
            }));

            return res.status(200).json({
                id,
                logs
            });
        }

        /* =========================================================
           2️⃣ battle 문서 조회
        ========================================================== */

        const snap = await db.collection("battles").doc(id).get();

        if (!snap.exists) {
            return res.status(404).json({ error: "전투 없음" });
        }

        const b = snap.data();
        const status = b.status || "unknown";

        // createdAt ISO 변환
        let createdAtISO = null;
        if (typeof b.createdAt?.toMillis === "function") {
            createdAtISO = new Date(b.createdAt.toMillis()).toISOString();
        }

        /* =========================================================
           3️⃣ queued / processing → logs 조회 안 함
        ========================================================== */
        if (status === "queued" || status === "processing") {

            return res.status(200).json({
                id,
                myId: b.myId,
                enemyId: b.enemyId,
                myName: b.myName,
                enemyName: b.enemyName,
                createdAt: createdAtISO,
                logs: [],
                winnerId: null,
                loserId: null,
                status
            });
        }

        /* =========================================================
           4️⃣ streaming / done / stream_error → logs 조회
        ========================================================== */

        const logSnap = await db
            .collection("battles")
            .doc(id)
            .collection("logs")
            .orderBy("createdAt", "asc")
            .get();

        const logs = logSnap.docs.map(d => ({
            text: d.data().text || ""
        }));

        const now = Date.now();
        const finishedAtMs =
            typeof b.finishedAt?.toMillis === "function"
                ? b.finishedAt.toMillis()
                : null;

        let winnerId = null;
        let loserId = null;
        let retryAfterMs = null;

        /* ============================
           done
        ============================ */
        if (status === "done") {
            winnerId = b.winnerId || null;
            loserId = b.loserId || null;
        }

        /* ============================
           stream_error
        ============================ */
        if (status === "stream_error") {

            if (finishedAtMs) {

                const elapsed = now - finishedAtMs;
                const remain = STREAM_ERROR_DELAY_MS - elapsed;

                if (remain > 0) {
                    retryAfterMs = remain + 500; // 🔥 0.5초 버퍼 포함
                } else {
                    winnerId = b.winnerId || null;
                    loserId = b.loserId || null;
                }
            }
        }

        /* ============================
           error (즉시 종료)
        ============================ */
        if (status === "error") {
            return res.status(200).json({
                id,
                myId: b.myId,
                enemyId: b.enemyId,
                myName: b.myName,
                enemyName: b.enemyName,
                createdAt: createdAtISO,
                logs: [],
                winnerId: null,
                loserId: null,
                status: "error"
            });
        }

        return res.status(200).json({
            id,
            myId: b.myId,
            enemyId: b.enemyId,
            myName: b.myName,
            enemyName: b.enemyName,
            createdAt: createdAtISO,
            logs,
            winnerId,
            loserId,
            status,
            retryAfterMs
        });

    } catch (err) {
        console.error("BATTLE-SOLO ERROR:", err);
        return res.status(500).json({ error: "서버 오류" });
    }
});
