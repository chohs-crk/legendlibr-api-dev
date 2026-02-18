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

        const snap = await db.collection("battles").doc(id).get();

        if (!snap.exists) {
            return res.status(404).json({ error: "전투 없음" });
        }

        const b = snap.data();

        if (!b.finished) {
            return res.status(400).json({ error: "완료되지 않은 전투" });
        }

        // 상대 이미지 조회
        let enemyImage = null;

        try {
            const enemySnap = await db
                .collection("characters")
                .doc(b.enemyId)
                .get();

            if (enemySnap.exists) {
                enemyImage = enemySnap.data().image || null;
            }
        } catch { }

        return res.status(200).json({
            id,
            myId: b.myId,
            enemyId: b.enemyId,
            myName: b.myName,
            enemyName: b.enemyName,
            enemyImage,
            result: b.result,
            createdAt: b.createdAt,
            prologue: b.baseData?.prologue || "",
            logs: b.logs || []
        });

    } catch (err) {
        console.error("BATTLE API ERROR:", err);
        return res.status(500).json({ error: "서버 오류" });
    }
});
