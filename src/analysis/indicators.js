const TI = require('technicalindicators');

class IndicatorCalculator {
    constructor() {}

    /**
     * Calculates indicators for a given set of candles.
     * @param {Array} candles - Array of [O,H,L,C,V] objects
     */
    calculate(candles) {
        const prices = candles.map(c => c.close);
        const highs = candles.map(c => c.high);
        const lows = candles.map(c => c.low);

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
            rsi: rsi[rsi.length - 1],
            macd: macd[macd.length - 1],
            ema20: ema20[ema20.length - 1],
            ema50: ema50[ema50.length - 1],
            ema200: ema200[ema200.length - 1],
            bb: bb[bb.length - 1],
            adx: adx[adx.length - 1],
            atr: atr[atr.length - 1],
            currentPrice: prices[prices.length - 1]
        };
    }
}

module.exports = new IndicatorCalculator();
