const structure = require('./structure');
const indicators = require('./indicators');
const smc = require('./smartMoney');

class ConfluenceManager {
    /**
     * Analyzes all data and calculates a signal score.
     * @param {Array} candles - OHLCV data
     * @returns {Object|null} - Signal object or null if no signal
     */
    analyze(candles) {
        if (candles.length < 200) return null;

        const lastCandle = candles[candles.length - 1];
        const indicatorData = indicators.calculate(candles);
        const pivots = structure.findPivots(candles);
        const trend = structure.getMarketStructure(pivots);
        const fvg = smc.detectFVG(candles);
        const sweep = smc.detectLiquiditySweep(candles, pivots);
        const ob = smc.detectOrderBlock(candles);

        let score = 0;
        let signalType = null; // 'LONG' or 'SHORT'

        // 1. Trend Alignment (20 points)
        if (indicatorData.currentPrice > indicatorData.ema200) {
            score += 10; // Bullish context
        } else {
            score -= 10; // Bearish context
        }

        if (indicatorData.ema50 > indicatorData.ema200) score += 10;

        // 2. Momentum (MACD) (15 points)
        const macd = indicatorData.macd;
        if (macd && macd.MACD && macd.signal) {
            if (macd.MACD > macd.signal) score += 15;
            else score -= 15;
        }

        // 3. RSI Overbought/Oversold Filter (Safety)
        const rsi = indicatorData.rsi;
        if (rsi > 70) score -= 30; // Danger: Buy at top
        if (rsi < 30) score += 30; // Opportunity: Sell at bottom

        // 4. SMC (40 points total)
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

        // Finalize Signal
        if (score >= 60) signalType = 'LONG';
        else if (score <= -60) signalType = 'SHORT';

        if (!signalType) return null;

        // ❌ Safety Filter: Don't LONG at RSI > 75, Don't SHORT at RSI < 25
        if (signalType === 'LONG' && rsi > 72) return null;
        if (signalType === 'SHORT' && rsi < 28) return null;

        // Calculate SL and TP
        const slTp = this.calculateSLTP(signalType, indicatorData.currentPrice, indicatorData.atr, pivots);

        return {
            type: signalType,
            score: Math.abs(score),
            price: indicatorData.currentPrice,
            rsi: rsi,
            trend: trend,
            indicators: indicatorData,
            pivots: pivots,
            smc: { fvg, sweep, ob },
            sl: slTp.sl,
            tp: slTp.tp
        };
    }

    /**
     * Calculates Stop Loss and Take Profit levels.
     */
    calculateSLTP(type, price, atr, pivots) {
        let sl, tp1, tp2, tp3;
        const multiplier = 1.5; // ATR multiplier for SL

        if (type === 'LONG') {
            // SL: Recent swing low or ATR-based
            const lastLow = pivots.lows.length > 0 ? pivots.lows[pivots.lows.length - 1].price : price - atr * 2;
            sl = Math.min(lastLow, price - (atr * multiplier));
            
            const risk = price - sl;
            tp1 = price + risk * 1.5;
            tp2 = price + risk * 2.5;
            tp3 = price + risk * 4;
        } else {
            // SL: Recent swing high or ATR-based
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
