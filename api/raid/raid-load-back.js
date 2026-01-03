// =============================================
// api/raid-load-back.js
// 역할:
//  - enterOrCreateRaid: 000 없으면 생성 + AI 1회 예약
//  - checkStatus: 000/100/111 상태 조회
//  - startBattle: battlestart=true
// =============================================
export const config = {
    runtime: "nodejs"
};
import admin from "firebase-admin";
import { auth, db } from "../../firebaseAdmin.js";




import fetch from "node-fetch";

function applyCors(req, res) {
    const origin = req.headers.origin || "*";
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Access-Control-Allow-Credentials", "true");
    res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
}
function parseCookiesSafe(req) {
    try {
        const header = req?.headers?.cookie;
        if (!header) return {};
        return header.split(";").reduce((acc, cur) => {
            const [k, v] = cur.split("=");
            acc[k.trim()] = decodeURIComponent(v);
            return acc;
        }, {});
    } catch {
        return {};
    }
}


export default async function handler(req, res) {
    applyCors(req, res);
    if (req.method === "OPTIONS") return res.status(204).end();
    if (req.method !== "POST")
        return res.status(405).json({ ok: false, error: "POST_ONLY" });

    try {
        const cookies = parseCookiesSafe(req);
        const token = cookies.session;

        if (!token) {
            return res.status(401).json({ ok: false, error: "NO_SESSION" });
        }

        const decoded = await admin.auth().verifySessionCookie(token, true);
        const uid = decoded.uid;


        const { action } = req.body || {};

        // =========================================
        // 1) enterOrCreateRaid
        //  - raidId 있으면 그대로 사용
        //  - bossId만 있으면:
        //      000 찾기 → 없으면 새로 만들고 AI 예약
        // =========================================
        if (action === "enterOrCreateRaid") {
            const { raidId, bossId } = req.body;

            // ✅ case 1: raidId로 바로 진입 (이어하기)
            if (raidId) {
                const ref = db.collection("raids").doc(raidId);
                const snap = await ref.get();
                if (!snap.exists) {
                    return res.status(404).json({ ok: false, error: "RAID_NOT_FOUND" });
                }

                const data = snap.data();
                if (data.uid !== uid) {
                    return res.status(403).json({ ok: false, error: "NO_PERMISSION" });
                }

                return res.json({
                    ok: true,
                    raidId,
                    aiready: !!data.aiready,
                    battlestart: !!data.battlestart,
                    battlefinished: !!data.battlefinished
                });
            }

            // ✅ case 2: bossId만 있는 신규/재진입
            if (!bossId) {
                return res
                    .status(400)
                    .json({ ok: false, error: "RAID_ID_OR_BOSS_ID_REQUIRED" });
            }

            // 2-1. uid+bossId+finished=false 중 가장 최근 문서 찾기
            const qSnap = await db
                .collection("raids")
                .where("uid", "==", uid)
                .where("bossId", "==", bossId)
                .where("battlefinished", "==", false)
               
                .limit(1)
                .get();

            let raidRef;
            let raidData;

            if (qSnap.empty) {
                // ✅ 2-2. 아무 것도 없으면 새 000 생성
                raidRef = db.collection("raids").doc();
                const newRaidId = raidRef.id;

                const bossSnap = await db.collection("raidBosses").doc(bossId).get();
                const boss = bossSnap.exists ? bossSnap.data() : { limit: 3 };

                raidData = {
                    raidId: newRaidId,
                    uid,
                    bossId,
                    limit: boss.limit ?? 3,   // 🔥 추가!
                    aiready: false,
                    battlestart: false,
                    battlefinished: false,
                    initStarted: false,
                    createdAt: admin.firestore.FieldValue.serverTimestamp(),
                    updatedAt: admin.firestore.FieldValue.serverTimestamp()
                };

                await raidRef.set(raidData);
            } else {
                // ✅ 2-3. 기존 문서 재사용
                raidRef = qSnap.docs[0].ref;
                raidData = qSnap.docs[0].data();
            }

            // ✅ 2-4. 000 상태 & initStarted=false 이면 여기서 AI 1회 예약
            if (!raidData.aiready && !raidData.initStarted) {
                await raidRef.update({
                    initStarted: true,
                    updatedAt: admin.firestore.FieldValue.serverTimestamp()
                });

                triggerRaidInit(raidRef.id, uid).catch((e) => {
                    console.error("[raid-load-back] triggerRaidInit error:", e);
                });
            }

            return res.json({
                ok: true,
                raidId: raidRef.id,
                aiready: !!raidData.aiready,
                battlestart: !!raidData.battlestart,
                battlefinished: !!raidData.battlefinished
            });
        }

        // =========================================
        // 2) checkStatus
        // =========================================
        if (action === "checkStatus") {
            const { raidId } = req.body;
            if (!raidId) {
                return res.status(400).json({ ok: false, error: "RAID_ID_REQUIRED" });
            }

            const ref = db.collection("raids").doc(raidId);
            const snap = await ref.get();

            if (!snap.exists) {
                return res.status(404).json({ ok: false, error: "RAID_NOT_FOUND" });
            }

            const data = snap.data();

            if (data.uid !== uid) {
                return res.status(403).json({ ok: false, error: "NO_PERMISSION" });
            }

            // ✅ 010 비정상 상태 → 강제 종료 처리
            if (!data.aiready && data.battlestart && !data.battlefinished) {
                await ref.update({
                    aiready: true,              // ✅ AI는 '시도된 것'으로 처리
                    battlestart: true,          // ✅ 전투도 '시도된 것'으로 처리
                    battlefinished: true,       // ✅ 최종 종료
                    loseReason: "ai_error",     // ✅ 무효 사유 기록 (선택)
                    updatedAt: admin.firestore.FieldValue.serverTimestamp()
                });


                return res.json({
                    ok: true,
                    raidId,
                    aiready: false,
                    battlestart: true,
                    battlefinished: true,
                    canceled: true
                });
            }

            return res.json({
                ok: true,
                raidId,
                aiready: !!data.aiready,
                battlestart: !!data.battlestart,
                battlefinished: !!data.battlefinished
            });
        }


        // =========================================
        // 3) startBattle (battlestart = true)
        // =========================================
        if (action === "startBattle") {
            const { raidId } = req.body;
            if (!raidId) {
                return res.status(400).json({ ok: false, error: "RAID_ID_REQUIRED" });
            }

            const ref = db.collection("raids").doc(raidId);
            const snap = await ref.get();
            if (!snap.exists) {
                return res.status(404).json({ ok: false, error: "RAID_NOT_FOUND" });
            }

            const data = snap.data();
            if (data.uid !== uid) {
                return res.status(403).json({ ok: false, error: "NO_PERMISSION" });
            }

            await ref.update({
                battlestart: true,
                updatedAt: admin.firestore.FieldValue.serverTimestamp()
            });

            return res.json({ ok: true });
        }

        return res.status(400).json({ ok: false, error: "UNKNOWN_ACTION" });
    } catch (e) {
        console.error("[raid-load-back ERROR]", e);
        return res.status(500).json({ ok: false, error: "SERVER_ERROR" });
    }
}

// =========================================
// 🔥 레이드 AI 초기화 트리거
//  - 000에서 initStarted=true로 바뀐 경우에만 호출
//  - raid-battle-init API로 비동기 요청
// =========================================
async function triggerRaidInit(raidId, uid) {
    try {
        // 여기서는 같은 Vercel 프로젝트의 raid-battle-init을 호출한다고 가정
        // 필요하다면 URL은 실제 배포 주소에 맞게 수정
        await fetch("https://ai-proxy2.vercel.app/api/raid/raid-battle-init", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                // 서버 간 호출이라 Authorization 생략 or 내부 토큰 사용 가능
            },
            body: JSON.stringify({ raidId, uid })
        });
    } catch (e) {
        console.error("triggerRaidInit fetch error:", e);
    }
}

