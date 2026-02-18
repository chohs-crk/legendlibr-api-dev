export default async function handler(req, res) {
    const id = req.query.id;

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");

    const battleRef = db.collection("battles").doc(id);

    const unsubscribe = battleRef.onSnapshot(async (snap) => {
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
            winnerId: b.status === "done" ? b.winnerId : null,
            loserId: b.status === "done" ? b.loserId : null,
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
                    winnerId: b.winnerId,
                    loserId: b.loserId,
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
}
