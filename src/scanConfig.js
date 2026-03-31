/**
 * HL/ccxt: 1m,3m,5m,15m,30m,1h,2h,4h,... — 10m yok.
 * Varsayılan: 4h çıkarıldı (daha sık sinyal taraması).
 */

const DEFAULT_TFS = ['5m', '15m', '30m', '1h'];

function getScanTimeframes() {
    const raw = process.env.SCAN_TIMEFRAMES?.trim();
    if (!raw) return [...DEFAULT_TFS];
    const list = raw
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
    return list.length ? list : [...DEFAULT_TFS];
}

function getPairDelayMs() {
    const n = parseInt(process.env.SCAN_PAIR_DELAY_MS, 10);
    return Number.isFinite(n) && n >= 0 ? n : 50;
}

module.exports = { getScanTimeframes, getPairDelayMs, DEFAULT_TFS };
