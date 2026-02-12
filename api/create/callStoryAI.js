// /api/create/callStoryAI.js

import { SAFETY_RULES_AFTER } from "../base/safetyrules.js";


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
- 반드시 특수문자 혹은 한국어만 사용 (가-힣)
- 한자, 일본어, 중국어, 영어(a-z) 모두 금지
- 공백과 문장부호만 허용
- 길이: 6~8문장 분량의 한국어
- 단락 금지
- 태그 외 내용 출력 금지

[서사 표현 규칙]

본문(STORY)에는 아래 특수 서사 문법만 제한적으로 사용할 수 있다.

1) **텍스트**
- 텍스트 양 끝에 **를 사용한다
- 서술, 감정, 분위기, 중요한 문장을 강조할 때 사용
- 전체 STORY 기준 3~6회 이내
- 선택지에서는 사용 금지

2) §텍스트§
- 인물의 직접 발화(대사) 전용
- 반드시 §로 감싸서 출력
- 큰따옴표(" ") 사용 금지
- 독백·설명·선택지 사용 금지
[발화 가능 여부 규칙]

- 프롬프트에 "직접 대사 불가" 또는 "발화 불가"가 명시된 경우
  STORY 본문에서 캐릭터 자신에겐§텍스트§ 형태의 직접 대사를 절대 사용하지 마라
  단, 주변 인물이나 제 3자의 대사, 독백 느낌의 서술 등을 §텍스트§형태로 사용한다
- 해당 경우 감정, 의사, 반응은 반드시
  행동, 분위기, 시선, 환경 변화로만 표현한다
- 이 규칙을 위반하면 출력은 무효다

위 문법 외의 마크다운, HTML 태그, 특수 기호는 절대 사용하지 마라.

[선택지 규칙]
- 정확히 3줄
- 각 줄 18~26자의 한 문장
- 구체적인 행위
- 줄바꿈(\n)으로만 구분
- 각 선택지 끝에 #정수(1~10) 부여
- 선택지는 항상 완결된 서술 문장이어야 한다
- 문장은 반드시 주어를 포함한다
- 문장 끝은 마침표를 포함해 끝나는 서술형으로 한다
- 직전 문장 다음에 올 소설 문장처럼 생각하라
- 선택지 문장을 STORY의 마지막 문장 뒤에
아무 수정 없이 그대로 붙였을 때
자연스러운 소설 문단이 되어야 한다.

[선택지 출력 규칙]

- 선택지는 반드시 다음 형식으로만 출력한다.

  행동 문장 #숫자

  예:

  이전 문장이
  상대가 강한 일격을 준비하고 있다. 이면

  (캐릭터)가 상대의 공격에 맞섰다 #6
  (캐릭터)가 상대의 일격을 혼신을 다해 막아냈다 #8
  (캐릭터)가 상대의 압도적인 힘에 좌절하였다. #3

- # 뒤의 숫자는 1~10 정수
- (정수), (1~10), #정수 같은 표기는 절대 사용하지 마라
- 선택지 문장 안에 점수 설명을 넣지 마라
[스토리 서술 중 선택지 개념 금지 규칙]

- STORY 본문에서는 아래 개념을 직접적 또는 간접적으로 절대 언급하지 마라.
  - 선택
  - 선택지
  - 고르다
  - 결정하다
  - 결단
  - 갈림길
  - 다음 행동
  - 무엇을 할지
  - 선택해야 할 시간
- STORY는 항상 이미 흘러가고 있는 사건처럼 서술되어야 한다.
- 인물은 "고민"하거나 "망설일 수는 있으나"
  독자나 외부 존재에게 선택을 요구하는 서술은 금지한다.
- 이 규칙을 위반하면 출력은 무효다.

[점수 규칙]
- #숫자는 해당 행동이
이야기의 긴장과 파급력을 얼마나 크게 변화시키는지를 나타낸다
- 숫자가 높을수록 되돌릴 수 없는 변화에 가깝다

[출력 순서 규칙]
- STORY 전체를 먼저 출력한다
- STORY 닫힘 태그 이후에만 CHOICES를 출력한다
- CHOICES 출력 중에는 STORY 문장을 섞지 않는다

[태그 규칙]
- 태그는 반드시 대문자
- <STORY>, </STORY>, <CHOICES>, </CHOICES>
- 태그 위아래 줄바꿈 필수

규칙을 어기면 출력은 무효이며 재작성해야 한다.

${SAFETY_RULES_AFTER}

`;


/**
 * 스트리밍 전용 함수
 * - full 문자열은 story1/2/3에서 조립
 * - 여기서는 delta만 콜백 전달
 */
export async function callStoryAIStream(uid, onDelta, prompt) {
    const MODEL_ID = "gemini-2.5-flash-lite";
    const API_VERSION = "v1beta";

    // ✅ 변경: URL 끝에 ?alt=sse를 추가하여 데이터 형식을 강제함
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
                    parts: [{ text: SYSTEM_FOR_STORY }]
                },
                contents: [{ role: "user", parts: [{ text: prompt }] }],
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
            // ✅ 변경: SSE 형식의 'data: ' 접두사를 확인하고 파싱
            if (!trimmedLine || !trimmedLine.startsWith("data:")) continue;

            const payload = trimmedLine.slice(5).trim();
            try {
                const json = JSON.parse(payload);
                // ✅ 변경: Gemini v1beta의 스트리밍 JSON 구조에 맞게 텍스트 추출
                const textChunk = json.candidates?.[0]?.content?.parts?.[0]?.text;
                if (textChunk) {
                    onDelta(textChunk);
                }
            } catch (e) {
                // 불완전한 JSON의 경우 무시
            }
        }
    }
}