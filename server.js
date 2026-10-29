const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const webpush = require('web-push');

const PORT = Number(process.env.PORT || 8787);
const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY || '';
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY || '';
const VAPID_SUBJECT = process.env.VAPID_SUBJECT || 'mailto:admin@example.com';
const ADMIN_TOKEN = process.env.PUSH_ADMIN_TOKEN || '';
const ALLOWED_ORIGINS = new Set((process.env.ALLOWED_ORIGINS || 'http://localhost:8787,http://127.0.0.1:8787').split(',').map(x => x.trim()).filter(Boolean));
const DATA_FILE = process.env.SUBSCRIPTIONS_FILE || path.join(process.cwd(), 'subscriptions.json');
const MAX_BODY = 64 * 1024;
const rateBuckets = new Map();

if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) {
  console.error('Missing VAPID_PUBLIC_KEY or VAPID_PRIVATE_KEY. Generate keys with: npm run vapid');
  process.exit(1);
}
if (!ADMIN_TOKEN || ADMIN_TOKEN.length < 24) {
  console.error('Set PUSH_ADMIN_TOKEN to a long random secret (at least 24 characters).');
  process.exit(1);
}
webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);

function readSubscriptions() {
  try { const value = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')); return Array.isArray(value) ? value : []; }
  catch (err) { if (err.code !== 'ENOENT') console.error('Subscription store read failed:', err.message); return []; }
}
function writeSubscriptions(value) {
  const temp = `${DATA_FILE}.${process.pid}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(value, null, 2), { mode: 0o600 });
  fs.renameSync(temp, DATA_FILE);
}
function sendJson(res, status, value) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  res.end(JSON.stringify(value));
}
function isAllowedOrigin(origin) { return !!origin && ALLOWED_ORIGINS.has(origin); }
function setCors(req, res) {
  const origin = req.headers.origin;
  if (origin && isAllowedOrigin(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  }
}
function limited(req) {
  const key = req.socket.remoteAddress || 'unknown';
  const now = Date.now(); const bucket = rateBuckets.get(key) || { start: now, count: 0 };
  if (now - bucket.start > 60_000) { bucket.start = now; bucket.count = 0; }
  bucket.count++; rateBuckets.set(key, bucket);
  return bucket.count > 60;
}
async function readJson(req) {
  let body = ''; for await (const chunk of req) { body += chunk; if (body.length > MAX_BODY) throw Object.assign(new Error('Request body too large.'), { status: 413 }); }
  try { return JSON.parse(body || '{}'); } catch { throw Object.assign(new Error('Invalid JSON.'), { status: 400 }); }
}
function sameOriginPayloadUrl(value) {
  if (!value) return './';
  try { const parsed = new URL(value, 'https://bosompem.invalid'); return parsed.origin === 'https://bosompem.invalid' ? `${parsed.pathname}${parsed.search}${parsed.hash}` : './'; }
  catch { return './'; }
}
function authorized(req) {
  const auth = req.headers.authorization || '';
  const supplied = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  return crypto.timingSafeEqual(Buffer.from(supplied.padEnd(ADMIN_TOKEN.length, '\0').slice(0, ADMIN_TOKEN.length)), Buffer.from(ADMIN_TOKEN));
}

const server = http.createServer(async (req, res) => {
  setCors(req, res);
  if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }
  if (limited(req)) return sendJson(res, 429, { error: 'Too many requests. Try again shortly.' });
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  if (req.method === 'GET' && url.pathname === '/health') return sendJson(res, 200, { ok: true, service: 'bosompem-web-push' });
  if (req.method === 'GET' && url.pathname === '/api/config') return sendJson(res, 200, { vapidPublicKey: VAPID_PUBLIC_KEY });
  if (req.headers.origin && !isAllowedOrigin(req.headers.origin)) return sendJson(res, 403, { error: 'Origin is not allowlisted.' });
  try {
    if (req.method === 'POST' && url.pathname === '/api/subscribe') {
      const body = await readJson(req); const sub = body.subscription;
      if (!sub || typeof sub.endpoint !== 'string' || !sub.endpoint.startsWith('https://') || !sub.keys?.p256dh || !sub.keys?.auth) return sendJson(res, 400, { error: 'A valid Web Push subscription is required.' });
      const subscriptions = readSubscriptions();
      const next = subscriptions.filter(item => item.endpoint !== sub.endpoint);
      next.push({ ...sub, createdAt: new Date().toISOString(), origin: String(body.origin || req.headers.origin || '') });
      writeSubscriptions(next);
      return sendJson(res, 201, { ok: true, subscriptions: next.length });
    }
    if (req.method === 'POST' && url.pathname === '/api/unsubscribe') {
      const body = await readJson(req); if (typeof body.endpoint !== 'string') return sendJson(res, 400, { error: 'Subscription endpoint is required.' });
      const next = readSubscriptions().filter(item => item.endpoint !== body.endpoint); writeSubscriptions(next);
      return sendJson(res, 200, { ok: true, subscriptions: next.length });
    }
    if (req.method === 'POST' && url.pathname === '/api/send') {
      if (!authorized(req)) return sendJson(res, 401, { error: 'Admin authorization required.' });
      const body = await readJson(req);
      const payload = JSON.stringify({ title: String(body.title || 'Bosompem').slice(0, 100), body: String(body.body || 'You have an update.').slice(0, 500), url: sameOriginPayloadUrl(body.url), tag: String(body.tag || `bosompem-${Date.now()}`).slice(0, 100) });
      const subscriptions = readSubscriptions(); let sent = 0; let failed = 0; const expired = new Set();
      await Promise.all(subscriptions.map(async sub => {
        try { await webpush.sendNotification(sub, payload, { TTL: 60 * 60, urgency: 'normal' }); sent++; }
        catch (err) { failed++; if (err.statusCode === 404 || err.statusCode === 410) expired.add(sub.endpoint); console.warn('Push delivery failed:', err.statusCode || err.message); }
      }));
      if (expired.size) writeSubscriptions(readSubscriptions().filter(sub => !expired.has(sub.endpoint)));
      return sendJson(res, 200, { ok: true, sent, failed, removedExpired: expired.size });
    }
    return sendJson(res, 404, { error: 'Not found.' });
  } catch (err) { return sendJson(res, err.status || 500, { error: err.status ? err.message : 'Server error.' }); }
});
server.listen(PORT, '0.0.0.0', () => console.log(`Bosompem Web Push server listening on ${PORT}`));
