/* =========================================================
   characters.js  (battles 제거된 정리본)
========================================================= */
export const config = {
    runtime: "nodejs"
};

import { withApi } from "../_utils/withApi.js";
import { db } from "../../firebaseAdmin.js";



function toPublicCharacter(doc) {
    const d = doc.data();

    return {
        id: doc.id,

        name: d.name || "",
        displayRawName: d.displayRawName || "",

        // ✅ 이미지 메타 (핵심 추가)
        image: {
            type: d.image?.type || "default",
            key: d.image?.key || "base_01",
            url: d.image?.url || ""
        },
        aiImages: d.aiImages || [],
        origin: d.origin || "",
        originDesc: d.originDesc || "",
        region: d.region || "",
        regionDetail: d.regionDetail || "",

        promptRefined: d.promptRefined || "",
        finalStory: d.finalStory || "",

        battleScore: d.battleScore || 0,
        battleCount: d.battleCount || 0,

        skills: (d.skills || []).map(s => ({
            name: s.name || "",
            longDesc: s.longDesc || ""
        }))
    };
}


/* =========================================================
   메인 핸들러
========================================================= */
export default withApi("protected", async (req, res, { uid }) => {
   

    try {
        

        const { id } = req.query;

        /* =========================================================
           (1) 전체 캐릭터 목록 조회
           GET /api/characters
        ========================================================= */
        if (req.method === "GET" && !id) {
            const snap = await db
                .collection("characters")
                .where("uid", "==", uid)
                .orderBy("createdAt", "desc")
                .get();

            const characters = snap.docs.map(doc =>
                toPublicCharacter(doc)
            );

            return res.status(200).json({ characters });
        }


        /* =========================================================
           (2) 단일 캐릭터 조회
           GET /api/characters?id=XXX
        ========================================================= */
        if (req.method === "GET" && id) {
            const ref = db.collection("characters").doc(id);
            const snap = await ref.get();

            if (!snap.exists) {
                return res.status(404).json({ error: "캐릭터 없음" });
            }

            const data = snap.data();

            // UID 일치 여부 검사
            const isMine = data.uid === uid;

            const safeData = {
                ...toPublicCharacter(snap),
                isMine
            };

            return res.status(200).json(safeData);

            /* =========================================================
               🔥 battles 제거 후 안전 필드만 전달
            ========================================================== */

        

        }

        /* =========================================================
   (3) 캐릭터 삭제
   DELETE /api/characters?id=XXX
========================================================= */
        if (req.method === "DELETE" && id) {
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
                const charSnap = await tx.get(ref);
                if (!charSnap.exists) throw "NO_CHAR";

                const char = charSnap.data();
                const regionId = char.regionId;

                // 📌 regionId 없는 경우 → 캐릭터만 삭제
                if (!regionId) {
                    tx.delete(ref);
                    return;
                }

                const regionRef = db.collection("regionsUsers").doc(regionId);
                const regionSnap = await tx.get(regionRef);

                // 📌 region 문서 자체가 없으면 → 캐릭터만 삭제
                if (!regionSnap.exists) {
                    tx.delete(ref);
                    return;
                }

                // 📌 default region → final.js 동일 규칙: 캐릭터만 삭제
                if (regionId.endsWith("_DEFAULT")) {
                    tx.delete(ref);
                    return;
                }

                // =====================================================
                // 🟦 default 가 아닌 경우에만 기존 owner/charnum 로직 수행
                // =====================================================

                const region = regionSnap.data();
                const isOwnerChar = region.ownerchar?.id === id;

                let update = {
                    charnum: Math.max((region.charnum || 1) - 1, 0)
                };

                if (isOwnerChar) {
                    const q = await db.collection("characters")
                        .where("regionId", "==", regionId)
                        .orderBy("rankScore", "desc")
                        .get();

                    const next = q.docs
                        .map(d => ({ id: d.id, ...d.data() }))
                        .find(c => c.id !== id);

                    if (next) {
                        update.owner = next.uid;
                        update.ownerchar = { id: next.id, name: next.name };
                    } else {
                        update.ownerchar = null;
                    }
                }

                tx.update(regionRef, update);
                tx.delete(ref);
            });

            return res.status(200).json({ ok: true });
        }


        return res.status(405).json({ error: "지원하지 않는 메소드" });

    } catch (e) {
        console.error("CHARACTERS API ERROR:", e);
        return res.status(401).json({ error: "서버 오류" });
    }
});
