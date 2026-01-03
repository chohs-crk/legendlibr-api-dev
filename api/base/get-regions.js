export const config = { runtime: "nodejs" };
import { withApi } from "../_utils/withApi.js";
import { db } from "../../firebaseAdmin.js";



/* ================================
   2) 세션 쿠키 추출
================================ */


export default withApi("protected", async (req, res, { uid }) => {
    if (req.method !== "POST") {
        return res.status(405).json({ ok: false, error: "POST_ONLY" });
    }

    const { originId } = req.body || {};
    if (!originId) {
        return res.status(400).json({ ok: false, error: "NO_ORIGIN" });
    }

    try {
        /* --- 기본 region --- */
        const baseSnap = await db.collection("regionsDefault")
            .where("originId", "==", originId)
            .get();

        const baseRegions = baseSnap.docs.map(doc => ({
            id: doc.id,
            ...doc.data(),
            source: "default"
        }));

        /* --- 유저 region --- */
        const mySnap = await db.collection("users")
            .doc(uid)
            .collection("myregion")
            .where("originId", "==", originId)
            .get();

        const regionIds = mySnap.docs.map(d => d.data().regionId);


        const userRegions = [];

        for (const regionId of regionIds) {
            const snap = await db.collection("regionsUsers").doc(regionId).get();
            if (snap.exists) {
                userRegions.push({
                    id: snap.id,
                    ...snap.data(),
                    source: "user"
                });
            }
        }


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
