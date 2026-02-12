export const config = { runtime: "nodejs" };

import { getSession, setSession, deleteSession } from "../base/sessionstore.js";
import { SAFETY_RULES } from "../base/safetyrules.js";

/**
 * ===========================
 * AI SYSTEM PROMPT (REFINE)
 * ===========================
 *
 * 목표:
 * - 유저 입력을 최대한 반영하되 "소설스럽게" 정제
 * - 이후 story1~final의 고정 기준(존재/말투/문체/주제)을 만들어 둔다
 *
 * 출력은 JSON ONLY
 */

export const SYSTEM_PROMPT = `
${SAFETY_RULES}

너의 출력은 반드시 아래 JSON 형식만 반환해야 한다.
설명, 해설, 번호, 불릿, 따옴표 밖 텍스트 등은 절대 포함하지 마라.
코드블록( \`\`\` ) 도 금지한다.

{
  "nameSafetyScore": 숫자,
  "promptSafetyScore": 숫자,
  "copyrightScore": 숫자,

  "name": "실제 캐릭터 본명",

  "needKorean": false,
  "koreanName": "정규화된 순수 한글 이름",

  "existence": "캐릭터의 존재 형태를 나타내는 실제 표현",

  "intro": "소설 도입부 느낌의 소개글",

  "canSpeak": true,

  "speechStyle": "대사 방식 서술",
  "narrationStyle": "서사 문체 규칙 서술",

  "theme": "유저 입력을 유지한 3문장 서사 주제"
}

[절대 금지: 예시값 출력]
- "홍길동", "기타", "예시" 같은 단어를 실제 출력값으로 사용하지 마라.
- name과 existence는 반드시 이 캐릭터에게 어울리는 실제 값이어야 한다.

────────────────
[점수 규칙]
────────────────
- 모든 점수는 정수형이며 0~100 범위를 가진다.
- 0에 가까울수록 안전, 100에 가까울수록 위험하다.

- nameSafetyScore:
  이름 문자열 자체만을 기준으로 판단한다.
  선정성, 음란성, 실존 인물/저작물 연상,
  비가독성 목적의 문자 조합,
  언어 필터 우회 시도를 강하게 반영한다.

- promptSafetyScore:
  사용자 프롬프트 내용의 안전성을 기준으로 판단한다.
  세계관 내 허용 가능한 서사는 점수를 크게 올리지 않는다.

- copyrightScore:
  특정 작품, 캐릭터, 세계관, 고유 설정이
  명확히 연상될수록 점수를 높인다.

  [점수 기준 인지]
- nameSafetyScore가 60 이상이면 해당 이름은 서비스에서 사용 불가 수준이다.
- promptSafetyScore가 70 이상이면 위험한 프롬프트로 간주된다.
- copyrightScore가 75 이상이면 저작권 침해 가능성이 매우 높다.
- 이 기준을 고려하여 점수를 계산하라. 점수 책정은 엄격해야 한다.


────────────────
[이름(name) 규칙]
────────────────
- name에는 캐릭터의 "실제 본명"만 출력한다.
- 호칭, 직함, 별명, 설명 문구는 모두 제거한다.
- 한글 사용을 기본으로 한다.
- 외국어 개념은 반드시 한글 음역 형태로만 허용한다.
  예: 메이지, 나이트
- 유저 입력이 설명형 문장일 경우,
  핵심이 되는 호칭 하나만 추려서 name으로 사용한다.

  [중요: 언어 규칙 우선순위]
- 본 프롬프트의 언어 판단 규칙은 이름(name) 및 언어 분석 단계에만 적용된다.
- 최종 출력 서사(intro, speechStyle, narrationStyle, theme)는
  SAFETY_RULES의 Language Rules를 따라 한글로만 작성한다.

────────────────
[언어 판단 규칙]
────────────────
- 한글과 영문은 모두 허용된다.
- "나이트"는 한글, "kimchi"는 영문이므로 모두 허용.
- 한글/영문/숫자/일반 특수문자를 제외한 문자가 포함될 경우:
  - 병렬 한글 표기가 없으면 needKorean = true
- 특수문자로만 구성된 이름도 needKorean = true

────────────────
[koreanName 생성 규칙]
────────────────
- 항상 사람이 읽을 수 있는 순수 한글 이름을 생성한다.
- 특수문자는 제거한다.
- 반복 어휘는 하나로 정리한다.
- 한자 및 외국 문자는 의미를 유지한 한글로 치환한다.
- 예:
  - 철혈의 騎士 → 철혈의 기사
  - आत्मन् → 아트만

────────────────
[existence 규칙]
────────────────
- 존재 형태는 한 단어 또는 짧은 명사구로 표현한다.
- 인간, 천사, 용족, 동물, 사물, 개념적 존재 등 자유롭게 가능하다.
- 단, "기타", "기타 등등", "예시"는 절대 사용하지 마라.

────────────────
[intro 규칙]
────────────────
- "소설에 나오는 캐릭터 소개" 같은 느낌으로 작성한다.
- 유저 입력의 구조와 핵심 키워드를 최대한 유지한다.
- 정확히 7~9문장으로 작성한다. (권장 8문장)

────────────────
[서사 표현 규칙]
────────────────
- **텍스트** : 감정·주제 강조 (3~6회 이내)
- 텍스트 양 끝에 ** 를 사용한다
- §텍스트§ : 직접 대사 표현 (대사에만 사용)

────────────────
[canSpeak 규칙]
────────────────
- 캐릭터가 직접 발화 가능한 존재인지 판단한다.
- 세계관과 존재 형태에 맞게 자연스럽게 결정한다.
- 단순 장식용이 아닌, 서사적으로 납득 가능해야 한다.

────────────────
[speechStyle 규칙]
────────────────
- 3~4문장으로 작성한다.
- 말투, 호흡, 감정 표현 방식을 중심으로 서술한다.
- 대사의 길이, 끊김, 감정 노출 정도를 명확히 드러낸다.

────────────────
[narrationStyle 규칙]
────────────────
- 4~6문장으로 작성한다.
- 문체 규칙, 어휘 선택, 비유 성향을 포함한다.
- 감정은 설명보다 행동과 선택된 어휘로 전달한다.

────────────────
[theme 규칙]
────────────────
- intro를 기반으로 한 핵심 주제를 정확히 3문장으로 작성한다.
- 캐릭터의 방향성, 갈등, 정서를 압축적으로 드러낸다.

출력은 반드시 위 JSON 구조만 따라야 한다.
JSON 밖에 어떤 문자도 출력하지 마라.
`;

/* =========================
   UTILS
========================= */
function safeStr(v) {
    if (typeof v !== "string") return "";
    return v.trim();
}

function normalizeBool(v, fallback = true) {
    if (typeof v === "boolean") return v;
    if (typeof v === "string") {
        if (v === "true") return true;
        if (v === "false") return false;
    }
    return fallback;
}

function sentenceCountApprox(text) {
    const t = safeStr(text);
    if (!t) return 0;
    return t.split(/[.!?…]/).map(x => x.trim()).filter(Boolean).length;
}

function isBadExampleValue(s) {
    const t = safeStr(s);
    if (!t) return true;
    return ["홍길동", "기타", "예시"].some(b => t.includes(b));
}
/* =========================
   MAIN
========================= */


export async function callAI(uid) {
    const s = await getSession(uid);
    if (!s) return;

    const { origin, region, name, prompt } = s.input;

    const length = 400 + Math.floor((prompt.length / 700) * 100);

    const originGuide = origin?.narrationGuide
        ? `
[기원 서술 가이드]
톤: ${origin.narrationGuide.tone || ""}
어휘: ${origin.narrationGuide.vocabulary || ""}
문장: ${origin.narrationGuide.sentenceStyle || ""}
이미지: ${origin.narrationGuide.imagery || ""}
금지: ${origin.narrationGuide.forbidden || ""}
`
        : `
[기원 서술 가이드]
- (가이드 없음) 기원 설명과 지역 설명을 바탕으로 자연스러운 문체를 스스로 설정하라
`;

    const userPrompt = `
기원: ${origin?.name || ""} - ${origin?.desc || ""}
기원 추가설명: ${origin?.longDesc || ""}
지역: ${region?.name || ""} - ${region?.detail || ""}

${originGuide}

[유저 입력 원본 – 수정 금지]
이름 원문: ${name}

사용자 프롬프트:
${prompt}

요구:
- 유저 입력의 구조/핵심 키워드를 최대한 유지
- intro는 7~9문장
- speechStyle 3~4문장
- narrationStyle 4~6문장
- theme는 3문장
소개글 길이 힌트: 약 ${length}자
`;
    try {
        const MODEL_ID = "gemini-2.5-flash-lite";
        const API_VERSION = "v1beta";

        const res = await fetch(
            `https://generativelanguage.googleapis.com/${API_VERSION}/models/${MODEL_ID}:generateContent`,
            {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "x-goog-api-key": process.env.GEMINI_API_KEY
                },
                body: JSON.stringify({
                    systemInstruction: {
                        parts: [{ text: SYSTEM_PROMPT }]
                    },
                    contents: [
                        {
                            role: "user",
                            parts: [{ text: userPrompt }]
                        }
                    ],
                    generationConfig: {
                        temperature: 0.6,
                        topP: 0.9,
                        maxOutputTokens: 2048
                    }
                })
            }
        );

        if (!res.ok) {
            throw new Error("GEMINI_REQUEST_FAILED");
        }

        const data = await res.json();

        const text =
            data.candidates?.[0]?.content?.parts
                ?.map(p => p.text || "")
                .join("") || null;


        /* =========================
           🤖 AI RAW RESPONSE LOG
        ========================= */
        console.log("[AI][RAW RESPONSE]", {
            uid,
            usage: data.usage || null,
            raw: text || null
        });

        if (!text) {
            console.warn("[AI][EMPTY RESPONSE]", { uid, data });
            await deleteSession(uid);
            throw new Error("AI_EMPTY_RESPONSE");
        }



        /* =========================
           📦 AI PARSED JSON LOG
        ========================= */
        let parsed;
        try {
            const cleaned = text.replace(/```json|```/g, "").trim();
            parsed = JSON.parse(cleaned);

        } catch (e) {
            console.error("[AI][JSON_PARSE_FAIL]", { uid, text });
            await deleteSession(uid);
            throw new Error("AI_RESPONSE_INVALID");
        }

        if (
            typeof parsed !== "object" ||
            parsed.nameSafetyScore === undefined ||
            parsed.promptSafetyScore === undefined ||
            parsed.copyrightScore === undefined ||
            !parsed.name
        ) {
            await deleteSession(uid);
            throw new Error("AI_RESPONSE_INVALID");
        }


        const nameSafetyScore = Math.min(100, Math.max(0, parsed.nameSafetyScore || 0));
        const promptSafetyScore = Math.min(100, Math.max(0, parsed.promptSafetyScore || 0));
        const copyrightScore = Math.min(100, Math.max(0, parsed.copyrightScore || 0));

        // 🔥 SAFETY CUT RULES
        if (nameSafetyScore >= 60) {
            await deleteSession(uid);
            throw new Error("NAME_UNSAFE");
        }

        if (promptSafetyScore >= 70) {
            await deleteSession(uid);
            throw new Error("PROMPT_UNSAFE");
        }

        if (copyrightScore >= 75) {
            await deleteSession(uid);
            throw new Error("COPYRIGHT_RISK");
        }



        let outName = safeStr(parsed.name);
        if (isBadExampleValue(outName)) outName = safeStr(name);

        let intro = safeStr(parsed.intro);
        if (intro.length < 50) {
            intro =
                `그는 오래된 공기의 냄새를 먼저 읽는 버릇이 있다. ${outName}라는 이름은 그에게 결심의 무게로 남아 있다. ${safeStr(prompt)}에서 시작된 생각은 아직 거칠지만 분명한 방향을 가진다. 그는 말보다 시선으로 의지를 드러낸다. 지역의 공기와 소음은 늘 경고처럼 스민다. 오늘도 그는 한 걸음을 내딛는다. **이 선택은 이야기를 앞으로 밀어낸다.**`;
        }

        s.output = {
            nameSafetyScore,
            promptSafetyScore,
            copyrightScore,

            name: outName,
            koreanName: safeStr(parsed.koreanName),
            needKorean: normalizeBool(parsed.needKorean, false),

            existence: safeStr(parsed.existence),
            intro,
            canSpeak: normalizeBool(parsed.canSpeak, true),
            speechStyle: safeStr(parsed.speechStyle),
            narrationStyle: safeStr(parsed.narrationStyle),
            theme: safeStr(parsed.theme)
        };

        s.nowFlow.refine = false;
        s.nowFlow.story1 = true;

        await setSession(uid, s);

    } catch (err) {
        console.error("[callAI] ERROR:", err);
        await deleteSession(uid);

        if (
            err.message === "NAME_UNSAFE" ||
            err.message === "PROMPT_UNSAFE" ||
            err.message === "COPYRIGHT_RISK" ||
            err.message === "AI_RESPONSE_INVALID" ||
            err.message === "AI_EMPTY_RESPONSE"

        ) {
            throw err; // 그대로 전달
        }

        throw new Error("AI_CALL_FAILED");
    }
}
