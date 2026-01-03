// api/battle.js
export const config = {
    runtime: "nodejs"
};
import { auth, db } from "../../firebaseAdmin.js";



import admin from "firebase-admin";
import fetch from "node-fetch";

// ==============================
// ✅ 공통 CORS
// ==============================
function applyCors(req, res) {
    const origin = req.headers.origin || "*";
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Access-Control-Allow-Credentials", "true");
    res.setHeader("Access-Control-Allow-Methods", "POST,OPTIONS");
    res.setHeader(
        "Access-Control-Allow-Headers",
        "Content-Type, Authorization"
    );
}
function getSessionCookie(req) {
    const cookie = req.headers.cookie || "";
    const item = cookie.split(";").find(v => v.trim().startsWith("session="));
    return item ? item.split("=")[1] : null;
}

async function requireSession(req, res) {
    const session = getSessionCookie(req);
    if (!session) {
        res.status(401).json({ ok: false, error: "NO_SESSION" });
        throw new Error("NO_SESSION");
    }

    try {
        const decoded = await admin.auth().verifySessionCookie(session, true);
        return decoded.uid;
    } catch (err) {
        res.status(401).json({ ok: false, error: "INVALID_SESSION" });
        throw new Error("INVALID_SESSION");
    }
}

// ==============================
// ✅ 메인 핸들러
// ==============================
export default async function handler(req, res) {
    applyCors(req, res);

    if (req.method === "OPTIONS") return res.status(204).end();
    if (req.method !== "POST") {
        return res.status(405).json({ ok: false, error: "POST_ONLY" });
    }

    try {
        // 🔥 세션 인증
        const uid = await requireSession(req, res);


        const { action, myId } = req.body || {};

        // ====================================================
        // ✅ 0️⃣ 기존 매칭 복원
        // ====================================================
        if (action === "restore") {
            if (!myId) {
                return res.json({ ok: true, battleId: null });
            }

            const snap = await db.collection("battles")
                .where("myId", "==", myId)
                .where("finished", "==", false)
                .limit(1)
                .get();

            if (snap.empty) {
                return res.json({ ok: true, battleId: null });
            }

            const doc = snap.docs[0];
            const data = doc.data();

            return res.json({
                ok: true,
                battleId: doc.id,
                enemy: {
                    id: data.enemyId,
                    name: data.enemyName,
                    battleScore: data.enemyScore ?? 1000
                }
            });
        }

        // ====================================================
        // ✅ 1️⃣ 전투 준비 (내 캐릭터 목록)
        // ====================================================
        if (action === "prepare") {
            const snap = await db
                .collection("characters")
                .where("uid", "==", uid)
                .orderBy("createdAt", "desc")
                .get();

            const myCharacters = [];
            snap.forEach(doc => {
                const d = doc.data();
                myCharacters.push({
                    id: doc.id,
                    name: d.displayRawName || d.name,
                    battleScore: d.battleScore ?? 1000
                });
            });

            const selectedMyId = myCharacters[0]?.id || null;

            return res.json({
                ok: true,
                myCharacters,
                selectedMyId,
                enemy: null
            });
        }

        // ====================================================
        // ✅ 2️⃣ 매칭 생성 또는 재사용
        // ====================================================
        if (action === "matchOrCreate") {
            if (!myId) {
                return res.status(400).json({ ok: false, error: "MY_ID_REQUIRED" });
            }

            // ✅ 2-1. 기존 매칭 존재 여부 확인
            const existingSnap = await db.collection("battles")
                .where("myId", "==", myId)
                .where("finished", "==", false)
                .limit(1)
                .get();

            if (!existingSnap.empty) {
                const doc = existingSnap.docs[0];
                const data = doc.data();

                // ✅ 상대 캐릭터 존재 여부 재검증
                const enemySnap = await db.collection("characters").doc(data.enemyId).get();

                const createdAt = data.createdAt?.toDate?.() || null;
                const now = Date.now();
                const isTimeout =
                    !data.aiReady &&
                    createdAt &&
                    now - createdAt.getTime() > 2 * 60 * 1000; // ✅ 2분

                // ❌ 상대 삭제 or AI 타임아웃 → 기존 매칭 파기
                if (!enemySnap.exists || isTimeout) {
                    await db.collection("battles").doc(doc.id).update({
                        finished: true,
                        finishedReason: !enemySnap.exists
                            ? "ENEMY_DELETED"
                            : "AI_TIMEOUT",
                        finishedAt: admin.firestore.FieldValue.serverTimestamp()
                    });
                } else {
                    // ✅ 정상 재사용
                    return res.json({
                        ok: true,
                        reused: true,
                        battleId: doc.id,
                        enemy: {
                            id: data.enemyId,
                            name: data.enemyName,
                            battleScore: data.enemyScore ?? 1000
                        }
                    });
                }
            }

            // ====================================================
            // ✅ 2-2. 새 매칭 생성
            // ====================================================
            const mySnap = await db.collection("characters").doc(myId).get();
            if (!mySnap.exists) {
                return res.status(404).json({ ok: false, error: "MY_CHARACTER_NOT_FOUND" });
            }

            const myData = mySnap.data();
            const myScore = myData.battleScore ?? 1000;

            const allSnap = await db.collection("characters").get();
            const all = [];
            allSnap.forEach(doc => {
                if (doc.id !== myId) {
                    all.push({ id: doc.id, ...doc.data() });
                }
            });

            if (all.length === 0) {
                return res.json({ ok: true, enemy: null });
            }

            let range = 100;
            let candidates = [];

            while (true) {
                const low = myScore - range;
                const high = myScore + range;

                candidates = all.filter(c => {
                    const s = c.battleScore ?? 1000;
                    return s >= low && s <= high;
                });

                if (candidates.length >= 3 || range > 5000) break;
                range += 100;
            }

            if (candidates.length === 0) candidates = all;

            const chosen = candidates[Math.floor(Math.random() * candidates.length)];

            // ✅ 2-3. battles 문서 생성
            const battleId = "b_" + Math.random().toString(36).slice(2);

            await db.collection("battles").doc(battleId).set({
                battleId,
                uid,
                myId,
                enemyId: chosen.id,

                myName: myData.displayRawName || myData.name,
                enemyName: chosen.displayRawName || chosen.name,
                enemyScore: chosen.battleScore ?? 1000,

                baseData: null,
                aiReady: false,
                currentTurn: 1,
                finished: false,

                createdAt: admin.firestore.FieldValue.serverTimestamp()
            });

           
            // ====================================================
            // ✅ AI INIT "전송 보장" 버전 (프론트 반환은 그대로 빠름)
            try {
                console.log("🚀 AI INIT 요청 시작:", battleId);

                const controller = new AbortController();
                const timeout = setTimeout(() => controller.abort(), 8000);

                await fetch("https://ai-proxy2.vercel.app/api/battle/ai-battle-init", {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json"
                    },
                    body: JSON.stringify({ battleId }),
                    signal: controller.signal
                });

                clearTimeout(timeout);
                console.log("✅ AI INIT 요청 전달 완료:", battleId);

            } catch (err) {
                console.error("❌ AI INIT 요청 전달 실패:", battleId, err);
            }

            // ✅ 프론트에는 매칭 정보만 즉시 반환
            return res.json({
                ok: true,
                reused: false,
                battleId,
                enemy: {
                    id: chosen.id,
                    name: chosen.displayRawName || chosen.name,
                    battleScore: chosen.battleScore ?? 1000
                }
            });
          
        }

        // ====================================================
        // ✅ 알 수 없는 action
        // ====================================================
        return res.status(400).json({
            ok: false,
            error: "UNKNOWN_ACTION"
        });

    } catch (err) {
        console.error("❌ battle.js ERROR:", err);
        return res.status(500).json({
            ok: false,
            error: "SERVER_ERROR"
        });
    }
}

