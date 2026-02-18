export const config = {
    runtime: "nodejs"
};

import { withApi } from "../_utils/withApi.js";
import { db } from "../../firebaseAdmin.js";

export default withApi("protected", async (req, res) => {

    const id = req.query.id;
    if (!id) {
        return res.status(400).json({ error: "id 필요" });
    }

    // 🔥 SSE 헤더
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");

    const battleRef = db.collection("battles").doc(id);

    const unsubscribe = battleRef.onSnapshot(async (snap) => {
        if (!snap.exists) {
            res.write(`data: ${JSON.stringify({ error: "전투 없음" })}\n\n`);
            res.end();
            unsubscribe();
            return;
        }

        const b = snap.data();

        const logSnap = await battleRef
            .collection("logs")
            .orderBy("createdAt", "asc")
            .get();

        const logs = logSnap.docs.map(d => ({
            text: d.data().text || ""
        }));

        const payload = {
            logs,
            status: b.status,
            winnerId: b.winnerId || null,
            loserId: b.loserId || null,
            finished: b.status === "done"
        };

        res.write(`data: ${JSON.stringify(payload)}\n\n`);

        if (b.status === "done") {
            unsubscribe();
            res.end();
        }

        if (b.status === "stream_error") {
            setTimeout(() => {
                res.write(`data: ${JSON.stringify({
                    logs,
                    status: "stream_error",
                    winnerId: b.winnerId || null,
                    loserId: b.loserId || null,
                    finished: true
                })}\n\n`);

                unsubscribe();
                res.end();
            }, 10000);
        }
    });

    req.on("close", () => {
        unsubscribe();
    });
});
