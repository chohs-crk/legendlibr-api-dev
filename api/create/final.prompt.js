import { SAFETY_RULES } from "../base/safetyrules.js";

/* =========================
   SYSTEM PROMPT
========================= */
export const SYSTEM_FOR_FINAL = `
${SAFETY_RULES}

너는 TRPG 캐릭터 이야기의 결말을 작성하는 AI이다.

[출력 규칙]
- 반드시 JSON만 반환한다
- JSON 외의 문자, 설명, 코드블록은 절대 출력하지 않는다

[언어 규칙]
- 반드시 한국어만 사용
- 한자, 영어, 일본어, 중국어 금지
- 공백과 문장부호만 허용

[서사 규칙]
- 결말은 반드시 ** 8문장 이내**로 작성한다
- 이미 진행된 이야기를 바탕으로 마지막 상태만 서술한다
- 감정의 귀결, 인물의 상태, 세계의 변화 중 핵심만 다룬다
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
  "ending": "결말 서사 (서사 문장, 최소 6문장 이상)",
  "features": ["특징1","특징2","특징3","특징4","특징5"]
}
`;


/* =========================
   PROMPT #1 : ENDING
========================= */
export function buildFinalEndingPrompt({
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

서술 문체:
${output.narrationStyle}

대사 방식:
${output.speechStyle}

[주제]
${output.theme}

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
