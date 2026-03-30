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

    // Start scanning loop
    const scanInterval = parseInt(process.env.SCAN_INTERVAL) || 300000; // 5 mins default
    scanner.start(scanInterval);

    logger.info(`✅ Bot aktif! Tarama aralığı: ${scanInterval / 1000} saniye.`);
    
    // Initial message to user if possible
    // Note: User must send /start to the bot first to get notifications.
    logger.info('💡 Lütfen Telegram botuna gidip /start komutunu verin.');
}

main().catch(err => {
    logger.error(`❌ Bot başlatılırken kritik hata: ${err.message}`);
    process.exit(1);
});
