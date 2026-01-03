// ================================================
// raid-battle-init.js (수정본)
// ================================================
export const config = {
    runtime: "nodejs"
};
import admin from "firebase-admin";
import { db } from "../../firebaseAdmin.js";


import fetch from "node-fetch";

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

export default async function handler(req, res) {
    if (req.method !== "POST") {
        return res.status(405).json({ ok: false, error: "POST_ONLY" });
    }

    let raidRef = null;

    try {
        const { raidId, uid } = req.body || {};

        if (!raidId || !uid) {
            return res.status(400).json({
                ok: false,
                error: "raidId, uid가 필요합니다."
            });
        }

        if (!OPENAI_API_KEY) {
            return res.status(500).json({
                ok: false,
                error: "OPENAI_API_KEY가 설정되지 않았습니다."
            });
        }

        // ---------------------------------------------
        // 1) raid 문서 로드
        // ---------------------------------------------
        raidRef = db.collection("raids").doc(raidId);
        const raidSnap = await raidRef.get();

        if (!raidSnap.exists) {
            return res.status(404).json({ ok: false, error: "raid 문서 없음" });
        }

        const raidData = raidSnap.data();
        if (raidData.uid !== uid) {
            return res.status(403).json({ ok: false, error: "권한 없음" });
        }

        if (raidData.aiready === true) {
            return res.json({ ok: true, skipped: true });
        }

        // ---------------------------------------------
        // 2) raidTemp 로드
        // ---------------------------------------------
        const tempId = `${uid}_${raidData.bossId}`;
        const tempRef = db.collection("raidTemp").doc(tempId);
        const tempSnap = await tempRef.get();

        if (!tempSnap.exists) {
            return res.status(400).json({ ok: false, error: "임시 파티 없음" });
        }

        const { team } = tempSnap.data();
        if (!Array.isArray(team) || team.length < 1) {
            return res.status(400).json({ ok: false, error: "파티 정보 없음" });
        }

        // ---------------------------------------------
        // 3) 보스 시트 로드
        // ---------------------------------------------
        const bossRef = db.collection("raidBosses").doc(raidData.bossId);
        const bossSnap = await bossRef.get();

        if (!bossSnap.exists) {
            return res.status(404).json({ ok: false, error: "보스 정보 없음" });
        }

        const boss = bossSnap.data();

        // ---------------------------------------------
        // 4) 유저 캐릭터 정보를 실제 character 문서에서 로딩
        // ---------------------------------------------
        const party = [];

        for (const slot of team) {
            const { charId, selectedSkills } = slot;
            if (!charId) continue;

            const charSnap = await db.collection("characters").doc(charId).get();
            if (!charSnap.exists) continue;

            const ch = charSnap.data();

            // 스킬 4개 모두 읽기: aiSkills 또는 skills 중 존재하는 배열
            const rawSkills = ch.skills || ch.aiSkills || [];
            const fullSkills = rawSkills.slice(0, 4).map((s, idx) => ({
                name: s?.name || `스킬${idx + 1}`,
                shortDesc: s?.shortDesc || s?.effect || s?.longDesc || s?.long || "",
                longDesc: s?.longDesc || s?.long || "",
                pow: s?.power ?? s?.pow ?? 0
            }));

            party.push({
                name: ch.displayRawName || ch.name || "(이름 없음)",
                origin: ch.origin || "",
                promptRefined: ch.promptRefined || "",
                skills: fullSkills
            });
        }

        if (party.length === 0) {
            return res.status(400).json({ ok: false, error: "캐릭터 정보 로딩 실패" });
        }

        const partyCount = party.length;


        // ---------------------------------------------
        // 5) Prompt 구성
        // ---------------------------------------------
        const systemPrompt = `
당신은 레이드 전투 분석 AI입니다.

입력:
- A: 유저 캐릭터(A1~A4)
- 각 캐릭터는 항상 4개의 스킬을 가진다.
- B: 보스 시트(특징 3개 포함)

출력:
반드시 JSON 하나만 반환해야 한다.
JSON 외 텍스트, 설명, 코드블록은 절대 포함하지 말 것.

---------------------------------------------
📌 pnTable 생성 규칙 (중요)
---------------------------------------------
1. pnTable의 전체 길이 = (파티 인원 × 4)

2. 각 항목 구조:
{
  "charIndex": <0 ~ 파티인원-1>,
  "skillIndex": <0~3>,
  "pn": "XXX"
}

3. pn 문자열은 반드시 **3글자**이며,
   각 글자는 'P' 또는 'N' 중 하나여야 한다.
   예: "PPN", "NNP", "PNN"
   다른 문자 또는 길이 허용하지 않음.

4. pn은 "해당 스킬이 보스 특징 3개 각각에 대해 유효한지(P) 아닌지(N)"를 판단하여 생성한다.


---------------------------------------------
📌 effects 생성 규칙 (전투 로직 필수)
---------------------------------------------
1. effects 배열 길이 = (파티 인원 × 4)

2. 각 항목 구조:
{
  "charIndex": i,
  "skillIndex": j,
  "effect": {
    "name": "효과명(1~4 단어의 명사형)",
    "target": "A" 또는 "B",
    (효과가 영향을 미치는 대상)
    "benefitTo": "A" 또는 "B",
    (효과로 이득을 보는 대상)
    "turns": 1~3,
    "turnWeights": [정수 배열]
    - 이 배열은 각 턴에서 이 effect의 상대적 중요도를 의미합니다.
  }
}

3. turns 값에 따라 turnWeights 길이도 반드시 동일:
   - turns = 1 → turnWeights = 1개
   - turns = 2 → turnWeights = 2개
   - turns = 3 → turnWeights = 3개

4. turnWeights의 각 값은 **1~10 정수**여야 한다.



---------------------------------------------
📌 threatLevels 생성 규칙
---------------------------------------------
1. threatLevels 길이 = 파티 인원
2. 각 항목 형태:
   { "charIndex": i, "score": 1~10 }
3. score가 높을수록 보스의 공격이 캐릭터에게 효과적


---------------------------------------------
📌 출력 형식 엄격 고정
---------------------------------------------
오직 하나의 JSON 객체만 출력해야 한다.
JSON 외의 텍스트, 코드블록, 설명은 절대 포함하지 않는다.

`.trim();


        const formatChar = (label, c) => {
            const skillsText = c.skills
                .map((s, idx) => `- ${idx}: ${s.name} (${s.shortDesc})`)
                .join("\n");

            return `
[${label}]
이름: ${c.name}
세계관: ${c.origin}

캐릭터 설명(promptRefined):
${c.promptRefined}

스킬 목록(4개):
${skillsText}
`.trim();
        };

        const userPrompt = `
[BOSS]
이름: ${boss.name}
설명: ${boss.desc}

특징:
${Array.isArray(boss.traits) ? boss.traits.map(t => "- " + t).join("\n") : "- 특성 없음"}


[PARTY]
${party.map((p, i) => formatChar(`A${i + 1}`, p)).join("\n\n")}

지시:
- 캐릭터 1명당 4개의 스킬에 대한 pnTable과 effects 생성
- JSON만 출력
`.trim();

        // ---------------------------------------------
        // 6) OpenAI 호출
        // ---------------------------------------------
        const openaiRes = await fetch("https://api.openai.com/v1/chat/completions", {
            method: "POST",
            headers: {
                Authorization: `Bearer ${OPENAI_API_KEY}`,
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                model: "gpt-4o-mini-2024-07-18",
                response_format: { type: "json_object" },
                messages: [
                    { role: "system", content: systemPrompt },
                    { role: "user", content: userPrompt }
                ]
            })
        });

        if (!openaiRes.ok) {
            const raw = await openaiRes.text().catch(() => "");
            return res.status(502).json({ ok: false, error: "AI 호출 실패", raw });
        }

        const aiData = await openaiRes.json();
        let text = aiData?.choices?.[0]?.message?.content || "";
        text = text.replace(/```json/gi, "").replace(/```/g, "").trim();

        const first = text.indexOf("{");
        const last = text.lastIndexOf("}");
        if (first !== -1 && last !== -1) text = text.substring(first, last + 1);

        // ------------------------------
        // ⚠ JSON 파싱 예외 처리 추가
        // ------------------------------
        let parsed = {};
        try {
            parsed = JSON.parse(text);
        } catch (e) {
            console.warn("⚠ AI JSON 파싱 실패 → 기본값 적용");
            parsed = {};
        }

        const expectedLen = partyCount * 4;

        // ===================================================================
        // 📌 자동 보정 로직 삽입 영역
        // ===================================================================

        // --- PN 보정 함수 ---
        function fixPn(pn) {
            if (typeof pn !== "string") return "NNN";
            if (pn.length !== 3) return "NNN";
            if (![...pn].every(ch => ch === "P" || ch === "N")) return "NNN";
            return pn;
        }

        function fixPnTable(pnTable, expectedLen, partyCount) {
            const fixed = [];
            for (let i = 0; i < expectedLen; i++) {
                const raw = pnTable?.[i] || {};
                fixed.push({
                    charIndex: Number.isInteger(raw.charIndex) ? raw.charIndex : Math.floor(i / 4),
                    skillIndex: Number.isInteger(raw.skillIndex) ? raw.skillIndex : (i % 4),
                    pn: fixPn(raw.pn)
                });
            }
            return fixed;
        }

        // --- Effect 보정 함수 ---
        function fixEffectStruct(raw, charIndex, skillIndex) {
            if (!raw) raw = {};
            if (!raw.effect) raw.effect = {};
            const eff = raw.effect;

            return {
                charIndex: Number.isInteger(raw.charIndex) ? raw.charIndex : charIndex,
                skillIndex: Number.isInteger(raw.skillIndex) ? raw.skillIndex : skillIndex,
                effect: {
                    name: typeof eff.name === "string" && eff.name.length > 0 ? eff.name : "기본효과",
                    target: eff.target === "A" || eff.target === "B" ? eff.target : "B",
                    benefitTo: eff.benefitTo === "A" || eff.benefitTo === "B" ? eff.benefitTo : "A",
                    turns: [1, 2, 3].includes(eff.turns) ? eff.turns : 1,
                    turnWeights: Array.isArray(eff.turnWeights) &&
                        eff.turnWeights.length === (eff.turns || 1)
                        ? eff.turnWeights.map(v => (Number.isInteger(v) ? Math.max(1, Math.min(10, v)) : 1))
                        : [1]
                }
            };
        }

        function fixEffects(effects, expectedLen) {
            const fixed = [];
            for (let i = 0; i < expectedLen; i++) {
                const raw = effects?.[i] || {};
                fixed.push(fixEffectStruct(raw, Math.floor(i / 4), i % 4));
            }
            return fixed;
        }

        // --- Threat 보정 함수 ---
        function fixThreatLevels(threatLevels, partyCount) {
            if (!Array.isArray(threatLevels) || threatLevels.length !== partyCount) {
                return Array.from({ length: partyCount }, (_, i) => ({
                    charIndex: i,
                    score: 5
                }));
            }

            return threatLevels.map((t, i) => ({
                charIndex: Number.isInteger(t.charIndex) ? t.charIndex : i,
                score: Number.isInteger(t.score) ? Math.max(1, Math.min(10, t.score)) : 5
            }));
        }

        // ===================================================================
        // 📌 실제 보정 적용
        // ===================================================================
        let pnTable = fixPnTable(parsed.pnTable || [], expectedLen, partyCount);
        let effects = fixEffects(parsed.effects || [], expectedLen);
        let threatLevels = fixThreatLevels(parsed.threatLevels || [], partyCount);

        // -------------------------------
        // 기존 selectedSkills 수집 로직 유지
        // -------------------------------
        const selectedSkillsByChar = {};
        for (const slot of team) {
            selectedSkillsByChar[slot.charId] = slot.selectedSkills;
        }

        // ---------------------------------------------
        // 7) Firestore 저장
        // ---------------------------------------------
        await raidRef.update({
            selectedSkillsByChar,
            pnTable,
            effects,
            threatLevels,
            aiready: true,
            battlestart: true,
            battlefinished: false,
            updatedAt: admin.firestore.FieldValue.serverTimestamp()
        });





        await tempRef.delete();

        return res.json({ ok: true, raidId });

    } catch (err) {
        console.error("raid-battle-init ERROR:", err);

        if (raidRef) {
            try {
                await raidRef.update({
                    aiready: true,
                    battlestart: true,
                    battlefinished: true,
                    loseReason: "ai_error",
                    updatedAt: admin.firestore.FieldValue.serverTimestamp()
                });
            } catch (e2) { }
        }

        return res.status(500).json({ ok: false, error: "AI_INIT_FAILED" });
    }
}

