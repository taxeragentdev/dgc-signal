/**
 * HL/ccxt: 1m,3m,5m,15m,30m,1h,2h,4h,... — 10m yok.
 *
 * Arka plan varsayılanı: scalp (5m+15m) — sürekli “scalp” hızında tarama.
 * Geniş tarama: SCAN_MODE=full veya SCAN_TIMEFRAMES=5m,15m,30m,1h
 */

/** /scalp komutu ve arka plan varsayılanı (sürekli scalp) */
const SCALP_TFS = ['5m', '15m'];

/** Daha geniş confluence taraması */
const FULL_TFS = ['5m', '15m', '30m', '1h'];

function parseTfList(raw) {
    const list = raw
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
    return list.length ? list : null;
}

/**
 * Arka plan + /scan (argsız) için TF listesi.
 * Öncelik: SCAN_TIMEFRAMES → SCAN_MODE → varsayılan scalp.
 */
function getScanTimeframes() {
    const explicit = process.env.SCAN_TIMEFRAMES?.trim();
    if (explicit) {
        const parsed = parseTfList(explicit);
        if (parsed) return parsed;
    }

    const mode = (process.env.SCAN_MODE || 'scalp').trim().toLowerCase();
    if (mode === 'full') return [...FULL_TFS];
    return [...SCALP_TFS];
}

function getScalpTimeframes() {
    return [...SCALP_TFS];
}

function getPairDelayMs() {
    const n = parseInt(process.env.SCAN_PAIR_DELAY_MS, 10);
    /** ccxt HL ~50ms rate limit; ekstra uyku 0 = en hızlı tur */
    return Number.isFinite(n) && n >= 0 ? n : 0;
}

module.exports = {
    getScanTimeframes,
    getScalpTimeframes,
    getPairDelayMs,
    SCALP_TFS,
    FULL_TFS
};
