export const config = {
    runtime: "nodejs",
    compute: 1
};


import { withApi } from "../_utils/withApi.js";
import { db } from "../../firebaseAdmin.js";
import { getSession, deleteSession, setSession } from "../base/sessionstore.js";

import {
    SYSTEM_FOR_FINAL,
    buildFinalEndingPrompt,
    buildFinalStatsPrompt
} from "./final.prompt.js";



/* =========================
   HANDLER
========================= */
async function callGeminiJSON(systemText, userText, temperature = 0.4) {
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

    if (!res.ok) throw new Error("GEMINI_REQUEST_FAILED");

    const data = await res.json();
    // 🔒 Gemini 빈 응답 보호
    if (!data.candidates || !data.candidates.length) {
        throw new Error("GEMINI_EMPTY_RESPONSE");
    }
    const text =
        data.candidates?.[0]?.content?.parts
            ?.map(p => p.text || "")
            .join("") || "{}";

    return text.replace(/```json|```/g, "").trim();
}

export default withApi("expensive", async (req, res, { uid }) => {
    let s;

    try {
        if (req.method !== "POST") {
            return res.status(405).json({ ok: false });
        }

        s = await getSession(uid);
        if (!s || !s.nowFlow?.final) {
            return res.status(400).json({ ok: false, error: "INVALID_FLOW" });
        }

  

        /* =========================
        🔒 FINAL 원샷 처리
     ========================= */
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
            getScore("story2") +
            getScore("story3");

        const endingType =
            storyScore >= 3 && storyScore <= 5
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


        const raw1 = await callGeminiJSON(
            SYSTEM_FOR_FINAL,
            prompt1,
            0.4
        );


       
       

        let result1;
        try {
            result1 = JSON.parse(raw1);
            assertValidEnding(result1);
        } catch (err) {
            return res.status(500).json({
                ok: false,
                error: "AI_ENDING_INVALID",
                reason: String(err)
            });
        }

        const ending = result1.ending || "";
        const features = Array.isArray(result1.features) ? result1.features : [];

        /* ------------------------
           fullStory 조립 (시간순 + 선택지)
        ------------------------- */
        const fullStory = [
            output.story1?.story || "",
            output.story2?.story || "",
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

                // 대사 시작/끝
                if (ch === "§") {
                    inDialogue = !inDialogue;
                    sentenceCount = 0;
                    result += "\n\n" + ch;
                    continue;
                }

                result += ch;

                // 마침표 하나일 경우만 카운트
                if (
                    ch === "." &&
                    text[i + 1] !== "." &&
                    text[i - 1] !== "."
                ) {
                    sentenceCount++;
                }

                // 세 문장마다 줄바꿈
                if (!inDialogue && sentenceCount === 3) {
                    result += "\n";
                    sentenceCount = 0;
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
                throw "INVALID_STATS_OBJECT";
            }

            if (!result.traits || typeof result.traits !== "object") {
                throw "INVALID_TRAITS";
            }

            if (!result.scores || typeof result.scores !== "object") {
                throw "INVALID_SCORES";
            }

            if (!Array.isArray(result.skills) || result.skills.length !== 4) {
                throw "INVALID_SKILLS_COUNT";
            }

            for (const s of result.skills) {
                if (
                    !s ||
                    typeof s !== "object" ||
                    typeof s.name !== "string" ||
                    typeof s.shortDesc !== "string" ||
                    typeof s.longDesc !== "string" ||
                    !Number.isInteger(s.power)
                ) {
                    throw "INVALID_SKILL_FORMAT";
                }

                if (
                    !Number.isInteger(s.turns) ||
                    s.turns < 1 ||
                    s.turns > 3
                ) {
                    throw "INVALID_SKILL_TURNS";
                }

                if (
                    !Array.isArray(s.weights) ||
                    s.weights.length !== s.turns ||
                    !s.weights.every(w => Number.isInteger(w) && w >= 1 && w <= 10)
                ) {
                    throw "INVALID_SKILL_WEIGHTS";
                }

                if (s.impact !== "A" && s.impact !== "B") {
                    throw "INVALID_SKILL_IMPACT";
                }
            }
        }

        /* ------------------------
           AI CALL #2 : TRAITS + SCORES + SKILLS
        ------------------------- */
        const prompt2 = buildFinalStatsPrompt({
            input,
            output,
            fullStory
        });

        const raw2 = await callGeminiJSON(
            `
반드시 JSON만 반환한다.

[점수 체계 규칙]
모든 점수는 1에서 10 사이의 정수다.

scores 의미:
- combatScore: 전투에 강한 정도
- supportScore: 보조에 강한 정도
- worldScore: 세계관과 어울리는 정도
- narrativeScore: 서사가 다채로운 정도
- charmScore: 캐릭터의 매력도
- dominateScore: 상대의 특성을 무시하고 지배하는 정도
- metaScore: 이 게임 세계가 허구임을 인지하는 정도
- ruleBreakScore: 게임 규칙을 재정의하는 정도
- willscore: 캐릭터가 가진 의지의 강도

skills 규칙:
- power는 스킬의 중요도를 의미한다
- 수치가 높을수록 캐릭터의 핵심 스킬이다

- turns는 스킬 지속 턴 수이며 1~3 정수
  - 즉발·폭발형 공격일수록 1
  - 충전, 유지, 필드 변화, 지속 효과는 3에 가깝다

- weights는 각 턴의 중요도를 나타내는 배열이다
  - 길이는 turns와 반드시 같아야 한다
  - 각 값은 1~10 정수
  - 초반 강하고 약해지면 높은 수 → 낮은 수
  - 후반에 강해지면 낮은 수 → 높은 수

- impact는 효과의 주 대상이다
  - 자신에게 더 큰 영향을 주면 "A"
  - 상대에게 더 큰 영향을 주면 "B"


traits 규칙:
- physical, intellectual은 1~10 정수
- alignment는 반드시 선 / 중립 / 악 중 하나
- growth는 최대 3문장
`,
            prompt2,
            0.4
        );


        
 

        let result2;
        try {
            result2 = JSON.parse(raw2);
            assertValidStats(result2);
        } catch (err) {
            return res.status(500).json({
                ok: false,
                error: "AI_STATS_INVALID",
                reason: String(err)
            });
        }

        /* ------------------------
           FIRESTORE SAVE
        ------------------------- */
        const ref = db.collection("characters").doc();

        await ref.set({
            uid,

            /* =====================
               🔤 NAME / LANGUAGE
            ===================== */
            displayRawName: input.name,
            name: output.name,
         
            needKorean: !!output.needKorean,

            /* =====================
               🔍 SAFETY SCORES
            ===================== */
            safety: {
                nameSafetyScore: output.nameSafetyScore ?? 0,
                promptSafetyScore: output.promptSafetyScore ?? 0,
           
            },

            /* =====================
               🧠 PROMPT
            ===================== */
            promptRaw: input.prompt || "",
            promptRefined: output.intro || "",

            /* =====================
               📖 CHARACTER META
            ===================== */
            existence: output.existence,
            canSpeak: !!output.canSpeak,
            narrationStyle: output.narrationStyle,
            speechStyle: output.speechStyle,

            originId: input.origin?.id,
            origin: input.origin?.name,
            originDesc: input.origin?.desc,

            regionId: input.region?.id,
            region: input.region?.name,
            regionDetail: input.region?.detail,

            /* =====================
               📚 STORY
            ===================== */
            fullStory: formattedStory,

            features,
            storyTheme: output.theme || "",
            storyScore,

            /* =====================
               🎲 GAME DATA
            ===================== */
            traits: result2.traits || {},
            scores: result2.scores || {},
            skills: result2.skills,

            rankScore: 1000,
            battleCount: 0,

            createdAt: new Date()
        });

        // ===============================
        // 👤 USER charCount +1
        // ===============================
        const userRef = db.collection("users").doc(uid);
        await db.runTransaction(async (tx) => {
            const snap = await tx.get(userRef);
            const current = snap.exists ? snap.data().charCount || 0 : 0;
            tx.set(
                userRef,
                { charCount: current + 1 },
                { merge: true }
            );
        });


        /* ------------------------
           REGION POST-PROCESS
        ------------------------- */
        try {
            const regionId = input.region?.id;
            if (regionId && !regionId.endsWith("_DEFAULT")) {
                const regionRef = db.collection("regionsUsers").doc(regionId);
                const snap = await regionRef.get();
                if (snap.exists) {
                    const data = snap.data();
                    const currentNum = data.charnum || 0;

                    const updateData = { charnum: currentNum + 1 };
                    if (currentNum === 0) {
                        updateData.ownerchar = {
                            name: output.name,
                            id: ref.id
                        };
                    }

                    await regionRef.update(updateData);
                }
            }

        } catch (err) {
            console.error("REGION_UPDATE_FAIL:", err);
        }
       
        return res.json({
            ok: true,
            id: ref.id,
            fullStory
        });

    } catch (err) {
        console.error("FINAL ERROR:", err);
        return res.status(500).json({
            ok: false,
            error: "FINAL_FAILED"
        });
    } finally {
       
            await deleteSession(uid);
        
    }
});
