const TI = require('technicalindicators');

function last(arr) {
    return Array.isArray(arr) && arr.length ? arr[arr.length - 1] : undefined;
}

class IndicatorCalculator {
    constructor() {}

    /**
     * Calculates indicators for a given set of candles.
     * @param {Array} candles - Array of { open, high, low, close, ... }
     */
    calculate(candles) {
        const prices = candles.map((c) => c.close);
        const highs = candles.map((c) => c.high);
        const lows = candles.map((c) => c.low);

        const rsi = TI.RSI.calculate({ values: prices, period: 14 });
        const macd = TI.MACD.calculate({
            values: prices,
            fastPeriod: 12,
            slowPeriod: 26,
            signalPeriod: 9,
            SimpleMAOscillator: false,
            SimpleMASignal: false
        });
        const ema20 = TI.EMA.calculate({ values: prices, period: 20 });
        const ema50 = TI.EMA.calculate({ values: prices, period: 50 });
        const ema200 = TI.EMA.calculate({ values: prices, period: 200 });
        const bb = TI.BollingerBands.calculate({ values: prices, period: 20, stdDev: 2 });
        const adx = TI.ADX.calculate({ high: highs, low: lows, close: prices, period: 14 });
        const atr = TI.ATR.calculate({ high: highs, low: lows, close: prices, period: 14 });

        return {
            rsi: last(rsi),
            macd: last(macd),
            ema20: last(ema20),
            ema50: last(ema50),
            ema200: last(ema200),
            bb: last(bb),
            adx: last(adx),
            atr: last(atr),
            currentPrice: prices[prices.length - 1]
        };
    }
}

module.exports = new IndicatorCalculator();
