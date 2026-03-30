/** ACP tabanı — env her çağrıda okunur (dotenv sonrası) */
function getAcpBaseUrl() {
    return (process.env.ACP_API_URL?.trim() || 'https://claw-api.virtuals.io').replace(/\/$/, '');
}

module.exports = { getAcpBaseUrl };
