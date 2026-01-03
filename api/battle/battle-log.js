export default async function handler(req, res) {
    // ---- CORS (필요 없다면 삭제 가능) ----
    const ALLOWED = ["https://legendlibr.web.app"];
    const origin = req.headers.origin;
    if (ALLOWED.includes(origin)) {
        res.setHeader("Access-Control-Allow-Origin", origin);
    }
    res.setHeader("Vary", "Origin");
    res.setHeader("Access-Control-Allow-Credentials", "true");
    res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

    if (req.method === "OPTIONS") return res.status(204).end();
    if (req.method !== "POST") return res.status(405).json({ ok: false, error: "POST only" });

    const API_KEY = process.env.OPENAI_API_KEY;
    if (!API_KEY) return res.status(500).json({ ok: false, error: "OPENAI_API_KEY not set" });

    try {
        const data = req.body || {};

        // ---------- 프롬프트 구성 ----------
        const systemPrompt = buildSystemPrompt(data);

        const userPrompt = buildPrompt(data);

        // ---------- OpenAI 호출 ----------
        const r = await fetch("https://api.openai.com/v1/chat/completions", {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${API_KEY}`,
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                model: "gpt-4o-mini-2024-07-18",
                response_format: { type: "json_object" },
                messages: [
                    { role: "system", content: systemPrompt },
                    { role: "user", content: userPrompt }
                ]
            })
        });

        if (!r.ok) {
            const t = await r.text().catch(() => "");
            return res.status(502).json({ ok: false, error: "OpenAI error", detail: t });
        }

        // ---------- JSON 추출 ----------
        const j = await r.json();
        let text = j?.choices?.[0]?.message?.content || "";
        text = text.replace(/```json/gi, "").replace(/```/g, "").trim();
        const first = text.indexOf("{");
        const last = text.lastIndexOf("}");
        if (first !== -1 && last !== -1) text = text.substring(first, last + 1);

        const parsed = JSON.parse(text);

       
        // ---------- 출력 정규화 ----------
        if (data.final) {
            return res.status(200).json({
                

                resultText: parsed.resultText || "결정적인 일격이 오갔다..."
            });
        } else {
            // ✅ choices 정규화
            let choices = [];
            if (
                Array.isArray(parsed.choices) &&
                parsed.choices.length === 3 &&
                parsed.choices.every(n => Number.isInteger(n) && n >= 0 && n <= 3)
            ) {
                choices = parsed.choices;
            }

            // ✅ skillScores 정규화
            let skillScores = { 0: 5, 1: 5, 2: 5, 3: 5 };
            if (typeof parsed.skillScores === "object") {
                for (let i = 0; i < 4; i++) {
                    const v = Number(parsed.skillScores[i]);
                    if (Number.isFinite(v) && v >= 1 && v <= 10) {
                        skillScores[i] = Math.round(v);
                    }
                }
            }
           
            return res.status(200).json({
                narration: parsed.narration || "전장의 기류가 흘러간다...",
                battleMood: parsed.battleMood || "",
                hint: parsed.hint || "",
                choices,
                skillScores,
                
            });

        }
        



    } catch (err) {
        console.error(err);
        return res.status(500).json({
            narration: "전투의 흐름을 해석할 수 없습니다...",
            battleMood: "전장의 기운이 혼란스럽습니다.",
            hint: "",
            choices: [],
            skillScores: { 0: 5, 1: 5, 2: 5, 3: 5 },
           
        });
    }
}

// ----------------- 프롬프트 빌더 -----------------

function buildSystemPrompt(d) {
    const {
        winner,
        final,
        finalWinner
    } = d;

    let prompt = `
너는 TRPG 전투 연출 전문 AI다.
반드시 JSON 형식으로만 출력한다.
      [표현 규칙 - 반드시 출력에 포함]
1. 중요한 단어는 강조
- 강조 키워드는  **와 **로 감싼다 (최대 2개)
- 대사는 반드시 §와 §로 감싼다. 예: §지금이다§ (최대 1개)
- 사용 스킬명은 반드시 『스킬명』 형식으로 출력한다
- 이 규칙이 하나라도 어긋나면 출력은 실패로 간주한다

현재 턴 기준 우위자: ${winner || "판단 불가"}

⚠️ 일반 턴에서는 다음 표현을 가급적 사용하지 마라(결말에서는 허용):
    - "두 존재", "두 영혼", "그 순간", "전투의 서막"
        - "운명이 엮였다", "긴장감이 고조되었다"
        - "각오", "결의", "의지", "느꼈다", "직감했다" 같은 감정 추상어

✅ 일반 턴에서는 추상 표현보다 다음을 우선하라:
    - 구체 대상(사물, 생물, 구조물, 마법 잔재 등)
        - 시각적 결과(부서짐, 흔들림, 불꽃, 파편)
            - 공간 변화(균열, 낙하, 그림자 이동)
            `;
    if (final) {
        prompt += `
        

이 전투의 최종 승자: ${finalWinner || winner || "판단 불가"}

⚠️ 마지막 출력은 반드시 위 승자를 기준으로 서술한다.
패자는 전투 불능 상태가 되며, 승자는 결정적인 승리를 차지한다.
`;
    }

    prompt += `
연출 규칙:
- 유불리 명확히 구분
- 중립적인 묘사 금지
`;

    return prompt.trim();
}


function buildPrompt(d) {
    const {
        turn,
        currentSkill = {},
        allSkills = {},
        effects = [],
        hpAnalysis,
        characters = {},
        final,
        winner,
        hpGap,
        phase = "전투 중반",     // ✅ 추가
        tone = "긴박함"         // ✅ 추가
    } = d;


    const { previousStory = "" } = d;

    const effText = effects.length
        ? effects.map(e => `- ${e.target} 대상: ${e.effect} (${e.valid ? "유효" : "실패"})`).join("\n")
        : "없음";

    const hpText = hpAnalysis ? `
A 체력 변화: ${hpAnalysis.A.before} → ${hpAnalysis.A.after}
B 체력 변화: ${hpAnalysis.B.before} → ${hpAnalysis.B.after}
` : "";


    // ---- 마지막 턴 ----
    if (final) {
        return `
너는 전투 장면 연출 전문 AI다.
아래 정보를 바탕으로 '마지막 사용 스킬'과 '전투가 끝난 장면'을 묘사하라.
각각 캐릭터의 행동과 분위기를 기준으로 과하지 않게 서술한다.

✅ 이 섹션은 결말 구간이다.
- 감정, 운명, 긴장감, 여운 표현 허용
- 승자/패자 대비와 여파를 강조
-단, 직접적으로 누가 승리했다는 묘사를 비슷한 표현으로 대체
-극적, 우위 같은 단어도 유사 표현으로 대신해 서술 깊이 높이기

⚠️ 그래도 금지:
- "마주했다"
- "막 시작하려 한다"





[이번에(마지막) 사용한 스킬]
A: ${currentSkill.A?.name || ""}
B: ${currentSkill.B?.name || ""}
[중요 규칙]
- 사용할 수 있는 스킬 이름은 위 두 개뿐이다.
- 위 목록에 없는 스킬명을 절대 출력하지 마라.
- 단어 하나라도 다르면 잘못된 출력이다.
- 철자, 띄어쓰기, 기호까지 한 글자도 변경 금지.
- 새로운 스킬명을 만들면 출력 실패로 간주된다.- 승자의 스킬만 묘사.
- 해당 스킬의 구체적 행동을 같이 묘사한다.
- 스킬이 어떻게 상대를 쓰러뜨렸는지 “행동 → 결과” 흐름으로 묘사한다.

[캐릭터]
A: ${characters.A?.name || ""} / ${characters.A?.origin || ""}
B: ${characters.B?.name || ""} / ${characters.B?.origin || ""}

HP, %, 수치 표현은 절대 사용하지 마라.
전부 자연어 묘사로 표현하라.

[연출 타입 지시]
endingType = ${d.endingType}

위에 어울리는 형식의 상황과 동작들을 묘사한다.

한글로 출력
아래 JSON으로만 출력하라:

{
  
  "resultText": "결정적인 마지막 장면을 사용 스킬과 행동 위주로 묘사",
  
}
`.trim();
    }


    // ---- 일반 턴 ----
    return `
아래는 지금까지의 전투 서사이다:

==========
${previousStory}
==========

이제 다음 턴 장면만 "새롭게" 이어서 서술하라.
4문장 내외 분량
기존 묘사를 반복하지 말고, 이전 상황을 요약하지도 마라.

이번 턴의 전투 장면만 소설처럼 묘사하라.

기절, 패배, 죽음, 전투 종료 등 묘사를 지양하고 대신 휘청거림, 기세에 눌림, 상처 누적 등으로 대체

- 결말이 아니라면 감정, 운명, 긴장감 같은 추상어는 최대한 자제
- 반드시 아래 중 하나 이상은 포함:
  * 환경(제단, 벽, 바닥, 기둥, 마법 잔광 등)
  * 제3의 존재(짐승, 요정, 망령, 관측자 등)
  * 물리 반응(튕김, 깨짐, 붕괴, 무너짐)

- 대신 다음을 중심으로 4문장 내외 분량을 지키며 묘사한다:
  * 물리적 행동 (회피, 충돌, 밀침, 낙하)
  * 환경 변화 (균열, 먼지, 바람, 균열음)
  * 무기의 움직임 (궤적, 반동, 타격감)
  
다음 턴에 사용할 스킬 후보를 3개 반환(0~3)
[전략 점수 산정 규칙]
skillScores는 반드시 아래 기준으로 생성한다:
 - 스킬 설명(desc)에 드러난 조건부 발동 여부
 - 연계 가능성 (다른 스킬과 조합 시 보너스/패널티)
- 상황 적합성 (현재 HP, 효과, 전황에 맞는가)
[전투 국면] ${phase}
[전황 분위기] ${tone}


[이번에 사용한 스킬]
A: ${currentSkill.A?.name || ""}
B: ${currentSkill.B?.name || ""}

[전체 스킬 목록]
A:
${(allSkills.A || []).map(s => `- [${s.index}] ${s.name}: ${s.desc}`).join("\n")}

B:
${(allSkills.B || []).map(s => `- [${s.index}] ${s.name}: ${s.desc}`).join("\n")}


[발동 효과]
${effText}

[체력 분석]
${hpText}

[캐릭터]
A: ${characters.A?.name || ""} (${characters.A?.origin || ""}) 특징: ${(characters.A?.features || []).join(", ")}
B: ${characters.B?.name || ""} (${characters.B?.origin || ""}) 특징: ${(characters.B?.features || []).join(", ")}

한글로 출력
아래 형식의 JSON으로만 응답하라:

{
  "narration": "이번 턴 장면 묘사",
  "battleMood": "전장의 분위기 요약",
  "hint": "다음 행동 암시",

  "choices": [0, 2, 3],
  "skillScores": {
    "0": 7,
    "1": 4,
    "2": 9,
    "3": 6
    },
}
`.trim();
}
