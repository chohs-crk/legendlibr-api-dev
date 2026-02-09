// api/battle/start.js
export const config = { runtime: "nodejs" };

import { withApi } from "../_utils/withApi.js";
import { db } from "../../firebaseAdmin.js";

export default withApi("battle_start", async (req, res, { uid }) => {
    if (req.method !== "POST") {
        return res.status(405).json({ ok: false, error: "POST_ONLY" });
    }

    try {
        const { myCharId } = req.body || {};

        if (!myCharId) {
            return res.status(400).json({ ok: false, error: "NO_MY_CHAR_ID" });
        }

        // 1) 내 캐릭터 검증
        const mySnap = await db.collection("characters").doc(myCharId).get();
        if (!mySnap.exists) {
            return res.status(404).json({ ok: false, error: "MY_CHAR_NOT_FOUND" });
        }

        const my = mySnap.data();
        if (my.uid !== uid) {
            return res.status(403).json({ ok: false, error: "NOT_OWNER" });
        }

        // 2) 캐릭터 문서에서 enemyId 읽기
        const enemyId = my.enemyId;
        if (!enemyId) {
            return res.status(400).json({ ok: false, error: "NO_ENEMY_FOUND" });
        }

        // 3) 상대 캐릭터 검증
        const enemySnap = await db.collection("characters").doc(enemyId).get();
        if (!enemySnap.exists) {
            return res.status(404).json({ ok: false, error: "ENEMY_NOT_FOUND" });
        }
        const enemy = enemySnap.data();

        // 4) battle 문서 생성
        const battleRef = await db.collection("battles").add({
            userId: uid,
            myId: myCharId,
            enemyId,
            myName: my.displayRawName || "",
            enemyName: enemy.displayRawName || "",
            status: "queued",
            finished: false,
            eloApplied: false,
            createdAt: new Date(),
            logs: []
        });

        // ⭐ 매칭을 배틀 시작 직후 즉시 초기화
        await db.collection("characters").doc(myCharId).update({
            enemyId: null
        });

        // ⭐ Redis battle session 초기화 (기존 전투 세션 제거)
        import { deleteBattleSession } from "../base/sessionstore.js";
        await deleteBattleSession(uid);


        return res.status(200).json({
            ok: true,
            battleId: battleRef.id
        });


    } catch (e) {
        console.error("battle/start error:", e);
        return res.status(500).json({ ok: false, error: "SERVER_ERROR" });
    }
});
