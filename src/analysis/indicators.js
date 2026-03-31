const TI = require('technicalindicators');

function last(arr) {
    return Array.isArray(arr) && arr.length ? arr[arr.length - 1] : undefined;
}

function prev(arr) {
    return Array.isArray(arr) && arr.length > 1 ? arr[arr.length - 2] : undefined;
}

class IndicatorCalculator {
    constructor() {}

    /**
     * Calculates indicators for a given set of candles.
     * @param {Array} candles - Array of { open, high, low, close, volume, ... }
     */
    calculate(candles) {
        const prices = candles.map((c) => c.close);
        const highs = candles.map((c) => c.high);
        const lows = candles.map((c) => c.low);
        const volumes = candles.map((c) => c.volume || 0);

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

        // Volume calculations
        const avgVolume = volumes.slice(-20).reduce((a, b) => a + b, 0) / 20;
        const currentVolume = volumes[volumes.length - 1] || 0;
        const volumeRatio = avgVolume > 0 ? currentVolume / avgVolume : 1;

        // Volatility (ATR as % of price)
        const currentAtr = last(atr);
        const currentPrice = prices[prices.length - 1];
        const volatilityPct = currentPrice > 0 && currentAtr ? (currentAtr / currentPrice) * 100 : 0;

        return {
            rsi: last(rsi),
            rsiPrev: prev(rsi),
            macd: last(macd),
            macdPrev: prev(macd),
            ema20: last(ema20),
            ema20Prev: prev(ema20),
            ema50: last(ema50),
            ema50Prev: prev(ema50),
            ema200: last(ema200),
            ema200Prev: prev(ema200),
            bb: last(bb),
            adx: last(adx),
            atr: last(atr),
            currentPrice: currentPrice,
            volume: currentVolume,
            avgVolume: avgVolume,
            volumeRatio: volumeRatio,
            volatilityPct: volatilityPct
        };
    }
}

module.exports = new IndicatorCalculator();
