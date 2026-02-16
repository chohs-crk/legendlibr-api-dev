export const config = { runtime: "nodejs" };

import { getSession, setSession, deleteSession } from "../base/sessionstore.js";
import {
    SYSTEM_PROMPT_PROFILE,
    SYSTEM_PROMPT_STYLE
} from "./promptinit-ai.prompt.js";


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

        // 1) 첫 '{' 이전 쓰레기 제거
        const first = cleaned.indexOf("{");
        if (first > 0) cleaned = cleaned.slice(first);

        // 2) 마지막 '}'까지 잘라서 시도
        const lastBrace = cleaned.lastIndexOf("}");
        if (lastBrace !== -1) {
            const candidate = cleaned.slice(0, lastBrace + 1);
            try {
                return JSON.parse(candidate);
            } catch {
                /* fallthrough */
            }
        }

        // 3) 중괄호 개수 맞추기(간단 보정)
        const open = (cleaned.match(/{/g) || []).length;
        const close = (cleaned.match(/}/g) || []).length;
        if (open > close) cleaned += "}".repeat(open - close);

        return JSON.parse(cleaned);
    } catch {
        return null;
    }
}

function isBadExampleValue(s) {
    const t = safeStr(s);
    if (!t) return true;
    return ["홍길동", "기타", "예시"].some(b => t.includes(b));
}

function clampScore(n) {
    const v = Number.isFinite(Number(n)) ? Number(n) : 0;
    return Math.min(100, Math.max(0, Math.trunc(v)));
}


/* =========================
   GEMINI REQUEST
========================= */
async function requestGemini({
    modelId,  // ✅ 추가
    systemPrompt,
    userPrompt,
    temperature,
    maxTokens,
    uid,
    tag
}) {
    const MODEL_ID = modelId; 
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
                    parts: [{ text: systemPrompt }]
                },
                contents: [
                    {
                        role: "user",
                        parts: [{ text: userPrompt }]
                    }
                ],
                generationConfig: {
                    temperature,
                    topP: 0.9,
                    maxOutputTokens: maxTokens
                },
                safetySettings: [
                    { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_NONE" },
                    { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_NONE" }
                ]
            })
        }
    );

    if (!res.ok) {
        const errorDetail = await res.json().catch(() => ({}));
        console.error("[AI][API_ERROR_DETAIL]", {
            uid,
            tag,
            status: res.status,
            statusText: res.statusText,
            error: errorDetail
        });
        throw new Error("GEMINI_REQUEST_FAILED");
    }

    const data = await res.json();
    console.log("[AI][FINISH_REASON]", {
        uid,
        tag,
        finishReason: data.candidates?.[0]?.finishReason
    });

    const text =
        data.candidates?.[0]?.content?.parts
            ?.map(p => p.text || "")
            .join("") || null;

    console.log("[AI][RAW RESPONSE]", {
        uid,
        tag,
        raw: text || null
    });

    return { text, data };
}


/* =========================
   MAIN
========================= */
export async function callAI(uid) {
    const s = await getSession(uid);
    if (!s) return;

    const { origin, region, name, prompt } = s.input;

    // originGuide는 "2차 호출 입력"에만 포함(요구사항 반영)
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

    /* =========================
       1차 호출 입력 (소개 전용)
       - 요구사항 그대로 구성
    ========================= */
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

    /* =========================
       2차 호출 입력 (스타일 전용)
       - 요구사항 그대로 구성
    ========================= */
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
        /* =========================
           1차 호출: PROFILE JSON
           - 파싱 실패 시 1회 재시도
        ========================= */
        const first = await requestGemini({
            modelId: "gemini-2.5-flash-lite",   // ✅ 추가
            systemPrompt: SYSTEM_PROMPT_PROFILE,
            userPrompt: profilePrompt,
            temperature: 0.6,
            maxTokens: 4096,
            uid,
            tag: "PROFILE_1"
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
                modelId: "gemini-2.5-flash-lite",  // ✅ 추가
                systemPrompt: SYSTEM_PROMPT_PROFILE,
                userPrompt: profilePrompt,
                temperature: 0.5,
                maxTokens: 3072,
                uid,
                tag: "PROFILE_1_RETRY"
            });


            parsedProfile = safeParseJSON(retry.text || "");

            if (!parsedProfile || typeof parsedProfile !== "object") {
                console.error("[AI][PARSE_FAIL_FINAL][PROFILE]", { uid });
                await deleteSession(uid);
                throw new Error("AI_JSON_PARSE_FAIL");
            }

            console.log("[AI][RECOVERED_AFTER_RETRY][PROFILE]", { uid });
        }

        // PROFILE 필드 기본값 보정
        parsedProfile.nameSafetyScore ??= 0;
        parsedProfile.promptSafetyScore ??= 0;
        parsedProfile.name ??= name;
        parsedProfile.needKorean ??= false;

    

        // 최소 유효성
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

        // SAFETY CUT RULES (기존 로직 유지)
        if (nameSafetyScore >= 75) {
            await deleteSession(uid);
            throw new Error("NAME_UNSAFE");
        }
        if (promptSafetyScore >= 85) {
            await deleteSession(uid);
            throw new Error("PROMPT_UNSAFE");
        }

        // name / intro / profile 정리
        let outName = safeStr(parsedProfile.name);
        if (isBadExampleValue(outName)) outName = safeStr(name);

        let intro = safeStr(parsedProfile.intro);

        /* =========================
           2차 호출: STYLE JSON
           - 목적: speechStyle / narrationStyle 안정 추출
           - 파싱 실패해도 "서비스 진행은 가능"하게 폴백 처리
           - (필요 시 여기서만 deleteSession/에러로 바꿀 수도 있음)
        ========================= */
        let speechStyle = "담담하고 절제된 말투, 짧은 문장 위주";
        let narrationStyle = "3인칭 서술, 절제된 어휘, 사건 중심의 간결한 호흡";
        let profile = "없음";
        try {
            const second = await requestGemini({
                modelId: "gemini-3-flash",   // ✅ 변경
                systemPrompt: SYSTEM_PROMPT_STYLE,
                userPrompt: stylePrompt,
                temperature: 0.5,
                maxTokens: 2048,
                uid,
                tag: "STYLE_2"
            });



            if (!second.text) {
                console.warn("[AI][EMPTY RESPONSE][STYLE]", { uid });
            } else {
                let parsedStyle = safeParseJSON(second.text);

                if (!parsedStyle || typeof parsedStyle !== "object") {
                    console.warn("[AI][PARSE_FAIL_RETRYING][STYLE]", { uid });

                    const retry2 = await requestGemini({
                        modelId: "gemini-3-flash",   // ✅ 추가
                        systemPrompt: SYSTEM_PROMPT_STYLE,
                        userPrompt: stylePrompt,
                        temperature: 0.4,
                        maxTokens: 1024,
                        uid,
                        tag: "STYLE_2_RETRY"
                    });


                    parsedStyle = safeParseJSON(retry2.text || "");

                    if (!parsedStyle || typeof parsedStyle !== "object") {
                        console.warn("[AI][PARSE_FAIL_FINAL][STYLE_FALLBACK]", { uid });
                        parsedStyle = null;
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
            // 2차는 "안정성 강화용"이라 실패 시 폴백으로 진행
            console.warn("[AI][STYLE_CALL_FAILED_FALLBACK]", {
                uid,
                message: styleErr?.message || "STYLE_CALL_FAILED"
            });
        }

        // 길이 제한 보강(모델이 조금 넘겨도 잘라서 안정화)
        if (speechStyle.length > 120) speechStyle = speechStyle.slice(0, 120);
        if (narrationStyle.length > 240) narrationStyle = narrationStyle.slice(0, 240);

        // 🔒 SAFETY는 output과 분리해서 보존(기존 유지)
        s.metaSafety = {
            nameSafetyScore,
            promptSafetyScore
        };

        // 최종 output은 "기존과 동일한 구조" 유지
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

            theme: safeStr(parsedProfile.theme)
        };

        // flow 진행(기존 유지)
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
            throw err; // 그대로 전달
        }

        throw new Error("AI_CALL_FAILED");
    }
}
