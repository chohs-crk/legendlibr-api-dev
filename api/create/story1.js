export const config = {
    runtime: "nodejs",
    compute: 1,
};

import { getSession, setSession, deleteSession } from "../base/sessionstore.js";
import { callStorySceneWithRetry } from "./callStoryAI.js";
import { withApi } from "../_utils/withApi.js";

/* ================================
   SCENE ROLE SYSTEM - STORY1
================================ */
const STORY1_SYSTEM = `
[장면 역할 – 승 / 도입부]

이 장면은 이야기의 첫 장면이다.
이 인물은 이미 존재하는 인물이며,
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
   BUILD PROMPT (최소화)
================================ */
function buildPrompt(s) {
    const origin = s.input.origin;
    const region = s.input.region;

    const { name, intro, existence, canSpeak, speechStyle, narrationStyle, theme, profile } = s.output;

    return `
[캐릭터 기본 정보]
이름: ${name}
존재 형태: ${existence}
발화 가능 여부: ${canSpeak ? "가능" : "불가"}

[이 인물이 이렇게 설정된 이유]
${intro}

[이 인물의 말투 지시]
${speechStyle}

[이 인물의 서술 문체 지시]
${narrationStyle}

[이 인물의 핵심 설정 메모]
${profile}

[세계관]
기원: ${origin.name} - ${origin.desc}
지역: ${region.name} - ${region.detail}

[핵심 주제]
${theme}

이 인물을 장면 속에서 보여라.
설정 설명 금지.
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
   STREAM (서버가 JSON 완성본을 만든 뒤 SSE로 흘림)
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

        // ✅ 99%+ 안정화: JSON 스키마 기반 + 서버 검증 + 재시도
        const result = await callStorySceneWithRetry(uid, prompt, STORY1_SYSTEM, {
            modelId: "gemini-2.5-flash",
            temperature: 0.35,
            topP: 0.8,
            maxOutputTokens: 1024,
            maxRetry: 3,
        });

        const scene = result.scene;

        pushUsageCall(s, {
            stage: "story1",
            tag: "STORY1_JSON_SCHEMA",
            modelId: result.modelId,
            usageMetadata: result.usageMetadata,
        });

        // ✅ 서버 저장 (score 포함, 클라이언트 전송 X)
        s.output.story1 = {
            story: scene.story,
            choices: scene.choices.map((c) => ({
                text: c.text,
                score: c.score, // ✅ 내부 저장만
            })),
        };

        s.resed = true;
        await setSession(uid, s);

        // ✅ 스토리 전송 (클라이언트는 기존대로 "message" 이벤트 처리)
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
        console.error("[STORY1][FAIL_FINAL]", { uid, err: err?.message });

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