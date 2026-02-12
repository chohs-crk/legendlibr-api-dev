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
- 결말은 반드시 6문장 이상 8문장 이내로 작성한다
- 전체 분량은 최소 약 200자 이상이 되도록 충분히 서술한다
- 이미 진행된 이야기를 바탕으로 마지막 상태만 서술한다
- 감정의 귀결, 인물의 상태, 세계의 변화를 함께 다룬다
- origin은 이 인물이 속한 전체 세계관과 시대적 배경이다
- region은 그 세계관 안에 존재하는 구체적인 공간이다
- 새로운 설정이나 인물을 추가하지 않는다


[중요 금지 규칙]
- 결말 방향, 비극, 성취, 방향, 유형, 점수와 같은
  메타 정보나 지시어를 결말 서사에 직접 사용하지 않는다
- 입력으로 주어진 지시 문구를 그대로 복사하지 않는다

[서사 문법]
- **텍스트**: 감정·주제 강조 (최대 3회)
- 텍스트 양 끝에 **를 사용한다
- §텍스트§: 직접 대사 (발화 가능한 캐릭터만)
- 캐릭터가 발화 불가일 경우
주변 인물이나 제 3자의 대사, 독백 느낌의 서술 등을 §텍스트§형태로 사용한다

[특징 규칙]
- features는 캐릭터의 성격, 외형, 겪은 사건 등의 특징을 작성한다
- 글의 문체, 말투 등 서술상 특징은 작성하지 않는다
- origin이나 region의 특징은 작성하지 않는다

[출력 스키마]
{
  "ending": "결말 서사 (서사적인 문장 최소 6문장 이상 8문장 정도)",
  "features": ["특징1","특징2","특징3","특징4","특징5"]
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
발화 가능 여부: ${output.canSpeak ? "가능, 대사를 작성할 수 있다" : "불가, 캐릭터가 직접 대사를 하는 걸 작성하면 안된다"}

서술 문체:
${output.narrationStyle}

대사 방식:
${output.speechStyle}

[주제]
${output.theme}

※ 위 주제는 이 이야기의 핵심 갈등과 방향성을 나타낸다.
※ 결말은 반드시 이 주제의 귀결을 보여주어야 한다.
※ 단, 주제를 직접 설명하거나 반복하지 말고
   인물의 상태 변화와 장면을 통해 드러내야 한다.
※ 주제에 포함된 감정, 가치관, 갈등 요소 중 최소 하나 이상이
   결말에서 명확히 드러나야 한다.


[세계 배경]
기원: ${input.origin?.name} - ${input.origin?.desc}
지역: ${input.region?.name} - ${input.region?.detail}

※ 기원은 이 인물이 속한 전체 세계관과 시대적 배경이다.
※ 지역은 그 세계관 안에 존재하는 구체적인 장소이다.
※ 결말에는 이 둘의 관계가 자연스럽게 드러나야 한다.
[이전 이야기 흐름]
${output.story1?.story || ""}
${output.story2?.story || ""}
${output.story3?.story || ""}

[선택된 행동 흐름]
${output.story1?.choices[selected?.story1]?.text || ""}
${output.story2?.choices[selected?.story2]?.text || ""}
${output.story3?.choices[selected?.story3]?.text || ""}

[결말 작성 지침]
아래 지침은 결말의 **톤과 귀결**만을 의미한다.
이 문구를 그대로 사용하거나 언급하지 말고,
이전 이야기의 마지막 상태를 서사로 완성하라.

- ${endingType}

[출력]
{
  "ending": "이야기의 엔딩을 8문장 이내의 소설로 작성한다.",
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
