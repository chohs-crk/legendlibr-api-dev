export const config = {
    runtime: "nodejs",
    compute: 1
};

import { getSession, setSession } from "../base/sessionstore.js";
import { callStoryAIStream } from "./callStoryAI.js";
import { withApi } from "../_utils/withApi.js";


/* ================================
   SCENE ROLE SYSTEM - STORY3
================================ */

const STORY3_SYSTEM = `
[장면 역할 – 전 / 전환점]

이 장면은 전환점이다.
이미 사건은 시작되었다.
일상은 더 이상 존재하지 않는다.

선택지에 적힌 행동은
이미 실행된 상태로 장면을 시작해야 한다.

선택지를 그대로 반복하지 말고,
그 행동이 실제로 벌어지는 장면을 묘사하라.

반드시:

1. 이전 장면 직후 시점
2. 선택지 행동의 구체적 실행 장면
3. 상황의 확대 또는 충돌
4. 되돌리기 어려운 변화
5. 결말 직전에서 멈춘다

결말 서술 금지.
요약 금지.
교훈 금지.
`;


/* ================================
   PARSE
================================ */

function parseStory(text) {
    const storyMatch = text.match(/<STORY>([\s\S]*?)<\/STORY>/);
    const story = storyMatch ? storyMatch[1].trim() : "";

    const choiceMatch =
        text.match(/<CHOICES>([\s\S]*?)<\/CHOICES>/) ||
        text.match(/<CHOICES>([\s\S]*)$/);

    const rawChoices = choiceMatch
        ? choiceMatch[1]
            .trim()
            .split("\n")
            .map(l => l.trim())
            .filter(Boolean)
        : [];

    const choices = rawChoices.map(c => {
        const m = c.match(/^(.*)\s+#(\d+)$/);
        return {
            text: m ? m[1].trim() : c.trim(),
            rawScore: m ? parseInt(m[2]) : 0
        };
    });

    return { story, choices };
}


/* ================================
   BUILD PROMPT
================================ */

function buildPrompt(s) {

    const origin = s.input.origin;
    const region = s.input.region;

    const {
        name,
        intro,
        existence,
        canSpeak,
        speechStyle,
        narrationStyle,
        theme,
        profile
    } = s.output;

    const prevStory = s.output.story1?.story || "";
    const selectedIndex = s.selected?.story1;
    const selectedChoice =
        s.output.story1?.choices?.[selectedIndex]?.text || "";

    return `
[이전 장면]
${prevStory}

[이미 실행된 행동]
${selectedChoice}

이 행동은 이미 실제로 벌어졌다.
그 실행 장면을 구체적으로 묘사하라.

[이 인물이 이렇게 설정된 이유]
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
`;
}


/* ================================
   STREAM
================================ */

async function stream(uid, s, res) {

    res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "Connection": "keep-alive"
    });

    s.called = true;
    s.resed = false;
    s.lastCall = Date.now();
    await setSession(uid, s);

    let full = "";
    let sentenceBuffer = "";
    const prompt = buildPrompt(s);

    let inStory = false;

    try {
        await callStoryAIStream(
            uid,
            delta => {

                if (typeof delta === "string") {
                    delta = delta.replace(/#\d+/g, "");
                }

                full += delta;

                if (!inStory) {
                    const idx = full.indexOf("<STORY>");
                    if (idx !== -1) {
                        inStory = true;
                        sentenceBuffer = full.substring(idx + 7);
                    }
                    return;
                }

                sentenceBuffer += delta;

                const m = sentenceBuffer.match(/^([\s\S]*?[.!?])\s+/);
                if (m) {
                    const sentence = m[1];
                    res.write(`data: ${sentence}\n\n`);
                    sentenceBuffer = sentenceBuffer.slice(m[0].length);
                }
            },
            prompt,
            STORY3_SYSTEM
        );
    } catch (e) {
        s.called = false;
        s.resed = false;
        s.lastCall = 0;
        await setSession(uid, s);
        return res.end();
    }

    const parsed = parseStory(full);

    res.write(`event: choices\ndata: ${JSON.stringify({
        choices: parsed.choices.map(c => c.text)
    })}\n\n`);

    const sorted = [...parsed.choices].sort((a, b) => b.rawScore - a.rawScore);
    if (sorted[0]) sorted[0].score = 3;
    if (sorted[1]) sorted[1].score = 2;
    if (sorted[2]) sorted[2].score = 1;

    s.output.story3 = {
        story: parsed.story,
        choices: parsed.choices.map(c => ({
            text: c.text,
            score: sorted.find(x => x.text === c.text)?.score || 0
        }))
    };

    s.resed = true;
    await setSession(uid, s);

    res.write(`event: done\ndata: end\n\n`);
    res.end();
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
