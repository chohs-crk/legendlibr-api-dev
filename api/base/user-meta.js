export const config = { runtime: "nodejs" };

import { withApi } from "../_utils/withApi.js";
import { db } from "../../firebaseAdmin.js";

export default withApi("protected", async (req, res, { uid }) => {
    const ref = db.collection("users").doc(uid);
    const snap = await ref.get();

    try {
        

        let result;

        if (!snap.exists) {
            const initData = {
                level: 1,
                exp: 0,
                currency: {
                    scroll: 0,
                    frame: 0
                },
                createdAt: new Date(),
                updatedAt: new Date()
            };

            await ref.set(initData);

            result = {
                level: 1,
                exp: 0,
                scroll: 0,
                frame: 0
            };
        } else {
            const d = snap.data();
            result = {
                level: d.level ?? 1,
                exp: d.exp ?? 0,
                scroll: d.currency?.scroll ?? 0,
                frame: d.currency?.frame ?? 0
            };
            await ref.update({
 updatedAt: new Date()
               });
        }

        return res.status(200).json(result);

    } catch (e) {
        console.error("USER-META ERROR:", e);
        return res.status(500).json({ error: "서버 오류" });
    }
});
