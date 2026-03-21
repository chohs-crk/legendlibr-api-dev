export const config = { runtime: "nodejs" };

import { getSession, setSession, deleteSession } from "../base/sessionstore.js";
import {
    SYSTEM_PROMPT_PROFILE,
    SYSTEM_PROMPT_STYLE
} from "./promptinit-ai.prompt.js";
import {
    GEMINI_FLASH_LITE_MODEL,
    GEMINI_FLASH_MODEL,
    GEMINI_PROFILE_MODEL,
    GEMINI_STYLE_MODEL,
    GEMINI_API_VERSION,
    GEMINI_THINKING_BUDGET_OFF,
    STORY_CACHE_TTL,
    createTextCache,
    shouldCreateStoryCache,
    getPreferredModelList,
} from "./gemini-cache.js";
import { buildStorySharedPrefix } from "./story-prompt-cache.js";

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

function safeParseJSON(text) {
    try {
        let cleaned = safeStr(text).replace(/```json|```/g, "").trim();
        if (!cleaned) return null;

        const first = cleaned.indexOf("{");
        if (first > 0) cleaned = cleaned.slice(first);

        const lastBrace = cleaned.lastIndexOf("}");
        if (lastBrace !== -1) {
            const candidate = cleaned.slice(0, lastBrace + 1);
            try {
                return JSON.parse(candidate);
            } catch {
                /* fallthrough */
            }
        }

        const open = (cleaned.match(/{/g) || []).length;
        const close = (cleaned.match(/}/g) || []).length;
        if (open > close) cleaned += "}".repeat(open - close);

        return JSON.parse(cleaned);
    } catch {
        return null;
    }
}

/* =========================
   AI USAGE LOGGER
========================= */
function pushUsageCall(session, call) {
    if (!session.aiUsage) {
        session.aiUsage = { calls: [] };
    }

    session.aiUsage.calls.push({
        stage: call.stage,
        tag: call.tag,
        modelId: call.modelId || "unknown",
        promptTokens: call.usageMetadata?.promptTokenCount ?? null,
        outputTokens: call.usageMetadata?.candidatesTokenCount ?? null,
        totalTokens:
            call.usageMetadata?.totalTokenCount ??
            ((call.usageMetadata?.promptTokenCount ?? 0) +
                (call.usageMetadata?.candidatesTokenCount ?? 0)) ??
            null,
        ts: Date.now(),
    });
}

function isBadExampleValue(s) {
    const t = safeStr(s);
    if (!t) return true;
    return ["홍길동", "기타", "예시"].some((b) => t.includes(b));
}

function clampScore(n) {
    const v = Number.isFinite(Number(n)) ? Number(n) : 0;
    return Math.min(100, Math.max(0, Math.trunc(v)));
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

async function requestGemini({
    modelId = GEMINI_FLASH_LITE_MODEL,
    systemPrompt,
    userPrompt,
    temperature,
    maxTokens,
    thinkingBudget = GEMINI_THINKING_BUDGET_OFF,
    cachedContent = null,
    uid,
    tag,
}) {
    const candidateModels = getPreferredModelList(modelId);
    let lastErr = null;

    for (const MODEL_ID of candidateModels) {
        try {
            const res = await fetch(
                `https://generativelanguage.googleapis.com/${GEMINI_API_VERSION}/models/${MODEL_ID}:generateContent`,
                {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                        "x-goog-api-key": process.env.GEMINI_API_KEY,
                    },
                    body: JSON.stringify({
                        systemInstruction: {
                            parts: [{ text: systemPrompt }],
                        },
                        contents: [
                            {
                                role: "user",
                                parts: [{ text: userPrompt }],
                            },
                        ],
                        ...(cachedContent ? { cachedContent } : {}),
                        generationConfig: {
                            temperature,
                            topP: 0.9,
                            maxOutputTokens: maxTokens,
                            thinkingConfig: {
                                thinkingBudget,
                            },
                        },
                        safetySettings: [
                            { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_NONE" },
                            { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_NONE" },
                        ],
                    }),
                }
            );

            const data = await res.json().catch(() => null);

            if (!res.ok) {
                const errorDetail = data || {};
                console.error("[AI][API_ERROR_DETAIL]", {
                    uid,
                    tag,
                    modelId: MODEL_ID,
                    status: res.status,
                    statusText: res.statusText,
                    error: errorDetail,
                });
                const err = new Error(errorDetail?.error?.message || "GEMINI_REQUEST_FAILED");
                err.status = res.status;
                err.details = errorDetail;
                throw err;
            }

            console.log("[AI][FINISH_REASON]", {
                uid,
                tag,
                modelId: MODEL_ID,
                finishReason: data?.candidates?.[0]?.finishReason,
            });

            const text =
                data?.candidates?.[0]?.content?.parts?.map((p) => p.text || "").join("") || null;

            console.log("[AI][RAW RESPONSE]", {
                uid,
                tag,
                modelId: MODEL_ID,
                raw: text || null,
            });

            const usageMetadata = data?.usageMetadata || null;
            return { text, data, usageMetadata, modelId: MODEL_ID };
        } catch (err) {
            lastErr = err;
            if (!shouldFallbackModel(err) || MODEL_ID === candidateModels[candidateModels.length - 1]) {
                throw err;
            }
        }
    }

    throw lastErr || new Error("GEMINI_REQUEST_FAILED");
}

async function createStoryPrefixCache(uid, session) {
    const prefixText = buildStorySharedPrefix(session);

    session.aiCache = session.aiCache || {};
    session.aiCache.storyPrefix = {
        name: null,
        modelId: GEMINI_FLASH_LITE_MODEL,
        ttl: STORY_CACHE_TTL,
        sourceChars: prefixText.length,
        enabled: shouldCreateStoryCache(prefixText),
    };

    if (!session.aiCache.storyPrefix.enabled) {
        return;
    }

    try {
        const cache = await createTextCache({
            modelId: GEMINI_FLASH_LITE_MODEL,
            displayName: `story-prefix-${uid}`,
            text: prefixText,
            ttl: STORY_CACHE_TTL,
            uid,
        });

        session.aiCache.storyPrefix = {
            name: cache.name || null,
            modelId: cache.modelId || GEMINI_FLASH_LITE_MODEL,
            ttl: STORY_CACHE_TTL,
            sourceChars: prefixText.length,
            cachedContentTokenCount: cache.cachedContentTokenCount,
            expireTime: cache.expireTime,
            enabled: true,
        };
    } catch (err) {
        session.aiCache.storyPrefix = {
            name: null,
            modelId: GEMINI_FLASH_LITE_MODEL,
            ttl: STORY_CACHE_TTL,
            sourceChars: prefixText.length,
            enabled: false,
            failReason: err?.message || "CACHE_CREATE_FAILED",
        };
    }
}

/* =========================
   MAIN
========================= */
export async function callAI(uid) {
    const s = await getSession(uid);
    if (!s) return;

    const { origin, region, name, prompt } = s.input;

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

    const profilePrompt = `
기원: ${origin?.name || ""} - ${origin?.desc || ""}
기원 추가설명: ${origin?.longDesc || ""}
지역: ${region?.name || ""} - ${region?.detail || ""}

[유저 입력 원본]
이름 원문: ${name}

사용자 프롬프트:
${prompt}

요구:
- 위 입력을 종합해 캐릭터 소개를 "설정 설명" 형식으로 작성
- intro는 7~9문장(권장 8문장)
- theme는 정확히 3문장
- 출력은 반드시 JSON만
`.trim();

    const stylePrompt = `
[유저 입력 원본]
이름 원문: ${name}
${originGuide}
사용자 프롬프트:
${prompt}
기원: ${origin?.name || ""}
지역: ${region?.name || ""} - ${region?.detail || ""}

요구:
- speechStyle(100자 이하) + narrationStyle(200자 이하)만 출력
- 출력은 반드시 JSON만
`.trim();

    try {
        const first = await requestGemini({
            modelId: GEMINI_PROFILE_MODEL,
            systemPrompt: SYSTEM_PROMPT_PROFILE,
            userPrompt: profilePrompt,
            temperature: 0.6,
            maxTokens: 4096,
            thinkingBudget: GEMINI_THINKING_BUDGET_OFF,
            uid,
            tag: "PROFILE_1",
        });
        pushUsageCall(s, {
            stage: "refine",
            tag: "PROFILE_1",
            modelId: first.modelId,
            usageMetadata: first.usageMetadata,
        });

        if (!first.text) {
            console.warn("[AI][EMPTY RESPONSE][PROFILE]", { uid });
            await deleteSession(uid);
            throw new Error("AI_EMPTY_RESPONSE");
        }

        let parsedProfile = safeParseJSON(first.text);

        if (!parsedProfile || typeof parsedProfile !== "object") {
            console.warn("[AI][PARSE_FAIL_RETRYING][PROFILE]", { uid });

            const retry = await requestGemini({
                modelId: GEMINI_PROFILE_MODEL,
                systemPrompt: SYSTEM_PROMPT_PROFILE,
                userPrompt: profilePrompt,
                temperature: 0.5,
                maxTokens: 3072,
                thinkingBudget: GEMINI_THINKING_BUDGET_OFF,
                uid,
                tag: "PROFILE_1_RETRY",
            });
            pushUsageCall(s, {
                stage: "refine",
                tag: "PROFILE_1_RETRY",
                modelId: retry.modelId,
                usageMetadata: retry.usageMetadata,
            });

            parsedProfile = safeParseJSON(retry.text || "");

            if (!parsedProfile || typeof parsedProfile !== "object") {
                console.error("[AI][PARSE_FAIL_FINAL][PROFILE]", { uid });
                await deleteSession(uid);
                throw new Error("AI_JSON_PARSE_FAIL");
            }

            console.log("[AI][RECOVERED_AFTER_RETRY][PROFILE]", { uid });
        }

        parsedProfile.nameSafetyScore ??= 0;
        parsedProfile.promptSafetyScore ??= 0;
        parsedProfile.name ??= name;
        parsedProfile.needKorean ??= false;

        if (
            typeof parsedProfile !== "object" ||
            parsedProfile.nameSafetyScore === undefined ||
            parsedProfile.promptSafetyScore === undefined ||
            !parsedProfile.name
        ) {
            await deleteSession(uid);
            throw new Error("AI_RESPONSE_INVALID");
        }

        const nameSafetyScore = clampScore(parsedProfile.nameSafetyScore);
        const promptSafetyScore = clampScore(parsedProfile.promptSafetyScore);

        if (nameSafetyScore >= 95) {
            await deleteSession(uid);
            throw new Error("NAME_UNSAFE");
        }
        if (promptSafetyScore >= 95) {
            await deleteSession(uid);
            throw new Error("PROMPT_UNSAFE");
        }

        let outName = safeStr(parsedProfile.name);
        if (isBadExampleValue(outName)) outName = safeStr(name);

        let intro = safeStr(parsedProfile.intro);

        let speechStyle = "정보가 없습니다 다른 내용들을 참조해서 생성하시오";
        let narrationStyle = "3인칭 서술, 절제된 어휘, 사건 중심의 간결한 호흡";
        let profile = "없음";
        try {
            const second = await requestGemini({
                modelId: GEMINI_STYLE_MODEL,
                systemPrompt: SYSTEM_PROMPT_STYLE,
                userPrompt: stylePrompt,
                temperature: 0.5,
                maxTokens: 2048,
                thinkingBudget: GEMINI_THINKING_BUDGET_OFF,
                uid,
                tag: "STYLE_2",
            });
            pushUsageCall(s, {
                stage: "refine",
                tag: "STYLE_2",
                modelId: second.modelId,
                usageMetadata: second.usageMetadata,
            });

            if (!second.text) {
                console.warn("[AI][EMPTY RESPONSE][STYLE]", { uid });
            } else {
                let parsedStyle = safeParseJSON(second.text);

                if (!parsedStyle || typeof parsedStyle !== "object") {
                    console.warn("[AI][PARSE_FAIL_RETRYING][STYLE]", { uid });

                    const retry2 = await requestGemini({
                        modelId: GEMINI_STYLE_MODEL,
                        systemPrompt: SYSTEM_PROMPT_STYLE,
                        userPrompt: stylePrompt,
                        temperature: 0.4,
                        maxTokens: 2048,
                        thinkingBudget: GEMINI_THINKING_BUDGET_OFF,
                        uid,
                        tag: "STYLE_2_RETRY",
                    });
                    pushUsageCall(s, {
                        stage: "refine",
                        tag: "STYLE_2_RETRY",
                        modelId: retry2.modelId,
                        usageMetadata: retry2.usageMetadata,
                    });

                    parsedStyle = safeParseJSON(retry2.text || "");

                    if (!parsedStyle || typeof parsedStyle !== "object") {
                        console.warn("[AI][PARSE_FAIL_FINAL][STYLE_FALLBACK]", { uid });
                        parsedStyle = null;
                        speechStyle = "정보가 없습니다 다른 내용들을 참조해서 생성하시오";
                        narrationStyle = "3인칭 서술, 절제된 어휘, 사건 중심의 간결한 호흡";
                    } else {
                        console.log("[AI][RECOVERED_AFTER_RETRY][STYLE]", { uid });
                    }
                }

                if (parsedStyle) {
                    const ss = safeStr(parsedStyle.speechStyle);
                    const ns = safeStr(parsedStyle.narrationStyle);
                    const pf = safeStr(parsedStyle.profile);

                    if (ss) speechStyle = ss;
                    if (ns) narrationStyle = ns;
                    if (pf) profile = pf;
                }
            }
        } catch (styleErr) {
            console.warn("[AI][STYLE_CALL_FAILED_FALLBACK]", {
                uid,
                message: styleErr?.message || "STYLE_CALL_FAILED",
            });
        }

        if (speechStyle.length > 120) speechStyle = speechStyle.slice(0, 120);
        if (narrationStyle.length > 240) narrationStyle = narrationStyle.slice(0, 240);

        s.metaSafety = {
            nameSafetyScore,
            promptSafetyScore,
        };

        s.output = {
            nameSafetyScore,
            promptSafetyScore,
            name: outName,
            needKorean: normalizeBool(parsedProfile.needKorean, false),
            profile,
            existence: safeStr(parsedProfile.existence),
            intro,
            canSpeak: normalizeBool(parsedProfile.canSpeak, true),
            speechStyle,
            narrationStyle,
            theme: safeStr(parsedProfile.theme),
        };

        await createStoryPrefixCache(uid, s);

        s.nowFlow.refine = false;
        s.nowFlow.story1 = true;

        await setSession(uid, s);
    } catch (err) {
        console.error("[callAI] ERROR:", err);
        await deleteSession(uid);

        if (
            err.message === "NAME_UNSAFE" ||
            err.message === "PROMPT_UNSAFE" ||
            err.message === "AI_RESPONSE_INVALID" ||
            err.message === "AI_EMPTY_RESPONSE" ||
            err.message === "AI_JSON_PARSE_FAIL"
        ) {
            throw err;
        }

        throw new Error("AI_CALL_FAILED");
    }
}
