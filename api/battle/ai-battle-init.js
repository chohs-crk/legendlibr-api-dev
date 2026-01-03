export const config = {
    runtime: "nodejs"
};
// api/ai-battle-init.js
//------------------------------------------------------
//  AI 전투 준비 워커 (battleId 단독 실행)
//  - systemPrompt / userPrompt 는 기존 파일에서 복사하여 붙여넣기
//  - JSON 정규화 로직은 최신 안정판으로 포함됨
//------------------------------------------------------

import { db } from "../../firebaseAdmin.js";



import admin from "firebase-admin";
import fetch from "node-fetch";

//======================================================
// CORS
//======================================================
function applyCors(req, res) {
    const origin = req.headers.origin;
    res.setHeader("Access-Control-Allow-Origin", origin || "*");
    res.setHeader("Vary", "Origin");
    res.setHeader("Access-Control-Allow-Credentials", "true");
    res.setHeader("Access-Control-Allow-Methods", "POST,OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
}

const OPENAI_KEY = process.env.OPENAI_API_KEY;

//======================================================
// 메인 핸들러
//======================================================
export default async function handler(req, res) {
    applyCors(req, res);

    if (req.method === "OPTIONS") return res.status(204).end();
    if (req.method !== "POST")
        return res.status(405).json({ ok: false, error: "POST_ONLY" });

    try {
        const { battleId } = req.body || {};
        if (!battleId)
            return res.status(400).json({ ok: false, error: "BATTLE_ID_REQUIRED" });

        console.log("🚀 [AI INIT START]", battleId);

        //--------------------------------------------------
        // 1) battle 문서 로드
        //--------------------------------------------------
        const battleRef = db.collection("battles").doc(battleId);
        const battleSnap = await battleRef.get();

        if (!battleSnap.exists)
            return res.json({ ok: false, error: "INVALID_BATTLE_ID" });

        const battle = battleSnap.data();
        const { myId, enemyId } = battle;

        //--------------------------------------------------
        // 2) 캐릭터 데이터 로드
        //--------------------------------------------------
        const mySnap = await db.collection("characters").doc(myId).get();
        const enSnap = await db.collection("characters").doc(enemyId).get();

        if (!mySnap.exists || !enSnap.exists) {
            await battleRef.update({
                finished: true,
                finishedReason: "CHAR_DELETED_DURING_AI",
                finishedAt: admin.firestore.FieldValue.serverTimestamp(),
            });
            return res.json({ ok: true, error: "CHAR_DELETED" });
        }

        const charA = { id: myId, ...mySnap.data() };
        const charB = { id: enemyId, ...enSnap.data() };

        //--------------------------------------------------
        // 3) 시스템 프롬포트 / 유저 프롬포트 (직접 복사해서 넣기)
        //--------------------------------------------------
        const systemPrompt = `
당신은 TRPG 스타일 전투 연출을 위한 분석 AI입니다.
두 캐릭터의 정보와 세계관(기원 설명)을 바탕으로 전투 준비 데이터를 JSON으로 생성합니다.

반드시 아래 JSON 형식 그대로 반환하세요.


권장 구조 예:

{
  "effects": [
    {
      "skillOwner": 1
      (1 = A, 2 = B),

      "skillIndex": 0
      (0~3 스킬 번호),

      "effects": [
        {
          "target": "A" 또는 "B" 또는 "C"
          (누구에게 적용되는지),
          (C는 둘 다 아닌 필드),

          "benefitTo": "A" 또는 "B"
          (누가 이득/손해를 보는지),

          "valid": "T" 또는 "F"
          (해당 상성이 유효한지),

          "turns": 1
          (몇 턴 지속되는지, 1~3),

          "effect": "화상"
          (단일 효과명 예: 화상, 출혈, 치유, 표식, 기절 등)

          "turnWeights": [정수 배열]
        }
      ]
    }
  ],

각 스킬의 효과(effects)는 다음 구조를 강하게 권장합니다:

- 기본: 항상 1개는 반드시 생성
- 가능: 상황이 명확할 경우에만 2번째 effect 추가
- 권장 패턴:
  [핵심 효과 1개] + [보조 효과 0~1개]
- 피해야 할 패턴:
  - 의미 없이 나열된 복수 effect
  - 설명만 다르고 기능이 중복된 effect
  - "turnWeights"는 각 effect 안에 존재해야 합니다.
- "turnWeights" 길이는 해당 effect의 "turns" 값과 반드시 일치해야 합니다.
- 각 값은 1~10 사이 정수입니다.
- 이 배열은 각 턴에서 이 effect의 상대적 중요도를 의미합니다.



  pnTable

pnTable 구조:

"pnTable": [
  { "skillOwner": 1, "skillIndex": 0, "pn": "PPNPN" },
  { "skillOwner": 1, "skillIndex": 1, "pn": "NPNPP" },
  ...
]

규칙:

- 각 스킬당 pn 항목은 반드시 정확히 1개만 생성한다.
- pn 문자열의 길이는 반드시 5
- "P" 또는 "N"만 포함
- pn 문자열의 각 문자는 상대 캐릭터의 특징(Features) 5개에 대응한다.
- skillOwner: 1 은 캐릭터 A, 2 는 캐릭터 B
- skillIndex: 0 ~ 3
- 총 8개의 항목
- 설명 텍스트 없이 JSON 객체만 출력한다.


"prologue":
"<개연성 있는 만남(어떠한 오해, 이권 다툼), 장소의 상태, 인물의 대사, 상대에게 하는 외적 행동 중심으로 묘사하며
전투 준비에 대한 간단하고 사실적 행동 표현, 환경과 상황의 변화 위주로 작성 (4문장 내외)>",
[표현 규칙 - 반드시 출력에 포함]
1. 중요한 단어는 반드시 **강조**
- 강조 키워드는 반드시 **와 **로 감싼다 (최대 2개)
- 대사는 반드시 §와 §로 감싼다. 예: §지금이다§ (최대 2개)
- 사용 스킬명은 반드시 『스킬명』 형식으로 출력한다
- 이 규칙이 하나라도 어긋나면 출력은 실패로 간주한다


"choices":
[0, 2, 3]
(스킬 인덱스, 숫자만 사용, 3개, 중복 금지)
"skillScores": {
    "0": 7,
    "1": 4,
    "2": 9,
    "3": 6
  }
  각각 스킬의 현재 중요도를 1부터 10 사이 정수로

주의:
- 무조건 JSON만 반환하세요.
- 백틱(\`\`\`)이나 "여기 JSON입니다" 같은 문장은 넣지 마세요.
- 설명 문장 없이 순수 JSON 객체 하나만 반환하세요.
`.trim();


        // -----------------------------
        // 2) 유저 프롬프트 구성
        // -----------------------------
        const formatChar = (label, c, origin) => {
            const originText = origin ? `${origin}` : "";


            const skillsText = Array.isArray(c.skills)
                ? c.skills
                    .map((s, idx) => {
                        const nm = s?.name || `스킬${idx + 1}`;
                        const eff = s?.shortDesc || s?.effect || s?.long || "";
                        return `- ${idx}: ${nm} (${eff})`;
                    })
                    .join("\n")
                : "";

            const featText = Array.isArray(c.features)
                ? c.features.map((f, idx) => `- ${idx + 1}. ${f}`).join("\n")
                : "";

            return `
[${label} 캐릭터]
이름: ${c.name || "(이름 없음)"}
세계관: ${originText}

배경 스토리:
${c.finalStory || "(스토리 없음)"}

특징(Features):
${featText || "(특징 없음)"}

스킬 목록:
${skillsText || "(스킬 정보 없음)"}
      `.trim();
        };

        const userPrompt = `
다음 두 캐릭터에 대해 전투 준비 데이터를 만들어 주세요.

${formatChar("A", charA, charA.origin)}

---

${formatChar("B", charB, charB.origin)}

요구사항:
1. 두 캐릭터가 같은 장소에서 마주하는 전투 직전 상황을 prologue로 써 주세요.
내면 심리, 다짐, 에감,느낌, 의문형 문장은 지양한다.
비언어적 표현, 외적인 디테일, 행위 등의 묘사 위주로
전투 직전 상황을 다채로운 묘사로 작성
스토리의 묘사를 그대로 쓰지 않기, 다양한 유의어 사용
2. 각 캐릭터의 스킬애 효과, effects를 설계하세요.
   - 각 스킬에는 effect를 1개에서 2개 생성하세요.
   - 각 캐릭터의 스킬 인덱스 0, 1, 2, 3에 대해 반드시 하나씩 블록을 만드세요.
  즉, (skillOwner, skillIndex)의 조합은 다음 8개가 모두 포함되어야 합니다:
  (1,0), (1,1), (1,2), (1,3), (2,0), (2,1), (2,2), (2,3).
     - 각 effect 객체에는 "turns"(1~3)와 "turnWeights"([정수 배열])를 포함하세요.
   - "turnWeights"는 해당 effect의 "turns" 길이와 반드시 일치해야 합니다.



3. 반드시 JSON만 반환하세요.

4. choices 는 반드시 스킬 인덱스만 반환합니다.
- 반드시 숫자 배열
- 길이 3
- 값은 0~3 정수
- 중복 금지
- 문장/객체 금지

5. pnTable을 반드시 생성하세요.

- 각 스킬이 상대의 특징 5개에 대해 반드시 "P"(유리함) 또는 "N"(불리함)으로만 판정합니다.
- 총 8개 결과가 생성되어야 합니다.
- pnTable은 아래 예시 구조를 따릅니다:

[
  { "skillOwner": 1, "skillIndex": 0, "pn": "PPNPN" },

  ...
]

- 반드시 JSON 최상위 필드에 "pnTable"로 포함하세요.
6. skillScores를 반드시 생성
 각 스킬이 지금 턴에 얼마나 중요한지
1~10점 정수로 평가합니다.
 0~3 전부 포함하세요.


    `.trim();

        //--------------------------------------------------
        // 4) OpenAI 호출
        //--------------------------------------------------
        if (!OPENAI_KEY)
            return res.status(500).json({
                ok: false,
                error: "OPENAI_API_KEY_NOT_SET",
            });

        const openAiRes = await fetch(
            "https://api.openai.com/v1/chat/completions",
            {
                method: "POST",
                headers: {
                    Authorization: `Bearer ${OPENAI_KEY}`,
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({
                    model: "gpt-4o-mini-2024-07-18",
                    response_format: { type: "json_object" },
                    messages: [
                        { role: "system", content: systemPrompt },
                        { role: "user", content: userPrompt },
                    ],
                }),
            }
        );

        if (!openAiRes.ok) {
            const txt = await openAiRes.text().catch(() => "");
            return res.status(502).json({
                ok: false,
                error: "OPENAI_FAIL",
                status: openAiRes.status,
                body: txt,
            });
        }

        const raw = await openAiRes.json();
        let text = raw?.choices?.[0]?.message?.content;

        if (typeof text !== "string")
            return res.status(502).json({
                ok: false,
                error: "INVALID_AI_RESPONSE",
                raw,
            });

        // 불필요한 ``` 제거
        text = text.replace(/```json/gi, "").replace(/```/g, "").trim();
        const first = text.indexOf("{");
        const last = text.lastIndexOf("}");
        if (first !== -1 && last !== -1) text = text.substring(first, last + 1);

        //--------------------------------------------------
        // 5) JSON 파싱
        //--------------------------------------------------
        let parsed;
        try {
            parsed = JSON.parse(text);
        } catch (e) {
            return res.status(502).json({
                ok: false,
                error: "JSON_PARSE_FAIL",
                raw: text,
            });
        }

        //--------------------------------------------------
        // 6) JSON 정규화 (effects / pnTable / choices / skillScores)
        //--------------------------------------------------

        //----------------------
        // effects
        //----------------------
        let effects = Array.isArray(parsed.effects) ? parsed.effects : [];
        let globalTurnWeights = Array.isArray(parsed.turnWeights)
            ? [...parsed.turnWeights]
            : [];

        effects.forEach((block) => {
            if (!Array.isArray(block.effects)) return;

            block.effects.forEach((ef) => {
                // valid
                const v = String(ef.valid || "").toLowerCase();
                ef.valid = v === "t" || v === "true" ? "T" : "F";

                // turns 보정
                let turns = Number(ef.turns);
                if (!turns || turns < 1) turns = ef.turnWeights?.length || 1;
                ef.turns = turns;

                // turnWeights 생성/보정
                if (Array.isArray(ef.turnWeights)) {
                    // 그대로 사용
                } else if (globalTurnWeights.length >= turns) {
                    ef.turnWeights = globalTurnWeights.splice(0, turns);
                } else if (Array.isArray(ef.weight)) {
                    ef.turnWeights = ef.weight.map((w) => Number(w.value) || 5);
                } else {
                    ef.turnWeights = Array.from({ length: turns }, () => 5);
                }

                // 정수/범위 보정
                ef.turnWeights = ef.turnWeights.map((n) => {
                    n = Number(n);
                    if (!Number.isFinite(n)) n = 5;
                    return Math.max(1, Math.min(10, Math.round(n)));
                });

                // 길이 보정
                if (ef.turnWeights.length !== turns) {
                    ef.turnWeights = Array.from({ length: turns }, () => 5);
                }

                // weight 구조 변환
                ef.weight = ef.turnWeights.map((v, i) => ({
                    turn: i + 1,
                    value: v,
                }));

                delete ef.turnWeights;
            });
        });

        //----------------------
        // prologue
        //----------------------
        let prologue =
            typeof parsed.prologue === "string" ? parsed.prologue.trim() : "";

        //----------------------
        // choices
        //----------------------
        let choices = [];
        if (
            Array.isArray(parsed.choices) &&
            parsed.choices.length === 3 &&
            parsed.choices.every((n) => Number.isInteger(n) && n >= 0 && n <= 3)
        ) {
            choices = [...new Set(parsed.choices)];
        } else {
            const set = new Set();
            effects.forEach((b) => {
                if (Number.isInteger(b.skillIndex)) set.add(b.skillIndex);
            });
            choices = Array.from(set).slice(0, 3);
        }
        while (choices.length < 3) {
            for (let i = 0; i < 4; i++) {
                if (!choices.includes(i)) choices.push(i);
                if (choices.length === 3) break;
            }
        }

        //----------------------
        // skillScores
        //----------------------
        let skillScores = {};
        if (parsed.skillScores && typeof parsed.skillScores === "object") {
            for (let i = 0; i < 4; i++) {
                let v = Number(parsed.skillScores[i]);
                if (!Number.isFinite(v) || v < 1 || v > 10) v = 5;
                skillScores[i] = v;
            }
        } else {
            skillScores = { 0: 5, 1: 5, 2: 5, 3: 5 };
        }

        //----------------------
        // pnTable
        //----------------------
        let pnTable = Array.isArray(parsed.pnTable) ? parsed.pnTable : [];

        function randomPN() {
            return Array.from({ length: 5 })
                .map(() => (Math.random() < 0.5 ? "P" : "N"))
                .join("");
        }

        const pnMap = new Map();
        pnTable.forEach((p) => {
            const key = `${p.skillOwner}_${p.skillIndex}`;
            if (![1, 2].includes(p.skillOwner)) return;
            if (![0, 1, 2, 3].includes(p.skillIndex)) return;

            if (!p.pn || !/^[PN]{5}$/.test(p.pn)) {
                pnMap.set(key, {
                    ...p,
                    pn: randomPN(),
                });
            } else pnMap.set(key, p);
        });

        // 누락 보충
        for (let o = 1; o <= 2; o++) {
            for (let i = 0; i < 4; i++) {
                const key = `${o}_${i}`;
                if (!pnMap.has(key))
                    pnMap.set(key, {
                        skillOwner: o,
                        skillIndex: i,
                        pn: randomPN(),
                    });
            }
        }

        pnTable = Array.from(pnMap.values());

        //--------------------------------------------------
        // 7) DB 업데이트 (aiReady = true)
        //--------------------------------------------------
        await battleRef.update({
            baseData: {
                effects,
                pnTable,
                prologue,
                choices,
                skillScores,
            },
            aiReady: true,
            aiFinishedAt: admin.firestore.FieldValue.serverTimestamp(),
        });

        console.log("✅ [AI INIT COMPLETE]:", battleId);

        return res.json({ ok: true, ready: true });
    } catch (err) {
        console.error("❌ AI INIT ERROR:", err);
        return res.status(500).json({ ok: false, error: "INIT_SERVER_ERROR" });
    }
}
