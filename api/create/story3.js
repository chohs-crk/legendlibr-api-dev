export const config = {
    runtime: "nodejs",
    compute: 1,
};

import { getSession, setSession, deleteSession } from "../base/sessionstore.js";
import { callStorySceneWithRetry } from "./callStoryAI.js";
import { withApi } from "../_utils/withApi.js";
import {
    GEMINI_FLASH_LITE_MODEL,
    GEMINI_THINKING_BUDGET_OFF,
} from "./gemini-cache.js";
import { buildStory3DynamicPrompt, buildStorySharedPrefix } from "./story-prompt-cache.js";

/* ================================
   SCENE ROLE SYSTEM - STORY3
================================ */
const STORY3_SYSTEM = `
[장면 역할 – 전 / 전환점]

이 장면은 전환점이다.
이미 사건은 시작되었다.
일상은 더 이상 존재하지 않는다.
이전 스토리를 바탕으로 이어서 발생할 내용을 작성하라.

선택지를 그대로 반복하지 말고,
그 행동을 바탕으로 실제로 벌어지는 장면을 묘사하라.

반드시:
1. 이전 장면 직후 시점
2. 선택지 행동의 구체적 실행 장면
3. 상황의 확대 또는 충돌
4. 되돌리기 어려운 변화
5. 결말 직전에서 멈춘다

결말 서술 금지.
요약 금지.
교훈 금지.

[선택지의 기능]
선택지는 "다음 장면의 실제 시작점"이다.
선택지의 행동이 이미 실행된 상태로 장면을 시작해야 한다.
선택지를 그대로 다시 쓰지 말고 실행 장면을 구체적으로 묘사하라.
`;

function pushUsageCall(session, call) {
    if (!session.aiUsage) {
        session.aiUsage = { calls: [] };
    }

    session.aiUsage.calls.push({
        stage: call.stage,
        tag: call.tag,
        modelId: call.modelId || "unknown",
        promptTokens: call.usageMetadata?.promptTokenCount ?? null,
        outputTokens: call.usageMetadata?.candidatesTokenCount ?? null,
        totalTokens:
            call.usageMetadata?.totalTokenCount ??
            ((call.usageMetadata?.promptTokenCount ?? 0) +
                (call.usageMetadata?.candidatesTokenCount ?? 0)) ??
            null,
        ts: Date.now(),
    });
}

function escapeSSEData(text) {
    return String(text || "")
        .replace(/\r?\n/g, " ")
        .replace(/\s+/g, " ")
        .trim();
}

async function stream(uid, s, res) {
    res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
    });

    try {
        s.called = true;
        s.resed = false;
        s.lastCall = Date.now();
        await setSession(uid, s);

        const cachedContent = s.aiCache?.storyPrefix?.name || null;
        const sharedPrefix = buildStorySharedPrefix(s);
        const dynamicPrompt = buildStory3DynamicPrompt(s);
        const prompt = cachedContent
            ? dynamicPrompt
            : `${sharedPrefix}

${dynamicPrompt}`.trim();
        const modelId = s.aiCache?.storyPrefix?.modelId || GEMINI_FLASH_LITE_MODEL;

        const result = await callStorySceneWithRetry(uid, prompt, STORY3_SYSTEM, {
            modelId,
            cachedContent,
            temperature: 0.3,
            topP: 0.8,
            maxOutputTokens: 768,
            maxRetry: 2,
            thinkingBudget: GEMINI_THINKING_BUDGET_OFF,
        });

        const scene = result.scene;

        pushUsageCall(s, {
            stage: "story3",
            tag: "STORY3_JSON_SCHEMA",
            modelId: result.modelId,
            usageMetadata: result.usageMetadata,
        });

        s.output.story3 = {
            story: scene.story,
            choices: scene.choices.map((c) => ({
                text: c.text,
                score: c.score,
            })),
        };

        s.resed = true;
        await setSession(uid, s);

        res.write(`data: ${escapeSSEData(scene.story)}\n\n`);
        res.write(
            `event: choices\ndata: ${JSON.stringify({
                choices: scene.choices.map((c) => c.text),
            })}\n\n`
        );

        res.write(`event: done\ndata: end\n\n`);
        res.end();
    } catch (err) {
        console.error("[STORY3][FAIL_FINAL]", { uid, err: err?.message });
        await deleteSession(uid);
        res.write(`event: error\ndata: STREAM_FAILED\n\n`);
        res.end();
    }
}

export default withApi("expensive", async (req, res, { uid }) => {
    const s = await getSession(uid);
    if (!s || !s.nowFlow.story3) {
        return res.status(400).json({ ok: false });
    }

    if (req.method === "PUT") {
        s.selected = s.selected || {};
        s.selected.story3 = req.body.index;

        s.nowFlow.story3 = false;
        s.nowFlow.final = true;

        s.called = false;
        s.resed = false;
        s.lastCall = 0;

        await setSession(uid, s);
        return res.json({ ok: true });
    }

    return stream(uid, s, res);
});
