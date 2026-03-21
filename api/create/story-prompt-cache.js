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
이 인물을 장면 속에서 보여라.
설정 설명 금지.
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

이 행동은 이미 실제로 벌어졌다.
그 이후 벌어질 장면을 구체적으로 묘사한다.
`.trim();
}
