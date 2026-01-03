export const config = { runtime: "nodejs" };

import { getSession, setSession, deleteSession } from "../base/sessionstore.js";
// ai.js
import { SAFETY_RULES } from "../base/safetyrules.js";

export const SYSTEM_PROMPT = `
${SAFETY_RULES}

너의 출력은 반드시 아래 JSON 형식만 반환해야 한다.
설명, 해설, 번호, 불릿, 따옴표 밖 텍스트 등은 절대 포함하지 마라.
코드블록( \`\`\` ) 도 금지한다.

{
  "safetyscore": 0,         // 0~100 정수
  "name": "홍길동",          // 순수 본명만 (호칭/별칭/수식어 금지)
  "intro": "한글 소개글...", // 한글로 작성된 350~450자 내외
  "theme": "복수에 대한 여정" // 한 문장, 메타 주제
}

[세부 조건]

1) safetyscore
- 규칙 위반 가능성이 높을수록 점수를 높게 계산
- 정수형, 0~100

2) name
- 캐릭터 실제 본명만 출력
- 호칭/직함/별칭 등 제거
- 한글 또는 한자 기반 허용

3) intro
- 순수 한글로 구성
- 350~450자
- 성격 / 배경 / 목표 / 가치관 묘사 중심
- 과한 설정 열거 금지
- 자연스러운 단락 또는 짧은 문장 흐름

4) theme
- intro 기반 핵심 주제 한 문장
- "~에 대한 이야기", "~을 향한 여정" 형태 권장
- 메타적/명확한 방향 제시

출력은 반드시 위 JSON 구조만 따라야 한다.
JSON 밖에 어떤 문자도 출력하지 마라.
`;








export async function callAI(uid) {
    const s = await getSession(uid);
    if (!s) {
        console.error("[callAI] NO_SESSION for uid:", uid);
        return;
    }

    if (typeof fetch === "undefined") {
        console.error("[callAI] ERROR: fetch is not defined in this runtime");
        return;
    }

    console.log("[callAI] START:", uid, s);

    const { origin, region, name, prompt } = s.input;
    const length = 400 + Math.floor((prompt.length / 700) * 100);

    const userPrompt = `
기원: ${origin.name} - ${origin.desc}
지역: ${region.name} - ${region.detail}
캐릭터 이름 입력: ${name}
사용자 프롬프트: ${prompt}
소개글 길이: 약 ${length}자
`;

    try {
        console.log("[callAI] Sending to OpenAI (fetch)…");
        console.log("[callAI] KEY exists:", !!process.env.OPENAI_API_KEY);

        const apiRes = await fetch("https://api.openai.com/v1/chat/completions", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`
            },
            body: JSON.stringify({
                model: "gpt-4o-mini",
                messages: [
                    { role: "system", content: SYSTEM_PROMPT },
                    { role: "user", content: userPrompt }
                ]
            })
        });

        console.log("[callAI] status:", apiRes.status);

        if (!apiRes.ok) {
            const errText = await apiRes.text();
            console.error("[callAI] OPENAI ERROR BODY:", errText);
            return;
        }

        const data = await apiRes.json();
        console.log("[callAI] RAW_RESPONSE:", JSON.stringify(data, null, 2));

        if (!data.choices?.[0]?.message?.content) {
            console.error("[callAI] INVALID_RESPONSE", data);
            return;
        }

        const outputText = data.choices[0].message.content;
        console.log("[callAI] OpenAI response:", outputText);

        let raw = outputText.trim();
        raw = raw.replace(/```json|```/g, "");
        const parsed = JSON.parse(raw);


        if (parsed.safetyscore > 75) {
            console.log("⚠ SAFETY BLOCKED:", parsed.safetyscore);
            await deleteSession(uid);
            return;
        }

        s.output = {
            safetyscore: parsed.safetyscore,
            name: parsed.name, 
            intro: parsed.intro,
            theme: parsed.theme
        };

        s.nowFlow.refine = false;
        s.nowFlow.story1 = true;
        await setSession(uid, s);

        console.log("=== SESSION STATE AFTER AI DONE ===");
        console.log(JSON.stringify(s, null, 2));
        console.log("==================================");

    } catch (err) {
        console.error("[callAI] ERROR:", err);
        throw err;
    }
}
