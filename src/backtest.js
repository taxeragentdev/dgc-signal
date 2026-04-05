/**
 * Backtest Module - Geçmiş verilerle sinyal testleri
 * Amaç: Hangi sinyallerin karlı olduğunu görmek, indikatör ağırlıklarını optimize etmek
 */

const exchange = require('./exchange');
const strategy = require('./analysis/strategy');
const winston = require('winston');

const logger = winston.createLogger({
    level: 'info',
    format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.json()
    ),
    transports: [new winston.transports.Console()]
});

/**
 * Tek bir sinyalin geriye dönük test sonucu
 * @typedef {Object} BacktestResult
 * @property {string} symbol
 * @property {string} timeframe
 * @property {number} signalTime - Unix ms
 * @property {string} type - LONG/SHORT
 * @property {number} score
 * @property {number} entryPrice
 * @property {number} sl
 * @property {number} tp1
 * @property {number} tp2
 * @property {number} tp3
 * @property {string} outcome - 'TP1'/'TP2'/'TP3'/'SL'/'ONGOING'
 * @property {number} pnlPct - % kar/zarar
 * @property {number} exitPrice
 * @property {number} barsHeld - Kaç mum tutuldu
 * @property {object} indicators - Sinyal anındaki indikatörler
 */

/**
 * Bir coin için geçmiş verilerle backtest yap
 * @param {string} symbol - BTC/USDC:USDC
 * @param {string} timeframe - 5m, 15m, 1h
 * @param {number} lookbackBars - Geriye kaç mum test edilsin (örn: 500)
 * @returns {Promise<{signals: BacktestResult[], summary: object}>}
 */
async function backtestSymbol(symbol, timeframe, lookbackBars = 500) {
    logger.info(`[backtest] ${symbol} ${timeframe} - ${lookbackBars} mum analizi...`);
    
    // Daha fazla veri al (sinyal için 200 + test için lookback + exit için 50)
    const totalBars = 200 + lookbackBars + 50;
    const candles = await exchange.fetchOHLCV(symbol, timeframe, totalBars);
    
    if (!candles || candles.length < totalBars) {
        logger.warn(`[backtest] ${symbol} ${timeframe}: Yetersiz veri (${candles?.length || 0}/${totalBars})`);
        return { signals: [], summary: { error: 'insufficient_data' } };
    }

    const results = [];
    
    // Son 200 mumu sliding window ile tara (sinyal üret)
    for (let i = 200; i < 200 + lookbackBars; i++) {
        const windowCandles = candles.slice(i - 200, i);
        const evaluation = strategy.evaluate(windowCandles, timeframe);
        
        if (!evaluation.signal) continue;
        
        const signal = evaluation.signal;
        const signalBar = windowCandles[windowCandles.length - 1];
        
        // Sinyalden sonraki mumları izle (en fazla 50 mum)
        const futureCandles = candles.slice(i, Math.min(i + 50, candles.length));
        if (futureCandles.length === 0) continue;
        
        const outcome = simulateSignal(signal, signalBar, futureCandles);
        results.push({
            symbol,
            timeframe,
            signalTime: signalBar.timestamp,
            type: signal.type,
            score: signal.score,
            entryPrice: signal.price,
            sl: signal.sl,
            tp1: signal.tp[0],
            tp2: signal.tp[1],
            tp3: signal.tp[2],
            outcome: outcome.result,
            pnlPct: outcome.pnlPct,
            exitPrice: outcome.exitPrice,
            barsHeld: outcome.barsHeld,
            indicators: {
                rsi: signal.indicators.rsi,
                macd: signal.indicators.macd?.histogram,
                adx: signal.indicators.adx,
                trend: signal.trend
            }
        });
    }

    const summary = calculateSummary(results);
    logger.info(`[backtest] ${symbol} ${timeframe}: ${results.length} sinyal, Win rate: ${summary.winRate.toFixed(1)}%, Avg PnL: ${summary.avgPnl.toFixed(2)}%`);
    
    return { signals: results, summary };
}

/**
 * Sinyalin sonucunu simüle et (TP1/TP2/TP3/SL'e çarpma)
 * @param {object} signal
 * @param {object} entryCandle
 * @param {Array} futureCandles - Sinyalden sonraki mumlar
 */
function simulateSignal(signal, entryCandle, futureCandles) {
    const isLong = signal.type === 'LONG';
    const entry = signal.price;
    const sl = signal.sl;
    const tp1 = signal.tp[0];
    const tp2 = signal.tp[1];
    const tp3 = signal.tp[2];
    
    for (let i = 0; i < futureCandles.length; i++) {
        const candle = futureCandles[i];
        
        if (isLong) {
            // LONG: SL altında kırılma
            if (candle.low <= sl) {
                return {
                    result: 'SL',
                    exitPrice: sl,
                    pnlPct: ((sl - entry) / entry) * 100,
                    barsHeld: i + 1
                };
            }
            // TP3 (en agresif)
            if (candle.high >= tp3) {
                return {
                    result: 'TP3',
                    exitPrice: tp3,
                    pnlPct: ((tp3 - entry) / entry) * 100,
                    barsHeld: i + 1
                };
            }
            // TP2
            if (candle.high >= tp2) {
                return {
                    result: 'TP2',
                    exitPrice: tp2,
                    pnlPct: ((tp2 - entry) / entry) * 100,
                    barsHeld: i + 1
                };
            }
            // TP1
            if (candle.high >= tp1) {
                return {
                    result: 'TP1',
                    exitPrice: tp1,
                    pnlPct: ((tp1 - entry) / entry) * 100,
                    barsHeld: i + 1
                };
            }
        } else {
            // SHORT: SL üstünde kırılma
            if (candle.high >= sl) {
                return {
                    result: 'SL',
                    exitPrice: sl,
                    pnlPct: ((entry - sl) / entry) * 100,
                    barsHeld: i + 1
                };
            }
            // TP3
            if (candle.low <= tp3) {
                return {
                    result: 'TP3',
                    exitPrice: tp3,
                    pnlPct: ((entry - tp3) / entry) * 100,
                    barsHeld: i + 1
                };
            }
            // TP2
            if (candle.low <= tp2) {
                return {
                    result: 'TP2',
                    exitPrice: tp2,
                    pnlPct: ((entry - tp2) / entry) * 100,
                    barsHeld: i + 1
                };
            }
            // TP1
            if (candle.low <= tp1) {
                return {
                    result: 'TP1',
                    exitPrice: tp1,
                    pnlPct: ((entry - tp1) / entry) * 100,
                    barsHeld: i + 1
                };
            }
        }
    }
    
    // 50 mum sonunda hala pozisyonda
    const lastCandle = futureCandles[futureCandles.length - 1];
    const exitPrice = lastCandle.close;
    const pnlPct = isLong
        ? ((exitPrice - entry) / entry) * 100
        : ((entry - exitPrice) / entry) * 100;
    
    return {
        result: 'ONGOING',
        exitPrice,
        pnlPct,
        barsHeld: futureCandles.length
    };
}

/**
 * Backtest sonuçlarının özet istatistikleri
 */
function calculateSummary(results) {
    if (results.length === 0) {
        return {
            totalSignals: 0,
            winRate: 0,
            avgPnl: 0,
            bestTrade: null,
            worstTrade: null,
            avgBarsHeld: 0
        };
    }
    
    const wins = results.filter(r => r.pnlPct > 0);
    const losses = results.filter(r => r.pnlPct <= 0);
    const tp1 = results.filter(r => r.outcome === 'TP1').length;
    const tp2 = results.filter(r => r.outcome === 'TP2').length;
    const tp3 = results.filter(r => r.outcome === 'TP3').length;
    const sl = results.filter(r => r.outcome === 'SL').length;
    
    const totalPnl = results.reduce((sum, r) => sum + r.pnlPct, 0);
    const avgPnl = totalPnl / results.length;
    const avgWin = wins.length > 0 ? wins.reduce((s, w) => s + w.pnlPct, 0) / wins.length : 0;
    const avgLoss = losses.length > 0 ? losses.reduce((s, l) => s + l.pnlPct, 0) / losses.length : 0;
    const avgBarsHeld = results.reduce((s, r) => s + r.barsHeld, 0) / results.length;
    
    const sorted = [...results].sort((a, b) => b.pnlPct - a.pnlPct);
    
    return {
        totalSignals: results.length,
        winRate: (wins.length / results.length) * 100,
        wins: wins.length,
        losses: losses.length,
        tp1Count: tp1,
        tp2Count: tp2,
        tp3Count: tp3,
        slCount: sl,
        avgPnl,
        avgWin,
        avgLoss,
        profitFactor: Math.abs(avgLoss) > 0 ? Math.abs(avgWin / avgLoss) : 0,
        bestTrade: sorted[0],
        worstTrade: sorted[sorted.length - 1],
        avgBarsHeld: Math.round(avgBarsHeld)
    };
}

/**
 * Tüm coinleri backtest et
 * @param {Array<string>} symbols
 * @param {Array<string>} timeframes
 * @param {number} lookbackBars
 */
async function backtestMultiple(symbols, timeframes, lookbackBars = 500) {
    const allResults = [];
    
    for (const symbol of symbols) {
        for (const tf of timeframes) {
            try {
                const result = await backtestSymbol(symbol, tf, lookbackBars);
                allResults.push({
                    symbol,
                    timeframe: tf,
                    ...result
                });
                // Rate limit için 1s bekle
                await new Promise(resolve => setTimeout(resolve, 1000));
            } catch (error) {
                logger.error(`[backtest] ${symbol} ${tf} hata: ${error.message}`);
            }
        }
    }
    
    return allResults;
}

/**
 * Backtest sonuçlarını Telegram formatında yazdır
 */
function formatBacktestReport(results) {
    let report = `📊 <b>BACKTEST RAPORU</b>\n\n`;
    
    for (const res of results) {
        const { symbol, timeframe, summary, signals } = res;
        if (summary.error) continue;
        
        report += `💎 <b>${symbol}</b> (${timeframe})\n`;
        report += `  📈 Toplam sinyal: ${summary.totalSignals}\n`;
        report += `  ✅ Win rate: <b>${summary.winRate.toFixed(1)}%</b> (${summary.wins}/${summary.totalSignals})\n`;
        report += `  💰 Ort. PnL: <b>${summary.avgPnl > 0 ? '+' : ''}${summary.avgPnl.toFixed(2)}%</b>\n`;
        report += `  🎯 TP1: ${summary.tp1Count} | TP2: ${summary.tp2Count} | TP3: ${summary.tp3Count} | SL: ${summary.slCount}\n`;
        report += `  📊 Profit Factor: ${summary.profitFactor.toFixed(2)}\n`;
        report += `  ⏱️ Ort. tutma süresi: ${summary.avgBarsHeld} mum\n`;
        if (summary.bestTrade) {
            report += `  🏆 En iyi: +${summary.bestTrade.pnlPct.toFixed(2)}% (skor: ${summary.bestTrade.score})\n`;
        }
        report += `\n`;
    }
    
    return report;
}

module.exports = {
    backtestSymbol,
    backtestMultiple,
    calculateSummary,
    formatBacktestReport
};
