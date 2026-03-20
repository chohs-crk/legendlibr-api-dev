export const config = {
    runtime: "nodejs"
};

import { withApi } from "../_utils/withApi.js";
import { db } from "../../firebaseAdmin.js";
import { ORIGINS } from "../base/data/origins.js";
import { SAFETY_RULES } from "../base/safetyrules.js";

const NAME_MIN = 1;
const NAME_MAX = 15;
const INPUT_DETAIL_MIN_BYTES = 10;
const INPUT_DETAIL_MAX_BYTES = 500;
const DETAIL_HARD_MAX_BYTES = 750;

// =========================
// 문자열 보정 / 길이 계산
// =========================
function normalizeInlineText(value = "") {
    return String(value)
        .replace(/\r\n/g, "\n")
        .replace(/\n+/g, " ")
        .replace(/\s+/g, " ")
        .trim();
}

function getByteLength(value = "") {
    return Buffer.byteLength(String(value), "utf8");
}

function trimToUtf8ByteLength(value = "", maxBytes = DETAIL_HARD_MAX_BYTES) {
    const text = String(value);
    let result = "";

    for (const ch of text) {
        const next = result + ch;
        if (Buffer.byteLength(next, "utf8") > maxBytes) break;
        result = next;
    }

    return result.trim();
}

function isNameLengthValid(name = "") {
    return name.length >= NAME_MIN && name.length <= NAME_MAX;
}

function isInitialDetailLengthValid(detail = "") {
    const bytes = getByteLength(detail);
    return bytes >= INPUT_DETAIL_MIN_BYTES && bytes <= INPUT_DETAIL_MAX_BYTES;
}

// =========================
// JSON 정리 공통 함수
// =========================
function safeJsonParse(raw) {
    if (!raw || typeof raw !== "string") return {};

    const cleaned = raw
        .replace(/```json/g, "")
        .replace(/```/g, "")
        .trim();

    try {
        return JSON.parse(cleaned);
    } catch (e) {
        console.error("JSON PARSE FAIL RAW:", raw);
        return {};
    }
}

// =========================
// Gemini JSON 호출 공통 함수
// =========================
async function callGeminiJSON(prompt, temperature = 0.4) {
    const MODEL_ID = "gemini-2.5-flash-lite";
    const API_VERSION = "v1beta";

    const res = await fetch(
        `https://generativelanguage.googleapis.com/${API_VERSION}/models/${MODEL_ID}:generateContent`,
        {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "x-goog-api-key": process.env.GEMINI_API_KEY
            },
            body: JSON.stringify({
                contents: [
                    {
                        role: "user",
                        parts: [{ text: prompt }]
                    }
                ],
                generationConfig: {
                    temperature,
                    topP: 0.9,
                    maxOutputTokens: 1024
                }
            })
        }
    );

    if (!res.ok) {
        throw new Error("GEMINI_REQUEST_FAILED");
    }

    const data = await res.json();

    const text =
        data.candidates?.[0]?.content?.parts
            ?.map((p) => p.text || "")
            .join("") || "";

    if (!text) {
        throw new Error("AI_EMPTY_RESPONSE");
    }

    return text;
}

// =========================
// 메인 핸들러
// =========================
export default withApi("expensive", async (req, res, { uid }) => {
    if (req.method !== "POST") {
        return res.status(405).json({ ok: false });
    }

    const rawOriginId = req.body?.originId;
    const rawName = req.body?.name;
    const rawDetail = req.body?.detail;

    const originId = normalizeInlineText(rawOriginId);
    const name = normalizeInlineText(rawName);
    const detail = normalizeInlineText(rawDetail);

    if (!originId || !name || !detail) {
        return res.status(400).json({ ok: false, error: "INVALID_INPUT" });
    }

    if (!isNameLengthValid(name)) {
        return res.status(400).json({ ok: false, error: "REGION_NAME_LENGTH_INVALID" });
    }

    // 사용자 원문 입력은 10~500byte만 허용
    if (!isInitialDetailLengthValid(detail)) {
        return res.status(400).json({ ok: false, error: "REGION_DETAIL_LENGTH_INVALID" });
    }

    const originData = ORIGINS[originId];
    if (!originData) {
        return res.status(400).json({ ok: false, error: "INVALID_ORIGIN" });
    }

    try {
        const myRegionPreSnap = await db
            .collection("users")
            .doc(uid)
            .collection("myregion")
            .limit(11)
            .get();

        if (myRegionPreSnap.size >= 10) {
            return res.status(400).json({
                ok: false,
                error: "REGION_LIMIT_EXCEEDED"
            });
        }
    } catch (e) {
        console.error("region-create precheck ERROR:", e);
        return res.status(500).json({ ok: false, error: "SERVER_ERROR" });
    }

    let refinedDetail = detail;

    let safetyResult = {
        nameSafetyScore: 0,
        detailSafetyScore: 0,
        needKorean: false,
        koreanName: name
    };

    try {
        const prompt = `
${SAFETY_RULES}

너는 TRPG 게임 서비스의 지역 생성 전용 AI다.

[출력 규칙]
- 반드시 JSON만 반환한다
- JSON 외의 설명, 문장, 코드블록은 절대 출력하지 마라

[역할]
1. 지역 설명을 자연스럽게 정제한다
2. 서비스 검열 기준에 따라 위험 점수를 계산한다
3. 지역 이름의 언어 적합성을 판단한다

────────────────
[정제 규칙]
────────────────
- 지역 설명은 사용자 입력의 의미를 유지하면서 자연스럽게 다듬는다
- 원문의 분위기와 핵심 설정을 유지한다
- 과장해서 길게 늘리지 마라
- 한 문단으로만 작성한다
- 문단 나누기, 줄바꿈, 따옴표 사용 금지
- 장식적인 수식어를 과도하게 붙이지 마라
- 게임 내 지역 소개문처럼 읽히도록 자연스럽고 간결하게 작성한다

────────────────
[길이 규칙]
────────────────
- 한국어 기준으로 500byte에 가까운 밀도를 목표로 하되, 대략 250토큰 근처 분량을 지향한다
- 허용 목표 범위는 200~300토큰 내외다
- 정확도를 높이기 위해 아래 기준을 동시에 참조해 길이를 맞춘다
- 글자 수 기준: 대략 150~260자
- 어절 수 기준: 대략 35~65개
- 문장 수 기준: 대략 3~6문장
- 위 기준은 참고값이며 약간의 오차는 허용된다
- 핵심은 너무 짧거나 지나치게 길지 않으면서 자연스러운 지역 설명을 만드는 것이다
- 최종 결과는 가능한 한 500byte 부근이 되게 작성하되, 다소 초과하는 오차는 허용한다
- 단 750byte를 넘기지 않도록 작성한다
- 시스템은 출력 후 750byte를 초과하는 부분을 강제로 잘라낼 수 있으므로, 문장이 중간에 끊기지 않도록 처음부터 안정적인 길이로 작성한다

────────────────
[점수 규칙]
────────────────
- 모든 점수는 0~100 정수
- 0에 가까울수록 안전, 100에 가까울수록 위험
- 성적 관계에 대한 은유적 묘사 등을 70점 정도로 간주, 직접적 묘사 등은 90점
- 저작권 캐릭터임을 감지할 경우 80점 이상
- 과할 정도의 고어적 묘사, 단순 폭력은 50점 정도지만 유혈 묘사 등이 포함될 시 그 이상

nameSafetyScore:
- 선정성, 욕설, 음란어
- 실존 작품/지역/고유명사 연상
- 특수문자·비가독성 이름
- 언어 필터 우회 시도

detailSafetyScore:
- 과도한 폭력, 성적 묘사
- 혐오 표현
- 노골적인 실존 작품 설정 차용
- 특정 작품, 세계관, 설정이 명확히 연상될 경우 점수 상승
- 저작권 침해 가능성이 높을수록 점수 크게 상승

────────────────
[언어 판단 규칙]
────────────────
- 한글과 영문은 허용
- 한글, 영문, 숫자, 일반 특수문자를 제외한 문자가 하나라도 포함되면 needKorean = true
- 특수문자로만 구성된 이름도 needKorean = true

────────────────
[koreanName 생성 규칙]
────────────────
- 항상 사람이 읽을 수 있는 순수 한글 이름을 생성한다
- 특수문자는 제거한다
- 반복 어휘는 하나로 정리한다
- 외국 문자는 의미를 유지한 한글로 치환한다

────────────────
[입력 데이터]
────────────────
지역 이름:
${name}

지역 설명 원문:
${detail}

────────────────
[출력 JSON 형식]
────────────────
{
  "refinedDetail": "정제된 지역 설명",
  "nameSafetyScore": 0,
  "detailSafetyScore": 0,
  "needKorean": false,
  "koreanName": "정규화된 한글 지역명"
}
`;

        const raw = await callGeminiJSON(prompt, 0.4);
        const parsed = safeJsonParse(raw);

        if (!parsed || typeof parsed !== "object" || !parsed.refinedDetail) {
            throw new Error("AI_RESPONSE_INVALID");
        }

        const aiDetail = normalizeInlineText(parsed.refinedDetail);

        // AI 결과는 750byte까지만 강제 절단
        refinedDetail = trimToUtf8ByteLength(aiDetail, DETAIL_HARD_MAX_BYTES);

        // 모델이 이상한 빈값을 주는 경우만 원문 fallback
        if (!refinedDetail || getByteLength(refinedDetail) < INPUT_DETAIL_MIN_BYTES) {
            refinedDetail = detail;
        }

        safetyResult = {
            nameSafetyScore: Number(parsed.nameSafetyScore) || 0,
            detailSafetyScore: Number(parsed.detailSafetyScore) || 0,
            needKorean: !!parsed.needKorean,
            koreanName: normalizeInlineText(parsed.koreanName || name)
        };
    } catch (err) {
        console.error("[REGION][AI REFINE FAIL]", err);
        return res.status(500).json({
            ok: false,
            error: err.message || "AI_CALL_FAILED"
        });
    }

    // 저장 직전에도 750byte 하드컷만 한 번 더 적용
    refinedDetail = trimToUtf8ByteLength(refinedDetail, DETAIL_HARD_MAX_BYTES);

    // 여기서는 500byte 재검증하지 않음
    if (!refinedDetail) {
        return res.status(400).json({ ok: false, error: "REGION_DETAIL_LENGTH_INVALID" });
    }

    if (safetyResult.nameSafetyScore >= 60) {
        return res.status(400).json({ ok: false, error: "REGION_NAME_UNSAFE" });
    }

    if (safetyResult.detailSafetyScore >= 70) {
        return res.status(400).json({ ok: false, error: "REGION_DETAIL_UNSAFE" });
    }

    let originScore = 5;

    try {
        const scorePrompt = `
당신은 TRPG 세계관 평가자다.
origin.longDesc와 지역 설명을 비교해
세계관과 얼마나 어울리는지 1~10점으로 채점하라.

반드시 아래 형식으로 JSON만 반환하라:
{
  "score": 숫자
}

[origin 세계관]
${originData.longDesc}

[지역 설명]
${refinedDetail}
`;

        const raw2 = await callGeminiJSON(scorePrompt, 0.2);
        const parsed2 = safeJsonParse(raw2);

        if (parsed2.score) {
            originScore = Math.max(1, Math.min(10, Number(parsed2.score)));
        }
    } catch (err) {
        console.error("originScore 계산 실패:", err);
    }

    try {
        const regionRef = db.collection("regionsUsers").doc();

        await db.runTransaction(async (tx) => {
            const myRegionCountQuery = db
                .collection("users")
                .doc(uid)
                .collection("myregion")
                .limit(11);

            const myRegionCountSnap = await tx.get(myRegionCountQuery);

            if (myRegionCountSnap.size >= 10) {
                throw new Error("REGION_LIMIT_EXCEEDED");
            }

            tx.set(regionRef, {
                originId,
                name,
                koreanName: safetyResult.koreanName,
                needKorean: safetyResult.needKorean,
                safety: {
                    nameSafetyScore: safetyResult.nameSafetyScore,
                    detailSafetyScore: safetyResult.detailSafetyScore
                },
                detail: refinedDetail,
                score: originScore,
                owner: uid,
                ownerchar: null,
                charnum: 0,
                createdAt: new Date()
            });

            const myRegionRef = db
                .collection("users")
                .doc(uid)
                .collection("myregion")
                .doc(regionRef.id);

            tx.set(myRegionRef, {
                regionId: regionRef.id,
                originId,
                addedAt: new Date()
            });
        });

        return res.status(200).json({
            ok: true,
            id: regionRef.id,
            region: {
                id: regionRef.id,
                originId,
                name,
                koreanName: safetyResult.koreanName,
                needKorean: safetyResult.needKorean,
                detail: refinedDetail,
                score: originScore
            }
        });
    } catch (err) {
        const code = err?.message || "";

        if (code === "REGION_LIMIT_EXCEEDED") {
            return res.status(400).json({ ok: false, error: "REGION_LIMIT_EXCEEDED" });
        }

        console.error("region-create DB ERROR:", err);
        return res.status(500).json({ ok: false, error: "SERVER_ERROR" });
    }
});