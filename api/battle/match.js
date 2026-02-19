/* api/battle/match.js */
import { withApi } from "../_utils/withApi.js";
import { db } from "../../firebaseAdmin.js";

export default withApi("protected", async (req, res, { uid }) => {
    if (req.method !== "POST") {
        return res.status(405).json({ error: "METHOD_NOT_ALLOWED" });
    }

    const { charId } = req.body;
    if (!charId) {
        return res.status(400).json({ error: "NO_CHAR_ID" });
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
       2️⃣ 기존 enemyId 재사용 시도
    ========================= */
    let enemySnap = null;

    if (myChar.enemyId) {
        const ref = db.collection("characters").doc(myChar.enemyId);
        const snap = await ref.get();

        if (snap.exists) {
            enemySnap = snap;
        } else {
            // 🔥 삭제된 상대 정리
            await myRef.update({ enemyId: null });
        }
    }

    /* =========================
       3️⃣ 매칭 탐색
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
                .limit(20) // 🔥 과도한 read 방지
                .get();

            candidates = snap.docs.filter(d => d.id !== charId);

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
       4️⃣ 응답
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
