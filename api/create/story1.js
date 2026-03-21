export const config = {
    runtime: "nodejs",
    compute: 1,
};

import { getSession, setSession, deleteSession } from "../base/sessionstore.js";
import { callStorySceneWithRetry } from "./callStoryAI.js";
import { withApi } from "../_utils/withApi.js";
import {
    GEMINI_STORY1_MODEL,
    GEMINI_THINKING_BUDGET_OFF,
} from "./gemini-cache.js";
import { buildStory1DynamicPrompt, buildStorySharedPrefix } from "./story-prompt-cache.js";

/* ================================
   SCENE ROLE SYSTEM - STORY1
================================ */
const STORY1_SYSTEM = `
[장면 역할 – 도입 / 발단]

이 장면은 이야기의 시작점이다.
인물은 이미 존재하는 인물이며,
독자는 지금 처음 그를 만난다.

이 장면은 "설정 설명"이 아니다.
실제 장면이다.

반드시 다음을 충족한다:

1. 캐릭터의 삶의 위치가 드러난다
   (직업, 역할, 소속, 존재 목적 중 최소 하나)

2. 평소 상태 또는 일상의 흐름을 먼저 보여준다

3. 그 일상 위에 작은 균열이 발생한다
   (사건의 시작점)

4. 인물의 태도, 가치관, 스탠스가
   행동으로 드러난다 (설명 금지)

5. 아직 위기는 폭발하지 않는다
   클라이막스 금지
   결말 암시 금지

[선택지 설계 규칙 – STORY1]
선택지는 다음 장면을 실제로 유도하는
구체적인 행동 문장이어야 한다.

추상적 표현 금지:
- 설득한다
- 공격한다
- 거부한다

선택지는 STORY 마지막 문장에 그대로 이어 붙이면
자연스러운 소설 문단이 되어야 한다.
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
        const dynamicPrompt = buildStory1DynamicPrompt();
        const prompt = cachedContent
            ? dynamicPrompt
            : `${sharedPrefix}

${dynamicPrompt}`.trim();
        const modelId = s.aiCache?.storyPrefix?.modelId || GEMINI_STORY1_MODEL;

        const result = await callStorySceneWithRetry(uid, prompt, STORY1_SYSTEM, {
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
            stage: "story1",
            tag: "STORY1_JSON_SCHEMA",
            modelId: result.modelId,
            usageMetadata: result.usageMetadata,
        });

        s.output.story1 = {
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
        console.error("[STORY1][FAIL_FINAL]", { uid, err: err?.message });
        await deleteSession(uid);
        res.write(`event: error\ndata: STREAM_FAILED\n\n`);
        res.end();
    }
}

export default withApi("expensive", async (req, res, { uid }) => {
    const s = await getSession(uid);
    if (!s || !s.nowFlow.story1) {
        return res.status(400).json({ ok: false });
    }

    if (req.method === "PUT") {
        s.selected = s.selected || {};
        s.selected.story1 = req.body.index;

        s.nowFlow.story1 = false;
        s.nowFlow.story3 = true;

        s.called = false;
        s.resed = false;
        s.lastCall = 0;

        await setSession(uid, s);
        return res.json({ ok: true });
    }

    return stream(uid, s, res);
});
