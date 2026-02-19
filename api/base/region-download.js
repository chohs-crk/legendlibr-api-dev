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
        // 1️⃣ region 존재 확인
        const regionSnap = await db
            .collection("regionsUsers")
            .doc(regionId)
            .get();

        if (!regionSnap.exists) {
            return res.status(404).json({ ok: false, error: "REGION_NOT_FOUND" });
        }

        const regionData = regionSnap.data();

        // 2️⃣ 이미 다운로드 했는지 확인
        const myRegionRef = db
            .collection("users")
            .doc(uid)
            .collection("myregion")
            .doc(regionId);

        const myRegionSnap = await myRegionRef.get();

        if (myRegionSnap.exists) {
            return res.status(200).json({
                ok: false,
                error: "ALREADY_DOWNLOADED"
            });
        }

        // 3️⃣ 다운로드 추가
        await myRegionRef.set({
            regionId,
            originId: regionData.originId,
            addedAt: new Date()
        });

        return res.status(200).json({ ok: true });

    } catch (e) {
        console.error("region-download error:", e);
        return res.status(500).json({ ok: false });
    }
});
