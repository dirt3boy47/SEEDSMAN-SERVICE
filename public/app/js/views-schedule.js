/* Seedsman Quote — Schedule: drag accepted quotes onto the calendar.
   Job time = man-hours ÷ men. Jobs a crew does on the same day are spaced by the driving time between the properties;
   jobs placed straight after another stay attached and move with it. */
(function () {
  'use strict';
  var icon = App.icon, esc = App.esc, money = App.money;
  var HOUR = 56, ZOOMS = [26, 38, 56, 76], SNAP = 15, STATUSES = ['Scheduled', 'In progress', 'Completed', 'Cancelled'];
  var D2R = Math.PI / 180;

  // ---------------- time helpers (local wall-clock, 'YYYY-MM-DDTHH:MM') ----------------
  function iso(d) { return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
  function addDays(dateKey, n) { var d = new Date(dateKey + 'T00:00:00'); d.setDate(d.getDate() + n); return iso(d); }
  function monday(dateKey) { var d = new Date(dateKey + 'T00:00:00'); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return iso(d); }
  function hm(s) { var p = s.split(':'); return +p[0] * 60 + +p[1]; }
  function split(local) { return { date: local.slice(0, 10), min: hm(local.slice(11, 16)) }; }
  function local(dateKey, min) {
    var d = new Date(dateKey + 'T00:00:00'); d.setMinutes(min);
    return iso(d) + 'T' + String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
  }
  function clock(min) { var h = Math.floor(min / 60) % 24, m = Math.round(min % 60); return (h % 12 || 12) + (m ? ':' + String(m).padStart(2, '0') : '') + (h < 12 ? 'am' : 'pm'); }
  function dur(min) { var h = Math.floor(min / 60), m = Math.round(min % 60); return (h ? h + ' h' : '') + (h && m ? ' ' : '') + (m ? m + ' min' : h ? '' : '0 min'); }
  function ceilTo(n, step) { return Math.ceil(n / step - 1e-9) * step; }
  function firstOfMonth(dateKey) { return dateKey.slice(0, 8) + '01'; }
  function addMonths(dateKey, n) { var d = new Date(firstOfMonth(dateKey) + 'T00:00:00'); d.setMonth(d.getMonth() + n); return iso(d); }
  function pref(k, v) { try { if (v === undefined) return localStorage.getItem('seedsman-cal-' + k); localStorage.setItem('seedsman-cal-' + k, v); } catch (e) { return null; } }

  App.route('/schedule', 'schedule', function (ctx) {
    var S = { start: monday(ctx.query.date || iso(new Date())), days: 7, jobs: [], waiting: [], parked: [], settings: null, depot: null, crew: 'Crew 1', crews: ['Crew 1'], road: {}, provider: 'osrm',
      view: ['day', 'week', 'month'].indexOf(pref('view')) >= 0 ? pref('view') : 'week' };
    HOUR = ZOOMS.indexOf(+pref('zoom')) >= 0 ? +pref('zoom') : 56;
    if (S.view === 'month') S.start = firstOfMonth(ctx.query.date || iso(new Date()));
    else if (S.view === 'day') S.start = ctx.query.date || iso(new Date());
    App.me().then(function (me) { S.provider = ((me.business || {}).routing || {}).provider || 'osrm'; });
    var el = ctx.el, drag = null;
    el.className = 'wide';
    if (ctx.query.date) S.focus = ctx.query.date;

    function settings() { return S.settings || { dayStart: '07:00', dayEnd: '17:00', speedKmh: 40, roadFactor: 1.35, bufferMinutes: 5, workDays: [1, 2, 3, 4, 5] }; }
    function dayLen() { var st = settings(); return hm(st.dayEnd) - hm(st.dayStart); }
    function daysFor(mh, men) { var t = ceilTo((mh || 0) / Math.max(1, men) * 60, SNAP), L = dayLen(); return t <= L + 30 ? 1 : Math.ceil((t - 30) / L - 1e-9); }
    function range() { var st = settings(), from = Math.max(0, Math.floor(hm(st.dayStart) / 60) * 60 - 60); if (S.minFrom != null) from = Math.max(0, Math.min(from, S.minFrom)); return { from: from, to: Math.min(24 * 60, Math.ceil(hm(st.dayEnd) / 60) * 60 + 120) }; }
    function daysFit() { var w = el.querySelector('.cal') ? el.querySelector('.cal').clientWidth : window.innerWidth; return Math.max(1, Math.min(7, Math.floor((w - 56) / 96))); }

    // ---------------- model ----------------
    function jobDur(j) {
      var mh = j.flow ? (j.flowTotal || j.manHours) : j.manHours;
      var full = mh ? Math.max(SNAP, ceilTo(mh / Math.max(1, j.men) * 60, SNAP)) : Math.max(SNAP, j.endMin - j.startMin);
      if (!j.flow) return full;
      var cap = hm(settings().dayEnd) - j.startMin; // same rule as the server: up to 30 min over stays on one day
      return full <= cap + 30 || cap < 30 ? full : cap;
    }
    function isHead(j) { return !(j.parts > 1) || j.id === j.head; }
    function pairKey(a, b, date) { return a.lat.toFixed(4) + ',' + a.lng.toFixed(4) + '>' + b.lat.toFixed(4) + ',' + b.lng.toFixed(4) + '@' + date; }
    function roadKey(a, b, date, min) { return pairKey(a, b, date) + 'T' + String(Math.floor(min / 60)).padStart(2, '0'); }
    function roadFor(a, b, date, min) {
      var k = roadKey(a, b, date, min); if (S.road[k]) return S.road[k];
      var pre = pairKey(a, b, date); for (var kk in S.road) if (kk.indexOf(pre) === 0) return S.road[kk]; // same pair, another hour
      return null;
    }
    /** Road times for consecutive jobs (in the order they'll be laid out), fetched before arranging. */
    function ensureRoads(lists) {
      var legs = [], keys = [];
      lists.forEach(function (list) {
        if (!list) return;
        var want = function (j) { return j.desired != null ? j.desired : j.startMin; }, o = list.slice().sort(function (a, b) { return want(a) - want(b); });
        o.forEach(function (j, i) {
          if (!i) return; var p = o[i - 1]; if (p.lat == null || j.lat == null) return;
          var dep = want(p) + jobDur(p), k = roadKey(p, j, j.date, dep);
          if (S.road[k] || keys.indexOf(k) >= 0) return;
          keys.push(k); legs.push({ from: { lat: p.lat, lng: p.lng }, to: { lat: j.lat, lng: j.lng }, depart: local(j.date, Math.min(dep, 1439)) });
        });
      });
      if (!legs.length) return Promise.resolve();
      return App.post('route', { legs: legs }).then(function (d) { (d.legs || []).forEach(function (l, i) { if (l) S.road[keys[i]] = l; }); }).catch(function () { /* estimates are used */ });
    }
    function travel(a, b, date, departMin) {
      var st = settings();
      if (a.lat == null || b.lat == null) return { min: 15, guess: true };
      var r = date != null ? roadFor(a, b, date, departMin) : null;
      if (r) return { min: r.km < 0.05 ? 0 : ceilTo(r.min + st.bufferMinutes, 5), low: Math.round(r.low != null ? r.low : r.min), high: Math.round(r.high != null ? r.high : r.min), km: r.km, source: r.source };
      var dLat = (b.lat - a.lat) * D2R, dLng = (b.lng - a.lng) * D2R;
      var h = Math.sin(dLat / 2) * Math.sin(dLat / 2) + Math.cos(a.lat * D2R) * Math.cos(b.lat * D2R) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
      var km = 2 * 6371 * Math.asin(Math.min(1, Math.sqrt(h))) * st.roadFactor;
      return { min: km < 0.05 ? 0 : ceilTo(km / Math.max(5, st.speedKmh) * 60 + st.bufferMinutes, 5), km: km };
    }
    function fromServer(j) {
      var s = split(j.start), e = split(j.end);
      return { id: j.id, quote_id: j.quote_id, quote_number: j.quote_number, customer: j.customer, phone: j.phone, address: j.address, suburb: j.suburb, lat: j.lat, lng: j.lng,
        crew: j.crew, men: j.men || j.crew_size || 2, manHours: j.work_hours != null ? +j.work_hours : null, date: s.date, startMin: s.min, endMin: e.date === s.date ? e.min : e.min + 1440,
        travel: j.travel_minutes || 0, status: j.status, total: j.total, services: j.services, notes: j.notes, actual: j.actual_hours,
        project: j.project_id, part: j.part || 1, parts: j.parts || 1, head: j.project_head, openHours: j.project_open_hours != null ? +j.project_open_hours : null, projectHours: j.project_hours != null ? +j.project_hours : null };
    }
    /** A day's share of the job's price: a job split over days is shared out by man-hours, so it isn't counted twice. */
    function value(j) { return j.parts > 1 && j.projectHours && j.manHours ? (+j.total || 0) * j.manHours / j.projectHours : +j.total || 0; }
    function dayTotals(d) { var list = S.jobs.filter(function (j) { return j.date === d; }); return { n: list.length, value: list.reduce(function (a, j) { return a + value(j); }, 0), mh: list.reduce(function (a, j) { return a + (j.manHours || 0); }, 0) }; }
    function group(date, crew, except) { return S.jobs.filter(function (j) { return j.date === date && j.crew === crew && j !== except; }).sort(function (a, b) { return a.startMin - b.startMin; }); }
    /** Lay out one crew's day. Each job keeps its chosen start unless it would overlap the previous job plus the drive;
        jobs that sat straight after the previous one (attached) stay attached. */
    function arrange(list) {
      var prev = null;
      list.sort(function (a, b) { return (a.desired != null ? a.desired : a.startMin) - (b.desired != null ? b.desired : b.startMin); });
      list.forEach(function (j, i) {
        var t = prev ? travel(prev, j, j.date, prev.endMin) : { min: 0 }, earliest = prev ? prev.endMin + t.min : -Infinity;
        var want = j.desired != null ? j.desired : j.startMin;
        j.startMin = j.attached && prev ? earliest : Math.max(want, earliest);
        j.endMin = j.startMin + jobDur(j); j.travel = t.min; j.guess = !!t.guess; j.travelInfo = prev ? t : null; j.seq = i;
        delete j.desired; delete j.attached; prev = j;
      });
      return list;
    }
    /** Mark jobs that currently start right after the previous job's drive, so they follow it. */
    function markAttached(list) {
      var prev = null;
      list.slice().sort(function (a, b) { return a.startMin - b.startMin; }).forEach(function (j) {
        j.attached = !!prev && Math.abs(j.startMin - (prev.endMin + (j.travel || 0))) <= 1; prev = j;
      });
    }
    function payload(list) {
      return list.map(function (j) {
        var o = { id: j.id || undefined, quote_id: j.id ? undefined : j.quote_id, start: local(j.date, j.startMin), end: local(j.date, j.endMin), crew: j.crew, men: j.men, man_hours: j.manHours, travel_minutes: j.travel, sequence: j.seq };
        if (j.flow) { o.flow = true; o.flow_total = j.flowTotal || j.manHours; delete j.flow; delete j.flowTotal; }
        return o;
      });
    }
    function toastFlow(flowed) {
      var big = (Array.isArray(flowed) ? flowed : flowed ? [flowed] : []).filter(function (f) { return f.days.length > 1 || f.parts > 1; })[0];
      if (!big) return false;
      App.toast(big.customer + ' — ' + (big.days.length > 1 ? big.days.length + ' days to go: ' : 'next day: ') + big.days.map(function (d) { return new Date(d.slice(0, 10) + 'T00:00:00').toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short' }); }).join(', ') + '.', null, 7000);
      return true;
    }
    function apply(list, msg) {
      if (!list.length) { load(); return Promise.resolve(); }
      return App.post('schedule/apply', { jobs: payload(list) }).then(function (r) {
        if (!toastFlow(r.flowed) && msg) App.toast(msg);
        return load();
      })
        .catch(function (e) { App.toast(e.message, 'err', 6000); return load(); });
    }

    // ---------------- loading ----------------
    /** First day shown and how many: a week (or as many days as fit), one day, or the weeks covering a month. */
    function span() {
      if (S.view === 'month') { var a = monday(S.start), last = addDays(addMonths(S.start, 1), -1), n = 0; while (addDays(a, n) <= last) n += 7; return { from: a, days: n }; }
      return { from: S.start, days: S.view === 'day' ? 1 : 7 };
    }
    function load() {
      if (!el.isConnected) return Promise.resolve();
      var sp = span(), to = addDays(sp.from, sp.days);
      return App.get('schedule?from=' + sp.from + 'T00:00&to=' + to + 'T00:00').then(function (d) {
        if (!el.isConnected) return;
        S.settings = d.settings; S.depot = d.depot; S.waiting = d.waiting; S.parked = (d.parked || []).map(fromServer);
        S.jobs = d.jobs.map(fromServer);
        var crews = {}; S.jobs.forEach(function (j) { crews[j.crew] = 1; }); S.crews.forEach(function (c) { crews[c] = 1; });
        S.crews = Object.keys(crews).sort();
        render();
        if (S.view !== 'month') ensureBaseRoads(); // month view has no drive blocks — don't ask for dozens of routes
      }).catch(function (e) { App.toast(e.message, 'err'); });
    }

    // ---------------- rendering ----------------
    function top() {
      var end = addDays(S.start, S.days - 1), a = new Date(S.start + 'T00:00:00'), b = new Date(end + 'T00:00:00');
      var sub = S.view === 'month' ? a.toLocaleDateString('en-AU', { month: 'long', year: 'numeric' }) : S.days > 1 ? a.toLocaleDateString('en-AU', { day: 'numeric', month: 'short' }) + ' – ' + b.toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' }) : a.toLocaleDateString('en-AU', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
      App.setTop({ el: el, title: 'Schedule', sub: sub,
        actions: '<button class="ib" id="prev" title="Back">' + icon('back') + '</button><button class="btn sm" id="today">Today</button><button class="ib" id="next" title="Forward">' + icon('chev') + '</button>' +
          '<button class="ib" id="sset" title="Working day and travel">' + icon('gear') + '</button>' });
      document.getElementById('prev').onclick = function () { S.start = S.view === 'month' ? addMonths(S.start, -1) : addDays(S.start, -S.days); load(); };
      document.getElementById('next').onclick = function () { S.start = S.view === 'month' ? addMonths(S.start, 1) : addDays(S.start, S.days); load(); };
      document.getElementById('today').onclick = function () { var t = iso(new Date()); S.start = S.view === 'month' ? firstOfMonth(t) : S.view === 'week' && S.days === 7 ? monday(t) : t; renderCal.scrolled = false; load(); };
      document.getElementById('sset').onclick = settingsModal;
    }
    function render() {
      if (!el.isConnected) return;
      if (!el.querySelector('.sched')) {
        el.innerHTML = '<div class="sched"><div class="card cal"><div class="cal-bar"><div class="seg sm" id="cal-view">' + [['day', 'Day'], ['week', 'Week'], ['month', 'Month']].map(function (v) { return '<button type="button" data-v="' + v[0] + '">' + v[1] + '</button>'; }).join('') + '</div>' +
          '<span class="zoom" id="zoom"><button class="ib sm" data-z="-1" title="Zoom out — see more of the day">−</button><button class="ib sm" data-z="1" title="Zoom in">+</button></span><span class="muted small" id="wk-sum"></span><a class="link small" href="#/settings" id="no-base" hidden>Set your home base to show the drive out and back</a><span class="spacer"></span><label class="small muted" for="crew-sel">Drop onto</label><select id="crew-sel" class="input" style="width:auto;min-height:34px;padding:5px 8px"></select></div><div class="cal-head" id="cal-head"></div><div class="cal-body" id="cal-body"></div><div class="cal-foot" id="cal-foot"></div></div>' +
          '<aside class="card tray"><div class="card-h"><h2>To schedule <span class="tag" id="tray-n"></span></h2><button class="btn sm" id="tray-add" title="Accept a draft or sent quote">' + icon('plus') + 'Add</button></div><p class="muted small tray-hint">Accepted quotes. Drag one onto a day — it books the estimated man-hours with the crew size shown.</p><div class="tray-list" id="tray"></div></aside></div>';
        el.querySelector('#crew-sel').onchange = function (e) {
          if (e.target.value === '__new') { var n = prompt('Name of the new crew:', 'Crew ' + (S.crews.length + 1)); if (n) { S.crews.push(n.trim()); S.crew = n.trim(); } renderCrews(); return; }
          S.crew = e.target.value;
        };
        el.querySelector('#tray-add').onclick = addAccepted;
        el.querySelector('#cal-body').addEventListener('scroll', function () { var x = el.querySelector('#cal-body').scrollLeft; el.querySelector('#cal-head').scrollLeft = x; el.querySelector('#cal-foot').scrollLeft = x; });
        el.querySelector('#cal-view').onclick = function (e) { var b = e.target.closest('[data-v]'); if (b) setView(b.getAttribute('data-v')); };
        el.querySelector('#zoom').onclick = function (e) {
          var b = e.target.closest('[data-z]'); if (!b) return;
          var i = Math.max(0, Math.min(ZOOMS.length - 1, ZOOMS.indexOf(HOUR) + +b.getAttribute('data-z'))); if (ZOOMS[i] === HOUR) return;
          HOUR = ZOOMS[i]; pref('zoom', HOUR); renderCal.scrolled = false; renderCal();
        };
      }
      if (S.view === 'week') { var fit = daysFit(); if (fit !== S.days) { S.days = fit; if (fit === 7) S.start = monday(S.start); else if (S.focus) { S.start = S.focus; } } }
      else S.days = S.view === 'day' ? 1 : span().days;
      S.focus = null;
      el.querySelectorAll('#cal-view [data-v]').forEach(function (b) { b.classList.toggle('on', b.getAttribute('data-v') === S.view); });
      el.querySelector('#zoom').hidden = S.view === 'month';
      top(); renderCrews(); renderTray(); renderCal();
    }
    function setView(v) {
      if (v === S.view) return;
      var t = iso(new Date()), sp = span(), inView = t >= sp.from && t < addDays(sp.from, sp.days), anchor = inView ? t : S.view === 'month' ? S.start : S.start;
      S.view = v; pref('view', v); renderCal.scrolled = false;
      S.start = v === 'month' ? firstOfMonth(anchor) : v === 'day' ? anchor : monday(anchor);
      load();
    }
    function renderCrews() {
      var sel = el.querySelector('#crew-sel');
      sel.innerHTML = S.crews.map(function (c) { return '<option' + (c === S.crew ? ' selected' : '') + '>' + esc(c) + '</option>'; }).join('') + '<option value="__new">+ New crew…</option>';
    }
    function renderTray() {
      el.querySelector('#tray-n').textContent = S.waiting.length + S.parked.length;
      var parkedHtml = S.parked.map(function (j) {
        var t = ceilTo((j.manHours || 1) / Math.max(1, j.men) * 60, SNAP);
        return '<div class="tcard parked" data-pj="' + esc(j.id) + '"><span class="grip" title="Drag onto the calendar">' + icon('grip') + '</span><div class="grow"><b><span class="daytag">Day ' + j.part + '/' + j.parts + '</span>' + esc(j.customer) + '</b><small>' + esc(j.suburb || j.address) + ' · ' + esc(j.quote_number) + '</small>' +
          '<div class="tmeta"><span class="tag">' + (Math.round((j.manHours || 0) * 100) / 100) + ' man-h</span><span class="tag">' + j.men + ' men → ' + dur(t) + '</span><span class="tag info">Waiting for a day</span></div></div><b class="num">' + money(value(j), 0) + '</b></div>';
      }).join('');
      el.querySelector('#tray').innerHTML = parkedHtml + (S.waiting.length ? S.waiting.map(function (q) {
        var men = q.crew_size || 2, mh = +q.man_hours || 0, t = ceilTo(mh / men * 60, SNAP);
        return '<div class="tcard' + (ctx.query.quote === q.id ? ' flash' : '') + '" data-q="' + esc(q.id) + '"><span class="grip" title="Drag onto the calendar">' + icon('grip') + '</span><div class="grow"><b>' + esc(q.customer) + '</b><small>' + esc(q.suburb || q.address) + ' · ' + esc(q.number) + '</small>' +
          '<small>' + esc((q.services || 'Hedge trimming').replace(/,/g, ', ')) + '</small><div class="tmeta"><span class="tag">' + (mh ? mh + ' man-h' : 'No estimate') + '</span><span class="tag">' + men + ' men → ' + dur(t || 60) + '</span>' + (daysFor(mh, men) > 1 ? '<span class="tag info">' + daysFor(mh, men) + ' days</span>' : '') + (+q.picker ? '<span class="tag warn">Cherry picker</span>' : '') + (q.lat == null ? '<span class="tag warn">No pin</span>' : '') + '</div></div><b class="num">' + money(q.total, 0) + '</b></div>';
      }).join('') : parkedHtml ? '' : '<div class="empty" style="padding:22px 10px">' + icon('check') + '<b>Nothing waiting</b>Accepted quotes appear here, ready to drag onto the calendar. Tap <b>Add</b> to accept a quote the customer said yes to. Drag a day of a job here to take it off the calendar.</div>');
      if (ctx.query.quote) { var f = el.querySelector('.tcard.flash'); if (f) { f.scrollIntoView({ block: 'center' }); App.toast('Drag ' + f.querySelector('b').textContent + ' onto a day to book it.'); } ctx.query.quote = null; }
    }
    // ---------------- drives from and back to the home base ----------------
    function crewDays() { // {date|crew: [jobs in order]}
      var out = {};
      S.jobs.slice().sort(function (a, b) { return a.startMin - b.startMin; }).forEach(function (j) { (out[j.date + '|' + j.crew] = out[j.date + '|' + j.crew] || []).push(j); });
      return out;
    }
    function baseDrives(list) { // {out: {min, leave, ...}, home: {min, back, ...}} for one crew-day
      var dp = S.depot; if (!dp || dp.lat == null || !list.length) return null;
      var first = list[0], last = list[list.length - 1], st = settings(), res = {};
      var leg = function (a, b, min) {
        if (a.lat == null || b.lat == null) return null;
        var r = roadFor(a, b, first.date, min);
        if (!r) { var km = GIS.straightKm(a, b) * st.roadFactor; r = { km: km, min: km / Math.max(5, st.speedKmh) * 60, source: 'estimate' }; }
        return r;
      };
      var o = leg(dp, first, first.startMin - 60), h = leg(last, dp, last.endMin);
      if (o) { var om = ceilTo(o.min + st.bufferMinutes, 5); res.out = { min: om, leave: first.startMin - om, r: o }; }
      if (h) { var hmn = ceilTo(h.min, 5); res.home = { min: hmn, back: last.endMin + hmn, r: h }; }
      return res;
    }
    function ensureBaseRoads() {
      var dp = S.depot; if (!dp || dp.lat == null) return;
      var legs = [], keys = [], days = crewDays();
      Object.keys(days).forEach(function (k) {
        var list = days[k], first = list[0], last = list[list.length - 1];
        if (first.lat != null) { var k1 = roadKey(dp, first, first.date, first.startMin - 60); if (!S.road[k1] && keys.indexOf(k1) < 0) { keys.push(k1); legs.push({ from: { lat: dp.lat, lng: dp.lng }, to: { lat: first.lat, lng: first.lng }, depart: local(first.date, Math.max(0, first.startMin - 60)) }); } }
        if (last.lat != null) { var k2 = roadKey(last, dp, last.date, last.endMin); if (!S.road[k2] && keys.indexOf(k2) < 0) { keys.push(k2); legs.push({ from: { lat: last.lat, lng: last.lng }, to: { lat: dp.lat, lng: dp.lng }, depart: local(last.date, Math.min(1439, last.endMin)) }); } }
      });
      if (!legs.length) return;
      App.post('route', { legs: legs }).then(function (d) { (d.legs || []).forEach(function (l, i) { if (l) S.road[keys[i]] = l; }); if (el.isConnected) renderCal(); }).catch(function () { /* estimates stay */ });
    }

    function renderCal() {
      if (S.view === 'month') return renderMonth();
      // the calendar starts early enough to show the earliest drive from base
      S.minFrom = null;
      var cds = crewDays(), drives = {};
      Object.keys(cds).forEach(function (k) { var b = baseDrives(cds[k]); drives[k] = b; if (b && b.out && b.out.leave < (S.minFrom == null ? 1e9 : S.minFrom)) S.minFrom = Math.floor(b.out.leave / 60) * 60; });
      var r = range(), st = settings(), today = iso(new Date()), days = [];
      for (var i = 0; i < S.days; i++) days.push(addDays(S.start, i));
      var cols = 'grid-template-columns: 56px repeat(' + S.days + ', minmax(92px, 1fr))';
      var total = 0, mh = 0;
      el.querySelector('#cal-head').innerHTML = '<div class="cal-row" style="' + cols + '"><div></div>' + days.map(function (d) {
        var list = S.jobs.filter(function (j) { return j.date === d; }), dt = new Date(d + 'T00:00:00');
        var late = list.filter(function (j) { return j.endMin > hm(st.dayEnd); }).length, hours = list.reduce(function (s, j) { return s + (j.manHours || 0); }, 0);
        list.forEach(function (j) { total += value(j); mh += j.manHours || 0; });
        var leaves = Object.keys(drives).filter(function (k) { return k.indexOf(d + '|') === 0 && drives[k] && drives[k].out; }).map(function (k) { return drives[k].out.leave; });
        var leave = leaves.length ? Math.min.apply(null, leaves) : null;
        return '<div class="cal-dh' + (d === today ? ' today' : '') + '"><div><span>' + dt.toLocaleDateString('en-AU', { weekday: 'short' }) + '</span> <b>' + dt.getDate() + '</b></div>' +
          (leave != null ? '<small' + (leave < hm(st.dayStart) ? ' class="late"' : '') + '>Leave base ' + clock(leave) + '</small>' : '') +
          '<small>' + (list.length ? list.length + ' job' + (list.length === 1 ? '' : 's') + ' · ' + Math.round(hours * 10) / 10 + ' man-h' : '&nbsp;') + '</small>' + (late ? '<small class="late">Runs past ' + clock(hm(st.dayEnd)) + '</small>' : '') +
          (list.length ? '<button class="link small" data-route="' + d + '">' + 'Route</button>' : '') + '</div>';
      }).join('') + '</div>';
      el.querySelector('#no-base').hidden = !!(S.depot && S.depot.lat != null);
      el.querySelector('#wk-sum').textContent = S.jobs.length + ' job' + (S.jobs.length === 1 ? '' : 's') + ' · ' + Math.round(mh * 10) / 10 + ' man-hours · ' + money(total, 0) + ' incl. GST';
      var H = (r.to - r.from) / 60 * HOUR, body = '<div class="cal-row cal-grid" style="' + cols + ';height:' + H + 'px"><div class="cal-gutter">';
      for (var m = r.from; m < r.to; m += 60) body += '<div class="cal-hour" style="top:' + ((m - r.from) / 60 * HOUR) + 'px">' + clock(m) + '</div>';
      body += '</div>' + days.map(function (d) {
        var list = S.jobs.filter(function (j) { return j.date === d; }), crews = [];
        list.forEach(function (j) { if (crews.indexOf(j.crew) < 0) crews.push(j.crew); }); crews.sort();
        var html = '<div class="cal-col' + (d === today ? ' today' : '') + '" data-date="' + d + '">';
        html += '<div class="cal-off" style="top:0;height:' + ((hm(st.dayStart) - r.from) / 60 * HOUR) + 'px"></div><div class="cal-off" style="top:' + ((hm(st.dayEnd) - r.from) / 60 * HOUR) + 'px;bottom:0"></div>';
        for (var mm = r.from; mm < r.to; mm += 60) html += '<div class="cal-line" style="top:' + ((mm - r.from) / 60 * HOUR) + 'px"></div>';
        crews.forEach(function (c, lane) {
          var b = drives[d + '|' + c], cl = cds[d + '|' + c]; if (!b || !cl) return;
          var w = 100 / crews.length, pos = 'left:calc(' + (lane * w) + '% + 3px);width:calc(' + w + '% - 6px);', est = function (x) { return x.r.source === 'estimate' ? ' (estimate)' : x.r.low != null && Math.round(x.r.high) > Math.round(x.r.low) ? ' (drive ' + Math.round(x.r.low) + '–' + Math.round(x.r.high) + ' min)' : ''; };
          if (b.out) {
            var ht = b.out.min / 60 * HOUR;
            html += '<div class="cal-base out" style="' + pos + 'top:' + ((b.out.leave - r.from) / 60 * HOUR) + 'px;height:' + ht + 'px" title="Drive from home base: leave ' + clock(b.out.leave) + ', ' + b.out.min + ' min incl. ' + settings().bufferMinutes + ' min to unload' + est(b.out) + '">' +
              (ht >= 22 ? icon('home') + '<span>Leave ' + clock(b.out.leave) + (ht >= 34 ? ' · ' + b.out.min + ' min' : '') + '</span>' : '') + '</div>';
          }
          if (b.home) {
            var hh = b.home.min / 60 * HOUR;
            html += '<div class="cal-base home" style="' + pos + 'top:' + ((cl[cl.length - 1].endMin - r.from) / 60 * HOUR) + 'px;height:' + hh + 'px" title="Drive back to base: about ' + clock(b.home.back) + est(b.home) + '">' +
              (hh >= 22 ? icon('home') + '<span>Back ' + clock(b.home.back) + (hh >= 34 ? ' · ' + b.home.min + ' min' : '') + '</span>' : '') + '</div>';
          }
        });
        list.forEach(function (j) {
          var lane = crews.indexOf(j.crew), w = 100 / crews.length, top = (j.startMin - r.from) / 60 * HOUR, h = Math.max(26, (j.endMin - j.startMin) / 60 * HOUR - 2);
          var pos = 'left:calc(' + (lane * w) + '% + 3px);width:calc(' + w + '% - 6px);';
          if (j.travel > 0) html += '<div class="cal-travel' + (j.guess ? ' guess' : '') + '" style="' + pos + 'top:' + ((j.startMin - j.travel - r.from) / 60 * HOUR) + 'px;height:' + (j.travel / 60 * HOUR) + 'px" title="Driving from the previous job' + (j.guess ? ' (estimate — a property has no pin)' : '') + '">' + (j.travel >= 15 ? icon('truck') + '<span>' + j.travel + ' min</span>' : '') + '</div>';
          html += '<div class="cal-job s-' + j.status.toLowerCase().replace(/\s+/g, '-') + '" data-j="' + esc(j.id) + '" style="' + pos + 'top:' + top + 'px;height:' + h + 'px">' +
            (j.parts > 1 ? '<span class="daytag">Day ' + j.part + '/' + j.parts + '</span>' : '') + '<b>' + esc(j.customer) + '</b><small class="t">' + clock(j.startMin) + '–' + clock(j.endMin) + '</small>' + (h > 40 ? '<small>' + esc(j.suburb || j.address) + '</small>' : '') +
            (h > 68 ? '<small>' + (j.manHours ? j.manHours + ' man-h · ' : '') + j.men + ' men' + (crews.length > 1 || S.crews.length > 1 ? ' · ' + esc(j.crew) : '') + '</small>' : '') + '</div>';
        });
        return html + '</div>';
      }).join('') + '</div>';
      // totals for each day under the grid
      el.querySelector('#cal-foot').hidden = false;
      el.querySelector('#cal-foot').innerHTML = '<div class="cal-row" style="' + cols + '"><div class="cal-ft-l">Day total</div>' + days.map(function (d) {
        var t = dayTotals(d); return '<div class="cal-ft' + (d === today ? ' today' : '') + '">' + (t.n ? '<b>' + money(t.value, 0) + '</b><small>' + Math.round(t.mh * 10) / 10 + ' man-h · ' + t.n + ' job' + (t.n === 1 ? '' : 's') + '</small>' : '<small>—</small>') + '</div>';
      }).join('') + '</div>';
      var cb = el.querySelector('#cal-body'), keep = cb.scrollTop;
      cb.innerHTML = body;
      if (!renderCal.scrolled) { cb.scrollTop = (hm(st.dayStart) - r.from) / 60 * HOUR - 10; renderCal.scrolled = true; } else cb.scrollTop = keep;
    }

    /** Month: one cell per day with its jobs and total; drag onto a day, tap a date to open that day. */
    function renderMonth() {
      var sp = span(), today = iso(new Date()), month = S.start.slice(0, 7), total = 0, mh = 0, n = 0;
      el.querySelector('#cal-head').innerHTML = '<div class="cal-row mrow">' + ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(function (d) { return '<div class="mdh">' + d + '</div>'; }).join('') + '</div>';
      var html = '<div class="mgrid">';
      for (var i = 0; i < sp.days; i++) {
        var d = addDays(sp.from, i), list = S.jobs.filter(function (j) { return j.date === d; }).sort(function (a, b) { return a.crew < b.crew ? -1 : a.crew > b.crew ? 1 : a.startMin - b.startMin; }), t = dayTotals(d);
        if (d.slice(0, 7) === month) { total += t.value; mh += t.mh; n += t.n; }
        html += '<div class="mcell' + (d.slice(0, 7) !== month ? ' other' : '') + (d === today ? ' today' : '') + '" data-date="' + d + '"><button class="mday" data-day="' + d + '" title="Open this day">' + new Date(d + 'T00:00:00').getDate() + '</button><div class="mjobs">' +
          list.map(function (j) { return '<div class="mchip s-' + j.status.toLowerCase().replace(/\s+/g, '-') + '" data-j="' + esc(j.id) + '">' + (j.parts > 1 ? '<span class="daytag">' + j.part + '/' + j.parts + '</span>' : '') + '<span class="mt">' + clock(j.startMin) + '</span> ' + esc(j.customer) + '</div>'; }).join('') +
          '</div>' + (t.n ? '<div class="mtot"><b class="full">' + money(t.value, 0) + '</b><b class="short">' + (t.value >= 1000 ? '$' + (Math.round(t.value / 100) / 10) + 'k' : money(t.value, 0)) + '</b><span> · ' + Math.round(t.mh * 10) / 10 + ' h</span></div>' : '') + '</div>';
      }
      el.querySelector('#cal-body').innerHTML = html + '</div>';
      el.querySelector('#cal-foot').hidden = true;
      el.querySelector('#no-base').hidden = true;
      el.querySelector('#wk-sum').textContent = n + ' job' + (n === 1 ? '' : 's') + ' this month · ' + Math.round(mh * 10) / 10 + ' man-hours · ' + money(total, 0) + ' incl. GST';
    }
    /** Where a job dropped on a day in month view goes: after the crew's last job that day, or the start of the day. */
    function appendMin(date, crew, except) {
      var list = group(date, crew, except); if (!list.length) return hm(settings().dayStart);
      var last = list[list.length - 1]; return ceilTo(last.endMin + 30, SNAP);
    }

    // ---------------- drag and drop (mouse, finger and pencil) ----------------
    function startDrag(e, info, srcEl) {
      if (e.button != null && e.button !== 0) return;
      drag = { info: info, x0: e.clientX, y0: e.clientY, moved: false, src: srcEl, id: e.pointerId, ghost: null, drop: null, preview: null };
      try { srcEl.setPointerCapture(e.pointerId); } catch (x) { /* ignore */ }
      e.preventDefault();
    }
    function onMove(e) {
      if (!drag || e.pointerId !== drag.id) return;
      if (!drag.moved && Math.hypot(e.clientX - drag.x0, e.clientY - drag.y0) < 6) return;
      if (!drag.moved) {
        drag.moved = true;
        drag.ghost = document.createElement('div'); drag.ghost.className = 'drag-ghost panel';
        drag.ghost.innerHTML = '<b>' + esc(drag.info.label) + '</b><small>' + dur(drag.info.dur) + '</small>';
        document.body.appendChild(drag.ghost); document.body.classList.add('dragging');
        if (drag.info.job) drag.src.classList.add('lifted');
      }
      drag.ghost.style.left = (e.clientX + 12) + 'px'; drag.ghost.style.top = (e.clientY + 10) + 'px';
      var cb = el.querySelector('#cal-body'), rb = cb.getBoundingClientRect();
      if (e.clientY < rb.top + 40) cb.scrollTop -= 12; else if (e.clientY > rb.bottom - 40) cb.scrollTop += 12;
      var under = document.elementFromPoint(e.clientX, e.clientY), col = under && under.closest('.cal-col');
      if (drag.preview) { drag.preview.remove(); drag.preview = null; }
      el.querySelectorAll('.drop-on').forEach(function (x) { x.classList.remove('drop-on'); });
      drag.drop = null;
      var tray = drag.info.job && under && under.closest('.tray');
      if (tray) { tray.classList.add('drop-on'); drag.drop = { tray: true }; return; }
      var cell = under && under.closest('.mcell');
      if (cell) { cell.classList.add('drop-on'); drag.drop = { date: cell.getAttribute('data-date'), min: null }; return; }
      if (!col) return;
      var r = range(), cr = col.getBoundingClientRect(), y = e.clientY - cr.top - (drag.info.grabY || 0);
      var min = Math.max(r.from, Math.min(r.to - SNAP, r.from + Math.round(y / HOUR * 60 / SNAP) * SNAP));
      drag.drop = { date: col.getAttribute('data-date'), min: min };
      drag.preview = document.createElement('div'); drag.preview.className = 'cal-drop';
      drag.preview.style.top = ((min - r.from) / 60 * HOUR) + 'px'; drag.preview.style.height = (drag.info.dur / 60 * HOUR) + 'px';
      drag.preview.innerHTML = '<span>' + clock(min) + '–' + clock(min + drag.info.dur) + '</span>';
      col.appendChild(drag.preview);
    }
    function onUp(e) {
      if (!drag || e.pointerId !== drag.id) return;
      var d = drag; drag = null;
      if (d.ghost) d.ghost.remove(); if (d.preview) d.preview.remove();
      el.querySelectorAll('.drop-on').forEach(function (x) { x.classList.remove('drop-on'); });
      document.body.classList.remove('dragging'); d.src.classList.remove('lifted');
      if (!d.moved) { if (d.info.job) jobModal(d.info.job); return; }
      if (e.type === 'pointercancel' || !d.drop) return;
      if (d.drop.tray) return sendBack(d.info.job);
      var min = d.drop.min;
      if (min == null) min = d.info.job ? d.info.job.startMin : appendMin(d.drop.date, S.crew); // month view keeps the time / goes after the day's jobs
      if (d.info.job) moveJob(d.info.job, d.drop.date, min); else if (d.info.parked) placeParked(d.info.parked, d.drop.date, min); else bookQuote(d.info.quote, d.drop.date, min);
    }
    el.addEventListener('pointerdown', function (e) {
      var card = e.target.closest('.tcard');
      if (card) {
        if (e.pointerType === 'touch' && !e.target.closest('.grip')) return; // on touch screens the grip drags, the rest scrolls the list
        if (card.hasAttribute('data-pj')) {
          var pj = S.parked.filter(function (x) { return x.id === card.getAttribute('data-pj'); })[0];
          startDrag(e, { parked: pj, label: pj.customer + ' · day ' + pj.part, dur: ceilTo((pj.manHours || 1) / Math.max(1, pj.men) * 60, SNAP), grabY: 0 }, card);
          return;
        }
        var q = S.waiting.filter(function (x) { return x.id === card.getAttribute('data-q'); })[0];
        startDrag(e, { quote: q, label: q.customer, dur: ceilTo((+q.man_hours || 1) / (q.crew_size || 2) * 60, SNAP) || 60, grabY: 0 }, card);
        return;
      }
      var jb = e.target.closest('.cal-job, .mchip');
      if (jb) {
        var j = S.jobs.filter(function (x) { return x.id === jb.getAttribute('data-j'); })[0];
        startDrag(e, { job: j, label: j.customer + (j.parts > 1 ? ' · day ' + j.part : ''), dur: j.endMin - j.startMin, grabY: jb.classList.contains('mchip') ? 0 : e.clientY - jb.getBoundingClientRect().top }, jb);
      }
    });
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    function onResize() { if (el.isConnected && daysFit() !== S.days) render(); }
    window.addEventListener('resize', onResize);
    ctx.onLeave(function () { window.removeEventListener('pointermove', onMove); window.removeEventListener('pointerup', onUp); window.removeEventListener('pointercancel', onUp); window.removeEventListener('resize', onResize); document.body.classList.remove('dragging'); });
    el.addEventListener('click', function (e) {
      var r = e.target.closest('[data-route]'); if (r) routeModal(r.getAttribute('data-route'));
      var dy = e.target.closest('[data-day]'); if (dy) { S.view = 'day'; pref('view', 'day'); S.start = dy.getAttribute('data-day'); renderCal.scrolled = false; load(); }
    });

    // ---------------- actions ----------------
    function bookQuote(q, date, min) {
      var crew = S.crew, list = group(date, crew);
      markAttached(list);
      var nj = { id: null, quote_id: q.id, customer: q.customer, lat: q.lat, lng: q.lng, crew: crew, men: q.crew_size || 2, manHours: +q.man_hours || 1, date: date, startMin: min, endMin: min + 60, desired: min, attached: false, status: 'Scheduled', flow: true };
      list.push(nj);
      ensureRoads([list]).then(function () {
        arrange(list);
        var moved = nj.startMin !== min ? ' (moved to ' + clock(nj.startMin) + ' to fit the ' + nj.travel + ' min drive from the job before)' : '';
        apply(list, q.customer + ' booked ' + new Date(date + 'T00:00:00').toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short' }) + ' ' + clock(nj.startMin) + moved + '.');
      });
    }
    /** A day of a job that was sent back to the tray goes onto the calendar again. */
    function placeParked(pj, date, min) {
      var crew = S.crew, list = group(date, crew);
      markAttached(list);
      var nj = Object.assign({}, pj, { crew: crew, date: date, startMin: min, endMin: min + 60, desired: min, attached: false, status: 'Scheduled' });
      list.push(nj);
      ensureRoads([list]).then(function () { arrange(list); apply(list, pj.customer + ' day booked ' + new Date(date + 'T00:00:00').toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short' }) + ' ' + clock(nj.startMin) + '.'); });
    }
    /** Take a day off the calendar and put it in the tray (a one-day job goes back as its quote). */
    function sendBack(j) {
      if (j.status === 'Completed') { App.toast('That day is already done.', 'warn'); return; }
      var rest = group(j.date, j.crew).filter(function (x) { return x !== j; }); markAttached(rest);
      App.post('jobs/' + j.id + '/park', {}).then(function (r) {
        S.jobs = S.jobs.filter(function (x) { return x !== j; });
        App.toast(r.parked ? j.customer + ' day ' + j.part + ' is back in To schedule — drag it onto any day.' : j.customer + ' is back in To schedule.');
        return ensureRoads([rest]).then(function () { arrange(rest); return apply(rest); });
      }).catch(function (x) { App.toast(x.message, 'err'); load(); });
    }
    /** Move or change a job: work out which jobs follow which first, then lay out the old and the new crew-day. */
    function relayout(j, changes) {
      var old = group(j.date, j.crew); markAttached(old);
      var others = old.filter(function (x) { return x !== j; }), oldDate = j.date, oldCrew = j.crew;
      Object.assign(j, changes);
      var same = j.date === oldDate && j.crew === oldCrew, nl = null;
      if (!same) { nl = group(j.date, j.crew, j); markAttached(nl); if (j.desired == null) j.desired = j.startMin; j.attached = false; nl.push(j); }
      return ensureRoads(same ? [old] : [others, nl]).then(function () {
        if (same) return arrange(old);
        arrange(others); return arrange(nl).concat(others);
      });
    }
    function moveJob(j, date, min) {
      var ch = { date: date, desired: min, attached: false };
      if (isHead(j) && j.status !== 'Completed') { ch.flow = true; ch.flowTotal = j.parts > 1 ? j.openHours : j.manHours; }
      relayout(j, ch).then(function (all) {
        apply(all, j.startMin !== min ? 'Moved to ' + clock(j.startMin) + ' to leave ' + j.travel + ' min to drive from the job before.' : null);
      });
    }
    function reflow(j, changes) { return relayout(j, changes).then(apply); }

    // ---------------- dialogs ----------------
    function jobModal(j) {
      var proj = j.parts > 1, mhNow = proj ? (j.openHours != null ? j.openHours : j.manHours) : j.manHours;
      var m = App.modal('<h2>' + esc(j.customer) + (proj ? ' <span class="tag info">Day ' + j.part + ' of ' + j.parts + '</span>' : '') + '</h2><p class="sub">' + esc([j.address, j.suburb].filter(Boolean).join(', ')) + ' · <a href="#/quotes/' + esc(j.quote_id) + '">' + esc(j.quote_number) + '</a> · ' + money(j.total) + '</p>' +
        (proj ? '<p class="muted small" style="margin-top:-4px">A multi-day job. Changing the men or man-hours re-spreads the days still to do. Moving day 1 moves them all; moving a later day moves just that day.</p>' : '') +
        '<div class="crewbox"><div><div class="field">Men on the job</div><div class="stepper"><button class="ib" data-men="-1" aria-label="One fewer">−</button><b id="j-men">' + j.men + '</b><button class="ib" data-men="1" aria-label="One more">+</button></div></div>' +
        '<div><div class="field">' + (proj ? 'Man-hours left (all days)' : 'Man-hours') + '</div><input id="j-mh" class="input" type="number" min="0.25" step="0.25" value="' + (mhNow || '') + '" style="width:110px"></div>' +
        '<div class="crew-out"><small>Job time</small><b id="j-time"></b><small id="j-end"></small></div></div>' +
        '<div class="grid2" style="margin-top:12px"><label class="field">Date<input id="j-date" type="date" value="' + j.date + '"></label><label class="field">Start<input id="j-start" type="time" step="900" value="' + local(j.date, j.startMin).slice(11) + '"></label>' +
        '<label class="field">Crew<select id="j-crew">' + S.crews.map(function (c) { return '<option' + (c === j.crew ? ' selected' : '') + '>' + esc(c) + '</option>'; }).join('') + '</select></label>' +
        '<label class="field">Status<select id="j-status">' + STATUSES.slice(0, 3).map(function (s) { return '<option' + (s === j.status ? ' selected' : '') + '>' + s + '</option>'; }).join('') + '</select></label>' +
        '<label class="field">Actual hours (after the job)<input id="j-actual" type="number" min="0" step="0.25" value="' + (j.actual || '') + '"></label><span></span>' +
        '<label class="field span2">Notes for the crew<textarea id="j-notes">' + esc(j.notes || '') + '</textarea></label></div>' +
        (j.travel ? '<p class="muted small">' + j.travel + ' min from the crew’s previous job, including ' + settings().bufferMinutes + ' min to park' + (j.travelInfo && j.travelInfo.low != null ? ' (drive ' + j.travelInfo.low + '–' + j.travelInfo.high + ' min, ' + (j.travelInfo.source === 'google' ? 'Google traffic' : 'by road') + ')' : '') + (j.guess ? ' (estimated — a property has no house pin)' : '') + '.</p>' : '') +
        '<div class="actions"><a class="btn" href="#/jobs/' + esc(j.id) + '">' + icon('check') + (j.status === 'Completed' ? 'Job page' : proj && j.part < j.parts ? 'Check in / photos' : 'Close out / photos') + '</a><a class="btn" target="_blank" rel="noopener" href="https://www.google.com/maps/dir/?api=1&destination=' + (j.lat != null ? j.lat + ',' + j.lng : encodeURIComponent([j.address, j.suburb].join(', '))) + '">' + icon('gps') + 'Directions</a>' +
        (j.status !== 'Completed' ? '<button class="btn" id="j-day">' + icon('plus') + 'Add another day</button>' : '') +
        (proj && j.status !== 'Completed' ? '<button class="btn" id="j-park">Send day ' + j.part + ' back to To schedule</button>' : '') +
        '<button class="btn ghost" id="j-un" style="color:var(--danger)">Unschedule</button><span class="spacer"></span><button class="btn" data-close>Close</button><button class="btn primary" id="j-ok">Save</button></div>', { noFocus: true });
      var men = j.men, q = function (id) { return m.el.querySelector('#' + id); };
      function upd() {
        var mh = parseFloat(q('j-mh').value) || 0, t = mh ? Math.max(SNAP, ceilTo(mh / men * 60, SNAP)) : j.endMin - j.startMin, st = q('j-start').value ? hm(q('j-start').value) : j.startMin, nd = daysFor(mh, men);
        q('j-men').textContent = men; q('j-time').textContent = nd > 1 ? 'About ' + nd + ' days' : dur(t); q('j-end').textContent = nd > 1 ? dur(t) + ' of work for ' + men + ' men' : 'finishes about ' + clock(st + t);
      }
      m.el.addEventListener('click', function (e) { var b = e.target.closest('[data-men]'); if (!b) return; men = Math.max(1, Math.min(12, men + +b.getAttribute('data-men'))); upd(); });
      ['j-mh', 'j-start'].forEach(function (id) { q(id).addEventListener('input', upd); });
      upd();
      q('j-un').onclick = function () {
        App.confirm(proj ? 'Unschedule all the days of ' + j.customer + '?' : 'Unschedule ' + j.customer + '?', (proj ? 'Every day still to do is taken off the calendar. Days already checked in stay. ' : '') + 'The job goes back to “To schedule”. The quote stays accepted.', 'Unschedule', true).then(function (ok) {
          if (!ok) return;
          var all = group(j.date, j.crew); markAttached(all);
          var rest = all.filter(function (x) { return x !== j; });
          App.del('jobs/' + j.id).then(function () { S.jobs = S.jobs.filter(function (x) { return x !== j; }); return ensureRoads([rest]); }).then(function () { arrange(rest); return apply(rest, 'Unscheduled — it is back in To schedule.'); });
        });
      };
      var parkBtn = q('j-park'); if (parkBtn) parkBtn.onclick = function () { m.close(); sendBack(j); };
      var dayBtn = q('j-day');
      if (dayBtn) dayBtn.onclick = function () {
        dayBtn.disabled = true;
        App.post('jobs/' + j.id + '/addday', { men: men }).then(function (r) { m.close(); toastFlow(r.flowed) || App.toast('Another day added.'); return load(); }).catch(function (x) { dayBtn.disabled = false; App.toast(x.message, 'err', 6000); });
      };
      q('j-ok').onclick = function () {
        var mhVal = parseFloat(q('j-mh').value) || null, crew = q('j-crew').value, date = q('j-date').value || j.date;
        var newStart = q('j-start').value ? hm(q('j-start').value) : j.startMin, timeChanged = newStart !== j.startMin || date !== j.date;
        var sizeChanged = men !== j.men || (mhVal != null && Math.abs(mhVal - (mhNow || 0)) > 0.001);
        var statusChanged = q('j-status').value !== j.status || q('j-notes').value !== (j.notes || '') || (parseFloat(q('j-actual').value) || 0) !== (+j.actual || 0);
        m.close();
        var p = statusChanged ? App.put('jobs/' + j.id, { status: q('j-status').value, notes: q('j-notes').value, actual_hours: q('j-actual').value || 0 }) : Promise.resolve();
        p.then(function () {
          // a later day of a multi-day job: more men or hours re-spreads the whole job from its first day still to do
          if (proj && sizeChanged && !(timeChanged && isHead(j))) return App.post('jobs/' + j.id + '/reflow', { men: men, totalManHours: mhVal }).then(function (r) { toastFlow(r.flowed) || App.toast('Job updated.'); return load(); });
          var changes = { men: men, manHours: proj ? j.manHours : (mhVal || j.manHours), crew: crew, date: date };
          if (timeChanged) { changes.desired = newStart; changes.attached = false; }
          if (isHead(j) && j.status !== 'Completed' && (timeChanged || sizeChanged || crew !== j.crew)) { changes.flow = true; changes.flowTotal = mhVal || mhNow; }
          return reflow(j, changes).then(function () { App.toast('Job updated.'); });
        }).catch(function (x) { App.toast(x.message, 'err'); });
      };
    }
    function routeModal(date) {
      var gis, byCrew = {}, dt = new Date(date + 'T00:00:00');
      S.jobs.filter(function (j) { return j.date === date; }).sort(function (a, b) { return a.startMin - b.startMin; }).forEach(function (j) { (byCrew[j.crew] = byCrew[j.crew] || []).push(j); });
      var src = S.provider === 'google' ? 'Google Maps traffic predictions for each departure time' : 'road routes on OpenStreetMap (OSRM), with a range for typical traffic';
      var m = App.modal('<h2>Route · ' + dt.toLocaleDateString('en-AU', { weekday: 'long', day: 'numeric', month: 'long' }) + '</h2><p class="sub">Drive times from ' + src + '. Each stop also allows ' + settings().bufferMinutes + ' min to park and unload.</p>' +
        '<div id="route-map" style="height:360px;margin-bottom:12px"></div><div id="route-list"><div class="empty">Working out the drives…</div></div><div class="actions"><button class="btn" data-close>Close</button></div>',
        { wide: true, noFocus: true, onClose: function () { if (gis) gis.destroy(); } });
      gis = GIS.create(m.el.querySelector('#route-map'), { toolbar: false, basemap: 'street' });
      var depot = S.depot && S.depot.lat != null ? S.depot : null, legs = [], meta = [];
      Object.keys(byCrew).forEach(function (c) {
        var list = byCrew[c].filter(function (j) { return j.lat != null; });
        if (!list.length) return;
        if (depot) { legs.push({ from: depot, to: list[0], depart: local(date, Math.max(0, list[0].startMin - 60)) }); meta.push({ crew: c, kind: 'out' }); }
        list.forEach(function (j, i) { if (i) { legs.push({ from: list[i - 1], to: j, depart: local(date, list[i - 1].endMin) }); meta.push({ crew: c, kind: 'between', to: j }); } });
        if (depot) { legs.push({ from: list[list.length - 1], to: depot, depart: local(date, Math.min(1439, list[list.length - 1].endMin)) }); meta.push({ crew: c, kind: 'home' }); }
      });
      var colors = ['#0f7a5f', '#2f6fd0', '#ae3ec9'], bounds = [];
      if (depot) { L.marker([depot.lat, depot.lng], { icon: L.divIcon({ className: 'route-pin base', iconSize: [30, 30], iconAnchor: [15, 15], html: '<span>' + App.icon('home') + '</span>' }) }).addTo(gis.map); bounds.push(L.latLng(depot.lat, depot.lng)); }
      Object.keys(byCrew).forEach(function (c) {
        byCrew[c].forEach(function (j, i) {
          if (j.lat == null) return;
          L.marker([j.lat, j.lng], { icon: L.divIcon({ className: 'route-pin', iconSize: [28, 28], iconAnchor: [14, 14], html: '<span>' + (i + 1) + '</span>' }) }).addTo(gis.map);
          bounds.push(L.latLng(j.lat, j.lng));
        });
      });
      setTimeout(function () { gis.map.invalidateSize(); if (bounds.length > 1) gis.map.fitBounds(L.latLngBounds(bounds), { padding: [40, 40] }); else if (bounds.length) gis.map.setView(bounds[0], 15); }, 60);
      var plain = function (l) { return { lat: +l.lat, lng: +l.lng }; };
      App.post('route', { geometry: true, legs: legs.map(function (l) { return { from: plain(l.from), to: plain(l.to), depart: l.depart }; }) }).then(function (d) {
        var res = d.legs || [];
        res.forEach(function (r, i) {
          if (!r) return; var mm = meta[i], col = colors[Object.keys(byCrew).indexOf(mm.crew) % 3];
          var line = r.geometry && r.geometry.length > 1 ? r.geometry : [[legs[i].from.lat, legs[i].from.lng], [legs[i].to.lat, legs[i].to.lng]];
          L.polyline(line, { color: col, weight: 5, opacity: mm.kind === 'between' ? 0.9 : 0.5, dashArray: r.geometry ? null : '8 6' }).addTo(gis.map);
        });
        var rng = function (r) { return !r ? '—' : (Math.round(r.high) > Math.round(r.low) ? Math.round(r.low) + '–' + Math.round(r.high) : Math.round(r.min)) + ' min · ' + r.km.toFixed(1) + ' km' + (r.source === 'estimate' ? ' (estimate)' : r.source === 'google' ? ' · traffic' : ''); };
        m.el.querySelector('#route-list').innerHTML = Object.keys(byCrew).map(function (c) {
          var list = byCrew[c], rows = [], total = 0;
          var legOf = function (kind, to) { for (var i = 0; i < meta.length; i++) if (meta[i].crew === c && meta[i].kind === kind && (!to || meta[i].to === to)) return res[i]; return null; };
          var out = legOf('out'), home = legOf('home');
          if (out) rows.push('<div class="li route-drive">' + App.icon('home') + '<span class="muted small">Leave home base by <b>' + clock(list[0].startMin - Math.ceil(out.high != null ? out.high : out.min)) + '</b> · ' + rng(out) + '</span></div>');
          list.forEach(function (j, i) {
            var r = i ? legOf('between', j) : null; if (r) total += r.min;
            if (i) rows.push('<div class="li route-drive">' + App.icon('truck') + '<span class="muted small">' + rng(r) + ' · ' + j.travel + ' min allowed</span></div>');
            rows.push('<div class="li"><span class="avatar">' + (i + 1) + '</span><span class="grow"><b>' + clock(j.startMin) + '–' + clock(j.endMin) + ' · ' + esc(j.customer) + '</b><small>' + esc([j.address, j.suburb].filter(Boolean).join(', ')) + ' · ' + j.men + ' men</small></span></div>');
          });
          if (home) rows.push('<div class="li route-drive">' + App.icon('home') + '<span class="muted small">Back at base about <b>' + clock(list[list.length - 1].endMin + Math.round(home.min)) + '</b> · ' + rng(home) + '</span></div>');
          return '<h3 style="margin:10px 0 6px">' + esc(c) + ' · ' + clock(list[0].startMin) + '–' + clock(list[list.length - 1].endMin) + ' · ' + Math.round(total) + ' min driving between jobs</h3><div class="list">' + rows.join('') + '</div>';
        }).join('') + (depot ? '' : '<p class="muted small">Set your home base in Settings to see the drive out and back.</p>');
      }).catch(function (e) { m.el.querySelector('#route-list').innerHTML = '<div class="empty">' + esc(e.message) + '</div>'; });
    }
    /** Pick a draft or sent quote the customer has said yes to: it becomes Accepted and joins the tray. */
    function addAccepted() {
      App.get('quotes').then(function (d) {
        var open = d.quotes.filter(function (q) { return q.status === 'Draft' || q.status === 'Sent'; });
        var m = App.modal('<h2>Add an accepted quote</h2><p class="sub">Choose the quote the customer has accepted. It is marked Accepted and appears in To schedule, ready to drag onto a day.</p>' +
          '<label class="search">' + icon('search') + '<input class="input" id="aq" type="search" placeholder="Search customer, number or address"></label><div class="list" id="aq-list" style="margin-top:8px;max-height:50vh;overflow:auto"></div>' +
          '<div class="actions"><a class="btn" href="#/quotes/new">' + icon('plus') + 'New quote</a><span class="spacer"></span><button class="btn" data-close>Close</button></div>');
        function draw() {
          var f = m.el.querySelector('#aq').value.toLowerCase();
          var list = open.filter(function (q) { return !f || (q.customer + ' ' + q.number + ' ' + q.address + ' ' + q.suburb).toLowerCase().indexOf(f) >= 0; });
          m.el.querySelector('#aq-list').innerHTML = list.length ? list.map(function (q) {
            return '<button class="li" data-aq="' + esc(q.id) + '"><span class="avatar">' + esc(App.initials(q.customer)) + '</span><span class="grow"><b>' + esc(q.customer) + ' · ' + esc(q.number) + '</b><small>' + esc([q.address, q.suburb].filter(Boolean).join(', ')) + ' · ' + App.ago(q.updated_at) + '</small></span><span class="end"><b class="num">' + money(q.total, 0) + '</b><small>' + App.pill(q.status) + '</small></span></button>';
          }).join('') : '<div class="empty" style="padding:18px">No draft or sent quotes' + (f ? ' match' : '') + '.</div>';
        }
        m.el.querySelector('#aq').addEventListener('input', draw); draw();
        m.el.querySelector('#aq-list').onclick = function (e) {
          var b = e.target.closest('[data-aq]'); if (!b) return; b.disabled = true;
          App.put('quotes/' + b.getAttribute('data-aq') + '/status', { status: 'Accepted' }).then(function () {
            m.close(); ctx.query.quote = b.getAttribute('data-aq'); return load();
          }).catch(function (x) { App.toast(x.message, 'err'); b.disabled = false; });
        };
      }).catch(function (e) { App.toast(e.message, 'err'); });
    }
    function settingsModal() {
      var st = settings();
      var m = App.modal('<h2>Working day and travel</h2><p class="sub">Drive times come from road routing (see Settings › Drive times). The speed and road factor are only used if routing can’t be reached.</p><div class="grid2">' +
        '<label class="field">Day starts<input id="s-a" type="time" value="' + st.dayStart + '"></label><label class="field">Day ends<input id="s-b" type="time" value="' + st.dayEnd + '"></label>' +
        '<label class="field">Fallback speed (km/h)<input id="s-v" type="number" min="5" step="1" value="' + st.speedKmh + '"></label><label class="field">Fallback road factor<input id="s-f" type="number" min="1" step="0.05" value="' + st.roadFactor + '"></label>' +
        '<label class="field">Park and unload (min per stop)<input id="s-p" type="number" min="0" step="1" value="' + st.bufferMinutes + '"></label></div>' +
        '<div class="field" style="margin-top:12px">Working days <span class="muted small">— big jobs carry on to the next working day</span></div><div class="chips" id="s-wd">' +
        [[1, 'Mon'], [2, 'Tue'], [3, 'Wed'], [4, 'Thu'], [5, 'Fri'], [6, 'Sat'], [0, 'Sun']].map(function (d) { return '<button type="button" class="chipb' + ((st.workDays || [1, 2, 3, 4, 5]).indexOf(d[0]) >= 0 ? ' on' : '') + '" data-wd="' + d[0] + '">' + d[1] + '</button>'; }).join('') + '</div>' +
        '<div class="actions"><button class="btn" data-close>Cancel</button><button class="btn primary" id="ok">Save</button></div>');
      m.el.querySelector('#s-wd').onclick = function (e) { var b = e.target.closest('[data-wd]'); if (b) b.classList.toggle('on'); };
      m.el.querySelector('#ok').onclick = function () {
        var wd = Array.prototype.map.call(m.el.querySelectorAll('[data-wd].on'), function (b) { return +b.getAttribute('data-wd'); });
        if (!wd.length) return App.toast('Pick at least one working day.', 'warn');
        App.put('schedule/settings', { dayStart: m.el.querySelector('#s-a').value, dayEnd: m.el.querySelector('#s-b').value, speedKmh: m.el.querySelector('#s-v').value, roadFactor: m.el.querySelector('#s-f').value, bufferMinutes: m.el.querySelector('#s-p').value, workDays: wd })
          .then(function (d) { S.settings = d.settings; m.close(); renderCal.scrolled = false; render(); App.toast('Saved. New bookings use these driving times.'); }).catch(function (x) { App.toast(x.message, 'err'); });
      };
    }

    renderCal.scrolled = false;
    load();
  });
})();
