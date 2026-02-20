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
function calcEloDelta(winnerElo, loserElo) {
    const BASE_K = 15;
    const MAX_K = 20;
    const DIFF_CAP = 200;

    const diff = Math.min(Math.abs(winnerElo - loserElo), DIFF_CAP);

    const baseDelta = Math.round(
        BASE_K + (diff / DIFF_CAP) * (MAX_K - BASE_K)
    );

    let bonusRate = 0;
    if (winnerElo <= 1500) bonusRate = 0.5;
    else if (winnerElo <= 2000) bonusRate = 0.3;
    else if (winnerElo <= 2500) bonusRate = 0.2;
    else if (winnerElo <= 3000) bonusRate = 0.1;

    const win = Math.round(baseDelta * (1 + bonusRate));
    const lose = baseDelta;

    return { win, lose };
}
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

        const myImage = b.myImage || null;
        const enemyImage = b.enemyImage || null;




     

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
                myImage,
                enemyImage,
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
        let myEloDelta = null;
        let enemyEloDelta = null;

        if (winnerId && loserId) {

            if (b.elo) {
                // 🔥 이미 적용됨 → DB read 없음
                if (winnerId === b.myId) {
                    myEloDelta = b.elo.winnerDelta;
                    enemyEloDelta = b.elo.loserDelta;
                } else {
                    myEloDelta = b.elo.loserDelta;
                    enemyEloDelta = b.elo.winnerDelta;
                }

            } else {
                // 🔥 아직 적용 안 됨 → 이때만 read
                let myRank = 1000;
                let enemyRank = 1000;

                const [mySnap, enemySnap] = await Promise.all([
                    db.collection("characters").doc(b.myId).get(),
                    db.collection("characters").doc(b.enemyId).get()
                ]);

                if (mySnap.exists && typeof mySnap.data().rankScore === "number") {
                    myRank = mySnap.data().rankScore;
                }

                if (enemySnap.exists && typeof enemySnap.data().rankScore === "number") {
                    enemyRank = enemySnap.data().rankScore;
                }

                const { win, lose } = calcEloDelta(myRank, enemyRank);

                if (winnerId === b.myId) {
                    myEloDelta = win;
                    enemyEloDelta = -lose;
                } else {
                    myEloDelta = -lose;
                    enemyEloDelta = win;
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
                myImage,
                enemyImage,
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

            myImage,
            enemyImage,

            myEloDelta,
            enemyEloDelta,

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
// 🔥 