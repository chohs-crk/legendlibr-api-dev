// api/battle-turn.js
// - battle-controller.js에서 하던 "턴 1회 계산"을 서버에서 수행
// - HP / 데미지 / 효과 / 누적 데미지 모두 서버 전용 계산
// - 프론트는 스킬 선택만 보내고, 결과 로그를 받아서 연출만 담당
// ✅ VS 이름 + skillMap(스킬 이름 매핑) 반환 추가됨
export const config = {
    runtime: "nodejs"
};
import { auth, db } from "../../firebaseAdmin.js";




import admin from "firebase-admin";
import { rateLimit } from "../base/rateLimit.js";

// ==============================
// 공통 CORS
// ==============================
function applyCors(req, res) {
    const origin = req.headers.origin;

    const ALLOW = [
        "https://legendlibr.web.app",
        "https://ai-proxy2.vercel.app"
    ];

    if (ALLOW.includes(origin)) {
        res.setHeader("Access-Control-Allow-Origin", origin);
    }

    res.setHeader("Vary", "Origin");
    res.setHeader("Access-Control-Allow-Credentials", "true");
    res.setHeader("Access-Control-Allow-Methods", "POST,OPTIONS");
    res.setHeader(
        "Access-Control-Allow-Headers",
        "Content-Type, Authorization"
    );
}
function getSessionCookie(req) {
    const cookie = req.headers.cookie || "";
    const item = cookie.split(";").find(v => v.trim().startsWith("session="));
    return item ? item.split("=")[1] : null;
}

async function requireSession(req, res) {
    const session = getSessionCookie(req);
    if (!session) {
        res.status(401).json({ ok: false, error: "NO_SESSION" });
        throw new Error("NO_SESSION");
    }

    try {
        const decoded = await admin.auth().verifySessionCookie(session, true);
        return decoded.uid;
    } catch (err) {
        res.status(401).json({ ok: false, error: "INVALID_SESSION" });
        throw new Error("INVALID_SESSION");
    }
}

// ==============================
// 이하 유틸 / 수학 / 계산 함수
// (네가 올린 원본 그대로 유지 — 중략 없음)
// ==============================

function safeLog(x) {
    if (!x || x <= 0) return 0;
    return Math.log(x);
}

function scorePenalty(score) {
    if (score <= 5) return 0;
    const exp = 0.9 * (score - 5);
    return -1.35 * Math.exp(exp);
}

function calcHP(char) {
    const s = char.scores || {};
    const world = s.worldScore || 0;
    const narrative = s.narrativeScore || 0;
    const storyScore = Number(s.storyScore) || 0;

    const ruleBreak = s.ruleBreakScore || 0;
    const dominate = s.dominateScore || 0;
    const meta = s.metaScore || 0;

    let hp = 140;
    hp += world * 3;

    if (storyScore > 0) {
        if (storyScore <= 6) hp += 15;
        else hp += 30;
    }

    if (narrative >= 4 && narrative <= 8) {
        hp += narrative * 2.5;
    } else if (narrative === 9 || narrative === 10) {
        hp += 20;
    }

    hp += scorePenalty(ruleBreak);
    hp += scorePenalty(dominate);
    hp += scorePenalty(meta);

    return Math.max(1, Math.round(hp));
}

function getTurnWeightFromAI(effect, elapsedTurn) {
    const weights = Array.isArray(effect.weight)
        ? effect.weight.map(w => w.value)
        : null;

    if (!Array.isArray(weights) || weights.length === 0) {
        return 1 / (effect.duration || effect.turns || 1);
    }

    const idx = elapsedTurn - 1;
    if (idx < 0 || idx >= weights.length) return 0;

    const sum = weights.reduce((a, b) => a + b, 0) || 1;
    let base = weights[idx] / sum;

    if (weights.length === 2) base *= 1.1;
    if (weights.length === 3) base *= 1.2;

    return base;
}

function aggregateEffectBuckets(activeRaw, currentTurn) {
    const active = {
        A: Array.isArray(activeRaw?.A) ? activeRaw.A : [],
        B: Array.isArray(activeRaw?.B) ? activeRaw.B : [],
        C: Array.isArray(activeRaw?.C) ? activeRaw.C : []
    };

    let AP = 0, AN = 0, BP = 0, BN = 0;

    for (const ef of active.A) {
        const elapsed = currentTurn - ef.startTurn + 1;
        if (elapsed > ef.duration) continue;

        const base = 1;
        const validFactor = ef.valid === "T" ? 1 : 0.5;
        const tdWeight = getTurnWeightFromAI(ef, elapsed);
        const v = base * validFactor * tdWeight;

        if (ef.benefitTo === "A") AP += v;
        else AN += v;
    }

    for (const ef of active.B) {
        const elapsed = currentTurn - ef.startTurn + 1;
        if (elapsed > ef.duration) continue;

        const base = 1;
        const validFactor = ef.valid === "T" ? 1 : 0.5;
        const tdWeight = getTurnWeightFromAI(ef, elapsed);
        const v = base * validFactor * tdWeight;

        if (ef.benefitTo === "B") BP += v;
        else BN += v;
    }

    for (const ef of active.C) {
        const elapsed = currentTurn - ef.startTurn + 1;
        if (elapsed > ef.duration) continue;

        const base = 0.5;
        const validFactor = ef.valid === "T" ? 1 : 0.5;
        const tdWeight = getTurnWeightFromAI(ef, elapsed);
        const v = base * validFactor * tdWeight;

        if (ef.benefitTo === "A") {
            AP += v;
            BN += v;
        } else {
            BP += v;
            AN += v;
        }
    }

    return { AP, AN, BP, BN };
}

function round1(v) {
    return Math.round(v * 10) / 10;
}

function calcCumulativeDamageForA(AP, AN, scoresA, scoresB, turn) {
    const supportA = scoresA.supportScore || 1;
    const combatB = scoresB.combatScore || 1;

    const fSup = 1 + 0.2 * safeLog(supportA);
    const fCom = 1 + 0.2 * safeLog(combatB);

    const denom = 6 + fSup * AP;
    const numer = 6 + fCom * AN;

    const turnFactor = Math.pow(1.1, (turn || 1) - 1);
    return 20 * (numer / denom) * turnFactor;
}

function calcCumulativeDamageForB(BP, BN, scoresB, scoresA, turn) {
    const supportB = scoresB.supportScore || 1;
    const combatA = scoresA.combatScore || 1;

    const fSup = 1 + 0.2 * safeLog(supportB);
    const fCom = 1 + 0.2 * safeLog(combatA);

    const denom = 6 + fSup * BP;
    const numer = 6 + fCom * BN;

    const turnFactor = Math.pow(1.1, (turn || 1) - 1);
    return 20 * (numer / denom) * turnFactor;
}

function calcSkillDamage(power, combatScore, TCount, FCount, turn) {
    const base = 20 + (power || 0);
    const combatFactor = 1 + 0.2 * safeLog(combatScore || 1);
    const tTerm = 10 + (TCount || 0);
    const fTerm = 10 + (FCount || 0);
    const tfFactor = tTerm / fTerm;
    const turnFactor = Math.pow(1.1, (turn || 1) - 1);
    return base * combatFactor * tfFactor * turnFactor;
}

function countSkillPN(pnTable, ownerIndex, skillIndex) {
    const row = pnTable.find(
        e => e.skillOwner === ownerIndex && e.skillIndex === skillIndex
    );

    const pn = row?.pn || "";

    let P = 0;
    let N = 0;

    for (const ch of pn) {
        if (ch === "P") P++;
        else if (ch === "N") N++;
    }

    return { P, N };
}

function calcSkillWeight(skillIndex, baseData) {
    const scores = baseData?.skillScores || {};
    const choices = baseData?.choices || [];

    const chosen = scores[skillIndex] || 5;

    const sum = choices
        .map(i => scores[i] ?? 5)
        .reduce((a, b) => a + b, 0) || 1;

    const n = (chosen * 3) / sum;
    return (4 + n) / 5;
}
// ==============================
// ✅ 턴 1회 실행 (runSingleTurnServer)
// ==============================
function runSingleTurnServer(params) {
    const {
        battleData,
        baseData,
        baseEffects,
        activeEffects,
        scoresA,
        scoresB,
        pnTable,
        charA,
        charB,
        hpA,
        hpB,
        choice,
        turn
    } = params;

    let nextHpA = hpA;
    let nextHpB = hpB;
    const eff = { ...activeEffects };

    const skillAIndex = choice.skillA ?? 0;
    const skillBIndex = choice.skillB ?? 0;

    const skillA = Array.isArray(charA.skills)
        ? charA.skills[skillAIndex] || { power: 0, name: "기본 공격" }
        : { power: 0, name: "기본 공격" };

    const skillB = Array.isArray(charB.skills)
        ? charB.skills[skillBIndex] || { power: 0, name: "기본 공격" }
        : { power: 0, name: "기본 공격" };


    // 1) 효과 활성화
    activateSkillEffects(baseEffects, 1, skillAIndex, turn, eff, baseData);
    activateSkillEffects(baseEffects, 2, skillBIndex, turn, eff, baseData);

    // 2) 효과 합산
    const { AP, AN, BP, BN } = aggregateEffectBuckets(eff, turn);

    // 3) PN 기반 스킬 데미지
    const pnA = countSkillPN(pnTable, 1, skillAIndex);
    const pnB = countSkillPN(pnTable, 2, skillBIndex);

    let skillDmgA = calcSkillDamage(
        skillA.power || 0,
        scoresA.combatScore || 1,
        pnA.P,
        pnA.N,
        turn
    );
    let skillDmgB = calcSkillDamage(
        skillB.power || 0,
        scoresB.combatScore || 1,
        pnB.P,
        pnB.N,
        turn
    );

    // 4) 누적 데미지
    let cumDmgA = calcCumulativeDamageForA(AP, AN, scoresA, scoresB, turn);
    let cumDmgB = calcCumulativeDamageForB(BP, BN, scoresB, scoresA, turn);

    // 반올림
    skillDmgA = round1(skillDmgA);
    skillDmgB = round1(skillDmgB);
    cumDmgA = round1(cumDmgA);
    cumDmgB = round1(cumDmgB);

    // 5) 가중치
    const wA = calcSkillWeight(skillAIndex, baseData);
    const wB = calcSkillWeight(skillBIndex, baseData);

    const totalDmgA = (skillDmgA + cumDmgA) * wA;
    const totalDmgB = (skillDmgB + cumDmgB) * wB;

    nextHpB = round1(nextHpB - totalDmgA);
    nextHpA = round1(nextHpA - totalDmgB);

    const logEntry = {
        turn,
        skillAIndex: choice.skillA,
        skillBIndex: choice.skillB,
        skillAName: skillA.name,
        skillBName: skillB.name,
        AP, AN, BP, BN,
        skillDmgA,
        skillDmgB,
        cumDmgA,
        cumDmgB,
        totalDmgA,
        totalDmgB,
        hpA_before: hpA,
        hpB_before: hpB,
        hpA_after: nextHpA,
        hpB_after: nextHpB
    };

    return {
        nextHpA,
        nextHpB,
        activeEffects: eff,
        logEntry
    };
}

function activateSkillEffects(baseEffects, ownerIndex, skillIndex, currentTurn, active, baseData) {
    if (!Array.isArray(active.A)) active.A = [];
    if (!Array.isArray(active.B)) active.B = [];
    if (!Array.isArray(active.C)) active.C = [];

    const effBlock = baseEffects.find(
        e => e.skillOwner === ownerIndex && e.skillIndex === skillIndex
    );
    if (!effBlock || !Array.isArray(effBlock.effects)) return;

    const effects = effBlock.effects.filter((_, idx) => idx < 2);

    const originalBlocks = Array.isArray(baseData?.effects)
        ? baseData.effects
        : [];

    for (const ef of effects) {
        let weight = ef.weight;
        if (!weight) {
            const originBlock = originalBlocks.find(
                b => b.skillOwner === ownerIndex && b.skillIndex === skillIndex
            );
            const originEf = originBlock?.effects?.find(
                o => o.effect === ef.effect && o.turns === ef.turns
            );
            weight = originEf?.weight || [];
        }

        const efObj = {
            target: ef.target,
            benefitTo: ef.benefitTo,
            effect: ef.effect,
            duration: ef.turns || ef.duration || 1,
            startTurn: currentTurn,
            valid: ef.valid || "T",
            weight,
            source: { owner: ownerIndex, skillIndex }
        };

        if (ef.target === "A") active.A.push(efObj);
        else if (ef.target === "B") active.B.push(efObj);
        else if (ef.target === "C") active.C.push(efObj);
    }
}

function randomEnemySkillIndex(charB) {
    const skills = Array.isArray(charB?.skills) ? charB.skills : [];
    if (skills.length === 0) return 0;
    return Math.floor(Math.random() * skills.length);
}

// ==============================
// ✅ 메인 핸들러
// ==============================
export default async function handler(req, res) {
    applyCors(req, res);
    if (req.method === "OPTIONS") return res.status(200).end();
    const uid = await requireSession(req, res);
    if (req.body?.mode === "load") {
        const { battleId } = req.body;
        const battleRef = db.collection("battles").doc(battleId);
        const battleSnap = await battleRef.get();
        if (!battleSnap.exists) {
            return res.json({ ok: false, error: "BATTLE_NOT_FOUND" });
        }

        const battleData = battleSnap.data();

        const myId = battleData.myId;
        const enemyId = battleData.enemyId;

        const [snapA, snapB] = await Promise.all([
            db.collection("characters").doc(myId).get(),
            db.collection("characters").doc(enemyId).get()
        ]);

        const charA = { id: snapA.id, ...snapA.data() };
        const charB = { id: snapB.id, ...snapB.data() };

        const skillMap = {};
        (charA.skills || []).forEach((s, i) => {
            skillMap[i] = s?.name || `스킬${i + 1}`;
        });

        const history = Array.isArray(battleData.logs) ? [...battleData.logs] : [];

        if (battleData.baseData?.prologue) {
            history.unshift({
                turn: 0,
                skillAName: "전투 개시",
                narration: battleData.baseData.prologue
            });
        }

        return res.json({
            ok: true,
            mode: "resume",
            turn: battleData.currentTurn || 1,
            finished: battleData.finished || false,

            vs: {
                myName: charA.displayRawName || charA.name,
                enemyName: charB.displayRawName || charB.name
            },

            skillMap,

            history,

            nextChoices: battleData.finished ? [] : [0, 1, 2]
        });

    }

    
    if (req.method !== "POST") {
        return res.status(405).json({ ok: false, error: "POST_ONLY" });
    }

    if (!rateLimit(req, res)) {
        return res.status(429).json({ ok: false, error: "RATE_LIMIT" });
    }

    try {
        // ✅ ✅ ✅ [포기 처리 모드]
        if (req.body?.mode === "giveup") {
            const { battleId } = req.body;

            if (!battleId) {
                return res.status(400).json({ ok: false, error: "BATTLE_ID_REQUIRED" });
            }

            const battleRef = db.collection("battles").doc(battleId);
            const battleSnap = await battleRef.get();

            if (!battleSnap.exists) {
                return res.status(404).json({ ok: false, error: "BATTLE_NOT_FOUND" });
            }

            const battleData = battleSnap.data();

            // ✅ 이미 끝난 전투면 그냥 종료 응답
            if (battleData.finished === true) {
                return res.json({
                    ok: true,
                    finished: true,
                    winnerName: battleData.winnerName || null,
                    reason: "ALREADY_FINISHED"
                });
            }

            // ✅ 포기 = 상대 승리
            await battleRef.update({
                finished: true,
                winnerName: battleData.enemyName,
                finishedReason: "FORFEIT",
                finishedAt: admin.firestore.FieldValue.serverTimestamp()
            });

            return res.json({
                ok: true,
                finished: true,
                winnerName: battleData.enemyName,
                reason: "FORFEIT"
            });
        }

        const { battleId, mySkillIndex } = req.body || {};

        if (!battleId || typeof mySkillIndex !== "number") {
            return res.status(400).json({ ok: false, error: "BAD_REQUEST" });
        }

        const battleRef = db.collection("battles").doc(battleId);
        const battleSnap = await battleRef.get();

        if (!battleSnap.exists) {
            return res.status(404).json({ ok: false, error: "BATTLE_NOT_FOUND" });
        }

        const battleData = battleSnap.data();

        if (battleData.finished) {
            return res.status(400).json({ ok: false, error: "BATTLE_FINISHED" });
        }

        const myId = battleData.myId;
        const enemyId = battleData.enemyId;

        const [snapA, snapB] = await Promise.all([
            db.collection("characters").doc(myId).get(),
            db.collection("characters").doc(enemyId).get()
        ]);
        const charA = { id: snapA.id, ...snapA.data() };
        const charB = { id: snapB.id, ...snapB.data() };
        // 내 캐릭 삭제 → 상대 승리
        if (!snapA.exists) {
            await battleRef.update({
                finished: true,
                winnerName: charB.displayRawName || charB.name,
                finishedReason: "MY_CHAR_DELETED_DURING_BATTLE",
                finishedAt: admin.firestore.FieldValue.serverTimestamp()
            });
            const forcedText = "전투는 갑작스럽게 막을 내렸고, 남겨진 상대가 승자가 되었다.";

            return res.json({
                ok: true,
                finished: true,
                winnerName: charB.displayRawName || charB.name,
                forcedEnd: true,
                resultText: forcedText   // ✅ 이 줄 추가
            });


        }

        // 상대 삭제 → 내 승리 처리
        if (!snapB.exists) {
            await battleRef.update({
                finished: true,
                winnerName: charA.displayRawName || charA.name,
                finishedReason: "ENEMY_DELETED_DURING_BATTLE",
                finishedAt: admin.firestore.FieldValue.serverTimestamp()
            });

            const forcedText = "상대는 더 이상 전투를 이어갈 수 없었고, 그렇게 전투는 너의 승리로 끝이 났다.";

            return res.json({
                ok: true,
                finished: true,
                winnerName: charA.displayRawName || charA.name,
                forcedEnd: true,
                resultText: forcedText   // ✅ 이 줄만 추가
            });
        }


       

        const scoresA = charA.scores || {};
        const scoresB = charB.scores || {};

        let currentTurn = battleData.currentTurn || 1;
        const maxTurns = 3;   // ✅ 서버도 무조건 3턴


        const initHpA = calcHP(charA);
        const initHpB = calcHP(charB);

        let hpA = typeof battleData.hpA === "number" ? battleData.hpA : initHpA;
        let hpB = typeof battleData.hpB === "number" ? battleData.hpB : initHpB;

        const baseData = battleData.baseData || {};
        const baseEffects = Array.isArray(baseData.effects) ? baseData.effects : [];
        const pnTable = Array.isArray(baseData.pnTable) ? baseData.pnTable : [];

        let activeEffects = battleData.activeEffects || { A: [], B: [], C: [] };
        const logs = Array.isArray(battleData.logs) ? battleData.logs : [];
        const skillChoices = Array.isArray(battleData.skillChoices)
            ? battleData.skillChoices
            : [];

        const enemySkillIndex = randomEnemySkillIndex(charB);

        const choice = {
            turn: currentTurn,
            skillA: mySkillIndex,
            skillB: enemySkillIndex
        };
        skillChoices.push(choice);

        const { nextHpA, nextHpB, activeEffects: nextEffects, logEntry } =
            runSingleTurnServer({
                battleData,
                baseData,
                baseEffects,
                activeEffects,
                scoresA,
                scoresB,
                pnTable,
                charA,
                charB,
                hpA,
                hpB,
                choice,
                turn: currentTurn
            });

        hpA = nextHpA;
        hpB = nextHpB;
        activeEffects = nextEffects;
        let finished = false;
        if (hpA <= 0 || hpB <= 0 || currentTurn >= maxTurns) {
            finished = true;
        }
        // ✅ 승자 판단 (서버에서만 가능)
        let winnerName = null;
        let winnerId = null;
        let loserId = null;

        if (finished) {
            if (hpA <= hpB) {
                winnerId = enemyId;
                loserId = myId;
            } else {
                winnerId = myId;
                loserId = enemyId;
            }
        }
        await battleRef.update({
            finished: true,
            winnerId,
            loserId,
            eloApplied: false,
            finishedAt: admin.firestore.FieldValue.serverTimestamp()
        });



        // ✅ 스킬 이름 맵 생성
        const skillMap = {};
        (charA.skills || []).forEach((s, i) => {
            skillMap[i] = s?.name || `스킬${i + 1}`;
        });

        // ✅ battle-log 서버 내부 호출
        const logRes = await fetch("https://ai-proxy2.vercel.app/api/battle/battle-log", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                turn: logEntry.turn,

                currentSkill: {
                    A: { name: logEntry.skillAName },
                    B: { name: logEntry.skillBName }
                },

                characters: {
                    A: {
                        name: charA.displayRawName || charA.name,
                        features: charA.features || []
                    },
                    B: {
                        name: charB.displayRawName || charB.name,
                        features: charB.features || []
                    }
                },

                hpAnalysis: {
                    A: { before: logEntry.hpA_before, after: logEntry.hpA_after },
                    B: { before: logEntry.hpB_before, after: logEntry.hpB_after }
                },

                damage: {
                    A: logEntry.totalDmgA,
                    B: logEntry.totalDmgB
                },

                allSkills: {
                    A: (charA.skills || []).map((s, i) => ({
                        index: i,
                        name: s.name,
                        desc: s.desc || ""
                    })),
                    B: (charB.skills || []).map((s, i) => ({
                        index: i,
                        name: s.name,
                        desc: s.desc || ""
                    }))
                },

                final: finished,
                winner: winnerName
            })
        });

        const aiData = await logRes.json();

        const safeNarration =
            finished
                ? (aiData.resultText || "결정적인 승부가 갈렸다.")
                : (aiData.narration || "전장의 흐름이 요동친다.");

        // ✅ ✅ ✅ 이번 턴의 “완성된 로그”
        const fullLogEntry = {
            ...logEntry,
            narration: safeNarration,
            winnerName: finished ? winnerName : null,

            // ✅ 서버 시간은 숫자(Date.now)로 저장
            createdAt: Date.now()
        };


        // ✅ ✅ ✅ 여기서 logs 배열 완성
        logs.push(fullLogEntry);

        // ✅ ✅ ✅ “완성된 logs”를 DB에 저장 (이게 핵심)
        await battleRef.update({
            currentTurn: finished ? currentTurn : currentTurn + 1,
            hpA,
            hpB,
            activeEffects,
            skillChoices,
            logs,   // ✅ 이제 이번 턴 로그까지 포함됨
            finished: finished === true,
            updatedAt: admin.firestore.FieldValue.serverTimestamp()
        });

        // ✅ 응답 반환
        return res.json({
            ok: true,
            turn: currentTurn,
            finished,

            vs: {
                myName: charA.displayRawName || charA.name,
                enemyName: charB.displayRawName || charB.name
            },

            winnerName,
            skillMap,
            usedSkillName: logEntry.skillAName,
            narration: safeNarration,
            nextChoices: finished ? [] : (aiData.choices || [])
        });





    } catch (err) {
        console.error("BATTLE_TURN_ERROR:", err);
        return res.status(500).json({
            ok: false,
            error: "SERVER_ERROR",
            message: err.message
        });
    }
}

