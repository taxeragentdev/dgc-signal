/**
 * Ajan bazlı oto-trade: AGENTS_JSON içinde "autoTrade": false veya
 * Telegram / komutlarla kapatılanlar (data/autotrade_agents.json — .gitignore).
 */

const fs = require('fs');
const path = require('path');

const STATE_PATH = path.join(__dirname, '..', 'data', 'autotrade_agents.json');

function ensureDir() {
    const dir = path.dirname(STATE_PATH);
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
}

function loadDisabledSet() {
    try {
        const t = fs.readFileSync(STATE_PATH, 'utf8');
        const j = JSON.parse(t);
        const arr = Array.isArray(j.disabled) ? j.disabled : [];
        return new Set(arr.map((a) => String(a).toLowerCase().trim()));
    } catch {
        return new Set();
    }
}

let disabledSet = loadDisabledSet();

function persist() {
    try {
        ensureDir();
        fs.writeFileSync(
            STATE_PATH,
            JSON.stringify({ disabled: [...disabledSet] }, null, 2),
            'utf8'
        );
    } catch (e) {
        console.error('[agentAutoTrade] kayıt hatası:', e.message);
    }
}

/**
 * @param {{ alias: string, autoTrade?: boolean }} agent
 */
function isAgentAutoTradeEnabled(agent) {
    if (agent.autoTrade === false) return false;
    if (disabledSet.has(agent.alias)) return false;
    return true;
}

function setAgentDisabled(alias, disabled) {
    const a = String(alias).toLowerCase().trim();
    if (!a) return false;
    if (disabled) disabledSet.add(a);
    else disabledSet.delete(a);
    persist();
    return true;
}

function getDisabledAliases() {
    return [...disabledSet].sort();
}

function reloadFromDisk() {
    disabledSet = loadDisabledSet();
}

module.exports = {
    isAgentAutoTradeEnabled,
    setAgentDisabled,
    getDisabledAliases,
    reloadFromDisk
};
