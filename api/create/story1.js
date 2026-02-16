export const config = {
    runtime: "nodejs",
    compute: 1
};

import { getSession, setSession } from "../base/sessionstore.js";
import { callStoryAIStream } from "./callStoryAI.js";
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

────────────────

[선택지 설계 규칙 – STORY1]

선택지는 다음 장면을 실제로 유도하는
구체적인 행동 문장이어야 한다.

추상적 표현 금지:
- 설득한다
- 공격한다
- 거부한다

구체적 장면이 떠올라야 한다.

선택지는 STORY 마지막 문장에 그대로 이어 붙이면
자연스러운 소설 문단이 되어야 한다.
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
   BUILD PROMPT (최소화)
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
            STORY1_SYSTEM
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

    s.output.story1 = {
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
