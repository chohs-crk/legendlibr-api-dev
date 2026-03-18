import { withApi } from "../_utils/withApi.js";
import { db } from "../../firebaseAdmin.js";

export default withApi("protected", async (req, res, { uid }) => {
    const { id, image } = req.body;

    if (!id || !image || !image.type || !image.key) {
        return res.status(400).json({
            ok: false,
            error: "INVALID_PARAMS"
        });
    }

    try {
        const ref = db.collection("characters").doc(id);
        const snap = await ref.get();

        if (!snap.exists) {
            return res.status(404).json({
                ok: false,
                error: "CHAR_NOT_FOUND"
            });
        }

        const char = snap.data() || {};

        if (char.uid !== uid) {
            return res.status(403).json({
                ok: false,
                error: "NOT_OWNER"
            });
        }

        let fitScore = 0;

        if (image.type === "ai") {
            const found = Array.isArray(char.aiImages)
                ? char.aiImages.find((ai) => ai.url === image.url)
                : null;

            if (!found) {
                return res.status(403).json({
                    ok: false,
                    error: "INVALID_AI_URL"
                });
            }

            if (found.ready !== true) {
                return res.status(409).json({
                    ok: false,
                    error: "AI_IMAGE_NOT_READY",
                    message: "아직 생성 중인 이미지는 적용할 수 없습니다."
                });
            }

            fitScore = Number(found.fitScore || 0);
        }

        await ref.update({
            image: {
                type: image.type,
                key: image.key,
                url: image.url || "",
                fitScore
            }
        });

        return res.json({ ok: true });
    } catch (err) {
        console.error("characters-image ERROR:", err);
        return res.status(500).json({
            ok: false,
            error: "SERVER_ERROR"
        });
    }
});
