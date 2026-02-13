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

/* ---------------- PROMPT (story3) ---------------- */
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

    const p1 = s.output.story1?.story || "";

    const origin = s.input.origin;
    const region = s.input.region;
    const selectedIndex1 = s.selected?.story1;
    const selectedChoice1 =
        s.output.story1?.choices?.[selectedIndex1]?.text || "";
    return `
[이야기 전제]
이 장면은 이야기의 전환점이다.
되돌릴 수 없는 사건이나 진실이 드러난다.
선택이라는 개념은 언급하지 않는다.

[선택지 생성 지침]
 - 선택지는 다음 장면으로 바로 이어질 수 있는 서술 문장이다
 - "만약", "하려 한다", "하려고 한다" 같은 가정형 표현 금지
 - 이미 행동이 시작되었거나 결정된 것처럼 서술한다
 - 선택지는 STORY에 이어 붙여도 어색하지 않아야 한다
 - 문장 부호가 포함되어야 한다.
 - 직전 문장 다음에 올 소설 문장처럼 생각하라


[이전 서사 처리 규칙 - 매우 중요]

- 이전 서사는 절대 요약하지 않는다
- 이전 내용을 다시 설명하지 않는다
- 같은 장면을 다시 묘사하지 않는다
- 같은 장소, 같은 행동을 다시 시작하지 않는다


- 반드시 이전 이야기의 "마지막 문장 직후 1~3초 후 시점"에서 시작한다
- 이전 사건은 배경으로만 존재하며 직접 언급하지 않는다
- 이미 벌어진 일은 암묵적으로 전제하고, 새로운 정보나 변화만 서술한다
- 이전 장면의 분위기는 유지하되 문장은 완전히 새로 써야 한다

이야기는 항상 전진해야 한다.
절대 되돌아가지 않는다.

[이전 서사]
${p1}

[직전의 장면에서 발생한 행동]

${selectedChoice1}

※ 위 행동들은 이미 실제로 실행되었다.
※ 그 결과 직후부터 서술을 시작한다.
※ 선택지라는 개념은 절대 언급하지 않는다.



[캐릭터 고정 정보]
이름: ${name}
소개: ${intro}
존재 형태: ${existence}
발화 가능 여부: ${canSpeak ? "직접 대사 가능" : "직접 대사 불가"}

대사 방식 규칙:
${speechStyle}

서술 문체 규칙:
${narrationStyle}

[결정적 장면 지침]
- 클라이막스 부분을 서술하는 느낌
- 감정은 직접 설명하지 않는다
- 발화 불가인 경우, 침묵·행동·환경 변화로만 표현한다
- 결말을 말하지 말고, 바로 직전에서 멈춘다

[연속성 엄수 규칙]

- 이전 서사를 절대 반복하거나 재서술하지 않는다
- 동일한 문장을 변형하여 다시 쓰지 않는다
- 이미 언급된 설정을 다시 설명하지 않는다
- 이야기는 반드시 직전 사건의 '이후 시점'에서 시작한다
- 이전 이야기의 마지막 문장 직후부터 이어진다고 가정한다

[세계 배경 참고]
- origin은 이 인물이 속한 전체 세계관과 시대적 배경이다
- region은 그 세계관 안에 존재하는 구체적인 공간이다
기원: ${origin.name} - ${origin.desc}
지역: ${region.name} - ${region.detail}


[주제]
${theme}

※ 위 주제는 이 이야기의 핵심 갈등과 방향성을 나타낸다.
※ 결말은 반드시 이 주제의 귀결을 보여주어야 한다.
※ 단, 주제를 직접 설명하거나 반복하지 말고
   인물의 상태 변화와 장면을 통해 드러내야 한다.
※ 주제에 포함된 감정, 가치관, 갈등 요소 중 최소 하나 이상이
   결말에서 명확히 드러나야 한다.


[절대 금지]
- 결말 서술
- 억지 교훈적인 내용
- 선택, 결단, 다음 행동 암시에 관한 서술
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

    s.called = true;
    s.resed = false;
    s.lastCall = Date.now();
    await setSession(uid, s);

    let full = "";
    let sentenceBuffer = "";
    const prompt = buildPrompt(s);

    let inStory = false;
    try {
        await callStoryAIStream(uid, delta => {
            if (typeof delta === "string") {
                delta = delta.replace(/#\d+/g, ""); // 스트리밍 출력에서 점수 제거
            }
            full += delta;

            if (!inStory) {
                const idx = full.indexOf("<STORY>");
                if (idx !== -1) {
                    inStory = true;
                    // ✅ 변경: <STORY> 태그 이후에 포함된 텍스트를 버리지 않고 보존함
                    sentenceBuffer = full.substring(idx + 7);
                }
                return;
            }

            // STORY 태그 내부라면 텍스트 누적
            sentenceBuffer += delta;

            // 문장 단위로 클라이언트 전송
            sentenceBuffer = flushSentences(sentenceBuffer, sentence => {
                const cleanSentence = sentence.replace(/\s+#\d+\s*$/g, "");
                res.write(`data: ${cleanSentence}\n\n`);
            });
        }, prompt);
    } catch (e) {
        s.called = false;
        s.resed = false;
        s.lastCall = 0;
        await setSession(uid, s);
        return res.end(); // 에러 발생 시 종료
    }

    // 마지막 남은 문장 처리
    if (sentenceBuffer.trim()) {
        const clean = sentenceBuffer.replace(/\s+#\d+\s*$/g, "");
        res.write(`data: ${clean}\n\n`);
    }

    // 선택지 정보 전송 및 세션 저장 (기존 로직 유지)
    const parsed = parseStory(full);
    res.write(`event: choices\ndata: ${JSON.stringify({
        choices: parsed.choices.map(c => c.text)
    })}\n\n`);

    // ---- 점수 서버 전용 ----
    const sorted = [...parsed.choices].sort((a, b) => b.rawScore - a.rawScore);
    if (sorted[0]) sorted[0].score = 3;
    if (sorted[1]) sorted[1].score = 2;
    if (sorted[2]) sorted[2].score = 1;

    s.output.story3 = {
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
    if (!s || !s.nowFlow.story3) {
        return res.status(400).json({ ok: false });
    }

    const now = Date.now();

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
            story: s.output.story3.story,
            choices: s.output.story3.choices.map(c => ({ text: c.text }))
        });

    return stream(uid, s, res);
});