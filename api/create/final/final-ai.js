import {
    SYSTEM_FOR_FINAL,
    SYSTEM_FOR_STATS,
    buildFinalEndingPrompt,
    buildFinalStatsPrompt
} from "./final.prompt.js";

// 이하 로직은 기존 final-ai.js 그대로 유지

function makeError(code, status = 500, meta) {
    const e = new Error(code);
    e.code = code;
    e.status = status;
    e.meta = meta;
    return e;
}

/* =========================
   Gemini 호출 (JSON 텍스트 반환)
========================= */
async function callGeminiJSON(systemText, userText, temperature = 0.3) {
    const MODEL_ID = "gemini-2.5-flash-lite";
    const API_VERSION = "v1beta";

    const MAX_RETRY = 2;
    let attempt = 0;

    while (attempt < MAX_RETRY) {
        try {
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
                            parts: [{ text: systemText }]
                        },
                        contents: [
                            {
                                role: "user",
                                parts: [{ text: userText }]
                            }
                        ],
                        generationConfig: {
                            temperature,
                            topP: 0.9,
                            maxOutputTokens: 2048
                        }
                    })
                }
            );

            if (!res.ok) {
                const errText = await res.text();
                console.error("GEMINI ERROR STATUS:", res.status);
                console.error("GEMINI ERROR BODY:", errText);

                // 503만 재시도
                if (res.status === 503) {
                    attempt++;
                    const delay = 500 * Math.pow(2, attempt);
                    await new Promise(r => setTimeout(r, delay));
                    continue;
                }

                throw new Error("GEMINI_REQUEST_FAILED");
            }

            const data = await res.json();

            if (!data.candidates || !data.candidates.length) {
                throw new Error("GEMINI_EMPTY_RESPONSE");
            }

            const text =
                data.candidates?.[0]?.content?.parts?.map(p => p.text || "").join("") || "{}";

            return text.replace(/```json|```/g, "").trim();
        } catch (err) {
            // 우리가 직접 throw한 에러는 재시도하지 않음
            if (err.message === "GEMINI_REQUEST_FAILED" || err.message === "GEMINI_EMPTY_RESPONSE") {
                throw err;
            }

            attempt++;
            if (attempt >= MAX_RETRY) {
                throw new Error("GEMINI_RETRY_EXCEEDED");
            }

            const delay = 500 * Math.pow(2, attempt);
            await new Promise(r => setTimeout(r, delay));
        }
    }

    throw new Error("GEMINI_RETRY_EXCEEDED");
}

/* =========================
   Ending 스키마 검증
========================= */
function assertValidEnding(result) {
    if (!result || typeof result !== "object") throw "INVALID_ENDING_OBJECT";
    if (typeof result.ending !== "string" || result.ending.trim().length === 0) throw "INVALID_ENDING_TEXT";
    if (!Array.isArray(result.features) || result.features.length !== 5) throw "INVALID_FEATURES";
}

/* =========================
   Stats 안전 보정 (throw 안 함)
========================= */
function clampInt(value, min, max, fallback) {
    const n = parseInt(value);
    if (!Number.isInteger(n)) return fallback;
    if (n < min) return min;
    if (n > max) return max;
    return n;
}

function makeDefaultSkill() {
    return {
        name: "잃어버린 힘",
        power: 5,
        turns: 1,
        weights: [5],
        impact: "A",
        shortDesc: "숨겨진 가능성",
        longDesc: "아직 완전히 발현되지 않은 힘이다."
    };
}

function normalizeStats(result) {
    if (!result || typeof result !== "object") result = {};

    // traits
    if (!result.traits || typeof result.traits !== "object") result.traits = {};
    result.traits.physical = clampInt(result.traits.physical, 1, 10, 5);
    result.traits.intellectual = clampInt(result.traits.intellectual, 1, 10, 5);

    if (!["선", "중립", "악"].includes(result.traits.alignment)) {
        result.traits.alignment = "중립";
    }
    if (typeof result.traits.growth !== "string") {
        result.traits.growth = "성장 가능성이 남아 있다.";
    }

    // scores
    if (!result.scores || typeof result.scores !== "object") result.scores = {};
    const scoreKeys = [
        "combatScore",
        "supportScore",
        "worldScore",
        "narrativeScore",
        "charmScore",
        "dominateScore",
        "metaScore",
        "ruleBreakScore",
        "willscore"
    ];
    for (const key of scoreKeys) {
        result.scores[key] = clampInt(result.scores[key], 1, 10, 5);
    }

    // skills
    if (!Array.isArray(result.skills)) result.skills = [];
    while (result.skills.length < 4) result.skills.push(makeDefaultSkill());
    result.skills = result.skills.slice(0, 4);

    result.skills = result.skills.map(skill => {
        if (!skill || typeof skill !== "object") skill = makeDefaultSkill();

        skill.name =
            typeof skill.name === "string" && skill.name.trim() ? skill.name : "잃어버린 힘";
        skill.shortDesc = typeof skill.shortDesc === "string" ? skill.shortDesc : "설명이 누락된 기술";
        skill.longDesc =
            typeof skill.longDesc === "string" ? skill.longDesc : "생성 오류로 누락된 기술이다.";

        skill.power = clampInt(skill.power, 1, 10, 5);
        skill.turns = clampInt(skill.turns, 1, 3, 1);

        if (!Array.isArray(skill.weights)) skill.weights = [];
        while (skill.weights.length < skill.turns) skill.weights.push(5);
        skill.weights = skill.weights.slice(0, skill.turns).map(w => clampInt(w, 1, 10, 5));

        if (skill.impact !== "A" && skill.impact !== "B") skill.impact = "A";

        return skill;
    });

    return result;
}

/* =========================
   Public API
========================= */
export async function generateEndingAndFeatures({ uid, input, output, selected, endingType }) {
    const prompt = buildFinalEndingPrompt({ input, output, selected, endingType });

    console.log("[FINAL][PROMPT1_LENGTH]", { uid, length: prompt.length });

    for (let formatAttempt = 0; formatAttempt < 2; formatAttempt++) {
        const raw = await callGeminiJSON(SYSTEM_FOR_FINAL, prompt, 0.5);

        try {
            const parsed = JSON.parse(raw);
            assertValidEnding(parsed);

            return {
                ending: parsed.ending || "",
                features: Array.isArray(parsed.features) ? parsed.features : []
            };
        } catch (err) {
            if (formatAttempt === 1) {
                throw makeError("AI_ENDING_INVALID", 500, { reason: String(err), raw });
            }
            console.warn("[FINAL][ENDING_FORMAT_RETRY]", { uid });
        }
    }

    throw makeError("AI_ENDING_INVALID", 500, { reason: "RETRY_EXCEEDED" });
}

export async function generateStats({ uid, input, output, fullStory }) {
    const prompt = buildFinalStatsPrompt({ input, output, fullStory });

    for (let formatAttempt = 0; formatAttempt < 2; formatAttempt++) {
        const raw = await callGeminiJSON(SYSTEM_FOR_STATS, prompt, 0.3);

        console.log("[FINAL][RAW2]", raw);

        try {
            const parsed = JSON.parse(raw);
            return normalizeStats(parsed);
        } catch (err) {
            if (formatAttempt === 1) {
                throw makeError("AI_STATS_INVALID", 500, { reason: String(err), raw });
            }
            console.warn("[FINAL][STATS_FORMAT_RETRY]", { uid });
        }
    }

    throw makeError("AI_STATS_INVALID", 500, { reason: "RETRY_EXCEEDED" });
}
