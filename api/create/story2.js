export const config = { runtime: "nodejs" };


import { getSession, setSession } from "../base/sessionstore.js";
import { callStoryAIStream } from "./callStoryAI.js";
import { withApi } from "../_utils/withApi.js";




/* ---------------- PARSE ---------------- */
function parseStory(text) {
    const storyMatch = text.match(/<STORY>([\s\S]*?)<\/STORY>/);
    const choiceMatch = text.match(/<CHOICES>([\s\S]*?)<\/CHOICES>/);

    const story = storyMatch ? storyMatch[1].trim() : "";
    const rawChoices = choiceMatch ? choiceMatch[1].trim().split("\n") : [];

    const choices = rawChoices.map(c => {
        const m = c.trim().match(/^(.*)\s+#(\d+)$/);
        return {
            text: m ? m[1].trim() : c.trim(),
            rawScore: m ? parseInt(m[2]) : 0
        };
    });

    return { story, choices };
}

/* ---------------- PROMPT (story2) ---------------- */
function buildPrompt(s) {
    const prev = s.output.story1?.story || "";
    const choice = s.output.story1?.choices[s.selected?.story1]?.text || "";

    const refinedName = s.output.name || s.input.name;
    const refinedIntro = s.output.intro || s.input.prompt;
    const theme = s.output.theme || "";

    return `
[CHAR]
이름: ${refinedName}
배경: ${refinedIntro}
주제: ${theme}
심리: 선택으로 인해 흔들리는 감정 / 새로운 각성 or 갈등의 심화

[PREVIOUS]
${prev}

[PLAYER_CHOICE]
"${choice}"

[SECOND_ACT]
- 선택의 직접적 결과를 보여준다
- 대립 대상 또는 장애물 등장
- 관계(동료/적/중립) 묘사 가능
- 갈등 단계 상승 (내적 vs 외적)

[분위기]
세계관의 특징이 드러나는 사건/장소
지역과 기원의 문화 차이 강조

[금지]
- 결말
- 이전 문장 반복
- 선택지를 설명하는 직접 문장
`;
}

/* ---------------- SENTENCE ---------------- */
function flushSentences(buffer, onFlush) {
    let rest = buffer;
    while (true) {
        const m = rest.match(/^([\s\S]*?[.!?…])(\s+|$)/);
        if (!m) break;

        onFlush(m[1]);

        // ★ 문장 뒤 공백까지 같이 소비
        rest = rest.slice(m[1].length + (m[2]?.length || 0));
    }
    return rest;
}


/* ---------------- STREAM ---------------- */
async function stream(uid, s, res) {
    res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "Connection": "keep-alive"
    });

    // ★ TF 상태 즉시 저장
    s.called = true;
    s.resed = false;
    s.lastCall = Date.now();
    await setSession(uid, s);

    let full = "";
    let sentenceBuffer = ""; // 문장을 만들기 위한 임시 바구니
    let firstFlushDone = false; // ★ 추가
    const prompt = buildPrompt(s);

    let inStory = false;
    try {
    await callStoryAIStream(uid, delta => {
        full += delta;

        // ★ STORY 태그 진입 전
        if (!inStory) {
            const idx = full.indexOf("<STORY>");
            if (idx !== -1) {
                inStory = true;

                // ✅ 핵심: 기존 텍스트 절대 사용 금지
                sentenceBuffer = "";
                firstFlushDone = false;
            }
            return; // STORY 전에는 아무것도 보내지 않음
        }

        // ★ STORY 내부: 오직 delta만 누적
        sentenceBuffer += delta;

        // ✅ 문장 단위 flush만 허용
        sentenceBuffer = flushSentences(sentenceBuffer, sentence => {
            res.write(`data: ${sentence}\n\n`);
        });

        // ❌ UX flush 완전히 제거
    }, prompt);
    } catch (e) {
        s.called = false;
        s.resed = false;
        s.lastCall = 0;
        await setSession(uid, s);
        return res.json({ ok: false, error: "AI_FAILED" });
    }


    // AI 스트리밍이 끝난 후 바구니에 남은 찌꺼기(마지막 문장) 처리
    if (sentenceBuffer.trim()) {
        res.write(`data: ${sentenceBuffer}\n\n`);
    }

    // 그 이후에 choices 정보 전송
    const parsed = parseStory(full);
    res.write(`event: choices\ndata: ${JSON.stringify({
        choices: parsed.choices.map(c => c.text)
    })}\n\n`);

    // ---- 점수는 서버 내부 전용 ----
    const sorted = [...parsed.choices].sort((a, b) => b.rawScore - a.rawScore);
    if (sorted[0]) sorted[0].score = 3;
    if (sorted[1]) sorted[1].score = 2;
    if (sorted[2]) sorted[2].score = 1;

    s.output.story2 = {
        story: parsed.story,
        choices: parsed.choices.map(c => ({
            text: c.text,
            score: sorted.find(s => s.text === c.text)?.score || 0
        }))
    };

    s.resed = true;
    await setSession(uid, s);

    /* ===== 스트리밍 종료 후 서버 세션 전체 로그 ===== */
    console.log(
        "[STORY1_STREAM_END]",
        JSON.stringify(s, null, 2)
    );
    /* ============================================= */

    res.write(`event: done\ndata: end\n\n`);
    res.end();

}

/* ---------------- HANDLER ---------------- */
export default withApi("expensive", async (req, res, { uid }) => {
    const s = await getSession(uid);
    if (!s || !s.nowFlow.story2) {
        return res.status(400).json({ ok: false });
    }

    const now = Date.now();

    if (req.method === "PUT") {
        s.selected = s.selected || {};
        s.selected.story2 = req.body.index;
        s.nowFlow.story2 = false;
        s.nowFlow.story3 = true;
        s.called = false;
        s.resed = false;
        s.lastCall = 0;
        await setSession(uid, s);
        return res.json({ ok: true });
    }

    const force = req.body?.force === true;

    if (
        !force &&
        s.called &&
        !s.resed &&
        s.lastCall > 0 &&
        now - s.lastCall < 30000
    )
        return res.json({
            ok: true,
            status: "waiting",
            remain: 30000 - (now - s.lastCall)
        });


    if (s.called && s.resed)
        return res.json({
            ok: true,
            status: "done",
            story: s.output.story2.story,
            choices: s.output.story2.choices.map(c => ({ text: c.text }))
        });

    return stream(uid, s, res);
});