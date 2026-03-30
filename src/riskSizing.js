/**
 * Sabit marjin + sabit hedef kaldıraç (varsayılan 15 USDC, 5x).
 * Borsa tavanı (HL meta) daha düşükse kaldıraç düşürülür.
 * Degen size string = notional USDC = marginUsdc * leverage (Ichimoku ile aynı).
 */

const { getMaxLeverageForCoin, extractHlCoin } = require('./hyperliquidMeta');

function parseNumEnv(key, fallback) {
    const n = parseFloat(process.env[key]);
    return Number.isFinite(n) && n > 0 ? n : fallback;
}

function parseIntEnv(key, fallback) {
    const n = parseInt(process.env[key], 10);
    return Number.isFinite(n) && n > 0 ? n : fallback;
}

/**
 * @param {'LONG'|'SHORT'} side
 * @param {number} entry
 * @param {number} sl
 * @param {string} symbol
 */
async function suggestMarginLeverage(side, entry, sl, symbol) {
    const marginUsdc = parseNumEnv('FIXED_MARGIN_USDC', 15);
    const targetLev = parseIntEnv('FIXED_LEVERAGE', 5);

    const coin = extractHlCoin(symbol);

    let pairMaxLev = 50;
    try {
        pairMaxLev = await getMaxLeverageForCoin(coin);
    } catch {
        pairMaxLev = parseIntEnv('FALLBACK_PAIR_MAX_LEVERAGE', 20);
    }

    const leverage = Math.min(targetLev, pairMaxLev);
    const notionalUsdc = marginUsdc * leverage;
    const notionalStr = String(Math.round(notionalUsdc));

    const E = Number(entry);
    const S = Number(sl);
    let stopDistancePct = 0;
    let note;

    if (E > 0 && S > 0) {
        if (side === 'LONG' && S < E) {
            stopDistancePct = ((E - S) / E) * 100;
        } else if (side === 'SHORT' && S > E) {
            stopDistancePct = ((S - E) / E) * 100;
        } else {
            note = side === 'LONG' ? 'SL girişin altında olmalı' : 'SL girişin üstünde olmalı';
        }
    }

    let cappedBy = 'fixed';
    if (leverage < targetLev) {
        cappedBy = 'pair';
    }

    return {
        leverage,
        targetLeverage: targetLev,
        stopDistancePct,
        marginUsdc,
        notionalUsdc,
        notionalStr,
        maxLeverageCap: targetLev,
        pairMaxLeverage: pairMaxLev,
        safetyFactor: 0,
        cappedBy,
        hlCoin: coin,
        note
    };
}

module.exports = {
    suggestMarginLeverage,
    parseNumEnv,
    parseIntEnv
};
