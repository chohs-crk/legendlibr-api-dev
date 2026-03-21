import {
    SYSTEM_FOR_FINAL,
    SYSTEM_FOR_STATS,
    buildFinalEndingPrompt,
    buildFinalStatsPrompt
} from "./final.prompt.js";

const FINAL_MODEL_ID = process.env.GEMINI_FLASH_LITE_MODEL || "gemini-2.5-flash-lite-latest";
const FINAL_STABLE_MODEL_ID = "gemini-2.5-flash-lite";
const API_VERSION = "v1beta";
const THINKING_BUDGET_OFF = 0;

function makeError(code, status = 500, meta) {
    const e = new Error(code);
    e.code = code;
    e.status = status;
    e.meta = meta;
    return e;
}

function getModelCandidates(modelId = FINAL_MODEL_ID) {
    return [...new Set([modelId, FINAL_STABLE_MODEL_ID])];
}

function shouldFallbackModel(err) {
    const message = String(err?.message || "");
    const status = err?.status;
    return (
        status === 400 ||
        status === 404 ||
        message.includes("not found") ||
        message.includes("unsupported") ||
        message.includes("not supported") ||
        message.includes("Unknown model")
    );
}

async function executeGeminiJSON(modelId, systemText, userText, temperature = 0.3) {
    const res = await fetch(
        `https://generativelanguage.googleapis.com/${API_VERSION}/models/${modelId}:generateContent`,
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
                    maxOutputTokens: 2048,
                    thinkingConfig: {
                        thinkingBudget: THINKING_BUDGET_OFF
                    }
                }
            })
        }
    );

    const data = await res.json().catch(() => null);

    if (!res.ok) {
        const err = new Error(data?.error?.message || "GEMINI_REQUEST_FAILED");
        err.status = res.status;
        err.details = data;
        throw err;
    }

    if (!data?.candidates?.length) {
        throw new Error("GEMINI_EMPTY_RESPONSE");
    }

    const text =
        data.candidates?.[0]?.content?.parts?.map(p => p.text || "").join("") || "{}";

    const usageMetadata = data?.usageMetadata || null;

    return {
        text: text.replace(/```json|```/g, "").trim(),
        usageMetadata,
        modelId
    };
}

async function callGeminiJSON(systemText, userText, temperature = 0.3) {
    const MAX_RETRY = 2;
    const modelCandidates = getModelCandidates();
    let lastErr = null;

    for (const candidateModelId of modelCandidates) {
        let attempt = 0;

        while (attempt < MAX_RETRY) {
            try {
                return await executeGeminiJSON(candidateModelId, systemText, userText, temperature);
            } catch (err) {
                lastErr = err;

                if ((err.message === "GEMINI_REQUEST_FAILED" || err.message === "GEMINI_EMPTY_RESPONSE") && !shouldFallbackModel(err)) {
                    throw err;
                }

                if (shouldFallbackModel(err)) {
                    break;
                }

                attempt++;
                if (attempt >= MAX_RETRY) {
                    throw new Error("GEMINI_RETRY_EXCEEDED");
                }

                const delay = 500 * Math.pow(2, attempt);
                await new Promise(r => setTimeout(r, delay));
            }
        }
    }

    if (lastErr?.message === "GEMINI_REQUEST_FAILED" || lastErr?.message === "GEMINI_EMPTY_RESPONSE") {
        throw lastErr;
    }

    throw new Error("GEMINI_RETRY_EXCEEDED");
}

function assertValidEnding(result) {
    if (!result || typeof result !== "object") throw "INVALID_ENDING_OBJECT";
    if (typeof result.ending !== "string" || result.ending.trim().length === 0) throw "INVALID_ENDING_TEXT";
    if (!Array.isArray(result.features) || result.features.length !== 5) throw "INVALID_FEATURES";
}

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

    if (!Array.isArray(result.skills)) result.skills = [];
    while (result.skills.length < 4) result.skills.push(makeDefaultSkill());
    result.skills = result.skills.slice(0, 4);

    result.skills = result.skills.map(skill => {
        if (!skill || typeof skill !== "object") skill = makeDefaultSkill();

        skill.name = typeof skill.name === "string" && skill.name.trim() ? skill.name : "잃어버린 힘";
        skill.shortDesc = typeof skill.shortDesc === "string" ? skill.shortDesc : "설명이 누락된 기술";
        skill.longDesc = typeof skill.longDesc === "string" ? skill.longDesc : "생성 오류로 누락된 기술이다.";

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

export async function generateEndingAndFeatures({ uid, input, output, selected, endingType }) {
    const prompt = buildFinalEndingPrompt({ input, output, selected, endingType });

    console.log("[FINAL][PROMPT1_LENGTH]", { uid, length: prompt.length });

    for (let formatAttempt = 0; formatAttempt < 2; formatAttempt++) {
        const rawObj = await callGeminiJSON(SYSTEM_FOR_FINAL, prompt, 0.5);

        const raw = rawObj.text;
        const usage = {
            modelId: rawObj.modelId,
            usageMetadata: rawObj.usageMetadata
        };

        try {
            const parsed = JSON.parse(raw);
            assertValidEnding(parsed);

            return {
                ending: parsed.ending || "",
                features: Array.isArray(parsed.features) ? parsed.features : [],
                usage
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
        const rawObj = await callGeminiJSON(SYSTEM_FOR_STATS, prompt, 0.3);

        const raw = rawObj.text;
        const usage = {
            modelId: rawObj.modelId,
            usageMetadata: rawObj.usageMetadata
        };

        console.log("[FINAL][RAW2]", raw);

        try {
            const parsed = JSON.parse(raw);
            return {
                stats: normalizeStats(parsed),
                usage
            };
        } catch (err) {
            if (formatAttempt === 1) {
                throw makeError("AI_STATS_INVALID", 500, { reason: String(err), raw });
            }
            console.warn("[FINAL][STATS_FORMAT_RETRY]", { uid });
        }
    }

    throw makeError("AI_STATS_INVALID", 500, { reason: "RETRY_EXCEEDED" });
}
