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
    let res;
    try {
      res = await api(request, env, url);
    } catch (e) {
      if (e instanceof HttpError) res = json({ error: e.message }, e.status);
      else if (/Crew overlap/.test(String(e && e.message))) res = json({ error: 'That crew already has a job booked at that time.' }, 409);
      else res = json({ error: 'Server error: ' + (e && e.message ? e.message : String(e)) }, 500);
    }
    // which deployment answered: an app page left open from an older version reloads itself (see core.js)
    const build = env.CF_VERSION_METADATA && env.CF_VERSION_METADATA.id;
    if (build && res && res.headers && !res.headers.has('X-Build')) { try { res.headers.set('X-Build', build); } catch (x) { res = new Response(res.body, res); res.headers.set('X-Build', build); } }
    return res;
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
  const isUpload = m === 'POST' && ((parts[0] === 'jobs' && parts[2] === 'photos') || (parts[0] === 'public' && parts[1] === 'enquiry' && parts[3] === 'photo')); // raw image body
  const body = !isUpload && (m === 'POST' || m === 'PUT') ? await request.json().catch(() => ({})) : {};

  if (parts[0] === 'auth' && parts[1] === 'login' && m === 'POST') {
    const lim = await loginLimit(env, request);
    if (lim.over) fail(429, 'Too many wrong sign-ins from this connection. Wait 10 minutes and try again.');
    const u = await env.DB.prepare('SELECT * FROM user WHERE email = ?').bind(str(body.email).toLowerCase()).first();
    const acc = u ? await env.DB.prepare("SELECT password FROM account WHERE userId = ? AND providerId = 'credential'").bind(u.id).first() : null;
    if (!u || !acc || !(await checkPassword(String(body.password || ''), acc.password))) { await lim.fail(); fail(401, 'That email and password don’t match.'); }
    return json({ token: await newSession(env, request, u.id), user: publicUser(u) });
  }

  if (parts[0] === 'public') return publicApi(request, env, parts, url, m, body);
  if (parts[0] === 'photo' && parts[1] && m === 'GET') return photoGet(env, parts[1], url.searchParams.get('t'));

  const me = await userOf(request, env);
  if (!me) fail(401, 'Please sign in.');
  const id = parts[1];

  switch (parts[0]) {
    case 'auth':
      if (parts[1] === 'logout' && m === 'POST') { await env.DB.prepare('DELETE FROM session WHERE id = ?').bind(me.sid).run(); return json({ ok: true }); }
      break;
    case 'me':
      if (!id && m === 'GET') return json({ user: publicUser(me), business: clientBusiness(await business(env)), rates: await activeRates(env),
        counts: { newLeads: (await env.DB.prepare("SELECT count(*) AS n FROM enquiries WHERE archived_at IS NULL AND status = 'New enquiry'").first()).n } });
      if (id === 'password' && m === 'POST') return changePassword(env, me, body);
      break;
    case 'business': if (m === 'PUT') return saveBusiness(env, me, body); break;
    case 'rates': return ratesApi(env, me, m, body);
    case 'users': return usersApi(env, me, m, body);
    case 'dashboard': if (m === 'GET') return dashboard(env); break;
    case 'reports': if (m === 'GET') return parts[1] === 'manhours' ? manHoursReport(env) : reports(env, url); break;
    case 'customers': return customersApi(env, me, m, parts, url, body);
    case 'leads': return leadsApi(env, me, m, parts, url, body);
    case 'properties': return propertiesApi(env, me, m, parts, url, body);
    case 'drawings': return drawingsApi(env, me, m, parts, body);
    case 'quotes': return quotesApi(env, me, m, parts, url, body);
    case 'jobs':
      if (parts[1] && parts[2] === 'photos') return photosApi(request, env, me, m, parts, url);
      if (parts[1] && parts[2] === 'closeout' && m === 'POST') return closeoutJob(env, me, parts[1], body);
      if (parts[1] && parts[2] === 'checkin' && m === 'POST') return checkinJob(env, me, parts[1], body);
      if (parts[1] && (parts[2] === 'reflow' || parts[2] === 'addday') && m === 'POST') return reflowJob(env, me, parts[1], parts[2], body);
      if (parts[1] && parts[2] === 'park' && m === 'POST') return parkJob(env, me, parts[1]);
      if (parts[1] && parts[2] === 'crew' && m === 'POST') return crewJob(env, me, parts[1], body);
      if (parts[1] && !parts[2] && m === 'GET') return jobDetail(env, parts[1], url);
      return jobsApi(env, me, m, parts, url, body);
    case 'photos': if (parts[1] && m === 'DELETE') return photoDelete(env, me, parts[1]); break;
    case 'plans': return plansApi(env, me, m, parts, url, body);
    case 'schedule': return scheduleApi(env, me, m, parts, url, body);
    case 'route': if (m === 'POST') return routeApi(env, body); break;
    case 'google': if (parts[1] === 'check' && m === 'POST') return googleCheck(env, me, url); break;
    case 'diag': if (m === 'POST') { await audit(env, me, 'diag', str(body.kind, 40) || 'client', 'error', { message: str(body.message, 500), detail: str(body.detail, 1000), page: str(body.page, 200) }); return json({ ok: true }); } break;
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
    ['nearmapKey', 'metromapKey', 'googleKey'].forEach((k) => { if (body.imagery[k] != null) im[k] = str(body.imagery[k], 200).replace(/\s+/g, ''); });
    if (body.imagery.metromapLayer != null) im.metromapLayer = str(body.imagery.metromapLayer, 80) || 'Australia_latest';
    if (body.imagery.default != null) im.default = ['nearmap', 'metromap', 'google', 'clarity', 'world', 'vic', 'street'].indexOf(body.imagery.default) >= 0 ? body.imagery.default : '';
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
  "c.name AS customer, p.address, p.suburb, (SELECT j.id FROM jobs j WHERE j.quote_id = q.id AND j.status != 'Cancelled' ORDER BY j.part LIMIT 1) AS job_id, " +
  "coalesce((SELECT group_concat(DISTINCT json_extract(l.value, '$.serviceName')) FROM json_each(q.calculation, '$.lines') l), 'Hedge trimming') AS services " +
  "FROM quotes q JOIN customers c ON c.id = q.customer_id JOIN properties p ON p.id = q.property_id";
const JOB_LIST = "SELECT j.*, c.name AS customer, c.phone, p.address, p.suburb, p.lat, p.lng, q.number AS quote_number, json_extract(q.calculation, '$.total') AS total, " +
  "coalesce(j.man_hours, json_extract(q.calculation, '$.personHours')) AS work_hours, coalesce(j.men, json_extract(q.calculation, '$.crew'), 2) AS crew_size, " +
  "(SELECT group_concat(DISTINCT json_extract(l.value, '$.serviceName')) FROM json_each(q.calculation, '$.lines') l) AS services, " +
  "(SELECT x.id FROM jobs x WHERE x.project_id = j.project_id AND x.status IN ('Scheduled','In progress') ORDER BY x.part LIMIT 1) AS project_head, " +
  "(SELECT sum(x.man_hours) FROM jobs x WHERE x.project_id = j.project_id AND x.status IN ('Scheduled','In progress')) AS project_open_hours, " +
  "(SELECT sum(x.man_hours) FROM jobs x WHERE x.project_id = j.project_id AND x.status != 'Cancelled') AS project_hours " +
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
  const trims = (await env.DB.prepare(PLAN_LIST + " WHERE r.active = 1 AND r.status = 'Due' AND r.due <= date('now', '+30 days') ORDER BY r.due LIMIT 12").all()).results;
  const toClose = (await env.DB.prepare(JOB_LIST + " WHERE j.status IN ('Scheduled','In progress') AND j.end < strftime('%Y-%m-%dT%H:%M', 'now', '+10 hours') ORDER BY j.start DESC LIMIT 8").all()).results;
  const followUps = (await env.DB.prepare("SELECT id, name, suburb, status, next_at, next_note, phone FROM enquiries WHERE archived_at IS NULL AND status NOT IN ('Done','Lost') AND next_at IS NOT NULL AND next_at <= ? ORDER BY next_at LIMIT 8").bind(today).all()).results;
  const newLeads = (await env.DB.prepare("SELECT count(*) AS n FROM enquiries WHERE archived_at IS NULL AND status = 'New enquiry'").first()).n;
  return json({ kpis: k, recent, follow, toSchedule, jobs, trims, toClose, followUps, newLeads });
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


// ---------------- customer pipeline (CRM) ----------------
// Each lead is a card that moves from the first enquiry to the finished job. People drag cards between stages; the
// pipeline also moves cards forward by itself when the quote is accepted, the job is booked and the job is closed out.
const STAGES = ['New enquiry', 'Contacted', 'Site visit', 'Quoted', 'Won', 'Scheduled', 'Done', 'Lost'];
const LEAD_SOURCES = ['Phone', 'Website', 'Referral', 'Repeat customer', 'Facebook', 'Google', 'Sign or flyer', 'Walk-in', 'Other'];
const LOST_REASONS = ['Price', 'Went with someone else', 'No response', 'Not a job for us', 'Timing', 'Other'];
const stageRank = (st) => (st === 'Lost' ? -1 : STAGES.indexOf(st));
const LEAD_LIST = "SELECT e.*, q.number AS quote_number, q.status AS quote_status, json_extract(q.calculation, '$.total') AS quote_total, " +
  "(SELECT group_concat(DISTINCT json_extract(l.value, '$.serviceName')) FROM json_each(q.calculation, '$.lines') l) AS quote_services, " +
  "(SELECT j.id FROM jobs j WHERE j.quote_id = e.quote_id AND j.status != 'Cancelled' ORDER BY j.part LIMIT 1) AS job_id, " +
  "(SELECT min(j.start) FROM jobs j WHERE j.quote_id = e.quote_id AND j.status NOT IN ('Cancelled','Unscheduled')) AS job_start, " +
  "(SELECT count(*) FROM lead_events v WHERE v.lead_id = e.id AND v.kind IN ('note','call','sms','email')) AS touches, " +
  "(SELECT count(*) FROM photos ph WHERE ph.enquiry_id = e.id) AS photo_count " +
  "FROM enquiries e LEFT JOIN quotes q ON q.id = e.quote_id";
function leadOut(r) { const d = parseJson(r.details, {}); return Object.assign({}, r, { details: undefined, services: d.services || [], message: d.message || '', contact: d.contact || '', when: d.when || '', lat: d.lat ?? null, lng: d.lng ?? null }); }
function leadEvent(env, leadId, kind, text, by) { return env.DB.prepare('INSERT INTO lead_events (id, lead_id, kind, text, by_user) VALUES (?, ?, ?, ?, ?)').bind(newId('lev'), leadId, kind, str(text, 1000), by || null); }
/** Keep the board in step with quotes and jobs. */
async function syncLeads(env) {
  // a quote made for a lead's property after the enquiry becomes that lead's quote
  await env.DB.prepare("UPDATE enquiries SET quote_id = (SELECT q.id FROM quotes q WHERE q.property_id = enquiries.property_id AND q.created_at >= enquiries.created_at AND NOT EXISTS (SELECT 1 FROM enquiries e2 WHERE e2.quote_id = q.id) ORDER BY q.created_at LIMIT 1), updated_at = datetime('now') " +
    "WHERE quote_id IS NULL AND property_id IS NOT NULL AND archived_at IS NULL AND status NOT IN ('Done','Lost')").run();
  // every quote has a card, even when it didn't start as an enquiry
  await env.DB.prepare("INSERT INTO enquiries (id, name, email, phone, address, suburb, details, status, source, customer_id, property_id, quote_id, created_at, stage_at, updated_at, sort) " +
    "SELECT 'enq_' || lower(hex(randomblob(10))), c.name, c.email, c.phone, p.address, p.suburb, '{}', 'Quoted', c.source, q.customer_id, q.property_id, q.id, q.created_at, q.created_at, datetime('now'), 0 " +
    "FROM quotes q JOIN customers c ON c.id = q.customer_id JOIN properties p ON p.id = q.property_id WHERE NOT EXISTS (SELECT 1 FROM enquiries e WHERE e.quote_id = q.id)").run();
  // move cards forward when something newer than their last move happened
  const rows = (await env.DB.prepare("SELECT e.id, e.status, e.stage_at, q.status AS qs, q.created_at AS qc, q.updated_at AS qa, " +
    "(SELECT min(j.created_at) FROM jobs j WHERE j.quote_id = e.quote_id AND j.status != 'Cancelled') AS ja, (SELECT max(c.created_at) FROM job_closeouts c WHERE c.quote_id = e.quote_id) AS da " +
    "FROM enquiries e JOIN quotes q ON q.id = e.quote_id WHERE e.archived_at IS NULL AND e.status != 'Done'").all()).results;
  const stmts = [];
  for (const r of rows) {
    const cands = [['Quoted', r.qc], r.qs === 'Accepted' ? ['Won', r.qa] : null, r.ja ? ['Scheduled', r.ja] : null, r.da ? ['Done', r.da] : null, r.qs === 'Declined' ? ['Lost', r.qa] : null].filter(Boolean);
    let best = null;
    cands.forEach((c) => { if ((!r.stage_at || c[1] >= r.stage_at) && (c[0] === 'Lost' ? stageRank(r.status) < stageRank('Won') && r.status !== 'Lost' : stageRank(c[0]) > stageRank(r.status)) && (!best || c[0] === 'Lost' || stageRank(c[0]) > stageRank(best))) best = c[0]; });
    if (!best) continue;
    stmts.push(env.DB.prepare("UPDATE enquiries SET status = ?, stage_at = datetime('now'), updated_at = datetime('now') WHERE id = ?").bind(best, r.id));
    stmts.push(leadEvent(env, r.id, 'stage', 'Moved to ' + best + ({ Quoted: ' — quote started', Won: ' — quote accepted', Scheduled: ' — job booked', Done: ' — job closed out', Lost: ' — quote declined' }[best] || ''), null));
  }
  if (stmts.length) await env.DB.batch(stmts);
}
function leadFields(b, prev) {
  const o = {}, d = parseJson(prev && prev.details, {});
  if (b.name != null) o.name = str(b.name, 120);
  if (b.phone != null) o.phone = str(b.phone, 40);
  if (b.email != null) o.email = str(b.email, 160);
  if (b.address != null) o.address = str(b.address, 200);
  if (b.suburb != null) o.suburb = str(b.suburb, 80);
  if (b.source != null) o.source = LEAD_SOURCES.indexOf(b.source) >= 0 ? b.source : 'Other';
  if (b.value !== undefined) o.value = numOrNull(b.value);
  if (b.notes != null) o.notes = str(b.notes, 4000);
  if (b.next_at !== undefined) o.next_at = /^\d{4}-\d{2}-\d{2}$/.test(b.next_at || '') ? b.next_at : null;
  if (b.next_note != null) o.next_note = str(b.next_note, 300);
  if (b.lost_reason !== undefined) o.lost_reason = b.lost_reason ? str(b.lost_reason, 80) : null;
  if (b.sort != null && isFinite(+b.sort)) o.sort = +b.sort;
  if (b.services != null || b.message != null || b.lat !== undefined) {
    if (Array.isArray(b.services)) d.services = b.services.map((x) => str(x, 40)).slice(0, 10);
    if (b.message != null) d.message = str(b.message, 4000);
    if (b.lat !== undefined) { d.lat = numOrNull(b.lat); d.lng = numOrNull(b.lng); }
    o.details = JSON.stringify(d);
  }
  return o;
}
async function leadsApi(env, me, m, parts, url, body) {
  const id = parts[1];
  if (!id && m === 'GET') {
    await syncLeads(env);
    const leads = (await env.DB.prepare(LEAD_LIST + " WHERE e.archived_at IS NULL AND (e.status NOT IN ('Done','Lost') OR e.stage_at >= datetime('now', '-45 days')) ORDER BY e.sort, e.created_at DESC").all()).results.map(leadOut);
    const st = await env.DB.prepare("SELECT (SELECT count(*) FROM enquiries WHERE archived_at IS NULL AND status IN ('Won','Scheduled','Done') AND stage_at >= datetime('now','-90 days')) AS won90, " +
      "(SELECT count(*) FROM enquiries WHERE archived_at IS NULL AND status = 'Lost' AND stage_at >= datetime('now','-90 days')) AS lost90, " +
      "(SELECT count(*) FROM enquiries WHERE archived_at IS NULL AND created_at >= datetime('now','-30 days')) AS new30").first();
    return json({ leads, stages: STAGES, sources: LEAD_SOURCES, lostReasons: LOST_REASONS, stats: st });
  }
  if (!id && m === 'POST') {
    const o = leadFields(Object.assign({ source: 'Phone' }, body), null);
    if (!o.name) fail(400, 'Type their name.');
    if (!o.phone && !o.email) fail(400, 'Add a phone number or email so you can get back to them.');
    const lid = newId('enq'), stage = STAGES.indexOf(body.stage) >= 0 && body.stage !== 'Lost' ? body.stage : 'New enquiry';
    const minSort = await env.DB.prepare('SELECT min(sort) AS s FROM enquiries WHERE status = ? AND archived_at IS NULL').bind(stage).first();
    await env.DB.batch([
      env.DB.prepare("INSERT INTO enquiries (id, name, email, phone, address, suburb, details, status, source, value, notes, next_at, next_note, stage_at, updated_at, sort, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'), ?, ?)")
        .bind(lid, o.name, o.email || '', o.phone || '', o.address || '', o.suburb || '', o.details || '{}', stage, o.source, o.value ?? null, o.notes || '', o.next_at || null, o.next_note || '', ((minSort && minSort.s) || 0) - 1, me.id),
      leadEvent(env, lid, 'created', 'Enquiry added (' + o.source + ')', me.id)]);
    return json({ lead: leadOut(await env.DB.prepare(LEAD_LIST + ' WHERE e.id = ?').bind(lid).first()) });
  }
  const lead = await env.DB.prepare('SELECT * FROM enquiries WHERE id = ? AND archived_at IS NULL').bind(id).first();
  if (!lead) fail(404, 'That enquiry was not found.');
  if (!parts[2] && m === 'GET') {
    const events = (await env.DB.prepare('SELECT v.*, u.name AS by_name FROM lead_events v LEFT JOIN user u ON u.id = v.by_user WHERE v.lead_id = ? ORDER BY v.created_at DESC, v.rowid DESC LIMIT 100').bind(id).all()).results;
    const other = lead.customer_id ? (await env.DB.prepare("SELECT e.id, e.status, e.created_at, q.number AS quote_number, json_extract(q.calculation, '$.total') AS quote_total FROM enquiries e LEFT JOIN quotes q ON q.id = e.quote_id WHERE e.customer_id = ? AND e.id != ? AND e.archived_at IS NULL ORDER BY e.created_at DESC LIMIT 10").bind(lead.customer_id, id).all()).results : [];
    const photos = await Promise.all((await env.DB.prepare('SELECT * FROM photos WHERE enquiry_id = ? ORDER BY created_at').bind(id).all()).results.map((p) => photoOut(env, p)));
    return json({ lead: leadOut(await env.DB.prepare(LEAD_LIST + ' WHERE e.id = ?').bind(id).first()), events, other, photos });
  }
  if (!parts[2] && m === 'PUT') {
    const o = leadFields(body, lead), stmts = [];
    if (body.stage != null && STAGES.indexOf(body.stage) >= 0 && body.stage !== lead.status) {
      o.status = body.stage; o.stage_at = 'now';
      if (body.stage !== 'Lost') o.lost_reason = null;
      stmts.push(leadEvent(env, id, 'stage', 'Moved from ' + lead.status + ' to ' + body.stage + (body.stage === 'Lost' && o.lost_reason ? ' — ' + o.lost_reason : ''), me.id));
    }
    if (o.next_at !== undefined && o.next_at !== lead.next_at && o.next_at) stmts.push(leadEvent(env, id, 'follow', 'Follow up ' + o.next_at + (o.next_note ? ' — ' + o.next_note : ''), me.id));
    const keys = Object.keys(o);
    if (keys.length) {
      stmts.unshift(env.DB.prepare('UPDATE enquiries SET ' + keys.map((k) => k === 'stage_at' ? "stage_at = datetime('now')" : k + ' = ?').join(', ') + ", updated_at = datetime('now') WHERE id = ?")
        .bind(...keys.filter((k) => k !== 'stage_at').map((k) => o[k]), id));
      await env.DB.batch(stmts);
    }
    return json({ lead: leadOut(await env.DB.prepare(LEAD_LIST + ' WHERE e.id = ?').bind(id).first()) });
  }
  if (parts[2] === 'events' && m === 'POST') {
    const kind = ['note', 'call', 'sms', 'email'].indexOf(body.kind) >= 0 ? body.kind : 'note';
    const text = str(body.text, 1000) || { call: 'Phoned', sms: 'Sent a text', email: 'Sent an email' }[kind] || '';
    if (!text) fail(400, 'Type a note.');
    const stmts = [leadEvent(env, id, kind, text, me.id), env.DB.prepare("UPDATE enquiries SET updated_at = datetime('now') WHERE id = ?").bind(id)];
    if (kind !== 'note' && lead.status === 'New enquiry') { // getting in touch moves a new enquiry on
      stmts.push(env.DB.prepare("UPDATE enquiries SET status = 'Contacted', stage_at = datetime('now') WHERE id = ?").bind(id));
      stmts.push(leadEvent(env, id, 'stage', 'Moved to Contacted', me.id));
    }
    await env.DB.batch(stmts);
    return json({ ok: true });
  }
  if (parts[2] === 'convert' && m === 'POST') {
    // the customer and property for the quote: an existing customer with the same phone or email, otherwise a new one
    let cid = lead.customer_id, pid = lead.property_id;
    const d = parseJson(lead.details, {}), digits = (lead.phone || '').replace(/\D/g, '');
    if (!cid) {
      const hit = (await env.DB.prepare('SELECT id, phone, email FROM customers WHERE deleted_at IS NULL').all()).results
        .find((c) => (digits.length >= 8 && (c.phone || '').replace(/\D/g, '') === digits) || (lead.email && (c.email || '').toLowerCase() === lead.email.toLowerCase()));
      cid = hit ? hit.id : await createCustomer(env, me, { name: lead.name, email: lead.email || '', phone: lead.phone || '', source: SOURCES.indexOf(lead.source) >= 0 ? lead.source : 'Other', notes: '' });
    }
    if (!pid) {
      if (!lead.address) fail(400, 'Add the property address to the enquiry first.');
      const same = await env.DB.prepare('SELECT id FROM properties WHERE customer_id = ? AND deleted_at IS NULL AND lower(address) = lower(?)').bind(cid, lead.address).first();
      pid = same ? same.id : await createProperty(env, me, cid, { address: lead.address, suburb: lead.suburb || '', access: '', hazards: '', lat: d.lat ?? null, lng: d.lng ?? null, zoom: null });
    }
    await env.DB.batch([env.DB.prepare("UPDATE enquiries SET customer_id = ?, property_id = ?, updated_at = datetime('now') WHERE id = ?").bind(cid, pid, id), leadEvent(env, id, 'linked', 'Customer and property set up for the quote', me.id)]);
    return json({ customer_id: cid, property_id: pid });
  }
  if (!parts[2] && m === 'DELETE') {
    await env.DB.prepare("UPDATE enquiries SET archived_at = datetime('now') WHERE id = ?").bind(id).run();
    return json({ ok: true });
  }
  fail(404, 'Not found.');
}
/** Enquiry form for the public website (no sign-in): lands on the board as a New enquiry. */
async function publicEnquiry(request, env, body) {
  if (body.website) return json({ ok: true }); // a hidden field only bots fill in
  const key = 'enq:' + ipOf(request), now = Date.now();
  const row = await env.DB.prepare('SELECT count, expires FROM request_limits WHERE key = ?').bind(key).first();
  const count = row && row.expires > now ? row.count : 0;
  if (count >= 5) fail(429, 'Thanks — we already have your enquiry. We’ll be in touch soon.');
  const name = str(body.name, 120), phone = str(body.phone, 40), email = str(body.email, 160);
  if (!name || (!phone && !email)) fail(400, 'Please add your name and a phone number or email.');
  const services = Array.isArray(body.services) ? body.services.map((x) => str(x, 40)).slice(0, 8) : [];
  const lid = newId('enq'), contact = ['Call', 'Text', 'Email'].indexOf(body.contact) >= 0 ? body.contact : '', when = str(body.when, 40);
  const lat = numOrNull(body.lat), lng = numOrNull(body.lng), today = new Date(Date.now() + 10 * 3600000).toISOString().slice(0, 10);
  const details = { services, message: str(body.message, 2000), contact, when };
  if (lat != null && lng != null && Math.abs(lat) <= 90 && Math.abs(lng) <= 180) { details.lat = lat; details.lng = lng; }
  await env.DB.batch([
    env.DB.prepare("INSERT INTO enquiries (id, name, email, phone, address, suburb, details, status, source, next_at, next_note, stage_at, updated_at, sort) VALUES (?, ?, ?, ?, ?, ?, ?, 'New enquiry', 'Website', ?, ?, datetime('now'), datetime('now'), -1)")
      .bind(lid, name, email, phone, str(body.address, 200), str(body.suburb, 80), JSON.stringify(details), today, 'New website enquiry' + (contact ? ' — prefers ' + contact.toLowerCase() : '') + (when ? ' (' + when.toLowerCase() + ')' : '')),
    leadEvent(env, lid, 'created', 'Enquiry from the website' + (contact ? ' — prefers ' + contact.toLowerCase() + (when ? ', ' + when.toLowerCase() : '') : ''), null),
    env.DB.prepare('INSERT INTO request_limits (key, count, expires) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET count = excluded.count, expires = excluded.expires').bind(key, count + 1, row && row.expires > now ? row.expires : now + 3600000)]);
  return json({ ok: true, id: lid, token: await photoToken(env, 'enq:' + lid) });
}
/** Up to 3 photos with a website enquiry (within an hour of sending it), so the job can often be quoted without a visit. */
async function publicEnquiryPhoto(request, env, lid, t) {
  if (!env.PHOTOS) fail(500, 'Photo storage is not connected.');
  const want = await photoToken(env, 'enq:' + lid);
  if (!t || t !== want) fail(403, 'That upload link is not valid.');
  const e = await env.DB.prepare("SELECT id, created_at FROM enquiries WHERE id = ? AND created_at >= datetime('now', '-1 hour')").bind(lid).first();
  if (!e) fail(410, 'That enquiry can no longer take photos — please text them to us instead.');
  const n = (await env.DB.prepare("SELECT count(*) AS n FROM photos WHERE enquiry_id = ?").bind(lid).first()).n;
  if (n >= 3) fail(429, 'Three photos is plenty — thanks!');
  const type = (request.headers.get('Content-Type') || '').split(';')[0];
  if (!/^image\/(jpeg|png|webp|heic|heif)$/.test(type)) fail(400, 'That file is not a photo.');
  const buf = await request.arrayBuffer();
  if (!buf.byteLength || buf.byteLength > 8 * 1024 * 1024) fail(413, 'That photo is too big (8 MB at most).');
  const pid = newId('pho'), key = 'enquiries/' + lid + '/' + pid + (type === 'image/png' ? '.png' : type === 'image/webp' ? '.webp' : '.jpg');
  await env.PHOTOS.put(key, buf, { httpMetadata: { contentType: type } });
  await env.DB.batch([
    env.DB.prepare("INSERT INTO photos (id, enquiry_id, category, object_key, caption, file_name, content_type, bytes) VALUES (?, ?, 'enquiry', ?, '', 'photo', ?, ?)").bind(pid, lid, key, type, buf.byteLength),
    leadEvent(env, lid, 'photo', 'Customer added a photo', null)]);
  return json({ ok: true });
}
/** What the public website shows: business details and the services offered (no prices). */
async function publicBusiness(env) {
  const b = await business(env), r = await activeRates(env), pub = {};
  ['name', 'tradingName', 'phone', 'email', 'abn', 'address', 'website'].forEach((k) => { if (b[k]) pub[k] = b[k]; });
  pub.services = (r.services || []).filter((x) => x.active !== false).map((x) => ({ id: x.id, name: x.name, description: x.description || '', category: x.category || 'Other' }));
  return new Response(JSON.stringify(pub), { headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=300' } });
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
  if (g.type === 'MultiPoint' && g.coordinates.length >= 1 && g.coordinates.length <= 500 && g.coordinates.every((c) => Array.isArray(c) && c.length === 2)) return g;
  if (g.type === 'LineString' && g.coordinates.length >= 2) return g;
  if (g.type === 'Polygon' && Array.isArray(g.coordinates[0]) && g.coordinates[0].length >= 4) return g;
  return null;
}
const kindOf = (g) => (g.type === 'Polygon' ? 'area' : g.type === 'Point' || g.type === 'MultiPoint' ? 'point' : 'line');
function cleanMeasure(mm) { mm = mm || {}; return { length: numOrNull(mm.length), area: numOrNull(mm.area), perimeter: numOrNull(mm.perimeter), count: numOrNull(mm.count) }; }

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
  const job = await env.DB.prepare("SELECT * FROM jobs WHERE quote_id = ? AND status != 'Cancelled' ORDER BY part LIMIT 1").bind(q.id).first();
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
  const options = { fixedExGst: numOrNull(o.fixedExGst) > 0 ? numOrNull(o.fixedExGst) : null, removeWaste: !!o.removeWaste, travelKm: numOrNull(o.travelKm) || 0, markup: o.markup != null && o.markup !== '' ? numOrNull(o.markup) : null, setupHours: o.setupHours != null && o.setupHours !== '' ? numOrNull(o.setupHours) : null };
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
    const where = ["j.status NOT IN ('Cancelled','Unscheduled')"], vals = [];
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
  if (m === 'DELETE') { // a multi-day job is unscheduled as a whole (days already checked in stay)
    if (j.project_id) { await env.DB.prepare("UPDATE jobs SET status = 'Cancelled', updated_at = datetime('now') WHERE project_id = ? AND status IN ('Scheduled','In progress','Unscheduled')").bind(j.project_id).run(); await renumber(env, j.project_id); }
    else await env.DB.prepare("UPDATE jobs SET status = 'Cancelled', updated_at = datetime('now') WHERE id = ?").bind(jid).run();
    return json({ ok: true });
  }
  fail(404, 'Not found.');
}

// ---------------- schedule (drag-and-drop planner) ----------------
const SCHEDULE_DEFAULTS = { dayStart: '07:00', dayEnd: '17:00', speedKmh: 40, roadFactor: 1.35, bufferMinutes: 5, workDays: [1, 2, 3, 4, 5] };
async function scheduleApi(env, me, m, parts, url, body) {
  if (!parts[1] && m === 'GET') {
    const from = str(url.searchParams.get('from'), 16), to = str(url.searchParams.get('to'), 16);
    if (!LOCAL_DT.test(from) || !LOCAL_DT.test(to)) fail(400, 'Choose a date range.');
    const jobs = (await env.DB.prepare(JOB_LIST + " WHERE j.status NOT IN ('Cancelled','Unscheduled') AND j.end >= ? AND j.start < ? ORDER BY j.start").bind(from, to).all()).results;
    const parked = (await env.DB.prepare(JOB_LIST + " WHERE j.status = 'Unscheduled' ORDER BY j.updated_at").all()).results;
    const waiting = (await env.DB.prepare(
      "SELECT q.id, q.number, q.updated_at, json_extract(q.calculation, '$.total') AS total, json_extract(q.calculation, '$.personHours') AS man_hours, " +
      "coalesce(json_extract(q.calculation, '$.crew'), 2) AS crew_size, json_extract(q.calculation, '$.needsPicker') AS picker, c.name AS customer, c.phone, p.address, p.suburb, p.lat, p.lng, " +
      "(SELECT group_concat(DISTINCT json_extract(l.value, '$.serviceName')) FROM json_each(q.calculation, '$.lines') l) AS services " +
      "FROM quotes q JOIN customers c ON c.id = q.customer_id JOIN properties p ON p.id = q.property_id " +
      "WHERE q.status = 'Accepted' AND NOT EXISTS (SELECT 1 FROM jobs j WHERE j.quote_id = q.id AND j.status != 'Cancelled') ORDER BY q.updated_at").all()).results;
    const b = await business(env);
    return json({ jobs, waiting, parked, settings: Object.assign({}, SCHEDULE_DEFAULTS, b.schedule || {}), depot: b.depot || null });
  }
  if (parts[1] === 'settings' && m === 'PUT') {
    const b = await business(env), cur = Object.assign({}, SCHEDULE_DEFAULTS, b.schedule || {});
    if (/^\d{2}:\d{2}$/.test(body.dayStart || '')) cur.dayStart = body.dayStart;
    if (/^\d{2}:\d{2}$/.test(body.dayEnd || '')) cur.dayEnd = body.dayEnd;
    ['speedKmh', 'roadFactor', 'bufferMinutes'].forEach((k) => { const v = numOrNull(body[k]); if (v != null && v >= 0 && v < 1000) cur[k] = v; });
    if (Array.isArray(body.workDays)) { const wd = [...new Set(body.workDays.map((x) => parseInt(x, 10)).filter((x) => x >= 0 && x <= 6))].sort(); if (wd.length) cur.workDays = wd; }
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
  const park = [], place = [], created = [], flows = [], flowed = [], touched = new Set();
  const seenQuotes = {}, st0 = await scheduleSettings(env), dayLen = hmMin(st0.dayEnd) - hmMin(st0.dayStart);
  // a one-day job longer than a working day is always spread over days, even if an older app didn't ask for it
  for (const x of list) {
    if (x.flow || !LOCAL_DT.test(String(x.start)) || !LOCAL_DT.test(String(x.end))) continue;
    const len = (new Date(x.end + ':00Z') - new Date(x.start + ':00Z')) / 60000;
    if (len <= dayLen + 30) continue;
    if (x.id) { const r = await env.DB.prepare('SELECT parts FROM jobs WHERE id = ?').bind(str(x.id, 40)).first(); if (!r || r.parts > 1) continue; }
    x.flow = true; if (x.flow_total == null) x.flow_total = numOrNull(x.man_hours) ?? Math.round(len / 60 * (parseInt(x.men, 10) || 2) * 100) / 100;
  }
  for (const x of list) {
    if (x.flow) { flows.push(x); continue; } // laid out over as many days as it needs, after the rest are known
    const start = str(x.start, 16), end = str(x.end, 16);
    if (!LOCAL_DT.test(start) || !LOCAL_DT.test(end) || end <= start) fail(400, 'A job has an invalid time.');
    const crew = str(x.crew, 60) || 'Crew 1', men = Math.max(1, Math.min(20, parseInt(x.men, 10) || 2));
    const manHours = numOrNull(x.man_hours), travel = Math.max(0, Math.min(600, parseInt(x.travel_minutes, 10) || 0)), seq = parseInt(x.sequence, 10) || 0;
    if (x.id) {
      const j = await env.DB.prepare("SELECT id, project_id FROM jobs WHERE id = ? AND status != 'Cancelled'").bind(str(x.id, 40)).first();
      if (!j) fail(404, 'A job was not found — reload the schedule.');
      if (j.project_id) touched.add(j.project_id);
      park.push(env.DB.prepare("UPDATE jobs SET crew = '__moving__' || id WHERE id = ?").bind(j.id));
      place.push(env.DB.prepare("UPDATE jobs SET start = ?, end = ?, crew = ?, men = ?, man_hours = coalesce(?, man_hours), travel_minutes = ?, sequence = ?, status = CASE WHEN status = 'Unscheduled' THEN 'Scheduled' ELSE status END, updated_at = datetime('now') WHERE id = ?")
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
  if (flows.length) {
    const st = st0;
    const moves = list.filter((x) => !x.flow && x.id).map((x) => ({ id: str(x.id, 40), crew: str(x.crew, 60) || 'Crew 1', start: str(x.start, 16), end: str(x.end, 16) }));
    for (const x of flows) {
      const start = str(x.start, 16), crew = str(x.crew, 60) || 'Crew 1', men = Math.max(1, Math.min(20, parseInt(x.men, 10) || 2));
      if (!LOCAL_DT.test(start)) fail(400, 'A job has an invalid time.');
      let quote, rows = [];
      if (x.id) {
        const head = await env.DB.prepare("SELECT * FROM jobs WHERE id = ? AND status != 'Cancelled'").bind(str(x.id, 40)).first();
        if (!head) fail(404, 'A job was not found — reload the schedule.');
        rows = head.project_id ? (await env.DB.prepare("SELECT * FROM jobs WHERE project_id = ? AND status != 'Cancelled' ORDER BY part").bind(head.project_id).all()).results : [head];
        quote = await env.DB.prepare('SELECT q.*, c.name AS cname FROM quotes q JOIN customers c ON c.id = q.customer_id WHERE q.id = ?').bind(head.quote_id).first();
      } else {
        quote = await env.DB.prepare('SELECT q.*, c.name AS cname FROM quotes q JOIN customers c ON c.id = q.customer_id WHERE q.id = ?').bind(str(x.quote_id, 40)).first();
        if (!quote) fail(404, 'That quote was not found.');
        if (seenQuotes[quote.id] || await env.DB.prepare("SELECT 1 AS x FROM jobs WHERE quote_id = ? AND status != 'Cancelled'").bind(quote.id).first()) fail(409, quote.number + ' is already scheduled.');
        seenQuotes[quote.id] = true;
        if (quote.status !== 'Accepted') place.push(env.DB.prepare("UPDATE quotes SET status = 'Accepted', updated_at = datetime('now') WHERE id = ?").bind(quote.id));
      }
      const headRow = rows.find((r) => r.id === x.id), menAll = headRow && headRow.men && headRow.men !== men ? men : null;
      const r = await flowProject(env, st, { quote, rows, start, crew, men, menAll, totalMH: numOrNull(x.flow_total) ?? numOrNull(x.man_hours), travel: parseInt(x.travel_minutes, 10) || 0, seq: parseInt(x.sequence, 10) || 0, moves });
      park.push(...r.park); place.push(...r.place); flowed.push(r.info); if (r.info.projectId) touched.add(r.info.projectId);
      if (!x.id) created.push({ id: r.info.ids[0], quote: quote.number, start });
    }
  }
  await env.DB.batch(park.concat(place));
  for (const pid of touched) await renumber(env, pid);
  await audit(env, me, 'schedule', 'apply', 'update', { jobs: list.length, created, flowed });
  return json({ ok: true, created, flowed });
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
  if (parts[1] === 'enquiry' && parts[2] && parts[3] === 'photo' && m === 'POST') return publicEnquiryPhoto(request, env, parts[2], url.searchParams.get('t'));
  if (parts[1] === 'enquiry' && m === 'POST') return publicEnquiry(request, env, body);
  if (parts[1] === 'business' && m === 'GET') return publicBusiness(env);
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
const GOOGLE_ROUTES_DEFAULT = 'https://routes.googleapis.com/directions/v2:computeRoutes';
/** Google Routes API (computeRoutes, traffic-aware): best guess plus optimistic and pessimistic durations. */
/** One Google Routes call per drive: the traffic-aware time for the departure, with the no-traffic time giving the range. */
async function googleRoutesLeg(env, key, a, b, dep) {
  const r = await fetch(env.GOOGLE_ROUTES_URL || GOOGLE_ROUTES_DEFAULT, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': key, 'X-Goog-FieldMask': 'routes.duration,routes.staticDuration,routes.distanceMeters' },
    body: JSON.stringify({ origin: { location: { latLng: { latitude: a.lat, longitude: a.lng } } }, destination: { location: { latLng: { latitude: b.lat, longitude: b.lng } } },
      travelMode: 'DRIVE', routingPreference: 'TRAFFIC_AWARE_OPTIMAL', departureTime: new Date(dep * 1000).toISOString(), trafficModel: 'BEST_GUESS', regionCode: 'AU', units: 'METRIC' }) });
  const d = await r.json().catch(() => ({}));
  const rt = d.routes && d.routes[0];
  if (!r.ok || !rt || !rt.duration) throw new Error((d.error && (d.error.message || d.error.status)) || ('Google answered ' + r.status));
  const min = parseFloat(rt.duration) / 60, free = rt.staticDuration ? parseFloat(rt.staticDuration) / 60 : min;
  return { km: (rt.distanceMeters || 0) / 1000, min, low: Math.min(free, min), high: min + Math.max(min - free, min * 0.1) };
}
function googleLeg(env, key, a, b, departUnix) {
  const now = Math.floor(Date.now() / 1000);
  let dep = departUnix || now + 120;
  while (dep < now + 60) dep += 7 * 86400; // past times: the same weekday and time next week
  return googleRoutesLeg(env, key, a, b, dep);
}
/** Drive times for up to 30 legs. Google (when a key is saved) → road routing (OSRM) → straight-line estimate.
    Results are cached for 30 days; outside calls are kept under Cloudflare's 50-per-request limit. */
async function routeApi(env, body) {
  const b = await business(env), key = b.routing && b.routing.googleKey, tz = b.timezone || 'Australia/Melbourne';
  const legs = (Array.isArray(body.legs) ? body.legs : []).slice(0, 30);
  const ok = (p) => p && isFinite(p.lat) && isFinite(p.lng) && Math.abs(p.lat) <= 90 && Math.abs(p.lng) <= 180;
  let budget = 45; const spend = () => budget-- > 0;
  const bucket = (dt) => { if (!dt) return 'any'; const d = new Date(dt + ':00Z'); return d.getUTCDay() + '-' + d.getUTCHours(); };
  const prep = legs.map((l) => {
    if (!ok(l.from) || !ok(l.to)) return null;
    const a = { lat: +l.from.lat, lng: +l.from.lng }, c = { lat: +l.to.lat, lng: +l.to.lng }, depart = LOCAL_DT.test(l.depart || '') ? l.depart : null;
    return { a, c, depart, k: [a.lat.toFixed(4), a.lng.toFixed(4), c.lat.toFixed(4), c.lng.toFixed(4), bucket(depart)].join(',') };
  });
  const keys = prep.filter(Boolean).map((p) => p.k), cache = {};
  if (keys.length) (await env.DB.prepare("SELECT * FROM route_cache WHERE k IN (SELECT value FROM json_each(?)) AND created_at >= datetime('now', '-30 days')").bind(JSON.stringify(keys)).all()).results.forEach((r) => { cache[r.k] = r; });
  const puts = []; let googleError = null;
  const out = await Promise.all(prep.map(async (p) => {
    if (!p) return null;
    const { a, c, depart } = p;
    if (straightKmW(a, c) < 0.05) return { km: 0, min: 0, low: 0, high: 0, source: 'same' };
    let geometry = null;
    if (body.geometry && spend()) { try { geometry = (await osrmLeg(env, a, c, true)).geometry; } catch (e) { geometry = null; } }
    const hit = cache[p.k];
    if (hit && (hit.source === 'google' || !key)) return { km: hit.km, min: hit.min, low: hit.low, high: hit.high, source: hit.source, cached: true, geometry };
    if (key && spend()) {
      try {
        const g = await googleLeg(env, key, a, c, depart ? localToUnix(depart, tz) : null);
        puts.push(env.DB.prepare('INSERT OR REPLACE INTO route_cache (k, km, min, low, high, source) VALUES (?, ?, ?, ?, ?, ?)').bind(p.k, g.km, g.min, g.low, g.high, 'google'));
        return Object.assign(g, { source: 'google', geometry });
      } catch (e) { googleError = googleError || String(e.message || e).slice(0, 200); }
    }
    if (spend()) {
      try {
        const o = await osrmLeg(env, a, c, false), band = trafficBand(depart), res = { km: o.km, min: o.min * band[0], low: o.min, high: o.min * band[1], source: 'osrm', geometry };
        if (!key) puts.push(env.DB.prepare('INSERT OR REPLACE INTO route_cache (k, km, min, low, high, source) VALUES (?, ?, ?, ?, ?, ?)').bind(p.k, res.km, res.min, res.low, res.high, 'osrm'));
        return res;
      } catch (e) { /* estimate below */ }
    }
    const km = straightKmW(a, c) * 1.35, min = km / 50 * 60;
    return { km, min, low: min * 0.85, high: min * 1.3, source: 'estimate', geometry };
  }));
  if (puts.length) await env.DB.batch(puts).catch(() => {});
  return json({ legs: out, google: key ? { ok: !googleError, error: googleError } : null });
}

// ---------------- Google key check (Settings › Test Google keys) ----------------
// Calls Google from the server the way the browser would (with this site as the referrer for the satellite key) and
// returns Google's own error messages, so a key set-up problem can be fixed without guesswork.
async function googleCheck(env, me, url) {
  const b = await business(env), site = url.origin + '/', out = { site };
  const tilesKey = b.imagery && b.imagery.googleKey, routesKey = b.routing && b.routing.googleKey;
  const at = b.depot || b.mapStart || { lat: -38.33, lng: 145.03 };
  const msgOf = async (r) => { const t = await r.text(); try { const d = JSON.parse(t); return (d.error && (d.error.message || d.error.status)) || d.error_message || d.status || t.slice(0, 300); } catch (e) { return t.slice(0, 300) || ('HTTP ' + r.status); } };
  if (!tilesKey) out.tiles = { ok: false, step: 'key', message: 'No satellite key saved (Settings › Map imagery).' };
  else {
    try {
      const h = { 'Content-Type': 'application/json', Referer: site, Origin: url.origin };
      const r = await fetch('https://tile.googleapis.com/v1/createSession?key=' + encodeURIComponent(tilesKey), { method: 'POST', headers: h, body: JSON.stringify({ mapType: 'satellite', language: 'en-AU', region: 'AU', layerTypes: ['layerRoadmap'], overlay: false }) });
      if (!r.ok) out.tiles = { ok: false, step: 'session', status: r.status, message: await msgOf(r) };
      else {
        const sess = (await r.json()).session, z = 18, n = Math.pow(2, z);
        const x = Math.floor((at.lng + 180) / 360 * n), y = Math.floor((1 - Math.log(Math.tan(at.lat * Math.PI / 180) + 1 / Math.cos(at.lat * Math.PI / 180)) / Math.PI) / 2 * n);
        const t = await fetch('https://tile.googleapis.com/v1/2dtiles/' + z + '/' + x + '/' + y + '?session=' + sess + '&key=' + encodeURIComponent(tilesKey), { headers: { Referer: site, Origin: url.origin } });
        out.tiles = t.ok ? { ok: true, step: 'tile', status: t.status, message: 'Satellite tiles load (' + (t.headers.get('content-type') || 'image') + ').' } : { ok: false, step: 'tile', status: t.status, message: await msgOf(t) };
      }
    } catch (e) { out.tiles = { ok: false, step: 'network', message: String(e.message || e) }; }
  }
  if (!routesKey) out.routes = { ok: false, step: 'key', message: 'No drive-times key saved (Settings › Drive times).' };
  else {
    try {
      const r = await fetch(env.GOOGLE_ROUTES_URL || GOOGLE_ROUTES_DEFAULT, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': routesKey, 'X-Goog-FieldMask': 'routes.duration,routes.distanceMeters' },
        body: JSON.stringify({ origin: { location: { latLng: { latitude: at.lat, longitude: at.lng } } }, destination: { location: { latLng: { latitude: at.lat + 0.05, longitude: at.lng + 0.05 } } }, travelMode: 'DRIVE', routingPreference: 'TRAFFIC_AWARE_OPTIMAL', departureTime: new Date(Date.now() + 3600000).toISOString(), trafficModel: 'BEST_GUESS' }) });
      if (!r.ok) out.routes = { ok: false, status: r.status, message: await msgOf(r) };
      else { const d = await r.json(), rt = d.routes && d.routes[0]; out.routes = rt ? { ok: true, message: 'Drive times work (test drive ' + Math.round(parseFloat(rt.duration) / 60) + ' min).' } : { ok: false, message: 'Google returned no route.' }; }
    } catch (e) { out.routes = { ok: false, message: String(e.message || e) }; }
  }
  await audit(env, me, 'diag', 'google-check', 'check', out);
  return json(out);
}

// ---------------- job page, photos, close-out (the man-hours database) ----------------
async function photoToken(env, id) { return hexOf(await crypto.subtle.sign('HMAC', await portalKey(env), new TextEncoder().encode('photo:' + id))).slice(0, 32); }
async function photoOut(env, p) { return { id: p.id, category: p.category, caption: p.caption, created_at: p.created_at, url: '/api/photo/' + p.id + '?t=' + (await photoToken(env, p.id)) }; }
async function photoGet(env, id, t) {
  if (!env.PHOTOS) fail(404, 'No photo storage.');
  const want = await photoToken(env, id);
  if (!t || t.length !== want.length) fail(404, 'Not found.');
  let d = 0; for (let i = 0; i < want.length; i++) d |= want.charCodeAt(i) ^ t.charCodeAt(i);
  if (d) fail(404, 'Not found.');
  const p = await env.DB.prepare('SELECT object_key, content_type FROM photos WHERE id = ?').bind(id).first();
  if (!p) fail(404, 'Not found.');
  const obj = await env.PHOTOS.get(p.object_key);
  if (!obj) fail(404, 'Not found.');
  return new Response(obj.body, { headers: { 'Content-Type': p.content_type || 'image/jpeg', 'Cache-Control': 'private, max-age=86400' } });
}
const PHOTO_KINDS = ['before', 'after', 'issue'];
async function photosApi(request, env, me, m, parts) {
  const j = await env.DB.prepare('SELECT * FROM jobs WHERE id = ?').bind(parts[1]).first();
  if (!j) fail(404, 'That job was not found.');
  if (m === 'GET') {
    const rows = (await env.DB.prepare('SELECT * FROM photos WHERE job_id = ? ORDER BY created_at').bind(j.id).all()).results;
    return json({ photos: await Promise.all(rows.map((p) => photoOut(env, p))) });
  }
  if (m !== 'POST') fail(404, 'Not found.');
  if (!env.PHOTOS) fail(500, 'Photo storage is not connected.');
  const url = new URL(request.url), type = (request.headers.get('Content-Type') || '').split(';')[0];
  if (!/^image\/(jpeg|png|webp|heic|heif)$/.test(type)) fail(400, 'That file is not a photo.');
  const buf = await request.arrayBuffer();
  if (!buf.byteLength) fail(400, 'The photo is empty.');
  if (buf.byteLength > 8 * 1024 * 1024) fail(413, 'That photo is too big (8 MB at most).');
  const kind = PHOTO_KINDS.indexOf(url.searchParams.get('category')) >= 0 ? url.searchParams.get('category') : 'after';
  const pid = newId('pho'), key = 'jobs/' + j.id + '/' + pid + (type === 'image/png' ? '.png' : type === 'image/webp' ? '.webp' : '.jpg');
  await env.PHOTOS.put(key, buf, { httpMetadata: { contentType: type } });
  await env.DB.prepare('INSERT INTO photos (id, job_id, property_id, category, object_key, caption, file_name, content_type, bytes, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .bind(pid, j.id, j.property_id, kind, key, str(url.searchParams.get('caption'), 200), str(url.searchParams.get('name'), 120) || 'photo', type, buf.byteLength, me.id).run();
  return json({ photo: await photoOut(env, await env.DB.prepare('SELECT * FROM photos WHERE id = ?').bind(pid).first()) });
}
async function photoDelete(env, me, id) {
  const p = await env.DB.prepare('SELECT * FROM photos WHERE id = ?').bind(id).first();
  if (!p) fail(404, 'That photo was not found.');
  if (env.PHOTOS) await env.PHOTOS.delete(p.object_key);
  await env.DB.prepare('DELETE FROM photos WHERE id = ?').bind(id).run();
  await audit(env, me, 'photo', id, 'delete', { job: p.job_id });
  return json({ ok: true });
}

/** The tasks a job is made of, from its quote: each service item, plus setup/clean-up and green-waste loading. */
function jobTasks(q) {
  const calc = parseJson(q.calculation, {}), items = parseJson(q.hedges, []), lines = calc.lines || [];
  const out = lines.map((l, i) => {
    const it = Pricing.normaliseItem(items[i] || {}), inp = it.inputs || {};
    return { key: it.id || 'item' + i, category: 'service', service: l.service || it.service || 'hedge', name: it.name || l.serviceName || 'Hedge trimming', unit: l.unit || 'm²', qty: l.qty != null ? l.qty : l.area,
      tier: l.tier || null, height: inp.height != null ? +inp.height : null, condition: inp.condition || null, est: Math.round((l.hours || 0) * 100) / 100 };
  });
  const setup = (calc.job || []).find((x) => x.key === 'setup');
  const crew = calc.crew || 2, totalEst = calc.personHours || 0, itemsEst = out.reduce((s, t) => s + t.est, 0);
  const setupEst = Math.max(0, Math.round((totalEst - itemsEst) * 100) / 100);
  out.push({ key: 'setup', category: 'setup', service: null, name: 'Setup, clean-up & loading', unit: null, qty: null, est: setupEst || (setup ? 0.5 * crew : 0) });
  return { tasks: out, estimate: totalEst, crew, wasteEst: calc.wasteM3 || 0, needsPicker: !!calc.needsPicker };
}
async function jobDetail(env, jid) {
  const j = await env.DB.prepare(JOB_LIST + ' WHERE j.id = ?').bind(jid).first();
  if (!j) fail(404, 'That job was not found.');
  const q = await env.DB.prepare('SELECT * FROM quotes WHERE id = ?').bind(j.quote_id).first();
  const photos = (await env.DB.prepare('SELECT * FROM photos WHERE job_id = ? ORDER BY created_at').bind(jid).all()).results;
  const closeout = await env.DB.prepare('SELECT * FROM job_closeouts WHERE job_id = ?').bind(jid).first();
  const tasks = (await env.DB.prepare('SELECT * FROM task_times WHERE job_id = ? ORDER BY rowid').bind(jid).all()).results;
  const plan = await env.DB.prepare("SELECT * FROM recurring_service_plans WHERE job_id = ? ORDER BY created_at DESC LIMIT 1").bind(jid).first();
  const days = j.project_id ? (await env.DB.prepare("SELECT id, part, parts, start, end, crew, men, man_hours, status, day_log FROM jobs WHERE project_id = ? AND status != 'Cancelled' ORDER BY part").bind(j.project_id).all()).results
    .map((r) => Object.assign(r, { day_log: r.day_log ? parseJson(r.day_log, null) : null })) : [];
  return json({ job: j, quote: q ? { id: q.id, number: q.number, items: parseJson(q.hedges, []), calculation: parseJson(q.calculation, {}) } : null, plan: q ? jobTasks(q) : null,
    photos: await Promise.all(photos.map((p) => photoOut(env, p))), closeout: closeout ? Object.assign(closeout, { details: parseJson(closeout.details, {}) }) : null, tasks, trim: plan, days });
}
function minutesBetween(a, b) { const [ah, am] = a.split(':').map(Number), [bh, bm] = b.split(':').map(Number); let d = bh * 60 + bm - (ah * 60 + am); if (d < 0) d += 1440; return d; }

// ---------------- multi-day jobs ----------------
// A job that is longer than the working day is booked as several "days" (rows in jobs sharing project_id). Day 1 starts
// where it was dropped and runs to the end of the working day; the rest goes onto the crew's next working days, in the
// first free gap of at least an hour (30 min either side of other jobs for the drive).
const hmMin = (t) => +t.slice(0, 2) * 60 + +t.slice(3, 5);
const atMin = (date, min) => date + 'T' + String(Math.floor(min / 60)).padStart(2, '0') + ':' + String(Math.round(min % 60)).padStart(2, '0');
const ceil15 = (m) => Math.ceil(m / 15 - 1e-9) * 15;
function nextDate(date, n) { const d = new Date(date + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + (n || 1)); return d.toISOString().slice(0, 10); }
async function scheduleSettings(env) { const b = await business(env); return Object.assign({}, SCHEDULE_DEFAULTS, b.schedule || {}); }
/** Spread `totalMH` man-hours over working days. menAt(i) = crew size on the i-th day (days can differ). Returns
    [{date, s, e, mh, men}] — minutes of the day, man-hours done that day. */
function planDays(st, date, startMin, totalMH, menAt, busy, skipFirst) {
  const dayS = hmMin(st.dayStart), dayE = hmMin(st.dayEnd), work = st.workDays && st.workDays.length ? st.workDays : [1, 2, 3, 4, 5];
  let left = Math.max(0.25, totalMH);
  const out = [];
  const take = (d, s, slotLen, toEnd) => { // book as much as fits in a slot; up to 30 min over the end of the day stays on that day
    const m = menAt(out.length), need = Math.max(15, ceil15(left / m * 60));
    const all = need <= slotLen + (toEnd ? 30 : 0), len = all ? need : slotLen, mh = all ? left : Math.round(len / 60 * m * 100) / 100;
    out.push({ date: d, s, e: s + len, mh: Math.round(mh * 100) / 100, men: m }); left = all ? 0 : Math.round((left - mh) * 100) / 100;
  };
  if (!skipFirst) { const cap = dayE - startMin, need = ceil15(left / menAt(0) * 60); if (cap >= 30 || need <= cap + 30) take(date, startMin, Math.max(cap, 0), true); }
  for (let g = 0; left > 0.001 && g < 120 && out.length < 30; g++) {
    date = nextDate(date);
    if (work.indexOf(new Date(date + 'T00:00:00Z').getUTCDay()) < 0) continue;
    const need = Math.min(60, ceil15(left / menAt(out.length) * 60)), occ = busy(date).map((b) => [b[0] - 30, b[1] + 30]).sort((a, b) => a[0] - b[0]);
    // free gaps in the working day; use the biggest one
    let cur = dayS, slot = null;
    const gaps = [];
    for (const b of occ) { if (Math.min(b[0], dayE) - cur >= need) gaps.push([cur, Math.min(b[0], dayE)]); cur = Math.max(cur, b[1]); }
    if (dayE - cur >= need) gaps.push([cur, dayE]);
    gaps.forEach((g2) => { if (!slot || g2[1] - g2[0] > slot[1] - slot[0]) slot = g2; });
    if (!slot) continue;
    take(date, slot[0], slot[1] - slot[0], slot[1] === dayE);
  }
  if (left > 0.001) fail(409, 'There is not enough free time in the next few months to fit this job — make the day longer or add men.');
  return out;
}
/** Lay out a job (new, single or multi-day) from `start`: returns statements to park the old days and place the new ones.
    rows: the job's current days (completed days stay put and are counted as done). */
async function flowProject(env, st, o) {
  const done = o.rows.filter((r) => r.status === 'Completed'), open = o.rows.filter((r) => r.status === 'Scheduled' || r.status === 'In progress');
  const waiting = o.rows.filter((r) => r.status === 'Unscheduled');
  const calc = parseJson(o.quote.calculation, {});
  const openMH = open.reduce((a, r) => a + (+r.man_hours || 0), 0);
  const total = Math.max(0.25, o.totalMH != null ? o.totalMH : openMH || (calc.personHours || 1));
  const date = o.start.slice(0, 10), startMin = hmMin(o.start.slice(11, 16));
  // what else this crew already has on the following days (other jobs being moved count at their new times)
  const skip = new Set(open.map((r) => r.id).concat(o.moves.map((x) => x.id)));
  const others = (await env.DB.prepare("SELECT id, start, end FROM jobs WHERE crew = ? AND status NOT IN ('Cancelled','Unscheduled') AND start >= ? AND start < ?").bind(o.crew, date, nextDate(date, 120)).all()).results
    .filter((r) => !skip.has(r.id)).concat(o.moves.filter((x) => x.crew === o.crew));
  const busy = (d) => others.filter((r) => r.start.slice(0, 10) === d).map((r) => [hmMin(r.start.slice(11, 16)), r.end.slice(0, 10) === d ? hmMin(r.end.slice(11, 16)) : 1440]);
  // crew size per day: o.menAll for every day (the user changed it for all), otherwise each day keeps its own and new days
  // get o.men (or the last day's)
  const lastMen = open.length ? open[open.length - 1].men || o.men : o.men;
  const menAt = (i) => Math.max(1, o.menAll || (open[i] && open[i].men) || lastMen || 2);
  const days = planDays(st, date, startMin, total, menAt, busy, o.skipFirst);
  const ids = days.map((d, i) => (open[i] ? open[i].id : newId('job')));
  const parts = done.length + days.length + waiting.length + (o.extraParts || 0);
  const projectId = o.projectId || (o.rows.find((r) => r.project_id) || {}).project_id || (parts > 1 ? (done[0] || {}).id || ids[0] : null);
  const park = [], place = [], title = (o.quote.cname || 'Job') + ' — ' + o.quote.number;
  open.forEach((r, i) => park.push(i < days.length ? env.DB.prepare("UPDATE jobs SET crew = '__moving__' || id WHERE id = ?").bind(r.id)
    : env.DB.prepare("UPDATE jobs SET status = 'Cancelled', updated_at = datetime('now') WHERE id = ?").bind(r.id)));
  days.forEach((d, i) => {
    const start = atMin(d.date, d.s), end = atMin(d.date, Math.min(d.e, 1439)), part = done.length + i + 1, travel = i ? 0 : o.travel, seq = i ? 0 : o.seq;
    if (open[i]) place.push(env.DB.prepare("UPDATE jobs SET start = ?, end = ?, crew = ?, men = ?, man_hours = ?, travel_minutes = ?, sequence = ?, project_id = ?, part = ?, parts = ?, updated_at = datetime('now') WHERE id = ?")
      .bind(start, end, o.crew, d.men, d.mh, travel, seq, projectId, part, parts, ids[i]));
    else place.push(env.DB.prepare("INSERT INTO jobs (id, quote_id, customer_id, property_id, title, start, end, crew, status, notes, men, man_hours, travel_minutes, sequence, project_id, part, parts) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'Scheduled', '', ?, ?, ?, ?, ?, ?, ?)")
      .bind(ids[i], o.quote.id, o.quote.customer_id, o.quote.property_id, title, start, end, o.crew, d.men, d.mh, travel, seq, projectId, part, parts));
  });
  if (projectId) place.push(env.DB.prepare("UPDATE jobs SET project_id = ?, parts = ? WHERE status = 'Completed' AND id IN (SELECT value FROM json_each(?))").bind(projectId, parts, JSON.stringify(done.map((r) => r.id))));
  return { park, place, info: { customer: o.quote.cname, ids, projectId, days: days.map((d) => atMin(d.date, d.s)), parts, total } };
}
/** Re-spread a job's remaining days (after changing men or hours), or add another day to it. */
async function reflowJob(env, me, jid, action, body) {
  const j = await env.DB.prepare("SELECT * FROM jobs WHERE id = ? AND status != 'Cancelled'").bind(jid).first();
  if (!j) fail(404, 'That job was not found.');
  const rows = j.project_id ? (await env.DB.prepare("SELECT * FROM jobs WHERE project_id = ? AND status != 'Cancelled' ORDER BY part").bind(j.project_id).all()).results : [j];
  const open = rows.filter((r) => r.status === 'Scheduled' || r.status === 'In progress'), st = await scheduleSettings(env);
  const quote = await env.DB.prepare('SELECT q.*, c.name AS cname FROM quotes q JOIN customers c ON c.id = q.customer_id WHERE q.id = ?').bind(j.quote_id).first();
  const menAll = parseInt(body.men, 10) > 0 ? Math.min(20, parseInt(body.men, 10)) : null, men = menAll || (open[open.length - 1] || j).men || 2;
  let total = open.reduce((a, r) => a + (+r.man_hours || 0), 0), start, skipFirst = false;
  if (numOrNull(body.totalManHours) != null) total = Math.max(0.25, numOrNull(body.totalManHours));
  if (action === 'addday') total += Math.max(0.25, numOrNull(body.manHours) || (hmMin(st.dayEnd) - hmMin(st.dayStart)) / 60 * men);
  if (open.length) start = open[0].start;
  else { start = atMin(rows[rows.length - 1].start.slice(0, 10), hmMin(st.dayStart)); skipFirst = true; } // every day is done: book the next free working day
  const r = await flowProject(env, st, { quote, rows, start, crew: (open[0] || j).crew, men, menAll, totalMH: total, travel: open[0] ? open[0].travel_minutes : 0, seq: open[0] ? open[0].sequence || 0 : 0, moves: [], skipFirst });
  await env.DB.batch(r.park.concat(r.place));
  await renumber(env, r.info.projectId);
  await audit(env, me, 'job', jid, action, r.info);
  return json({ ok: true, flowed: r.info });
}
/** Change the crew on one day of a multi-day job (scope 'day') or on that day and every day after it ('rest'). The day
    keeps its start; with more men it gets through more of the work (it can finish earlier), with fewer it does less (it can
    run to the end of the day). The work left after it is re-spread over the following days. */
async function crewJob(env, me, jid, body) {
  const j = await env.DB.prepare("SELECT * FROM jobs WHERE id = ? AND status IN ('Scheduled','In progress')").bind(jid).first();
  if (!j) fail(404, 'That day was not found — reload the schedule.');
  const men = Math.max(1, Math.min(20, parseInt(body.men, 10) || j.men || 2)), rest = body.scope === 'rest', st = await scheduleSettings(env);
  const rows = j.project_id ? (await env.DB.prepare("SELECT * FROM jobs WHERE project_id = ? AND status != 'Cancelled' ORDER BY start").bind(j.project_id).all()).results : [j];
  const open = rows.filter((r) => r.status === 'Scheduled' || r.status === 'In progress');
  const before = open.filter((r) => r.start < j.start), after = open.filter((r) => r.start > j.start);
  const fromHere = Math.round((open.reduce((a, r) => a + (+r.man_hours || 0), 0) - before.reduce((a, r) => a + (+r.man_hours || 0), 0)) * 100) / 100;
  const quote = await env.DB.prepare('SELECT q.*, c.name AS cname FROM quotes q JOIN customers c ON c.id = q.customer_id WHERE q.id = ?').bind(j.quote_id).first();
  // how long this day can run: to the end of the working day, or until the crew's next job that day
  const date = j.start.slice(0, 10), s0 = hmMin(j.start.slice(11, 16));
  const next = await env.DB.prepare("SELECT min(start) AS t FROM jobs WHERE crew = ? AND status NOT IN ('Cancelled','Unscheduled') AND id != ? AND start > ? AND substr(start, 1, 10) = ?").bind(j.crew, jid, j.start, date).first();
  const dayE = hmMin(st.dayEnd), limit = next && next.t ? Math.min(dayE, hmMin(next.t.slice(11, 16)) - 15) : dayE;
  const room = Math.max(15, limit - s0), need = Math.max(15, ceil15(fromHere / men * 60));
  const len = need <= room + (limit === dayE ? 30 : 0) ? need : Math.max(15, Math.floor(room / 15) * 15);
  const mh = len === need ? fromHere : Math.round(len / 60 * men * 100) / 100, left = Math.round((fromHere - mh) * 100) / 100;
  const park = [], place = [];
  place.push(env.DB.prepare("UPDATE jobs SET men = ?, man_hours = ?, end = ?, updated_at = datetime('now') WHERE id = ?").bind(men, mh, atMin(date, Math.min(s0 + len, 1439)), jid));
  let info = { customer: quote.cname, days: [j.start], parts: rows.length };
  if (left > 0.01) {
    const r = await flowProject(env, st, { quote, rows: after, projectId: j.project_id || jid, start: atMin(date, hmMin(st.dayStart)), skipFirst: true, crew: j.crew, men: rest ? men : (after[0] || j).men,
      menAll: rest ? men : null, totalMH: left, travel: 0, seq: 0, moves: [{ id: jid, crew: j.crew, start: j.start, end: atMin(date, s0 + len) }] });
    park.push(...r.park); place.push(...r.place);
    if (!j.project_id) place.push(env.DB.prepare('UPDATE jobs SET project_id = ? WHERE id = ?').bind(jid, jid));
    info = Object.assign(r.info, { days: [j.start].concat(r.info.days) });
  } else after.forEach((r) => park.push(env.DB.prepare("UPDATE jobs SET status = 'Cancelled', updated_at = datetime('now') WHERE id = ?").bind(r.id)));
  await env.DB.batch(park.concat(place));
  await renumber(env, j.project_id || jid);
  await audit(env, me, 'job', jid, 'crew', { men, scope: rest ? 'rest' : 'day', mh, left });
  return json({ ok: true, flowed: info, day: { men, manHours: mh, end: atMin(date, s0 + len) }, left });
}
/** Send a day back to the To schedule tray. A day of a multi-day job waits there with its man-hours; a one-day job is
    unscheduled (its quote goes back to the tray). */
async function parkJob(env, me, jid) {
  const j = await env.DB.prepare("SELECT * FROM jobs WHERE id = ? AND status IN ('Scheduled','In progress')").bind(jid).first();
  if (!j) fail(404, 'That job was not found — reload the schedule.');
  if (j.project_id && j.parts > 1) {
    await env.DB.prepare("UPDATE jobs SET status = 'Unscheduled', travel_minutes = 0, updated_at = datetime('now') WHERE id = ?").bind(jid).run();
    await renumber(env, j.project_id);
  } else await env.DB.prepare("UPDATE jobs SET status = 'Cancelled', updated_at = datetime('now') WHERE id = ?").bind(jid).run();
  await audit(env, me, 'job', jid, 'park', {});
  return json({ ok: true, parked: !!(j.project_id && j.parts > 1) });
}
/** Number a job's days in date order (days waiting in the tray last): "Day 2 of 3". */
async function renumber(env, pid) {
  if (!pid) return;
  const rows = (await env.DB.prepare("SELECT id, status, start FROM jobs WHERE project_id = ? AND status != 'Cancelled'").bind(pid).all()).results;
  rows.sort((a, b) => ((a.status === 'Unscheduled') - (b.status === 'Unscheduled')) || (a.start < b.start ? -1 : a.start > b.start ? 1 : 0));
  if (rows.length) await env.DB.batch(rows.map((r, i) => env.DB.prepare('UPDATE jobs SET part = ?, parts = ? WHERE id = ?').bind(i + 1, rows.length, r.id)));
}
/** End-of-day check-in for one day of a multi-day job. */
async function checkinJob(env, me, jid, body) {
  const j = await env.DB.prepare('SELECT * FROM jobs WHERE id = ?').bind(jid).first();
  if (!j || j.status === 'Cancelled') fail(404, 'That job was not found.');
  const arrived = /^\d{2}:\d{2}$/.test(body.arrived || '') ? body.arrived : j.start.slice(11, 16), finished = /^\d{2}:\d{2}$/.test(body.finished || '') ? body.finished : j.end.slice(11, 16);
  const men = Math.max(1, Math.min(20, parseInt(body.men, 10) || j.men || 2)), breaks = Math.max(0, Math.min(600, parseInt(body.breakMinutes, 10) || 0));
  const onsite = minutesBetween(arrived, finished);
  if (onsite <= 0 || onsite > 16 * 60) fail(400, 'Check the start and finish times.');
  const progress = Math.max(1, Math.min(99, parseInt(body.progress, 10) || 50));
  const log = { date: j.start.slice(0, 10), arrived, finished, men, breakMinutes: breaks, onsiteMH: Math.round(onsite / 60 * men * 100) / 100, workingMH: Math.round(Math.max(0, onsite - breaks) / 60 * men * 100) / 100,
    progress, notes: str(body.notes, 1000), by: me.id, at: new Date().toISOString(),
    items: body.items && typeof body.items === 'object' ? Object.fromEntries(Object.entries(body.items).slice(0, 60).map(([k, v]) => [str(k, 60), Math.max(0, Math.min(1, +v || 0))])) : null };
  const now = new Date().toISOString();
  await env.DB.prepare("UPDATE jobs SET status = 'Completed', day_log = ?, men = ?, actual_hours = ?, started_at = coalesce(started_at, ?), completed_at = coalesce(completed_at, ?), updated_at = datetime('now') WHERE id = ?")
    .bind(JSON.stringify(log), men, log.workingMH, now, now, jid).run();
  const rows = j.project_id ? (await env.DB.prepare("SELECT id, start, status, man_hours, day_log FROM jobs WHERE project_id = ? AND status != 'Cancelled' ORDER BY part").bind(j.project_id).all()).results : [];
  const doneMH = rows.reduce((a, r) => a + (r.day_log ? parseJson(r.day_log, {}).workingMH || 0 : 0), 0);
  const open = rows.filter((r) => r.status === 'Scheduled' || r.status === 'In progress').sort((a, b) => (a.start < b.start ? -1 : 1)), bookedMH = rows.filter((r) => r.status !== 'Completed').reduce((a, r) => a + (+r.man_hours || 0), 0);
  const needMH = Math.round(doneMH * (100 - progress) / progress * 100) / 100;
  await audit(env, me, 'job', jid, 'checkin', log);
  return json({ ok: true, log, doneMH: Math.round(doneMH * 100) / 100, needMH, bookedMH: Math.round(bookedMH * 100) / 100, next: open[0] ? { id: open[0].id, start: open[0].start } : null });
}
async function closeoutJob(env, me, jid, body) {
  const j = await env.DB.prepare('SELECT * FROM jobs WHERE id = ?').bind(jid).first();
  if (!j) fail(404, 'That job was not found.');
  if (j.status === 'Cancelled') fail(409, 'That job was cancelled.');
  const q = await env.DB.prepare('SELECT * FROM quotes WHERE id = ?').bind(j.quote_id).first();
  const plan = jobTasks(q), date = /^\d{4}-\d{2}-\d{2}$/.test(body.date || '') ? body.date : j.start.slice(0, 10);
  const arrived = /^\d{2}:\d{2}$/.test(body.arrived || '') ? body.arrived : j.start.slice(11, 16), finished = /^\d{2}:\d{2}$/.test(body.finished || '') ? body.finished : j.end.slice(11, 16);
  const men = Math.max(1, Math.min(20, parseInt(body.men, 10) || j.men || plan.crew || 2)), breaks = Math.max(0, Math.min(600, parseInt(body.breakMinutes, 10) || 0));
  const onsite = minutesBetween(arrived, finished);
  if (onsite <= 0 || onsite > 16 * 60) fail(400, 'Check the arrival and finish times.');
  let onsiteMH = Math.round(onsite / 60 * men * 100) / 100, workingMH = Math.round(Math.max(0, onsite - breaks) / 60 * men * 100) / 100;
  // a multi-day job: add the days already checked in
  const earlier = j.project_id ? (await env.DB.prepare("SELECT day_log FROM jobs WHERE project_id = ? AND id != ? AND status = 'Completed' AND day_log IS NOT NULL").bind(j.project_id, jid).all()).results.map((r) => parseJson(r.day_log, {})) : [];
  const prevWorking = earlier.reduce((a, l) => a + (l.workingMH || 0), 0), prevOnsite = earlier.reduce((a, l) => a + (l.onsiteMH || 0), 0);
  onsiteMH = Math.round((onsiteMH + prevOnsite) * 100) / 100; workingMH = Math.round((workingMH + prevWorking) * 100) / 100;
  const given = Array.isArray(body.tasks) ? body.tasks : [];
  const rows = plan.tasks.map((t) => { const g = given.find((x) => x && x.key === t.key) || {}; return Object.assign({}, t, { actual: Math.max(0, numOrNull(g.actual) || 0), condition: str(g.condition, 40) || t.condition }); });
  (given || []).filter((g) => g && g.key && String(g.key).startsWith('extra:') && numOrNull(g.actual) > 0).forEach((g) => rows.push({ key: g.key, category: 'other', service: null, name: str(g.name, 80) || 'Other', unit: null, qty: null, est: 0, actual: numOrNull(g.actual) }));
  if (!rows.some((r) => r.actual > 0)) fail(400, 'Add the time each task took.');
  const cid = newId('clo'), stmts = [];
  stmts.push(env.DB.prepare('DELETE FROM task_times WHERE job_id = ?').bind(jid));
  stmts.push(env.DB.prepare('DELETE FROM job_closeouts WHERE job_id = ?').bind(jid));
  stmts.push(env.DB.prepare('INSERT INTO job_closeouts (id, job_id, quote_id, work_date, arrived, finished, men, break_minutes, onsite_man_hours, working_man_hours, estimated_man_hours, access, waste_m3, picker_used, notes, details, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .bind(cid, jid, q.id, date, arrived, finished, men, breaks, onsiteMH, workingMH, plan.estimate || null, str(body.access, 20) || null, numOrNull(body.wasteM3), body.pickerUsed == null ? null : body.pickerUsed ? 1 : 0, str(body.notes, 2000),
      JSON.stringify({ issues: Array.isArray(body.issues) ? body.issues.map((x) => str(x, 40)).slice(0, 10) : [], weather: str(body.weather, 40), days: earlier.length + 1, earlierWorkingMH: Math.round(prevWorking * 100) / 100 }), me.id));
  if (j.project_id) { // this is the last day: any later days still booked are no longer needed
    stmts.push(env.DB.prepare("UPDATE jobs SET status = 'Cancelled', updated_at = datetime('now') WHERE project_id = ? AND id != ? AND status IN ('Scheduled','In progress','Unscheduled') AND (part > ? OR status = 'Unscheduled')").bind(j.project_id, jid, j.part));
    stmts.push(env.DB.prepare("UPDATE jobs SET parts = ? WHERE project_id = ? AND status != 'Cancelled'").bind(j.part, j.project_id));
  }
  rows.filter((r) => r.actual > 0 || r.est > 0).forEach((r) => stmts.push(env.DB.prepare('INSERT INTO task_times (id, job_id, work_date, category, service, name, unit, qty, tier, height, condition, est_man_hours, actual_man_hours, men) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .bind(newId('tsk'), jid, date, r.category, r.service ?? null, r.name, r.unit ?? null, r.qty ?? null, r.tier ?? null, r.height ?? null, r.condition ?? null, r.est ?? null, Math.round(r.actual * 100) / 100, men)));
  const now = new Date().toISOString();
  stmts.push(env.DB.prepare("UPDATE jobs SET status = 'Completed', actual_hours = ?, waste = ?, men = ?, completed_at = coalesce(completed_at, ?), started_at = coalesce(started_at, ?), notes = CASE WHEN ? != '' THEN ? ELSE notes END, updated_at = datetime('now') WHERE id = ?")
    .bind(workingMH, numOrNull(body.wasteM3) || 0, men, now, now, str(body.notes, 2000), str(body.notes, 2000), jid));
  // next trim
  const months = parseInt(body.nextTrimMonths, 10);
  let due = null;
  if (months > 0 && months <= 24) {
    const d = new Date(date + 'T00:00:00Z'); d.setUTCMonth(d.getUTCMonth() + months); due = d.toISOString().slice(0, 10);
    const calc = parseJson(q.calculation, {});
    stmts.push(env.DB.prepare("UPDATE recurring_service_plans SET active = 0 WHERE property_id = ? AND active = 1").bind(j.property_id));
    stmts.push(env.DB.prepare("INSERT INTO recurring_service_plans (id, job_id, property_id, due, active, customer_id, quote_id, interval_months, last_total, last_ex_gst, status) VALUES (?, ?, ?, ?, 1, ?, ?, ?, ?, ?, 'Due')")
      .bind(newId('pln'), jid, j.property_id, due, j.customer_id, q.id, months, calc.total || null, calc.exGst || null));
  }
  await env.DB.batch(stmts);
  await audit(env, me, 'job', jid, 'closeout', { workingMH, estimate: plan.estimate, nextTrim: due });
  return json({ ok: true, workingManHours: workingMH, estimate: plan.estimate, nextTrim: due });
}

// ---------------- recurring trims ----------------
const PLAN_LIST = "SELECT r.*, c.name AS customer, c.phone, p.address, p.suburb, q.number AS quote_number, (SELECT j2.start FROM jobs j2 WHERE j2.id = r.job_id) AS last_job " +
  "FROM recurring_service_plans r JOIN customers c ON c.id = r.customer_id JOIN properties p ON p.id = r.property_id LEFT JOIN quotes q ON q.id = r.quote_id";
async function plansApi(env, me, m, parts, url, body) {
  const pid = parts[1];
  if (!pid && m === 'GET') return json({ plans: (await env.DB.prepare(PLAN_LIST + " WHERE r.active = 1 AND c.deleted_at IS NULL ORDER BY r.due LIMIT 300").all()).results });
  const r = await env.DB.prepare('SELECT * FROM recurring_service_plans WHERE id = ?').bind(pid).first();
  if (!r) fail(404, 'That trim reminder was not found.');
  if (parts[2] === 'quote' && m === 'POST') {
    const src = await env.DB.prepare('SELECT * FROM quotes WHERE id = ?').bind(r.quote_id).first();
    if (!src) fail(404, 'The original quote was not found.');
    const same = body.mode === 'same', calc = parseJson(src.calculation, {}), opts = Object.assign({}, calc.options || {});
    opts.fixedExGst = same ? (r.last_ex_gst || calc.exGst) : null;
    const items = parseJson(src.hedges, []).map((it) => Object.assign({}, it, { id: null, priceOverride: same ? it.priceOverride : null }));
    const res = await saveQuote(env, me, { customerId: src.customer_id, propertyId: src.property_id, items, options: opts, status: same ? 'Accepted' : 'Draft',
      notes: src.notes, assumptions: src.assumptions, exclusions: src.exclusions });
    const d = await res.json();
    await env.DB.prepare("UPDATE recurring_service_plans SET status = ?, new_quote_id = ? WHERE id = ?").bind(same ? 'Booked' : 'Quoted', d.quote.id, r.id).run();
    await audit(env, me, 'plan', r.id, same ? 'book-same-price' : 'requote', { from: src.number, to: d.quote.number, total: d.quote.calculation.total });
    return json({ quote: { id: d.quote.id, number: d.quote.number, total: d.quote.calculation.total, status: d.quote.status } });
  }
  if (m === 'PUT') {
    const due = /^\d{4}-\d{2}-\d{2}$/.test(body.due || '') ? body.due : r.due;
    const status = ['Due', 'Skipped'].indexOf(body.status) >= 0 ? body.status : r.status;
    const months = body.interval_months != null ? Math.max(1, Math.min(24, parseInt(body.interval_months, 10) || r.interval_months || 4)) : r.interval_months;
    await env.DB.prepare('UPDATE recurring_service_plans SET due = ?, status = ?, interval_months = ?, active = ? WHERE id = ?').bind(due, status, months, status === 'Skipped' ? 0 : 1, r.id).run();
    return json({ ok: true });
  }
  fail(404, 'Not found.');
}

// ---------------- man-hours report: actual vs estimated, by service and height band ----------------
async function manHoursReport(env) {
  const rows = (await env.DB.prepare("SELECT category, service, tier, unit, count(DISTINCT job_id) AS jobs, sum(qty) AS qty, sum(est_man_hours) AS est, sum(actual_man_hours) AS actual FROM task_times GROUP BY category, service, tier, unit ORDER BY category, service, tier").all()).results;
  const totals = await env.DB.prepare('SELECT count(*) AS jobs, sum(onsite_man_hours) AS onsite, sum(working_man_hours) AS working, sum(estimated_man_hours) AS est, sum(break_minutes * men) / 60.0 AS breaks FROM job_closeouts').first();
  const recent = (await env.DB.prepare("SELECT c.work_date, c.working_man_hours, c.estimated_man_hours, c.men, j.id AS job_id, cu.name AS customer, p.suburb FROM job_closeouts c JOIN jobs j ON j.id = c.job_id JOIN customers cu ON cu.id = j.customer_id JOIN properties p ON p.id = j.property_id ORDER BY c.work_date DESC LIMIT 12").all()).results;
  return json({ rows, totals, recent, rates: await activeRates(env) });
}
