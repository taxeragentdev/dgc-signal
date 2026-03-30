const structure = require('./structure');
const indicators = require('./indicators');
const smc = require('./smartMoney');

class ConfluenceManager {
    /** .env: SIGNAL_THRESHOLD (varsayılan 50, tipik 45–65) */
    getThreshold() {
        const n = parseInt(process.env.SIGNAL_THRESHOLD, 10);
        if (Number.isFinite(n) && n >= 35 && n <= 95) return n;
        return 50;
    }

    /**
     * Ham skor + sinyal (yoksa neden).
     * @param {Array} candles
     */
    evaluate(candles) {
        const threshold = this.getThreshold();
        if (!candles || candles.length < 200) {
            return {
                signal: null,
                rawScore: 0,
                rsi: null,
                trend: '',
                blockedByRsi: false,
                threshold,
                reason: 'insufficient_candles'
            };
        }

        const indicatorData = indicators.calculate(candles);
        const pivots = structure.findPivots(candles);
        const trend = structure.getMarketStructure(pivots);
        const fvg = smc.detectFVG(candles);
        const sweep = smc.detectLiquiditySweep(candles, pivots);
        const ob = smc.detectOrderBlock(candles);

        let score = 0;

        if (indicatorData.currentPrice > indicatorData.ema200) score += 10;
        else score -= 10;

        if (indicatorData.ema50 > indicatorData.ema200) score += 10;

        const macd = indicatorData.macd;
        if (macd && macd.MACD && macd.signal) {
            if (macd.MACD > macd.signal) score += 15;
            else score -= 15;
        }

        const rsi = indicatorData.rsi;
        if (rsi > 70) score -= 30;
        if (rsi < 30) score += 30;

        if (sweep) {
            if (sweep.type === 'BULLISH') score += 20;
            if (sweep.type === 'BEARISH') score -= 20;
        }

        if (fvg) {
            if (fvg.type === 'BULLISH') score += 10;
            if (fvg.type === 'BEARISH') score -= 10;
        }

        if (ob) {
            if (ob.type === 'BULLISH') score += 10;
            if (ob.type === 'BEARISH') score -= 10;
        }

        let signalType = null;
        if (score >= threshold) signalType = 'LONG';
        else if (score <= -threshold) signalType = 'SHORT';

        let blockedByRsi = false;
        if (signalType === 'LONG' && rsi > 72) {
            blockedByRsi = true;
            signalType = null;
        }
        if (signalType === 'SHORT' && rsi < 28) {
            blockedByRsi = true;
            signalType = null;
        }

        let signal = null;
        if (signalType) {
            const slTp = this.calculateSLTP(signalType, indicatorData.currentPrice, indicatorData.atr, pivots);
            signal = {
                type: signalType,
                score: Math.abs(score),
                price: indicatorData.currentPrice,
                rsi,
                trend,
                indicators: indicatorData,
                pivots,
                smc: { fvg, sweep, ob },
                sl: slTp.sl,
                tp: slTp.tp
            };
        }

        return {
            signal,
            rawScore: score,
            rsi,
            trend,
            blockedByRsi,
            threshold,
            reason: null
        };
    }

    /**
     * @param {Array} candles
     * @returns {Object|null}
     */
    analyze(candles) {
        return this.evaluate(candles).signal;
    }

    calculateSLTP(type, price, atr, pivots) {
        let sl, tp1, tp2, tp3;
        const multiplier = 1.5;

        if (type === 'LONG') {
            const lastLow = pivots.lows.length > 0 ? pivots.lows[pivots.lows.length - 1].price : price - atr * 2;
            sl = Math.min(lastLow, price - (atr * multiplier));

            const risk = price - sl;
            tp1 = price + risk * 1.5;
            tp2 = price + risk * 2.5;
            tp3 = price + risk * 4;
        } else {
            const lastHigh = pivots.highs.length > 0 ? pivots.highs[pivots.highs.length - 1].price : price + atr * 2;
            sl = Math.max(lastHigh, price + (atr * multiplier));

            const risk = sl - price;
            tp1 = price - risk * 1.5;
            tp2 = price - risk * 2.5;
            tp3 = price - risk * 4;
        }

        return { sl, tp: [tp1, tp2, tp3] };
    }
}

module.exports = new ConfluenceManager();
