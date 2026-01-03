// /api/create/callStoryAI.js

import { SAFETY_RULES } from "../base/safetyrules.js";

export const SYSTEM_FOR_STORY = `
다음 규칙을 "절대" 위반하지 않는다.

[출력 형식]
출력은 반드시 아래 형식 그대로 작성한다:

<STORY>
(본문)
</STORY>
<CHOICES>
(선택지1)
(선택지2)
(선택지3)
</CHOICES>

[본문 규칙]
- 반드시 한국어만 사용 (가-힣)
- 한자(例: 思 忠 戦), 일본어(例: の で), 중국어(例: 的 我), 영어(a-z) 모두 금지
- 공백과 문장부호만 허용
- 길이: 280~320자 한국어로
- 단락 금지
- 태그 외 내용 출력 금지

[선택지 규칙]
- 정확히 3줄
- 각 줄 18~26자의 한 문장
-구체적인 행위
- 줄바꿈(\n)으로만 구분
- 각 선택지 끝에 #정수를 붙인다 (1~10)
- 예: 도망치며 거리를 벌린다 #6
- 점수는 위험성/감정강도/결정 영향력 기준


[태그 규칙]
- 태그는 반드시 대문자
- <STORY>, </STORY>
- <CHOICES>, </CHOICES>
- 줄바꿈은 태그 위아래에 정확히 존재해야 한다.

규칙을 어기면 출력은 무효이며 재작성해야 한다.

${SAFETY_RULES}
`;

/**
 * 스트리밍 전용 함수
 * - full 문자열은 story1/2/3에서 조립
 * - 여기서는 delta만 콜백 전달
 */
export async function callStoryAIStream(uid, onDelta, prompt) {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`
        },
        body: JSON.stringify({
            model: "gpt-4o-mini",
            stream: true,
            messages: [
                { role: "system", content: SYSTEM_FOR_STORY },
                { role: "user", content: prompt }
            ]
        })
    });

    if (!res.ok) {
        onDelta(""); // noop
        throw new Error("AI_REQUEST_FAILED");
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();

    while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value);
        const lines = chunk.split("\n");

        for (const line of lines) {
            if (!line.startsWith("data: ")) continue;

            const payload = line.replace("data: ", "");

            if (payload === "[DONE]") continue;

            try {
                const json = JSON.parse(payload);
                const delta = json.choices?.[0]?.delta?.content;
                if (delta) onDelta(delta);
            } catch (_) {
                // ignore stream control frames
            }
        }
    }
}
