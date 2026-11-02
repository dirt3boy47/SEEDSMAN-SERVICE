// Seedsman — Cloudflare Worker: serves the site (public/) and the staff API at /api/.
// Data: D1 database `seedsmans` (customers → properties → site_drawings; quotes + quote_revisions; jobs; rate_library).
// Sign-in: staff accounts in `user`/`account` (PBKDF2 password hashes), sessions in `session` (only token hashes stored).
import '../public/app/js/pricing.js';

const Pricing = globalThis.SeedsmanPricing;
const PBKDF2_ITER = 100000, SESSION_DAYS = 30, MAX_LOGIN_FAILS = 10, LOCK_MS = 10 * 60 * 1000;
const STATUSES = ['Draft', 'Sent', 'Accepted', 'Declined'];
const JOB_STATUSES = ['Scheduled', 'In progress', 'Completed', 'Cancelled'];

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (!url.pathname.startsWith('/api/')) return env.ASSETS.fetch(request);
    try {
      return await api(request, env, url);
    } catch (e) {
      if (e instanceof HttpError) return json({ error: e.message }, e.status);
      if (/Crew overlap/.test(String(e && e.message))) return json({ error: 'That crew already has a job booked at that time.' }, 409);
      return json({ error: 'Server error: ' + (e && e.message ? e.message : String(e)) }, 500);
    }
  }
};

class HttpError extends Error { constructor(status, message) { super(message); this.status = status; } }
const fail = (status, message) => { throw new HttpError(status, message); };
function json(body, status) { return new Response(JSON.stringify(body), { status: status || 200, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } }); }
function hexOf(buf) { return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join(''); }
function randHex(n) { const a = new Uint8Array(n); crypto.getRandomValues(a); return hexOf(a); }
function newId(prefix) { return prefix + '_' + randHex(10); }
async function sha256(text) { return hexOf(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))); }
async function pbkdf2(password, salt, iter) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  return hexOf(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: new TextEncoder().encode(salt), iterations: iter }, key, 256));
}
async function makePassword(pw) { const salt = randHex(16); return 'pbkdf2$' + PBKDF2_ITER + '$' + salt + '$' + (await pbkdf2(pw, salt, PBKDF2_ITER)); }
async function checkPassword(pw, stored) {
  const p = String(stored || '').split('$');
  if (p.length !== 4 || p[0] !== 'pbkdf2') return false;
  const h = await pbkdf2(pw, p[2], +p[1]);
  if (h.length !== p[3].length) return false;
  let d = 0; for (let i = 0; i < h.length; i++) d |= h.charCodeAt(i) ^ p[3].charCodeAt(i);
  return d === 0;
}
const str = (v, max) => String(v == null ? '' : v).trim().slice(0, max || 200);
const numOrNull = (v) => { const n = parseFloat(v); return isFinite(n) ? n : null; };
const ipOf = (request) => request.headers.get('CF-Connecting-IP') || 'unknown';
const parseJson = (s, d) => { try { return s == null ? d : JSON.parse(s); } catch (e) { return d; } };
const LOCAL_DT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;

async function audit(env, me, type, id, action, snapshot) {
  await env.DB.prepare('INSERT INTO audit_log (id, actor_id, entity_type, entity_id, action, snapshot) VALUES (?, ?, ?, ?, ?, ?)')
    .bind(newId('aud'), me ? me.id : null, type, id, action, JSON.stringify(snapshot || {})).run();
}

// ---------------- sessions ----------------
async function userOf(request, env) {
  const m = /^Bearer ([0-9a-f]{64})$/.exec(request.headers.get('Authorization') || '');
  if (!m) return null;
  const row = await env.DB.prepare('SELECT s.id AS sid, s.expiresAt, u.id, u.name, u.email, u.role FROM session s JOIN user u ON u.id = s.userId WHERE s.token = ?')
    .bind(await sha256('seedsman-session:' + m[1])).first();
  if (!row || row.expiresAt < Date.now()) return null;
  return { id: row.id, name: row.name, email: row.email, role: row.role, sid: row.sid };
}
async function newSession(env, request, uid) {
  const token = randHex(32), now = Date.now();
  await env.DB.prepare('INSERT INTO session (id, expiresAt, token, createdAt, updatedAt, ipAddress, userAgent, userId) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .bind(newId('ses'), now + SESSION_DAYS * 86400000, await sha256('seedsman-session:' + token), now, now, ipOf(request), str(request.headers.get('User-Agent'), 200), uid).run();
  return token;
}
async function loginLimit(env, request) {
  const key = 'login:' + ipOf(request), now = Date.now();
  const row = await env.DB.prepare('SELECT count, expires FROM request_limits WHERE key = ?').bind(key).first();
  const count = row && row.expires > now ? row.count : 0;
  return {
    over: count >= MAX_LOGIN_FAILS,
    fail: () => env.DB.prepare('INSERT INTO request_limits (key, count, expires) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET count = excluded.count, expires = excluded.expires')
      .bind(key, count + 1, row && row.expires > now ? row.expires : now + LOCK_MS).run()
  };
}
const publicUser = (u) => ({ id: u.id, name: u.name, email: u.email, role: u.role });
const isAdmin = (me) => me.role === 'admin' || me.role === 'owner';

// ---------------- settings and rates ----------------
async function business(env) {
  const row = await env.DB.prepare("SELECT value FROM business_settings WHERE id = 'business'").first();
  return row ? parseJson(row.value, {}) : {};
}
/** Business settings as sent to staff browsers: the Google routing key stays on the server. */
function clientBusiness(b) {
  const out = Object.assign({}, b);
  if (b.routing) out.routing = { provider: b.routing.googleKey ? 'google' : 'osrm', hasGoogleKey: !!b.routing.googleKey };
  return out;
}
async function activeRates(env) {
  const row = await env.DB.prepare('SELECT id, snapshot, approval_status FROM rate_library WHERE active = 1 ORDER BY effective_date DESC, created_at DESC LIMIT 1').first();
  const r = Pricing.normalise(row ? parseJson(row.snapshot, {}) : {});
  r.version = row ? row.id : 'DEFAULT';
  r.approval = row ? row.approval_status : 'default';
  return r;
}

// ---------------- the API ----------------
async function api(request, env, url) {
  const parts = url.pathname.split('/').filter(Boolean).slice(1);
  const m = request.method;
  const body = m === 'POST' || m === 'PUT' ? await request.json().catch(() => ({})) : {};

  if (parts[0] === 'auth' && parts[1] === 'login' && m === 'POST') {
    const lim = await loginLimit(env, request);
    if (lim.over) fail(429, 'Too many wrong sign-ins from this connection. Wait 10 minutes and try again.');
    const u = await env.DB.prepare('SELECT * FROM user WHERE email = ?').bind(str(body.email).toLowerCase()).first();
    const acc = u ? await env.DB.prepare("SELECT password FROM account WHERE userId = ? AND providerId = 'credential'").bind(u.id).first() : null;
    if (!u || !acc || !(await checkPassword(String(body.password || ''), acc.password))) { await lim.fail(); fail(401, 'That email and password don’t match.'); }
    return json({ token: await newSession(env, request, u.id), user: publicUser(u) });
  }

  if (parts[0] === 'public') return publicApi(request, env, parts, url, m, body);

  const me = await userOf(request, env);
  if (!me) fail(401, 'Please sign in.');
  const id = parts[1];

  switch (parts[0]) {
    case 'auth':
      if (parts[1] === 'logout' && m === 'POST') { await env.DB.prepare('DELETE FROM session WHERE id = ?').bind(me.sid).run(); return json({ ok: true }); }
      break;
    case 'me':
      if (!id && m === 'GET') return json({ user: publicUser(me), business: clientBusiness(await business(env)), rates: await activeRates(env) });
      if (id === 'password' && m === 'POST') return changePassword(env, me, body);
      break;
    case 'business': if (m === 'PUT') return saveBusiness(env, me, body); break;
    case 'rates': return ratesApi(env, me, m, body);
    case 'users': return usersApi(env, me, m, body);
    case 'dashboard': if (m === 'GET') return dashboard(env); break;
    case 'reports': if (m === 'GET') return reports(env, url); break;
    case 'customers': return customersApi(env, me, m, parts, url, body);
    case 'properties': return propertiesApi(env, me, m, parts, url, body);
    case 'drawings': return drawingsApi(env, me, m, parts, body);
    case 'quotes': return quotesApi(env, me, m, parts, url, body);
    case 'jobs': return jobsApi(env, me, m, parts, url, body);
    case 'schedule': return scheduleApi(env, me, m, parts, url, body);
    case 'route': if (m === 'POST') return routeApi(env, body); break;
  }
  fail(404, 'Not found.');
}

async function changePassword(env, me, body) {
  const acc = await env.DB.prepare("SELECT password FROM account WHERE userId = ? AND providerId = 'credential'").bind(me.id).first();
  if (!acc || !(await checkPassword(String(body.current || ''), acc.password))) fail(401, 'Your current password is not right.');
  if (String(body.password || '').length < 8) fail(400, 'Use a new password of at least 8 characters.');
  await env.DB.batch([
    env.DB.prepare("UPDATE account SET password = ?, updatedAt = ? WHERE userId = ? AND providerId = 'credential'").bind(await makePassword(String(body.password)), Date.now(), me.id),
    env.DB.prepare('DELETE FROM session WHERE userId = ? AND id != ?').bind(me.id, me.sid)
  ]);
  return json({ ok: true });
}
async function saveBusiness(env, me, body) {
  if (!isAdmin(me)) fail(403, 'Only an admin can change the business details.');
  const cur = await business(env);
  ['name', 'tradingName', 'phone', 'email', 'abn', 'address', 'website'].forEach((k) => { if (body[k] != null) cur[k] = str(body[k], 200); });
  ['terms', 'paymentTerms'].forEach((k) => { if (body[k] != null) cur[k] = str(body[k], 4000); });
  if (body.quoteValidityDays != null) cur.quoteValidityDays = Math.max(1, Math.min(365, parseInt(body.quoteValidityDays, 10) || 30));
  if (body.mapStart && isFinite(body.mapStart.lat) && isFinite(body.mapStart.lng)) cur.mapStart = { lat: +body.mapStart.lat, lng: +body.mapStart.lng, zoom: +body.mapStart.zoom || 15 };
  if (body.imagery && typeof body.imagery === 'object') {
    const im = cur.imagery || {};
    ['nearmapKey', 'metromapKey'].forEach((k) => { if (body.imagery[k] != null) im[k] = str(body.imagery[k], 200).replace(/\s+/g, ''); });
    if (body.imagery.metromapLayer != null) im.metromapLayer = str(body.imagery.metromapLayer, 80) || 'Australia_latest';
    if (body.imagery.default != null) im.default = ['nearmap', 'metromap', 'clarity', 'world', 'vic', 'street'].indexOf(body.imagery.default) >= 0 ? body.imagery.default : '';
    cur.imagery = im;
  }
  if (body.routing && typeof body.routing === 'object' && body.routing.googleKey != null) {
    cur.routing = Object.assign({}, cur.routing, { googleKey: str(body.routing.googleKey, 200).replace(/\s+/g, '') });
  }
  if (body.depot && isFinite(body.depot.lat) && isFinite(body.depot.lng)) cur.depot = { lat: +body.depot.lat, lng: +body.depot.lng, address: str(body.depot.address, 200) };
  await env.DB.prepare("INSERT INTO business_settings (id, value, updated_at) VALUES ('business', ?, datetime('now')) ON CONFLICT(id) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at").bind(JSON.stringify(cur)).run();
  await audit(env, me, 'business', 'business', 'update', cur);
  return json({ business: clientBusiness(cur) });
}
async function ratesApi(env, me, m, body) {
  if (m === 'GET') {
    const hist = (await env.DB.prepare('SELECT id, effective_date, active, approval_status, created_at FROM rate_library ORDER BY created_at DESC LIMIT 30').all()).results;
    return json({ rates: await activeRates(env), history: hist });
  }
  if (m !== 'POST') fail(404, 'Not found.');
  if (!isAdmin(me)) fail(403, 'Only an admin can change the rates.');
  const snap = Pricing.normalise(body.rates || {});
  snap.services = snap.services.map((s) => Object.assign({}, s, { id: str(s.id, 40) || newId('svc'), name: str(s.name, 80) || 'Service', description: str(s.description, 400) }));
  delete snap.approval;
  const today = new Date().toISOString().slice(0, 10), rid = 'RATES-' + today + '-' + randHex(2).toUpperCase();
  snap.version = rid; snap.effectiveDate = today;
  await env.DB.batch([
    env.DB.prepare('UPDATE rate_library SET active = 0 WHERE active = 1'),
    env.DB.prepare("INSERT INTO rate_library (id, effective_date, active, approval_status, snapshot, created_by) VALUES (?, ?, 1, 'approved', ?, ?)").bind(rid, today, JSON.stringify(snap), me.id)
  ]);
  await audit(env, me, 'rates', rid, 'create', { version: rid });
  return json({ rates: await activeRates(env) });
}
async function usersApi(env, me, m, body) {
  if (!isAdmin(me)) fail(403, 'Only an admin can manage staff logins.');
  if (m === 'GET') return json({ users: (await env.DB.prepare('SELECT id, name, email, role FROM user ORDER BY createdAt').all()).results });
  if (m !== 'POST') fail(404, 'Not found.');
  const email = str(body.email).toLowerCase(), name = str(body.name, 80), role = body.role === 'admin' ? 'admin' : 'field', pw = String(body.password || '');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) fail(400, 'Type a valid email address.');
  if (!name) fail(400, 'Type their name.');
  if (pw.length < 8) fail(400, 'Give them a password of at least 8 characters.');
  if (await env.DB.prepare('SELECT 1 AS x FROM user WHERE email = ?').bind(email).first()) fail(409, 'There is already a login with that email.');
  const uid = newId('usr'), now = Date.now();
  await env.DB.batch([
    env.DB.prepare('INSERT INTO user (id, name, email, emailVerified, createdAt, updatedAt, role) VALUES (?, ?, ?, 0, ?, ?, ?)').bind(uid, name, email, now, now, role),
    env.DB.prepare("INSERT INTO account (id, accountId, providerId, userId, password, createdAt, updatedAt) VALUES (?, ?, 'credential', ?, ?, ?, ?)").bind(newId('acc'), uid, uid, await makePassword(pw), now, now)
  ]);
  await audit(env, me, 'user', uid, 'create', { email, name, role });
  return json({ user: { id: uid, name, email, role } });
}

// ---------------- dashboard and reports ----------------
const QUOTE_LIST = "SELECT q.id, q.number, q.status, q.revision, q.created_at, q.updated_at, q.valid_until, q.customer_id, q.property_id, " +
  "json_extract(q.calculation, '$.total') AS total, json_extract(q.calculation, '$.exGst') AS ex_gst, json_extract(q.calculation, '$.margin') AS margin, " +
  "c.name AS customer, p.address, p.suburb, (SELECT j.id FROM jobs j WHERE j.quote_id = q.id AND j.status != 'Cancelled') AS job_id, " +
  "coalesce((SELECT group_concat(DISTINCT json_extract(l.value, '$.serviceName')) FROM json_each(q.calculation, '$.lines') l), 'Hedge trimming') AS services " +
  "FROM quotes q JOIN customers c ON c.id = q.customer_id JOIN properties p ON p.id = q.property_id";
const JOB_LIST = "SELECT j.*, c.name AS customer, c.phone, p.address, p.suburb, p.lat, p.lng, q.number AS quote_number, json_extract(q.calculation, '$.total') AS total, " +
  "coalesce(j.man_hours, json_extract(q.calculation, '$.personHours')) AS work_hours, coalesce(j.men, json_extract(q.calculation, '$.crew'), 2) AS crew_size, " +
  "(SELECT group_concat(DISTINCT json_extract(l.value, '$.serviceName')) FROM json_each(q.calculation, '$.lines') l) AS services " +
  "FROM jobs j JOIN customers c ON c.id = j.customer_id JOIN properties p ON p.id = j.property_id JOIN quotes q ON q.id = j.quote_id";

async function dashboard(env) {
  const month = new Date().toISOString().slice(0, 7);
  const today = new Date(Date.now() + 10 * 3600000).toISOString().slice(0, 10); // Melbourne-ish date
  const week = new Date(Date.now() + 10 * 3600000 + 7 * 86400000).toISOString().slice(0, 10);
  const k = await env.DB.prepare(
    "SELECT (SELECT count(*) FROM quotes WHERE status IN ('Draft','Sent')) AS open_count, " +
    "(SELECT coalesce(sum(json_extract(calculation, '$.total')), 0) FROM quotes WHERE status IN ('Draft','Sent')) AS open_value, " +
    "(SELECT coalesce(sum(json_extract(calculation, '$.total')), 0) FROM quotes WHERE status = 'Accepted' AND substr(updated_at, 1, 7) = ?1) AS won_month, " +
    "(SELECT count(*) FROM quotes WHERE created_at >= datetime('now', '-90 days')) AS q90, " +
    "(SELECT count(*) FROM quotes WHERE status = 'Accepted' AND created_at >= datetime('now', '-90 days')) AS a90, " +
    "(SELECT count(*) FROM jobs WHERE status IN ('Scheduled','In progress') AND substr(start, 1, 10) BETWEEN ?2 AND ?3) AS jobs_week, " +
    "(SELECT count(*) FROM customers WHERE deleted_at IS NULL) AS customers").bind(month, today, week).first();
  const recent = (await env.DB.prepare(QUOTE_LIST + ' ORDER BY q.updated_at DESC LIMIT 6').all()).results;
  const follow = (await env.DB.prepare(QUOTE_LIST + " WHERE q.status = 'Sent' AND q.updated_at <= datetime('now', '-7 days') ORDER BY q.updated_at LIMIT 6").all()).results;
  const toSchedule = (await env.DB.prepare(QUOTE_LIST + " WHERE q.status = 'Accepted' AND NOT EXISTS (SELECT 1 FROM jobs j WHERE j.quote_id = q.id AND j.status != 'Cancelled') ORDER BY q.updated_at LIMIT 6").all()).results;
  const jobs = (await env.DB.prepare(JOB_LIST + " WHERE j.status IN ('Scheduled','In progress') AND substr(j.start, 1, 10) >= ? ORDER BY j.start LIMIT 6").bind(today).all()).results;
  return json({ kpis: k, recent, follow, toSchedule, jobs });
}

async function reports(env, url) {
  const months = Math.max(3, Math.min(24, parseInt(url.searchParams.get('months'), 10) || 12));
  const rows = (await env.DB.prepare("SELECT q.status, q.created_at, q.updated_at, q.calculation, p.suburb FROM quotes q JOIN properties p ON p.id = q.property_id WHERE q.created_at >= date('now', 'start of month', ?) ").bind('-' + (months - 1) + ' months').all()).results;
  const byMonth = {}, byService = {}, bySuburb = {}, byStatus = { Draft: 0, Sent: 0, Accepted: 0, Declined: 0 };
  const now = new Date();
  for (let i = months - 1; i >= 0; i--) { const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1)); byMonth[d.toISOString().slice(0, 7)] = { quoted: 0, won: 0, count: 0, wonCount: 0 }; }
  let quoted = 0, won = 0, wonCount = 0, decided = 0, profit = 0, wonEx = 0;
  rows.forEach((r) => {
    const c = parseJson(r.calculation, {}), total = +c.total || 0, mo = byMonth[r.created_at.slice(0, 7)];
    byStatus[r.status] = (byStatus[r.status] || 0) + 1;
    quoted += total;
    if (mo) { mo.quoted += total; mo.count++; }
    if (r.status === 'Accepted') { won += total; wonCount++; if (mo) { mo.won += total; mo.wonCount++; } profit += +c.profit || 0; wonEx += +c.exGst || 0; }
    if (r.status === 'Accepted' || r.status === 'Declined') decided++;
    (c.lines || []).forEach((l) => {
      const name = l.serviceName || (l.tier ? 'Hedge trimming' : 'Other'); // quotes from before services carry no name
      const s = byService[name] || (byService[name] = { quoted: 0, won: 0, qty: 0, unit: l.unit || 'm²', count: 0 });
      s.quoted += +l.sell || 0; s.qty += +(l.qty != null ? l.qty : l.area) || 0; s.count++;
      if (r.status === 'Accepted') s.won += +l.sell || 0;
    });
    const sb = r.suburb || 'Unknown'; bySuburb[sb] = bySuburb[sb] || { count: 0, value: 0 }; bySuburb[sb].count++; bySuburb[sb].value += total;
  });
  return json({
    months: Object.keys(byMonth).map((k2) => Object.assign({ month: k2 }, byMonth[k2])),
    totals: { count: rows.length, quoted, won, wonCount, winRate: decided ? wonCount / decided : null, average: rows.length ? quoted / rows.length : 0, wonMargin: wonEx ? profit / wonEx : null },
    byStatus, services: Object.keys(byService).map((k2) => Object.assign({ name: k2 }, byService[k2])).sort((a, b) => b.quoted - a.quoted),
    suburbs: Object.keys(bySuburb).map((k2) => Object.assign({ name: k2 }, bySuburb[k2])).sort((a, b) => b.value - a.value).slice(0, 8)
  });
}

// ---------------- customers, properties, drawings ----------------
const SOURCES = ['Phone', 'Website', 'Referral', 'Repeat customer', 'Walk-in', 'Other'];
function customerFields(b) { return { name: str(b.name, 120), email: str(b.email, 160), phone: str(b.phone, 40), source: SOURCES.indexOf(b.source) >= 0 ? b.source : 'Phone', notes: str(b.notes, 4000) }; }
function propertyFields(b) { return { address: str(b.address, 200), suburb: str(b.suburb, 80), access: str(b.access, 1000), hazards: str(b.hazards, 1000), lat: numOrNull(b.lat), lng: numOrNull(b.lng), zoom: numOrNull(b.zoom) }; }
async function createCustomer(env, me, c) {
  if (!c.name) fail(400, 'Type the customer’s name.');
  const cid = newId('cus');
  await env.DB.prepare('INSERT INTO customers (id, name, email, phone, source, notes, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)').bind(cid, c.name, c.email, c.phone, c.source, c.notes, me.id).run();
  await audit(env, me, 'customer', cid, 'create', c);
  return cid;
}
async function createProperty(env, me, customerId, p) {
  if (!p.address) fail(400, 'Type the property address.');
  const pid = newId('prop');
  await env.DB.prepare('INSERT INTO properties (id, customer_id, address, suburb, access, hazards, lat, lng, zoom) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .bind(pid, customerId, p.address, p.suburb, p.access, p.hazards, p.lat, p.lng, p.zoom).run();
  await audit(env, me, 'property', pid, 'create', p);
  return pid;
}
async function updateProperty(env, pid, p, keepEmpty) {
  const sets = [], vals = [];
  Object.keys(p).forEach((k) => { if (p[k] === null || (p[k] === '' && keepEmpty)) return; sets.push(k + ' = ?'); vals.push(p[k]); });
  if (sets.length) await env.DB.prepare('UPDATE properties SET ' + sets.join(', ') + ", updated_at = datetime('now') WHERE id = ?").bind(...vals, pid).run();
}
function drawingOut(r) { return { id: r.id, property_id: r.property_id, name: r.name, kind: r.kind, geometry: parseJson(r.geometry, null), measure: parseJson(r.measure, {}), service: r.service, inputs: parseJson(r.inputs, null), color: r.color, notes: r.notes, quote_id: r.quote_id, updated_at: r.updated_at }; }
async function drawingsOf(env, pid) {
  return (await env.DB.prepare('SELECT * FROM site_drawings WHERE property_id = ? AND deleted_at IS NULL ORDER BY created_at, rowid').bind(pid).all()).results.map(drawingOut);
}
function cleanGeometry(g) {
  if (!g || !Array.isArray(g.coordinates)) return null;
  if (g.type === 'Point' && g.coordinates.length === 2) return g;
  if (g.type === 'LineString' && g.coordinates.length >= 2) return g;
  if (g.type === 'Polygon' && Array.isArray(g.coordinates[0]) && g.coordinates[0].length >= 4) return g;
  return null;
}
const kindOf = (g) => (g.type === 'Polygon' ? 'area' : g.type === 'Point' ? 'point' : 'line');
function cleanMeasure(mm) { mm = mm || {}; return { length: numOrNull(mm.length), area: numOrNull(mm.area), perimeter: numOrNull(mm.perimeter) }; }

async function customersApi(env, me, m, parts, url, body) {
  const cid = parts[1];
  if (!cid && m === 'GET') {
    const q = '%' + str(url.searchParams.get('q'), 80).replace(/[%_]/g, '') + '%';
    const rows = (await env.DB.prepare(
      "SELECT c.id, c.name, c.phone, c.email, c.source, c.updated_at, " +
      "(SELECT address || CASE WHEN suburb != '' THEN ', ' || suburb ELSE '' END FROM properties WHERE customer_id = c.id AND deleted_at IS NULL ORDER BY created_at LIMIT 1) AS address, " +
      "(SELECT count(*) FROM properties WHERE customer_id = c.id AND deleted_at IS NULL) AS properties, " +
      "(SELECT count(*) FROM quotes WHERE customer_id = c.id) AS quotes, " +
      "(SELECT coalesce(sum(json_extract(calculation, '$.total')), 0) FROM quotes WHERE customer_id = c.id AND status = 'Accepted') AS won " +
      "FROM customers c WHERE c.deleted_at IS NULL AND (c.name LIKE ?1 OR c.phone LIKE ?1 OR c.email LIKE ?1 OR EXISTS (SELECT 1 FROM properties p WHERE p.customer_id = c.id AND (p.address LIKE ?1 OR p.suburb LIKE ?1))) " +
      "ORDER BY c.updated_at DESC LIMIT 300").bind(q).all()).results;
    return json({ customers: rows });
  }
  if (!cid && m === 'POST') {
    const newCid = await createCustomer(env, me, customerFields(body));
    const pid = body.property && body.property.address ? await createProperty(env, me, newCid, propertyFields(body.property)) : null;
    return json({ id: newCid, propertyId: pid });
  }
  const c = await env.DB.prepare('SELECT * FROM customers WHERE id = ? AND deleted_at IS NULL').bind(cid).first();
  if (!c) fail(404, 'That customer was not found.');
  if (m === 'GET') {
    const props = (await env.DB.prepare('SELECT p.*, (SELECT count(*) FROM site_drawings d WHERE d.property_id = p.id AND d.deleted_at IS NULL) AS drawings FROM properties p WHERE p.customer_id = ? AND p.deleted_at IS NULL ORDER BY p.created_at').bind(cid).all()).results;
    const quotes = (await env.DB.prepare(QUOTE_LIST + ' WHERE q.customer_id = ? ORDER BY q.created_at DESC').bind(cid).all()).results;
    const jobs = (await env.DB.prepare(JOB_LIST + ' WHERE j.customer_id = ? ORDER BY j.start DESC').bind(cid).all()).results;
    return json({ customer: c, properties: props, quotes, jobs });
  }
  if (m === 'PUT') {
    const f = customerFields(Object.assign({}, c, body));
    if (!f.name) fail(400, 'The customer needs a name.');
    await env.DB.prepare("UPDATE customers SET name = ?, email = ?, phone = ?, source = ?, notes = ?, updated_at = datetime('now') WHERE id = ?").bind(f.name, f.email, f.phone, f.source, f.notes, cid).run();
    await audit(env, me, 'customer', cid, 'update', f);
    return json({ ok: true });
  }
  if (m === 'DELETE') {
    await env.DB.prepare("UPDATE customers SET deleted_at = datetime('now') WHERE id = ?").bind(cid).run();
    await audit(env, me, 'customer', cid, 'delete', {});
    return json({ ok: true });
  }
  fail(404, 'Not found.');
}

async function propertiesApi(env, me, m, parts, url, body) {
  const pid = parts[1];
  if (!pid && m === 'GET') {
    const q = '%' + str(url.searchParams.get('q'), 80).replace(/[%_]/g, '') + '%';
    const rows = (await env.DB.prepare(
      "SELECT p.id, p.address, p.suburb, p.lat, p.lng, p.updated_at, p.customer_id, c.name AS customer, c.phone, " +
      "(SELECT count(*) FROM site_drawings d WHERE d.property_id = p.id AND d.deleted_at IS NULL) AS drawings, " +
      "(SELECT count(*) FROM quotes WHERE property_id = p.id) AS quotes, " +
      "(SELECT status FROM quotes WHERE property_id = p.id ORDER BY updated_at DESC LIMIT 1) AS last_status, " +
      "(SELECT min(start) FROM jobs WHERE property_id = p.id AND status IN ('Scheduled','In progress') AND start >= strftime('%Y-%m-%dT%H:%M', 'now')) AS next_job " +
      "FROM properties p JOIN customers c ON c.id = p.customer_id WHERE p.deleted_at IS NULL AND c.deleted_at IS NULL AND (p.address LIKE ?1 OR p.suburb LIKE ?1 OR c.name LIKE ?1) ORDER BY p.updated_at DESC LIMIT 500").bind(q).all()).results;
    return json({ properties: rows });
  }
  if (!pid && m === 'POST') {
    const c = await env.DB.prepare('SELECT id FROM customers WHERE id = ? AND deleted_at IS NULL').bind(str(body.customer_id, 40)).first();
    if (!c) fail(404, 'That customer was not found.');
    return json({ id: await createProperty(env, me, c.id, propertyFields(body)) });
  }
  const p = await env.DB.prepare('SELECT * FROM properties WHERE id = ? AND deleted_at IS NULL').bind(pid).first();
  if (!p) fail(404, 'That property was not found.');
  if (m === 'GET') {
    const c = await env.DB.prepare('SELECT * FROM customers WHERE id = ?').bind(p.customer_id).first();
    const quotes = (await env.DB.prepare(QUOTE_LIST + ' WHERE q.property_id = ? ORDER BY q.created_at DESC').bind(pid).all()).results;
    const jobs = (await env.DB.prepare(JOB_LIST + ' WHERE j.property_id = ? ORDER BY j.start DESC').bind(pid).all()).results;
    return json({ property: p, customer: c, drawings: await drawingsOf(env, pid), quotes, jobs });
  }
  if (m === 'PUT') { await updateProperty(env, pid, propertyFields(Object.assign({}, p, body)), false); await audit(env, me, 'property', pid, 'update', body); return json({ ok: true }); }
  if (m === 'DELETE') { await env.DB.prepare("UPDATE properties SET deleted_at = datetime('now') WHERE id = ?").bind(pid).run(); return json({ ok: true }); }
  fail(404, 'Not found.');
}

async function drawingsApi(env, me, m, parts, body) {
  const did = parts[1];
  if (!did && m === 'POST') {
    const p = await env.DB.prepare('SELECT id FROM properties WHERE id = ? AND deleted_at IS NULL').bind(str(body.property_id, 40)).first();
    if (!p) fail(404, 'That property was not found.');
    const g = cleanGeometry(body.geometry); if (!g) fail(400, 'Draw the shape first.');
    const nid = newId('drw');
    await env.DB.prepare('INSERT INTO site_drawings (id, property_id, name, kind, geometry, measure, service, inputs, color, notes, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .bind(nid, p.id, str(body.name, 80) || 'Drawing', kindOf(g), JSON.stringify(g), JSON.stringify(cleanMeasure(body.measure)), str(body.service, 40) || null, body.inputs ? JSON.stringify(body.inputs) : null, str(body.color, 20) || null, str(body.notes, 1000), me.id).run();
    await env.DB.prepare("UPDATE properties SET updated_at = datetime('now') WHERE id = ?").bind(p.id).run();
    return json({ drawing: drawingOut(await env.DB.prepare('SELECT * FROM site_drawings WHERE id = ?').bind(nid).first()) });
  }
  const d = await env.DB.prepare('SELECT * FROM site_drawings WHERE id = ? AND deleted_at IS NULL').bind(did).first();
  if (!d) fail(404, 'That drawing was not found.');
  if (m === 'PUT') {
    const g = body.geometry ? cleanGeometry(body.geometry) : parseJson(d.geometry, null);
    if (!g) fail(400, 'That shape is not complete.');
    await env.DB.prepare("UPDATE site_drawings SET name = ?, kind = ?, geometry = ?, measure = ?, color = ?, notes = ?, updated_at = datetime('now') WHERE id = ?")
      .bind(body.name != null ? str(body.name, 80) || 'Drawing' : d.name, kindOf(g), JSON.stringify(g), body.measure ? JSON.stringify(cleanMeasure(body.measure)) : d.measure,
        body.color != null ? str(body.color, 20) : d.color, body.notes != null ? str(body.notes, 1000) : d.notes, did).run();
    return json({ drawing: drawingOut(await env.DB.prepare('SELECT * FROM site_drawings WHERE id = ?').bind(did).first()) });
  }
  if (m === 'DELETE') { await env.DB.prepare("UPDATE site_drawings SET deleted_at = datetime('now') WHERE id = ?").bind(did).run(); return json({ ok: true }); }
  fail(404, 'Not found.');
}

// ---------------- quotes ----------------
function cleanItem(raw) {
  const it = Pricing.normaliseItem(raw), inputs = {};
  Object.keys(it.inputs || {}).forEach((k) => {
    const v = it.inputs[k];
    if (k === 'faces') { inputs.faces = {}; Pricing.FACES.forEach((f) => { inputs.faces[f.id] = !!(v && v[f.id]); }); }
    else if (k === 'condition') inputs.condition = str(v, 40);
    else if (typeof v === 'number' || (typeof v === 'string' && v !== '' && isFinite(v))) inputs[k] = +v;
  });
  return { id: str(it.id, 40) || newId('itm'), service: str(it.service, 40), name: str(it.name, 120), description: str(it.description, 600), inputs,
    geometry: cleanGeometry(it.geometry), measure: cleanMeasure(raw && raw.measure), drawingId: str(it.drawingId, 40) || null,
    priceOverride: it.priceOverride, notes: str(it.notes, 600) };
}
async function nextNumber(env) {
  const prefix = 'Q' + new Date().getFullYear() + '-';
  const row = await env.DB.prepare('SELECT number FROM quotes WHERE number LIKE ? ORDER BY number DESC LIMIT 1').bind(prefix + '%').first();
  return prefix + String(row ? (parseInt(row.number.slice(prefix.length), 10) || 0) + 1 : 1).padStart(4, '0');
}
async function quoteOut(env, q) {
  const c = await env.DB.prepare('SELECT * FROM customers WHERE id = ?').bind(q.customer_id).first();
  const p = await env.DB.prepare('SELECT * FROM properties WHERE id = ?').bind(q.property_id).first();
  const job = await env.DB.prepare("SELECT * FROM jobs WHERE quote_id = ? AND status != 'Cancelled'").bind(q.id).first();
  const items = parseJson(q.hedges, []).map((x) => Object.assign(Pricing.normaliseItem(x), { measure: x.measure || null }));
  const acceptance = await env.DB.prepare('SELECT name, accepted_at, revision FROM quote_acceptances WHERE quote_id = ?').bind(q.id).first();
  return { quote: Object.assign({}, q, { items, hedges: undefined, calculation: parseJson(q.calculation, {}) }), customer: c, property: p, job, acceptance, drawings: p ? await drawingsOf(env, p.id) : [] };
}

async function quotesApi(env, me, m, parts, url, body) {
  const qid = parts[1];
  if (!qid && m === 'GET') {
    const where = [], vals = [];
    if (STATUSES.indexOf(url.searchParams.get('status')) >= 0) { where.push('q.status = ?'); vals.push(url.searchParams.get('status')); }
    const s = str(url.searchParams.get('q'), 80).replace(/[%_]/g, '');
    if (s) { where.push('(q.number LIKE ? OR c.name LIKE ? OR p.address LIKE ? OR p.suburb LIKE ?)'); vals.push('%' + s + '%', '%' + s + '%', '%' + s + '%', '%' + s + '%'); }
    const rows = (await env.DB.prepare(QUOTE_LIST + (where.length ? ' WHERE ' + where.join(' AND ') : '') + ' ORDER BY q.updated_at DESC LIMIT 500').bind(...vals).all()).results;
    return json({ quotes: rows });
  }
  if (!qid && m === 'POST') return saveQuote(env, me, body);
  const q = await env.DB.prepare('SELECT * FROM quotes WHERE id = ?').bind(qid).first();
  if (!q) fail(404, 'That quote was not found.');
  if (m === 'GET' && !parts[2]) return json(await quoteOut(env, q));
  if (parts[2] === 'status' && m === 'PUT') {
    if (STATUSES.indexOf(body.status) < 0) fail(400, 'Unknown status.');
    await env.DB.prepare("UPDATE quotes SET status = ?, updated_at = datetime('now') WHERE id = ?").bind(body.status, qid).run();
    await audit(env, me, 'quote', qid, 'status', { status: body.status });
    return json({ ok: true });
  }
  if (parts[2] === 'link' && m === 'GET') return json({ url: url.origin + '/quote.html#' + q.id + '.' + (await quoteToken(env, q.id)) });
  if (parts[2] === 'revisions' && m === 'GET') {
    return json({ revisions: (await env.DB.prepare("SELECT r.revision, r.created_at, u.name AS by_name, json_extract(r.snapshot, '$.calculation.total') AS total FROM quote_revisions r LEFT JOIN user u ON u.id = r.created_by WHERE r.quote_id = ? ORDER BY r.revision DESC").bind(qid).all()).results });
  }
  fail(404, 'Not found.');
}

/** Save a quote: creates or updates the customer and property, saves each measured item as a site drawing, prices it with the active rate card. */
async function saveQuote(env, me, body) {
  const existing = body.id ? await env.DB.prepare('SELECT * FROM quotes WHERE id = ?').bind(str(body.id, 40)).first() : null;
  if (body.id && !existing) fail(404, 'That quote was not found.');

  let customerId = str(body.customerId, 40) || (existing && existing.customer_id) || '';
  if (customerId) {
    const c = await env.DB.prepare('SELECT * FROM customers WHERE id = ? AND deleted_at IS NULL').bind(customerId).first();
    if (!c) fail(404, 'That customer was not found.');
    if (body.customer) {
      const given = Object.fromEntries(Object.entries(body.customer).filter(([, v]) => v !== '' && v != null));
      const f = customerFields(Object.assign({}, c, given));
      await env.DB.prepare("UPDATE customers SET name = ?, email = ?, phone = ?, updated_at = datetime('now') WHERE id = ?").bind(f.name, f.email, f.phone, customerId).run();
    }
  } else customerId = await createCustomer(env, me, customerFields(body.customer || {}));

  let propertyId = str(body.propertyId, 40) || (existing && existing.property_id) || '';
  const pf = propertyFields(body.property || {});
  if (propertyId) {
    const p = await env.DB.prepare('SELECT id, customer_id FROM properties WHERE id = ? AND deleted_at IS NULL').bind(propertyId).first();
    if (!p || p.customer_id !== customerId) fail(400, 'That property belongs to another customer.');
    await updateProperty(env, propertyId, pf, true);
  } else propertyId = await createProperty(env, me, customerId, pf);

  const items = (Array.isArray(body.items) ? body.items : []).slice(0, 100).map(cleanItem);
  if (!items.length) fail(400, 'Add at least one service to the quote.');
  const rates = await activeRates(env);
  items.forEach((it) => { if (!Pricing.serviceOf(rates, it.service)) fail(400, 'Unknown service: ' + it.service); });

  // measured items become (or update) the property's site drawings
  const drawings = {};
  (await drawingsOf(env, propertyId)).forEach((d) => { drawings[d.id] = d; });
  const stmts = [];
  for (const it of items) {
    if (!it.geometry) continue;
    const prev = it.drawingId && drawings[it.drawingId];
    const g = JSON.stringify(it.geometry), meas = JSON.stringify(it.measure), inputs = JSON.stringify(it.inputs);
    if (!prev) {
      it.drawingId = newId('drw');
      stmts.push(env.DB.prepare('INSERT INTO site_drawings (id, property_id, name, kind, geometry, measure, service, inputs, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
        .bind(it.drawingId, propertyId, it.name || 'Drawing', kindOf(it.geometry), g, meas, it.service, inputs, me.id));
    } else if (JSON.stringify(prev.geometry) !== g || prev.name !== it.name || JSON.stringify(prev.inputs) !== inputs) {
      stmts.push(env.DB.prepare("UPDATE site_drawings SET name = ?, kind = ?, geometry = ?, measure = ?, service = ?, inputs = ?, updated_at = datetime('now') WHERE id = ?")
        .bind(it.name || prev.name, kindOf(it.geometry), g, meas, it.service, inputs, it.drawingId));
    }
  }

  const o = body.options || {};
  const options = { removeWaste: !!o.removeWaste, travelKm: numOrNull(o.travelKm) || 0, markup: o.markup != null && o.markup !== '' ? numOrNull(o.markup) : null, setupHours: o.setupHours != null && o.setupHours !== '' ? numOrNull(o.setupHours) : null };
  const calc = Pricing.quoteCalc(rates, items, options);
  calc.options = options;
  const itemsJson = JSON.stringify(items), calcJson = JSON.stringify(calc);
  const notes = str(body.notes, 4000), assumptions = str(body.assumptions, 4000), exclusions = str(body.exclusions, 4000);
  const status = STATUSES.indexOf(body.status) >= 0 ? body.status : (existing ? existing.status : 'Draft');
  const days = (await business(env)).quoteValidityDays || 30;
  const validUntil = new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);

  let qid, number, revision;
  if (existing) {
    qid = existing.id; number = existing.number; revision = existing.revision + 1;
    stmts.push(env.DB.prepare("UPDATE quotes SET hedges = ?, calculation = ?, notes = ?, assumptions = ?, exclusions = ?, status = ?, revision = ?, valid_until = ?, updated_at = datetime('now') WHERE id = ?")
      .bind(itemsJson, calcJson, notes, assumptions, exclusions, status, revision, validUntil, qid));
  } else {
    qid = newId('quo'); number = await nextNumber(env); revision = 1;
    stmts.push(env.DB.prepare('INSERT INTO quotes (id, number, customer_id, property_id, status, revision, hedges, calculation, notes, assumptions, exclusions, valid_until, created_by) VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?)')
      .bind(qid, number, customerId, propertyId, status, itemsJson, calcJson, notes, assumptions, exclusions, validUntil, me.id));
  }
  stmts.push(env.DB.prepare('INSERT INTO quote_revisions (id, quote_id, revision, snapshot, created_by) VALUES (?, ?, ?, ?, ?)')
    .bind(newId('rev'), qid, revision, JSON.stringify({ items, calculation: calc, notes, assumptions, exclusions, status }), me.id));
  stmts.push(env.DB.prepare("UPDATE site_drawings SET quote_id = ? WHERE property_id = ? AND quote_id IS NULL AND id IN (SELECT value FROM json_each(?))").bind(qid, propertyId, JSON.stringify(items.map((x) => x.drawingId).filter(Boolean))));
  await env.DB.batch(stmts);
  await audit(env, me, 'quote', qid, existing ? 'update' : 'create', { number, revision, total: calc.total });
  return json(await quoteOut(env, await env.DB.prepare('SELECT * FROM quotes WHERE id = ?').bind(qid).first()));
}

// ---------------- jobs ----------------
function addHours(local, hours) {
  const d = new Date(local + ':00Z'); d.setTime(d.getTime() + hours * 3600000);
  return d.toISOString().slice(0, 16);
}
async function jobsApi(env, me, m, parts, url, body) {
  const jid = parts[1];
  if (!jid && m === 'GET') {
    const from = str(url.searchParams.get('from'), 16), to = str(url.searchParams.get('to'), 16);
    const where = ["j.status != 'Cancelled'"], vals = [];
    if (from) { where.push('j.end >= ?'); vals.push(from); }
    if (to) { where.push('j.start < ?'); vals.push(to); }
    return json({ jobs: (await env.DB.prepare(JOB_LIST + ' WHERE ' + where.join(' AND ') + ' ORDER BY j.start LIMIT 500').bind(...vals).all()).results });
  }
  if (!jid && m === 'POST') {
    const q = await env.DB.prepare('SELECT * FROM quotes WHERE id = ?').bind(str(body.quote_id, 40)).first();
    if (!q) fail(404, 'That quote was not found.');
    if (await env.DB.prepare("SELECT 1 AS x FROM jobs WHERE quote_id = ? AND status != 'Cancelled'").bind(q.id).first()) fail(409, 'That quote is already scheduled.');
    const start = str(body.start, 16), hours = Math.max(0.25, Math.min(80, numOrNull(body.hours) || 1));
    if (!LOCAL_DT.test(start)) fail(400, 'Choose a start date and time.');
    const crew = str(body.crew, 60) || 'Crew 1', c = await env.DB.prepare('SELECT name FROM customers WHERE id = ?').bind(q.customer_id).first();
    const old = await env.DB.prepare("SELECT id FROM jobs WHERE quote_id = ? AND status = 'Cancelled'").bind(q.id).first();
    const nid = old ? old.id : newId('job'), end = addHours(start, hours), title = str(body.title, 120) || (c ? c.name : 'Job') + ' — ' + q.number;
    if (old) await env.DB.prepare("UPDATE jobs SET title = ?, start = ?, end = ?, crew = ?, status = 'Scheduled', notes = ?, updated_at = datetime('now') WHERE id = ?").bind(title, start, end, crew, str(body.notes, 2000), nid).run();
    else await env.DB.prepare("INSERT INTO jobs (id, quote_id, customer_id, property_id, title, start, end, crew, status, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'Scheduled', ?)")
      .bind(nid, q.id, q.customer_id, q.property_id, title, start, end, crew, str(body.notes, 2000)).run();
    if (q.status !== 'Accepted') await env.DB.prepare("UPDATE quotes SET status = 'Accepted', updated_at = datetime('now') WHERE id = ?").bind(q.id).run();
    await audit(env, me, 'job', nid, 'create', { quote: q.number, start, end, crew });
    return json({ job: await env.DB.prepare(JOB_LIST + ' WHERE j.id = ?').bind(nid).first() });
  }
  const j = await env.DB.prepare('SELECT * FROM jobs WHERE id = ?').bind(jid).first();
  if (!j) fail(404, 'That job was not found.');
  if (m === 'PUT') {
    const start = body.start != null ? str(body.start, 16) : j.start;
    if (!LOCAL_DT.test(start)) fail(400, 'Choose a start date and time.');
    const hours = body.hours != null ? Math.max(0.25, Math.min(80, numOrNull(body.hours) || 1)) : (new Date(j.end + ':00Z') - new Date(j.start + ':00Z')) / 3600000;
    const status = JOB_STATUSES.indexOf(body.status) >= 0 ? body.status : j.status;
    const now = new Date().toISOString();
    await env.DB.prepare("UPDATE jobs SET title = ?, start = ?, end = ?, crew = ?, status = ?, notes = ?, actual_hours = ?, started_at = ?, completed_at = ?, updated_at = datetime('now') WHERE id = ?")
      .bind(body.title != null ? str(body.title, 120) || j.title : j.title, start, addHours(start, hours), body.crew != null ? str(body.crew, 60) || j.crew : j.crew, status,
        body.notes != null ? str(body.notes, 2000) : j.notes, body.actual_hours != null ? Math.max(0, numOrNull(body.actual_hours) || 0) : j.actual_hours,
        status === 'In progress' && !j.started_at ? now : j.started_at, status === 'Completed' && !j.completed_at ? now : j.completed_at, jid).run();
    await audit(env, me, 'job', jid, 'update', body);
    return json({ job: await env.DB.prepare(JOB_LIST + ' WHERE j.id = ?').bind(jid).first() });
  }
  if (m === 'DELETE') { await env.DB.prepare("UPDATE jobs SET status = 'Cancelled', updated_at = datetime('now') WHERE id = ?").bind(jid).run(); return json({ ok: true }); }
  fail(404, 'Not found.');
}

// ---------------- schedule (drag-and-drop planner) ----------------
const SCHEDULE_DEFAULTS = { dayStart: '07:00', dayEnd: '17:00', speedKmh: 40, roadFactor: 1.35, bufferMinutes: 5 };
async function scheduleApi(env, me, m, parts, url, body) {
  if (!parts[1] && m === 'GET') {
    const from = str(url.searchParams.get('from'), 16), to = str(url.searchParams.get('to'), 16);
    if (!LOCAL_DT.test(from) || !LOCAL_DT.test(to)) fail(400, 'Choose a date range.');
    const jobs = (await env.DB.prepare(JOB_LIST + " WHERE j.status != 'Cancelled' AND j.end >= ? AND j.start < ? ORDER BY j.start").bind(from, to).all()).results;
    const waiting = (await env.DB.prepare(
      "SELECT q.id, q.number, q.updated_at, json_extract(q.calculation, '$.total') AS total, json_extract(q.calculation, '$.personHours') AS man_hours, " +
      "coalesce(json_extract(q.calculation, '$.crew'), 2) AS crew_size, json_extract(q.calculation, '$.needsPicker') AS picker, c.name AS customer, c.phone, p.address, p.suburb, p.lat, p.lng, " +
      "(SELECT group_concat(DISTINCT json_extract(l.value, '$.serviceName')) FROM json_each(q.calculation, '$.lines') l) AS services " +
      "FROM quotes q JOIN customers c ON c.id = q.customer_id JOIN properties p ON p.id = q.property_id " +
      "WHERE q.status = 'Accepted' AND NOT EXISTS (SELECT 1 FROM jobs j WHERE j.quote_id = q.id AND j.status != 'Cancelled') ORDER BY q.updated_at").all()).results;
    const b = await business(env);
    return json({ jobs, waiting, settings: Object.assign({}, SCHEDULE_DEFAULTS, b.schedule || {}), depot: b.depot || null });
  }
  if (parts[1] === 'settings' && m === 'PUT') {
    const b = await business(env), cur = Object.assign({}, SCHEDULE_DEFAULTS, b.schedule || {});
    if (/^\d{2}:\d{2}$/.test(body.dayStart || '')) cur.dayStart = body.dayStart;
    if (/^\d{2}:\d{2}$/.test(body.dayEnd || '')) cur.dayEnd = body.dayEnd;
    ['speedKmh', 'roadFactor', 'bufferMinutes'].forEach((k) => { const v = numOrNull(body[k]); if (v != null && v >= 0 && v < 1000) cur[k] = v; });
    b.schedule = cur;
    await env.DB.prepare("INSERT INTO business_settings (id, value, updated_at) VALUES ('business', ?, datetime('now')) ON CONFLICT(id) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at").bind(JSON.stringify(b)).run();
    return json({ settings: cur });
  }
  if (parts[1] === 'apply' && m === 'POST') return applySchedule(env, me, body);
  fail(404, 'Not found.');
}

/** Apply a new arrangement in one transaction. Each entry: {id} (existing job) or {quote_id} (new job), with start, end,
    crew, men, man_hours, travel_minutes, sequence. Moved jobs are first parked on a private crew name so the database's
    crew-overlap check only ever sees the final layout. */
async function applySchedule(env, me, body) {
  const list = (Array.isArray(body.jobs) ? body.jobs : []).slice(0, 200);
  if (!list.length) fail(400, 'Nothing to schedule.');
  const park = [], place = [], created = [];
  const seenQuotes = {};
  for (const x of list) {
    const start = str(x.start, 16), end = str(x.end, 16);
    if (!LOCAL_DT.test(start) || !LOCAL_DT.test(end) || end <= start) fail(400, 'A job has an invalid time.');
    const crew = str(x.crew, 60) || 'Crew 1', men = Math.max(1, Math.min(20, parseInt(x.men, 10) || 2));
    const manHours = numOrNull(x.man_hours), travel = Math.max(0, Math.min(600, parseInt(x.travel_minutes, 10) || 0)), seq = parseInt(x.sequence, 10) || 0;
    if (x.id) {
      const j = await env.DB.prepare("SELECT id FROM jobs WHERE id = ? AND status != 'Cancelled'").bind(str(x.id, 40)).first();
      if (!j) fail(404, 'A job was not found — reload the schedule.');
      park.push(env.DB.prepare("UPDATE jobs SET crew = '__moving__' || id WHERE id = ?").bind(j.id));
      place.push(env.DB.prepare("UPDATE jobs SET start = ?, end = ?, crew = ?, men = ?, man_hours = coalesce(?, man_hours), travel_minutes = ?, sequence = ?, updated_at = datetime('now') WHERE id = ?")
        .bind(start, end, crew, men, manHours, travel, seq, j.id));
    } else {
      const q = await env.DB.prepare('SELECT q.*, c.name AS cname FROM quotes q JOIN customers c ON c.id = q.customer_id WHERE q.id = ?').bind(str(x.quote_id, 40)).first();
      if (!q) fail(404, 'That quote was not found.');
      if (seenQuotes[q.id] || await env.DB.prepare("SELECT 1 AS x FROM jobs WHERE quote_id = ? AND status != 'Cancelled'").bind(q.id).first()) fail(409, q.number + ' is already scheduled.');
      seenQuotes[q.id] = true;
      const old = await env.DB.prepare("SELECT id FROM jobs WHERE quote_id = ? AND status = 'Cancelled'").bind(q.id).first();
      const jid = old ? old.id : newId('job'), title = q.cname + ' — ' + q.number;
      if (old) place.push(env.DB.prepare("UPDATE jobs SET title = ?, start = ?, end = ?, crew = ?, status = 'Scheduled', men = ?, man_hours = ?, travel_minutes = ?, sequence = ?, started_at = NULL, completed_at = NULL, updated_at = datetime('now') WHERE id = ?")
        .bind(title, start, end, crew, men, manHours, travel, seq, jid));
      else place.push(env.DB.prepare("INSERT INTO jobs (id, quote_id, customer_id, property_id, title, start, end, crew, status, notes, men, man_hours, travel_minutes, sequence) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'Scheduled', '', ?, ?, ?, ?)")
        .bind(jid, q.id, q.customer_id, q.property_id, title, start, end, crew, men, manHours, travel, seq));
      if (q.status !== 'Accepted') place.push(env.DB.prepare("UPDATE quotes SET status = 'Accepted', updated_at = datetime('now') WHERE id = ?").bind(q.id));
      created.push({ id: jid, quote: q.number, start });
    }
  }
  await env.DB.batch(park.concat(place));
  await audit(env, me, 'schedule', 'apply', 'update', { jobs: list.length, created });
  return json({ ok: true, created });
}

// ---------------- the customer's own quote page (/quote.html#<quote id>.<token>) ----------------
// The token is an HMAC of the quote id with a secret kept in business_settings, so links can't be guessed and
// need no storage. Making a new secret (delete the 'portal' row) stops every link sent so far.
async function portalKey(env) {
  let row = await env.DB.prepare("SELECT value FROM business_settings WHERE id = 'portal'").first();
  if (!row) {
    await env.DB.prepare("INSERT OR IGNORE INTO business_settings (id, value) VALUES ('portal', ?)").bind(JSON.stringify({ secret: randHex(32) })).run();
    row = await env.DB.prepare("SELECT value FROM business_settings WHERE id = 'portal'").first();
  }
  return crypto.subtle.importKey('raw', new TextEncoder().encode(parseJson(row.value, {}).secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
}
async function quoteToken(env, qid) { return hexOf(await crypto.subtle.sign('HMAC', await portalKey(env), new TextEncoder().encode('quote:' + qid))).slice(0, 40); }
async function quoteFromRef(env, ref) {
  const m = /^(quo_[0-9a-f]{20})\.([0-9a-f]{40})$/.exec(String(ref || ''));
  if (!m) fail(404, 'This quote link is not right. Ask us to send it again.');
  const want = await quoteToken(env, m[1]);
  let d = 0; for (let i = 0; i < want.length; i++) d |= want.charCodeAt(i) ^ m[2].charCodeAt(i);
  if (d) fail(404, 'This quote link is not right. Ask us to send it again.');
  const q = await env.DB.prepare('SELECT * FROM quotes WHERE id = ?').bind(m[1]).first();
  if (!q) fail(404, 'This quote is no longer available.');
  return q;
}
async function publicApi(request, env, parts, url, m, body) {
  if (parts[1] !== 'quote') fail(404, 'Not found.');
  if (!parts[2] && m === 'GET') {
    const q = await quoteFromRef(env, url.searchParams.get('ref'));
    const out = await quoteOut(env, q), b = await business(env), rates = await activeRates(env);
    const pub = {}; ['name', 'tradingName', 'phone', 'email', 'abn', 'address', 'website', 'terms', 'paymentTerms'].forEach((k) => { if (b[k]) pub[k] = b[k]; });
    const qq = out.quote;
    return json({
      business: pub, customer: { name: out.customer.name, email: out.customer.email, phone: out.customer.phone },
      property: { address: out.property.address, suburb: out.property.suburb, lat: out.property.lat, lng: out.property.lng },
      quote: { number: qq.number, revision: qq.revision, status: qq.status, updated_at: qq.updated_at, valid_until: qq.valid_until, notes: qq.notes, assumptions: qq.assumptions, exclusions: qq.exclusions,
        items: qq.items.map((it) => ({ name: it.name, geometry: it.geometry, category: (Pricing.serviceOf(rates, it.service) || {}).category || 'Other' })),
        calculation: { document: qq.calculation.document, lines: qq.calculation.lines, exGst: qq.calculation.exGst, gst: qq.calculation.gst, total: qq.calculation.total } },
      acceptance: out.acceptance
    });
  }
  if (parts[2] === 'accept' && m === 'POST') {
    const q = await quoteFromRef(env, body.ref), name = str(body.name, 120);
    if (!name) fail(400, 'Type your name to accept the quote.');
    if (q.status === 'Declined') fail(409, 'This quote was withdrawn. Please contact us for a new one.');
    if (q.valid_until < new Date().toISOString().slice(0, 10)) fail(409, 'This quote has expired. Please contact us for an updated quote.');
    const done = await env.DB.prepare('SELECT 1 AS x FROM quote_acceptances WHERE quote_id = ?').bind(q.id).first();
    if (!done) {
      await env.DB.batch([
        env.DB.prepare("INSERT INTO quote_acceptances (id, quote_id, revision, name, terms_version) VALUES (?, ?, ?, ?, 'v1')").bind(newId('acc'), q.id, q.revision, name),
        env.DB.prepare("UPDATE quotes SET status = 'Accepted', updated_at = datetime('now') WHERE id = ?").bind(q.id)
      ]);
      await audit(env, null, 'quote', q.id, 'accepted-online', { name, revision: q.revision, ip: ipOf(request) });
    }
    return json({ ok: true });
  }
  fail(404, 'Not found.');
}

// ---------------- road routing ----------------
// Open-source OSRM (OpenStreetMap roads) by default; with a Google Maps key (Settings), Google's traffic predictions for
// the departure time give the time and an optimistic–pessimistic range. Straight-line estimate if neither answers.
const OSRM_DEFAULT = 'https://router.project-osrm.org';
const GOOGLE_DM_DEFAULT = 'https://maps.googleapis.com/maps/api/distancematrix/json';
function straightKmW(a, b) {
  const D = Math.PI / 180, dLat = (b.lat - a.lat) * D, dLng = (b.lng - a.lng) * D;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * D) * Math.cos(b.lat * D) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.min(1, Math.sqrt(h)));
}
/** Peak-hour widening for routes without live traffic: [typical, high] multipliers. */
function trafficBand(local) {
  if (!LOCAL_DT.test(local || '')) return [1.1, 1.25];
  const d = new Date(local.slice(0, 10) + 'T00:00:00Z').getUTCDay(), t = +local.slice(11, 13) + +local.slice(14, 16) / 60;
  const peak = d >= 1 && d <= 5 && ((t >= 7 && t < 9.5) || (t >= 15.5 && t < 18.5));
  return peak ? [1.25, 1.5] : [1.05, 1.2];
}
/** Local wall-clock time in a time zone → unix seconds. */
function localToUnix(local, tz) {
  const guess = Date.parse(local + ':00Z');
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).formatToParts(new Date(guess));
  const g = {}; parts.forEach((p) => { g[p.type] = p.value; });
  const asLocal = Date.parse(g.year + '-' + g.month + '-' + g.day + 'T' + g.hour + ':' + g.minute + ':00Z');
  return Math.round((guess - (asLocal - guess)) / 1000);
}
async function osrmLeg(env, a, b, withGeometry) {
  const base = env.OSRM_URL || OSRM_DEFAULT;
  const u = base + '/route/v1/driving/' + a.lng.toFixed(5) + ',' + a.lat.toFixed(5) + ';' + b.lng.toFixed(5) + ',' + b.lat.toFixed(5) + '?overview=' + (withGeometry ? 'simplified' : 'false') + '&geometries=geojson';
  const r = await fetch(u, { cf: { cacheTtl: 2592000, cacheEverything: true }, headers: { 'User-Agent': 'SeedsmanQuote/1.0' } });
  if (!r.ok) throw new Error('osrm ' + r.status);
  const d = await r.json(), rt = d.routes && d.routes[0];
  if (!rt) throw new Error('osrm no route');
  return { km: rt.distance / 1000, min: rt.duration / 60, geometry: withGeometry && rt.geometry ? rt.geometry.coordinates.map((c) => [c[1], c[0]]) : null };
}
async function googleLeg(env, key, a, b, departUnix) {
  const base = env.GOOGLE_DM_URL || GOOGLE_DM_DEFAULT, now = Math.floor(Date.now() / 1000);
  let dep = departUnix || now;
  while (dep < now) dep += 7 * 86400; // past times: the same weekday and time next week
  const one = async (model) => {
    const u = base + '?origins=' + a.lat + ',' + a.lng + '&destinations=' + b.lat + ',' + b.lng + '&mode=driving&departure_time=' + dep + '&traffic_model=' + model + '&key=' + encodeURIComponent(key);
    const d = await (await fetch(u)).json();
    const el = d.rows && d.rows[0] && d.rows[0].elements && d.rows[0].elements[0];
    if (d.status !== 'OK' || !el || el.status !== 'OK') throw new Error('google ' + (d.error_message || d.status || (el && el.status)));
    return { km: el.distance.value / 1000, min: (el.duration_in_traffic || el.duration).value / 60 };
  };
  const [best, low, high] = await Promise.all([one('best_guess'), one('optimistic'), one('pessimistic')]);
  return { km: best.km, min: best.min, low: low.min, high: high.min };
}
async function routeApi(env, body) {
  const b = await business(env), key = b.routing && b.routing.googleKey, tz = b.timezone || 'Australia/Melbourne';
  const legs = (Array.isArray(body.legs) ? body.legs : []).slice(0, 30);
  const ok = (p) => p && isFinite(p.lat) && isFinite(p.lng) && Math.abs(p.lat) <= 90 && Math.abs(p.lng) <= 180;
  const out = await Promise.all(legs.map(async (l) => {
    if (!ok(l.from) || !ok(l.to)) return null;
    const a = { lat: +l.from.lat, lng: +l.from.lng }, c = { lat: +l.to.lat, lng: +l.to.lng }, depart = LOCAL_DT.test(l.depart || '') ? l.depart : null;
    if (straightKmW(a, c) < 0.05) return { km: 0, min: 0, low: 0, high: 0, source: 'same' };
    let geometry = null;
    if (body.geometry) { try { geometry = (await osrmLeg(env, a, c, true)).geometry; } catch (e) { geometry = null; } }
    if (key) {
      try { const g = await googleLeg(env, key, a, c, depart ? localToUnix(depart, tz) : null); return Object.assign(g, { source: 'google', geometry }); } catch (e) { /* fall through to OSRM */ }
    }
    try {
      const o = await osrmLeg(env, a, c, false), band = trafficBand(depart);
      return { km: o.km, min: o.min * band[0], low: o.min, high: o.min * band[1], source: 'osrm', geometry };
    } catch (e) {
      const km = straightKmW(a, c) * 1.35, min = km / 50 * 60;
      return { km, min, low: min * 0.85, high: min * 1.3, source: 'estimate', geometry };
    }
  }));
  return json({ legs: out });
}
