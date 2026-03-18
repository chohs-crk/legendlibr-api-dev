/* =========================================================
   characters.js  (public 유지 + 선택 인증 처리)
========================================================= */
export const config = {
    runtime: "nodejs"
};

import { withApi } from "../_utils/withApi.js";
import { db, auth } from "../../firebaseAdmin.js";

function toPublicCharacter(doc) {
    const d = doc.data();

    return {
        id: doc.id,

        name: d.name || "",
        displayRawName: d.displayRawName || "",

        image: {
            type: d.image?.type || "default",
            key: d.image?.key || "base_01",
            url: d.image?.url || ""
        },

        aiImages: d.aiImages || [],
        origin: d.origin || "",
        originDesc: d.originDesc || "",
        region: d.region || "",
        regionId: d.regionId || "",
        regionDetail: d.regionDetail || "",

        promptRefined: d.promptRefined || "",
        fullStory: d.fullStory || "",

        battleScore: d.rankScore || 0,
        battleCount: d.battleCount || 0,

        skills: (d.skills || []).map((s) => ({
            name: s.name || "",
            longDesc: s.longDesc || ""
        }))
    };
}

/* =========================================================
   선택 인증용 유틸
   - public 라우트에서도 쿠키 / Bearer 토큰이 있으면 uid 복원
   - 없거나 검증 실패하면 null 반환
========================================================= */
function getSessionCookie(req) {
    const cookie = req.headers.cookie || "";
    return (
        cookie
            .split(";")
            .find((v) => v.trim().startsWith("session="))
            ?.split("=")[1] || null
    );
}

function getBearerToken(req) {
    const authHeader = req.headers.authorization || "";
    if (!authHeader.startsWith("Bearer ")) return null;
    return authHeader.slice(7).trim() || null;
}

async function getOptionalUid(req) {
    const sessionToken = getSessionCookie(req);
    const bearerToken = getBearerToken(req);

    try {
        if (sessionToken) {
            const decoded = await auth.verifySessionCookie(sessionToken, true);
            return decoded.uid || null;
        }

        if (bearerToken) {
            const decoded = await auth.verifyIdToken(bearerToken, true);
            return decoded.uid || null;
        }

        return null;
    } catch (e) {
        console.warn("OPTIONAL AUTH SKIPPED:", e?.code || e?.message || e);
        return null;
    }
}

/* =========================================================
   메인 핸들러
========================================================= */
export default withApi("public", async (req, res) => {
    try {
        const { id } = req.query;
        const uid = await getOptionalUid(req);

        /* =========================================================
           (1) 내 캐릭터 목록 조회
           GET /api/characters
           - 로그인 필요
        ========================================================= */
        if (req.method === "GET" && !id) {
            if (!uid) {
                return res.status(401).json({ error: "LOGIN_REQUIRED" });
            }

            const snap = await db
                .collection("characters")
                .where("uid", "==", uid)
                .orderBy("createdAt", "desc")
                .get();

            const characters = snap.docs.map((doc) => toPublicCharacter(doc));

            const userRef = db.collection("users").doc(uid);
            const userSnap = await userRef.get();
            const charCount =
                userSnap.exists ? userSnap.data().charCount || 0 : 0;

            return res.status(200).json({
                characters,
                charCount
            });
        }

        /* =========================================================
           (2) 단일 캐릭터 조회
           GET /api/characters?id=XXX
           - 비로그인 허용
        ========================================================= */
        if (req.method === "GET" && id) {
            const ref = db.collection("characters").doc(id);
            const snap = await ref.get();

            if (!snap.exists) {
                return res.status(404).json({ error: "캐릭터 없음" });
            }

            const data = snap.data();
            const isMine = !!uid && data.uid === uid;

            const safeData = {
                ...toPublicCharacter(snap),
                isMine
            };

            return res.status(200).json(safeData);
        }

        /* =========================================================
           (3) 캐릭터 삭제
           DELETE /api/characters?id=XXX
           - 로그인 필요
        ========================================================= */
        if (req.method === "DELETE" && id) {
            if (!uid) {
                return res.status(401).json({ error: "LOGIN_REQUIRED" });
            }

            const ref = db.collection("characters").doc(id);
            const snap = await ref.get();

            if (!snap.exists) {
                return res.status(404).json({ error: "캐릭터 없음" });
            }

            const data = snap.data();

            if (data.uid !== uid) {
                return res.status(403).json({ error: "본인 캐릭터 아님" });
            }

            await db.runTransaction(async (tx) => {
                // ======================
                // 1. READ
                // ======================
                const charSnap = await tx.get(ref);
                if (!charSnap.exists) throw new Error("NO_CHAR");

                const char = charSnap.data();
                const regionId = char.regionId;

                const userRef = db.collection("users").doc(uid);
                const userSnap = await tx.get(userRef);
                const currentCount =
                    userSnap.exists ? userSnap.data().charCount || 0 : 0;

                let regionRef = null;
                let regionSnap = null;
                let rankQuerySnap = null;

                if (regionId && !regionId.endsWith("_DEFAULT")) {
                    regionRef = db.collection("regionsUsers").doc(regionId);
                    regionSnap = await tx.get(regionRef);

                    if (regionSnap.exists) {
                        rankQuerySnap = await tx.get(
                            db.collection("characters")
                                .where("regionId", "==", regionId)
                                .orderBy("rankScore", "desc")
                        );
                    }
                }

                // ======================
                // 2. WRITE
                // ======================
                if (currentCount > 0) {
                    tx.set(
                        userRef,
                        { charCount: currentCount - 1 },
                        { merge: true }
                    );
                }

                if (regionRef && regionSnap?.exists) {
                    const region = regionSnap.data();
                    const isOwnerChar = region.ownerchar?.id === ref.id;

                    const newCharNum = Math.max((region.charnum || 1) - 1, 0);

                    const updateData = {
                        charnum: newCharNum
                    };

                    if (isOwnerChar && rankQuerySnap) {
                        const next = rankQuerySnap.docs
                            .map((d) => ({ id: d.id, ...d.data() }))
                            .find((c) => c.id !== ref.id);

                        if (next) {
                            updateData.ownerchar = {
                                id: next.id,
                                name: next.name
                            };
                            updateData.owner = next.uid;
                        } else {
                            updateData.ownerchar = null;
                            updateData.owner = null;
                        }
                    }

                    tx.update(regionRef, updateData);
                }

                tx.delete(ref);
            });

            return res.status(200).json({ ok: true });
        }

        return res.status(405).json({ error: "지원하지 않는 메소드" });
    } catch (e) {
        console.error("CHARACTERS API ERROR:", e);
        return res.status(500).json({ error: "서버 오류" });
    }
});
