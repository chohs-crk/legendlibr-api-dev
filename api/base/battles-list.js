/* =========================================================
   /api/battles-list
   GET /api/battles-list?charId=XXX&page=1&pageSize=5
   🔥 finished 여부와 관계없이 조회
   🔥 화이트리스트 데이터만 반환
========================================================= */

export const config = {
    runtime: "nodejs"
};

import { withApi } from "../_utils/withApi.js";
import { db } from "../../firebaseAdmin.js";

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

                let enemyImage = null;

                try {
                    const enemySnap = await db
                        .collection("characters")
                        .doc(b.enemyId)
                        .get();

                    if (enemySnap.exists) {
                        enemyImage = enemySnap.data().image || null;
                    }
                } catch {
                    enemyImage = null;
                }


             

                const preview = typeof b.previewText === "string"
                    ? b.previewText
                    : "";

                return {
                    id: b.id,
                    myId: b.myId,
                    enemyId: b.enemyId,
                    myName: b.myName,
                    enemyName: b.enemyName,
                    enemyImage, // 🔥 추가
                    result: b.result || null,
                    createdAt: b.createdAt || null,

                    // 🔥 preview만 logs 배열로 변환
                    logs: preview ? [{ text: preview }] : [],

                    winnerId: b.winnerId || null,
                    loserId: b.loserId || null,
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
