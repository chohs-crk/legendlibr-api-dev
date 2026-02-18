/* =========================================================
   /api/battle-solo
   GET /api/battle-solo?id=XXX
   🔥 finished 여부 상관없이 조회
   🔥 화이트리스트 구조 반환
========================================================= */

export const config = {
    runtime: "nodejs"
};

import { withApi } from "../_utils/withApi.js";
import { db } from "../../firebaseAdmin.js";

export default withApi("protected", async (req, res) => {

    try {
        const id = req.query.id;
      
        if (!id) {
            return res.status(400).json({ error: "id 필요" });
        }

        const onlyLogs = req.query.onlyLogs === "1";

        if (onlyLogs) {
            let logs = [];

            const logSnap = await db
                .collection("battles")
                .doc(id)
                .collection("logs")
                .orderBy("createdAt", "asc")
                .get();

            logs = logSnap.docs.map(d => ({
                text: d.data().text || ""
            }));

            return res.status(200).json({
                id,
                logs
            });
        }

        const snap = await db.collection("battles").doc(id).get();


        if (!snap.exists) {
            return res.status(404).json({ error: "전투 없음" });
        }

        const b = snap.data();

        // 🔥 finished 체크 제거 (진행 중도 조회 가능)

        /* =========================================================
           서브컬렉션 logs 조회
        ========================================================== */
        let logs = [];

        try {
            const logSnap = await db
                .collection("battles")
                .doc(id)
                .collection("logs")
                .orderBy("createdAt", "asc")
                .get();

            logs = logSnap.docs.map(d => ({
                text: d.data().text || ""
            }));
        } catch {
            logs = [];
        }
        const now = Date.now();
        const finishedAtMs =
            typeof b.finishedAt?.toMillis === "function"
                ? b.finishedAt.toMillis()
                : null;

        let winnerId = null;
        let loserId = null;

        const isDone = b.status === "done";
        const isStreamError = b.status === "stream_error";

        const passed10Sec =
            finishedAtMs && (now - finishedAtMs >= 10000);

        if (isDone || (isStreamError && passed10Sec)) {
            winnerId = b.winnerId || null;
            loserId = b.loserId || null;
        }

        return res.status(200).json({
            id,
            myId: b.myId,
            enemyId: b.enemyId,
            myName: b.myName,
            enemyName: b.enemyName,
           
            createdAt: b.createdAt || null,
            logs,
            winnerId,
            loserId,
            status: b.status || "unknown"
        });

    } catch (err) {
        console.error("BATTLE-SOLO ERROR:", err);
        return res.status(500).json({ error: "서버 오류" });
    }
});
