// api/raid-controller-back.js
// 레이드 전투 서버 컨트롤러 (세션 버전)
// - 프론트는 여기로만 요청한다.
// - HP / 데미지 / 이펙트 / 턴 진행 / 승패 판정 모두 여기서 처리
// - Firestore raids 문서는 "전투 시작 시 1번 읽고(load), 전투 종료 시 1번만 쓴다"
export const config = {
    runtime: "nodejs"
};
import admin from "firebase-admin";
import { auth, db } from "../../firebaseAdmin.js";





function applyCors(req, res) {
    const origin = req.headers.origin || "*";
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Access-Control-Allow-Credentials", "true");
    res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
}

// 세션 쿠키 파싱
function parseCookiesSafe(req) {
    try {
        const header = req?.headers?.cookie;
        if (!header) return {};
        return header.split(";").reduce((acc, cur) => {
            const [k, v] = cur.split("=");
            acc[k.trim()] = decodeURIComponent(v);
            return acc;
        }, {});
    } catch {
        return {};
    }
}

// =========================
// 서버 메모리 세션
// =========================
// key: raidId, value: state
const battleSessions = {};

// =========================
// 유틸 & 계산 함수
// =========================

// PN 테이블에서 T/F 카운트
function getTFfromPN(pnTable, charIndex, skillIndex) {
    if (!pnTable || !Array.isArray(pnTable)) {
        return { tCount: 0, fCount: 0 };
    }

    const row = pnTable.find(
        r => r.charIndex === charIndex && r.skillIndex === skillIndex
    );

    if (!row || typeof row.pn !== "string") {
        return { tCount: 0, fCount: 0 };
    }

    const pn = row.pn.toUpperCase().replace(/[^PN]/g, "N");

    let tCount = 0;
    let fCount = 0;

    for (const c of pn) {
        if (c === "P") tCount++;
        else fCount++;
    }

    return { tCount, fCount };
}
function scorePenalty(score) {
    if (score <= 5) return 0;
    const exp = 0.9 * (score - 5);
    return -1.35 * Math.exp(exp);
}
// HP 계산 (간단 버전: 스토리 점수 반영)
// 필요하다면 기존 복잡 HP 공식 그대로 다시 넣어도 됨
function calcCharHp(ch) {
    const s = ch.scores || {};

    const world = s.worldScore || 0;
    const narrative = s.narrativeScore || 0;
    const storyScore = Number(s.storyScore) || 0;

    const ruleBreak = s.ruleBreakScore || 0;
    const dominate = s.dominateScore || 0;
    const meta = s.metaScore || 0;

    let hp = 140;
    hp += world * 3;

    // 스토리 점수
    if (storyScore > 0) {
        if (storyScore <= 6) hp += 15;
        else hp += 30;
    }

    // 내러티브 점수
    if (narrative >= 4 && narrative <= 8) {
        hp += narrative * 2.5;
    } else if (narrative === 9 || narrative === 10) {
        hp += 20;
    }

    // 페널티 점수들
    hp += scorePenalty(ruleBreak);
    hp += scorePenalty(dominate);
    hp += scorePenalty(meta);

    return Math.max(1, Math.round(hp));
}

// 평균 스코어
function getAverageScore(party, key) {
    if (!party || !party.length) return 5;
    let sum = 0;
    let count = 0;

    for (const ch of party) {
        const scores = ch.scores || {};
        const v = scores[key];
        if (typeof v === "number") {
            sum += v;
            count++;
        }
    }

    return count > 0 ? sum / count : 5;
}

// 플레이어 스킬 데미지 (기존 calcPlayerSkillDamage)
function calcPlayerSkillDamage({ power, combatScore, tCount, fCount, engagementCount }) {
    const safeCombat = Math.max(combatScore, 1);
    const base = 20 + (power || 0);
    const combatFactor = 1 + 0.2 * Math.log(safeCombat);
    const tfFactor = (10 + tCount) / (10 + fCount);
    const turnFactor = Math.pow(1.02, Math.max((engagementCount || 1) - 1, 0));

    return base * combatFactor * tfFactor * turnFactor;
}

// effect 타입 분류 (AP / BN / BP / AN 등)
function classifyEffect(effect) {
    const { target, benefitTo } = effect || {};

    // A: 캐릭터측, B: 보스측
    if (target === "A" && benefitTo === "A") return "AP";
    if (target === "B" && benefitTo === "B") return "BP";
    if (target === "B" && benefitTo === "A") return "BN";
    if (target === "A" && benefitTo === "B") return "AN";

    return "NONE";
}

// 스킬당 effect 타입 조회 (요청대로: 스킬마다 effect 하나라는 가정)
function getEffectTypeForSkill(state, charIndex, skillIndex) {
    const row = (state.effects || []).find(
        r => r.charIndex === charIndex && r.skillIndex === skillIndex
    );
    if (!row || !row.effect) return "NONE";
    return classifyEffect(row.effect);
}

// activeEffects에 등록
function addEffectFromTable(state, charIndex, skillIndex) {
    const rows = (state.effects || []).filter(
        r => r.charIndex === charIndex && r.skillIndex === skillIndex
    );

    if (!Array.isArray(state.activeEffects)) {
        state.activeEffects = [];
    }

    for (const row of rows) {
        const e = row.effect || {};
        const type = classifyEffect(e);

        const turns = e.turns ?? 1;
        const totalEng = turns * 3; // engagement 단위

        state.activeEffects.push({
            ...e,
            type,
            currentEngagementIndex: 0,
            remainingEngagements: totalEng
        });
    }
}

// effect 진행 1회
function progressEffectsOneEngagement(state) {
    state.activeEffects = (state.activeEffects || [])
        .map(e => ({
            ...e,
            remainingEngagements: (e.remainingEngagements ?? 0) - 1,
            currentEngagementIndex: (e.currentEngagementIndex ?? 0) + 1
        }))
        .filter(e => (e.remainingEngagements ?? 0) > 0);
}

// 누적 데미지 계산 (기존 calcAccumulatedDamage)
function calcAccumulatedDamage(state, turnNumber) {
    const activeEffects = state.activeEffects || [];
    if (!activeEffects.length) return 0;

    const combatAvg = getAverageScore(state.party, "combatScore");
    const supportAvg = getAverageScore(state.party, "supportScore");
    const safeCombat = Math.max(combatAvg, 1);
    const safeSupport = Math.max(supportAvg, 1);

    let AP = 0;
    let BN = 0;

    for (const eff of activeEffects) {
        const totalTw = (eff.turnWeights || []).reduce((a, b) => a + b, 0) || 1;
        const idx = Math.floor((eff.currentEngagementIndex ?? 0) / 3);
        const curTw = (eff.turnWeights || [1])[idx] ?? 1;

        let weight = curTw / totalTw;

        if (eff.turns === 2) weight *= 1.1;
        else if (eff.turns === 3) weight *= 1.2;

        if (eff.type === "AP") AP += weight;
        if (eff.type === "BN") BN += weight;
    }

    const combatFactor = 6 + (1 + 0.2 * Math.log(safeCombat)) * BN;
    const supportFactor = 6 + (1 + 0.2 * Math.log(safeSupport)) * AP;
    const turnFactor = Math.pow(1.1, Math.max((turnNumber || 1) - 1, 0));

    const damage = (20 * combatFactor * supportFactor * turnFactor) / 12;

    return Math.max(0, damage);
}

// 보스 데미지 (기존 calcBossDamage)
// 안전 숫자 변환기
function toNum(v, fallback = 0) {
    const n = Number(v);
    return Number.isFinite(n) ? n : fallback;
}

function calcBossDamage(state, { skill, threatLevel }) {
    // pow 정제
    const rawPow = skill?.pow ?? skill?.power ?? 0;
    const base = toNum(rawPow, 0);

    // threatLevel 정제
    const t = toNum(threatLevel, 1);
    const threatFactor = 0.8 + t * 0.04;

    // engagement 정제
    const eng = toNum(state.engagementCount, 1);
    const engagementFactor = Math.pow(1.02, Math.max(eng - 1, 0));

    return base * threatFactor * engagementFactor;
}


// 전투 종료 판정 (기존 checkBattleEnd)
function checkBattleEnd(state) {
    if (state.battlefinished) return true;

    const bossDead = (state.boss?.hp ?? 0) <= 0;
    const aliveChars = (state.party || []).filter(ch => ch.currentHp > 0);

    if (bossDead) {
        state.logs.push("✅ 보스를 쓰러뜨렸습니다! 레이드 승리!");
        state.battlefinished = true;
        state.result = "win";
        return true;
    }

    if (aliveChars.length === 0) {
        state.logs.push("❌ 모든 캐릭터가 쓰러졌습니다. 레이드 패배…");
        state.battlefinished = true;
        state.result = "lose";
        return true;
    }

    return false;
}

// 보스 행동 타입
function getBossActionType(skill) {
    if (!skill || !skill.class) return "none";
    if (skill.class === "회복") return "heal";
    // 단일 / 광역 → 전부 공격으로 취급
    return "attack";
}

// AP/BN × 보스 행동에 따른 2배 배율
function getDamageMultiplier(effectType, bossActionType) {
    if (effectType === "AP" && bossActionType === "attack") return 2;
    if (effectType === "BN" && bossActionType === "heal") return 2;
    return 1;
}

// 보스 스킬 랜덤 선택
function pickBossSkill(state) {
    const boss = state.boss || {};
    const skills = boss.skills || [];
    if (!skills.length) return null;
    const idx = Math.floor(Math.random() * skills.length);
    return skills[idx];
}

// 보스 반격 (기존 bossCounterAttack를, 외부에서 뽑은 skill을 사용하도록 변경)
function bossCounterAttack(state, skill) {
    const party = state.party || [];
    const boss = state.boss || {};
    const logs = state.logs;

    const aliveChars = party.filter(ch => ch.currentHp > 0);
    if (!aliveChars.length) return;

    if (!skill) return;
    logs.push(`⚠️ 보스 반격: [${skill.name}]`);

    if (skill.class === "단일") {
        let target = state.currentCharIndex;
        let ch = party[target];

        if (!ch || ch.currentHp <= 0) {
            const aliveIdx = party.findIndex(c => c.currentHp > 0);
            if (aliveIdx === -1) return;
            target = aliveIdx;
            ch = party[target];
        }

        const threatLevel = (state.threatLevels || [])[target] ?? 5;

        const dmg = calcBossDamage(state, {
            skill,
            threatLevel
        });

        ch.currentHp = toNum(ch.currentHp, ch.maxHp);
        ch.currentHp -= toNum(dmg, 0);

        logs.push(
            `→ ${ch.name || ch.displayRawName}에게 ${dmg.toFixed(1)} 피해 (HP: ${Math.max(ch.currentHp, 0).toFixed(1)})`
        );

    } else if (skill.class === "광역") {
        logs.push(`→ 파티 전체 공격!`);
        party.forEach((ch, idx) => {
            if (ch.currentHp <= 0) return;

            const dmg = calcBossDamage(state, {
                skill,
                threatLevel: (state.threatLevels || [])[idx] ?? 5
            });

            ch.currentHp -= dmg;
            logs.push(
                `- ${ch.name || ch.displayRawName}: ${dmg.toFixed(1)} 피해 (HP: ${Math.max(ch.currentHp, 0).toFixed(1)})`
            );
        });

    } else if (skill.class === "회복") {
        const heal = calcBossDamage(state, {
            skill,
            threatLevel: 5
        });

        boss.hp += heal;
        logs.push(`→ 보스 회복 +${heal.toFixed(1)} (HP: ${boss.hp.toFixed(1)})`);
    }
}

// engagement 1회 끝난 뒤 effect 데미지 적용
function applyEffectDamageAfterEngagement(state) {
    const acc = calcAccumulatedDamage(state, state.engagementCount) / 3;

    if (acc > 0) {
        state.boss.hp -= acc;
        state.logs.push(
            `🔥 지속효과 데미지(교전): ${acc.toFixed(1)} (보스 HP: ${state.boss.hp.toFixed(1)})`
        );
    }

    progressEffectsOneEngagement(state);

    if (checkBattleEnd(state)) return true;
    return false;
}

// 현재 턴의 캐릭터 인덱스 → 다음 캐릭터 인덱스 계산
function proceedTurnOrder(state) {
    const party = state.party || [];
    const aliveIdx = party
        .map((ch, idx) => ({ ch, idx }))
        .filter(x => x.ch.currentHp > 0)
        .map(x => x.idx);

    if (!aliveIdx.length) return;

    if (!Array.isArray(state.turnOrder) || !state.turnOrder.length) {
        state.turnOrder = aliveIdx;
        state.currentCharIndex = state.turnOrder[0];
        return;
    }

    const cur = state.currentCharIndex;
    const idxInOrder = state.turnOrder.indexOf(cur);

    if (idxInOrder === -1 || idxInOrder === state.turnOrder.length - 1) {
        // 턴 종료 → 다음 턴 시작
        state.uiTurn++;
        state.logs.push(`--- ${state.uiTurn}턴 시작 ---`);
        state.turnOrder = aliveIdx;
        state.currentCharIndex = state.turnOrder[0];
    } else {
        state.currentCharIndex = state.turnOrder[idxInOrder + 1];
    }
}

// =========================
// Firestore 연동
// =========================

// 전투 시작 시 DB에서 상태 로드 → 서버 세션에 올림
async function loadBattleStateFromDb(raidId, uid) {
    const ref = db.collection("raids").doc(raidId);
    const snap = await ref.get();
    if (!snap.exists) {
        throw new Error("RAID_NOT_FOUND");
    }

    const data = snap.data();
    if (data.uid !== uid) {
        const err = new Error("NO_PERMISSION");
        err.code = "NO_PERMISSION";
        throw err;
    }

    if (data.battlefinished) {
        const err = new Error("ALREADY_FINISHED");
        err.code = "ALREADY_FINISHED";
        throw err;
    }

    const bossRef = db.collection("raidBosses").doc(data.bossId);
    const bossSnap = await bossRef.get();
    if (!bossSnap.exists) {
        throw new Error("BOSS_NOT_FOUND");
    }
    const bossData = bossSnap.data();
    const initialBossHp =
        typeof data.bossHp === "number"
            ? data.bossHp
            : bossData.hp ?? bossData.maxHp ?? 1000;

    const selectedSkillsByChar = data.selectedSkillsByChar || {};
    const party = [];

    for (const [charId, selected] of Object.entries(selectedSkillsByChar)) {
        const chSnap = await db.collection("characters").doc(charId).get();
        if (!chSnap.exists) continue;
        const ch = chSnap.data();

        const maxHp = calcCharHp(ch);

        party.push({
            charId,
            name: ch.displayRawName || ch.name,
            displayRawName: ch.displayRawName || ch.name,
            scores: ch.scores || {},
            skills: ch.skills || [],
            selectedSkills: Array.isArray(selected) ? selected : [],
            maxHp,
            currentHp: maxHp
        });
    }

    if (!party.length) {
        throw new Error("NO_PARTY");
    }
    const cleanThreat = (data.threatLevels || []).map(v => {
        const n = Number(v);
        return Number.isFinite(n) ? n : 5;
    });

    const state = {
        raidId,
        uid,
        bossId: data.bossId,
        boss: {
            ...bossData,
            hp: initialBossHp
        },
        party,
        pnTable: data.pnTable || [],
        effects: data.effects || [],

        threatLevels: cleanThreat.length === party.length
            ? cleanThreat
            : party.map(() => 5),

        activeEffects: [],
        engagementCount: 1,
        uiTurn: 1,
        currentCharIndex: 0,
        turnOrder: [],
        logs: [
            "⚔️ 레이드 전투를 시작합니다.",
            `보스: ${bossData.name} - ${bossData.desc || ""}`,
            "--- 1턴 시작 ---"
        ],
        battlefinished: false,
        result: null
    };

    return state;
}

// 전투 종료 시 최종 상태를 DB에 1회 저장
async function saveFinalState(state) {
    const ref = db.collection("raids").doc(state.raidId);
    const partyStatus = (state.party || []).map(ch => ({
        charId: ch.charId,
        currentHp: ch.currentHp,
        maxHp: ch.maxHp
    }));

    await ref.update({
        bossHp: state.boss?.hp ?? null,
        threatLevels: state.threatLevels,
        engagementCount: state.engagementCount,
        logs: state.logs,
        partyStatus,
        battlefinished: state.battlefinished,
        result: state.result,
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
    });
}

// =========================
// 액션 핸들러
// =========================

// 1) LOAD
async function handleLoad(req, res, uid) {
    const { raidId } = req.body || {};
    if (!raidId) {
        return res.status(400).json({ ok: false, error: "RAID_ID_REQUIRED" });
    }

    let state = battleSessions[raidId];

    // 세션 살아있으면 lastActive 갱신
    if (state) {
        state.lastActive = Date.now();
    }


    try {
        if (!state || state.uid !== uid || state.battlefinished) {
            // 세션 없거나 다른 유저거나 이미 끝난 전투 → DB에서 새로 로드
            state = await loadBattleStateFromDb(raidId, uid);
            battleSessions[raidId] = {
                ...state,
                lastActive: Date.now()
            };

        }
    } catch (e) {
        console.error("raid load error:", e);
        if (e.code === "NO_PERMISSION") {
            return res.status(403).json({ ok: false, error: "NO_PERMISSION" });
        }
        if (e.message === "RAID_NOT_FOUND") {
            return res.status(404).json({ ok: false, error: "RAID_NOT_FOUND" });
        }
        if (e.message === "ALREADY_FINISHED") {
            return res.status(400).json({ ok: false, error: "ALREADY_FINISHED" });
        }
        if (e.message === "NO_PARTY") {
            return res.status(400).json({ ok: false, error: "NO_PARTY" });
        }
        if (e.message === "BOSS_NOT_FOUND") {
            return res.status(500).json({ ok: false, error: "BOSS_NOT_FOUND" });
        }
        return res.status(500).json({ ok: false, error: "SERVER_ERROR" });
    }

    return res.json({
        ok: true,
        boss: state.boss,
        party: state.party.map(ch => ({
            charId: ch.charId,
            name: ch.name,
            displayRawName: ch.displayRawName,
            maxHp: ch.maxHp,
            currentHp: ch.currentHp,
            selectedSkills: ch.selectedSkills,
            // ✅ 프론트에서 버튼 렌더링에 쓸 스킬 정보 전달
            skills: (ch.skills || []).map(s => ({
                name: s.name,
                power: s.power ?? s.pow ?? 0,
                // 필요하면 shortDesc 같은 것도 추가 가능
                shortDesc: s.shortDesc || s.effect || s.longDesc || s.long || ""
            }))
        })),
        logs: state.logs,
        engagementCount: state.engagementCount,
        uiTurn: state.uiTurn,
        currentCharIndex: state.currentCharIndex,
        battleEnded: state.battlefinished,
        result: state.result
    });

}

// 2) TURN
async function handleTurn(req, res, uid) {
    const { raidId, skillIndex } = req.body || {};
    if (!raidId) {
        return res.status(400).json({ ok: false, error: "RAID_ID_REQUIRED" });
    }

    let state = battleSessions[raidId];

    if (!state) {
        console.warn("⚠️ 세션 없음 → 자동 복구 시도");
        try {
            state = await loadBattleStateFromDb(raidId, uid);
            battleSessions[raidId] = {
                ...state,
                lastActive: Date.now()
            };
        } catch (e) {
            console.error("세션 자동 복구 실패:", e);

            return res.status(400).json({
                ok: false,
                error: "BATTLE_SESSION_LOST",
                message: "전투 세션이 손상되었습니다. 전투를 다시 시작해주세요."
            });
        }
    }


    if (state.uid !== uid) {
        return res.status(403).json({ ok: false, error: "NO_PERMISSION" });
    }

    if (state.battlefinished) {
        return res.json({
            ok: true,
            boss: state.boss,
            party: state.party,
            logs: state.logs,
            engagementCount: state.engagementCount,
            uiTurn: state.uiTurn,
            currentCharIndex: state.currentCharIndex,
            battleEnded: state.battlefinished,
            result: state.result
        });
    }

    const party = state.party || [];
    if (!party.length) {
        return res.status(400).json({ ok: false, error: "NO_PARTY" });
    }

    // 현재 턴 캐릭터
    if (state.currentCharIndex < 0 || state.currentCharIndex >= party.length) {
        state.currentCharIndex = 0;
    }
    const charIndex = state.currentCharIndex;
    const ch = party[charIndex];

    if (!ch || ch.currentHp <= 0) {
        // 죽어있으면 다음 턴으로 넘김
        proceedTurnOrder(state);
        return res.json({
            ok: true,
            boss: state.boss,
            party: state.party,
            logs: state.logs,
            engagementCount: state.engagementCount,
            uiTurn: state.uiTurn,
            currentCharIndex: state.currentCharIndex,
            battleEnded: state.battlefinished,
            result: state.result
        });
    }

    // 선택한 스킬 인덱스(0~2) → 실제 skillIndex(0~3)
    const selected = ch.selectedSkills || [];
    const realSkillIndex = selected[skillIndex];

    if (realSkillIndex === undefined) {
        return res.status(400).json({ ok: false, error: "INVALID_SKILL_INDEX" });
    }

    const skills = ch.skills || [];
    const skill = skills[realSkillIndex];

    if (!skill) {
        return res.status(400).json({ ok: false, error: "INVALID_SKILL_INDEX" });
    }

    // 🔥 이번 턴의 보스 행동(랜덤) 미리 결정
    const bossSkill = pickBossSkill(state);
    const bossActionType = getBossActionType(bossSkill);

    // 🔥 이 스킬의 effect 타입(AP / BN / ...) 조회
    const effectType = getEffectTypeForSkill(state, charIndex, realSkillIndex);

    // ① 즉시 스킬 데미지
    const { tCount, fCount } = getTFfromPN(state.pnTable, charIndex, realSkillIndex);
    const combatScore = (ch.scores || {}).combatScore ?? 5;

    const baseDmg = calcPlayerSkillDamage({
        power: Number(skill.power ?? skill.pow ?? 0),
        combatScore,
        tCount,
        fCount,
        engagementCount: state.engagementCount
    });


    // 🔥 최종 데미지 배율 적용 (요청한 2배 로직)
    const multiplier = getDamageMultiplier(effectType, bossActionType);
    const finalDmg = baseDmg * multiplier;

    state.boss.hp -= finalDmg;
    state.logs.push(
        `▶ 교전: ${ch.name || ch.displayRawName}의 [${skill.name}] 사용\n` +
        `- PN: P${tCount} / N${fCount}\n` +
        (multiplier > 1
            ? `- 데미지: ${baseDmg.toFixed(1)} x${multiplier} = ${finalDmg.toFixed(1)}\n`
            : `- 데미지: ${finalDmg.toFixed(1)}\n`) +
        `(보스 HP: ${Math.max(state.boss.hp, 0).toFixed(1)})`
    );

    // ② 이펙트 등록 (※ 실제 스킬 인덱스로)
    addEffectFromTable(state, charIndex, realSkillIndex);

    // ③ 보스 반격 (미리 결정해 둔 bossSkill 사용)
    bossCounterAttack(state, bossSkill);

    // ④ 즉시 승패 판정
    if (checkBattleEnd(state)) {
        try {
            await saveFinalState(state);
        } catch (e) {
            console.error("saveFinalState error:", e);
        }
        delete battleSessions[raidId];
        return res.json({
            ok: true,
            boss: state.boss,
            party: state.party,
            logs: state.logs,
            engagementCount: state.engagementCount,
            uiTurn: state.uiTurn,
            currentCharIndex: state.currentCharIndex,
            battleEnded: state.battlefinished,
            result: state.result
        });
    }

    // ⑤ 교전 수 증가
    state.engagementCount++;

    // ⑥ engagement 단위의 지속 효과 데미지 적용
    if (applyEffectDamageAfterEngagement(state)) {
        try {
            await saveFinalState(state);
        } catch (e) {
            console.error("saveFinalState error:", e);
        }
        delete battleSessions[raidId];
        return res.json({
            ok: true,
            boss: state.boss,
            party: state.party,
            logs: state.logs,
            engagementCount: state.engagementCount,
            uiTurn: state.uiTurn,
            currentCharIndex: state.currentCharIndex,
            battleEnded: state.battlefinished,
            result: state.result
        });
    }

    // ⑦ 턴 순서 진행 (다음 캐릭터로)
    proceedTurnOrder(state);

    return res.json({
        ok: true,
        boss: state.boss,
        party: state.party,
        logs: state.logs,
        engagementCount: state.engagementCount,
        uiTurn: state.uiTurn,
        currentCharIndex: state.currentCharIndex,
        battleEnded: state.battlefinished,
        result: state.result
    });
}

// 3) GIVEUP
async function handleGiveup(req, res, uid) {
    const { raidId } = req.body || {};
    if (!raidId) {
        return res.status(400).json({ ok: false, error: "RAID_ID_REQUIRED" });
    }

    const ref = db.collection("raids").doc(raidId);
    const snap = await ref.get();
    if (!snap.exists) {
        return res.status(404).json({ ok: false, error: "RAID_NOT_FOUND" });
    }

    const data = snap.data();
    if (data.uid !== uid) {
        return res.status(403).json({ ok: false, error: "NO_PERMISSION" });
    }

    // 세션에도 반영
    const state = battleSessions[raidId];
    if (state) {
        state.battlefinished = true;
        state.result = "giveup";
        state.logs.push("🏳️ 플레이어가 전투를 포기했습니다. (패배 처리)");
        try {
            await saveFinalState(state);
        } catch (e) {
            console.error("saveFinalState(giveup) error:", e);
        }
        delete battleSessions[raidId];
    } else {
        // 세션이 없어도 최소한 DB에는 패배 기록
        await ref.update({
            battlefinished: true,
            result: "giveup",
            updatedAt: admin.firestore.FieldValue.serverTimestamp()
        });
    }

    return res.json({ ok: true });
}

// =========================
// 메인 핸들러
// =========================
export default async function handler(req, res) {
    applyCors(req, res);
    if (req.method === "OPTIONS") return res.status(204).end();
    if (req.method !== "POST") {
        return res.status(405).json({ ok: false, error: "POST_ONLY" });
    }

    try {
        // 세션 쿠키 인증
        const cookies = parseCookiesSafe(req);
        const token = cookies.session;
        if (!token) {
            return res.status(401).json({ ok: false, error: "NO_SESSION" });
        }

        const decoded = await admin.auth().verifySessionCookie(token, true);
        const uid = decoded.uid;

        const { action } = req.body || {};
        if (action === "load") {
            return await handleLoad(req, res, uid);
        }
        if (action === "turn") {
            return await handleTurn(req, res, uid);
        }
        if (action === "giveup") {
            return await handleGiveup(req, res, uid);
        }

        return res.status(400).json({ ok: false, error: "UNKNOWN_ACTION" });

    } catch (err) {
        console.error("❌ raid-controller-back ERROR:", err);
        return res.status(500).json({ ok: false, error: "SERVER_ERROR" });
    }
}
