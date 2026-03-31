/**
 * Degen / Hyperliquid perp_trade: BTC, ETH gibi yüksek fiyatlı paritelerde
 * tick genelde tam sayı; diğerlerinde ondalık gerekir.
 * DEGEN_INTEGER_PRICE_COINS=BTC,ETH (virgülle, büyük/küçük harf duyarsız)
 */

function parseIntegerPriceCoins() {
    const raw = process.env.DEGEN_INTEGER_PRICE_COINS?.trim();
    const def = 'BTC,ETH';
    const s = raw || def;
    return new Set(
        s
            .split(',')
            .map((x) => x.trim().toUpperCase())
            .filter(Boolean)
    );
}

let cachedSet = null;
function integerTickCoins() {
    if (!cachedSet) cachedSet = parseIntegerPriceCoins();
    return cachedSet;
}

function formatHlPriceRaw(x) {
    const n = Number(x);
    if (!Number.isFinite(n)) return String(x);
    const a = Math.abs(n);
    if (a >= 1000) return n.toFixed(2);
    if (a >= 1) return n.toFixed(4);
    if (a >= 0.01) return n.toFixed(5);
    return n.toFixed(6);
}

/**
 * @param {number|string} x
 * @param {string} hlCoin — örn. "BTC", "ETH", "SOL"
 * @returns {string}
 */
function formatDegenPrice(x, hlCoin) {
    const base = String(hlCoin || '')
        .split('/')[0]
        .split(':')[0]
        .trim()
        .toUpperCase();
    const n = Number(x);
    if (!Number.isFinite(n)) return String(x);
    if (base && integerTickCoins().has(base)) {
        return String(Math.round(n));
    }
    return formatHlPriceRaw(n);
}

module.exports = {
    formatDegenPrice,
    formatHlPriceRaw,
    integerTickCoins
};
