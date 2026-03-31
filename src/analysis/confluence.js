const structure = require('./structure');
const indicators = require('./indicators');
const smc = require('./smartMoney');
const patterns = require('./patterns');

class ConfluenceManager {
    /**
     * .env SIGNAL_THRESHOLD — varsayılan 26 (scalp için agresif ama güvenli).
     * İzinli aralık 18–95.
     * Zaman dilimi bazında otomatik ayar.
     */
    getThreshold(timeframe = undefined) {
        const n = parseInt(process.env.SIGNAL_THRESHOLD, 10);
        if (Number.isFinite(n) && n >= 18 && n <= 95) return n;

        if (timeframe) {
            const tf = String(timeframe).trim().toLowerCase();
            if (tf === '5m' || tf === '15m') return 26;
            if (tf === '30m') return 30;
            if (tf === '1h' || tf === '4h') return 34;
        }

        const mode = (process.env.SCAN_MODE || '').trim().toLowerCase();
        if (mode === 'scalp') return 26;
        if (mode === 'full') return 30;

        return 34;
    }

    /**
     * Volume Confirmation Score
     * High volume + strong close = momentum
     */
    scoreFromVolume(ind, candles) {
        if (!ind || !Number.isFinite(ind.volumeRatio)) return 0;
        
        let score = 0;
        const volRatio = ind.volumeRatio;

        // Volume ratio > 1.5 = strong
        if (volRatio > 1.5) {
            const lastCandle = candles[candles.length - 1];
            if (lastCandle.close > lastCandle.open) score += 8;
            if (lastCandle.close < lastCandle.open) score -= 8;
        }
        // Volume ratio > 2.0 = very strong
        if (volRatio > 2.0) {
            const lastCandle = candles[candles.length - 1];
            if (lastCandle.close > lastCandle.open) score += 6;
            if (lastCandle.close < lastCandle.open) score -= 6;
        }

        return score;
    }

    /**
     * Volatility Adjustment
     * Low volatility = false signals; high volatility = valid moves
     */
    scoreFromVolatility(ind) {
        if (!ind || !Number.isFinite(ind.volatilityPct)) return 0;

        const vol = ind.volatilityPct;
        
        // Volatility too low (< 0.5%) = unreliable
        if (vol < 0.5) return -4;
        
        // Volatility normal (0.5% - 2%) = OK
        if (vol >= 0.5 && vol <= 2) return 0;
        
        // Volatility high (> 2%) = good for scalp
        if (vol > 2 && vol <= 4) return 6;
        
        // Volatility very high (> 4%) = strong moves
        if (vol > 4) return 10;

        return 0;
    }

    /**
     * Pattern Analysis Score
     * Engulfing, Pin Bar, Strong Close
     */
    scoreFromPattern(candles) {
        if (!candles || candles.length < 2) return 0;
        
        const pattern = patterns.analyze(candles);
        if (!pattern) return 0;

        let score = 0;

        if (pattern.engulfingBullish) {
            score += pattern.engulfingBullish.confidence === 'HIGH' ? 14 : 8;
        }
        if (pattern.engulfingBearish) {
            score -= pattern.engulfingBearish.confidence === 'HIGH' ? 14 : 8;
        }

        if (pattern.pinBar) {
            if (pattern.pinBar.type === 'HAMMER') {
                score += pattern.pinBar.confidence === 'HIGH' ? 10 : 6;
            } else if (pattern.pinBar.type === 'SHOOTING_STAR') {
                score -= pattern.pinBar.confidence === 'HIGH' ? 10 : 6;
            }
        }

        if (pattern.strongClose) {
            if (pattern.strongClose.type === 'STRONG_BULLISH_CLOSE') {
                score += pattern.strongClose.strength > 0.9 ? 8 : 4;
            } else if (pattern.strongClose.type === 'STRONG_BEARISH_CLOSE') {
                score -= pattern.strongClose.strength > 0.9 ? 8 : 4;
            }
        }

        if (pattern.highVolume) {
            score += Math.sign(score) > 0 ? 4 : score < 0 ? -4 : 0;
        }

        return score;
    }

    /**
     * EMA cross skoru ve hizalanma (scalp momentum için).
     */
    scoreFromEmaCross(ind) {
        if (!ind || !Number.isFinite(ind.ema20) || !Number.isFinite(ind.ema50)) return 0;
        let s = 0;

        if (Number.isFinite(ind.ema20Prev) && Number.isFinite(ind.ema50Prev)) {
            if (ind.ema20Prev <= ind.ema50Prev && ind.ema20 > ind.ema50) s += 18;
            if (ind.ema20Prev >= ind.ema50Prev && ind.ema20 < ind.ema50) s -= 18;
        }

        if (Number.isFinite(ind.ema50) && Number.isFinite(ind.ema200)) {
            if (ind.ema20 > ind.ema50 && ind.ema50 > ind.ema200) s += 10;
            if (ind.ema20 < ind.ema50 && ind.ema50 < ind.ema200) s -= 10;
        }

        return s;
    }

    /** LONG iptal eşiği: RSI bu değerin üstündeyse */
    getRsiBlockLong() {
        const n = parseInt(process.env.SIGNAL_RSI_BLOCK_LONG, 10);
        if (Number.isFinite(n) && n >= 60 && n <= 100) return n;
        return 85;
    }

    /** SHORT iptal eşiği: RSI bu değerin altındeyse */
    getRsiBlockShort() {
        const n = parseInt(process.env.SIGNAL_RSI_BLOCK_SHORT, 10);
        if (Number.isFinite(n) && n >= 0 && n <= 40) return n;
        return 15;
    }

    isRsiSafetyFilterEnabled() {
        const v = process.env.SIGNAL_RSI_FILTER?.trim().toLowerCase();
        return v !== 'false' && v !== '0' && v !== 'off';
    }

    /**
     * RSI katkısı — momentum ve overbought/oversold tespiti
     */
    scoreFromRsi(rsi) {
        if (!Number.isFinite(rsi)) return 0;
        if (rsi >= 75) return -16;
        if (rsi <= 25) return 16;
        if (rsi >= 62) return 10;
        if (rsi <= 38) return -10;
        if (rsi >= 55) return 6;
        if (rsi <= 45) return -6;
        return 0;
    }

    /**
     * Bollinger — banda göre momentum
     */
    scoreFromBollinger(price, bb) {
        if (!bb || !Number.isFinite(price)) return 0;
        const { upper, lower, middle } = bb;
        if (!Number.isFinite(upper) || !Number.isFinite(lower)) return 0;
        const range = upper - lower;
        if (range <= 0) return 0;
        const pos = (price - lower) / range;
        if (pos <= 0.08) return 12;
        if (pos >= 0.92) return -12;
        if (pos < 0.35) return 6;
        if (pos > 0.65) return -6;
        if (Number.isFinite(middle)) {
            if (price > middle) return 3;
            if (price < middle) return -3;
        }
        return 0;
    }

    /**
     * ADX + yön — trend gücü
     */
    scoreFromAdx(adxRow, trend) {
        if (!adxRow || !Number.isFinite(adxRow.adx)) return 0;
        const { adx, pdi, mdi } = adxRow;
        let s = 0;
        if (adx >= 22 && Number.isFinite(pdi) && Number.isFinite(mdi)) {
            if (pdi > mdi + 2) s += 14;
            else if (mdi > pdi + 2) s -= 14;
        }
        if (adx >= 30) {
            if (trend === 'BULLISH') s += 6;
            else if (trend === 'BEARISH') s -= 6;
        }
        return s;
    }

    /**
     * Son mum momentum
     */
    scoreFromLastCandle(candles) {
        if (!candles || candles.length < 2) return 0;
        const last = candles[candles.length - 1];
        const prev = candles[candles.length - 2];
        const body = last.close - last.open;
        const atr = Math.abs(last.high - last.low) + 0.0001;
        const strength = Math.abs(body) / atr;
        if (strength < 0.35) return 0;
        if (body > 0) return 8;
        if (body < 0) return -8;
        return 0;
    }

    /**
     * @param {Array} candles
     */
    evaluate(candles, timeframe) {
        const threshold = this.getThreshold(timeframe);
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

        const price = indicatorData.currentPrice;
        const rsi = indicatorData.rsi;
        const macd = indicatorData.macd;

        let score = 0;

        // Base trend
        if (trend === 'BULLISH') score += 16;
        else if (trend === 'BEARISH') score -= 16;

        // Price vs EMA
        if (Number.isFinite(price) && Number.isFinite(indicatorData.ema200)) {
            if (price > indicatorData.ema200) score += 8;
            else score -= 8;
        }

        if (Number.isFinite(indicatorData.ema50) && Number.isFinite(indicatorData.ema200)) {
            if (indicatorData.ema50 > indicatorData.ema200) score += 10;
            else score -= 10;
        }

        if (Number.isFinite(price) && Number.isFinite(indicatorData.ema20)) {
            if (price > indicatorData.ema20) score += 8;
            else score -= 8;
        }

        // EMA Cross
        score += this.scoreFromEmaCross(indicatorData);

        // MACD
        if (macd && Number.isFinite(macd.MACD) && Number.isFinite(macd.signal)) {
            if (macd.MACD > macd.signal) score += 14;
            else score -= 14;
        }

        // RSI
        score += this.scoreFromRsi(rsi);

        // Bollinger
        score += this.scoreFromBollinger(price, indicatorData.bb);

        // ADX
        score += this.scoreFromAdx(indicatorData.adx, trend);

        // Last candle
        score += this.scoreFromLastCandle(candles);

        // NEW: Volume Score
        score += this.scoreFromVolume(indicatorData, candles);

        // NEW: Volatility Score
        score += this.scoreFromVolatility(indicatorData);

        // NEW: Pattern Score
        score += this.scoreFromPattern(candles);

        // Smart Money
        if (sweep) {
            if (sweep.type === 'BULLISH') score += 18;
            if (sweep.type === 'BEARISH') score -= 18;
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
        if (signalType && this.isRsiSafetyFilterEnabled()) {
            const maxL = this.getRsiBlockLong();
            const minS = this.getRsiBlockShort();
            if (signalType === 'LONG' && Number.isFinite(rsi) && rsi > maxL) {
                blockedByRsi = true;
                signalType = null;
            }
            if (signalType === 'SHORT' && Number.isFinite(rsi) && rsi < minS) {
                blockedByRsi = true;
                signalType = null;
            }
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

    analyze(candles) {
        return this.evaluate(candles).signal;
    }

    calculateSLTP(type, price, atr, pivots) {
        let sl;
        let tp1;
        let tp2;
        let tp3;
        const multiplier = 1.5;

        if (type === 'LONG') {
            const lastLow = pivots.lows.length > 0 ? pivots.lows[pivots.lows.length - 1].price : price - atr * 2;
            sl = Math.min(lastLow, price - atr * multiplier);

            const risk = price - sl;
            tp1 = price + risk * 1.5;
            tp2 = price + risk * 2.5;
            tp3 = price + risk * 4;
        } else {
            const lastHigh = pivots.highs.length > 0 ? pivots.highs[pivots.highs.length - 1].price : price + atr * 2;
            sl = Math.max(lastHigh, price + atr * multiplier);

            const risk = sl - price;
            tp1 = price - risk * 1.5;
            tp2 = price - risk * 2.5;
            tp3 = price - risk * 4;
        }

        return { sl, tp: [tp1, tp2, tp3] };
    }
}

module.exports = new ConfluenceManager();
