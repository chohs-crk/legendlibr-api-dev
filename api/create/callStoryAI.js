// /api/create/callStoryAI.js
import { SAFETY_RULES_AFTER } from "../base/safetyrules.js";

/**
 * ✅ 모델 출력 형식(=JSON)은 "generationConfig.responseMimeType/responseJsonSchema"로 강제한다.
 *    → 태그(<STORY>, <CHOICES>) 파싱 자체를 제거해서 99%+ 안정화.
 *
 * 참고: Structured outputs (JSON Schema) 공식 문서
 * - responseMimeType: "application/json"
 * - responseJsonSchema 제공
 */

/* =========================================
   1) BASE NARRATIVE SYSTEM (공통 서사 규칙)
   - 출력 포맷(태그 등) 강제 문구는 제거
========================================= */
export const BASE_NARRATIVE_SYSTEM = `
${SAFETY_RULES_AFTER}

너는 장편 서사를 장면 단위로 작성하는 AI다.
이야기는 항상 진행 중이며, 멈추지 않는다.

────────────────
[공통 서사 규칙]
────────────────
- 이야기는 직전 사건 이후 1~3초 시점에서 시작한다
- 이전 장면을 요약하지 않는다
- 동일 표현을 반복하지 않는다
- 같은 장소·행동을 다시 시작하지 않는다
- 설명하지 말고 장면을 보여라
- 감정은 행동과 환경으로 표현한다
- 미래 예고 금지
- 독자에게 판단을 넘기지 않는다

────────────────
[선택지 생성 규칙 – 매우 중요]
────────────────
선택지는 "다음 장면의 첫 문장으로 이어질 수 있는 실제 행동 문장"이어야 한다.

선택지는 다음 조건을 모두 만족해야 한다:
1. 반드시 주어를 포함한다
2. 이미 실행 중인 행동처럼 서술한다
3. 가정형 표현 금지
   - 만약
   - 하려 한다
   - 하려고 한다
   - 할 것이다
4. 행동은 구체적이어야 한다
   - 설득한다 ❌
   - 손을 뻗어 어깨를 붙잡고 설득했다 ⭕
5. STORY 마지막 문장 뒤에 그대로 붙이면
   하나의 자연스러운 소설 문단이 되어야 한다
6. 선택지는 실제 장면을 유도해야 한다
   - 말로 끝나지 않는다
   - 상황 변화가 발생해야 한다
7. 선택지 3개는 서로 달라야 한다 (중복/유사 반복 금지)

────────────────
[서사 문법]
────────────────
**텍스트** : 감정·핵심 강조 (3~6회)
§텍스트§ : 직접 대사

발화 불가인 경우:
- 캐릭터 본인의 §대사§ 금지
- 행동·환경·타인의 대사로 표현

────────────────
[길이]
────────────────
본문: 200자 이상 300자 이내의 5~7문장 분량 수준
단락 금지

────────────────
[입력 데이터 해석 규칙]
────────────────
프롬프트에 포함된 각 블록은 설명이 아니라 "작성 지시 데이터"다.

- [소설 주인공 소개]
  메인 캐릭터 설정이다. 설명하지 말고 장면으로 드러내라.

- [이 인물의 말투 지시] / [말투 지시]
  대사를 생성할 경우 반드시 따라야 하는 구조 규칙이다.
  이 문장을 그대로 복사하지 마라.

- [이 인물의 서술 문체 지시] / [문체 지시]
  문장의 리듬, 길이, 어휘 성향에 대한 규칙이다.
  장면 전체에 적용하되 반복하지 말 것.

- [이 인물의 핵심 설정 메모] / [설정 메모]
  고유 대사, 고유 인물, 고유 장소만 포함된다.
  새로운 설정 추가 금지.
  없으면 무시한다.

- [존재 형태]
  인간/비인간 여부에 따라 행동 방식이 달라진다.

- [발화 가능 여부]
  false일 경우 직접 대사 절대 금지.

- [이전 장면]
  요약 금지. 반복 금지. 반드시 직후 시점에서 시작한다.

- [이미 실행된 행동]
  해당 행동은 이미 발생했다. 그 결과를 묘사하라.
  선택지 문장을 그대로 복사하지 마라.

입력 블록을 설명으로 재출력하지 마라.
입력 블록을 문장으로 재사용하지 마라.
입력 블록은 내부 작성 규칙이다.
`;

/* =========================================
   2) JSON SCHEMA (story + 3 choices + score)
========================================= */
export const SCENE_RESPONSE_SCHEMA = {
    type: "object",
    properties: {
        story: {
            type: "string",
            description:
                "장면 본문(한국어). 200~300자, 5~7문장, 단락/빈줄 금지. **강조**/§대사§ 문법은 허용.",
        },
        choices: {
            type: "array",
            description:
                "정확히 3개의 선택지. 각 선택지는 다음 장면을 시작할 수 있는 '실제 행동 문장'이어야 함.",
            minItems: 3,
            maxItems: 3,
            items: {
                type: "object",
                properties: {
                    text: {
                        type: "string",
                        description:
                            "선택지 문장. 반드시 주어 포함, 이미 실행 중인 행동처럼 서술. 가정형/미래형 금지.",
                    },
                    score: {
                        type: "integer",
                        description:
                            "선택지 품질 점수. 1~10 정수. (클라이언트로 전송하지 않고 서버에만 저장)",
                        minimum: 1,
                        maximum: 10,
                    },
                },
                required: ["text", "score"],
                additionalProperties: false,
            },
        },
    },
    required: ["story", "choices"],
    additionalProperties: false,
};

const DEFAULT_MODEL_ID = "gemini-flash-latest"; // ✅ 구조화 출력 지원 모델 사용 권장 :contentReference[oaicite:6]{index=6}
const API_VERSION = "v1beta";

function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
}

function extractCandidateText(respJson) {
    const candidate = respJson?.candidates?.[0];
    if (!candidate) return "";

    // 정상 케이스
    if (Array.isArray(candidate.content?.parts)) {
        return candidate.content.parts
            .map(p => typeof p?.text === "string" ? p.text : "")
            .join("");
    }

    // fallback: 일부 응답은 text 필드 직접 포함
    if (typeof candidate.output === "string") {
        return candidate.output;
    }

    return "";
}

function safeJsonParse(maybeJsonText) {
    let t = String(maybeJsonText || "").trim();

    if (!t) throw new Error("EMPTY_MODEL_TEXT");

    // ```json ... ``` 제거
    if (t.startsWith("```")) {
        t = t.replace(/```json/g, "")
            .replace(/```/g, "")
            .trim();
    }

    try {
        return JSON.parse(t);
    } catch (_) {
        const s = t.indexOf("{");
        const e = t.lastIndexOf("}");
        if (s !== -1 && e !== -1 && e > s) {
            return JSON.parse(t.slice(s, e + 1));
        }
        console.error("RAW TEXT BEFORE PARSE:", t);
        throw new Error("INVALID_JSON");
    }
}

function toIntInRange(v, min, max, fallback = 5) {
    const n = Number.parseInt(v, 10);
    if (Number.isFinite(n) && n >= min && n <= max) return n;
    return fallback;
}

function normalizeScene(obj) {
    const story = String(obj?.story ?? "").trim();

    let choices = obj?.choices;
    if (!Array.isArray(choices)) choices = [];

    const normalized = choices
        .map((c) => {
            if (typeof c === "string") {
                return { text: c.trim(), score: 5 };
            }
            const text = String(c?.text ?? "").trim();
            const score = toIntInRange(c?.score, 1, 10, 5);
            return { text, score };
        })
        .filter((c) => c.text);

    // 중복 제거(안전망)
    const dedup = [];
    const seen = new Set();
    for (const c of normalized) {
        const key = c.text;
        if (seen.has(key)) continue;
        seen.add(key);
        dedup.push(c);
    }

    if (!story) throw new Error("INVALID_STORY_EMPTY");
    if (dedup.length !== 3) throw new Error("INVALID_CHOICES_COUNT");

    return { story, choices: dedup };
}

function buildSystemText(sceneRoleSystem) {
    return `
${BASE_NARRATIVE_SYSTEM}

${sceneRoleSystem}

────────────────
[출력]
────────────────
- 응답은 반드시 JSON으로만 구성된다. (설명/머리말/마크다운/코드블록 금지)
- story: 본문 문자열
- choices: 정확히 3개
- score: 1~10 정수
  `.trim();
}

/* =========================================
   3) GENERATE SCENE (Structured Output)
========================================= */
async function callSceneStructured(prompt, sceneRoleSystem, opts = {}) {
    const modelId = opts.modelId || DEFAULT_MODEL_ID;
    const temperature = 0.25;
    const topP = opts.topP ?? 0.8;
    const maxOutputTokens = 4096;

    const systemText = buildSystemText(sceneRoleSystem);

    const res = await fetch(
        `https://generativelanguage.googleapis.com/${API_VERSION}/models/${modelId}:generateContent`,
        {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "x-goog-api-key": process.env.GEMINI_API_KEY,
            },
            body: JSON.stringify({
                systemInstruction: { parts: [{ text: systemText }] },
                contents: [{ role: "user", parts: [{ text: prompt }] }],
                generationConfig: {
                    temperature,
                    topP,
                    maxOutputTokens,
                    responseMimeType: "application/json",
                    responseJsonSchema: SCENE_RESPONSE_SCHEMA,
                },
            }),
        }
    );

    const data = await res.json().catch(() => null);
    if (!data?.candidates?.length) {
        throw new Error("NO_CANDIDATE");
    }
    const candidate = data.candidates[0];

    if (candidate.finishReason === "MAX_TOKENS") {
        throw new Error("MODEL_TRUNCATED");
    }

    if (candidate.finishReason === "SAFETY") {
        throw new Error("SAFETY_BLOCKED");
    }
    if (!res.ok) {
        const msg = data?.error?.message || "GEMINI_REQUEST_FAILED";
        const err = new Error(msg);
        err.status = res.status;
        err.details = data;
        throw err;
    }

    const rawText = extractCandidateText(data);
    const parsed = safeJsonParse(rawText);
    const scene = normalizeScene(parsed);

    return { modelId, usageMetadata: data?.usageMetadata ?? null, scene, rawText };
}

/**
 * ✅ JSON 모드가 모델에서 비활성인 경우(드물지만) 대비: "프롬프트로 JSON만" 유도 후 파싱
 * - 2.5 Flash는 지원하므로 보통 여기까지 올 일 없음.
 */
async function callScenePromptJSON(prompt, sceneRoleSystem, opts = {}) {
    const modelId = opts.modelId || DEFAULT_MODEL_ID;
    const temperature = opts.temperature ?? 0.25;
    const topP = opts.topP ?? 0.8;
    const maxOutputTokens = opts.maxOutputTokens ?? 1024;

    const systemText = buildSystemText(sceneRoleSystem);

    const hardJsonPrompt = `
아래 JSON만 출력한다. 다른 텍스트 금지.

형식:
{
  "story": "문자열",
  "choices": [
    {"text":"문장", "score": 1},
    {"text":"문장", "score": 1},
    {"text":"문장", "score": 1}
  ]
}

이제 장면을 작성하라.
  `.trim();

    const res = await fetch(
        `https://generativelanguage.googleapis.com/${API_VERSION}/models/${modelId}:generateContent`,
        {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "x-goog-api-key": process.env.GEMINI_API_KEY,
            },
            body: JSON.stringify({
                systemInstruction: { parts: [{ text: systemText }] },
                contents: [
                    { role: "user", parts: [{ text: prompt }] },
                    { role: "user", parts: [{ text: hardJsonPrompt }] },
                ],
                generationConfig: { temperature, topP, maxOutputTokens },
            }),
        }
    );

    const data = await res.json().catch(() => null);
    if (!res.ok) {
        const msg = data?.error?.message || "GEMINI_REQUEST_FAILED";
        const err = new Error(msg);
        err.status = res.status;
        err.details = data;
        throw err;
    }
    const candidate = data?.candidates?.[0];

    if (!candidate) {
        throw new Error("NO_CANDIDATE");
    }
    if (candidate.finishReason === "MAX_TOKENS") {
        throw new Error("MODEL_TRUNCATED");
    }

    if (candidate.finishReason === "SAFETY") {
        throw new Error("SAFETY_BLOCKED");
    }
    if (candidate.finishReason === "SAFETY") {
        throw new Error("SAFETY_BLOCKED");
    }
    const rawText = extractCandidateText(data);

    if (!rawText || !rawText.trim()) {
        throw new Error("EMPTY_MODEL_TEXT");
    }
    const parsed = safeJsonParse(rawText);
    const scene = normalizeScene(parsed);

    return { modelId, usageMetadata: data?.usageMetadata ?? null, scene, rawText };
}

/**
 * 외부에서 쓰는 단일 API:
 * - structured 먼저 시도 → (JSON mode 미지원 에러면) prompt JSON fallback
 */
export async function callStoryScene(uid, prompt, sceneRoleSystem, opts = {}) {
    try {
        return await callSceneStructured(prompt, sceneRoleSystem, opts);
    } catch (e) {
        const msg = String(e?.message || "");
        if (msg.includes("JSON mode is not enabled")) {
            // fallback
            return await callScenePromptJSON(prompt, sceneRoleSystem, opts);
        }
        throw e;
    }
}

/**
 * ✅ 99%+ 안정화를 위한 재시도 래퍼
 */
export async function callStorySceneWithRetry(uid, prompt, sceneRoleSystem, opts = {}) {
    const maxRetry = opts.maxRetry ?? 3;

    let lastErr = null;
    for (let i = 0; i < maxRetry; i++) {
        try {
            return await callStoryScene(uid, prompt, sceneRoleSystem, opts);
        } catch (e) {
            lastErr = e;
            // 가벼운 backoff
            await sleep(200 * (i + 1));
        }
    }

    throw lastErr || new Error("SCENE_GENERATION_FAILED");
}