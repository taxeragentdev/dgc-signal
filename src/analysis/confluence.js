const structure = require('./structure');
const indicators = require('./indicators');
const smc = require('./smartMoney');

class ConfluenceManager {
    /**
     * .env SIGNAL_THRESHOLD — varsayılan 36 (daha önce 45–50 çok seyrek sinyal üretiyordu).
     * İzinli aralık 28–95.
     */
    getThreshold() {
        const n = parseInt(process.env.SIGNAL_THRESHOLD, 10);
        if (Number.isFinite(n) && n >= 28 && n <= 95) return n;
        return 36;
    }

    /** LONG iptal eşiği: RSI bu değerin üstündeyse (varsayılan 80) */
    getRsiBlockLong() {
        const n = parseInt(process.env.SIGNAL_RSI_BLOCK_LONG, 10);
        if (Number.isFinite(n) && n >= 60 && n <= 100) return n;
        return 80;
    }

    /** SHORT iptal eşiği: RSI bu değerin altındeyse (varsayılan 20) */
    getRsiBlockShort() {
        const n = parseInt(process.env.SIGNAL_RSI_BLOCK_SHORT, 10);
        if (Number.isFinite(n) && n >= 0 && n <= 40) return n;
        return 20;
    }

    isRsiSafetyFilterEnabled() {
        const v = process.env.SIGNAL_RSI_FILTER?.trim().toLowerCase();
        return v !== 'false' && v !== '0' && v !== 'off';
    }

    /**
     * RSI katkısı — uç değerlerde ±30 tek başına skoru bozuyordu; kademeli yapı.
     * @param {number} rsi
     */
    scoreFromRsi(rsi) {
        if (!Number.isFinite(rsi)) return 0;
        if (rsi >= 75) return -18;
        if (rsi <= 25) return 18;
        if (rsi >= 62) return 10;
        if (rsi <= 38) return -10;
        if (rsi >= 55) return 6;
        if (rsi <= 45) return -6;
        return 0;
    }

    /**
     * Bollinger — banda göre aşırı alım / aşırı satım eğilimi (mevcut veriyi kullanır).
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
     * ADX + yön — trend gücü (daha önce hiç kullanılmıyordu).
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
     * Son mum momentum (volatil günlerde yön yakalamak için).
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

        const price = indicatorData.currentPrice;
        const rsi = indicatorData.rsi;
        const macd = indicatorData.macd;

        let score = 0;

        if (trend === 'BULLISH') score += 16;
        else if (trend === 'BEARISH') score -= 16;

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

        if (macd && Number.isFinite(macd.MACD) && Number.isFinite(macd.signal)) {
            if (macd.MACD > macd.signal) score += 14;
            else score -= 14;
        }

        score += this.scoreFromRsi(rsi);
        score += this.scoreFromBollinger(price, indicatorData.bb);
        score += this.scoreFromAdx(indicatorData.adx, trend);
        score += this.scoreFromLastCandle(candles);

        if (Number.isFinite(indicatorData.atr) && price > 0) {
            const volPct = (indicatorData.atr / price) * 100;
            if (volPct > 2.5) {
                if (score > 0) score += 4;
                else if (score < 0) score -= 4;
            }
        }

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
