import { withApi } from "../_utils/withApi.js";
import admin from "firebase-admin";
import { db } from "../../firebaseAdmin.js";
import { applyUserMetaDelta } from "./_internal/user-meta-update.js";
import { randomUUID } from "crypto";

/* =========================
   모델 매핑 (비용/프로바이더만 필요)
========================= */
const IMAGE_MODEL_MAP = {
    gemini: {
        provider: "gemini",
        model: "gemini-2.5-flash-image",
        costFrames: 50
    },
    together_sdxl: { // 🔥 키 변경
        provider: "together",
        model: "stabilityai/stable-diffusion-xl-base-1.0",
        costFrames: 10
    },
    together_flux2: {
        provider: "together",
        // ✅ 교체: Flux 1 dev → Flux 2 dev
        model: "black-forest-labs/FLUX.2-dev",
        costFrames: 25
    }
};

/* =========================
   handler: enqueue job only
========================= */
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

    // 1) 캐릭터 소유 확인
    const charRef = db.collection("characters").doc(id);
    const charSnap = await charRef.get();
    if (!charSnap.exists) {
        return res.status(404).json({ ok: false, error: "CHAR_NOT_FOUND" });
    }
    const char = charSnap.data();
    if (char.uid !== uid) {
        return res.status(403).json({ ok: false, error: "NOT_OWNER" });
    }

    // 2) 선불 차감
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

    // 3) jobId 먼저 생성(=url도 미리 확정 가능)
    const jobRef = db.collection("imageJobs").doc();
    const jobId = jobRef.id;

    // "url 미리 정하기"
    const bucket = admin.storage().bucket();
    const storagePath = `characters/${id}/ai/jobs/${jobId}.png`;
    const downloadToken = randomUUID();

    const imageUrl =
        `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodeURIComponent(storagePath)}?alt=media&token=${downloadToken}`;

    const now = Date.now();
    function normalizeStyleKey(v) {
        const raw = typeof v === "string" ? v.trim() : "";

        // 빈 값 → null
        if (!raw) return null;

        const compact = raw.toLowerCase().replace(/\s+/g, "");

        // 설정 안함 계열
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

        // 🔥 새 스타일 체계
        const allowed = new Set([
            "default",       // 기본
            "darkfantasy",   // 다크 판타지
            "pastel",        // 파스텔 풍
            "cyberpunk",     // 사이버펑크
            "anime"          // 일본 애니
        ]);

        return allowed.has(s) ? s : null;
    }

    const normalizedStyle = normalizeStyleKey(style);

    // ❗ Gemini가 아닌데 스타일이 null이면 에러
    if (normalizedKey !== "gemini" && !normalizedStyle) {
        return res.status(400).json({
            ok: false,
            error: "STYLE_REQUIRED",
            message: "이 모델은 스타일 지정이 필요합니다."
        });
    }
    // 4) Firestore에 큐 등록
    await jobRef.set({
        uid,
        charId: id,
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

    return res.json({
        ok: true,
        jobId,
        status: "queued",
        imageUrl,     // 미리 확정된 URL (파일은 done 때 생김)
        userMeta
    });
});