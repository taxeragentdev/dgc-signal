class StructureAnalyzer {
    /**
     * Finds swing highs and lows in a candlestick series.
     * @param {Array} candles - Array of [O,H,L,C,V] objects
     * @param {number} leftBars - Minimum bars on the left to confirm pivot (strength)
     * @param {number} rightBars - Minimum bars on the right to confirm pivot
     * @returns {Object} - { highs: [{index, price, timestamp}], lows: [...] }
     */
    findPivots(candles, leftBars = 2, rightBars = 1) {
        const highs = [];
        const lows = [];

        for (let i = leftBars; i < candles.length - rightBars; i++) {
            const currentHigh = candles[i].high;
            const currentLow = candles[i].low;

            let isPivotHigh = true;
            let isPivotLow = true;

            // Check left side
            for (let j = 1; j <= leftBars; j++) {
                if (candles[i - j].high >= currentHigh) isPivotHigh = false;
                if (candles[i - j].low <= currentLow) isPivotLow = false;
            }

            // Check right side
            for (let j = 1; j <= rightBars; j++) {
                if (candles[i + j].high > currentHigh) isPivotHigh = false;
                if (candles[i + j].low < currentLow) isPivotLow = false;
            }

            if (isPivotHigh) {
                highs.push({ index: i, price: currentHigh, timestamp: candles[i].timestamp });
            }
            if (isPivotLow) {
                lows.push({ index: i, price: currentLow, timestamp: candles[i].timestamp });
            }
        }

        return { highs, lows };
    }

    /**
     * Determines the current Trend based on recent swing points.
     * @param {Object} pivots - Result from findPivots
     * @returns {string} - 'BULLISH', 'BEARISH' or 'RANGING'
     */
    getMarketStructure(pivots) {
        if (pivots.highs.length < 2 || pivots.lows.length < 2) return 'RANGING';

        const lastHigh = pivots.highs[pivots.highs.length - 1].price;
        const prevHigh = pivots.highs[pivots.highs.length - 2].price;
        const lastLow = pivots.lows[pivots.lows.length - 1].price;
        const prevLow = pivots.lows[pivots.lows.length - 2].price;

        if (lastHigh > prevHigh && lastLow > prevLow) return 'BULLISH';
        if (lastHigh < prevHigh && lastLow < prevLow) return 'BEARISH';
        
        return 'RANGING';
    }
}

module.exports = new StructureAnalyzer();
