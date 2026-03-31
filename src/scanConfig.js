/**
 * HL/ccxt: 1m,3m,5m,15m,30m,1h,2h,4h,... — 10m yok.
 * Varsayılan: 1h çıkarıldı — tur daha kısa, sinyal daha sık kontrol.
 * Tam liste: SCAN_TIMEFRAMES=5m,15m,30m,1h
 */

const DEFAULT_TFS = ['5m', '15m', '30m'];

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
    /** ccxt HL ~50ms rate limit; ekstra uyku 0 = en hızlı tur */
    return Number.isFinite(n) && n >= 0 ? n : 0;
}

module.exports = { getScanTimeframes, getPairDelayMs, DEFAULT_TFS };
