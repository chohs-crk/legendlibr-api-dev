// /api/create/final.js
import { withApi } from "../_utils/withApi.js";
import { db } from "../../firebaseAdmin.js";
import { getSession, deleteSession } from "../base/sessionstore.js";

export const config = { runtime: "nodejs" };


const OPENAI_API_KEY = process.env.OPENAI_API_KEY;





export default withApi("expensive", async (req, res, { uid }) => {
    if (req.method !== "POST") {
        return res.status(405).json({ ok: false });
    }

    const s = await getSession(uid);
    if (!s || !s.nowFlow.final) {
        return res.status(400).json({ ok: false, error: "INVALID_FLOW" });
    }

    const output = s.output;
    const input = s.input;

    // -------------------------------
    // STORY SCORE 계산 & ENDING 타입 결정
    // -------------------------------
    function getScore(output, selectedIndex, key) {
        const story = output[key];
        if (!story || !story.choices) return 0;
        const choice = story.choices[selectedIndex];
        if (!choice || typeof choice.score !== "number") return 0;
        return choice.score;
    }

    const s1 = getScore(output, s.selected?.story1, "story1");
    const s2 = getScore(output, s.selected?.story2, "story2");
    const s3 = getScore(output, s.selected?.story3, "story3");

    const storyScore = s1 + s2 + s3;

    let endingType = "success";
    if (storyScore >= 3 && storyScore <= 6) {
        endingType = "tragedy";
    } else if (storyScore >= 7 && storyScore <= 9) {
        endingType = "success";
    }

    // ----------------------------------
    // AI CALL #1 → finalstory + features
    // ----------------------------------
    const prompt1 = `
당신은 TRPG 캐릭터 생성 전문 AI이다.
아래 작업을 하나의 JSON으로 반환한다.

[CHAR]
이름: ${output.name}
소개: ${output.intro}

[STORY1]
${output.story1?.story || ""}

[STORY2]
${output.story2?.story || ""}

[STORY3]
${output.story3?.story || ""}

[SELECTED]
"${output.story1?.choices[s.selected?.story1]?.text}"
"${output.story2?.choices[s.selected?.story2]?.text}"
"${output.story3?.choices[s.selected?.story3]?.text}"

[ENDING_RULE]
${endingType === "tragedy" ? "비극적인 엔딩으로 마무리한다" : "성공적인 엔딩으로 마무리한다"}

[OUTPUT REQUIREMENTS]
{
 "finalstory": "(결말 포함 단편, 띄어쓰기 포함 한국어로 900자)",
 "features": [
    "특징1","특징2","특징3","특징4","특징5"
 ]
}
`;

    const aiRes1 = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${OPENAI_API_KEY}`
        },
        body: JSON.stringify({
            model: "gpt-4o-mini",
            temperature: 0.4,
            messages: [
                { role: "system", content: "반드시 JSON만 반환하라." },
                { role: "user", content: prompt1 }
            ]
        })
    });

    const aiJson1 = await aiRes1.json();
    let raw1 = aiJson1?.choices?.[0]?.message?.content || "{}";
    raw1 = raw1.replace(/```json|```/g, "").trim();

    let result1 = {};
    try {
        result1 = JSON.parse(raw1);
    } catch (err) {
        await deleteSession(uid);
        console.error("PARSE_PROMPT1_FAIL:", raw1);
        return res.status(500).json({ ok: false, error: "PARSE1_FAIL" });
    }

    const finalstory = result1.finalstory || "";
    const features = result1.features || [];


    // ----------------------------------
    // AI CALL #2 → scores + skills
    // ----------------------------------
    const prompt2 = `
당신은 TRPG 캐릭터 능력/스킬 생성 전문 AI이다.
아래 데이터를 기반으로 JSON만 반환한다.

[CHAR]
이름: ${output.name}
소개: ${output.intro}

[FINAL_STORY]
${finalstory}

[WORLD]
${input.origin?.name} - ${input.origin?.desc}
${input.region?.name} - ${input.region?.detail}

[OUTPUT REQUIREMENTS]
{
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
     "shortDesc": "짧은 한 어절의 설명",
     "longDesc": "긴 세 문장 이상 분량"
   },
   {},
   {},
   {}
 ]
}
`;

    const aiRes2 = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${OPENAI_API_KEY}`
        },
        body: JSON.stringify({
            model: "gpt-4o-mini",
            temperature: 0.4,
            messages: [
                { role: "system", content: "반드시 JSON만 반환" },
                { role: "user", content: prompt2 }
            ]
        })
    });

    const aiJson2 = await aiRes2.json();
    let raw2 = aiJson2?.choices?.[0]?.message?.content || "{}";
    raw2 = raw2.replace(/```json|```/g, "").trim();

    let result2 = {};
    try {
        result2 = JSON.parse(raw2);
    } catch (err) {
        await deleteSession(uid);
        console.error("PARSE_PROMPT2_FAIL:", raw2);
        return res.status(500).json({ ok: false, error: "PARSE2_FAIL" });
    }

    const scores = result2.scores || {};
    const skills = result2.skills || [];


    // ----------------------------------
    // Firestore 저장 (기존 구조를 유지)
    // ----------------------------------
    const ref = db.collection("characters").doc();

    const save = {
        uid,

        displayRawName: input.name,
        name: output.name,

        promptRaw: input.prompt || "",
        promptRefined: output.intro || "",

        originId: input.origin?.id,
        origin: input.origin?.name,
        originDesc: input.origin?.desc,

        regionId: input.region?.id,
        region: input.region?.name,
        regionDetail: input.region?.detail,

        finalStory: finalstory,
        features,

        scores,
        skills,

        storyTheme: output.theme || "",
        storyScore,

        rankScore: 1000,
        battleCount: 0,

        createdAt: new Date()
    };

    await ref.set(save);

    // region owner / charnum 처리
    try {
        const regionId = input.region?.id;
        if (!regionId) return;

        // 🔥 default region은 regionsUsers에 없으므로 즉시 스킵
        if (regionId.endsWith("_DEFAULT")) {
            console.log("[final] skip region update (default region):", regionId);
            return;
        }

        // --- user region만 처리 ---
        const regionRef = db.collection("regionsUsers").doc(regionId);
        const regionSnap = await regionRef.get();

        if (!regionSnap.exists) {
            throw "REGION_NOT_FOUND";
        }

        const regionData = regionSnap.data();
        const currentNum = regionData.charnum || 0;

        const updateData = {
            charnum: currentNum + 1
        };

        if (currentNum === 0) {
            updateData.ownerchar = {
                name: output.name,
                id: ref.id
            };
        }

        await regionRef.update(updateData);

    } catch (err) {
        console.error("REGION_UPDATE_FAIL:", err);
    }




    // 세션 종료
    // --------------------
    // 세션 완전 삭제
    // --------------------
    try {
        await deleteSession(uid);
    } catch (err) {
        console.error("SESSION_DELETE_FAIL:", err);
    }

    return res.json({
        ok: true,
        id: ref.id,
        finalstory
    });

});
