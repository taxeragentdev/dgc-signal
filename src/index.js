require('dotenv').config();

// Önce Telegram örneği oluşsun; scanner içinde telegram require edilir (cache).
const telegram = require('./telegram');
const scanner = require('./scanner');
const winston = require('winston');

const logger = winston.createLogger({
    level: 'info',
    format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.json()
    ),
    transports: [
        new winston.transports.Console(),
        new winston.transports.File({ filename: 'app.log' })
    ]
});

async function main() {
    logger.info('🚀 Kripto Sinyal Botu Başlatılıyor...');

    const token = process.env.TELEGRAM_BOT_TOKEN;
    if (!token) {
        logger.error('❌ TELEGRAM_BOT_TOKEN bulunamadı! .env dosyasını kontrol edin.');
        process.exit(1);
    }
    logger.info(`📡 Telegram Bot Token: ${token.substring(0, 10)}... loaded.`);

    await telegram.launch();
    logger.info('✅ Telegram polling hazır.');

    const { getScanTimeframes } = require('./scanConfig');
    const { getScanCoins } = require('../config/coins');
    const scanCoins = getScanCoins();
    logger.info(`📊 Taranan coinler (${scanCoins.length}): ${scanCoins.join(', ')} (SCAN_COINS)`);
    const scanTfs = getScanTimeframes();
    logger.info(
        `📊 Arka plan TF: ${scanTfs.join(', ')} (SCAN_MODE=${process.env.SCAN_MODE || 'scalp'}, SCAN_TIMEFRAMES ile override)`
    );
    const intervalMs = parseInt(process.env.SCAN_INTERVAL, 10) || 30000;
    logger.info(`📊 Tur aralığı: ${intervalMs / 1000}s (SCAN_INTERVAL, varsayılan 30).`);

    if (process.env.AUTO_TRADE_ENABLED === 'true') {
        const { parseAgentsFromEnv } = require('./agents');
        const n = parseAgentsFromEnv().length;
        logger.info(
            n > 0
                ? `🤖 Oto-trade: açık (${n} ajan, AGENTS_JSON)`
                : `🤖 Oto-trade: AUTO_TRADE_ENABLED ama AGENTS_JSON boş — işlem açılmaz`
        );
    } else {
        logger.info('🤖 Oto-trade: kapalı (AUTO_TRADE_ENABLED=true yapın + AGENTS_JSON)');
    }
    const hb = process.env.STATUS_HEARTBEAT_MS;
    const hbSec = hb === '0' || hb === 'false' ? 'kapalı' : `${(parseInt(hb, 10) || 300000) / 1000}s`;
    logger.info(`📊 Durum özeti (Telegram): ${hbSec} (STATUS_HEARTBEAT_MS)`);

    const { getStrategy } = require('./analysis/strategy');
    logger.info(`📊 Strateji: SIGNAL_STRATEGY=${getStrategy()} (confluence / bollinger / hybrid)`);

    logger.info('📡 scanner.start() çağrılıyor — sürekli tarama başlıyor...');
    scanner.start().catch((err) => {
        logger.error(`❌ Tarama döngüsü hata: ${err.message}`);
        logger.error(`Stack: ${err.stack}`);
    });

    logger.info(
        '💡 Arka plan tarama sürekli çalışır; sinyal yoksa Telegram sessiz kalır. /status ile son tur bilgisini görün.'
    );
    logger.info('💡 Sohbet ID: botta /start veya TELEGRAM_CHAT_ID (sinyal mesajı için).');

    process.on('unhandledRejection', (reason) => {
        logger.error(`unhandledRejection: ${reason}`);
    });

    const shutdown = async (signal) => {
        logger.info(`🛑 ${signal} alındı. Bot kapatılıyor...`);
        try {
            await telegram.bot.stop(signal);
            logger.info('✅ Telegram bağlantısı kesildi.');
            process.exit(0);
        } catch (err) {
            logger.error(`❌ Kapatma hatası: ${err.message}`);
            process.exit(1);
        }
    };

    process.on('SIGINT', () => shutdown('SIGINT'));
    process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch((err) => {
    const msg = err?.message || String(err);
    logger.error(`❌ Bot başlatılırken kritik hata: ${msg}`);
    if (msg.includes('409') || msg.includes('Conflict') || msg.includes('getUpdates')) {
        logger.error(
            '→ 409: Aynı TELEGRAM_BOT_TOKEN ile başka bir süreç zaten polling yapıyor.\n' +
                '  • PC\'de `node src/index.js` veya başka sunucu çalışıyorsa durdurun.\n' +
                '  • Railway: Service → Settings → Replicas = 1 olmalı (aynı servisten iki kopya olmasın).\n' +
                '  • Webhook: api.telegram.org/bot + TOKEN + /deleteWebhook (köşeli parantez yok)'
        );
    }
    process.exit(1);
});
