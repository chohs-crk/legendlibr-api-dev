/* =========================
   SCORE / ENDING TYPE
========================= */
function getChoiceScore(output, selected, key) {
    const story = output?.[key];
    if (!story || !story.choices) return 0;

    const idx = selected?.[key];
    const c = story.choices?.[idx];
    return typeof c?.score === "number" ? c.score : 0;
}

export function calculateStoryScore(output, selected) {
    // 기존 로직 유지: story1 + story3
    return getChoiceScore(output, selected, "story1") + getChoiceScore(output, selected, "story3");
}

export function decideEndingType(storyScore) {
    // 기존 조건 유지
    return storyScore >= 2 && storyScore <= 3
        ? "비극적인 방향의 결말 스토리 작성"
        : "사건을 성공적으로 해결하는 방향의 결말 스토리 작성";
}

/* =========================
   FULL STORY BUILD
========================= */
export function buildFullStory(output, ending) {
    return [output?.story1?.story || "", output?.story3?.story || "", ending || ""]
        .join(" ")
        .replace(/\s+/g, " ")
        .trim();
}

/* =========================
   STORY FORMATTER
   - 문장: \n
   - 2문장 단위: \n\n
   - 대사(§...§): 앞뒤 \n\n
   - 대사 등장 시 2문장 카운트 리셋
   - \n 3개 이상 금지 => 최대 \n\n
========================= */
const DIALOGUE_REGEX = /§[^§]*§/g;

// 문장 종료 후보
const END_PUNCT = new Set([".", "!", "?", "。", "！", "？"]);

// 문장 끝 뒤에 올 수 있는 닫는 문자들 (따옴표/괄호 등)
const CLOSERS = new Set(['"', "”", "’", "'", ")", "]", "}", "」", "』", "】", "》", "〉"]);

function isWhitespace(ch) {
    return ch == null ? true : /\s/.test(ch);
}

function splitIntoSentences(text) {
    const out = [];
    let buf = "";

    for (let i = 0; i < text.length; i++) {
        const ch = text[i];
        buf += ch;

        if (!END_PUNCT.has(ch)) continue;

        // ... (ellipsis) 방지: 마침표가 연속이면 문장 끝 처리하지 않음
        if (ch === ".") {
            const prev = text[i - 1];
            const next = text[i + 1];
            if (prev === "." || next === ".") continue;
        }

        // 문장부호 뒤에 닫는 문자가 올 수 있음 -> 닫는 문자들을 스킵하고 공백/끝이면 종료
        let j = i + 1;
        while (j < text.length && CLOSERS.has(text[j])) j++;

        if (j >= text.length || isWhitespace(text[j])) {
            const s = buf.trim();
            if (s) out.push(s);
            buf = "";

            // 공백(개행 포함) 연속은 소비
            i = j;
            while (i + 1 < text.length && isWhitespace(text[i + 1])) i++;
        }
    }

    const tail = buf.trim();
    if (tail) out.push(tail);
    return out;
}

function pushSentences(segment, blocks) {
    const sentences = splitIntoSentences(segment);
    for (const s of sentences) blocks.push({ type: "sentence", text: s });
}

function tokenizeStory(text) {
    const blocks = [];
    let lastIndex = 0;
    let match;

    while ((match = DIALOGUE_REGEX.exec(text)) !== null) {
        const before = text.slice(lastIndex, match.index);
        pushSentences(before, blocks);

        blocks.push({ type: "dialogue", text: match[0] });
        lastIndex = DIALOGUE_REGEX.lastIndex;
    }

    pushSentences(text.slice(lastIndex), blocks);
    return blocks;
}

export function formatFinalStory(text) {
    if (!text) return "";

    const blocks = tokenizeStory(text);

    let result = "";
    let sentenceGroupCount = 0;

    for (const block of blocks) {
        if (block.type === "dialogue") {
            sentenceGroupCount = 0;

            // 직전에 붙은 개행들 제거 후, 대사 앞뒤는 정확히 \n\n
            result = result.replace(/\n+$/, "");
            if (result.length > 0) result += "\n\n";

            result += block.text + "\n\n";
            continue;
        }

        // sentence
        sentenceGroupCount++;
        result += block.text;

        // 기본: 문장마다 \n
        result += "\n";

        // 2문장 단위: 한 줄 더 추가해서 \n\n
        if (sentenceGroupCount % 2 === 0) {
            result += "\n";
        }
    }

    // \n 3개 이상은 절대 금지
    return result.replace(/\n{3,}/g, "\n\n").trim();
}
