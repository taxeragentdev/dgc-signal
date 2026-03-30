const structure = require('./structure');

class SmartMoneyAnalyzer {
    /**
     * Detects Fair Value Gaps (FVG) in the last 3 candles.
     */
    detectFVG(candles) {
        if (candles.length < 3) return null;
        const c1 = candles[candles.length - 3];
        const c2 = candles[candles.length - 2];
        const c3 = candles[candles.length - 1];

        // Bullish FVG: Low of c3 > High of c1
        if (c3.low > c1.high) {
            return { type: 'BULLISH', top: c3.low, bottom: c1.high, size: c3.low - c1.high };
        }
        // Bearish FVG: High of c3 < Low of c1
        if (c3.high < c1.low) {
            return { type: 'BEARISH', top: c1.low, bottom: c3.high, size: c1.low - c3.high };
        }

        return null;
    }

    /**
     * Detects Liquidity Sweeps (SFP - Swing Failure Pattern).
     * @param {Array} candles - OHLCV data
     * @param {Object} pivots - Result from structure.findPivots
     */
    detectLiquiditySweep(candles, pivots) {
        if (candles.length < 2 || pivots.highs.length < 1 || pivots.lows.length < 1) return null;

        const currentCandle = candles[candles.length - 1];
        const lastPivotHigh = pivots.highs[pivots.highs.length - 1].price;
        const lastPivotLow = pivots.lows[pivots.lows.length - 1].price;

        // Bullish Sweep: Price went below last pivot low but closed above it
        if (currentCandle.low < lastPivotLow && currentCandle.close > lastPivotLow) {
            return { type: 'BULLISH', level: lastPivotLow };
        }

        // Bearish Sweep: Price went above last pivot high but closed below it
        if (currentCandle.high > lastPivotHigh && currentCandle.close < lastPivotHigh) {
            return { type: 'BEARISH', level: lastPivotHigh };
        }

        return null;
    }

    /**
     * Detects Order Blocks (OB).
     * Simplified: The last opposing candle before a strong directional move.
     */
    detectOrderBlock(candles) {
        // Simplified logic: If last candle is very large (long wick/body), 
        // the candle before it is the order block.
        if (candles.length < 2) return null;
        
        const last = candles[candles.length - 1];
        const prev = candles[candles.length - 2];
        
        const bodySize = Math.abs(last.close - last.open);
        const avgBodySize = candles.slice(-20).reduce((a, b) => a + Math.abs(b.close - b.open), 0) / 20;

        if (bodySize > avgBodySize * 2) {
            return {
                type: last.close > last.open ? 'BULLISH' : 'BEARISH',
                priceRange: { high: prev.high, low: prev.low },
                timestamp: prev.timestamp
            };
        }
        return null;
    }
}

module.exports = new SmartMoneyAnalyzer();
