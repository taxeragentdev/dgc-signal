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

    const intervalMs = parseInt(process.env.SCAN_INTERVAL, 10) || 300000;
    logger.info(`📊 Sürekli tarama: tur sonrası bekleme ${intervalMs / 1000}s (SCAN_INTERVAL).`);

    scanner.start().catch((err) => {
        logger.error(`❌ Tarama döngüsü: ${err.message}`);
    });

    logger.info('💡 Sinyal almak için botta /start veya herhangi bir komut kullanın (sohbet ID bağlanır).');

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
