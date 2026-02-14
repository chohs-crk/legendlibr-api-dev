export const config = { runtime: "nodejs" };

import { getSession, setSession, deleteSession } from "../base/sessionstore.js";
import { SYSTEM_PROMPT } from "./promptinit-ai.prompt.js";


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
    [세계관과 지역 설정]
    - origin은 이 인물이 속한 전체 세계관과 시대적 배경이다
- region은 그 세계관 안에 존재하는 구체적인 공간이다
기원: ${origin?.name || ""} - ${origin?.desc || ""}
기원 추가설명: ${origin?.longDesc || ""}
지역: ${region?.name || ""} - ${region?.detail || ""}

${originGuide}

[유저 입력 원본]
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
            !parsed.name
        ) {
            await deleteSession(uid);
            throw new Error("AI_RESPONSE_INVALID");
        }


        const nameSafetyScore = Math.min(100, Math.max(0, parsed.nameSafetyScore || 0));
        const promptSafetyScore = Math.min(100, Math.max(0, parsed.promptSafetyScore || 0));
      

        // 🔥 SAFETY CUT RULES
        if (nameSafetyScore >= 75) {
            await deleteSession(uid);
            throw new Error("NAME_UNSAFE");
        }

        if (promptSafetyScore >= 85) {
            await deleteSession(uid);
            throw new Error("PROMPT_UNSAFE");
        }

   



        let outName = safeStr(parsed.name);
        if (isBadExampleValue(outName)) outName = safeStr(name);

        let intro = safeStr(parsed.intro);

       
        let profile = safeStr(parsed.profile || "");
        if (profile.length > 200) {
            profile = profile.slice(0, 200);
        }


        // 🔒 SAFETY는 output과 분리해서 보존
        s.metaSafety = {
            nameSafetyScore,
            promptSafetyScore
        };

        s.output = {
            nameSafetyScore,
            promptSafetyScore,

            name: outName,
            needKorean: normalizeBool(parsed.needKorean, false),
            profile,
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
     
            err.message === "AI_RESPONSE_INVALID" ||
            err.message === "AI_EMPTY_RESPONSE"

        ) {
            throw err; // 그대로 전달
        }

        throw new Error("AI_CALL_FAILED");
    }
}
