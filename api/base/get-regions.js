export const config = { runtime: "nodejs" };

import { withApi } from "../_utils/withApi.js";
import { db } from "../../firebaseAdmin.js";
import { DEFAULT_REGIONS } from "./data/default-regions.js";

export default withApi("protected", async (req, res, { uid }) => {

    if (req.method !== "POST") {
        return res.status(405).json({ ok: false, error: "POST_ONLY" });
    }

    const { originId } = req.body || {};
    if (!originId) {
        return res.status(400).json({ ok: false, error: "NO_ORIGIN" });
    }

    try {

        /* =====================================================
         1️⃣ 기본(Default) Region (정적 파일 사용)
      ===================================================== */
        const baseRegions = DEFAULT_REGIONS
            .filter(r => r.originId === originId)
            .map(r => ({
                id: r.id,
                name: r.name || "",
                detail: r.detail || "",
                originId: r.originId || "",
                source: "default"
            }));



        /* =====================================================
           2️⃣ 유저 Region
        ===================================================== */
        const mySnap = await db.collection("users")
            .doc(uid)
            .collection("myregion")
            .where("originId", "==", originId)
            .get();

        const regionIds = mySnap.docs
            .map(d => d.data()?.regionId)
            .filter(Boolean);

        const userRegions = [];

        for (const regionId of regionIds) {

            const snap = await db.collection("regionsUsers")
                .doc(regionId)
                .get();

            if (!snap.exists) continue;

            const data = snap.data();

            userRegions.push({
                id: snap.id,
                name: data.name || "",
                detail: data.detail || "",
                originId: data.originId || "",
                charnum: Number.isFinite(Number(data.charnum))
                    ? Number(data.charnum)
                    : 0,
                owner: data.owner || null,
                ownerchar: data.ownerchar && typeof data.ownerchar === "object"
                    ? {
                        id: data.ownerchar.id || null,
                        name: data.ownerchar.name || null
                    }
                    : null,
                source: "user"
            });
        }


        /* =====================================================
           3️⃣ 응답
        ===================================================== */
        return res.status(200).json({
            ok: true,
            regions: [...baseRegions, ...userRegions]
        });

    } catch (err) {

        console.error("get-regions ERROR:", err);

        return res.status(500).json({
            ok: false,
            error: "SERVER_ERROR"
        });
    }
});
