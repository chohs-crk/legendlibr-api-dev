import { resolveCharImage } from "/base/common/image-util.js";
import { apiFetch } from "/base/api.js";

function parseStoryText(raw) {
    if (!raw) return "";
    let html = String(raw);

    html = html.replace(/story-(em|talk|skill)\"?>/gi, "");
    html = html.replace(/<span[^>]*>/gi, "");
    html = html.replace(/<\/span>/gi, "");
    html = html.replace(/&lt;\/?span[^&]*&gt;/gi, "");

    html = html.replace(/\*\*(.+?)\*\*/g, (_, txt) =>
        `<span class="story-em">${txt}</span>`
    );

    html = html.replace(/§([^§]+?)§/g, (_, txt) =>
        `"${'<span class="story-talk">' + txt + "</span>"}"`
    );

    html = html.replace(/『(.+?)』/g, (_, txt) =>
        `『<span class="story-skill">${txt}</span>』`
    );

    html = html.replace(/\r\n/g, "\n");
    html = html.replace(/\n{2,}/g, "<br><br>");
    html = html.replace(/\n/g, " ");

    return html.trim();
}

function getCachedBattle(id) {
    const raw = sessionStorage.getItem("battleCacheMap");
    if (!raw) return null;

    try {
        const map = JSON.parse(raw);
        return map[id] || null;
    } catch {
        return null;
    }
}

function cacheBattle(battle) {
    const raw = sessionStorage.getItem("battleCacheMap");
    const map = raw ? JSON.parse(raw) : {};

    map[battle.id] = battle;

    sessionStorage.setItem("battleCacheMap", JSON.stringify(map));
}

async function fetchBattleById(id) {
    const res = await apiFetch(
        `/base/battle-solo?id=${encodeURIComponent(id)}`
    );

    if (!res.ok) return null;

    return await res.json();
}

export async function initBattleLogPage(battleId) {
    const container = document.getElementById("battleLogContainer");

    if (!battleId) {
        battleId = sessionStorage.getItem("viewBattleId");
    }

    if (!battleId) {
        container.innerHTML = "<div>전투 기록이 없습니다.</div>";
        return;
    }

    let battle = getCachedBattle(battleId);

    if (!battle) {
        container.innerHTML = "<div>전투 기록 불러오는 중...</div>";

        battle = await fetchBattleById(battleId);

        if (battle) {
            cacheBattle(battle);
        }
    }

    if (!battle) {
        container.innerHTML = "<div>전투 기록을 불러올 수 없습니다.</div>";
        return;
    }

    const enemyImg = resolveCharImage(battle.enemyImage);

    const sections = [];

    if (battle.prologue) {
        sections.push(`<h3>전투 개시</h3>${parseStoryText(battle.prologue)}`);
    }

    const logs = battle.logs || [];

    logs.forEach(log => {
        const skillA = log.skillAName || "행동";
        const narration = log.narration || "";

        sections.push(`
            <div class="battle-section">
                <div class="battle-skill">${skillA}</div>
                <div class="battle-text">${parseStoryText(narration)}</div>
            </div>
        `);
    });

    container.innerHTML = `
        <div class="battle-log-header">
            <img src="${enemyImg}" />
            <h2>${battle.enemyName || "전투"}</h2>
        </div>

        <div class="battle-log-body">
            ${sections.join("<hr>")}
        </div>
    `;
}
