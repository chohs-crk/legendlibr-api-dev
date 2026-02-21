/* =========================================================
   /api/base/battles-list
   GET /api/battles-list?charId=XXX&page=1&pageSize=5
   🔥 finished 여부와 관계없이 조회
   🔥 화이트리스트 데이터만 반환
========================================================= */

export const config = {
    runtime: "nodejs"
};

import { withApi } from "../_utils/withApi.js";
import { db } from "../../firebaseAdmin.js";
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
export default withApi("protected", async (req, res, { uid }) => {

    try {
        const charId = req.query.charId;
        const page = parseInt(req.query.page || "1");
        const pageSize = parseInt(req.query.pageSize || "5");

        if (!charId) {
            return res.status(400).json({ error: "charId 필요" });
        }

        /* =========================================================
           캐릭터 존재 확인
        ========================================================== */
        const charSnap = await db.collection("characters").doc(charId).get();

        if (!charSnap.exists) {
            return res.status(404).json({ error: "캐릭터 없음" });
        }

        /* =========================================================
           battles 조회 (공격자 + 수비자 병합)
        ========================================================== */
        const mySnap = await db
            .collection("battles")
            .where("myId", "==", charId)
            .orderBy("createdAt", "desc")
            .get();

        const enemySnap = await db
            .collection("battles")
            .where("enemyId", "==", charId)
            .orderBy("createdAt", "desc")
            .get();

        let merged = [
            ...mySnap.docs.map(d => ({ id: d.id, ...d.data() })),
            ...enemySnap.docs.map(d => ({ id: d.id, ...d.data() }))
        ];

        // 🔥 finished 필터 제거 (진행 중 전투도 포함)
        merged.sort((a, b) => {
            const aTime = a.createdAt?.seconds || 0;
            const bTime = b.createdAt?.seconds || 0;
            return bTime - aTime;
        });

        /* =========================================================
           페이지네이션
        ========================================================== */
        const total = merged.length;
        const start = (page - 1) * pageSize;
        const end = start + pageSize;

        const pageItems = merged.slice(start, end);
        const hasMore = end < total;

        /* =========================================================
           화이트리스트 변환
        ========================================================== */
        const battles = await Promise.all(
            pageItems.map(async (b) => {

                const myImage = b.myImage || null;
                const enemyImage = b.enemyImage || null;




             

                const preview = typeof b.previewText === "string"
                    ? b.previewText
                    : "";
                const createdAtMs =
                    typeof b.createdAt?.toMillis === "function"
                        ? b.createdAt.toMillis()
                        : (typeof b.createdAt?.seconds === "number" ? b.createdAt.seconds * 1000 : null);

                const createdAtISO = createdAtMs ? new Date(createdAtMs).toISOString() : null;

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
                let myEloDelta = null;
                let enemyEloDelta = null;

                if (winnerId && loserId) {

                    const now = Date.now();
                    const finishedAtMs =
                        typeof b.finishedAt?.toMillis === "function"
                            ? b.finishedAt.toMillis()
                            : null;

                    const within2Min =
                        finishedAtMs && (now - finishedAtMs <= 120000);

                    if (b.elo) {
                        // ✅ 정식 elo 존재 → 항상 사용
                        if (winnerId === b.myId) {
                            myEloDelta = b.elo.winnerDelta;
                            enemyEloDelta = b.elo.loserDelta;
                        } else {
                            myEloDelta = b.elo.loserDelta;
                            enemyEloDelta = b.elo.winnerDelta;
                        }

                    } else if (within2Min) {
                        // ✅ 2분 이내만 추정치 허용

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

                    } else {
                        // ❌ 2분 초과 → 아예 내려주지 않음
                        myEloDelta = null;
                        enemyEloDelta = null;
                    }
                }


                return {
                    id: b.id,
                    myId: b.myId,
                    enemyId: b.enemyId,
                    myName: b.myName,
                    enemyName: b.enemyName,

                    myImage,
                    enemyImage,

                    myEloDelta,
                    enemyEloDelta,

                    createdAt: createdAtISO,
                    logs: preview ? [{ text: preview }] : [],
                    winnerId,
                    loserId,
                    finished: b.finished === true,
                    status: b.status || "unknown"
                };



            })
        );

        return res.status(200).json({
            battles,
            totalCount: total,
            hasMore
        });

    } catch (err) {
        console.error("BATTLES-LIST ERROR:", err);
        return res.status(500).json({ error: "서버 오류" });
    }
});
// 🔥 