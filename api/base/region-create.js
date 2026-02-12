export const config = {
    runtime: "nodejs"
};

import { withApi } from "../_utils/withApi.js";
import { db } from "../../firebaseAdmin.js";
import { ORIGINS } from "../base/data/origins.js";
import { SAFETY_RULES } from "../base/safetyrules.js";

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
                    maxOutputTokens: 2048
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
            ?.map(p => p.text || "")
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

    const { originId, name, detail } = req.body || {};
    if (!originId || !name || !detail) {
        return res.status(400).json({ ok: false, error: "INVALID_INPUT" });
    }

    const originData = ORIGINS[originId];
    if (!originData) {
        return res.status(400).json({ ok: false, error: "INVALID_ORIGIN" });
    }

    let refinedDetail = detail;

    let safetyResult = {
        nameSafetyScore: 0,
        detailSafetyScore: 0,
        copyrightScore: 0,
        needKorean: false,
        koreanName: name
    };

    try {
        // ===============================
        // 🎯 기존 프롬프트 내용 그대로 유지
        // ===============================
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
[정제 규칙 – 기존 요구사항 유지]
────────────────
- 지역 설명은 띄어쓰기 포함 **470자 이상 530자 이하**
- 한 문단으로만 작성
- 문단 나누기, 줄바꿈, 따옴표 사용 금지
- 불필요한 공백 제거
- 500자를 벗어나면 다시 작성해야 한다

────────────────
[점수 규칙]
────────────────
- 모든 점수는 0~100 정수
- 0에 가까울수록 안전, 100에 가까울수록 위험

nameSafetyScore:
- 선정성, 욕설, 음란어
- 실존 작품/지역/고유명사 연상
- 특수문자·비가독성 이름
- 언어 필터 우회 시도

detailSafetyScore:
- 과도한 폭력, 성적 묘사
- 혐오 표현
- 노골적인 실존 작품 설정 차용

copyrightScore:
- 특정 작품, 세계관, 설정이 명확히 연상될수록 점수 상승

────────────────
[언어 판단 규칙]
────────────────
- 한글과 영문은 허용
- 한글/영문/숫자/일반 특수문자 외 문자가 포함될 경우
- 단 '한국어'가 아닌 한글 또한 허용
  예를 들어 'आत्मन्'은 불허하지만 '아트만'은 허용

  위 조건을 만족함과 병렬 한글 표기가 없으면 needKorean = true
  예를 들어 광속 拔刀(발도)는 허용, 광속 拔刀만 있을 경우 병렬 한글 표기 없음 간주

- 특수문자로만 구성된 이름도 needKorean = true

────────────────
[koreanName 생성 규칙]
────────────────
- 항상 사람이 읽을 수 있는 순수 한글 이름을 생성한다.
- 특수문자는 제거한다.
- 반복 어휘는 하나로 정리한다.
- 한자 및 외국 문자는 의미를 유지한 한글로 치환한다.
- 예:
  - 철혈의 騎士  → 철혈의 기사
  - 철혈의 騎士(기사) → 철혈의 기사
  - आत्मन् → 아트만
  -The King → 더 킹

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
  "copyrightScore": 0,
  "needKorean": false,
  "koreanName": "정규화된 한글 지역명"
}
`;

        const raw = await callGeminiJSON(prompt, 0.4);
        const parsed = safeJsonParse(raw);

        if (!parsed || typeof parsed !== "object" || !parsed.refinedDetail) {
            throw new Error("AI_RESPONSE_INVALID");
        }

        refinedDetail = parsed.refinedDetail.trim();

        safetyResult = {
            nameSafetyScore: Number(parsed.nameSafetyScore) || 0,
            detailSafetyScore: Number(parsed.detailSafetyScore) || 0,
            copyrightScore: Number(parsed.copyrightScore) || 0,
            needKorean: !!parsed.needKorean,
            koreanName: parsed.koreanName || name
        };

    } catch (err) {
        console.error("[REGION][AI REFINE FAIL]", err);
        return res.status(500).json({
            ok: false,
            error: err.message || "AI_CALL_FAILED"
        });
    }

    // ===============================
    // 🔒 점수 기준 차단
    // ===============================
    if (safetyResult.nameSafetyScore >= 60) {
        return res.status(400).json({ ok: false, error: "REGION_NAME_UNSAFE" });
    }

    if (safetyResult.detailSafetyScore >= 70) {
        return res.status(400).json({ ok: false, error: "REGION_DETAIL_UNSAFE" });
    }

    if (safetyResult.copyrightScore >= 75) {
        return res.status(400).json({ ok: false, error: "REGION_COPYRIGHT_RISK" });
    }

    // ===============================
    // ⭐ 세계관 적합도 평가 (프롬프트 그대로 유지)
    // ===============================
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

        await regionRef.set({
            originId,
            name,
            koreanName: safetyResult.koreanName,
            needKorean: safetyResult.needKorean,
            safety: {
                nameSafetyScore: safetyResult.nameSafetyScore,
                detailSafetyScore: safetyResult.detailSafetyScore,
                copyrightScore: safetyResult.copyrightScore
            },
            detail: refinedDetail,
            score: originScore,
            owner: uid,
            ownerchar: null,
            charnum: 0,
            createdAt: new Date()
        });

        await db.collection("users")
            .doc(uid)
            .collection("myregion")
            .doc(regionRef.id)
            .set({
                regionId: regionRef.id,
                originId,
                addedAt: new Date()
            });

        return res.status(200).json({
            ok: true,
            id: regionRef.id
        });

    } catch (err) {
        console.error("region-create DB ERROR:", err);
        return res.status(500).json({ ok: false, error: "SERVER_ERROR" });
    }
});
