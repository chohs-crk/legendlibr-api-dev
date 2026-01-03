// =======================================
// ✅ api/raid-back.js (최종 통합 서버)
// =======================================
export const config = {
    runtime: "nodejs"
};
import { db } from "../../firebaseAdmin.js";


import admin from "firebase-admin";

// ==============================
// ✅ CORS
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
        // ==============================
        // ✅ Firebase Token 검증
        // ==============================
        const cookies = parseCookiesSafe(req);
        const token = cookies.session;

        if (!token) {
            return res.status(401).json({ ok: false, error: "NO_SESSION" });
        }

        const decoded = await admin.auth().verifySessionCookie(token, true);
        const uid = decoded.uid;

        const { action } = req.body || {};

        // ====================================================
        // ✅ 1️⃣ 보스 목록 불러오기 (프론트 공개용)
        // ====================================================
        if (action === "listBosses") {
            const snap = await db.collection("raidBosses").get();

            const bosses = [];
            snap.forEach(doc => {
                const b = doc.data();

                bosses.push({
                    id: doc.id,
                    name: b.name,
                    stage: b.stage,
                    desc: b.desc,
                    unlocked: b.unlocked,
                    isSeason: b.isSeason,
                    limit: b.limit ?? 3,
                    skills: (b.skills || []).map(s => ({
                        name: s.name,
                        desc: s.desc      // ✅ 설명까지만
                    }))
                });
            });

            return res.json({ ok: true, bosses });
        }

        // ====================================================
        // ✅ 2️⃣ 레이드 생성
        // ====================================================
        

        // ====================================================
        // ✅ 3️⃣ 레이드 정보 조회 (프론트 표시용)
        // ====================================================
        if (action === "getRaidInfo") {
            const { raidId } = req.body || {};
            if (!raidId) {
                return res.status(400).json({ ok: false, error: "RAID_ID_REQUIRED" });
            }

            const raidSnap = await db.collection("raids").doc(raidId).get();
            if (!raidSnap.exists) {
                return res.status(404).json({ ok: false, error: "RAID_NOT_FOUND" });
            }

            const raid = raidSnap.data();
            if (raid.uid !== uid) {
                return res.status(403).json({ ok: false, error: "FORBIDDEN" });
            }

            const bossSnap = await db.collection("raidBosses").doc(raid.bossId).get();
            const boss = bossSnap.data();

            return res.json({
                ok: true,
                raid: {
                    raidId: raid.raidId,
                    limit: raid.limit,
                    boss: {
                        name: boss.name,
                        stage: boss.stage,
                        desc: boss.desc
                    }
                }
            });
        }

        // ====================================================
        // ✅ 4️⃣ 내 캐릭터 + 스킬 4개 (name + longDesc만)
        // ====================================================
        if (action === "getMyRaidCharacters") {
            const { bossId } = req.body;

            if (!bossId) {
                return res.status(400).json({
                    ok: false,
                    error: "BOSS_ID_REQUIRED"
                });
            }

            // 캐릭터 목록 불러오기
            const snap = await db.collection("characters")
                .where("uid", "==", uid)
                .orderBy("createdAt", "desc")
                .get();

            const characters = [];

            snap.forEach(doc => {
                const d = doc.data();
                const rawSkills = d.skills || d.aiSkills || [];

                const safeSkills = rawSkills.slice(0, 4).map(s => ({
                    name: s.name || "이름 없음",
                    longDesc: (s.longDesc || s.long || "").trim()
                }));

                characters.push({
                    id: doc.id,
                    name: d.displayRawName || d.name,
                    skills: safeSkills
                });
            });

            // 🔥 bossId로 limit 가져오기
            const bossSnap = await db.collection("raidBosses").doc(bossId).get();
            const boss = bossSnap.exists ? bossSnap.data() : { limit: 3 };

            return res.json({
                ok: true,
                characters,
                limit: boss.limit ?? 3
            });
        }


        // ✅ [추가] 임시 팀 저장 (raid-select 단계 전용)
        if (action === "setTempTeam") {
            const { bossId, team } = req.body;

            if (!bossId || !Array.isArray(team)) {
                return res.status(400).json({ ok: false, error: "INVALID_PAYLOAD" });
            }

            const tempId = `${uid}_${bossId}`;

            await db.collection("raidTemp").doc(tempId).set({
                uid,
                bossId,
                team,
                updatedAt: admin.firestore.FieldValue.serverTimestamp()
            });

            return res.json({ ok: true });
        }

        // ====================================================
        // ✅ [추가] 6️⃣ 이 보스에 대한 내 레이드 상태 조회 (100 / 110 / none)
        // ====================================================
        if (action === "checkMyBossRaidStatus") {
            const { bossId } = req.body;

            const snap = await db.collection("raids")
                .where("uid", "==", uid)
                .where("bossId", "==", bossId)
                .where("battlefinished", "==", false)

                .get();

            const bossSnap = await db.collection("raidBosses").doc(bossId).get();
            const boss = bossSnap.exists ? bossSnap.data() : { limit: 3 };

            if (snap.empty) {
                return res.json({ ok: true, status: "none", raidId: null, limit: boss.limit ?? 3 });
            }

            const doc = snap.docs[0];
            const data = doc.data();

            const { aiready, battlestart, battlefinished } = data;

            if (aiready && !battlestart && !battlefinished) {
                return res.json({
                    ok: true,
                    status: "100",
                    raidId: data.raidId,
                    limit: boss.limit ?? 3
                });
            }

            if (aiready && battlestart && !battlefinished) {
                return res.json({
                    ok: true,
                    status: "110",
                    raidId: data.raidId,
                    limit: boss.limit ?? 3
                });
            }


            return res.json({
                ok: true,
                status: "none",
                raidId: null,
                limit: boss.limit ?? 3
            });
        }

        // ====================================================
        // ✅ [추가] 7️⃣ 110 → 111 강제 패배 처리
        // ====================================================
        if (action === "forceFinishRaid") {
            const { raidId } = req.body;

            await db.collection("raids").doc(raidId).update({
                battlefinished: true,
                battlestart: true,
                aiready: true,
                loseReason: "disconnect",
                updatedAt: admin.firestore.FieldValue.serverTimestamp()
            });


            return res.json({ ok: true });
        }


        // ====================================================
        // ✅ 알 수 없는 action
        // ====================================================
        return res.status(400).json({
            ok: false,
            error: "UNKNOWN_ACTION"
        });

    } catch (err) {
        console.error("❌ raid-back ERROR:", err);
        return res.status(500).json({
            ok: false,
            error: "SERVER_ERROR"
        });
    }
}
