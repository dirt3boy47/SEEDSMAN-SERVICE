/* Seedsman Quote — the job page (end-of-job dashboard): details, photos, the close-out questionnaire that builds the
   man-hours database, estimate vs actual, and the next trim. Also the recurring-trim actions used on the Overview. */
(function () {
  'use strict';
  var icon = App.icon, esc = App.esc, money = App.money;
  var KINDS = [['before', 'Before'], ['after', 'After'], ['issue', 'Issue']];

  function hm(h) { h = +h || 0; var m = Math.round(h * 60), hh = Math.floor(m / 60), mm = m % 60; return (hh ? hh + ' h' : '') + (hh && mm ? ' ' : '') + (mm || !hh ? mm + ' min' : ''); }
  function pctDiff(a, e) { if (!e) return ''; var d = Math.round((a - e) / e * 100); return (d > 0 ? '+' : '') + d + '%'; }
  function clockStr(t) { if (!t) return ''; var p = t.split(':'), h = +p[0]; return (h % 12 || 12) + ':' + p[1] + (h < 12 ? 'am' : 'pm'); }

  // ---------------- photos ----------------
  /** Shrink a photo to at most 1600 px (JPEG) before upload; keeps the original if the browser can't read it. */
  function shrink(file) {
    return new Promise(function (res) {
      if (!/^image\//.test(file.type)) return res(file);
      var img = new Image(), url = URL.createObjectURL(file);
      img.onload = function () {
        var k = Math.min(1, 1600 / Math.max(img.width, img.height)), c = document.createElement('canvas');
        c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height); URL.revokeObjectURL(url);
        c.toBlob(function (b) { res(b || file); }, 'image/jpeg', 0.82);
      };
      img.onerror = function () { URL.revokeObjectURL(url); res(file); };
      img.src = url;
    });
  }
  function upload(jobId, file, kind) {
    return shrink(file).then(function (blob) {
      return fetch('/api/jobs/' + encodeURIComponent(jobId) + '/photos?category=' + kind + '&name=' + encodeURIComponent(file.name || 'photo'), {
        method: 'POST', headers: { Authorization: 'Bearer ' + App.token(), 'Content-Type': blob.type || 'image/jpeg' }, body: blob
      }).then(function (r) { return r.json().then(function (d) { if (!r.ok) throw new Error(d.error || 'Upload failed'); return d.photo; }); });
    });
  }
  function photosHtml(photos, opts) {
    opts = opts || {};
    return KINDS.map(function (k) {
      var list = photos.filter(function (p) { return p.category === k[0]; });
      return '<div class="ph-group"><div class="ph-h"><b>' + k[1] + '</b> <span class="muted small">' + list.length + '</span>' +
        '<label class="btn sm ph-add">' + icon('plus') + 'Add<input type="file" accept="image/*" multiple hidden data-kind="' + k[0] + '"></label></div>' +
        '<div class="ph-grid">' + (list.length ? list.map(function (p) { return '<button class="ph" data-ph="' + esc(p.id) + '" style="background-image:url(\'' + esc(p.url) + '\')" title="' + esc(p.caption || k[1]) + '"></button>'; }).join('') : '<span class="muted small ph-none">No ' + k[1].toLowerCase() + ' photos yet</span>') + '</div></div>';
    }).join('');
  }
  function wirePhotos(box, jobId, photos, refresh) {
    box.addEventListener('change', function (e) {
      var inp = e.target.closest('input[type=file][data-kind]'); if (!inp || !inp.files.length) return;
      var files = Array.prototype.slice.call(inp.files), kind = inp.getAttribute('data-kind'), done = 0;
      App.toast('Uploading ' + files.length + ' photo' + (files.length === 1 ? '' : 's') + '…');
      files.reduce(function (p, f) { return p.then(function () { return upload(jobId, f, kind).then(function (ph) { photos.push(ph); done++; }); }); }, Promise.resolve())
        .then(function () { App.toast(done + ' photo' + (done === 1 ? '' : 's') + ' added.'); refresh(); })
        .catch(function (x) { App.toast(x.message, 'err', 6000); refresh(); });
      inp.value = '';
    });
    box.addEventListener('click', function (e) {
      var b = e.target.closest('[data-ph]'); if (!b) return;
      var p = photos.filter(function (x) { return x.id === b.getAttribute('data-ph'); })[0];
      var m = App.modal('<div class="ph-view"><img src="' + esc(p.url) + '" alt=""></div><div class="actions"><span class="muted small" style="margin-right:auto">' + esc(p.category) + ' · ' + App.date(p.created_at) + '</span>' +
        '<a class="btn" href="' + esc(p.url) + '" target="_blank" rel="noopener">Open full size</a><button class="btn ghost" id="ph-del" style="color:var(--danger)">' + icon('trash') + 'Delete</button><button class="btn" data-close>Close</button></div>', { wide: true, noFocus: true });
      m.el.querySelector('#ph-del').onclick = function () {
        App.del('photos/' + p.id).then(function () { photos.splice(photos.indexOf(p), 1); m.close(); refresh(); App.toast('Photo deleted.'); }).catch(function (x) { App.toast(x.message, 'err'); });
      };
    });
  }

  // ---------------- the close-out questionnaire ----------------
  function closeout(d, onDone) {
    var j = d.job, plan = d.plan || { tasks: [], estimate: 0, crew: 2 }, photos = d.photos.slice();
    var st = { step: 0, date: j.start.slice(0, 10), arrived: j.start.slice(11, 16), finished: j.end.slice(11, 16), men: j.men || j.crew_size || plan.crew || 2, breaks: 30,
      tasks: plan.tasks.map(function (t) { return { key: t.key, name: t.name, qty: t.qty, unit: t.unit, est: t.est, tier: t.tier, condition: t.condition, service: t.service, actual: null }; }),
      extras: [], access: 'Normal', waste: plan.wasteEst ? Math.round(plan.wasteEst * 10) / 10 : '', picker: plan.needsPicker, issues: [], notes: '', months: 4 };
    if (d.closeout) { // editing: start from what was recorded
      var c = d.closeout; st.date = c.work_date; st.arrived = c.arrived; st.finished = c.finished; st.men = c.men; st.breaks = c.break_minutes;
      st.access = c.access || 'Normal'; st.waste = c.waste_m3 != null ? c.waste_m3 : st.waste; st.picker = !!c.picker_used; st.notes = c.notes || ''; st.issues = (c.details && c.details.issues) || [];
      (d.tasks || []).forEach(function (row) { var t = st.tasks.filter(function (x) { return x.name === row.name && (x.service || null) === (row.service || null); })[0]; if (t) { t.actual = row.actual_man_hours; if (row.condition) t.condition = row.condition; } else if (row.category === 'other') st.extras.push({ key: 'extra:' + row.id, name: row.name, est: 0, actual: row.actual_man_hours }); });
      st._w = Math.round(Math.max(0, (function (a, b) { var x = a.split(':'), y = b.split(':'), m = (+y[0] * 60 + +y[1]) - (+x[0] * 60 + +x[1]); return m < 0 ? m + 1440 : m; })(st.arrived, st.finished) - st.breaks) / 60 * st.men * 100);
      st.months = d.trim && d.trim.active ? d.trim.interval_months : 0;
    }
    var STEPS = ['On site', 'Breaks', 'Time per task', 'How it went', 'Photos', 'Next trim', 'Review'];
    function mins(a, b) { var x = a.split(':'), y = b.split(':'), m = (+y[0] * 60 + +y[1]) - (+x[0] * 60 + +x[1]); return m < 0 ? m + 1440 : m; }
    function onsiteMH() { return mins(st.arrived, st.finished) / 60 * st.men; }
    function workingMH() { return Math.max(0, mins(st.arrived, st.finished) - st.breaks) / 60 * st.men; }
    function allocated() { return st.tasks.concat(st.extras).reduce(function (s, t) { return s + (+t.actual || 0); }, 0); }
    function splitByEstimate() {
      var w = workingMH(), est = st.tasks.reduce(function (s, t) { return s + (t.est || 0); }, 0);
      st.tasks.forEach(function (t) { t.actual = est ? Math.round(w * (t.est || 0) / est * 4) / 4 : Math.round(w / st.tasks.length * 4) / 4; });
      var diff = Math.round((w - allocated()) * 4) / 4; if (st.tasks.length && diff) st.tasks[0].actual = Math.max(0, st.tasks[0].actual + diff);
    }
    var m = App.modal('<div class="co"><div class="co-steps" id="co-steps"></div><div id="co-body"></div><div class="actions"><button class="btn" id="co-back">Back</button><span class="spacer"></span><button class="btn" data-close>Cancel</button><button class="btn primary" id="co-next">Next</button></div></div>', { wide: true, noFocus: true });
    var body = m.el.querySelector('#co-body');
    function stepper(id, val, step, unit) { return '<div class="stepper big"><button class="ib" data-st="' + id + '" data-d="-' + step + '">−</button><b data-v="' + id + '">' + val + '</b><button class="ib" data-st="' + id + '" data-d="' + step + '">+</button></div>' + (unit ? '<span class="muted small" style="margin-left:6px">' + unit + '</span>' : ''); }
    function chips(name, opts, cur) { return '<div class="chips">' + opts.map(function (o) { var v = Array.isArray(o) ? o[0] : o, l = Array.isArray(o) ? o[1] : o; return '<button type="button" class="chipb' + (String(v) === String(cur) ? ' on' : '') + '" data-chip="' + name + '" data-val="' + esc(v) + '">' + esc(l) + '</button>'; }).join('') + '</div>'; }
    function render() {
      m.el.querySelector('#co-steps').innerHTML = STEPS.map(function (s, i) { return '<span class="' + (i === st.step ? 'on' : i < st.step ? 'done' : '') + '">' + (i < st.step ? '✓ ' : (i + 1) + '. ') + s + '</span>'; }).join('');
      m.el.querySelector('#co-back').disabled = st.step === 0;
      m.el.querySelector('#co-next').textContent = st.step === STEPS.length - 1 ? 'Complete job' : 'Next';
      var h = '';
      if (st.step === 0) {
        h = '<h2>Close out · ' + esc(j.customer) + '</h2><p class="sub">' + esc([j.address, j.suburb].filter(Boolean).join(', ')) + ' · estimated ' + hm(plan.estimate) + ' man-hours</p>' +
          '<div class="grid3"><label class="field">Date<input type="date" id="co-date" value="' + st.date + '"></label><label class="field">Arrived<input type="time" id="co-arr" value="' + st.arrived + '"></label><label class="field">Finished<input type="time" id="co-fin" value="' + st.finished + '"></label></div>' +
          '<div class="co-q"><div class="field">How many men were on site?</div>' + stepper('men', st.men, 1, 'men') + '</div>' +
          '<div class="co-sum">On site ' + hm(mins(st.arrived, st.finished) / 60) + ' × ' + st.men + ' men = <b>' + hm(onsiteMH()) + '</b> man-hours</div>';
      } else if (st.step === 1) {
        h = '<h2>Breaks</h2><p class="sub">Total break time the crew took (smoko, lunch). It comes off the working time.</p>' + chips('breaks', [[0, 'None'], [15, '15 min'], [20, '20 min'], [30, '30 min'], [45, '45 min'], [60, '1 h']], st.breaks) +
          '<label class="field" style="max-width:200px;margin-top:10px">Or minutes<input type="number" min="0" step="5" id="co-brk" value="' + st.breaks + '"></label>' +
          '<div class="co-sum">Working time: <b>' + hm(workingMH()) + '</b> man-hours (' + hm(onsiteMH()) + ' on site − ' + hm(st.breaks / 60 * st.men) + ' breaks)</div>';
      } else if (st.step === 2) {
        var wNow = Math.round(workingMH() * 100); // re-split only when the working time changed (keeps your edits otherwise)
        if (st.tasks.every(function (t) { return t.actual == null; }) || st._w !== wNow) { splitByEstimate(); st._w = wNow; }
        var left = Math.round((workingMH() - allocated()) * 100) / 100;
        h = '<h2>How long did each task take?</h2><p class="sub">In <b>man-hours</b> (2 men for 1 hour = 2). Split from the quote’s estimates — adjust anything that took more or less.</p>' +
          '<div class="co-tasks">' + st.tasks.concat(st.extras).map(function (t, i) {
            var isExtra = i >= st.tasks.length;
            return '<div class="co-task"><div class="grow"><b>' + (isExtra ? '<input class="input" data-xname="' + (i - st.tasks.length) + '" value="' + esc(t.name) + '" style="min-height:32px;padding:4px 8px">' : esc(t.name)) + '</b><small>' +
              (t.qty != null ? App.qty(t.qty, t.unit) + ' · ' : '') + (t.tier ? t.tier + ' · ' : '') + (t.est ? 'estimated ' + hm(t.est) : 'not in the estimate') + '</small>' +
              (t.service === 'hedge' ? '<select class="input co-cond" data-cond="' + i + '"></select>' : '') + '</div>' +
              '<div class="co-time"><button class="ib sm" data-tk="' + i + '" data-d="-0.25">−</button><b>' + hm(t.actual) + '</b><button class="ib sm" data-tk="' + i + '" data-d="0.25">+</button></div>' +
              (t.est ? '<span class="co-var ' + ((t.actual || 0) > t.est * 1.1 ? 'over' : (t.actual || 0) < t.est * 0.9 ? 'under' : '') + '">' + pctDiff(t.actual || 0, t.est) + '</span>' : '<span class="co-var"></span>') + '</div>';
          }).join('') + '</div>' +
          '<div class="row" style="margin-top:8px"><button class="btn sm" id="co-split">Split by estimate again</button><button class="btn sm" id="co-extra">' + icon('plus') + 'Another task (e.g. extra pruning)</button></div>' +
          '<div class="co-sum ' + (Math.abs(left) > 0.13 ? 'warn' : '') + '">Working time ' + hm(workingMH()) + ' · allocated ' + hm(allocated()) + ' · <b>' + (Math.abs(left) <= 0.13 ? 'all allocated ✓' : (left > 0 ? hm(left) + ' not allocated yet' : hm(-left) + ' more than the working time')) + '</b></div>';
      } else if (st.step === 3) {
        h = '<h2>How did it go?</h2><div class="co-q"><div class="field">Access</div>' + chips('access', ['Easy', 'Normal', 'Difficult'], st.access) + '</div>' +
          '<div class="co-q"><div class="field">Anything that slowed you down?</div>' + chips('issues', ['Overgrown', 'Steep / uneven', 'Tight access', 'Wet weather', 'Hot weather', 'Equipment trouble', 'Customer requests', 'Extra waste'], '__multi') + '</div>' +
          '<div class="grid2"><label class="field">Green waste taken (m³)<input type="number" min="0" step="0.5" id="co-waste" value="' + st.waste + '" placeholder="estimated ' + (plan.wasteEst || 0).toFixed(1) + '"></label>' +
          '<label class="check" style="margin-top:22px"><input type="checkbox" id="co-pick"' + (st.picker ? ' checked' : '') + '> Cherry picker used</label>' +
          '<label class="field span2">Notes for next time<textarea id="co-notes" placeholder="e.g. Dog in back yard; gate code 1234; customer wants it lower next time">' + esc(st.notes) + '</textarea></label></div>';
      } else if (st.step === 4) {
        h = '<h2>Photos</h2><p class="sub">Before and after shots for the record and the customer. You can add more later on the job page.</p><div id="co-photos">' + photosHtml(photos) + '</div>';
      } else if (st.step === 5) {
        var due = function (mo) { var dd = new Date(st.date + 'T00:00:00'); dd.setMonth(dd.getMonth() + mo); return dd.toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' }); };
        h = '<h2>Next trim</h2><p class="sub">When should this hedge be done again? It will show on the Overview when it’s due, ready to re-quote or re-book in one tap.</p>' +
          chips('months', [[0, 'No reminder'], [2, '2 months'], [3, '3 months'], [4, '4 months'], [6, '6 months'], [12, '12 months']], st.months) +
          (st.months ? '<div class="co-sum">Reminder for about <b>' + due(st.months) + '</b></div>' : '');
      } else {
        var w = workingMH();
        h = '<h2>Review</h2><div class="co-review"><div><small>Working man-hours</small><b>' + hm(w) + '</b></div><div><small>Estimated</small><b>' + hm(plan.estimate) + '</b></div><div><small>Difference</small><b class="' + (w > plan.estimate * 1.1 ? 'over' : w < plan.estimate * 0.9 ? 'under' : '') + '">' + pctDiff(w, plan.estimate) + '</b></div><div><small>Breaks</small><b>' + st.breaks + ' min</b></div></div>' +
          '<table class="tbl" style="margin-top:10px"><thead><tr><th>Task</th><th class="r">Estimate</th><th class="r">Actual</th><th class="r">±</th></tr></thead><tbody>' + st.tasks.concat(st.extras).map(function (t) { return '<tr><td>' + esc(t.name) + '</td><td class="r">' + (t.est ? hm(t.est) : '—') + '</td><td class="r">' + hm(t.actual) + '</td><td class="r">' + pctDiff(t.actual || 0, t.est) + '</td></tr>'; }).join('') + '</tbody></table>' +
          '<p class="muted small">' + photos.length + ' photo' + (photos.length === 1 ? '' : 's') + ' · access ' + esc(st.access) + (st.months ? ' · next trim in ' + st.months + ' months' : '') + '</p>';
      }
      body.innerHTML = h;
      if (st.step === 2) App.me().then(function (me) {
        body.querySelectorAll('[data-cond]').forEach(function (sel) { var t = st.tasks.concat(st.extras)[+sel.getAttribute('data-cond')]; sel.innerHTML = me.rates.conditions.map(function (c) { return '<option value="' + esc(c.id) + '"' + (c.id === (t.condition || 'maintained') ? ' selected' : '') + '>Actual: ' + esc(c.label) + '</option>'; }).join(''); });
      });
      if (st.step === 3) body.querySelectorAll('[data-chip=issues]').forEach(function (b) { b.classList.toggle('on', st.issues.indexOf(b.getAttribute('data-val')) >= 0); });
      if (st.step === 4) wirePhotos(body.querySelector('#co-photos'), j.id, photos, function () { body.querySelector('#co-photos').innerHTML = photosHtml(photos); });
    }
    function read() {
      var v = function (id) { var e = body.querySelector('#' + id); return e ? e.value : null; };
      if (st.step === 0) { st.date = v('co-date') || st.date; st.arrived = v('co-arr') || st.arrived; st.finished = v('co-fin') || st.finished; }
      if (st.step === 1 && v('co-brk') != null) st.breaks = Math.max(0, parseInt(v('co-brk'), 10) || 0);
      if (st.step === 3) { st.waste = v('co-waste'); st.picker = body.querySelector('#co-pick').checked; st.notes = v('co-notes'); }
    }
    body.addEventListener('input', function (e) {
      var t = e.target;
      if (t.id === 'co-arr' || t.id === 'co-fin' || t.id === 'co-date') { read(); var s = body.querySelector('.co-sum'); if (s) s.innerHTML = 'On site ' + hm(mins(st.arrived, st.finished) / 60) + ' × ' + st.men + ' men = <b>' + hm(onsiteMH()) + '</b> man-hours'; }
      if (t.id === 'co-brk') { read(); body.querySelectorAll('[data-chip=breaks]').forEach(function (b) { b.classList.toggle('on', +b.getAttribute('data-val') === st.breaks); }); var s2 = body.querySelector('.co-sum'); if (s2) s2.innerHTML = 'Working time: <b>' + hm(workingMH()) + '</b> man-hours'; }
      if (t.hasAttribute('data-xname')) st.extras[+t.getAttribute('data-xname')].name = t.value;
    });
    body.addEventListener('change', function (e) { var t = e.target; if (t.hasAttribute('data-cond')) st.tasks.concat(st.extras)[+t.getAttribute('data-cond')].condition = t.value; });
    body.addEventListener('click', function (e) {
      var b;
      if ((b = e.target.closest('[data-st]'))) { var k = b.getAttribute('data-st'); st[k] = Math.max(1, Math.min(12, st[k] + +b.getAttribute('data-d'))); render(); return; }
      if ((b = e.target.closest('[data-tk]'))) { var all = st.tasks.concat(st.extras), t = all[+b.getAttribute('data-tk')]; t.actual = Math.max(0, Math.round(((+t.actual || 0) + +b.getAttribute('data-d')) * 4) / 4); render(); return; }
      if ((b = e.target.closest('[data-chip]'))) {
        var n = b.getAttribute('data-chip'), val = b.getAttribute('data-val');
        if (n === 'issues') { var ix = st.issues.indexOf(val); if (ix >= 0) st.issues.splice(ix, 1); else st.issues.push(val); b.classList.toggle('on'); return; }
        st[n] = n === 'access' ? val : +val;
        render(); return;
      }
      if (e.target.closest('#co-split')) { splitByEstimate(); render(); return; }
      if (e.target.closest('#co-extra')) { st.extras.push({ key: 'extra:' + Date.now().toString(36), name: 'Other task', est: 0, actual: 0.5 }); render(); }
    });
    m.el.querySelector('#co-back').onclick = function () { read(); if (st.step > 0) { st.step--; render(); } };
    m.el.querySelector('#co-next').onclick = function () {
      read();
      if (st.step === 0 && mins(st.arrived, st.finished) <= 0) return App.toast('Check the arrival and finish times.', 'warn');
      if (st.step < STEPS.length - 1) { st.step++; render(); return; }
      var btn = m.el.querySelector('#co-next'); btn.disabled = true;
      App.post('jobs/' + j.id + '/closeout', { date: st.date, arrived: st.arrived, finished: st.finished, men: st.men, breakMinutes: st.breaks,
        tasks: st.tasks.concat(st.extras).map(function (t) { return { key: t.key, name: t.name, actual: t.actual || 0, condition: t.condition }; }),
        access: st.access, issues: st.issues, wasteM3: st.waste, pickerUsed: st.picker, notes: st.notes, nextTrimMonths: st.months })
        .then(function (r) { m.close(); App.toast('Job closed out — ' + hm(r.workingManHours) + ' working man-hours recorded' + (r.nextTrim ? ', next trim ' + App.date(r.nextTrim) : '') + '.', null, 6000); if (onDone) onDone(); })
        .catch(function (x) { App.toast(x.message, 'err', 6000); btn.disabled = false; });
    };
    render();
  }

  // ---------------- job page ----------------
  App.route('/jobs/:id', 'schedule', function (ctx) {
    var id = ctx.params[0];
    function load() {
      App.get('jobs/' + encodeURIComponent(id)).then(function (d) {
        if (!ctx.el.isConnected) return;
        var j = d.job, c = d.closeout, done = j.status === 'Completed';
        App.setTop({ el: ctx.el, back: '#/schedule?date=' + j.start.slice(0, 10), titleHtml: esc(j.customer) + ' ' + App.pill(j.status), sub: [j.address, j.suburb].filter(Boolean).join(', ') + ' · ' + App.date(j.start) + ' ' + App.time(j.start),
          actions: '<a class="btn" href="#/quotes/' + esc(j.quote_id) + '">' + icon('quote') + '<span class="lbl">' + esc(j.quote_number) + '</span></a><a class="btn" target="_blank" rel="noopener" href="https://www.google.com/maps/dir/?api=1&destination=' + (j.lat != null ? j.lat + ',' + j.lng : encodeURIComponent([j.address, j.suburb].join(', '))) + '">' + icon('gps') + '<span class="lbl">Directions</span></a>' +
            '<button class="btn primary" id="close-out">' + icon('check') + '<span class="lbl">' + (done ? 'Edit close-out' : 'Close out job') + '</span></button>' });
        document.getElementById('close-out').onclick = function () { closeout(d, load); };
        var plan = d.plan || { tasks: [], estimate: 0 }, tasks = d.tasks || [];
        var results = c ? '<div class="co-review"><div><small>Working man-hours</small><b>' + hm(c.working_man_hours) + '</b></div><div><small>Estimated</small><b>' + hm(c.estimated_man_hours) + '</b></div><div><small>Difference</small><b class="' + (c.working_man_hours > c.estimated_man_hours * 1.1 ? 'over' : c.working_man_hours < c.estimated_man_hours * 0.9 ? 'under' : '') + '">' + pctDiff(c.working_man_hours, c.estimated_man_hours) + '</b></div><div><small>On site</small><b>' + clockStr(c.arrived) + '–' + clockStr(c.finished) + '</b><small>' + c.men + ' men · ' + c.break_minutes + ' min breaks</small></div></div>' +
          '<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Task</th><th class="r">Qty</th><th class="r">Estimate</th><th class="r">Actual</th><th class="r">±</th><th class="r">Rate achieved</th></tr></thead><tbody>' + tasks.map(function (t) {
            var rate = t.qty && t.actual_man_hours ? (t.qty / t.actual_man_hours).toFixed(1) + ' ' + (t.unit || '') + '/h' : '';
            return '<tr><td><b>' + esc(t.name) + '</b>' + (t.tier ? '<small>' + esc(t.tier) + (t.condition ? ' · ' + esc(t.condition) : '') + '</small>' : '') + '</td><td class="r">' + (t.qty != null ? App.qty(t.qty, t.unit) : '') + '</td><td class="r">' + (t.est_man_hours ? hm(t.est_man_hours) : '—') + '</td><td class="r">' + hm(t.actual_man_hours) + '</td><td class="r">' + pctDiff(t.actual_man_hours, t.est_man_hours) + '</td><td class="r">' + rate + '</td></tr>';
          }).join('') + '</tbody></table></div>' + (c.notes ? '<p><b>Notes:</b> ' + esc(c.notes) + '</p>' : '') + ((c.details && c.details.issues && c.details.issues.length) ? '<p class="muted small">Slowed by: ' + esc(c.details.issues.join(', ')) + ' · access ' + esc(c.access || '') + '</p>' : '')
          : '<div class="empty" style="padding:20px">' + icon('clock') + '<b>Not closed out yet</b>When the job’s done, tap <b>Close out job</b> — a few quick questions record how long each task really took, so future quotes get sharper.</div>';
        ctx.el.innerHTML = '<div class="page"><div class="cols"><div class="stack">' +
          '<div class="card"><div class="card-h"><h2>Estimate vs actual</h2>' + (c ? '<span class="muted small">' + App.date(c.work_date) + '</span>' : '') + '</div><div class="card-b">' + results + '</div></div>' +
          '<div class="card"><div class="card-h"><h2>Photos</h2><span class="muted small">' + d.photos.length + '</span></div><div class="card-b" id="photos">' + photosHtml(d.photos) + '</div></div>' +
          '</div><div class="stack">' +
          '<div class="card"><div class="card-h"><h2>Job</h2></div><div class="card-b stack"><div><h3>When</h3><div>' + App.date(j.start) + ' · ' + App.time(j.start) + '–' + App.time(j.end) + '</div></div><div><h3>Crew</h3><div>' + esc(j.crew) + ' · ' + (j.men || j.crew_size) + ' men</div></div>' +
            '<div><h3>Work</h3><div>' + esc((j.services || 'Hedge trimming').replace(/,/g, ', ')) + '</div><small class="muted">Estimated ' + hm(plan.estimate) + ' man-hours · ' + money(j.total) + ' incl. GST</small></div>' + (j.notes ? '<div><h3>Notes</h3><div style="white-space:pre-wrap">' + esc(j.notes) + '</div></div>' : '') + '</div></div>' +
          '<div class="card"><div class="card-h"><h2>Next trim</h2></div><div class="card-b">' + (d.trim && d.trim.active ? '<div><b>' + App.date(d.trim.due) + '</b> <span class="muted small">every ' + d.trim.interval_months + ' months · ' + esc(d.trim.status) + '</span></div><div class="row" style="margin-top:8px"><button class="btn sm" data-trim="move">Change date</button><button class="btn sm ghost" data-trim="skip" style="color:var(--danger)">No reminder</button></div>'
            : '<p class="muted small" style="margin:0">' + (done ? 'No reminder set.' : 'Set when you close out the job.') + '</p>') + '</div></div>' +
          '</div></div></div>';
        var ph = ctx.el.querySelector('#photos');
        wirePhotos(ph, j.id, d.photos, function () { ph.innerHTML = photosHtml(d.photos); });
        ctx.el.querySelectorAll('[data-trim]').forEach(function (b) {
          b.onclick = function () {
            if (b.getAttribute('data-trim') === 'skip') return App.put('plans/' + d.trim.id, { status: 'Skipped' }).then(load);
            var nd = prompt('New reminder date (YYYY-MM-DD):', d.trim.due); if (nd) App.put('plans/' + d.trim.id, { due: nd }).then(load).catch(function (x) { App.toast(x.message, 'err'); });
          };
        });
      }).catch(function (e) { App.toast(e.message, 'err'); });
    }
    load();
  });

  // ---------------- recurring-trim actions (Overview) ----------------
  function trimAction(planId, action, done) {
    if (action === 'skip') return App.put('plans/' + planId, { status: 'Skipped' }).then(function () { App.toast('Reminder removed.'); done(); });
    if (action === 'snooze') return App.get('plans').then(function (d) { var p = d.plans.filter(function (x) { return x.id === planId; })[0]; var dt = new Date(p.due + 'T00:00:00'); dt.setMonth(dt.getMonth() + 1); return App.put('plans/' + planId, { due: dt.toISOString().slice(0, 10) }); }).then(function () { App.toast('Moved a month later.'); done(); });
    return App.post('plans/' + planId + '/quote', { mode: action === 'same' ? 'same' : 'current' }).then(function (r) {
      if (action === 'same') { App.toast('Booked at the same price — ' + r.quote.number + ' (' + money(r.quote.total) + ') is in the schedule’s To schedule tray.', null, 6000); done(); }
      else { App.toast('New quote ' + r.quote.number + ' at today’s rates — check it and send.'); App.go('#/quotes/' + r.quote.id); }
    });
  }
  window.Jobs = { closeout: closeout, trimAction: trimAction, hm: hm };
})();
