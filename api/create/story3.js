export const config = {
    runtime: "nodejs",
    compute: 1,
};

import { getSession, setSession, deleteSession } from "../base/sessionstore.js";
import { callStorySceneWithRetry } from "./callStoryAI.js";
import { withApi } from "../_utils/withApi.js";

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

/* ================================
   AI USAGE LOGGER
================================ */
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

/* ================================
   BUILD PROMPT
================================ */
function buildPrompt(s) {
    const origin = s.input.origin;
    const region = s.input.region;

    const { intro, speechStyle, narrationStyle, theme, profile } = s.output;

    const prevStory = s.output.story1?.story || "";
    const selectedIndex = s.selected?.story1;
    const selectedChoice = s.output.story1?.choices?.[selectedIndex]?.text || "";

    return `
[이전 장면]
${prevStory}

[이미 실행된 행동]
${selectedChoice}

이 행동은 이미 실제로 벌어졌다.
그 이후 벌어질 장면을 구체적으로 묘사한다.

[소설 주인공 소개]
${intro}

[말투 지시]
${speechStyle}

[문체 지시]
${narrationStyle}

[설정 메모]
${profile}

[세계]
기원: ${origin.name} - ${origin.desc}
지역: ${region.name} - ${region.detail}

[주제]
${theme}
  `.trim();
}

/* ================================
   SSE UTIL
================================ */
function escapeSSEData(text) {
    return String(text || "")
        .replace(/\r?\n/g, " ")
        .replace(/\s+/g, " ")
        .trim();
}

/* ================================
   STREAM
================================ */
async function stream(uid, s, res) {
    res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
    });

    try {
        // ✅ 세션 상태: 호출 시작
        s.called = true;
        s.resed = false;
        s.lastCall = Date.now();
        await setSession(uid, s);

        const prompt = buildPrompt(s);

        const result = await callStorySceneWithRetry(uid, prompt, STORY3_SYSTEM, {
            modelId: "gemini-2.5-flash",
            temperature: 0.35,
            topP: 0.8,
            maxOutputTokens: 1024,
            maxRetry: 3,
        });

        const scene = result.scene;

        pushUsageCall(s, {
            stage: "story3",
            tag: "STORY3_JSON_SCHEMA",
            modelId: result.modelId,
            usageMetadata: result.usageMetadata,
        });

        // ✅ 서버 저장 (score 포함, 클라이언트 전송 X)
        s.output.story3 = {
            story: scene.story,
            choices: scene.choices.map((c) => ({
                text: c.text,
                score: c.score,
            })),
        };

        s.resed = true;
        await setSession(uid, s);

        // ✅ 스토리 전송
        res.write(`data: ${escapeSSEData(scene.story)}\n\n`);

        // ✅ 선택지 전송 (text만)
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

/* ================================
   HANDLER
================================ */
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