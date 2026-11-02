var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// public/js/rates.js
(function(g) {
  "use strict";
  var DEFAULTS = {
    version: "DEFAULT",
    labourRate: 65,
    // $ per person-hour
    crew: 2,
    // people on site
    setupHours: 0.5,
    // crew hours per job: set up, tarps, clean up
    tiers: [
      // by hedge height (m): how many m² of face one person trims per hour
      { upTo: 1.2, label: "Low", productivity: 45 },
      { upTo: 2, label: "Medium", productivity: 35 },
      { upTo: 3, label: "Tall", productivity: 25 },
      { upTo: 4.5, label: "Very tall", productivity: 16 },
      { upTo: 8, label: "Extra tall", productivity: 11 }
    ],
    topFactor: 1.2,
    // tops are slower than faces (reaching over)
    conditions: [
      // multiplies time and green waste
      { id: "maintained", label: "Maintained (regular trim)", time: 1, waste: 1 },
      { id: "overgrown", label: "Overgrown (6\u201312 months)", time: 1.5, waste: 2.5 },
      { id: "reduction", label: "Hard cut / reduction", time: 2.5, waste: 5 }
    ],
    picker: { fromHeight: 3, halfDay: 320, fullDay: 480, delivery: 150, halfDayHours: 4 },
    waste: { m3PerM2: 0.02, rate: 65, loadMinutesPerM3: 10 },
    // rate = $ per m³ to dispose
    equipment: 25,
    // per job: fuel, blades, consumables
    travelRate: 1.2,
    // $ per km (return trip)
    risk: 0.05,
    // contingency added to the subtotal
    minimum: 180,
    // smallest price before GST
    gst: 0.1
  };
  var FACES = [
    { id: "top", label: "Top" },
    { id: "front", label: "Front" },
    { id: "back", label: "Back" },
    { id: "lhs", label: "LHS end" },
    { id: "rhs", label: "RHS end" }
  ];
  function num(v, d) {
    v = parseFloat(v);
    return isFinite(v) && v >= 0 ? v : d || 0;
  }
  __name(num, "num");
  function r2(n) {
    return Math.round(n * 100) / 100;
  }
  __name(r2, "r2");
  function quarter(h) {
    return Math.ceil(h * 4 - 1e-9) / 4;
  }
  __name(quarter, "quarter");
  function normalise(r) {
    r = r || {};
    var out = JSON.parse(JSON.stringify(DEFAULTS));
    Object.keys(out).forEach(function(k) {
      if (r[k] == null) return;
      if (k === "tiers" || k === "conditions") {
        if (Array.isArray(r[k]) && r[k].length) out[k] = r[k];
      } else if (typeof out[k] === "object" && !Array.isArray(out[k])) Object.keys(out[k]).forEach(function(j) {
        if (r[k][j] != null) out[k][j] = r[k][j];
      });
      else out[k] = r[k];
    });
    if (r.version) out.version = r.version;
    if (r.wasteRate != null && (!r.waste || r.waste.rate == null)) out.waste.rate = r.wasteRate;
    out.tiers = out.tiers.slice().sort(function(a, b) {
      return a.upTo - b.upTo;
    });
    return out;
  }
  __name(normalise, "normalise");
  function tierFor(rates, height) {
    for (var i = 0; i < rates.tiers.length; i++) if (height <= rates.tiers[i].upTo + 1e-9) return rates.tiers[i];
    return rates.tiers[rates.tiers.length - 1];
  }
  __name(tierFor, "tierFor");
  function conditionFor(rates, id) {
    for (var i = 0; i < rates.conditions.length; i++) if (rates.conditions[i].id === id) return rates.conditions[i];
    return rates.conditions[0];
  }
  __name(conditionFor, "conditionFor");
  function faceAreas(h) {
    var L = num(h.length), H = num(h.height), D = num(h.depth), f = h.faces || {};
    return {
      top: f.top ? L * D : 0,
      front: f.front ? L * H : 0,
      back: f.back ? L * H : 0,
      lhs: f.lhs ? D * H : 0,
      rhs: f.rhs ? D * H : 0
    };
  }
  __name(faceAreas, "faceAreas");
  function hedgeCalc(rates, h) {
    var a = faceAreas(h), area = a.top + a.front + a.back + a.lhs + a.rhs;
    var tier = tierFor(rates, num(h.height)), cond = conditionFor(rates, h.condition);
    var eff = a.front + a.back + a.lhs + a.rhs + a.top * rates.topFactor;
    var hours = tier.productivity > 0 ? eff / tier.productivity * cond.time : 0;
    return {
      areas: a,
      area: r2(area),
      hours: r2(hours),
      tier: tier.label,
      productivity: tier.productivity,
      condition: cond.label,
      waste: area * rates.waste.m3PerM2 * cond.waste,
      picker: num(h.height) > rates.picker.fromHeight
    };
  }
  __name(hedgeCalc, "hedgeCalc");
  function quoteCalc(rawRates, hedges, opts) {
    var rates = normalise(rawRates), o = opts || {}, crew = Math.max(1, num(rates.crew, 1));
    var lines = (hedges || []).map(function(h) {
      return hedgeCalc(rates, h);
    });
    var t = { area: 0, trimHours: 0, pickerHours: 0, wasteM3: 0 };
    lines.forEach(function(l) {
      t.area += l.area;
      t.trimHours += l.hours;
      if (l.picker) t.pickerHours += l.hours;
      t.wasteM3 += l.waste;
    });
    var setupHours = lines.length ? rates.setupHours * crew : 0;
    var wasteM3 = o.removeWaste ? t.wasteM3 : 0;
    var loadHours = wasteM3 * rates.waste.loadMinutesPerM3 / 60;
    var personHours = lines.length ? quarter(t.trimHours + setupHours + loadHours) : 0;
    var siteHours = quarter(personHours / crew);
    var items = [];
    function add(key, label, amount, detail) {
      if (amount > 0) items.push({ key, label, detail: detail || "", amount: r2(amount) });
    }
    __name(add, "add");
    add("labour", "Labour", personHours * rates.labourRate, personHours + " person-hours at $" + rates.labourRate + "/h (" + crew + " crew, about " + siteHours + " h on site)");
    if (t.pickerHours > 0) {
      var ph = t.pickerHours / crew, hire = ph <= rates.picker.halfDayHours ? rates.picker.halfDay : Math.ceil(ph / 8) * rates.picker.fullDay;
      var hireLabel = ph <= rates.picker.halfDayHours ? "half day" : Math.ceil(ph / 8) + (Math.ceil(ph / 8) === 1 ? " day" : " days");
      add("picker", "Cherry picker", hire + rates.picker.delivery, hireLabel + " + delivery (hedges over " + rates.picker.fromHeight + " m)");
    }
    if (wasteM3 > 0) add("waste", "Green waste removal", wasteM3 * rates.waste.rate, r2(wasteM3) + " m\xB3 at $" + rates.waste.rate + "/m\xB3");
    if (lines.length) add("equipment", "Equipment & consumables", rates.equipment);
    if (num(o.travelKm) > 0) add("travel", "Travel", num(o.travelKm) * rates.travelRate, num(o.travelKm) + " km at $" + rates.travelRate + "/km");
    var subtotal = items.reduce(function(s, i) {
      return s + i.amount;
    }, 0);
    var risk = r2(subtotal * rates.risk);
    var exGst = subtotal + risk, minimumTopUp = 0;
    if (lines.length && exGst < rates.minimum) {
      minimumTopUp = r2(rates.minimum - exGst);
      exGst = rates.minimum;
    }
    var gst = r2(exGst * rates.gst);
    return {
      rateVersion: rates.version,
      lines,
      items,
      area: r2(t.area),
      personHours,
      siteHours,
      wasteM3: r2(wasteM3),
      needsPicker: t.pickerHours > 0,
      subtotal: r2(subtotal),
      risk,
      minimumTopUp,
      exGst: r2(exGst),
      gst,
      total: r2(exGst + gst)
    };
  }
  __name(quoteCalc, "quoteCalc");
  g.SeedsmanRates = { DEFAULTS, FACES, normalise, tierFor, faceAreas, hedgeCalc, quoteCalc };
})(typeof window !== "undefined" ? window : globalThis);

// worker/index.js
var Rates = globalThis.SeedsmanRates;
var PBKDF2_ITER = 1e5;
var SESSION_DAYS = 30;
var MAX_LOGIN_FAILS = 10;
var LOCK_MS = 10 * 60 * 1e3;
var STATUSES = ["Draft", "Sent", "Accepted", "Declined"];
var worker_default = {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (!url.pathname.startsWith("/api/")) return env.ASSETS.fetch(request);
    try {
      return await api(request, env, url);
    } catch (e) {
      if (e instanceof HttpError) return json({ error: e.message }, e.status);
      return json({ error: "Server error: " + (e && e.message ? e.message : String(e)) }, 500);
    }
  }
};
var HttpError = class extends Error {
  static {
    __name(this, "HttpError");
  }
  constructor(status, message) {
    super(message);
    this.status = status;
  }
};
var fail = /* @__PURE__ */ __name((status, message) => {
  throw new HttpError(status, message);
}, "fail");
function json(body, status) {
  return new Response(JSON.stringify(body), { status: status || 200, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
}
__name(json, "json");
function hexOf(buf) {
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, "0")).join("");
}
__name(hexOf, "hexOf");
function randHex(n) {
  const a = new Uint8Array(n);
  crypto.getRandomValues(a);
  return hexOf(a);
}
__name(randHex, "randHex");
function newId(prefix) {
  return prefix + "_" + randHex(10);
}
__name(newId, "newId");
async function sha256(text) {
  return hexOf(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)));
}
__name(sha256, "sha256");
async function pbkdf2(password, salt, iter) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  return hexOf(await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: new TextEncoder().encode(salt), iterations: iter }, key, 256));
}
__name(pbkdf2, "pbkdf2");
async function makePassword(pw) {
  const salt = randHex(16);
  return "pbkdf2$" + PBKDF2_ITER + "$" + salt + "$" + await pbkdf2(pw, salt, PBKDF2_ITER);
}
__name(makePassword, "makePassword");
async function checkPassword(pw, stored) {
  const p = String(stored || "").split("$");
  if (p.length !== 4 || p[0] !== "pbkdf2") return false;
  const h = await pbkdf2(pw, p[2], +p[1]);
  if (h.length !== p[3].length) return false;
  let d = 0;
  for (let i = 0; i < h.length; i++) d |= h.charCodeAt(i) ^ p[3].charCodeAt(i);
  return d === 0;
}
__name(checkPassword, "checkPassword");
var str = /* @__PURE__ */ __name((v, max) => String(v == null ? "" : v).trim().slice(0, max || 200), "str");
var numOrNull = /* @__PURE__ */ __name((v) => {
  const n = parseFloat(v);
  return isFinite(n) ? n : null;
}, "numOrNull");
var ipOf = /* @__PURE__ */ __name((request) => request.headers.get("CF-Connecting-IP") || "unknown", "ipOf");
var parseJson = /* @__PURE__ */ __name((s, d) => {
  try {
    return JSON.parse(s);
  } catch (e) {
    return d;
  }
}, "parseJson");
async function audit(env, me, type, id, action, snapshot) {
  await env.DB.prepare("INSERT INTO audit_log (id, actor_id, entity_type, entity_id, action, snapshot) VALUES (?, ?, ?, ?, ?, ?)").bind(newId("aud"), me ? me.id : null, type, id, action, JSON.stringify(snapshot || {})).run();
}
__name(audit, "audit");
async function userOf(request, env) {
  const m = /^Bearer ([0-9a-f]{64})$/.exec(request.headers.get("Authorization") || "");
  if (!m) return null;
  const row = await env.DB.prepare("SELECT s.id AS sid, s.expiresAt, u.id, u.name, u.email, u.role FROM session s JOIN user u ON u.id = s.userId WHERE s.token = ?").bind(await sha256("seedsman-session:" + m[1])).first();
  if (!row || row.expiresAt < Date.now()) return null;
  return { id: row.id, name: row.name, email: row.email, role: row.role, sid: row.sid };
}
__name(userOf, "userOf");
async function newSession(env, request, uid) {
  const token = randHex(32), now = Date.now();
  await env.DB.prepare("INSERT INTO session (id, expiresAt, token, createdAt, updatedAt, ipAddress, userAgent, userId) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").bind(newId("ses"), now + SESSION_DAYS * 864e5, await sha256("seedsman-session:" + token), now, now, ipOf(request), str(request.headers.get("User-Agent"), 200), uid).run();
  return token;
}
__name(newSession, "newSession");
async function loginLimit(env, request) {
  const key = "login:" + ipOf(request), now = Date.now();
  const row = await env.DB.prepare("SELECT count, expires FROM request_limits WHERE key = ?").bind(key).first();
  const count = row && row.expires > now ? row.count : 0;
  return {
    over: count >= MAX_LOGIN_FAILS,
    fail: /* @__PURE__ */ __name(() => env.DB.prepare("INSERT INTO request_limits (key, count, expires) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET count = excluded.count, expires = excluded.expires").bind(key, count + 1, row && row.expires > now ? row.expires : now + LOCK_MS).run(), "fail")
  };
}
__name(loginLimit, "loginLimit");
var publicUser = /* @__PURE__ */ __name((u) => ({ id: u.id, name: u.name, email: u.email, role: u.role }), "publicUser");
var isAdmin = /* @__PURE__ */ __name((me) => me.role === "admin" || me.role === "owner", "isAdmin");
async function business(env) {
  const row = await env.DB.prepare("SELECT value FROM business_settings WHERE id = 'business'").first();
  return row ? parseJson(row.value, {}) : {};
}
__name(business, "business");
async function activeRates(env) {
  const row = await env.DB.prepare("SELECT id, snapshot, approval_status FROM rate_library WHERE active = 1 ORDER BY effective_date DESC, created_at DESC LIMIT 1").first();
  const raw = row ? parseJson(row.snapshot, {}) : {};
  const r = Rates.normalise(raw);
  r.version = row ? row.id : "DEFAULT";
  r.approval = row ? row.approval_status : "default";
  return r;
}
__name(activeRates, "activeRates");
async function api(request, env, url) {
  const parts = url.pathname.split("/").filter(Boolean).slice(1);
  const m = request.method;
  const body = m === "POST" || m === "PUT" ? await request.json().catch(() => ({})) : {};
  if (parts[0] === "auth" && parts[1] === "login" && m === "POST") {
    const lim = await loginLimit(env, request);
    if (lim.over) fail(429, "Too many wrong sign-ins from this connection. Wait 10 minutes and try again.");
    const u = await env.DB.prepare("SELECT * FROM user WHERE email = ?").bind(str(body.email).toLowerCase()).first();
    const acc = u ? await env.DB.prepare("SELECT password FROM account WHERE userId = ? AND providerId = 'credential'").bind(u.id).first() : null;
    if (!u || !acc || !await checkPassword(String(body.password || ""), acc.password)) {
      await lim.fail();
      fail(401, "That email and password don\u2019t match.");
    }
    return json({ token: await newSession(env, request, u.id), user: publicUser(u) });
  }
  const me = await userOf(request, env);
  if (!me) fail(401, "Please sign in.");
  if (parts[0] === "auth" && parts[1] === "logout" && m === "POST") {
    await env.DB.prepare("DELETE FROM session WHERE id = ?").bind(me.sid).run();
    return json({ ok: true });
  }
  if (parts[0] === "me" && !parts[1] && m === "GET") return json({ user: publicUser(me), business: await business(env), rates: await activeRates(env) });
  if (parts[0] === "me" && parts[1] === "password" && m === "POST") {
    const acc = await env.DB.prepare("SELECT password FROM account WHERE userId = ? AND providerId = 'credential'").bind(me.id).first();
    if (!acc || !await checkPassword(String(body.current || ""), acc.password)) fail(401, "Your current password is not right.");
    if (String(body.password || "").length < 8) fail(400, "Use a new password of at least 8 characters.");
    await env.DB.batch([
      env.DB.prepare("UPDATE account SET password = ?, updatedAt = ? WHERE userId = ? AND providerId = 'credential'").bind(await makePassword(String(body.password)), Date.now(), me.id),
      env.DB.prepare("DELETE FROM session WHERE userId = ? AND id != ?").bind(me.id, me.sid)
    ]);
    return json({ ok: true });
  }
  if (parts[0] === "business" && m === "PUT") {
    if (!isAdmin(me)) fail(403, "Only an admin can change the business details.");
    const cur = await business(env);
    ["name", "tradingName", "phone", "email", "abn", "address", "website"].forEach((k) => {
      if (body[k] != null) cur[k] = str(body[k], 200);
    });
    if (body.quoteValidityDays != null) cur.quoteValidityDays = Math.max(1, Math.min(365, parseInt(body.quoteValidityDays, 10) || 30));
    if (body.mapStart && isFinite(body.mapStart.lat) && isFinite(body.mapStart.lng)) cur.mapStart = { lat: +body.mapStart.lat, lng: +body.mapStart.lng, zoom: +body.mapStart.zoom || 15 };
    await env.DB.prepare("INSERT INTO business_settings (id, value, updated_at) VALUES ('business', ?, datetime('now')) ON CONFLICT(id) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at").bind(JSON.stringify(cur)).run();
    await audit(env, me, "business", "business", "update", cur);
    return json({ business: cur });
  }
  if (parts[0] === "rates") {
    if (m === "GET") {
      const hist = (await env.DB.prepare("SELECT id, effective_date, active, approval_status, created_at FROM rate_library ORDER BY created_at DESC LIMIT 30").all()).results;
      return json({ rates: await activeRates(env), history: hist });
    }
    if (m === "POST") {
      if (!isAdmin(me)) fail(403, "Only an admin can change the rates.");
      const snap = Rates.normalise(body.rates || {});
      const today = (/* @__PURE__ */ new Date()).toISOString().slice(0, 10), id = "RATES-" + today + "-" + randHex(2).toUpperCase();
      snap.version = id;
      snap.effectiveDate = today;
      await env.DB.batch([
        env.DB.prepare("UPDATE rate_library SET active = 0 WHERE active = 1"),
        env.DB.prepare("INSERT INTO rate_library (id, effective_date, active, approval_status, snapshot, created_by) VALUES (?, ?, 1, 'approved', ?, ?)").bind(id, today, JSON.stringify(snap), me.id)
      ]);
      await audit(env, me, "rates", id, "create", snap);
      return json({ rates: await activeRates(env) });
    }
  }
  if (parts[0] === "users") {
    if (!isAdmin(me)) fail(403, "Only an admin can manage staff logins.");
    if (m === "GET") return json({ users: (await env.DB.prepare("SELECT id, name, email, role FROM user ORDER BY createdAt").all()).results });
    if (m === "POST") {
      const email = str(body.email).toLowerCase(), name = str(body.name, 80), role = body.role === "admin" ? "admin" : "field", pw = String(body.password || "");
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) fail(400, "Type a valid email address.");
      if (!name) fail(400, "Type their name.");
      if (pw.length < 8) fail(400, "Give them a password of at least 8 characters.");
      if (await env.DB.prepare("SELECT 1 AS x FROM user WHERE email = ?").bind(email).first()) fail(409, "There is already a login with that email.");
      const id = newId("usr"), now = Date.now();
      await env.DB.batch([
        env.DB.prepare("INSERT INTO user (id, name, email, emailVerified, createdAt, updatedAt, role) VALUES (?, ?, ?, 0, ?, ?, ?)").bind(id, name, email, now, now, role),
        env.DB.prepare("INSERT INTO account (id, accountId, providerId, userId, password, createdAt, updatedAt) VALUES (?, ?, 'credential', ?, ?, ?, ?)").bind(newId("acc"), id, id, await makePassword(pw), now, now)
      ]);
      await audit(env, me, "user", id, "create", { email, name, role });
      return json({ user: { id, name, email, role } });
    }
  }
  if (parts[0] === "customers") return customersApi(env, me, m, parts, url, body);
  if (parts[0] === "properties") return propertiesApi(env, me, m, parts, body);
  if (parts[0] === "hedges" && parts[1] && m === "DELETE") {
    await env.DB.prepare("UPDATE hedge_assets SET inactive = 1, updated_at = datetime('now') WHERE id = ?").bind(parts[1]).run();
    return json({ ok: true });
  }
  if (parts[0] === "quotes") return quotesApi(env, me, m, parts, body);
  fail(404, "Not found.");
}
__name(api, "api");
var SOURCES = ["Phone", "Website", "Referral", "Repeat customer", "Walk-in", "Other"];
function customerFields(body) {
  return { name: str(body.name, 120), email: str(body.email, 160), phone: str(body.phone, 40), source: SOURCES.indexOf(body.source) >= 0 ? body.source : "Phone", notes: str(body.notes, 4e3) };
}
__name(customerFields, "customerFields");
function propertyFields(body) {
  return { address: str(body.address, 200), suburb: str(body.suburb, 80), access: str(body.access, 1e3), hazards: str(body.hazards, 1e3), lat: numOrNull(body.lat), lng: numOrNull(body.lng), zoom: numOrNull(body.zoom) };
}
__name(propertyFields, "propertyFields");
async function createCustomer(env, me, c) {
  if (!c.name) fail(400, "Type the customer\u2019s name.");
  const id = newId("cus");
  await env.DB.prepare("INSERT INTO customers (id, name, email, phone, source, notes, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)").bind(id, c.name, c.email, c.phone, c.source, c.notes, me.id).run();
  await audit(env, me, "customer", id, "create", c);
  return id;
}
__name(createCustomer, "createCustomer");
async function createProperty(env, me, customerId, p) {
  const id = newId("prop");
  await env.DB.prepare("INSERT INTO properties (id, customer_id, address, suburb, access, hazards, lat, lng, zoom) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)").bind(id, customerId, p.address, p.suburb, p.access, p.hazards, p.lat, p.lng, p.zoom).run();
  await audit(env, me, "property", id, "create", p);
  return id;
}
__name(createProperty, "createProperty");
async function updateProperty(env, id, p, keepEmpty) {
  const sets = [], vals = [];
  Object.keys(p).forEach((k) => {
    if (p[k] === null || p[k] === "" && keepEmpty) return;
    sets.push(k + " = ?");
    vals.push(p[k]);
  });
  if (!sets.length) return;
  await env.DB.prepare("UPDATE properties SET " + sets.join(", ") + ", updated_at = datetime('now') WHERE id = ?").bind(...vals, id).run();
}
__name(updateProperty, "updateProperty");
async function hedgesOf(env, propertyId) {
  const rows = (await env.DB.prepare(
    "SELECT h.id, h.name, h.species, m.geometry, m.inputs, m.source, m.created_at AS measured_at FROM hedge_assets h LEFT JOIN hedge_measurements m ON m.id = (SELECT id FROM hedge_measurements WHERE hedge_id = h.id ORDER BY created_at DESC, rowid DESC LIMIT 1) WHERE h.property_id = ? AND h.inactive = 0 ORDER BY h.created_at, h.rowid"
  ).bind(propertyId).all()).results;
  return rows.map((r) => ({ id: r.id, name: r.name, species: r.species, geometry: parseJson(r.geometry, null), inputs: parseJson(r.inputs, {}), source: r.source, measuredAt: r.measured_at }));
}
__name(hedgesOf, "hedgesOf");
async function customersApi(env, me, m, parts, url, body) {
  const id = parts[1];
  if (!id && m === "GET") {
    const q = "%" + str(url.searchParams.get("q"), 80).replace(/[%_]/g, "") + "%";
    const rows = (await env.DB.prepare(
      "SELECT c.id, c.name, c.phone, c.email, c.updated_at, (SELECT address || CASE WHEN suburb != '' THEN ', ' || suburb ELSE '' END FROM properties WHERE customer_id = c.id AND deleted_at IS NULL ORDER BY created_at LIMIT 1) AS address, (SELECT count(*) FROM quotes WHERE customer_id = c.id) AS quotes, (SELECT json_extract(calculation, '$.total') FROM quotes WHERE customer_id = c.id ORDER BY created_at DESC LIMIT 1) AS last_total FROM customers c WHERE c.deleted_at IS NULL AND (c.name LIKE ?1 OR c.phone LIKE ?1 OR c.email LIKE ?1 OR EXISTS (SELECT 1 FROM properties p WHERE p.customer_id = c.id AND (p.address LIKE ?1 OR p.suburb LIKE ?1))) ORDER BY c.updated_at DESC LIMIT 200"
    ).bind(q).all()).results;
    return json({ customers: rows });
  }
  if (!id && m === "POST") {
    const cid = await createCustomer(env, me, customerFields(body));
    const pid = body.property ? await createProperty(env, me, cid, propertyFields(body.property)) : null;
    return json({ id: cid, propertyId: pid });
  }
  const c = await env.DB.prepare("SELECT * FROM customers WHERE id = ? AND deleted_at IS NULL").bind(id).first();
  if (!c) fail(404, "That customer was not found.");
  if (m === "GET") {
    const props = (await env.DB.prepare("SELECT * FROM properties WHERE customer_id = ? AND deleted_at IS NULL ORDER BY created_at").bind(id).all()).results;
    for (const p of props) p.hedges = await hedgesOf(env, p.id);
    const quotes = (await env.DB.prepare("SELECT id, number, status, revision, property_id, valid_until, created_at, updated_at, json_extract(calculation, '$.total') AS total, json_extract(calculation, '$.area') AS area FROM quotes WHERE customer_id = ? ORDER BY created_at DESC").bind(id).all()).results;
    return json({ customer: c, properties: props, quotes });
  }
  if (m === "PUT") {
    const f = customerFields(Object.assign({}, c, body));
    if (!f.name) fail(400, "The customer needs a name.");
    await env.DB.prepare("UPDATE customers SET name = ?, email = ?, phone = ?, source = ?, notes = ?, updated_at = datetime('now') WHERE id = ?").bind(f.name, f.email, f.phone, f.source, f.notes, id).run();
    await audit(env, me, "customer", id, "update", f);
    return json({ ok: true });
  }
  if (m === "DELETE") {
    await env.DB.prepare("UPDATE customers SET deleted_at = datetime('now') WHERE id = ?").bind(id).run();
    await audit(env, me, "customer", id, "delete", {});
    return json({ ok: true });
  }
  fail(404, "Not found.");
}
__name(customersApi, "customersApi");
async function propertiesApi(env, me, m, parts, body) {
  const id = parts[1];
  if (!id && m === "POST") {
    const c = await env.DB.prepare("SELECT id FROM customers WHERE id = ? AND deleted_at IS NULL").bind(str(body.customer_id)).first();
    if (!c) fail(404, "That customer was not found.");
    return json({ id: await createProperty(env, me, c.id, propertyFields(body)) });
  }
  const p = await env.DB.prepare("SELECT * FROM properties WHERE id = ? AND deleted_at IS NULL").bind(id).first();
  if (!p) fail(404, "That property was not found.");
  if (m === "GET") {
    const c = await env.DB.prepare("SELECT * FROM customers WHERE id = ?").bind(p.customer_id).first();
    return json({ property: p, customer: c, hedges: await hedgesOf(env, id) });
  }
  if (m === "PUT") {
    await updateProperty(env, id, propertyFields(Object.assign({}, p, body)), false);
    await audit(env, me, "property", id, "update", body);
    return json({ ok: true });
  }
  if (m === "DELETE") {
    await env.DB.prepare("UPDATE properties SET deleted_at = datetime('now') WHERE id = ?").bind(id).run();
    return json({ ok: true });
  }
  fail(404, "Not found.");
}
__name(propertiesApi, "propertiesApi");
function cleanHedge(h) {
  const faces = {};
  Rates.FACES.forEach((f) => {
    faces[f.id] = !!(h.faces && h.faces[f.id]);
  });
  const g = h.geometry && (h.geometry.type === "LineString" || h.geometry.type === "Polygon") && Array.isArray(h.geometry.coordinates) ? h.geometry : null;
  return {
    assetId: str(h.assetId, 40) || null,
    name: str(h.name, 80) || "Hedge",
    species: str(h.species, 80),
    inputs: { length: numOrNull(h.length) || 0, height: numOrNull(h.height) || 0, depth: numOrNull(h.depth) || 0, faces, condition: str(h.condition, 40) || "maintained", measuredLength: numOrNull(h.measuredLength), measuredArea: numOrNull(h.measuredArea) },
    geometry: g,
    source: g ? "map" : "manual"
  };
}
__name(cleanHedge, "cleanHedge");
async function nextNumber(env) {
  const year = (/* @__PURE__ */ new Date()).getFullYear(), prefix = "Q" + year + "-";
  const row = await env.DB.prepare("SELECT number FROM quotes WHERE number LIKE ? ORDER BY number DESC LIMIT 1").bind(prefix + "%").first();
  const n = row ? (parseInt(row.number.slice(prefix.length), 10) || 0) + 1 : 1;
  return prefix + String(n).padStart(4, "0");
}
__name(nextNumber, "nextNumber");
async function quoteOut(env, q) {
  const c = await env.DB.prepare("SELECT * FROM customers WHERE id = ?").bind(q.customer_id).first();
  const p = await env.DB.prepare("SELECT * FROM properties WHERE id = ?").bind(q.property_id).first();
  return { quote: Object.assign({}, q, { hedges: parseJson(q.hedges, []), calculation: parseJson(q.calculation, {}) }), customer: c, property: p };
}
__name(quoteOut, "quoteOut");
async function quotesApi(env, me, m, parts, body) {
  const id = parts[1];
  if (id && m === "GET") {
    const q = await env.DB.prepare("SELECT * FROM quotes WHERE id = ?").bind(id).first();
    if (!q) fail(404, "That quote was not found.");
    return json(await quoteOut(env, q));
  }
  if (id && parts[2] === "status" && m === "PUT") {
    if (STATUSES.indexOf(body.status) < 0) fail(400, "Unknown status.");
    await env.DB.prepare("UPDATE quotes SET status = ?, updated_at = datetime('now') WHERE id = ?").bind(body.status, id).run();
    await audit(env, me, "quote", id, "status", { status: body.status });
    return json({ ok: true });
  }
  if (!id && m === "POST") return saveQuote(env, me, body);
  fail(404, "Not found.");
}
__name(quotesApi, "quotesApi");
async function saveQuote(env, me, body) {
  const existing = body.id ? await env.DB.prepare("SELECT * FROM quotes WHERE id = ?").bind(str(body.id, 40)).first() : null;
  if (body.id && !existing) fail(404, "That quote was not found.");
  let customerId = str(body.customerId, 40) || existing && existing.customer_id || "";
  const cf = customerFields(body.customer || {});
  if (customerId) {
    const c = await env.DB.prepare("SELECT * FROM customers WHERE id = ? AND deleted_at IS NULL").bind(customerId).first();
    if (!c) fail(404, "That customer was not found.");
    if (body.customer) {
      const f = customerFields(Object.assign({}, c, Object.fromEntries(Object.entries(body.customer).filter(([, v]) => v !== "" && v != null))));
      await env.DB.prepare("UPDATE customers SET name = ?, email = ?, phone = ?, updated_at = datetime('now') WHERE id = ?").bind(f.name, f.email, f.phone, customerId).run();
    }
  } else customerId = await createCustomer(env, me, cf);
  let propertyId = str(body.propertyId, 40) || existing && existing.property_id || "";
  const pf = propertyFields(body.property || {});
  if (propertyId) {
    const p = await env.DB.prepare("SELECT id, customer_id FROM properties WHERE id = ? AND deleted_at IS NULL").bind(propertyId).first();
    if (!p || p.customer_id !== customerId) fail(400, "That property belongs to another customer.");
    await updateProperty(env, propertyId, pf, true);
  } else {
    if (!pf.address) fail(400, "Type the property address.");
    propertyId = await createProperty(env, me, customerId, pf);
  }
  const hedges = (Array.isArray(body.hedges) ? body.hedges : []).slice(0, 100).map(cleanHedge);
  if (!hedges.length) fail(400, "Add at least one hedge.");
  const latest = {};
  (await hedgesOf(env, propertyId)).forEach((h) => {
    latest[h.id] = h;
  });
  const stmts = [];
  for (const h of hedges) {
    if (!h.assetId || !latest[h.assetId]) {
      h.assetId = newId("hdg");
      stmts.push(env.DB.prepare("INSERT INTO hedge_assets (id, property_id, name, species) VALUES (?, ?, ?, ?)").bind(h.assetId, propertyId, h.name, h.species || null));
    } else if (latest[h.assetId].name !== h.name || (latest[h.assetId].species || "") !== h.species) {
      stmts.push(env.DB.prepare("UPDATE hedge_assets SET name = ?, species = ?, updated_at = datetime('now') WHERE id = ?").bind(h.name, h.species || null, h.assetId));
    }
    const prev = latest[h.assetId];
    if (!prev || JSON.stringify(prev.inputs) !== JSON.stringify(h.inputs) || JSON.stringify(prev.geometry) !== JSON.stringify(h.geometry)) {
      stmts.push(env.DB.prepare("INSERT INTO hedge_measurements (id, hedge_id, geometry, inputs, source, measured_by) VALUES (?, ?, ?, ?, ?, ?)").bind(newId("msr"), h.assetId, h.geometry ? JSON.stringify(h.geometry) : null, JSON.stringify(h.inputs), h.source, me.id));
    }
  }
  const rates = await activeRates(env);
  const options = { removeWaste: !!(body.options && body.options.removeWaste), travelKm: numOrNull(body.options && body.options.travelKm) || 0 };
  const calc = Rates.quoteCalc(rates, hedges.map((h) => h.inputs), options);
  calc.options = options;
  const hedgesJson = JSON.stringify(hedges), calcJson = JSON.stringify(calc), notes = str(body.notes, 4e3);
  const status = STATUSES.indexOf(body.status) >= 0 ? body.status : existing ? existing.status : "Draft";
  const days = (await business(env)).quoteValidityDays || 30;
  const validUntil = new Date(Date.now() + days * 864e5).toISOString().slice(0, 10);
  let qid, number, revision;
  if (existing) {
    qid = existing.id;
    number = existing.number;
    revision = existing.revision + 1;
    stmts.push(env.DB.prepare("UPDATE quotes SET hedges = ?, calculation = ?, notes = ?, status = ?, revision = ?, valid_until = ?, updated_at = datetime('now') WHERE id = ?").bind(hedgesJson, calcJson, notes, status, revision, validUntil, qid));
  } else {
    qid = newId("quo");
    number = await nextNumber(env);
    revision = 1;
    stmts.push(env.DB.prepare("INSERT INTO quotes (id, number, customer_id, property_id, status, revision, hedges, calculation, notes, valid_until, created_by) VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?)").bind(qid, number, customerId, propertyId, status, hedgesJson, calcJson, notes, validUntil, me.id));
  }
  stmts.push(env.DB.prepare("INSERT INTO quote_revisions (id, quote_id, revision, snapshot, created_by) VALUES (?, ?, ?, ?, ?)").bind(newId("rev"), qid, revision, JSON.stringify({ hedges, calculation: calc, notes, status }), me.id));
  await env.DB.batch(stmts);
  await audit(env, me, "quote", qid, existing ? "update" : "create", { number, revision, total: calc.total });
  const q = await env.DB.prepare("SELECT * FROM quotes WHERE id = ?").bind(qid).first();
  return json(await quoteOut(env, q));
}
__name(saveQuote, "saveQuote");

// ../../../tmp/claude-0/-home-user/352aacb4-1dc6-51dd-89bb-2e3c2720752a/scratchpad/wr/node_modules/wrangler/templates/middleware/middleware-ensure-req-body-drained.ts
var drainBody = /* @__PURE__ */ __name(async (request, env, _ctx, middlewareCtx) => {
  try {
    return await middlewareCtx.next(request, env);
  } finally {
    try {
      if (request.body !== null && !request.bodyUsed) {
        const reader = request.body.getReader();
        while (!(await reader.read()).done) {
        }
      }
    } catch (e) {
      console.error("Failed to drain the unused request body.", e);
    }
  }
}, "drainBody");
var middleware_ensure_req_body_drained_default = drainBody;

// ../../../tmp/claude-0/-home-user/352aacb4-1dc6-51dd-89bb-2e3c2720752a/scratchpad/wr/node_modules/wrangler/templates/middleware/middleware-miniflare3-json-error.ts
function reduceError(e) {
  return {
    name: e?.name,
    message: e?.message ?? String(e),
    stack: e?.stack,
    cause: e?.cause === void 0 ? void 0 : reduceError(e.cause)
  };
}
__name(reduceError, "reduceError");
var jsonError = /* @__PURE__ */ __name(async (request, env, _ctx, middlewareCtx) => {
  try {
    return await middlewareCtx.next(request, env);
  } catch (e) {
    const error = reduceError(e);
    const body = JSON.stringify(error);
    const headers = {
      "Content-Type": "application/json",
      "MF-Experimental-Error-Stack": "true"
    };
    const encoded = encodeURIComponent(body);
    if (encoded.length <= 8192) {
      headers["MF-Experimental-Error-Stack-Payload"] = encoded;
    }
    return new Response(body, { status: 500, headers });
  }
}, "jsonError");
var middleware_miniflare3_json_error_default = jsonError;

// .wrangler/tmp/bundle-U4cHGT/middleware-insertion-facade.js
var __INTERNAL_WRANGLER_MIDDLEWARE__ = [
  middleware_ensure_req_body_drained_default,
  middleware_miniflare3_json_error_default
];
var middleware_insertion_facade_default = worker_default;

// ../../../tmp/claude-0/-home-user/352aacb4-1dc6-51dd-89bb-2e3c2720752a/scratchpad/wr/node_modules/wrangler/templates/middleware/common.ts
var __facade_middleware__ = [];
function __facade_register__(...args) {
  __facade_middleware__.push(...args.flat());
}
__name(__facade_register__, "__facade_register__");
function __facade_invokeChain__(request, env, ctx, dispatch, middlewareChain) {
  const [head, ...tail] = middlewareChain;
  const middlewareCtx = {
    dispatch,
    next(newRequest, newEnv) {
      return __facade_invokeChain__(newRequest, newEnv, ctx, dispatch, tail);
    }
  };
  return head(request, env, ctx, middlewareCtx);
}
__name(__facade_invokeChain__, "__facade_invokeChain__");
function __facade_invoke__(request, env, ctx, dispatch, finalMiddleware) {
  return __facade_invokeChain__(request, env, ctx, dispatch, [
    ...__facade_middleware__,
    finalMiddleware
  ]);
}
__name(__facade_invoke__, "__facade_invoke__");

// .wrangler/tmp/bundle-U4cHGT/middleware-loader.entry.ts
var __Facade_ScheduledController__ = class ___Facade_ScheduledController__ {
  constructor(scheduledTime, cron, noRetry) {
    this.scheduledTime = scheduledTime;
    this.cron = cron;
    this.#noRetry = noRetry;
  }
  scheduledTime;
  cron;
  static {
    __name(this, "__Facade_ScheduledController__");
  }
  #noRetry;
  noRetry() {
    if (!(this instanceof ___Facade_ScheduledController__)) {
      throw new TypeError("Illegal invocation");
    }
    this.#noRetry();
  }
};
function wrapExportedHandler(worker) {
  if (__INTERNAL_WRANGLER_MIDDLEWARE__ === void 0 || __INTERNAL_WRANGLER_MIDDLEWARE__.length === 0) {
    return worker;
  }
  for (const middleware of __INTERNAL_WRANGLER_MIDDLEWARE__) {
    __facade_register__(middleware);
  }
  const fetchDispatcher = /* @__PURE__ */ __name(function(request, env, ctx) {
    if (worker.fetch === void 0) {
      throw new Error("Handler does not export a fetch() function.");
    }
    return worker.fetch(request, env, ctx);
  }, "fetchDispatcher");
  return {
    ...worker,
    fetch(request, env, ctx) {
      const dispatcher = /* @__PURE__ */ __name(function(type, init) {
        if (type === "scheduled" && worker.scheduled !== void 0) {
          const controller = new __Facade_ScheduledController__(
            Date.now(),
            init.cron ?? "",
            () => {
            }
          );
          return worker.scheduled(controller, env, ctx);
        }
      }, "dispatcher");
      return __facade_invoke__(request, env, ctx, dispatcher, fetchDispatcher);
    }
  };
}
__name(wrapExportedHandler, "wrapExportedHandler");
function wrapWorkerEntrypoint(klass) {
  if (__INTERNAL_WRANGLER_MIDDLEWARE__ === void 0 || __INTERNAL_WRANGLER_MIDDLEWARE__.length === 0) {
    return klass;
  }
  for (const middleware of __INTERNAL_WRANGLER_MIDDLEWARE__) {
    __facade_register__(middleware);
  }
  return class extends klass {
    #fetchDispatcher = /* @__PURE__ */ __name((request, env, ctx) => {
      this.env = env;
      this.ctx = ctx;
      if (super.fetch === void 0) {
        throw new Error("Entrypoint class does not define a fetch() function.");
      }
      return super.fetch(request);
    }, "#fetchDispatcher");
    #dispatcher = /* @__PURE__ */ __name((type, init) => {
      if (type === "scheduled" && super.scheduled !== void 0) {
        const controller = new __Facade_ScheduledController__(
          Date.now(),
          init.cron ?? "",
          () => {
          }
        );
        return super.scheduled(controller);
      }
    }, "#dispatcher");
    fetch(request) {
      return __facade_invoke__(
        request,
        this.env,
        this.ctx,
        this.#dispatcher,
        this.#fetchDispatcher
      );
    }
  };
}
__name(wrapWorkerEntrypoint, "wrapWorkerEntrypoint");
var WRAPPED_ENTRY;
if (typeof middleware_insertion_facade_default === "object") {
  WRAPPED_ENTRY = wrapExportedHandler(middleware_insertion_facade_default);
} else if (typeof middleware_insertion_facade_default === "function") {
  WRAPPED_ENTRY = wrapWorkerEntrypoint(middleware_insertion_facade_default);
}
var middleware_loader_entry_default = WRAPPED_ENTRY;
export {
  __INTERNAL_WRANGLER_MIDDLEWARE__,
  middleware_loader_entry_default as default
};
//# sourceMappingURL=index.js.map
