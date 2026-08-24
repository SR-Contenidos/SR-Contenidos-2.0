const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const ROOT = __dirname;
const PUBLIC = path.join(ROOT, 'public');
const PORT = Number(process.env.PORT || 3000);
const NODE_ENV = process.env.NODE_ENV || 'development';
const SUPABASE_URL = String(process.env.SUPABASE_URL || '').replace(/\/$/, '');
const SUPABASE_PUBLISHABLE_KEY = String(process.env.SUPABASE_PUBLISHABLE_KEY || '');
const SUPABASE_SERVICE_ROLE_KEY = String(process.env.SUPABASE_SERVICE_ROLE_KEY || '');
const ADMIN_EMAIL = String(process.env.ADMIN_EMAIL || '').trim().toLowerCase();
const ADMIN_PASSWORD = String(process.env.ADMIN_PASSWORD || '');
const COOKIE_NAME = 'sr20_access';

try {
  if (typeof process.loadEnvFile === 'function') process.loadEnvFile(path.join(ROOT, '.env'));
  else {
    const envFile = path.join(ROOT, '.env');
    if (fs.existsSync(envFile)) {
      for (const line of fs.readFileSync(envFile, 'utf8').split(/\r?\n/)) {
        const t = line.trim(); if (!t || t.startsWith('#')) continue;
        const i = t.indexOf('='); if (i < 1) continue;
        const k = t.slice(0, i).trim(); let v = t.slice(i + 1).trim();
        if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
        if (!(k in process.env)) process.env[k] = v;
      }
    }
  }
} catch (e) { console.warn('No se pudo leer .env:', e.message); }

const config = {
  url: String(process.env.SUPABASE_URL || SUPABASE_URL).replace(/\/$/, ''),
  publishableKey: String(process.env.SUPABASE_PUBLISHABLE_KEY || SUPABASE_PUBLISHABLE_KEY),
  serviceRoleKey: String(process.env.SUPABASE_SERVICE_ROLE_KEY || SUPABASE_SERVICE_ROLE_KEY),
  adminEmail: String(process.env.ADMIN_EMAIL || ADMIN_EMAIL).trim().toLowerCase(),
  adminPassword: String(process.env.ADMIN_PASSWORD || ADMIN_PASSWORD)
};

function headers(extra = {}) {
  return {
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
    ...extra
  };
}
function json(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, { ...headers(), 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(body);
}
function parseJson(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', c => { raw += c; if (raw.length > 2_000_000) req.destroy(); });
    req.on('end', () => { try { resolve(raw ? JSON.parse(raw) : {}); } catch (e) { reject(e); } });
    req.on('error', reject);
  });
}
function authToken(req) {
  const h = String(req.headers.authorization || '');
  return h.startsWith('Bearer ') ? h.slice(7) : '';
}
async function sbFetch(url, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally { clearTimeout(timer); }
}
async function validateAdmin(token) {
  if (!config.url || !config.publishableKey || !token) throw new Error('Sesión inválida.');
  const userRes = await sbFetch(`${config.url}/auth/v1/user`, { headers: { apikey: config.publishableKey, Authorization: `Bearer ${token}` } });
  const user = await userRes.json().catch(() => ({}));
  if (!userRes.ok || !user.id) throw new Error('La sesión expiró. Volvé a iniciar sesión.');
  const pRes = await sbFetch(`${config.url}/rest/v1/sr20_profiles?select=id,role&id=eq.${encodeURIComponent(user.id)}&limit=1`, { headers: { apikey: config.publishableKey, Authorization: `Bearer ${token}` } });
  const rows = await pRes.json().catch(() => []);
  if (!pRes.ok || rows[0]?.role !== 'admin') throw new Error('Solo un administrador puede realizar esta acción.');
  return user;
}
async function ensureAdmin() {
  if (!config.serviceRoleKey || !config.url || !config.adminEmail || !config.adminPassword) return;
  if (config.adminPassword.length < 10) return;
  const h = { apikey: config.serviceRoleKey, Authorization: `Bearer ${config.serviceRoleKey}`, 'Content-Type': 'application/json' };
  try {
    let user = null;
    const list = await sbFetch(`${config.url}/auth/v1/admin/users?per_page=1000`, { headers: h });
    const data = await list.json().catch(() => ({}));
    user = (data.users || []).find(u => String(u.email || '').toLowerCase() === config.adminEmail) || null;
    if (!user) {
      const create = await sbFetch(`${config.url}/auth/v1/admin/users`, { method: 'POST', headers: h, body: JSON.stringify({ email: config.adminEmail, password: config.adminPassword, email_confirm: true, user_metadata: { name: 'Administrador' } }) });
      const d = await create.json().catch(() => ({}));
      if (!create.ok) throw new Error(d.message || 'No se pudo crear el administrador');
      user = d.user || d;
    } else {
      // If the admin already existed (for example from the previous app),
      // synchronize its password with the ADMIN_PASSWORD configured in Render.
      const update = await sbFetch(`${config.url}/auth/v1/admin/users/${encodeURIComponent(user.id)}`, {
        method: 'PUT',
        headers: h,
        body: JSON.stringify({ password: config.adminPassword, email_confirm: true, user_metadata: { ...(user.user_metadata || {}), name: 'Administrador' } })
      });
      const d = await update.json().catch(() => ({}));
      if (!update.ok) throw new Error(d.message || 'No se pudo actualizar la contraseña del administrador');
      user = d.user || d || user;
    }
    if (!user?.id) return;
    const profile = await sbFetch(`${config.url}/rest/v1/sr20_profiles?on_conflict=id`, { method: 'POST', headers: { ...h, Prefer: 'resolution=merge-duplicates,return=minimal' }, body: JSON.stringify({ id: user.id, name: 'Administrador', email: config.adminEmail, role: 'admin', client_id: null }) });
    if (!profile.ok) console.warn('No se pudo asegurar el perfil admin:', await profile.text());
    console.log('SR Contenidos 2.0: administrador verificado.');
  } catch (e) {
    console.warn('No se pudo verificar/crear administrador automáticamente:', e.message);
  }
}
function safeStatic(pathname) {
  const decoded = decodeURIComponent(pathname === '/' ? '/index.html' : pathname);
  const full = path.normalize(path.join(PUBLIC, decoded));
  if (!full.startsWith(PUBLIC)) return null;
  return full;
}
async function createClientAccess(req, res) {
  const token = authToken(req);
  await validateAdmin(token);
  if (!config.serviceRoleKey) return json(res, 500, { error: 'Falta SUPABASE_SERVICE_ROLE_KEY en el servidor.' });
  const b = await parseJson(req);
  const clientId = String(b.clientId || '').trim();
  const email = String(b.email || '').trim().toLowerCase();
  const password = String(b.password || '');
  const name = String(b.name || 'Cliente').trim();
  if (!clientId || !email || password.length < 6) return json(res, 400, { error: 'Cliente, correo y contraseña (mínimo 6 caracteres) son obligatorios.' });
  const h = { apikey: config.serviceRoleKey, Authorization: `Bearer ${config.serviceRoleKey}`, 'Content-Type': 'application/json' };
  const existing = await sbFetch(`${config.url}/rest/v1/sr20_clients?select=id,name&id=eq.${encodeURIComponent(clientId)}&limit=1`, { headers: h });
  const crows = await existing.json().catch(() => []);
  if (!existing.ok || !crows[0]) return json(res, 404, { error: 'Cliente no encontrado.' });
  const created = await sbFetch(`${config.url}/auth/v1/admin/users`, { method: 'POST', headers: h, body: JSON.stringify({ email, password, email_confirm: true, user_metadata: { name, client_id: clientId, role: 'client' } }) });
  const d = await created.json().catch(() => ({}));
  if (!created.ok) return json(res, 409, { error: d.message || d.msg || 'No se pudo crear el acceso. El correo puede ya estar registrado.' });
  const user = d.user || d;
  const p = await sbFetch(`${config.url}/rest/v1/sr20_profiles?on_conflict=id`, { method: 'POST', headers: { ...h, Prefer: 'resolution=merge-duplicates,return=minimal' }, body: JSON.stringify({ id: user.id, name, email, role: 'client', client_id: clientId }) });
  if (!p.ok) {
    await sbFetch(`${config.url}/auth/v1/admin/users/${encodeURIComponent(user.id)}`, { method: 'DELETE', headers: h }).catch(() => {});
    return json(res, 500, { error: 'Se creó el acceso pero no se pudo crear el perfil del cliente. No se dejó el usuario huérfano.' });
  }
  return json(res, 201, { ok: true, id: user.id, email });
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    if (req.method === 'GET' && url.pathname === '/healthz') return json(res, 200, { ok: true, app: 'SR Contenidos 2.0' });
    if (req.method === 'GET' && url.pathname === '/config.js') {
      const body = `window.SR_CONFIG=${JSON.stringify({ url: config.url, publishableKey: config.publishableKey })};`;
      res.writeHead(200, { ...headers(), 'Content-Type': 'text/javascript; charset=utf-8', 'Cache-Control': 'no-store' });
      return res.end(body);
    }
    if (url.pathname === '/api/client-access' && req.method === 'POST') return await createClientAccess(req, res);
    if (url.pathname.startsWith('/api/')) return json(res, 404, { error: 'Ruta API no encontrada' });
    let file = safeStatic(url.pathname);
    if (!file || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
      // SPA fallback: Supabase password-recovery redirects may use /reset-password.
      // Serve index.html so the browser-side Supabase client can process the recovery session.
      file = path.join(PUBLIC, 'index.html');
    }
    const ext = path.extname(file);
    const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.json': 'application/json' };
    res.writeHead(200, { ...headers(), 'Content-Type': types[ext] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    fs.createReadStream(file).pipe(res);
  } catch (e) {
    console.error(e);
    json(res, 500, { error: e.message || 'Error interno' });
  }
});

ensureAdmin().finally(() => server.listen(PORT, '0.0.0.0', () => console.log(`SR Contenidos 2.0: http://localhost:${PORT}`)));
