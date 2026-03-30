/**
 * Hyperliquid /info type=meta — pair başına maxLeverage (önbellekli).
 * https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/info-endpoint
 */

const HL_INFO = 'https://api.hyperliquid.xyz/info';
const TTL_MS = 60 * 60 * 1000;

let cache = { map: null, at: 0 };

/**
 * @returns {Promise<Map<string, number>>}
 */
async function getLeverageMap() {
    if (cache.map && Date.now() - cache.at < TTL_MS) {
        return cache.map;
    }
    const res = await fetch(HL_INFO, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'meta' })
    });
    if (!res.ok) {
        throw new Error(`HL meta HTTP ${res.status}`);
    }
    const data = await res.json();
    const map = new Map();
    for (const u of data.universe || []) {
        if (u.name != null && u.maxLeverage != null) {
            map.set(String(u.name), Number(u.maxLeverage));
        }
    }
    cache = { map, at: Date.now() };
    return map;
}

/**
 * CCXT sembolünden HL coin adı: "ARB/USDC:USDC" → "ARB"
 * @param {string} symbol
 */
function extractHlCoin(symbol) {
    if (!symbol) return '';
    return String(symbol).split('/')[0].split(':')[0].trim();
}

/**
 * Degen / bazı arayüzlerde "kPEPE" gibi prefix kullanılabilir (.env: DEGEN_PAIR_PREFIX=k)
 * @param {string} coin
 */
function toDegenPairName(coin) {
    const p = process.env.DEGEN_PAIR_PREFIX || '';
    return p ? `${p}${coin}` : coin;
}

/**
 * @param {string} coin — örn. BTC, ARB
 * @returns {Promise<number>}
 */
async function getMaxLeverageForCoin(coin) {
    if (!coin) {
        return parseInt(process.env.FALLBACK_PAIR_MAX_LEVERAGE, 10) || 20;
    }
    try {
        const map = await getLeverageMap();
        const v = map.get(coin);
        if (Number.isFinite(v) && v > 0) return v;
    } catch (e) {
        console.warn('[hyperliquidMeta]', e.message);
    }
    return parseInt(process.env.FALLBACK_PAIR_MAX_LEVERAGE, 10) || 20;
}

module.exports = {
    getLeverageMap,
    extractHlCoin,
    toDegenPairName,
    getMaxLeverageForCoin
};
