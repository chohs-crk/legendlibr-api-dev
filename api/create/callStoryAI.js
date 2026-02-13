// /api/create/callStoryAI.js

import { SAFETY_RULES_AFTER } from "../base/safetyrules.js";

/* =========================================
   1. BASE SYSTEM (공통 서사 규칙)
========================================= */
export const BASE_STORY_SYSTEM = `
${SAFETY_RULES_AFTER}

너는 장편 서사를 장면 단위로 작성하는 AI다.
이야기는 항상 진행 중이며, 멈추지 않는다.

[출력 형식]
반드시 아래 형식만 출력한다:

<STORY>
(본문)
</STORY>
<CHOICES>
(선택지1)
(선택지2)
(선택지3)
</CHOICES>

태그 외 텍스트 출력 금지.

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

7. 각 줄 끝에 반드시 #정수(1~10)

────────────────
[선택지의 기능]
────────────────
선택지는 "다음 장면의 실제 시작점"이다.

story3에서는 선택지의 행동이 이미 실행된 상태로
장면을 시작해야 한다.

선택지를 그대로 다시 쓰지 말고,
그 행동이 실행되는 장면을 구체적으로 묘사하라.

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
본문: 150자 이상 5문장 이내
단락 금지
`;



/* =========================================
   2. STREAM FUNCTION
========================================= */

export async function callStoryAIStream(uid, onDelta, prompt, sceneRoleSystem) {

    const MODEL_ID = "gemini-2.5-flash-lite";
    const API_VERSION = "v1beta";

    const systemText = BASE_STORY_SYSTEM + "\n\n" + sceneRoleSystem;

    const res = await fetch(
        `https://generativelanguage.googleapis.com/${API_VERSION}/models/${MODEL_ID}:streamGenerateContent?alt=sse`,
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
                        parts: [{ text: prompt }]
                    }
                ],
                generationConfig: {
                    temperature: 0.7,
                    topP: 0.9,
                    maxOutputTokens: 2048
                }
            })
        }
    );

    if (!res.ok) throw new Error("GEMINI_REQUEST_FAILED");

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop();

        for (const line of lines) {
            const trimmedLine = line.trim();
            if (!trimmedLine.startsWith("data:")) continue;

            const payload = trimmedLine.slice(5).trim();
            try {
                const json = JSON.parse(payload);
                const textChunk = json.candidates?.[0]?.content?.parts?.[0]?.text;
                if (textChunk) {
                    onDelta(textChunk);
                }
            } catch (e) { }
        }
    }
}
