export const config = {
    runtime: "nodejs",
    compute: 1
};



import { getSession, setSession } from "../base/sessionstore.js";
import { callStoryAIStream } from "./callStoryAI.js";
import { withApi } from "../_utils/withApi.js";




/* ---------------- PARSE ---------------- */
function parseStory(text) {
    const storyMatch = text.match(/<STORY>([\s\S]*?)<\/STORY>/);
    

    const story = storyMatch ? storyMatch[1].trim() : "";
    const choiceMatch =
        text.match(/<CHOICES>([\s\S]*?)<\/CHOICES>/) ||
        text.match(/<CHOICES>([\s\S]*)$/); // 닫는 태그 없을 경우 보정

    const rawChoices = choiceMatch
        ? choiceMatch[1]
            .trim()
            .split("\n")
            .map(l => l.trim())
            .filter(Boolean)
        : [];

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
    const {
        name,
        intro,
        existence,
        canSpeak,
        speechStyle,
        narrationStyle,
        theme
    } = s.output;

    const prevStory = s.output.story1?.story || "";
    const origin = s.input.origin;
    const region = s.input.region;

    return `
[이야기 전제]
이 장면은 이전 이야기의 연속이다.
이미 벌어진 일들의 자연스러운 다음 국면을 서술한다.
선택이나 분기라는 개념은 존재하지 않는다.

[선택지 생성 지침]
 - 선택지는 다음 장면으로 바로 이어질 수 있는 서술 문장이다
 - "만약", "하려 한다", "하려고 한다" 같은 가정형 표현 금지
 - 이미 행동이 시작되었거나 결정된 것처럼 서술한다
 - 선택지는 STORY에 이어 붙여도 어색하지 않아야 한다
 - 문장 부호가 포함되어야 한다.
 - 직전 문장 다음에 올 소설 문장처럼 생각하라

[이전 서사]
${prevStory}

[캐릭터 고정 정보]
이름: ${name}
소개: ${intro}
존재 형태: ${existence}
발화 가능 여부: ${canSpeak ? "직접 대사 가능" : "직접 대사 불가"}

대사 방식 규칙:
${speechStyle}

서술 문체 규칙:
${narrationStyle}

[전개 지침]
- 캐릭터의 신념이나 일상이 외부 요인과 충돌한다
- 감정은 설명하지 말고 행동과 반응으로 드러낸다
- 직접 대사가 불가한 경우, §대사§를 사용하지 않는다
- 긴장을 높이되 결말로는 가지 않는다

[세계 배경 참고]
기원: ${origin.name}
지역: ${region.name}

[주제]
${theme}

[절대 금지]
- 선택, 결단, 갈림길이라는 표현
- 독자에게 질문을 던지는 문장
- 이야기 요약
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
            // 🔥 SSE 로 보내기 전, delta 에서 #숫자 패턴을 모두 제거
            if (typeof delta === "string") {
                delta = delta.replace(/#\d+/g, "");
            }
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
            // 🔥 선택지 후보는 스트리밍 금지
            if (sentence.includes("#")) return;

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