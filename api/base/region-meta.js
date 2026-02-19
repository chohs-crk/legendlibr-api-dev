export const config = { runtime: "nodejs" };

import { withApi } from "../_utils/withApi.js";
import { db } from "../../firebaseAdmin.js";

export default withApi("protected", async (req, res) => {

    if (req.method !== "POST") {
        return res.status(405).json({ ok: false });
    }

    const { regionId } = req.body || {};
    if (!regionId) {
        return res.status(400).json({ ok: false, error: "NO_REGION_ID" });
    }

    // default region이면 바로 리턴
    if (regionId.endsWith("_DEFAULT")) {
        return res.status(200).json({
            ok: true,
            source: "default"
        });
    }

    try {
        const snap = await db.collection("regionsUsers").doc(regionId).get();

        if (!snap.exists) {
            return res.status(404).json({ ok: false });
        }

        const d = snap.data();

        return res.status(200).json({
            ok: true,
            source: "user",
            charnum: Number(d.charnum) || 0,
            ownerchar: d.ownerchar?.name || null
        });

    } catch (e) {
        return res.status(500).json({ ok: false });
    }
});
