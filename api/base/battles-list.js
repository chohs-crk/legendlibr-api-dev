/* =========================================================
   /api/battles-list
   GET /api/battles?charId=XXX&page=1&pageSize=5
   페이지네이션 포함
========================================================= */

export const config = {
    runtime: "nodejs"
};
import { withApi } from "../_utils/withApi.js";
import { db } from "../../firebaseAdmin.js";


/* --------------------------
   공통 CORS
--------------------------- */


/* --------------------------
   세션 파싱
--------------------------- */


/* =========================================================
   메인 핸들러
========================================================= */
export default withApi("protected", async (req, res, { uid }) => {
   

    try {
       

        /* --------------------------
           QUERY PARAMS
        -------------------------- */
        const charId = req.query.charId;
        const page = parseInt(req.query.page || "1");
        const pageSize = parseInt(req.query.pageSize || "5");

        if (!charId) {
            return res.status(400).json({ error: "charId 필요" });
        }

        /* =========================================================
           캐릭터 권한 인증
        ========================================================== */
        const charSnap = await db.collection("characters").doc(charId).get();

        if (!charSnap.exists) {
            return res.status(404).json({ error: "캐릭터 없음" });
        }

      

        /* =========================================================
           battles 조회 (myId / enemyId 두 조건 병합)
        ========================================================== */

        // 1) 내가 공격자인 전투
        const mySnap = await db
            .collection("battles")
            .where("myId", "==", charId)
            .orderBy("createdAt", "desc")
            .get();

        // 2) 내가 수비자인 전투
        const enemySnap = await db
            .collection("battles")
            .where("enemyId", "==", charId)
            .orderBy("createdAt", "desc")
            .get();

        // 3) 두 목록 합치기 → 최신순으로 재정렬
        let merged = [
            ...mySnap.docs.map(d => ({ id: d.id, ...d.data() })),
            ...enemySnap.docs.map(d => ({ id: d.id, ...d.data() }))
        ];

        // ✅ finished === false 전투 제거
        merged = merged.filter(b => b.finished === true);

        merged.sort((a, b) => b.createdAt - a.createdAt);


        /* =========================================================
           페이지네이션 계산
        ========================================================== */
        const total = merged.length;
        const start = (page - 1) * pageSize;
        const end = start + pageSize;

        const pageItems = merged.slice(start, end);
        const hasMore = end < total;

        /* =========================================================
           프론트에서 기대하는 구조로 통일 변환
        ========================================================== */
        const battles = await Promise.all(
            pageItems.map(async (b) => {

                // 🔹 상대 캐릭터 문서 조회
                let enemyImage = null;

                try {
                    const enemySnap = await db
                        .collection("characters")
                        .doc(b.enemyId)
                        .get();

                    if (enemySnap.exists) {
                        enemyImage = enemySnap.data().image || null;
                    }
                } catch (e) {
                    enemyImage = null;
                }

                return {
                    id: b.id,
                    myId: b.myId,
                    enemyId: b.enemyId,

                    myName: b.myName,
                    enemyName: b.enemyName,

                    // ✅ 핵심 추가
                    enemyImage,   // { type, key?, url? }

                    result: b.result,
                    createdAt: b.createdAt,
                    prologue: b.baseData?.prologue || "",
                    logs: b.logs || []
                };
            })
        );



        return res.status(200).json({
            battles,
            totalCount: total,
            hasMore
        });


    } catch (err) {
        console.error("BATTLES API ERROR:", err);
        return res.status(500).json({ error: "서버 오류" });
    }
});
