import { withApi } from "../../_utils/withApi.js";
import { getSession, setSession, deleteSession } from "../../base/sessionstore.js";

import { CHAR_LIMIT, getUserCharCount, saveFinalCharacterTx } from "./final-repository.js";
import {
    calculateStoryScore,
    decideEndingType,
    buildFullStory,
    formatFinalStory
} from "./final-domain.js";
import { generateEndingAndFeatures, generateStats } from "./final-ai.js";

async function safeDeleteSession(uid) {
    try {
        await deleteSession(uid);
    } catch (e) {
        console.error("SESSION_DELETE_FAIL:", e);
    }
}

function respond(res, status, payload) {
    return res.status(status).json(payload);
}

export default withApi("expensive", async (req, res, { uid }) => {
    let s = null;
    let shouldCleanupSession = false;

    try {
        if (req.method !== "POST") {
            return respond(res, 405, { ok: false });
        }

        s = await getSession(uid);

        if (!s || !s.nowFlow?.final) {
            console.log("[FINAL][START]", {
                uid,
                hasSession: !!s,
                nowFlow: s?.nowFlow,
                selected: s?.selected
            });
            return respond(res, 400, { ok: false, error: "INVALID_FLOW" });
        }

        // 🔒 CHAR LIMIT PRE-CHECK (AI 호출 전에 컷)
        const currentCount = await getUserCharCount(uid);
        if (currentCount >= CHAR_LIMIT) {
            await safeDeleteSession(uid);
            return respond(res, 403, { ok: false, error: "CHARACTER_LIMIT_REACHED" });
        }

        if (s.called) {
            return respond(res, 409, { ok: false, error: "FINAL_ALREADY_CALLED" });
        }

        // ✅ FINAL AI 호출 시작 마킹
        s.called = true;
        s.resed = false;
        await setSession(uid, s);
        shouldCleanupSession = true;

        const { input, output, selected } = s;

        // 1) 점수/엔딩 타입 계산 (도메인)
        const storyScore = calculateStoryScore(output, selected);
        const endingType = decideEndingType(storyScore);

        // 2) AI #1 엔딩/특징
        const { ending, features } = await generateEndingAndFeatures({
            uid,
            input,
            output,
            selected,
            endingType
        });

        // 3) fullStory 조립 + 포맷
        const fullStory = buildFullStory(output, ending);
        const formattedStory = formatFinalStory(fullStory);

        // 4) AI #2 스탯/스킬
        const stats = await generateStats({
            uid,
            input,
            output,
            fullStory
        });

        // 5) DB 저장 (트랜잭션)
        const id = await saveFinalCharacterTx({
            uid,
            input,
            output,
            formattedStory,
            features,
            storyScore,
            stats,
            metaSafety: s.metaSafety
        });

        // 6) 세션 정리 + 응답
        await safeDeleteSession(uid);
        shouldCleanupSession = false;

        return res.json({
            ok: true,
            id,
            fullStory
        });
    } catch (err) {
        if (shouldCleanupSession) {
            await safeDeleteSession(uid);
        }

        console.error("FINAL ERROR:", err);

        const code = err?.code;

        if (code === "CHARACTER_LIMIT_REACHED") {
            return respond(res, 403, { ok: false, error: code });
        }
        if (code === "NO_REGION") {
            return respond(res, 400, { ok: false, error: code });
        }
        if (code === "REGION_NOT_REGISTERED") {
            return respond(res, 403, { ok: false, error: code });
        }
        if (code === "AI_ENDING_INVALID") {
            return respond(res, 500, {
                ok: false,
                error: code,
                reason: err?.meta?.reason ? String(err.meta.reason) : undefined
            });
        }
        if (code === "AI_STATS_INVALID") {
            return respond(res, 500, {
                ok: false,
                error: code,
                reason: err?.meta?.reason ? String(err.meta.reason) : undefined
            });
        }

        return respond(res, 500, { ok: false, error: "FINAL_FAILED" });
    }
});
