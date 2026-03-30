require('dotenv').config();
const scanner = require('./scanner');
const telegram = require('./telegram');
const winston = require('winston');

// Setup main logger
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

    // Log the provided token (first 10 chars for safety)
    const token = process.env.TELEGRAM_BOT_TOKEN;
    if (!token) {
        logger.error('❌ TELEGRAM_BOT_TOKEN bulunamadı! .env dosyasını kontrol edin.');
        process.exit(1);
    }
    logger.info(`📡 Telegram Bot Token: ${token.substring(0, 10)}... loaded.`);

    // Start scanning loop (Continuous)
    scanner.start();

    const scanInterval = parseInt(process.env.SCAN_INTERVAL) || 300000; 

    logger.info(`✅ Bot aktif! Tarama aralığı: ${scanInterval / 1000} saniye.`);
    
    // Initial message to user if possible
    logger.info('💡 Lütfen Telegram botuna gidip /start komutunu verin.');

    // Handle termination signals
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

main().catch(err => {
    logger.error(`❌ Bot başlatılırken kritik hata: ${err.message}`);
    process.exit(1);
});
