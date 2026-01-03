export const config = { runtime: "nodejs" };
import { withApi } from "../_utils/withApi.js";
import { db } from "../../firebaseAdmin.js";

export default withApi("protected", async (req, res, { uid }) => {
    if (req.method !== "POST") {
        return res.status(405).json({ ok: false });
    }

    const { regionId } = req.body || {};
    if (!regionId) {
        return res.json({ ok: false, error: "NO_REGION_ID" });
    }

    const regionRef = db.collection("regionsUsers").doc(regionId);
    const snap = await regionRef.get();

    if (!snap.exists) {
        return res.json({ ok: false, error: "REGION_NOT_FOUND" });
    }

    const region = snap.data();
    // 🔥 default region은 삭제 자체 불가
     if (regionId.endsWith("_DEFAULT")) {
             return res.json({ ok: false, error: "DEFAULT_REGION_CANNOT_DELETE" });
         }
    /* ================================
       🔥 owner인 경우
    ================================= */
    if (region.owner === uid) {
        if (region.charnum !== 0) {
            return res.json({ ok: false, error: "REGION_IN_USE" });
        }
        await regionRef.delete();
        return res.json({ ok: true });
    }

    /* ================================
       🔥 myregion 보유 여부 검증
       (조작 방지 핵심)
    ================================= */
    const mySnap = await db.collection("users")
        .doc(uid)
        .collection("myregion")
        .doc(regionId)
        .get();

    if (!mySnap.exists) {
        return res.json({ ok: false, error: "REGION_NOT_IN_MY_LIST" });
    }

    /* ================================
       🔥 non-owner → 내 캐릭터가 쓰는지 검증
    ================================= */
    const charSnap = await db.collection("characters")
        .where("uid", "==", uid)
        .where("regionId", "==", regionId)
        .limit(1)
        .get();

    if (!charSnap.empty) {
        return res.json({ ok: false, error: "REGION_USED_BY_CHAR" });
    }

    /* ================================
       🔥 myregion에서 제거
    ================================= */
    await db.collection("users")
        .doc(uid)
        .collection("myregion")
        .doc(regionId)
        .delete();

    return res.json({ ok: true });
});
