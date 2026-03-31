/**
 * Candle Pattern Detection
 * Engulfing, Pin Bar, Doji, Strong Close, Volume Confirmation
 */

class CandlePatternDetector {
    /**
     * Detects Bullish Engulfing Pattern
     * Last candle completely engulfs previous candle (both open & close)
     */
    detectBullishEngulfing(candles) {
        if (!candles || candles.length < 2) return null;
        const prev = candles[candles.length - 2];
        const curr = candles[candles.length - 1];

        // Previous must be bearish (close < open)
        if (prev.close >= prev.open) return null;

        // Current must be bullish (close > open)
        if (curr.close <= curr.open) return null;

        // Current open must be below or equal to previous close
        // Current close must be above or equal to previous open
        if (curr.open <= prev.close && curr.close >= prev.open) {
            const bodyStrength = (curr.close - curr.open) / (curr.high - curr.low);
            return {
                type: 'BULLISH_ENGULFING',
                strength: Math.min(bodyStrength, 1),
                confidence: bodyStrength > 0.7 ? 'HIGH' : 'MEDIUM'
            };
        }
        return null;
    }

    /**
     * Detects Bearish Engulfing Pattern
     */
    detectBearishEngulfing(candles) {
        if (!candles || candles.length < 2) return null;
        const prev = candles[candles.length - 2];
        const curr = candles[candles.length - 1];

        // Previous must be bullish (close > open)
        if (prev.close <= prev.open) return null;

        // Current must be bearish (close < open)
        if (curr.close >= curr.open) return null;

        // Current open must be above or equal to previous close
        // Current close must be below or equal to previous open
        if (curr.open >= prev.close && curr.close <= prev.open) {
            const bodyStrength = (curr.open - curr.close) / (curr.high - curr.low);
            return {
                type: 'BEARISH_ENGULFING',
                strength: Math.min(bodyStrength, 1),
                confidence: bodyStrength > 0.7 ? 'HIGH' : 'MEDIUM'
            };
        }
        return null;
    }

    /**
     * Detects Pin Bar / Hammer / Hanging Man
     * Long wick with small body at opposite end
     */
    detectPinBar(candles) {
        if (!candles || candles.length < 1) return null;
        const curr = candles[candles.length - 1];

        const bodySize = Math.abs(curr.close - curr.open);
        const totalRange = curr.high - curr.low;

        if (totalRange <= 0) return null;

        const bodyPercent = bodySize / totalRange;
        const upperWick = curr.high - Math.max(curr.open, curr.close);
        const lowerWick = Math.min(curr.open, curr.close) - curr.low;
        const wickPercent = Math.max(upperWick, lowerWick) / totalRange;

        // Pin bar: small body (< 30%), long wick (> 60%)
        if (bodyPercent < 0.3 && wickPercent > 0.6) {
            const isHammer = lowerWick > upperWick && curr.close > curr.open;
            const isHangingMan = lowerWick > upperWick && curr.close < curr.open;
            const isShootingStar = upperWick > lowerWick && curr.close < curr.open;

            return {
                type: isHammer ? 'HAMMER' : isHangingMan ? 'HANGING_MAN' : 'SHOOTING_STAR',
                strength: wickPercent,
                confidence: wickPercent > 0.75 ? 'HIGH' : 'MEDIUM'
            };
        }
        return null;
    }

    /**
     * Detects Doji (opening and closing nearly equal)
     */
    detectDoji(candles) {
        if (!candles || candles.length < 1) return null;
        const curr = candles[candles.length - 1];

        const bodySize = Math.abs(curr.close - curr.open);
        const totalRange = curr.high - curr.low;

        if (totalRange <= 0) return null;

        const bodyPercent = bodySize / totalRange;
        
        // Doji: very small body (< 10%)
        if (bodyPercent < 0.1) {
            return {
                type: 'DOJI',
                strength: 1 - bodyPercent,
                confidence: bodyPercent < 0.05 ? 'HIGH' : 'MEDIUM'
            };
        }
        return null;
    }

    /**
     * Detects Strong Close (momentum into close)
     * Last 20% of candle has significant price action
     */
    detectStrongClose(candles) {
        if (!candles || candles.length < 1) return null;
        const curr = candles[candles.length - 1];

        const range = curr.high - curr.low;
        if (range <= 0) return null;

        // Bullish strong close: close in upper 20%, body direction positive
        if (curr.close >= curr.low + range * 0.8 && curr.close > curr.open) {
            const strength = (curr.close - curr.low) / range;
            return {
                type: 'STRONG_BULLISH_CLOSE',
                strength,
                momentum: curr.close - curr.open
            };
        }

        // Bearish strong close: close in lower 20%, body direction negative
        if (curr.close <= curr.high - range * 0.8 && curr.close < curr.open) {
            const strength = (curr.high - curr.close) / range;
            return {
                type: 'STRONG_BEARISH_CLOSE',
                strength,
                momentum: curr.open - curr.close
            };
        }

        return null;
    }

    /**
     * Volume Profile (simple: is this candle high volume?)
     * Compares current volume to 20-candle average
     */
    detectHighVolume(candles) {
        if (!candles || candles.length < 20) return false;
        
        const curr = candles[candles.length - 1];
        const prevCandles = candles.slice(-21, -1);
        const avgVolume = prevCandles.reduce((a, c) => a + (c.volume || 0), 0) / 20;

        return (curr.volume || 0) > avgVolume * 1.5;
    }

    /**
     * Composite Pattern Score
     * Combines engulfing + pin bar + candle pattern + volume
     */
    getPatternScore(candles) {
        if (!candles || candles.length < 2) return 0;

        let score = 0;

        const bullEngulf = this.detectBullishEngulfing(candles);
        const bearEngulf = this.detectBearishEngulfing(candles);
        const pinBar = this.detectPinBar(candles);
        const doji = this.detectDoji(candles);
        const strongClose = this.detectStrongClose(candles);
        const highVol = this.detectHighVolume(candles);

        if (bullEngulf) {
            score += bullEngulf.confidence === 'HIGH' ? 12 : 8;
        }
        if (bearEngulf) {
            score -= bearEngulf.confidence === 'HIGH' ? 12 : 8;
        }

        if (pinBar && pinBar.type === 'HAMMER') {
            score += pinBar.confidence === 'HIGH' ? 10 : 6;
        }
        if (pinBar && pinBar.type === 'SHOOTING_STAR') {
            score -= pinBar.confidence === 'HIGH' ? 10 : 6;
        }

        if (doji) {
            score += 0; // Doji is neutral/indecision
        }

        if (strongClose && strongClose.type === 'STRONG_BULLISH_CLOSE') {
            score += strongClose.strength > 0.9 ? 6 : 3;
        }
        if (strongClose && strongClose.type === 'STRONG_BEARISH_CLOSE') {
            score -= strongClose.strength > 0.9 ? 6 : 3;
        }

        if (highVol) {
            score += Math.sign(score) * 4; // Volume confirms direction
        }

        return score;
    }

    /**
     * Full analysis for a candle series
     */
    analyze(candles) {
        if (!candles || candles.length < 2) return null;

        return {
            engulfingBullish: this.detectBullishEngulfing(candles),
            engulfingBearish: this.detectBearishEngulfing(candles),
            pinBar: this.detectPinBar(candles),
            doji: this.detectDoji(candles),
            strongClose: this.detectStrongClose(candles),
            highVolume: this.detectHighVolume(candles),
            patternScore: this.getPatternScore(candles)
        };
    }
}

module.exports = new CandlePatternDetector();
