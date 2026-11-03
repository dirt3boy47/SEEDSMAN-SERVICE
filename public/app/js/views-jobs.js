/* Seedsman Quote — the job page (end-of-job dashboard): details, photos, the close-out questionnaire that builds the
   man-hours database, estimate vs actual, and the next trim. Also the recurring-trim actions used on the Overview. */
(function () {
  'use strict';
  var icon = App.icon, esc = App.esc, money = App.money;
  var KINDS = [['before', 'Before'], ['after', 'After'], ['issue', 'Issue']];

  function hm(h) { h = +h || 0; var m = Math.round(h * 60), hh = Math.floor(m / 60), mm = m % 60; return (hh ? hh + ' h' : '') + (hh && mm ? ' ' : '') + (mm || !hh ? mm + ' min' : ''); }
  function pctDiff(a, e) { if (!e) return ''; var d = Math.round((a - e) / e * 100); return (d > 0 ? '+' : '') + d + '%'; }
  function mhs(h) { return String(Math.round((+h || 0) * 100) / 100); } // man-hours as a plain number
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

  // ---------------- the close-out: a guided, one-question-at-a-time flow (built for iPhone) ----------------
  // mode 'checkin' = end-of-day check-in for one day of a multi-day job (a shorter set of questions)
  function closeout(d, onDone, mode) { App.me().then(function (me) { runCloseout(d, onDone, me.rates || {}, mode || 'closeout'); }).catch(function (x) { App.toast(x.message, 'err'); }); }
  // Hedging first, then the other kinds of work, then setup — one time question per group
  var GROUPS = [['Hedges', 'Hedging', 'all the hedging'], ['Lawns', 'Lawns', 'the lawns'], ['Gardens', 'Garden work', 'the garden work'], ['Trees', 'Tree & shrub work', 'the tree and shrub work'], ['Other', 'Other work', 'the other work']];
  function groupTasks(tasks, rates) {
    var svc = {}; ((rates && rates.services) || []).forEach(function (x) { svc[x.id] = x.category; });
    ((window.SeedsmanPricing && SeedsmanPricing.DEFAULT_SERVICES) || []).forEach(function (x) { if (!svc[x.id]) svc[x.id] = x.category; });
    function catOf(t) { var c = svc[t.service] || (t.service === 'hedge' ? 'Hedges' : 'Other'); return GROUPS.some(function (x) { return x[0] === c; }) ? c : 'Other'; }
    var out = GROUPS.map(function (g) {
      var mem = tasks.filter(function (t) { return t.category !== 'setup' && catOf(t) === g[0]; });
      return mem.length ? { key: 'g:' + g[0], cat: g[0], name: g[1], phrase: g[2], members: mem, est: mem.reduce(function (a, t) { return a + (t.est || 0); }, 0), hedge: g[0] === 'Hedges' } : null;
    }).filter(Boolean);
    tasks.filter(function (t) { return t.category === 'setup'; }).forEach(function (t) { out.push({ key: 'g:setup', cat: 'setup', name: 'Setup & clean-up', phrase: 'setting up, cleaning up and loading', members: [t], est: t.est || 0, setup: true }); });
    return out;
  }
  function runCloseout(d, onDone, rates, mode) {
    var CHECKIN = mode === 'checkin';
    var j = d.job, plan = d.plan || { tasks: [], estimate: 0, crew: 2 }, photos = d.photos.slice(), SAVE = (CHECKIN ? 'seedsman-checkin-' : 'seedsman-closeout2-') + j.id;
    // a multi-day job: the days already checked in count towards the totals in the final close-out
    var multi = j.parts > 1, earlier = (d.days || []).filter(function (x) { return x.id !== j.id && x.day_log; });
    var prevWork = 0, prevManMin = 0;
    earlier.forEach(function (x) { var l = x.day_log, m = l.men || 1; prevWork += (l.workingMH || 0) / m * 60; prevManMin += (l.workingMH || 0) * 60; });
    if (CHECKIN) { prevWork = 0; prevManMin = 0; }
    var groups = groupTasks(plan.tasks, rates), groupOf = {};
    groups.forEach(function (g) { g.members.forEach(function (t) { groupOf[t.key] = g; }); });
    var conds = rates.conditions || [], names = { maintained: 'Well kept — a regular trim', overgrown: 'Overgrown — hadn’t been cut for a while', reduction: 'Very overgrown — a hard cut back' };
    function toMin(t) { var p = (t || '0:0').split(':'); return +p[0] * 60 + +p[1]; }
    function clock(t) { var m = toMin(t), h = Math.floor(m / 60) % 24, mm = m % 60; return (h % 12 || 12) + (mm ? ':' + String(mm).padStart(2, '0') : '') + (h < 12 ? 'am' : 'pm'); }
    function dur(min) { min = Math.max(0, Math.round(min)); var h = Math.floor(min / 60), m = min % 60; return h && m ? h + ' h ' + m + ' min' : h ? h + (h === 1 ? ' hour' : ' hours') : m + ' min'; }
    function addMin(t, m) { var x = (toMin(t) + Math.round(m)) % 1440; return String(Math.floor(x / 60)).padStart(2, '0') + ':' + String(x % 60).padStart(2, '0'); }
    function q15(m) { return Math.max(15, Math.round(m / 15) * 15); }

    // answers
    var A = { arrived: j.start.slice(11, 16), arrivedOk: false, finished: j.end.slice(11, 16), finishedOk: false, men: null, breaks: null,
      task: {}, cond: {}, extra: null, access: null, slow: [], waste: null, picker: null, photoSkip: false, notes: null, months: null, date: j.start.slice(0, 10), allDone: null, progress: null, items: {} };
    var lastItems = null; earlier.slice().sort(function (a, b) { return a.start < b.start ? -1 : 1; }).forEach(function (x) { if (x.day_log && x.day_log.items) lastItems = x.day_log.items; });
    if (CHECKIN && lastItems) Object.keys(lastItems).forEach(function (k) { A.items[k] = lastItems[k]; });
    var saved = null;
    try { saved = JSON.parse(localStorage.getItem(SAVE) || 'null'); } catch (e) { /* ignore */ }
    var resumeAt = 0;
    if (saved && saved.A) { A = Object.assign(A, saved.A); resumeAt = saved.i || 0; }
    else if (d.closeout && !CHECKIN) { // editing a job that is already closed out: fill in what was recorded, start on the check screen
      var c = d.closeout, cm = c.men || 2;
      Object.assign(A, { arrived: c.arrived, arrivedOk: true, finished: c.finished, finishedOk: true, men: cm, breaks: c.break_minutes || 0, access: c.access || 'Normal',
        slow: (c.details && c.details.issues && c.details.issues.length) ? c.details.issues : ['Nothing slowed us down'], waste: c.waste_m3 != null ? c.waste_m3 : 0,
        picker: c.picker_used == null ? null : !!c.picker_used, notes: c.notes || '', months: 0, photoSkip: true, extra: false, date: c.work_date || A.date });
      (d.tasks || []).forEach(function (row) {
        var t = plan.tasks.filter(function (x) { return x.name === row.name && (x.service || null) === (row.service || null); })[0], min = Math.round((row.actual_man_hours || 0) / cm * 60 / 5) * 5, g = t && groupOf[t.key];
        if (g) { A.task[g.key] = (A.task[g.key] || 0) + min; if (row.condition && g.hedge) A.cond[g.key] = row.condition; }
        else if (row.category === 'other' && !/^Other time/.test(row.name)) A.extra = { name: row.name, min: min };
      });
      groups.forEach(function (g) { if (A.task[g.key] == null) A.task[g.key] = 0; if (g.hedge && !A.cond[g.key]) A.cond[g.key] = g.members[0].condition || 'maintained'; });
      resumeAt = -1; // = summary
    }
    function save(i) { try { localStorage.setItem(SAVE, JSON.stringify({ A: A, i: i })); } catch (e) { /* ignore */ } }

    function onsite() { var m = toMin(A.finished) - toMin(A.arrived); return m < 0 ? m + 1440 : m; }
    function today() { return Math.max(0, onsite() - (A.breaks || 0)); } // today's working time, team minutes
    function working() { return today() + prevWork; } // all days
    function used(exceptKey) { var s = 0; Object.keys(A.task).forEach(function (k) { if (k !== exceptKey) s += A.task[k] || 0; }); if (A.extra && A.extra.min && exceptKey !== '__extra') s += A.extra.min; return s; }
    var men = function () { return A.men || j.men || plan.crew || 2; };
    // average crew over all the days, so task times answered "for the whole team" convert to man-hours correctly
    var STEPS = [[0, 'Not yet'], [0.25, 'Started'], [0.5, 'Half'], [0.75, 'Most'], [1, 'Done']];
    function work() { return plan.tasks.filter(function (t) { return t.category !== 'setup'; }); }
    function pctDone() {
      var ts = work(), tot = 0, got = 0;
      ts.forEach(function (t) { var w = t.est || 1; tot += w; got += w * (A.items[t.key] || 0); });
      return tot ? Math.round(got / tot * 100) : (A.progress || 0);
    }
    var avgMen = function () { var w = working(); return w ? (prevManMin + today() * men()) / w : men(); };
    var estTeam = function (t) { return (t.est || 0) * 60 / avgMen(); }; // estimate in team minutes

    // ---- the questions ----
    var Q = [], dayWord = multi ? 'Day ' + j.part + ' of ' + j.parts : '';
    if (CHECKIN) Q.push({ label: 'Finished?', id: 'allDone', kind: 'choice', key: 'allDone', title: 'Is the whole job finished today?', sub: dayWord + ' of this job is booked. If you got it all done, we’ll go straight to closing it out.',
      options: [[false, 'No — we’re coming back'], [true, 'Yes — it’s all finished']] });
    Q.push({ label: 'Start time', id: 'arrived', title: (multi ? 'Today, did you start at ' : 'Did you start at ') + clock(j.start.slice(11, 16)) + '?', sub: (multi && !CHECKIN ? (j.part === j.parts ? dayWord + ' — the last day. ' : 'Day ' + j.part + ' — finishing the job today. ') + (earlier.length ? 'The ' + earlier.length + ' earlier day' + (earlier.length === 1 ? ' is' : 's are') + ' already logged. ' : '') : '') + 'The time the crew arrived on site.', kind: 'confirmTime', key: 'arrived', ok: 'arrivedOk' });
    Q.push({ label: 'Finish time', id: 'finished', title: 'Did you finish at ' + clock(j.end.slice(11, 16)) + '?', sub: 'The time you packed up and left.', kind: 'confirmTime', key: 'finished', ok: 'finishedOk',
      check: function () { return onsite() > 0 && onsite() <= 16 * 60 ? '' : 'The finish time needs to be after the start time.'; } });
    Q.push({ label: 'People', id: 'men', title: multi ? 'How many people worked today?' : 'How many people worked on this job?', sub: 'Count everyone, including you.', kind: 'number', key: 'men' });
    Q.push({ label: 'Breaks', id: 'breaks', title: 'How long were your breaks, all up?', sub: 'Smoko and lunch together. If everyone stopped at the same time, count it once.', kind: 'choice', key: 'breaks',
      options: [[0, 'No breaks'], [10, '10 min'], [15, '15 min'], [20, '20 min'], [30, '30 min'], [45, '45 min'], [60, '1 hour'], [90, '1½ hours']] });
    if (CHECKIN && work().length) groups.filter(function (g) { return !g.setup; }).forEach(function (g) {
      var many = g.members.length > 1;
      Q.push({ id: 'prog:' + g.key, label: g.name + ' — done', kind: 'items', task: g,
        title: many ? 'How far through ' + g.phrase + ' are you?' : 'How much of the ' + g.members[0].name.toLowerCase() + ' is done?',
        sub: (lastItems ? 'Yesterday’s answers are filled in — change what moved on today. ' : 'Counting everything done so far. ') + (many ? 'Tap one for each.' : '') });
    });
    if (CHECKIN) {
      if (!work().length) Q.push({ label: 'Progress', id: 'progress', kind: 'choice', key: 'progress', title: 'How much of the whole job is done now?', sub: 'Counting earlier days too. A rough guess is fine — it tells us if more days are needed.',
        options: [[25, 'About a quarter'], [33, 'About a third'], [50, 'About half'], [66, 'About two thirds'], [75, 'About three quarters'], [90, 'Nearly all of it']] });
      Q.push({ label: 'Photos', id: 'photos', kind: 'photos', title: 'Take a progress photo', sub: 'Optional — one shot of where you got to today.' });
      Q.push({ label: 'Notes', id: 'notes', kind: 'notes', title: 'Anything for the next day?', sub: 'Tap to add, or type your own.', quick: ['Gear left on site', 'Start at the back', 'Gate code needed', 'Customer away tomorrow', 'Waste still to take', 'Need more men'] });
      Q.push({ id: 'summary', kind: 'summary', title: 'Check and save the day' });
    }
    if (!CHECKIN) groups.forEach(function (g, gi) {
      var many = g.members.length > 1, units = g.members.map(function (t) { return t.unit; }).filter(Boolean), oneUnit = units.length === g.members.length && units.every(function (u) { return u === units[0]; });
      var qty = oneUnit ? App.qty(g.members.reduce(function (a, t) { return a + (+t.qty || 0); }, 0), units[0]) : '';
      Q.push({ id: 'task:' + g.key, label: g.name, kind: 'duration', task: g, last: gi === groups.length - 1,
        title: 'How long did ' + (g.setup ? g.phrase : many ? g.phrase : 'the ' + g.members[0].name.toLowerCase()) + ' take?',
        sub: (multi ? 'Over all ' + j.part + ' days. ' : '') + (many ? g.members.map(function (t) { return t.name; }).join(', ') + (qty ? ' (' + qty + ' all up)' : '') + '. ' : qty && !g.setup ? qty + ' · ' : '') + 'We guessed about ' + dur(q15(estTeam(g))) + '. Answer for the whole team working together.' });
      if (g.hedge) Q.push({ id: 'cond:' + g.key, label: (many ? 'Hedges' : g.members[0].name) + ' — condition', kind: 'condition', task: g,
        title: many ? 'What were the hedges like?' : 'What was the ' + g.members[0].name.toLowerCase() + ' like?', sub: many ? 'Pick the closest for most of them. This helps us price it right next time.' : 'This helps us price it right next time.' });
    });
    if (!CHECKIN) {
    Q.push({ label: 'Extra work', id: 'extra', kind: 'extra', title: 'Did you do any other work that wasn’t on the quote?', sub: 'For example extra pruning or weeding the customer asked for.' });
    Q.push({ label: 'Access', id: 'access', kind: 'choice', key: 'access', title: 'How easy was it to get to?', sub: 'Getting gear in and working around the hedge.', options: [['Easy', 'Easy'], ['Normal', 'Normal'], ['Difficult', 'Hard']] });
    Q.push({ label: 'Slowed down by', id: 'slow', kind: 'multi', key: 'slow', title: 'Did anything slow you down?', sub: 'Tap all that apply.', options: ['More overgrown than expected', 'Steep or uneven ground', 'Tight access', 'Wet weather', 'Hot weather', 'Equipment trouble', 'Customer asked for extras', 'More waste than expected'], none: 'Nothing slowed us down' });
    Q.push({ label: 'Green waste', id: 'waste', kind: 'choice', key: 'waste', title: 'How much green waste did you take away?', sub: 'A 6×4 trailer, heaped, holds about 2 m³.',
      options: [[0, 'None'], [0.5, 'A little (under 1 m³)'], [1, 'About 1 m³'], [2, 'About 2 m³ (one trailer)'], [3, 'About 3 m³'], [4, 'About 4 m³ (two trailers)'], [6, 'More than 4 m³']] });
    if (plan.needsPicker) Q.push({ label: 'Cherry picker', id: 'picker', kind: 'choice', key: 'picker', title: 'Did you use the cherry picker?', options: [[true, 'Yes'], [false, 'No']] });
    Q.push({ label: 'Photos', id: 'photos', kind: 'photos', title: 'Take a photo of the finished job', sub: 'One or two “after” shots. They go on the job and can be shown to the customer.' });
    Q.push({ label: 'Notes', id: 'notes', kind: 'notes', title: 'Anything we should know for next time?', sub: 'Tap to add, or type your own.', quick: ['Dog on site', 'Gate code needed', 'Customer wants it lower', 'Power lines nearby', 'Park on the street', 'Watch the garden beds'] });
    Q.push({ label: 'Next trim', id: 'months', kind: 'choice', key: 'months', title: 'When should we come back for the next trim?', sub: 'We’ll remind you when it’s due.',
      options: [[3, 'In 3 months'], [4, 'In 4 months'], [6, 'In 6 months'], [12, 'In 12 months'], [0, d.closeout ? 'Leave the reminder as it is' : 'Don’t remind me']] });
    Q.push({ id: 'summary', kind: 'summary', title: 'Check and finish' });
    }

    function done(q) {
      if (q.kind === 'confirmTime') return A[q.ok] === true && (!q.check || !q.check());
      if (q.kind === 'number' || q.kind === 'choice') return A[q.key] != null;
      if (q.kind === 'duration') return A.task[q.task.key] != null;
      if (q.kind === 'condition') return !!A.cond[q.task.key];
      if (q.kind === 'extra') return A.extra === false || !!(A.extra && A.extra.min);
      if (q.kind === 'multi') return A.slow.length > 0;
      if (q.kind === 'photos') return A.photoSkip || photos.some(function (p) { return p.category === 'after'; });
      if (q.kind === 'notes') return A.notes != null;
      if (q.kind === 'items') return q.task.members.every(function (t) { return A.items[t.key] != null; });
      return true;
    }
    function answerText(q) {
      if (q.kind === 'confirmTime') return clock(A[q.key]);
      if (q.id === 'men') return A.men + (A.men === 1 ? ' person' : ' people');
      if (q.id === 'breaks') return A.breaks ? dur(A.breaks) : 'No breaks';
      if (q.kind === 'duration') return dur(A.task[q.task.key] || 0);
      if (q.kind === 'condition') { var cid = A.cond[q.task.key], c = conds.filter(function (x) { return x.id === cid; })[0]; return names[cid] || (c ? c.label : cid); }
      if (q.kind === 'extra') return A.extra && A.extra.min ? A.extra.name + ' · ' + dur(A.extra.min) : 'No';
      if (q.kind === 'multi') return A.slow.join(', ');
      if (q.id === 'waste') return (q.options.filter(function (o) { return o[0] === A.waste; })[0] || [0, A.waste + ' m³'])[1];
      if (q.id === 'access') return A.access === 'Difficult' ? 'Hard' : A.access;
      if (q.id === 'picker') return A.picker ? 'Yes' : 'No';
      if (q.kind === 'photos') return photos.length ? photos.length + ' photo' + (photos.length === 1 ? '' : 's') : 'Skipped';
      if (q.kind === 'notes') return A.notes || 'None';
      if (q.id === 'months') return A.months ? 'In ' + A.months + ' months' : d.closeout ? 'Leave as it is' : 'No reminder';
      if (q.id === 'allDone') return A.allDone ? 'Yes' : 'No — coming back';
      if (q.kind === 'items') return q.task.members.map(function (t) { var st = STEPS.filter(function (x) { return x[0] === A.items[t.key]; })[0]; return (q.task.members.length > 1 ? t.name + ': ' : '') + (st ? st[1] : '—'); }).join(', ');
      if (q.id === 'progress') return (q.options.filter(function (o) { return o[0] === A.progress; })[0] || [0, ''])[1];
      return '';
    }

    // ---- the screen ----
    var el = document.createElement('div'); el.className = 'cx';
    el.innerHTML = '<header class="cx-top"><button class="cx-x" aria-label="Close">' + icon('close') + '</button><div class="cx-prog"><div class="cx-bar"><i></i></div><span class="cx-count"></span></div></header>' +
      '<main class="cx-body"></main><footer class="cx-foot"><button class="cx-back">Back</button><button class="cx-next">Next</button></footer>';
    document.body.appendChild(el); document.body.classList.add('cx-open');
    var body = el.querySelector('.cx-body'), i = resumeAt < 0 ? Q.length - 1 : Math.min(resumeAt, Q.length - 1), autoT = null;
    function close() { el.remove(); document.body.classList.remove('cx-open'); window.removeEventListener('hashchange', onNav); }
    function onNav() { save(i); close(); }
    window.addEventListener('hashchange', onNav);
    el.querySelector('.cx-x').onclick = function () { save(i); close(); App.toast('Saved — you can carry on later from the job.'); };
    el.querySelector('.cx-back').onclick = function () { if (i > 0) { i--; show(); } };
    el.querySelector('.cx-next').onclick = function () { var q = Q[i]; if (!done(q)) return; if (q.kind === 'summary') return finish(); i++; save(i); show(); };
    function advanceSoon() { clearTimeout(autoT); autoT = setTimeout(function () { if (done(Q[i])) { i++; save(i); show(); } }, 280); }
    function big(val, label, on, extraCls) { return '<button class="cx-opt' + (on ? ' on' : '') + (extraCls ? ' ' + extraCls : '') + '" data-v="' + esc(String(val)) + '">' + label + (on ? '<span class="cx-tick">' + icon('check') + '</span>' : '') + '</button>'; }

    function show() {
      clearTimeout(autoT);
      var q = Q[i], h = '';
      el.querySelector('.cx-bar i').style.width = Math.round(i / (Q.length - 1) * 100) + '%';
      el.querySelector('.cx-count').textContent = q.kind === 'summary' ? 'Last step' : 'Question ' + (i + 1) + ' of ' + (Q.length - 1);
      el.querySelector('.cx-back').style.visibility = i ? 'visible' : 'hidden';
      h += '<h1 class="cx-q">' + esc(q.title) + '</h1>' + (q.sub ? '<p class="cx-sub">' + esc(q.sub) + '</p>' : '');
      if (q.kind === 'confirmTime') {
        var editing = A[q.ok] === 'edit';
        h += '<div class="cx-opts">' + big('yes', 'Yes, ' + clock(q.key === 'arrived' ? j.start.slice(11, 16) : j.end.slice(11, 16)), A[q.ok] === true && A[q.key] === (q.key === 'arrived' ? j.start.slice(11, 16) : j.end.slice(11, 16))) + big('no', 'No, a different time', editing || (A[q.ok] === true && A[q.key] !== (q.key === 'arrived' ? j.start.slice(11, 16) : j.end.slice(11, 16)))) + '</div>' +
          (editing || (A[q.ok] && A[q.key] !== (q.key === 'arrived' ? j.start.slice(11, 16) : j.end.slice(11, 16))) ? '<label class="cx-time"><span>' + (q.key === 'arrived' ? 'Start time' : 'Finish time') + '</span><input type="time" step="300" value="' + A[q.key] + '" data-time="' + q.key + '"></label>' : '') +
          (q.check && A[q.ok] && q.check() ? '<p class="cx-warn">' + q.check() + '</p>' : '') +
          (q.key === 'finished' && A.finishedOk && !q.check() ? '<p class="cx-note">On site for <b>' + dur(onsite()) + '</b>.</p>' : '');
      } else if (q.kind === 'number') {
        h += '<div class="cx-grid">' + [1, 2, 3, 4, 5, 6, 7, 8].map(function (n) { return big(n, String(n), A.men === n, 'num'); }).join('') + '</div>';
      } else if (q.kind === 'choice') {
        h += '<div class="cx-opts">' + q.options.map(function (o) { return big(o[0], esc(o[1]), A[q.key] === o[0]); }).join('') + '</div>';
        if (q.id === 'breaks' && A.breaks != null) h += '<p class="cx-note">Working time ' + (multi ? 'today' : '') + ': <b>' + dur(today()) + '</b> (' + dur(onsite()) + ' on site, less breaks)' + (prevWork ? '. With the earlier days: <b>' + dur(working()) + '</b>' : '') + '</p>';
        if (q.id === 'months' && A.months) { var dd = new Date(A.date + 'T00:00:00'); dd.setMonth(dd.getMonth() + A.months); h += '<p class="cx-note">We’ll remind you around <b>' + dd.toLocaleDateString('en-AU', { day: 'numeric', month: 'long', year: 'numeric' }) + '</b>.</p>'; }
      } else if (q.kind === 'duration') {
        var e = estTeam(q.task), left = working() - used(q.task.key), cur = A.task[q.task.key];
        var opts = [0.5, 0.75, 1, 1.25, 1.5, 2].map(function (k) { return q15(e * k || 30 * k); }).filter(function (v, x, arr) { return arr.indexOf(v) === x; });
        h += '<div class="cx-left' + (left < 0 ? ' over' : '') + '">' + (left > 0 ? 'Time left to account for: <b>' + dur(left) + '</b>' : left === 0 ? 'All of the working time is accounted for' : 'That’s <b>' + dur(-left) + '</b> more than the working time') + '</div>';
        h += '<div class="cx-opts two">' + (q.last && left > 0 ? big(left, 'All the rest · ' + dur(left), cur === left, 'wide accent') : '') + opts.map(function (m) { return big(m, dur(m), cur === m); }).join('') + '</div>';
        h += '<div class="cx-adjust"><span>Or set it exactly:</span><button class="cx-step" data-step="-15">−15 min</button><b>' + (cur != null ? dur(cur) : '—') + '</b><button class="cx-step" data-step="15">+15 min</button></div>';
      } else if (q.kind === 'items') {
        if (q.task.members.length === 1) { var t1 = q.task.members[0]; h += '<div class="cx-opts">' + STEPS.slice().reverse().map(function (st) { return big('it:' + t1.key + ':' + st[0], esc(st[0] === 1 ? 'All done' : st[0] === 0 ? 'Not started yet' : st[1] === 'Most' ? 'Most of it' : st[1] === 'Half' ? 'About half' : 'Just started'), A.items[t1.key] === st[0]); }).join('') + '</div>'; }
        else h += q.task.members.map(function (t) {
          return '<div class="cx-item"><b>' + esc(t.name) + (t.qty != null ? ' <small>' + esc(App.qty(t.qty, t.unit)) + '</small>' : '') + '</b><div class="cx-steps">' + STEPS.map(function (st) { return '<button type="button" data-it="' + esc(t.key) + '" data-f="' + st[0] + '" class="' + (A.items[t.key] === st[0] ? 'on' : '') + '">' + st[1] + '</button>'; }).join('') + '</div></div>';
        }).join('');
        h += '<p class="cx-note">The whole job: about <b>' + pctDone() + '% done</b>.</p>';
      } else if (q.kind === 'condition') {
        h += '<div class="cx-opts">' + (conds.length ? conds : [{ id: 'maintained' }, { id: 'overgrown' }, { id: 'reduction' }]).map(function (c) { return big(c.id, esc(names[c.id] || c.label), A.cond[q.task.key] === c.id); }).join('') + '</div>';
      } else if (q.kind === 'extra') {
        h += '<div class="cx-opts">' + big('no', 'No', A.extra === false) + big('yes', 'Yes', !!A.extra) + '</div>';
        if (A.extra) h += '<label class="cx-field"><span>What was it?</span><input type="text" data-extra-name value="' + esc(A.extra.name || '') + '" placeholder="e.g. Pruned the lemon tree"></label>' +
          '<div class="cx-sub" style="margin-top:14px">How long did it take?</div><div class="cx-opts two">' + [15, 30, 45, 60, 90, 120].map(function (m) { return big('x' + m, dur(m), A.extra.min === m); }).join('') + '</div>';
      } else if (q.kind === 'multi') {
        h += '<div class="cx-opts">' + q.options.map(function (o) { return big(o, esc(o), A.slow.indexOf(o) >= 0); }).join('') + big('__none', esc(q.none), A.slow[0] === q.none, 'muted-opt') + '</div>';
      } else if (q.kind === 'photos') {
        var after = photos.filter(function (p) { return p.category === 'after'; }), before = photos.filter(function (p) { return p.category === 'before'; });
        h += '<label class="cx-camera">' + icon('camera') + '<span>' + (after.length ? 'Take another photo' : 'Take a photo') + '</span><input type="file" accept="image/*" capture="environment" hidden data-up="after"></label>' +
          '<div class="cx-row"><label class="cx-small">Choose from photos<input type="file" accept="image/*" multiple hidden data-up="after"></label><label class="cx-small">Add a “before” photo<input type="file" accept="image/*" multiple hidden data-up="before"></label></div>' +
          (photos.length ? '<div class="cx-thumbs">' + photos.map(function (p) { return '<span style="background-image:url(\'' + esc(p.url) + '\')"><em>' + esc(p.category) + '</em></span>'; }).join('') + '</div>' : '') +
          '<div id="cx-upl"></div>' + (after.length ? '' : '<button class="cx-skip" data-skip>' + (A.photoSkip ? '✓ No photo this time' : 'Skip — no photo this time') + '</button>');
        if (before.length && !after.length) h += '';
      } else if (q.kind === 'notes') {
        h += '<div class="cx-chips">' + q.quick.map(function (n) { return '<button class="cx-chip" data-note="' + esc(n) + '">+ ' + esc(n) + '</button>'; }).join('') + '</div>' +
          '<textarea class="cx-text" data-notes placeholder="Type a note (optional)">' + esc(A.notes || '') + '</textarea>' +
          '<button class="cx-skip" data-nonotes>' + (A.notes === '' ? '✓ No notes' : 'No notes') + '</button>';
      } else if (q.kind === 'summary') {
        var tasksTotal = used(null), gap = CHECKIN ? 0 : working() - tasksTotal, wk = Math.round(working()), totMH = Math.round((prevManMin + today() * men()) / 60 * 4) / 4;
        if (CHECKIN) { var pc = pctDone(); h += '<div class="progress" style="height:14px"><i style="width:' + pc + '%"></i></div><p class="cx-note" style="margin:6px 0 14px">About <b>' + pc + '%</b> of the job is done.</p>' + (pc >= 100 ? '<p class="cx-note">Everything is marked done.</p><div class="cx-opts" style="margin-bottom:14px">' + big('fix:closeout', 'It’s all finished — close out the job', false, 'accent') + '</div>' : ''); }
        h += '<div class="cx-sumhead"><div><small>' + (CHECKIN ? 'Worked today' : multi ? 'Working time, ' + j.part + ' days' : 'Working time') + '</small><b>' + Math.floor(wk / 60) + 'h' + (wk % 60 ? ' ' + wk % 60 + 'm' : '') + '</b></div><div><small>People' + (multi ? ' today' : '') + '</small><b>' + men() + '</b></div><div><small>Man-hours</small><b>' + totMH + '</b></div></div>' +
          (gap > 0 ? '<p class="cx-note">' + dur(gap) + ' isn’t linked to a task — we’ll record it as “other time”. Tap Change on a task if you want to add it there.</p>' : gap < 0 ? '<p class="cx-warn">Your task times add up to <b>' + dur(-gap) + '</b> more than the time you worked. Pick one to fix it:</p><div class="cx-opts" style="margin-top:10px">' +
            big('fix:shrink', 'Shrink the task times to fit', false) + big('fix:finish', 'We finished later — make it ' + clock(addMin(A.finished, -gap)), false) + '</div>' : '') +
          '<div class="cx-list">' + Q.slice(0, -1).map(function (qq, qi) { return '<div class="cx-li"><div><small>' + esc(qq.label || qq.title) + '</small><b>' + esc(answerText(qq)) + '</b></div><button data-jump="' + qi + '">Change</button></div>'; }).join('') + '</div>';
      }
      body.innerHTML = '<div class="cx-in">' + h + '</div>';
      body.scrollTop = 0;
      var next = el.querySelector('.cx-next');
      next.textContent = q.kind === 'summary' ? (CHECKIN ? 'Save the day' : 'Finish job') : 'Next';
      next.disabled = !done(q) || (q.kind === 'summary' && working() - used(null) < -1);
      next.classList.toggle('go', q.kind === 'summary');
    }

    // ---- answering ----
    body.addEventListener('click', function (e) {
      var q = Q[i], b;
      if ((b = e.target.closest('[data-jump]'))) { i = +b.getAttribute('data-jump'); show(); return; }
      if ((b = e.target.closest('[data-it]'))) { A.items[b.getAttribute('data-it')] = +b.getAttribute('data-f'); save(i); var keep = body.scrollTop; show(); body.scrollTop = keep; return; }
      if ((b = e.target.closest('[data-step]'))) { var cur = A.task[q.task.key] != null ? A.task[q.task.key] : q15(estTeam(q.task)); A.task[q.task.key] = Math.max(0, cur + +b.getAttribute('data-step')); save(i); show(); return; }
      if ((b = e.target.closest('[data-note]'))) { var n = b.getAttribute('data-note'); A.notes = (A.notes ? A.notes.replace(/\s+$/, '') + (/[.!]$/.test(A.notes) ? ' ' : '. ') : '') + n; save(i); show(); return; }
      if (e.target.closest('[data-nonotes]')) { A.notes = ''; save(i); show(); advanceSoon(); return; }
      if (e.target.closest('[data-skip]')) { A.photoSkip = !A.photoSkip; save(i); show(); if (A.photoSkip) advanceSoon(); return; }
      b = e.target.closest('.cx-opt'); if (!b || !b.hasAttribute('data-v')) return;
      var v = b.getAttribute('data-v');
      if (v === 'fix:shrink') {
        var tot = used(null), k = tot ? working() / tot : 1;
        Object.keys(A.task).forEach(function (key) { A.task[key] = Math.round(A.task[key] * k / 5) * 5; });
        if (A.extra && A.extra.min) A.extra.min = Math.round(A.extra.min * k / 5) * 5;
        var off = working() - used(null), big1 = Object.keys(A.task).sort(function (a, c) { return A.task[c] - A.task[a]; })[0];
        if (off && big1) A.task[big1] = Math.max(0, A.task[big1] + off); // rounding leftovers go on the biggest task
        save(i); show(); return;
      }
      if (v.indexOf('it:') === 0) { var cut = v.lastIndexOf(':'); A.items[v.slice(3, cut)] = +v.slice(cut + 1); save(i); show(); advanceSoon(); return; }
      if (v === 'fix:closeout') { try { localStorage.removeItem(SAVE); } catch (x) { /* ignore */ } close(); runCloseout(d, onDone, rates, 'closeout'); return; }
      if (v === 'fix:finish') { A.finished = addMin(A.finished, used(null) - working()); save(i); show(); return; }
      if (q.kind === 'confirmTime') {
        var sched = q.key === 'arrived' ? j.start.slice(11, 16) : j.end.slice(11, 16);
        if (v === 'yes') { A[q.key] = sched; A[q.ok] = true; save(i); show(); if (!q.check || !q.check()) advanceSoon(); }
        else { A[q.ok] = 'edit'; show(); var inp = body.querySelector('[data-time]'); if (inp) inp.focus(); }
        return;
      }
      if (q.kind === 'number') { A.men = +v; save(i); show(); advanceSoon(); return; }
      if (q.id === 'allDone' && v === 'true') { try { localStorage.removeItem(SAVE); } catch (x) { /* ignore */ } close(); runCloseout(d, onDone, rates, 'closeout'); return; }
      if (q.kind === 'choice') { var o = q.options.filter(function (x) { return String(x[0]) === v; })[0]; A[q.key] = o[0]; save(i); show(); advanceSoon(); return; }
      if (q.kind === 'duration') { A.task[q.task.key] = +v; save(i); show(); advanceSoon(); return; }
      if (q.kind === 'condition') { A.cond[q.task.key] = v; save(i); show(); advanceSoon(); return; }
      if (q.kind === 'extra') {
        if (v === 'no') { A.extra = false; save(i); show(); advanceSoon(); return; }
        if (v === 'yes') { if (!A.extra) A.extra = { name: '', min: null }; save(i); show(); var nm = body.querySelector('[data-extra-name]'); if (nm) nm.focus(); return; }
        if (v.charAt(0) === 'x') { A.extra.min = +v.slice(1); if (!A.extra.name) A.extra.name = 'Other work'; save(i); show(); return; }
      }
      if (q.kind === 'multi') {
        if (v === '__none') A.slow = [q.none];
        else { A.slow = A.slow.filter(function (x) { return x !== q.none; }); var ix = A.slow.indexOf(v); if (ix >= 0) A.slow.splice(ix, 1); else A.slow.push(v); }
        save(i); show(); return;
      }
    });
    body.addEventListener('input', function (e) {
      var t = e.target;
      if (t.hasAttribute('data-time') && t.value) { A[t.getAttribute('data-time')] = t.value; A[Q[i].ok] = true; save(i); var nx = el.querySelector('.cx-next'); nx.disabled = !done(Q[i]); var w = body.querySelector('.cx-warn'); if (w && done(Q[i])) w.remove(); }
      if (t.hasAttribute('data-extra-name')) { A.extra.name = t.value; save(i); }
      if (t.hasAttribute('data-notes')) { A.notes = t.value; save(i); el.querySelector('.cx-next').disabled = false; }
    });
    body.addEventListener('change', function (e) {
      var t = e.target;
      if (t.hasAttribute('data-time')) { if (t.value) { A[t.getAttribute('data-time')] = t.value; A[Q[i].ok] = true; save(i); } show(); }
      var up = t.closest('input[type=file][data-up]'); if (!up || !up.files.length) return;
      var files = Array.prototype.slice.call(up.files), kind = up.getAttribute('data-up'), box = body.querySelector('#cx-upl');
      if (box) box.innerHTML = '<p class="cx-note">Uploading ' + files.length + ' photo' + (files.length === 1 ? '' : 's') + '…</p>';
      files.reduce(function (p, f) { return p.then(function () { return upload(j.id, f, kind).then(function (ph) { photos.push(ph); d.photos.push(ph); }); }); }, Promise.resolve())
        .then(function () { A.photoSkip = false; save(i); show(); })
        .catch(function (x) { if (box) box.innerHTML = '<p class="cx-warn">' + esc(x.message) + ' — check your signal and try again.</p>'; });
    });

    function finishDay() {
      var next = el.querySelector('.cx-next'); next.disabled = true; next.textContent = 'Saving…';
      App.post('jobs/' + j.id + '/checkin', { arrived: A.arrived, finished: A.finished, men: men(), breakMinutes: A.breaks || 0, progress: Math.max(1, Math.min(99, pctDone())), items: work().length ? A.items : null, notes: A.notes || '' }).then(function (r) {
        try { localStorage.removeItem(SAVE); } catch (e) { /* ignore */ }
        var behind = r.needMH > r.bookedMH * 1.1 + 1, ahead = r.bookedMH > r.needMH * 1.15 + 2, needQ = Math.max(0.25, Math.ceil(r.needMH * 4) / 4);
        body.innerHTML = '<div class="cx-in cx-done"><div class="cx-big-tick">' + icon('check') + '</div><h1 class="cx-q">Day ' + j.part + ' saved</h1>' +
          '<p class="cx-sub">' + esc(j.customer) + ' · ' + r.doneMH + ' man-hours done so far · about ' + r.log.progress + '% of the job.</p>' +
          '<div class="progress"><i style="width:' + r.log.progress + '%"></i></div>' +
          (behind ? '<p class="cx-warn">At this rate the rest needs about <b>' + needQ + ' man-hours</b>, but only <b>' + r.bookedMH + '</b> are booked.</p>'
            : ahead ? '<p class="cx-note">You’re ahead — the rest looks like about <b>' + needQ + ' man-hours</b>, and ' + r.bookedMH + ' are booked.</p>'
            : '<p class="cx-note">On track — ' + r.bookedMH + ' man-hours are booked for the rest.</p>') +
          (behind || ahead || !r.next ? '<button class="cx-opt accent" id="cx-fit" style="width:100%;margin-top:10px">' + (behind || !r.next ? 'Book more time for the rest (' + needQ + ' man-h)' : 'Shorten the days left to ' + needQ + ' man-h') + '</button>' : '') +
          (r.next ? '<p class="cx-sub" style="margin-top:14px" id="cx-next">Next: <b>' + new Date(r.next.start.slice(0, 10) + 'T00:00:00').toLocaleDateString('en-AU', { weekday: 'long', day: 'numeric', month: 'short' }) + ', ' + clock(r.next.start.slice(11, 16)) + '</b></p>' : '') + '</div>';
        var fit = body.querySelector('#cx-fit');
        if (fit) fit.onclick = function () {
          fit.disabled = true; fit.textContent = 'Updating the schedule…';
          App.post('jobs/' + j.id + '/reflow', { totalManHours: needQ }).then(function (x) {
            var dd = x.flowed.days, fmt = function (v) { return new Date(v.slice(0, 10) + 'T00:00:00').toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short' }); };
            fit.outerHTML = '<p class="cx-note">Done — ' + dd.length + ' day' + (dd.length === 1 ? '' : 's') + ' left: <b>' + dd.map(fmt).join(', ') + '</b>.</p>';
            var nx = body.querySelector('#cx-next'); if (nx) nx.remove();
          }).catch(function (x) { fit.disabled = false; fit.textContent = 'Try again'; App.toast(x.message, 'err', 6000); });
        };
        el.querySelector('.cx-back').style.visibility = 'hidden'; el.querySelector('.cx-bar i').style.width = '100%'; el.querySelector('.cx-count').textContent = 'Saved';
        next.disabled = false; next.textContent = 'Done'; next.onclick = function () { close(); if (onDone) onDone(); };
      }).catch(function (x) { next.disabled = false; next.textContent = 'Try again'; App.toast(x.message + ' — your answers are saved.', 'err', 7000); });
    }
    function finish() {
      if (CHECKIN) return finishDay();
      var next = el.querySelector('.cx-next'); next.disabled = true; next.textContent = 'Saving…';
      var m = avgMen(), toMH = function (min) { return Math.round(min / 60 * m * 100) / 100; };
      var tasks = [];
      groups.forEach(function (g) {
        var min = A.task[g.key] || 0, est = g.members.reduce(function (a, t) { return a + (t.est || 0); }, 0), qty = g.members.reduce(function (a, t) { return a + (+t.qty || 0); }, 0);
        g.members.forEach(function (t) { var share = est ? (t.est || 0) / est : qty ? (+t.qty || 0) / qty : 1 / g.members.length; tasks.push({ key: t.key, name: t.name, actual: toMH(min * share), condition: (g.hedge && A.cond[g.key]) || t.condition }); });
      });
      if (A.extra && A.extra.min) tasks.push({ key: 'extra:work', name: A.extra.name || 'Other work', actual: toMH(A.extra.min) });
      var gap = working() - used(null); if (gap >= 15) tasks.push({ key: 'extra:other', name: 'Other time (not linked to a task)', actual: toMH(gap) });
      App.post('jobs/' + j.id + '/closeout', { date: A.date, arrived: A.arrived, finished: A.finished, men: men(), breakMinutes: A.breaks || 0, tasks: tasks,
        access: A.access, issues: A.slow.filter(function (x) { return x !== 'Nothing slowed us down'; }), wasteM3: A.waste, pickerUsed: A.picker, notes: A.notes || '', nextTrimMonths: A.months || 0 })
        .then(function (r) {
          try { localStorage.removeItem(SAVE); } catch (e) { /* ignore */ }
          var diff = r.estimate ? Math.round((r.workingManHours - r.estimate) / r.estimate * 100) : null;
          body.innerHTML = '<div class="cx-in cx-done"><div class="cx-big-tick">' + icon('check') + '</div><h1 class="cx-q">Job closed out</h1>' +
            '<p class="cx-sub">' + esc(j.customer) + ' · ' + r.workingManHours + ' man-hours recorded' + (diff != null ? ' (' + (diff > 0 ? diff + '% more' : diff < 0 ? (-diff) + '% less' : 'right on') + ' than quoted)' : '') + '.</p>' +
            (r.nextTrim ? '<p class="cx-note">Next trim reminder: <b>' + App.date(r.nextTrim) + '</b></p>' : '') + '<p class="cx-sub">Thanks — this makes the next quote more accurate.</p></div>';
          el.querySelector('.cx-back').style.visibility = 'hidden'; el.querySelector('.cx-bar i').style.width = '100%'; el.querySelector('.cx-count').textContent = 'Done';
          next.disabled = false; next.textContent = 'Done'; next.onclick = function () { close(); if (onDone) onDone(); };
        })
        .catch(function (x) { next.disabled = false; next.textContent = 'Try again'; App.toast(x.message + ' — your answers are saved.', 'err', 7000); });
    }
    show();
    if (resumeAt > 0) App.toast('Carrying on where you left off.');
  }

  // ---------------- job page ----------------
  App.route('/jobs/:id', 'schedule', function (ctx) {
    var id = ctx.params[0];
    function load() {
      App.get('jobs/' + encodeURIComponent(id)).then(function (d) {
        if (!ctx.el.isConnected) return;
        var j = d.job, c = d.closeout, done = j.status === 'Completed';
        // multi-day: which action fits this day
        var days = d.days || [], multi = j.parts > 1, last = !multi || j.part === j.parts;
        var behind = days.filter(function (x) { return x.part < j.part && x.status !== 'Completed'; })[0];
        var act = c ? { label: 'Edit close-out', run: 'closeout' } : behind ? { label: 'Check in day ' + behind.part + ' first', go: behind.id }
          : !last ? { label: done ? 'Redo day ' + j.part + ' check-in' : 'End of day check-in', fab: 'Check in for today', run: 'checkin', open: !done }
          : { label: 'Close out job', fab: 'Close out this job', run: 'closeout', open: true };
        App.setTop({ el: ctx.el, back: '#/schedule?date=' + j.start.slice(0, 10), titleHtml: '<span class="tt">' + esc(j.customer) + '</span> ' + (multi ? '<span class="tag info">Day ' + j.part + ' of ' + j.parts + '</span> ' : '') + App.pill(j.status), sub: [j.address, j.suburb].filter(Boolean).join(', ') + ' · ' + App.date(j.start) + ' ' + App.time(j.start),
          actions: '<a class="btn" href="#/quotes/' + esc(j.quote_id) + '">' + icon('quote') + '<span class="lbl">' + esc(j.quote_number) + '</span></a><a class="btn" target="_blank" rel="noopener" href="https://www.google.com/maps/dir/?api=1&destination=' + (j.lat != null ? j.lat + ',' + j.lng : encodeURIComponent([j.address, j.suburb].join(', '))) + '">' + icon('gps') + '<span class="lbl">Directions</span></a>' +
            '<button class="btn primary" id="close-out">' + icon('check') + '<span class="lbl">' + esc(act.label) + '</span></button>' });
        function doAct() { if (act.go) location.hash = '#/jobs/' + act.go; else closeout(d, load, act.run); }
        document.getElementById('close-out').onclick = doAct;
        var plan = d.plan || { tasks: [], estimate: 0 }, tasks = d.tasks || [];
        var results = c ? '<div class="co-review"><div><small>Working man-hours</small><b>' + hm(c.working_man_hours) + '</b></div><div><small>Estimated</small><b>' + hm(c.estimated_man_hours) + '</b></div><div><small>Difference</small><b class="' + (c.working_man_hours > c.estimated_man_hours * 1.1 ? 'over' : c.working_man_hours < c.estimated_man_hours * 0.9 ? 'under' : '') + '">' + pctDiff(c.working_man_hours, c.estimated_man_hours) + '</b></div><div><small>On site</small><b>' + clockStr(c.arrived) + '–' + clockStr(c.finished) + '</b><small>' + c.men + ' men · ' + c.break_minutes + ' min breaks</small></div></div>' +
          '<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Task</th><th class="r">Qty</th><th class="r">Estimate</th><th class="r">Actual</th><th class="r">±</th><th class="r">Rate achieved</th></tr></thead><tbody>' + tasks.map(function (t) {
            var rate = t.qty && t.actual_man_hours ? (t.qty / t.actual_man_hours).toFixed(1) + ' ' + (t.unit || '') + '/h' : '';
            return '<tr><td><b>' + esc(t.name) + '</b>' + (t.tier ? '<small>' + esc(t.tier) + (t.condition ? ' · ' + esc(t.condition) : '') + '</small>' : '') + '</td><td class="r">' + (t.qty != null ? App.qty(t.qty, t.unit) : '') + '</td><td class="r">' + (t.est_man_hours ? hm(t.est_man_hours) : '—') + '</td><td class="r">' + hm(t.actual_man_hours) + '</td><td class="r">' + pctDiff(t.actual_man_hours, t.est_man_hours) + '</td><td class="r">' + rate + '</td></tr>';
          }).join('') + '</tbody></table></div>' + (c.notes ? '<p><b>Notes:</b> ' + esc(c.notes) + '</p>' : '') + ((c.details && c.details.issues && c.details.issues.length) ? '<p class="muted small">Slowed by: ' + esc(c.details.issues.join(', ')) + ' · access ' + esc(c.access || '') + '</p>' : '')
          : !last ? '<div class="empty" style="padding:20px">' + icon('clock') + '<b>' + (j.day_log ? 'Day ' + j.part + ' is checked in' : 'Day ' + j.part + ' of ' + j.parts) + '</b>' + (j.day_log ? 'The full close-out happens on the last day and adds up every day.' : 'At the end of the day, tap <b>End of day check-in</b> — four quick questions. The full close-out happens on the last day.') + '</div>'
          : '<div class="empty" style="padding:20px">' + icon('clock') + '<b>Not closed out yet</b>When the job’s done, tap <b>Close out job</b> — a few quick questions record how long each task really took, so future quotes get sharper.</div>';
        // the days of a multi-day job, with a progress bar
        var daysCard = '';
        if (multi) {
          var logged = days.reduce(function (a, x) { return a + (x.day_log ? x.day_log.workingMH || 0 : 0); }, 0), booked = days.reduce(function (a, x) { return a + (x.status !== 'Completed' ? +x.man_hours || 0 : 0); }, 0);
          var lastLog = days.filter(function (x) { return x.day_log; }).pop(), pct = c ? 100 : lastLog ? lastLog.day_log.progress : 0;
          var doneItems = lastLog && lastLog.day_log.items, doneList = doneItems ? '<div class="done-list">' + plan.tasks.filter(function (t) { return t.category !== 'setup'; }).map(function (t) {
            var f = Math.round((doneItems[t.key] || 0) * 100); return '<div class="done-row"><span>' + esc(t.name) + '</span><div class="progress"><i style="width:' + f + '%"></i></div><span>' + f + '%</span></div>';
          }).join('') + '</div>' : '';
          daysCard = '<div class="card"><div class="card-h"><h2>Days</h2><span class="muted small">' + (c ? 'Finished' : pct ? 'About ' + pct + '% done' : 'Not started') + '</span></div><div class="card-b">' +
            '<div class="progress"><i style="width:' + pct + '%"></i></div><p class="muted small" style="margin:0 0 10px">' + mhs(logged) + ' man-hours done' + (booked ? ' · ' + mhs(booked) + ' booked for the days to go' : '') + ' · quoted ' + mhs(plan.estimate) + '</p>' + doneList + '<div class="days">' +
            days.map(function (x) {
              var l = x.day_log, dd = x.status === 'Unscheduled' ? 'not booked yet' : new Date(x.start.slice(0, 10) + 'T00:00:00').toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short' });
              return '<a class="dayrow' + (x.status === 'Completed' ? ' done' : '') + (x.id === j.id ? ' cur' : '') + '" href="#/jobs/' + esc(x.id) + '"><span class="dn">' + (x.status === 'Completed' ? icon('check') : x.part) + '</span><span class="grow"><b>Day ' + x.part + ' · ' + dd + '</b><small>' +
                (l ? 'Checked in · ' + mhs(l.workingMH) + ' man-h · about ' + l.progress + '% done' + (l.notes ? ' · ' + esc(l.notes) : '') : x.status === 'Completed' ? 'Closed out' : x.status === 'Unscheduled' ? 'Waiting in To schedule · ' + mhs(x.man_hours) + ' man-h · ' + x.men + ' men' : clockStr(x.start.slice(11, 16)) + '–' + clockStr(x.end.slice(11, 16)) + ' · ' + mhs(x.man_hours) + ' man-h booked · ' + x.men + ' men') + '</small></span></a>';
            }).join('') + '</div></div></div>';
        }
        ctx.el.innerHTML = '<div class="page"><div class="cols"><div class="stack">' +
          daysCard + '<div class="card"><div class="card-h"><h2>Estimate vs actual</h2>' + (c ? '<span class="muted small">' + App.date(c.work_date) + '</span>' : '') + '</div><div class="card-b">' + results + '</div></div>' +
          '<div class="card"><div class="card-h"><h2>Photos</h2><span class="muted small">' + d.photos.length + '</span></div><div class="card-b" id="photos">' + photosHtml(d.photos) + '</div></div>' +
          '</div><div class="stack">' +
          '<div class="card"><div class="card-h"><h2>Job</h2></div><div class="card-b stack"><div><h3>When</h3><div>' + App.date(j.start) + ' · ' + App.time(j.start) + '–' + App.time(j.end) + '</div></div><div><h3>Crew</h3><div>' + esc(j.crew) + ' · ' + (j.men || j.crew_size) + ' men</div></div>' +
            '<div><h3>Work</h3><div>' + esc((j.services || 'Hedge trimming').replace(/,/g, ', ')) + '</div><small class="muted">Estimated ' + hm(plan.estimate) + ' man-hours · ' + money(j.total) + ' incl. GST</small></div>' + (j.notes ? '<div><h3>Notes</h3><div style="white-space:pre-wrap">' + esc(j.notes) + '</div></div>' : '') + '</div></div>' +
          '<div class="card"><div class="card-h"><h2>Next trim</h2></div><div class="card-b">' + (d.trim && d.trim.active ? '<div><b>' + App.date(d.trim.due) + '</b> <span class="muted small">every ' + d.trim.interval_months + ' months · ' + esc(d.trim.status) + '</span></div><div class="row" style="margin-top:8px"><button class="btn sm" data-trim="move">Change date</button><button class="btn sm ghost" data-trim="skip" style="color:var(--danger)">No reminder</button></div>'
            : '<p class="muted small" style="margin:0">' + (done ? 'No reminder set.' : 'Set when you close out the job.') + '</p>') + '</div></div>' +
          '</div></div></div>' + (act.open || act.go ? '<button class="job-fab" id="close-out-fab">' + icon('check') + esc(act.fab || act.label) + '</button>' : '');
        ctx.el.querySelector('.page').classList.add('job-page');
        var fab = ctx.el.querySelector('#close-out-fab'); if (fab) fab.onclick = doAct;
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
