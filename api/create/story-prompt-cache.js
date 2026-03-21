export function buildStorySharedPrefix(session) {
    const origin = session?.input?.origin || {};
    const region = session?.input?.region || {};
    const output = session?.output || {};

    return `
[캐릭터 기본 정보]
이름: ${output.name || ""}
존재 형태: ${output.existence || ""}
발화 가능 여부: ${output.canSpeak ? "가능" : "불가"}

[이 인물이 이렇게 설정된 이유]
${output.intro || ""}

[이 인물의 말투 지시]
${output.speechStyle || ""}

[이 인물의 서술 문체 지시]
${output.narrationStyle || ""}

[이 인물의 핵심 설정 메모]
${output.profile || "없음"}

[세계관]
기원: ${origin.name || ""} - ${origin.desc || ""}
지역: ${region.name || ""} - ${region.detail || ""}

[핵심 주제]
${output.theme || ""}
`.trim();
}

export function buildStory1DynamicPrompt() {
    return `
[장면 지시]
이 장면은 이야기의 첫 장면이다.
독자는 지금 처음 이 인물을 만난다.

반드시 다음 흐름을 따른다:
1. 시작하는 느낌이 나야 한다
2. 인물의 평소 상태, 일상, 역할, 위치 중 최소 하나를 자연스럽게 보여준다
3. 세계관의 공기와 장면의 분위기를 먼저 깔아준다
4. 인물의 성격과 태도는 설명하지 말고 행동과 반응으로 드러낸다
5. 장면 후반부에 작은 이상, 낌새, 균열, 호출, 실수, 침입 같은 사건의 시작점을 넣는다
6. 아직 정면 충돌은 일으키지 않는다
7. 클라이맥스처럼 쓰지 않는다
8. 결말처럼 닫지 않는다

중요:
- "무언가가 시작된다"는 인상이 있어야 한다
- 읽는 사람이 앞으로 일이 벌어질 것 같다고 느껴야 한다
- 설정집처럼 설명하지 말고 실제 장면처럼 써라
- 처음부터 과도하게 세게 몰아붙이지 말고 서서히 장면을 연다

[출력 길이 규칙]
- 글자 수: 220~280자
- 문장 수: 5~7문장
- 단어 수: 120~180단어 수준
- 조건 위반 시 잘못된 출력으로 간주
`.trim();
}

export function buildStory3DynamicPrompt(session) {
    const prevStory = session?.output?.story1?.story || "";
    const selectedIndex = session?.selected?.story1;
    const selectedChoice = session?.output?.story1?.choices?.[selectedIndex]?.text || "";

    return `
[이전 장면]
${prevStory}

[이미 실행된 행동]
${selectedChoice}

[장면 지시]
이 행동은 이미 실제로 벌어졌다.
이 장면은 하이라이트를 이끌어내는 과정이다.

반드시 다음 흐름을 따른다:
1. 이전 선택의 결과가 즉시 드러나야 한다
2. 상황은 story1보다 더 급하고 더 무거워져야 한다
3. 갈등, 압박, 저항, 흔들림, 돌발 변수 중 최소 하나를 크게 확대한다
4. 인물은 더 이상 관찰만 하지 않고 선택의 대가를 직접 감당한다
5. 장면 전체가 하이라이트 직전까지 점점 밀도를 높이며 상승해야 한다
6. 강한 장면 하나를 향해 끌고 가되, 그 순간 직전에 멈춘다
7. 결말은 쓰지 않는다
8. 요약하지 않는다

중요:
- 시작하는 느낌이 아니라, 이미 굴러가기 시작한 사건이 커지는 느낌이어야 한다
- 독자가 "이제 중요한 장면이 온다"라고 느껴야 한다
- 행동의 실행 결과, 긴장 상승, 충돌 확대가 핵심이다
- story1보다 더 선명하고 더 압축적이며 더 강한 장면이어야 한다
- 하지만 마지막 해결이나 완전한 폭발은 final에 남겨둔다

[출력 길이 규칙]
- 글자 수: 220~280자
- 문장 수: 5~7문장
- 단어 수: 120~180단어 수준
- 조건 위반 시 잘못된 출력으로 간주
`.trim();
}
