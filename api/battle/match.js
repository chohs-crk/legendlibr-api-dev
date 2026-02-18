/* api/battle/match.js */
import { withApi } from "../_utils/withApi.js";
import { db } from "../../firebaseAdmin.js";
import {
    getBattleSession,
    setBattleSession
} from "../base/sessionstore.js";

export default withApi("protected", async (req, res, { uid }) => {
    if (req.method !== "POST") {
        return res.status(405).json({ error: "METHOD_NOT_ALLOWED" });
    }

    const { charId } = req.body;
    if (!charId) {
        return res.status(400).json({ error: "NO_CHAR_ID" });
    }

    /* =========================
       0️⃣ 기존 battle 세션 재사용
    ========================= */
    const existingBattle = await getBattleSession(uid);

    if (existingBattle?.myChar?.id === charId) {
        console.log("========== [BATTLE SESSION REUSE] ==========");
        console.log("uid:", uid);
        console.log(JSON.stringify(existingBattle, null, 2));
        console.log("============================================");

        return res.json({
            matched: true,
            myChar: {
                id: existingBattle.myChar.id,
                displayRawName: existingBattle.myChar.displayRawName
            },
            enemyChar: {
                id: existingBattle.enemyChar.id,
                displayRawName: existingBattle.enemyChar.displayRawName
            }
        });
    }

    /* =========================
       1️⃣ 내 캐릭터 검증
    ========================= */
    const myRef = db.collection("characters").doc(charId);
    const mySnap = await myRef.get();

    if (!mySnap.exists) {
        return res.status(404).json({ error: "CHAR_NOT_FOUND" });
    }

    const myChar = mySnap.data();
    if (myChar.uid !== uid) {
        return res.status(403).json({ error: "NOT_YOUR_CHAR" });
    }

    /* =========================
       2️⃣ 기존 enemyId 재사용
    ========================= */
    let enemySnap = null;

    if (myChar.enemyId) {
        const ref = db.collection("characters").doc(myChar.enemyId);
        const snap = await ref.get();

        if (snap.exists) {
            enemySnap = snap;
        } else {
            // 🔥 존재하지 않는 enemyId 정리
            await myRef.update({ enemyId: null });
        }
    }


    /* =========================
       3️⃣ 매칭 대상 탐색
    ========================= */
    if (!enemySnap) {
        const myScore =
            typeof myChar.rankScore === "number"
                ? myChar.rankScore
                : 1000;

        let range = 100;
        let candidates = [];

        while (range <= 1000 && candidates.length < 3) {
            const snap = await db
                .collection("characters")
                .where("rankScore", ">=", myScore - range)
                .where("rankScore", "<=", myScore + range)
                .get();

            candidates = snap.docs.filter(d =>
                d.id !== charId
            );

            range += 100;
        }

        if (candidates.length === 0) {
            return res.json({
                matched: false,
                reason: "NO_MATCH"
            });
        }

        enemySnap =
            candidates[Math.floor(Math.random() * candidates.length)];

        await myRef.update({
            enemyId: enemySnap.id,
            lastMatchedAt: Date.now()
        });
    }

    const enemyChar = enemySnap.data();

    /* =========================
       4️⃣ battle 세션 생성
    ========================= */
    const battleSession = {
        myChar: {
            id: mySnap.id,
            ...myChar
        },
        enemyChar: {
            id: enemySnap.id,
            ...enemyChar
        },
        turn: 1,
        log: [],
        startedAt: Date.now()
    };

    await setBattleSession(uid, battleSession);

    /* =========================
       🔥 세션 전체 로그 출력
    ========================= */
    console.log("========== [BATTLE SESSION CREATED] ==========");
    console.log("uid:", uid);
    console.log(JSON.stringify(battleSession, null, 2));
    console.log("==============================================");

    /* =========================
       5️⃣ 프론트 응답 (최소 정보)
    ========================= */
    return res.json({
        matched: true,
        myChar: {
            id: mySnap.id,
            displayRawName: myChar.displayRawName
        },
        enemyChar: {
            id: enemySnap.id,
            displayRawName: enemyChar.displayRawName
        }
    });
});
