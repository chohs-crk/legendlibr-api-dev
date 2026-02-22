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
        regionId: d.regionId || "",
        regionDetail: d.regionDetail || "",

        promptRefined: d.promptRefined || "",
        fullStory: d.fullStory || "",

        battleScore: d.rankScore  || 0,
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
            // 🔹 캐릭터 목록
            const snap = await db
                .collection("characters")
                .where("uid", "==", uid)
                .orderBy("createdAt", "desc")
                .get();

            const characters = snap.docs.map(doc =>
                toPublicCharacter(doc)
            );

           

            // 🔹 사용자 캐릭터 수 (서버 기준)
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

                // ======================
                // 🔵 1. 모든 READ 먼저
                // ======================

                const charSnap = await tx.get(ref);
                if (!charSnap.exists) throw "NO_CHAR";

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
                // 🔴 2. 이제 WRITE 시작
                // ======================

                // 👤 사용자 charCount 감소
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

                    let updateData = {
                        charnum: newCharNum
                    };

                    if (isOwnerChar && rankQuerySnap) {

                        const next = rankQuerySnap.docs
                            .map(d => ({ id: d.id, ...d.data() }))
                            .find(c => c.id !== ref.id);

                        if (next) {
                            updateData.ownerchar = {
                                id: next.id,
                                name: next.name
                            };

                            updateData.owner = next.uid;
                        } else {
                            updateData.ownerchar = null;
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
