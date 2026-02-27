export const config = { runtime: "nodejs" };

import { withApi } from "../_utils/withApi.js";
import { db } from "../../firebaseAdmin.js";

export default withApi("protected", async (req, res, { uid }) => {

    if (req.method !== "POST") {
        return res.status(405).json({ ok: false });
    }

    const { regionId } = req.body || {};
    if (!regionId) {
        return res.status(400).json({ ok: false, error: "NO_REGION_ID" });
    }

    try {

        await db.runTransaction(async (tx) => {

            // 1️⃣ region 존재 확인
            const regionRef = db.collection("regionsUsers").doc(regionId);
            const regionSnap = await tx.get(regionRef);

            if (!regionSnap.exists) {
                throw new Error("REGION_NOT_FOUND");
            }

            const regionData = regionSnap.data() || {};

            // 2️⃣ 이미 다운로드 했는지 확인
            const myRegionRef = db
                .collection("users")
                .doc(uid)
                .collection("myregion")
                .doc(regionId);

            const myRegionSnap = await tx.get(myRegionRef);

            if (myRegionSnap.exists) {
                throw new Error("ALREADY_DOWNLOADED");
            }

            // 3️⃣ 유저 region 개수 제한 검사 (전체 myregion 기준)
            // - 10개 이하여야 함 (>=10 이면 차단)
            const myRegionCountQuery = db
                .collection("users")
                .doc(uid)
                .collection("myregion")
                .limit(11);

            const myRegionCountSnap = await tx.get(myRegionCountQuery);

            if (myRegionCountSnap.size >= 10) {
                throw new Error("REGION_LIMIT_EXCEEDED");
            }

            // 4️⃣ 다운로드 추가
            tx.set(myRegionRef, {
                regionId,
                originId: regionData.originId,
                addedAt: new Date()
            });
        });

        return res.status(200).json({ ok: true });

    } catch (e) {

        const code = e?.message || "";

        if (code === "REGION_NOT_FOUND") {
            return res.status(404).json({ ok: false, error: "REGION_NOT_FOUND" });
        }

        if (code === "ALREADY_DOWNLOADED") {
            return res.status(200).json({ ok: false, error: "ALREADY_DOWNLOADED" });
        }

        if (code === "REGION_LIMIT_EXCEEDED") {
            return res.status(400).json({ ok: false, error: "REGION_LIMIT_EXCEEDED" });
        }

        console.error("region-download error:", e);
        return res.status(500).json({ ok: false });
    }
});
