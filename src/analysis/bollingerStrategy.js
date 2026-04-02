/**
 * Bollinger Band Breakout Strategy (Pure)
 * Sinyal: BB bandına dokunma/kırma + volume + RSI konfirmasyonu
 */

class BollingerStrategy {
    getThreshold() {
        return 1;
    }

    /**
     * @param {Array} candles
     * @param {string} timeframe
     */
    evaluate(candles, timeframe) {
        if (!candles || candles.length < 200) {
            return {
                signal: null,
                rawScore: 0,
                rsi: null,
                trend: '',
                blockedByRsi: false,
                threshold: this.getThreshold(),
                reason: 'insufficient_candles'
            };
        }

        const indicators = require('./indicators');
        const ind = indicators.calculate(candles);

        const price = ind.currentPrice;
        const bb = ind.bb;
        const rsi = ind.rsi;
        const volumeRatio = ind.volumeRatio || 1;

        if (!bb || !Number.isFinite(bb.upper) || !Number.isFinite(bb.lower) || !Number.isFinite(price)) {
            return {
                signal: null,
                rawScore: 0,
                rsi,
                trend: '',
                blockedByRsi: false,
                threshold: this.getThreshold(),
                reason: 'invalid_bb'
            };
        }

        const { upper, lower, middle } = bb;
        const range = upper - lower;
        if (range <= 0) {
            return {
                signal: null,
                rawScore: 0,
                rsi,
                trend: '',
                blockedByRsi: false,
                threshold: this.getThreshold(),
                reason: 'zero_bb_range'
            };
        }

        const lastCandle = candles[candles.length - 1];
        const prevCandle = candles[candles.length - 2];

        let signalType = null;
        let score = 0;
        let reason = null;

        /** LONG: Fiyat alt banda dokundu/kırdı ve yukarı döndü */
        const touchedLowerBand = prevCandle.low <= lower * 1.002;
        const closedAboveLowerBand = lastCandle.close > lower;

        if (touchedLowerBand && closedAboveLowerBand) {
            signalType = 'LONG';
            score = 60;
            reason = 'bb_lower_bounce';

            if (Number.isFinite(rsi) && rsi < 35) score += 20;
            if (volumeRatio > 1.3) score += 15;
            if (lastCandle.close > lastCandle.open) score += 10;

            if (Number.isFinite(rsi) && rsi > 75) {
                signalType = null;
                reason = 'bb_long_rsi_overbought';
            }
        }

        /** SHORT: Fiyat üst banda dokundu/kırdı ve aşağı döndü */
        const touchedUpperBand = prevCandle.high >= upper * 0.998;
        const closedBelowUpperBand = lastCandle.close < upper;

        if (touchedUpperBand && closedBelowUpperBand) {
            if (signalType === 'LONG' && Math.abs(score) < 70) {
                signalType = null;
                reason = 'bb_conflict';
            } else {
                signalType = 'SHORT';
                score = -60;
                reason = 'bb_upper_reject';

                if (Number.isFinite(rsi) && rsi > 65) score -= 20;
                if (volumeRatio > 1.3) score -= 15;
                if (lastCandle.close < lastCandle.open) score -= 10;

                if (Number.isFinite(rsi) && rsi < 25) {
                    signalType = null;
                    reason = 'bb_short_rsi_oversold';
                }
            }
        }

        let signal = null;
        if (signalType) {
            const structure = require('./structure');
            const pivots = structure.findPivots(candles);
            const slTp = this.calculateSLTP(signalType, price, ind.atr, pivots, bb);

            signal = {
                type: signalType,
                score: Math.abs(score),
                price,
                rsi,
                trend: 'BB_BREAKOUT',
                indicators: ind,
                pivots,
                smc: {},
                sl: slTp.sl,
                tp: slTp.tp,
                scoreBreakdown: `Bollinger: ${reason}`
            };
        }

        return {
            signal,
            rawScore: score,
            rsi,
            trend: 'BB_BREAKOUT',
            blockedByRsi: false,
            threshold: this.getThreshold(),
            reason: reason || 'bb_no_signal'
        };
    }

    calculateSLTP(type, price, atr, pivots, bb) {
        const multiplier = 1.5;
        let sl;
        let tp1;
        let tp2;
        let tp3;

        if (type === 'LONG') {
            const lastLow = pivots.lows.length > 0 ? pivots.lows[pivots.lows.length - 1].price : price - atr * 2;
            const bbLower = bb.lower;
            sl = Math.min(lastLow, bbLower * 0.995, price - atr * multiplier);

            const risk = price - sl;
            tp1 = bb.middle;
            tp2 = price + risk * 2;
            tp3 = bb.upper;
        } else {
            const lastHigh = pivots.highs.length > 0 ? pivots.highs[pivots.highs.length - 1].price : price + atr * 2;
            const bbUpper = bb.upper;
            sl = Math.max(lastHigh, bbUpper * 1.005, price + atr * multiplier);

            const risk = sl - price;
            tp1 = bb.middle;
            tp2 = price - risk * 2;
            tp3 = bb.lower;
        }

        return { sl, tp: [tp1, tp2, tp3] };
    }
}

module.exports = new BollingerStrategy();
