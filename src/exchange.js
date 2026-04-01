const ccxt = require('ccxt');
const winston = require('winston');

class ExchangeManager {
    constructor() {
        this.exchange = new ccxt.hyperliquid({
            enableRateLimit: true,
            options: {
                'defaultType': 'swap' // Hyperliquid is primarily perp/swap
            }
        });
        this.logger = winston.createLogger({
            level: 'info',
            format: winston.format.combine(
                winston.format.timestamp(),
                winston.format.json()
            ),
            transports: [
                new winston.transports.Console(),
                new winston.transports.File({ filename: 'error.log', level: 'error' }),
            ],
        });
    }

    /**
     * Fetches OHLCV data for a given symbol and timeframe.
     * @param {string} symbol - e.g., 'BTC/USDC:USDC' or 'BTC/USDT'
     * @param {string} timeframe - e.g., '1m', '5m', '15m', '1h', '4h'
     * @param {number} limit - Number of candles (default: 100)
     * @returns {Promise<Array>} - Candlestick data
     */
    async fetchOHLCV(symbol, timeframe = '1h', limit = 100) {
        try {
            // Validate inputs
            if (!symbol || !symbol.includes('/')) {
                throw new Error(`Geçersiz pair format: "${symbol}" (örnek: BTC/USDC:USDC)`);
            }
            const validTfs = ['1m', '3m', '5m', '15m', '30m', '1h', '2h', '4h', '6h', '8h', '12h', '1d', '1w', '1M'];
            if (!validTfs.includes(timeframe)) {
                throw new Error(`Geçersiz timeframe: "${timeframe}" (izin verilenler: ${validTfs.join(', ')})`);
            }

            const ohlcv = await this.exchange.fetchOHLCV(symbol, timeframe, undefined, limit);
            
            if (!ohlcv || ohlcv.length === 0) {
                throw new Error(`Borsadan veri alınamadı (Boş veri)`);
            }

            return ohlcv.map(candle => ({
                timestamp: candle[0],
                open: candle[1],
                high: candle[2],
                low: candle[3],
                close: candle[4],
                volume: candle[5]
            }));
        } catch (error) {
            const status = error.response?.status || '';
            const statusText = error.response?.statusText || '';
            const msg = `Hyperliquid Hatası [${status} ${statusText}] (${symbol} - ${timeframe}): ${error.message}`;
            this.logger.error(msg);
            throw new Error(msg);
        }
    }

    async getSymbols() {
        try {
            await this.exchange.loadMarkets();
            return Object.keys(this.exchange.markets);
        } catch (error) {
            this.logger.error(`Error loading markets: ${error.message}`);
            return [];
        }
    }
}

module.exports = new ExchangeManager();
