export const config = {
    runtime: "nodejs"
};
import { withApi } from "../_utils/withApi.js";
import { db } from "../../firebaseAdmin.js";
import fetch from "node-fetch";
import { ORIGINS } from "../base/data/origins.js";

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

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
// 세션 쿠키
// =========================
function getSessionCookie(req) {
    const cookie = req.headers.cookie || "";
    return cookie
        .split(";")
        .find(v => v.trim().startsWith("session="))
        ?.split("=")[1] || null;
}

// =========================
// 메인 핸들러
// =========================
export default withApi("expensive", async (req, res, { uid }) => {
    if (req.method !== "POST") return res.status(405).json({ ok: false });

    const { originId, name, detail } = req.body || {};
    if (!originId || !name || !detail) {
        return res.status(400).json({ ok: false, error: "INVALID_INPUT" });
    }

    // origin 정보 가져오기 (score 계산 필요)
    const originData = ORIGINS[originId];
    if (!originData) {
        return res.status(400).json({ ok: false, error: "INVALID_ORIGIN" });
    }

    // ===============================
    // 🎯 detail 문장 정제 (정확히 500자)
    // ===============================
    let refinedDetail = detail;

    try {
        const prompt = `
당신은 TRPG 세계관 전문 편집자다.
아래 지역 설명을 자연스럽게 정제하되,
최종 결과는 반드시 띄어쓰기 포함**정확히 470자 이상 530자 이하**로 작성한다.
문단 나누기·줄바꿈·따옴표·불필요한 공백 없이 한 문단으로만 작성하라.
500자를 벗어나면 다시 작성해야 한다.

[입력 원문]
${detail}

반환 형식(JSON):
{
  "refined": "정제된 문장"
}
`;


        const r = await fetch("https://api.openai.com/v1/chat/completions", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${OPENAI_API_KEY}`
            },
            body: JSON.stringify({
                model: "gpt-4o-mini",
                messages: [{ role: "user", content: prompt }],
                temperature: 0.7
            })
        });

        const j = await r.json();
        const raw = j.choices?.[0]?.message?.content || "{}";
        const parsed = safeJsonParse(raw);

        if (parsed.refined) refinedDetail = parsed.refined.trim();
        if (refinedDetail.length > 600) {
            refinedDetail = refinedDetail.slice(0, 600);
        }
    } catch (err) {
        console.error("AI detail refine 실패:", err);
    }

    // ===============================
    // ⭐ 세계관 적합도 평가 (1~10점)
    // ===============================
    let originScore = 5; // 기본값

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

        const r2 = await fetch("https://api.openai.com/v1/chat/completions", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${OPENAI_API_KEY}`
            },
            body: JSON.stringify({
                model: "gpt-4o-mini",
                messages: [{ role: "user", content: scorePrompt }],
                temperature: 0.2
            })
        });

        const j2 = await r2.json();
        const raw2 = j2.choices?.[0]?.message?.content || "{}";
        const parsed2 = safeJsonParse(raw2);

        if (parsed2.score) {
            originScore = Math.max(1, Math.min(10, Number(parsed2.score)));
        }
    } catch (err) {
        console.error("originScore 계산 실패:", err);
    }

    // ===============================
    // Firestore 저장
    // ===============================
    try {
        // 1️⃣ regionsUsers에 실제 region 저장
        const regionRef = db.collection("regionsUsers").doc();

        await regionRef.set({
            originId,
            name,
            detail: refinedDetail,
            score: originScore,
            owner: uid,
            ownerchar: null,
            charnum: 0,
            createdAt: new Date()
        });

        // 2️⃣ 내 myregion에 참조만 저장
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
