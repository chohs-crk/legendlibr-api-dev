export const config = {
    runtime: "nodejs",
    compute: 1
};


import { withApi } from "../_utils/withApi.js";
import { db } from "../../firebaseAdmin.js";
import { getSession, deleteSession, setSession } from "../base/sessionstore.js";

import {
    SYSTEM_FOR_FINAL,
    SYSTEM_FOR_STATS,
    buildFinalEndingPrompt,
    buildFinalStatsPrompt
} from "./final.prompt.js";




/* =========================
   HANDLER
========================= */
async function callGeminiJSON(systemText, userText, temperature = 0.3) {
    const MODEL_ID = "gemini-2.5-flash-lite";
    const API_VERSION = "v1beta";

    const MAX_RETRY = 2;
    let attempt = 0;

    while (attempt < MAX_RETRY) {
        try {
            const res = await fetch(
                `https://generativelanguage.googleapis.com/${API_VERSION}/models/${MODEL_ID}:generateContent`,
                {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                        "x-goog-api-key": process.env.GEMINI_API_KEY
                    },
                    body: JSON.stringify({
                        systemInstruction: {
                            parts: [{ text: systemText }]
                        },
                        contents: [
                            {
                                role: "user",
                                parts: [{ text: userText }]
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
                const errText = await res.text();
                console.error("GEMINI ERROR STATUS:", res.status);
                console.error("GEMINI ERROR BODY:", errText);

                // 503만 재시도
                if (res.status === 503) {
                    attempt++;
                    const delay = 500 * Math.pow(2, attempt); // 500ms, 1000ms, 2000ms...
                    await new Promise(r => setTimeout(r, delay));
                    continue;
                }

                throw new Error("GEMINI_REQUEST_FAILED");
            }

            const data = await res.json();

            if (!data.candidates || !data.candidates.length) {
                throw new Error("GEMINI_EMPTY_RESPONSE");
            }

            const text =
                data.candidates?.[0]?.content?.parts
                    ?.map(p => p.text || "")
                    .join("") || "{}";

            return text.replace(/```json|```/g, "").trim();

        } catch (err) {

            // 우리가 직접 throw한 에러는 재시도하지 않음
            if (
                err.message === "GEMINI_REQUEST_FAILED" ||
                err.message === "GEMINI_EMPTY_RESPONSE"
            ) {
                throw err;
            }

            attempt++;

            if (attempt >= MAX_RETRY) {
                throw new Error("GEMINI_RETRY_EXCEEDED");
            }

            const delay = 500 * Math.pow(2, attempt);
            await new Promise(r => setTimeout(r, delay));
        }

    }

    throw new Error("GEMINI_RETRY_EXCEEDED");
}


export default withApi("expensive", async (req, res, { uid }) => {
    let s;

    try {
        if (req.method !== "POST") {
            return res.status(405).json({ ok: false });
        }

        s = await getSession(uid);
        if (!s || !s.nowFlow?.final) {
            console.log("[FINAL][START]", {
                uid,
                hasSession: !!s,
                nowFlow: s?.nowFlow,
                selected: s?.selected
            });

            return res.status(400).json({ ok: false, error: "INVALID_FLOW" });
        }

  

        /* =========================
        🔒 FINAL 원샷 처리
     ========================= */
        /* =========================
      🔒 CHAR LIMIT PRE-CHECK
   ========================= */
        const userRef = db.collection("users").doc(uid);
        const userSnap = await userRef.get();
        const currentCount = userSnap.exists ? userSnap.data().charCount || 0 : 0;

        if (currentCount >= 10) {
            await deleteSession(uid);
            return res.status(403).json({
                ok: false,
                error: "CHARACTER_LIMIT_REACHED"
            });
        }

        if (s.called) {
            return res.status(409).json({
                ok: false,
                error: "FINAL_ALREADY_CALLED"
            });
        }


        /* =========================
           FINAL AI 호출 시작 마킹
        ========================= */
        s.called = true;
        s.resed = false;
      
        await setSession(uid, s);

        const { input, output } = s;

        /* ------------------------
           STORY SCORE → ENDING TYPE
        ------------------------- */
        function getScore(key) {
            const story = output[key];
            if (!story || !story.choices) return 0;
            const idx = s.selected?.[key];
            const c = story.choices[idx];
            return typeof c?.score === "number" ? c.score : 0;
        }

        const storyScore =
            getScore("story1") +
            getScore("story3");


        const endingType =
            storyScore >= 2 && storyScore <= 3
                ? "비극적인 방향의 결말 스토리 작성"
                : "사건을 성공적으로 해결하는 방향의 결말 스토리 작성";

        /* ------------------------
           AI CALL #1 : ENDING + FEATURES
        ------------------------- */
       

        const prompt1 = buildFinalEndingPrompt({
            input,
            output,
            selected: s.selected,
            endingType
        });
        console.log("[FINAL][PROMPT1_LENGTH]", {
            length: prompt1.length
        });
       

        let result1;
        let ending;
        let features;

        for (let formatAttempt = 0; formatAttempt < 2; formatAttempt++) {

            const raw1 = await callGeminiJSON(
                SYSTEM_FOR_FINAL,
                prompt1,
                0.5
            );

            try {
                result1 = JSON.parse(raw1);
                assertValidEnding(result1);

                ending = result1.ending || "";
                features = Array.isArray(result1.features)
                    ? result1.features
                    : [];

                break; // 성공

            } catch (err) {

                if (formatAttempt === 1) {
                    await deleteSession(uid);
                    return res.status(500).json({
                        ok: false,
                        error: "AI_ENDING_INVALID",
                        reason: String(err)
                    });
                }

                console.warn("[FINAL][ENDING_FORMAT_RETRY]", { uid });
            }
        }


        /* ------------------------
           fullStory 조립 (시간순 + 선택지)
        ------------------------- */
        const fullStory = [
            output.story1?.story || "",
            output.story3?.story || "",
            ending
        ]

            .join(" ")
            .replace(/\s+/g, " ")
            .trim();
        const formattedStory = formatFinalStory(fullStory);
        function formatFinalStory(text) {
            let result = "";
            let sentenceCount = 0;
            let inDialogue = false;

            for (let i = 0; i < text.length; i++) {
                const ch = text[i];

                if (ch === "§") {
                    if (!inDialogue) {
                        result += "\n\n§";
                        inDialogue = true;
                    } else {
                        result += "§\n\n";
                        inDialogue = false;
                    }
                    continue;
                }

                result += ch;

                if (!inDialogue && ch === "." &&
                    text[i + 1] !== "." &&
                    text[i - 1] !== ".") {

                    sentenceCount++;

                    // 1문장마다 1줄
                    result += "\n";

                    // 3문장마다 추가 1줄
                    if (sentenceCount % 3 === 0) {
                        result += "\n";
                    }
                }
            }

            return result.trim();
        }



        function assertValidEnding(result) {
            if (!result || typeof result !== "object") {
                throw "INVALID_ENDING_OBJECT";
            }

            if (typeof result.ending !== "string" || result.ending.trim().length === 0) {
                throw "INVALID_ENDING_TEXT";
            }

            if (!Array.isArray(result.features) || result.features.length !== 5) {
                throw "INVALID_FEATURES";
            }
        }

        function assertValidStats(result) {

            if (!result || typeof result !== "object") {
                result = {};
            }

            /* =========================
               TRAITS 안전 보정
            ========================= */
            if (!result.traits || typeof result.traits !== "object") {
                result.traits = {};
            }

            result.traits.physical = clampInt(result.traits.physical, 1, 10, 5);
            result.traits.intellectual = clampInt(result.traits.intellectual, 1, 10, 5);

            if (!["선", "중립", "악"].includes(result.traits.alignment)) {
                result.traits.alignment = "중립";
            }

            if (typeof result.traits.growth !== "string") {
                result.traits.growth = "성장 가능성이 남아 있다.";
            }

            /* =========================
               SCORES 안전 보정
            ========================= */
            if (!result.scores || typeof result.scores !== "object") {
                result.scores = {};
            }

            const scoreKeys = [
                "combatScore",
                "supportScore",
                "worldScore",
                "narrativeScore",
                "charmScore",
                "dominateScore",
                "metaScore",
                "ruleBreakScore",
                "willscore"
            ];

            for (const key of scoreKeys) {
                result.scores[key] = clampInt(result.scores[key], 1, 10, 5);
            }

            /* =========================
               SKILLS 안전 보정
            ========================= */

            if (!Array.isArray(result.skills)) {
                result.skills = [];
            }

            // 4개 미만이면 기본 스킬 추가
            while (result.skills.length < 4) {
                result.skills.push(makeDefaultSkill());
            }

            // 4개 초과면 자름
            result.skills = result.skills.slice(0, 4);

            result.skills = result.skills.map(skill => {

                if (!skill || typeof skill !== "object") {
                    skill = makeDefaultSkill();
                }

                skill.name = typeof skill.name === "string" && skill.name.trim()
                    ? skill.name
                    : "잃어버린 힘";

                skill.shortDesc = typeof skill.shortDesc === "string"
                    ? skill.shortDesc
                    : "설명이 누락된 기술";

                skill.longDesc = typeof skill.longDesc === "string"
                    ? skill.longDesc
                    : "생성 오류로 누락된 기술이다.";

                skill.power = clampInt(skill.power, 1, 10, 5);

                skill.turns = clampInt(skill.turns, 1, 3, 1);

                if (!Array.isArray(skill.weights)) {
                    skill.weights = [];
                }

                // turns 길이에 맞게 조정
                while (skill.weights.length < skill.turns) {
                    skill.weights.push(5);
                }

                skill.weights = skill.weights
                    .slice(0, skill.turns)
                    .map(w => clampInt(w, 1, 10, 5));

                if (skill.impact !== "A" && skill.impact !== "B") {
                    skill.impact = "A";
                }

                return skill;
            });

            return result;
        }


        /* =========================
           유틸 함수💡
        ========================= */

        function clampInt(value, min, max, fallback) {
            const n = parseInt(value);
            if (!Number.isInteger(n)) return fallback;
            if (n < min) return min;
            if (n > max) return max;
            return n;
        }

        function makeDefaultSkill() {
            return {
                name: "잃어버린 힘",
                power: 5,
                turns: 1,
                weights: [5],
                impact: "A",
                shortDesc: "숨겨진 가능성",
                longDesc: "아직 완전히 발현되지 않은 힘이다."
            };
        }


        /* ------------------------
           AI CALL #2 : TRAITS + SCORES + SKILLS
        ------------------------- */
        let result2;
        const prompt2 = buildFinalStatsPrompt({
            input,
            output,
            fullStory
        });

        for (let formatAttempt = 0; formatAttempt < 2; formatAttempt++) {

            const raw2 = await callGeminiJSON(
                SYSTEM_FOR_STATS,
                prompt2,
                0.3
            );

            console.log("[FINAL][RAW2]", raw2);

            try {
                result2 = JSON.parse(raw2);
                assertValidStats(result2);
                break;

            } catch (err) {

                if (formatAttempt === 1) {
                    await deleteSession(uid);
                    return res.status(500).json({
                        ok: false,
                        error: "AI_STATS_INVALID",
                        reason: String(err)
                    });
                }

                console.warn("[FINAL][STATS_FORMAT_RETRY]", { uid });
            }
        }


        /* ------------------------
           FIRESTORE SAVE
        ------------------------- */
        const ref = db.collection("characters").doc();
       
        try {
            await db.runTransaction(async (tx) => {

                /* =========================
                   1️⃣ USER READ
                ========================= */
                const userSnap = await tx.get(userRef);
                const currentCount = userSnap.exists
                    ? userSnap.data().charCount || 0
                    : 0;

                if (currentCount >= 10) {
                    throw new Error("CHARACTER_LIMIT_REACHED");
                }

                /* =========================
                   2️⃣ REGION READ (선택)
                ========================= */
                const regionId = input.region?.id;
                let regionRef = null;
                let regionSnap = null;
                let regionData = null;

                if (regionId && !regionId.endsWith("_DEFAULT")) {

                    regionRef = db.collection("regionsUsers").doc(regionId);
                    regionSnap = await tx.get(regionRef);

                    if (!regionSnap.exists) {
                        throw new Error("NO_REGION");
                    }

                    regionData = regionSnap.data();

                    // 🔥 새 권한 검증 방식
                    const myRegionRef = db
                        .collection("users")
                        .doc(uid)
                        .collection("myregion")
                        .doc(regionId);

                    const myRegionSnap = await tx.get(myRegionRef);

                    if (!myRegionSnap.exists) {
                        throw new Error("REGION_NOT_REGISTERED");
                    }
                }

                /* =========================
                   3️⃣ CHARACTER WRITE
                ========================= */
                tx.set(ref, {
                    uid,
                    displayRawName: input.name,
                    name: output.name,
                    needKorean: !!output.needKorean,

                    safety: {
                        nameSafetyScore:
                            s.metaSafety?.nameSafetyScore ??
                            output.nameSafetyScore ??
                            0,
                        promptSafetyScore:
                            s.metaSafety?.promptSafetyScore ??
                            output.promptSafetyScore ??
                            0,
                    },

                    promptRaw: input.prompt || "",
                    promptRefined: output.intro || "",

                    existence: output.existence || "",
                    canSpeak: !!output.canSpeak,
                    narrationStyle: output.narrationStyle || "",
                    speechStyle: output.speechStyle || "",
                    profile: output.profile || "",

                    originId: input.origin?.id,
                    origin: input.origin?.name,
                    originDesc: input.origin?.desc,

                    regionId: input.region?.id,
                    region: input.region?.name,
                    regionDetail: input.region?.detail,

                    fullStory: formattedStory,
                    features,
                    storyTheme: output.theme || "",
                    storyScore,

                    traits: result2.traits || {},
                    scores: result2.scores || {},
                    skills: result2.skills,

                    rankScore: 1000,
                    battleCount: 0,
                    createdAt: new Date()
                });

                /* =========================
                   4️⃣ USER UPDATE
                ========================= */
                tx.set(userRef, {
                    charCount: currentCount + 1
                }, { merge: true });

                /* =========================
                   5️⃣ REGION UPDATE (있을 때만)
                ========================= */
                if (regionRef) {

                    const currentNum = regionData.charnum || 0;

                    const updateData = {
                        charnum: currentNum + 1
                    };

                    if (currentNum === 0) {
                        updateData.ownerchar = {
                            id: ref.id,
                            name: output.name
                        };
                    }

                    tx.update(regionRef, updateData);
                }

            });
        } catch (err) {

            if (err.message === "CHARACTER_LIMIT_REACHED") {
                await deleteSession(uid);
                return res.status(403).json({
                    ok: false,
                    error: "CHARACTER_LIMIT_REACHED"
                });
            }

            if (err.message === "NO_REGION") {
                await deleteSession(uid);
                return res.status(400).json({
                    ok: false,
                    error: "NO_REGION"
                });
            }

            if (err.message === "REGION_NOT_REGISTERED") {
                await deleteSession(uid);
                return res.status(403).json({
                    ok: false,
                    error: "REGION_NOT_REGISTERED"
                });
            }

            throw err;
        }


        try {
            await deleteSession(uid);
        } catch (e) {
            console.error("SESSION_DELETE_FAIL:", e);
        }
        return res.json({
            ok: true,
            id: ref.id,
            fullStory
        });

    } catch (err) {
        try {
            await deleteSession(uid);
        } catch (e) {
            console.error("SESSION_DELETE_FAIL:", e);
        }
        console.error("FINAL ERROR:", err);
        return res.status(500).json({
            ok: false,
            error: "FINAL_FAILED"
        });
    }
});
