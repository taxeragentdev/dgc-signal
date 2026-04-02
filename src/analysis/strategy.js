/**
 * Strategy Router — SIGNAL_STRATEGY ile seçilir:
 * - confluence (varsayılan): çok göstergeli skorlama
 * - bollinger: Bollinger Band kırılma/geri dönüş
 * - hybrid: ikisini birleştir (önce BB, sonra confluence skorlaması)
 */

const confluence = require('./confluence');
const bollingerStrategy = require('./bollingerStrategy');

function getStrategy() {
    const s = (process.env.SIGNAL_STRATEGY || 'confluence').trim().toLowerCase();
    if (s === 'bollinger') return 'bollinger';
    if (s === 'hybrid') return 'hybrid';
    return 'confluence';
}

function getThreshold(timeframe) {
    const strat = getStrategy();
    if (strat === 'bollinger') return bollingerStrategy.getThreshold();
    return confluence.getThreshold(timeframe);
}

/**
 * @param {Array} candles
 * @param {string} timeframe
 */
function evaluate(candles, timeframe) {
    const strat = getStrategy();

    if (strat === 'bollinger') {
        return bollingerStrategy.evaluate(candles, timeframe);
    }

    if (strat === 'hybrid') {
        const bbEv = bollingerStrategy.evaluate(candles, timeframe);
        if (bbEv.signal) {
            const confEv = confluence.evaluate(candles, timeframe);
            if (confEv.signal && confEv.signal.type === bbEv.signal.type) {
                bbEv.signal.score = Math.round((bbEv.signal.score + confEv.signal.score) / 2);
                bbEv.signal.scoreBreakdown = `Hybrid: BB + Confluence`;
            }
            return bbEv;
        }
        return confluence.evaluate(candles, timeframe);
    }

    return confluence.evaluate(candles, timeframe);
}

function analyze(candles, timeframe) {
    return evaluate(candles, timeframe).signal;
}

module.exports = {
    getThreshold,
    evaluate,
    analyze,
    getStrategy
};
