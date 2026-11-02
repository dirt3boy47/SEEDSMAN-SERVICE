/* Seedsman Quote — Schedule: drag accepted quotes onto the calendar.
   Job time = man-hours ÷ men. Jobs a crew does on the same day are spaced by the driving time between the properties;
   jobs placed straight after another stay attached and move with it. */
(function () {
  'use strict';
  var icon = App.icon, esc = App.esc, money = App.money;
  var HOUR = 56, SNAP = 15, STATUSES = ['Scheduled', 'In progress', 'Completed', 'Cancelled'];
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

  App.route('/schedule', 'schedule', function (ctx) {
    var S = { start: monday(ctx.query.date || iso(new Date())), days: 7, jobs: [], waiting: [], settings: null, depot: null, crew: 'Crew 1', crews: ['Crew 1'], road: {}, provider: 'osrm' };
    App.me().then(function (me) { S.provider = ((me.business || {}).routing || {}).provider || 'osrm'; });
    var el = ctx.el, drag = null;
    el.className = 'wide';
    if (ctx.query.date) S.focus = ctx.query.date;

    function settings() { return S.settings || { dayStart: '07:00', dayEnd: '17:00', speedKmh: 40, roadFactor: 1.35, bufferMinutes: 5 }; }
    function range() { var st = settings(); return { from: Math.max(0, Math.floor(hm(st.dayStart) / 60) * 60 - 60), to: Math.min(24 * 60, Math.ceil(hm(st.dayEnd) / 60) * 60 + 120) }; }
    function daysFit() { var w = el.querySelector('.cal') ? el.querySelector('.cal').clientWidth : window.innerWidth; return Math.max(1, Math.min(7, Math.floor((w - 56) / 96))); }

    // ---------------- model ----------------
    function jobDur(j) { return j.manHours ? Math.max(SNAP, ceilTo(j.manHours / Math.max(1, j.men) * 60, SNAP)) : Math.max(SNAP, j.endMin - j.startMin); }
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
        travel: j.travel_minutes || 0, status: j.status, total: j.total, services: j.services, notes: j.notes, actual: j.actual_hours };
    }
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
        return { id: j.id || undefined, quote_id: j.id ? undefined : j.quote_id, start: local(j.date, j.startMin), end: local(j.date, j.endMin), crew: j.crew, men: j.men, man_hours: j.manHours, travel_minutes: j.travel, sequence: j.seq };
      });
    }
    function apply(list, msg) {
      if (!list.length) { load(); return Promise.resolve(); }
      return App.post('schedule/apply', { jobs: payload(list) }).then(function () { if (msg) App.toast(msg); return load(); })
        .catch(function (e) { App.toast(e.message, 'err', 6000); return load(); });
    }

    // ---------------- loading ----------------
    function load() {
      if (!el.isConnected) return Promise.resolve();
      var to = addDays(S.start, 7);
      return App.get('schedule?from=' + S.start + 'T00:00&to=' + to + 'T00:00').then(function (d) {
        if (!el.isConnected) return;
        S.settings = d.settings; S.depot = d.depot; S.waiting = d.waiting;
        S.jobs = d.jobs.map(fromServer);
        var crews = {}; S.jobs.forEach(function (j) { crews[j.crew] = 1; }); S.crews.forEach(function (c) { crews[c] = 1; });
        S.crews = Object.keys(crews).sort();
        render();
      }).catch(function (e) { App.toast(e.message, 'err'); });
    }

    // ---------------- rendering ----------------
    function top() {
      var end = addDays(S.start, S.days - 1), a = new Date(S.start + 'T00:00:00'), b = new Date(end + 'T00:00:00');
      App.setTop({ el: el, title: 'Schedule', sub: a.toLocaleDateString('en-AU', { day: 'numeric', month: 'short' }) + (S.days > 1 ? ' – ' + b.toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' }) : ', ' + a.getFullYear()),
        actions: '<button class="ib" id="prev" title="Back">' + icon('back') + '</button><button class="btn sm" id="today">Today</button><button class="ib" id="next" title="Forward">' + icon('chev') + '</button>' +
          '<button class="ib" id="sset" title="Working day and travel">' + icon('gear') + '</button>' });
      document.getElementById('prev').onclick = function () { S.start = addDays(S.start, -S.days); load(); };
      document.getElementById('next').onclick = function () { S.start = addDays(S.start, S.days); load(); };
      document.getElementById('today').onclick = function () { S.start = S.days === 7 ? monday(iso(new Date())) : iso(new Date()); load(); };
      document.getElementById('sset').onclick = settingsModal;
    }
    function render() {
      if (!el.isConnected) return;
      if (!el.querySelector('.sched')) {
        el.innerHTML = '<div class="sched"><div class="card cal"><div class="cal-bar"><span class="muted small" id="wk-sum"></span><span class="spacer"></span><label class="small muted" for="crew-sel">Drop onto</label><select id="crew-sel" class="input" style="width:auto;min-height:34px;padding:5px 8px"></select></div><div class="cal-head" id="cal-head"></div><div class="cal-body" id="cal-body"></div></div>' +
          '<aside class="card tray"><div class="card-h"><h2>To schedule <span class="tag" id="tray-n"></span></h2><button class="btn sm" id="tray-add" title="Accept a draft or sent quote">' + icon('plus') + 'Add</button></div><p class="muted small tray-hint">Accepted quotes. Drag one onto a day — it books the estimated man-hours with the crew size shown.</p><div class="tray-list" id="tray"></div></aside></div>';
        el.querySelector('#crew-sel').onchange = function (e) {
          if (e.target.value === '__new') { var n = prompt('Name of the new crew:', 'Crew ' + (S.crews.length + 1)); if (n) { S.crews.push(n.trim()); S.crew = n.trim(); } renderCrews(); return; }
          S.crew = e.target.value;
        };
        el.querySelector('#tray-add').onclick = addAccepted;
        el.querySelector('#cal-body').addEventListener('scroll', function () { el.querySelector('#cal-head').scrollLeft = el.querySelector('#cal-body').scrollLeft; });
      }
      var fit = daysFit();
      if (fit !== S.days) { S.days = fit; if (fit === 7) S.start = monday(S.start); else if (S.focus) { S.start = S.focus; } }
      S.focus = null;
      top(); renderCrews(); renderTray(); renderCal();
    }
    function renderCrews() {
      var sel = el.querySelector('#crew-sel');
      sel.innerHTML = S.crews.map(function (c) { return '<option' + (c === S.crew ? ' selected' : '') + '>' + esc(c) + '</option>'; }).join('') + '<option value="__new">+ New crew…</option>';
    }
    function renderTray() {
      el.querySelector('#tray-n').textContent = S.waiting.length;
      el.querySelector('#tray').innerHTML = S.waiting.length ? S.waiting.map(function (q) {
        var men = q.crew_size || 2, mh = +q.man_hours || 0, t = ceilTo(mh / men * 60, SNAP);
        return '<div class="tcard' + (ctx.query.quote === q.id ? ' flash' : '') + '" data-q="' + esc(q.id) + '"><span class="grip" title="Drag onto the calendar">' + icon('grip') + '</span><div class="grow"><b>' + esc(q.customer) + '</b><small>' + esc(q.suburb || q.address) + ' · ' + esc(q.number) + '</small>' +
          '<small>' + esc((q.services || 'Hedge trimming').replace(/,/g, ', ')) + '</small><div class="tmeta"><span class="tag">' + (mh ? mh + ' man-h' : 'No estimate') + '</span><span class="tag">' + men + ' men → ' + dur(t || 60) + '</span>' + (+q.picker ? '<span class="tag warn">Cherry picker</span>' : '') + (q.lat == null ? '<span class="tag warn">No pin</span>' : '') + '</div></div><b class="num">' + money(q.total, 0) + '</b></div>';
      }).join('') : '<div class="empty" style="padding:22px 10px">' + icon('check') + '<b>Nothing waiting</b>Accepted quotes appear here, ready to drag onto the calendar. Tap <b>Add</b> to accept a quote the customer said yes to.</div>';
      if (ctx.query.quote) { var f = el.querySelector('.tcard.flash'); if (f) { f.scrollIntoView({ block: 'center' }); App.toast('Drag ' + f.querySelector('b').textContent + ' onto a day to book it.'); } ctx.query.quote = null; }
    }
    function renderCal() {
      var r = range(), st = settings(), today = iso(new Date()), days = [];
      for (var i = 0; i < S.days; i++) days.push(addDays(S.start, i));
      var cols = 'grid-template-columns: 56px repeat(' + S.days + ', minmax(92px, 1fr))';
      var total = 0, mh = 0;
      el.querySelector('#cal-head').innerHTML = '<div class="cal-row" style="' + cols + '"><div></div>' + days.map(function (d) {
        var list = S.jobs.filter(function (j) { return j.date === d; }), dt = new Date(d + 'T00:00:00');
        var late = list.filter(function (j) { return j.endMin > hm(st.dayEnd); }).length, hours = list.reduce(function (s, j) { return s + (j.manHours || 0); }, 0);
        list.forEach(function (j) { total += +j.total || 0; mh += j.manHours || 0; });
        return '<div class="cal-dh' + (d === today ? ' today' : '') + '"><div><span>' + dt.toLocaleDateString('en-AU', { weekday: 'short' }) + '</span> <b>' + dt.getDate() + '</b></div>' +
          '<small>' + (list.length ? list.length + ' job' + (list.length === 1 ? '' : 's') + ' · ' + Math.round(hours * 10) / 10 + ' man-h' : '&nbsp;') + '</small>' + (late ? '<small class="late">Runs past ' + clock(hm(st.dayEnd)) + '</small>' : '') +
          (list.length ? '<button class="link small" data-route="' + d + '">' + 'Route</button>' : '') + '</div>';
      }).join('') + '</div>';
      el.querySelector('#wk-sum').textContent = S.jobs.length + ' job' + (S.jobs.length === 1 ? '' : 's') + ' · ' + Math.round(mh * 10) / 10 + ' man-hours · ' + money(total, 0) + ' incl. GST';
      var H = (r.to - r.from) / 60 * HOUR, body = '<div class="cal-row cal-grid" style="' + cols + ';height:' + H + 'px"><div class="cal-gutter">';
      for (var m = r.from; m < r.to; m += 60) body += '<div class="cal-hour" style="top:' + ((m - r.from) / 60 * HOUR) + 'px">' + clock(m) + '</div>';
      body += '</div>' + days.map(function (d) {
        var list = S.jobs.filter(function (j) { return j.date === d; }), crews = [];
        list.forEach(function (j) { if (crews.indexOf(j.crew) < 0) crews.push(j.crew); }); crews.sort();
        var html = '<div class="cal-col' + (d === today ? ' today' : '') + '" data-date="' + d + '">';
        html += '<div class="cal-off" style="top:0;height:' + ((hm(st.dayStart) - r.from) / 60 * HOUR) + 'px"></div><div class="cal-off" style="top:' + ((hm(st.dayEnd) - r.from) / 60 * HOUR) + 'px;bottom:0"></div>';
        for (var mm = r.from; mm < r.to; mm += 60) html += '<div class="cal-line" style="top:' + ((mm - r.from) / 60 * HOUR) + 'px"></div>';
        list.forEach(function (j) {
          var lane = crews.indexOf(j.crew), w = 100 / crews.length, top = (j.startMin - r.from) / 60 * HOUR, h = Math.max(26, (j.endMin - j.startMin) / 60 * HOUR - 2);
          var pos = 'left:calc(' + (lane * w) + '% + 3px);width:calc(' + w + '% - 6px);';
          if (j.travel > 0) html += '<div class="cal-travel' + (j.guess ? ' guess' : '') + '" style="' + pos + 'top:' + ((j.startMin - j.travel - r.from) / 60 * HOUR) + 'px;height:' + (j.travel / 60 * HOUR) + 'px" title="Driving from the previous job' + (j.guess ? ' (estimate — a property has no pin)' : '') + '">' + (j.travel >= 15 ? icon('truck') + '<span>' + j.travel + ' min</span>' : '') + '</div>';
          html += '<div class="cal-job s-' + j.status.toLowerCase().replace(/\s+/g, '-') + '" data-j="' + esc(j.id) + '" style="' + pos + 'top:' + top + 'px;height:' + h + 'px">' +
            '<b>' + esc(j.customer) + '</b><small class="t">' + clock(j.startMin) + '–' + clock(j.endMin) + '</small>' + (h > 40 ? '<small>' + esc(j.suburb || j.address) + '</small>' : '') +
            (h > 68 ? '<small>' + (j.manHours ? j.manHours + ' man-h · ' : '') + j.men + ' men' + (crews.length > 1 || S.crews.length > 1 ? ' · ' + esc(j.crew) : '') + '</small>' : '') + '</div>';
        });
        return html + '</div>';
      }).join('') + '</div>';
      var cb = el.querySelector('#cal-body'), keep = cb.scrollTop;
      cb.innerHTML = body;
      if (!renderCal.scrolled) { cb.scrollTop = (hm(st.dayStart) - r.from) / 60 * HOUR - 10; renderCal.scrolled = true; } else cb.scrollTop = keep;
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
      drag.drop = null;
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
      document.body.classList.remove('dragging'); d.src.classList.remove('lifted');
      if (!d.moved) { if (d.info.job) jobModal(d.info.job); return; }
      if (e.type === 'pointercancel' || !d.drop) return;
      if (d.info.job) moveJob(d.info.job, d.drop.date, d.drop.min); else bookQuote(d.info.quote, d.drop.date, d.drop.min);
    }
    el.addEventListener('pointerdown', function (e) {
      var card = e.target.closest('.tcard');
      if (card) {
        if (e.pointerType === 'touch' && !e.target.closest('.grip')) return; // on touch screens the grip drags, the rest scrolls the list
        var q = S.waiting.filter(function (x) { return x.id === card.getAttribute('data-q'); })[0];
        startDrag(e, { quote: q, label: q.customer, dur: ceilTo((+q.man_hours || 1) / (q.crew_size || 2) * 60, SNAP) || 60, grabY: 0 }, card);
        return;
      }
      var jb = e.target.closest('.cal-job');
      if (jb) {
        var j = S.jobs.filter(function (x) { return x.id === jb.getAttribute('data-j'); })[0];
        startDrag(e, { job: j, label: j.customer, dur: j.endMin - j.startMin, grabY: e.clientY - jb.getBoundingClientRect().top }, jb);
      }
    });
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    function onResize() { if (el.isConnected && daysFit() !== S.days) render(); }
    window.addEventListener('resize', onResize);
    ctx.onLeave(function () { window.removeEventListener('pointermove', onMove); window.removeEventListener('pointerup', onUp); window.removeEventListener('pointercancel', onUp); window.removeEventListener('resize', onResize); document.body.classList.remove('dragging'); });
    el.addEventListener('click', function (e) { var r = e.target.closest('[data-route]'); if (r) routeModal(r.getAttribute('data-route')); });

    // ---------------- actions ----------------
    function bookQuote(q, date, min) {
      var crew = S.crew, list = group(date, crew);
      markAttached(list);
      var nj = { id: null, quote_id: q.id, customer: q.customer, lat: q.lat, lng: q.lng, crew: crew, men: q.crew_size || 2, manHours: +q.man_hours || 1, date: date, startMin: min, endMin: min + 60, desired: min, attached: false, status: 'Scheduled' };
      list.push(nj);
      ensureRoads([list]).then(function () {
        arrange(list);
        var moved = nj.startMin !== min ? ' (moved to ' + clock(nj.startMin) + ' to fit the ' + nj.travel + ' min drive from the job before)' : '';
        apply(list, q.customer + ' booked ' + new Date(date + 'T00:00:00').toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short' }) + ' ' + clock(nj.startMin) + moved + '.');
      });
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
      relayout(j, { date: date, desired: min, attached: false }).then(function (all) {
        apply(all, j.startMin !== min ? 'Moved to ' + clock(j.startMin) + ' to leave ' + j.travel + ' min to drive from the job before.' : null);
      });
    }
    function reflow(j, changes) { return relayout(j, changes).then(apply); }

    // ---------------- dialogs ----------------
    function jobModal(j) {
      var m = App.modal('<h2>' + esc(j.customer) + '</h2><p class="sub">' + esc([j.address, j.suburb].filter(Boolean).join(', ')) + ' · <a href="#/quotes/' + esc(j.quote_id) + '">' + esc(j.quote_number) + '</a> · ' + money(j.total) + '</p>' +
        '<div class="crewbox"><div><div class="field">Men on the job</div><div class="stepper"><button class="ib" data-men="-1" aria-label="One fewer">−</button><b id="j-men">' + j.men + '</b><button class="ib" data-men="1" aria-label="One more">+</button></div></div>' +
        '<div><div class="field">Man-hours</div><input id="j-mh" class="input" type="number" min="0.25" step="0.25" value="' + (j.manHours || '') + '" style="width:110px"></div>' +
        '<div class="crew-out"><small>Job time</small><b id="j-time"></b><small id="j-end"></small></div></div>' +
        '<div class="grid2" style="margin-top:12px"><label class="field">Date<input id="j-date" type="date" value="' + j.date + '"></label><label class="field">Start<input id="j-start" type="time" step="900" value="' + local(j.date, j.startMin).slice(11) + '"></label>' +
        '<label class="field">Crew<select id="j-crew">' + S.crews.map(function (c) { return '<option' + (c === j.crew ? ' selected' : '') + '>' + esc(c) + '</option>'; }).join('') + '</select></label>' +
        '<label class="field">Status<select id="j-status">' + STATUSES.slice(0, 3).map(function (s) { return '<option' + (s === j.status ? ' selected' : '') + '>' + s + '</option>'; }).join('') + '</select></label>' +
        '<label class="field">Actual hours (after the job)<input id="j-actual" type="number" min="0" step="0.25" value="' + (j.actual || '') + '"></label><span></span>' +
        '<label class="field span2">Notes for the crew<textarea id="j-notes">' + esc(j.notes || '') + '</textarea></label></div>' +
        (j.travel ? '<p class="muted small">' + j.travel + ' min from the crew’s previous job, including ' + settings().bufferMinutes + ' min to park' + (j.travelInfo && j.travelInfo.low != null ? ' (drive ' + j.travelInfo.low + '–' + j.travelInfo.high + ' min, ' + (j.travelInfo.source === 'google' ? 'Google traffic' : 'by road') + ')' : '') + (j.guess ? ' (estimated — a property has no house pin)' : '') + '.</p>' : '') +
        '<div class="actions"><a class="btn" target="_blank" rel="noopener" href="https://www.google.com/maps/dir/?api=1&destination=' + (j.lat != null ? j.lat + ',' + j.lng : encodeURIComponent([j.address, j.suburb].join(', '))) + '">' + icon('gps') + 'Directions</a>' +
        '<button class="btn ghost" id="j-un" style="color:var(--danger)">Unschedule</button><span class="spacer"></span><button class="btn" data-close>Close</button><button class="btn primary" id="j-ok">Save</button></div>', { noFocus: true });
      var men = j.men, q = function (id) { return m.el.querySelector('#' + id); };
      function upd() {
        var mh = parseFloat(q('j-mh').value) || 0, t = mh ? Math.max(SNAP, ceilTo(mh / men * 60, SNAP)) : j.endMin - j.startMin, st = q('j-start').value ? hm(q('j-start').value) : j.startMin;
        q('j-men').textContent = men; q('j-time').textContent = dur(t); q('j-end').textContent = 'finishes about ' + clock(st + t);
      }
      m.el.addEventListener('click', function (e) { var b = e.target.closest('[data-men]'); if (!b) return; men = Math.max(1, Math.min(12, men + +b.getAttribute('data-men'))); upd(); });
      ['j-mh', 'j-start'].forEach(function (id) { q(id).addEventListener('input', upd); });
      upd();
      q('j-un').onclick = function () {
        App.confirm('Unschedule ' + j.customer + '?', 'The job goes back to “To schedule”. The quote stays accepted.', 'Unschedule', true).then(function (ok) {
          if (!ok) return;
          var all = group(j.date, j.crew); markAttached(all);
          var rest = all.filter(function (x) { return x !== j; });
          App.del('jobs/' + j.id).then(function () { S.jobs = S.jobs.filter(function (x) { return x !== j; }); return ensureRoads([rest]); }).then(function () { arrange(rest); return apply(rest, 'Unscheduled — it is back in To schedule.'); });
        });
      };
      q('j-ok').onclick = function () {
        var changes = { men: men, manHours: parseFloat(q('j-mh').value) || j.manHours, crew: q('j-crew').value, date: q('j-date').value || j.date };
        var newStart = q('j-start').value ? hm(q('j-start').value) : j.startMin;
        if (newStart !== j.startMin || changes.date !== j.date) { changes.desired = newStart; changes.attached = false; }
        var statusChanged = q('j-status').value !== j.status || q('j-notes').value !== (j.notes || '') || (parseFloat(q('j-actual').value) || 0) !== (+j.actual || 0);
        m.close();
        var p = statusChanged ? App.put('jobs/' + j.id, { status: q('j-status').value, notes: q('j-notes').value, actual_hours: q('j-actual').value || 0 }) : Promise.resolve();
        p.then(function () { return reflow(j, changes); }).then(function () { App.toast('Job updated.'); }).catch(function (x) { App.toast(x.message, 'err'); });
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
        '<div class="actions"><button class="btn" data-close>Cancel</button><button class="btn primary" id="ok">Save</button></div>');
      m.el.querySelector('#ok').onclick = function () {
        App.put('schedule/settings', { dayStart: m.el.querySelector('#s-a').value, dayEnd: m.el.querySelector('#s-b').value, speedKmh: m.el.querySelector('#s-v').value, roadFactor: m.el.querySelector('#s-f').value, bufferMinutes: m.el.querySelector('#s-p').value })
          .then(function (d) { S.settings = d.settings; m.close(); renderCal.scrolled = false; render(); App.toast('Saved. New bookings use these driving times.'); }).catch(function (x) { App.toast(x.message, 'err'); });
      };
    }

    renderCal.scrolled = false;
    load();
  });
})();
