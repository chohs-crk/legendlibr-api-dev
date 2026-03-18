import { withApi } from "../_utils/withApi.js";
import admin from "firebase-admin";
import { db } from "../../firebaseAdmin.js";
import { applyUserMetaDelta } from "./_internal/user-meta-update.js";
import { randomUUID } from "crypto";

const IMAGE_MODEL_MAP = {
    gemini: {
        provider: "gemini",
        model: "gemini-2.5-flash-image",
        costFrames: 50
    },
    together_sdxl: {
        provider: "together",
        model: "stabilityai/stable-diffusion-xl-base-1.0",
        costFrames: 10
    },
    together_flux2: {
        provider: "together",
        model: "black-forest-labs/FLUX.2-dev",
        costFrames: 25
    }
};

function normalizeStyleKey(v) {
    const raw = typeof v === "string" ? v.trim() : "";

    if (!raw) return null;

    const compact = raw.toLowerCase().replace(/\s+/g, "");

    if (
        compact === "none" ||
        compact === "off" ||
        compact === "unset" ||
        compact === "nostyle" ||
        compact === "no_style" ||
        compact === "없음" ||
        compact === "미설정" ||
        compact === "설정안함"
    ) {
        return null;
    }

    const s = raw.toLowerCase();
    const allowed = new Set([
        "default",
        "darkfantasy",
        "pastel",
        "cyberpunk",
        "anime"
    ]);

    return allowed.has(s) ? s : null;
}

export default withApi("expensive", async (req, res, { uid }) => {
    if (req.method !== "POST") {
        return res.status(405).json({ ok: false, error: "METHOD_NOT_ALLOWED" });
    }

    const { id, prompt, style, model: modelKey } = req.body ?? {};

    if (!id || typeof id !== "string") {
        return res.status(400).json({ ok: false, error: "INVALID_CHAR_ID" });
    }

    const userPrompt = (prompt ?? "").toString().trim();
    if (userPrompt.length < 20 || userPrompt.length > 1000) {
        return res.status(400).json({
            ok: false,
            error: "INVALID_PROMPT_LENGTH",
            message: "prompt는 20~1000자로 제한"
        });
    }

    const normalizedKey = (modelKey || "gemini").toString();
    const modelInfo = IMAGE_MODEL_MAP[normalizedKey];
    if (!modelInfo) {
        return res.status(400).json({ ok: false, error: "INVALID_MODEL" });
    }

    const normalizedStyle = normalizeStyleKey(style);
    if (normalizedKey !== "gemini" && !normalizedStyle) {
        return res.status(400).json({
            ok: false,
            error: "STYLE_REQUIRED",
            message: "이 모델은 스타일 지정이 필요합니다."
        });
    }

    const charRef = db.collection("characters").doc(id);
    const charSnap = await charRef.get();
    if (!charSnap.exists) {
        return res.status(404).json({ ok: false, error: "CHAR_NOT_FOUND" });
    }

    const char = charSnap.data() || {};
    if (char.uid !== uid) {
        return res.status(403).json({ ok: false, error: "NOT_OWNER" });
    }

    const originId = typeof char?.originId === "string" ? char.originId : null;
    const costFrames = Math.abs(modelInfo.costFrames || 10);

    let userMeta;
    try {
        userMeta = await applyUserMetaDelta(uid, { frameDelta: -costFrames });
    } catch (e) {
        return res.status(402).json({
            ok: false,
            error: "PAYMENT_FAILED",
            message: String(e?.message || e)
        });
    }

    const jobRef = db.collection("imageJobs").doc();
    const jobId = jobRef.id;

    const bucket = admin.storage().bucket();
    const storagePath = `characters/${id}/ai/jobs/${jobId}.png`;
    const downloadToken = randomUUID();
    const imageUrl = `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodeURIComponent(storagePath)}?alt=media&token=${downloadToken}`;

    const now = Date.now();
    const pendingImage = {
        jobId,
        url: imageUrl,
        ready: false,
        fitScore: 0,
        safetyScore: 0,
        style: normalizedStyle,
        modelKey: normalizedKey,
        model: modelInfo.model,
        provider: modelInfo.provider,
        createdAt: now,
        updatedAt: now,
        prompt: null
    };

    try {
        const batch = db.batch();

        batch.update(charRef, {
            aiImages: admin.firestore.FieldValue.arrayUnion(pendingImage)
        });

        batch.set(jobRef, {
            jobId,
            uid,
            charId: id,
            originId,
            userPrompt,
            style: normalizedStyle,
            modelKey: normalizedKey,
            status: "queued",
            imageUrl,
            storage: {
                bucket: bucket.name,
                path: storagePath,
                downloadToken
            },
            costFrames,
            result: null,
            error: null,
            billing: {
                mode: "prepaid",
                chargedFrames: costFrames,
                chargedAt: now,
                refund: {
                    suggested: false,
                    frames: costFrames,
                    appliedAt: null
                }
            },
            createdAt: now,
            updatedAt: now,
            startedAt: null,
            finishedAt: null
        });

        await batch.commit();
    } catch (e) {
        try {
            await applyUserMetaDelta(uid, { frameDelta: costFrames });
        } catch (refundErr) {
            console.error("AI_IMAGE_ENQUEUE_REFUND_FAILED:", refundErr);
        }

        return res.status(500).json({
            ok: false,
            error: "ENQUEUE_FAILED",
            message: String(e?.message || e)
        });
    }

    return res.json({
        ok: true,
        jobId,
        status: "queued",
        imageUrl,
        pendingImage,
        userMeta
    });
});