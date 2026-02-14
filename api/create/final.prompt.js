import { SAFETY_RULES_AFTER } from "../base/safetyrules.js";





/* =========================
   SYSTEM PROMPT
========================= */
export const SYSTEM_FOR_FINAL = `
${SAFETY_RULES_AFTER}

너는 TRPG 캐릭터 이야기의 결말을 작성하는 AI이다.

[출력 규칙]
- 반드시 JSON만 반환한다
- JSON 외의 문자, 설명, 코드블록은 절대 출력하지 않는다

[언어 규칙]
- 반드시 한국어만 사용
- 한자, 영어, 일본어, 중국어 금지
- 공백과 문장부호만 허용

[서사 규칙]
- 결말은 반드시 4~6문장 이내
- 최소 200자 이상
- 이미 진행된 이야기의 마지막 상태만 서술
- 새로운 인물, 설정 추가 금지
- 반드시 origin과 region이 자연스럽게 드러나야 한다

[중요 금지]
- 성공, 실패, 비극, 해피엔딩 같은 메타 단어 직접 사용 금지
- 입력 지시문 복사 금지

[서사 문법]
- **텍스트** 강조 최대 3회
- §텍스트§ 대사
- 발화 불가 캐릭터는 직접 대사 금지

[출력 스키마]
{
 
  "ending": "<결말 텍스트>",
  "features": ["<특징1>", "<특징2>", "<특징3>", "<특징4>", "<특징5>"]


}
`;



/* =========================
   PROMPT #1 : ENDING
========================= */
export function buildFinalEndingPrompt({
    input,
    output,
    selected,
    endingType
}) {
    return `
[캐릭터]
이름: ${output.name}
소개: ${output.intro}
존재 형태: ${output.existence}
발화 가능 여부: ${output.canSpeak ? "가능" : "불가"}

[이 캐릭터 설정의 근거 메모]
${output.profile}

[서술 문체]
${output.narrationStyle}

[대사 방식]
${output.speechStyle}

[주제]
${output.theme}

[세계 배경]
기원: ${input.origin?.name} - ${input.origin?.desc}
지역: ${input.region?.name} - ${input.region?.detail}

[이전 이야기 흐름]
${output.story1?.story || ""}
${output.story3?.story || ""}

[마지막 선택지 실행 결과]
${output.story3?.choices[selected?.story3]?.text || ""}

────────────────

[결말 유형 해석 지침]

${endingType === "비극적인 방향의 결말 스토리 작성"
            ? `
이 인물은 클라이막스에서 패배하거나,
목표 달성에 실패하거나,
의지와 현실이 충돌하여 무너진다.

단순 패배가 아니다.

왜 실패했는지
그 실패가 인물의 성격, 선택, 한계와
어떻게 연결되는지 개연성 있게 서술하라.

감정의 붕괴,
세계의 변화,
돌이킬 수 없는 상실이 드러나야 한다.
`
            : `
이 인물은 클라이막스에서
갈등을 돌파하거나,
목표를 성취하거나,
자신의 한계를 극복한다.

단순 승리가 아니다.

왜 성공했는지
그 성공이 인물의 가치관, 선택, 축적된 행동과
어떻게 연결되는지 개연성 있게 서술하라.

세계에 변화가 발생해야 하며
인물의 상태 또한 이전과 달라져야 한다.
`
        }

────────────────

위 지침을 직접 언급하지 말고
장면으로 완성하라.

[출력]
{
  "ending": "6문장 이내 소설",
  "features": ["특징1","특징2","특징3","특징4","특징5"]
}
`;
}



/* =========================
   PROMPT #2 : TRAITS / SCORES / SKILLS
========================= */
export function buildFinalStatsPrompt({
  input,
  output,
  fullStory
}) {
  return `
[캐릭터]
이름: ${output.name}
소개: ${output.intro}

[전체 이야기]
${fullStory}

[세계]
${input.origin?.name} - ${input.origin?.desc}
${input.region?.name} - ${input.region?.detail}

[출력 규칙]
- 스킬은 반드시 4개여야 한다
[출력]
{
  "traits": {
    "physical": 1-10,
    "intellectual": 1-10,
    "alignment": "선|중립|악",
    "growth": "성장 가능성 3문장 이내"
  },
  "scores": {
    "combatScore": 1-10,
    "supportScore": 1-10,
    "worldScore": 1-10,
    "narrativeScore": 1-10,
    "charmScore": 1-10,
    "dominateScore": 1-10,
    "metaScore": 1-10,
    "ruleBreakScore": 1-10,
    "willscore": 1-10
  },
  "skills": [
    {
  "name": "스킬 이름",
  "power": 1-10,
  "turns": 1-3,
  "weights": [1-10],
  "impact": "A|B",
  "shortDesc": "짧은 설명",
  "longDesc": "2에서 3 문장 분량 이내의 강렬한 설명"
},

    {},
    {},
    {}
  ]
}
`;
}
