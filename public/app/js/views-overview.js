/* Seedsman Quote — Overview dashboard and Reports. */
(function () {
  'use strict';
  var icon = App.icon, esc = App.esc, money = App.money;

  function quoteRow(q, extra) {
    return '<a class="li" href="#/quotes/' + esc(q.id) + '"><span class="avatar">' + esc(App.initials(q.customer)) + '</span><span class="grow"><b>' + esc(q.customer) + ' <span class="muted" style="font-weight:500">· ' + esc(q.number) + '</span></b><small>' + esc(App.addr(q)) + '</small></span>' +
      '<span class="end"><b class="num">' + money(q.total) + '</b><small>' + (extra || App.pill(q.status)) + '</small></span></a>';
  }
  function jobRow(j) {
    return '<a class="li" href="#/schedule?date=' + esc(j.start.slice(0, 10)) + '"><span class="avatar" style="background:var(--info-soft);color:var(--info)">' + icon('calendar') + '</span><span class="grow"><b>' + esc(j.customer) + '</b><small>' + esc(App.addr(j)) + ' · ' + esc(j.crew) + '</small></span>' +
      '<span class="end"><b>' + App.dateShort(j.start) + '</b><small>' + App.time(j.start) + '–' + App.time(j.end) + '</small></span></a>';
  }
  function section(title, body, link) { return '<div class="card"><div class="card-h"><h2>' + title + '</h2>' + (link || '') + '</div><div class="list">' + body + '</div></div>'; }

  App.route('/', 'overview', function (ctx) {
    var h = new Date().getHours(), hello = h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
    App.me().then(function (me) {
      if (!ctx.el.isConnected) return;
      App.setTop({ el: ctx.el, title: hello + ', ' + me.user.name.split(' ')[0], sub: new Date().toLocaleDateString('en-AU', { weekday: 'long', day: 'numeric', month: 'long' }),
        actions: '<a class="btn" href="#/map">' + icon('layers') + '<span class="lbl">Map</span></a><a class="btn primary" href="#/quotes/new">' + icon('plus') + '<span class="lbl">New quote</span></a>' });
    });
    ctx.el.innerHTML = '<div class="page"><div class="empty">Loading…</div></div>';
    App.get('dashboard').then(function (d) {
      var k = d.kpis, rate = k.q90 ? k.a90 / k.q90 : null;
      var kpi = function (ic, l, v, sub) { return '<div class="card kpi"><div class="l">' + icon(ic) + l + '</div><div class="v">' + v + '</div><div class="d">' + sub + '</div></div>'; };
      ctx.el.innerHTML = '<div class="page">' +
        '<div class="kpis">' + kpi('quote', 'Open quotes', money(k.open_value, 0), k.open_count + ' draft or sent') + kpi('check', 'Won this month', money(k.won_month, 0), 'Accepted quotes, incl. GST') +
          kpi('chart', 'Win rate', App.pct(rate), k.a90 + ' of ' + k.q90 + ' quotes in 90 days') + kpi('calendar', 'Jobs this week', String(k.jobs_week), 'Scheduled in the next 7 days') + '</div>' +
        '<div class="cols"><div class="stack">' +
          section('Recent quotes', d.recent.length ? d.recent.map(function (q) { return quoteRow(q); }).join('') : '<div class="empty">' + icon('quote') + '<b>No quotes yet</b><a href="#/quotes/new">Start your first quote</a> — find the property, measure, price, send.</div>', '<a class="link" href="#/quotes">All quotes</a>') +
          (d.follow.length ? section('Needs a follow-up', d.follow.map(function (q) { return quoteRow(q, 'Sent ' + App.ago(q.updated_at)); }).join('')) : '') +
        '</div><div class="stack">' +
          section('Ready to schedule', d.toSchedule.length ? d.toSchedule.map(function (q) { return quoteRow(q, '<a class="link" href="#/schedule?quote=' + esc(q.id) + '">Schedule</a>'); }).join('') : '<div class="empty" style="padding:18px">Accepted quotes waiting for a date show here.</div>') +
          section('Upcoming jobs', d.jobs.length ? d.jobs.map(jobRow).join('') : '<div class="empty" style="padding:18px">Nothing booked yet.</div>', '<a class="link" href="#/schedule">Schedule</a>') +
        '</div></div></div>';
    }).catch(function (e) { App.toast(e.message, 'err'); });
  });

  // ======================= reports =======================
  function niceMax(v) { if (v <= 0) return 1000; var p = Math.pow(10, Math.floor(Math.log10(v))), n = v / p; return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * p; }
  function compact(v) { return v >= 1e6 ? '$' + (v / 1e6).toFixed(v % 1e6 ? 1 : 0) + 'M' : v >= 1e4 ? '$' + Math.round(v / 1000) + 'K' : '$' + Math.round(v).toLocaleString('en-AU'); }
  function colPath(x, y, w, h) { var r = Math.min(4, w / 2, h); if (h <= 0) return ''; return 'M' + x + ',' + (y + h) + 'V' + (y + r) + 'Q' + x + ',' + y + ' ' + (x + r) + ',' + y + 'H' + (x + w - r) + 'Q' + (x + w) + ',' + y + ' ' + (x + w) + ',' + (y + r) + 'V' + (y + h) + 'Z'; }

  function monthChart(box, months) {
    var W = Math.max(320, box.clientWidth), H = 240, padL = 52, padB = 26, padT = 10, iw = W - padL - 8, ih = H - padB - padT;
    var max = niceMax(Math.max.apply(null, months.map(function (m) { return m.quoted; }).concat([1])));
    var band = iw / months.length, bw = Math.min(16, (band - 10) / 2);
    var svg = '<svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Quoted and won value by month">';
    svg += '<g class="grid">' + [0, 0.25, 0.5, 0.75, 1].map(function (f) { var y = padT + ih - f * ih; return '<line x1="' + padL + '" x2="' + (W - 8) + '" y1="' + y + '" y2="' + y + '"/>'; }).join('') + '</g>';
    svg += '<g class="axis">' + [0, 0.5, 1].map(function (f) { var y = padT + ih - f * ih; return '<text x="' + (padL - 8) + '" y="' + (y + 4) + '" text-anchor="end">' + compact(max * f) + '</text>'; }).join('');
    var every = months.length > 12 ? 3 : months.length > 6 ? 2 : 1;
    months.forEach(function (m, i) { if (i % every) return; var d = new Date(m.month + '-01T00:00:00'); svg += '<text x="' + (padL + band * i + band / 2) + '" y="' + (H - 8) + '" text-anchor="middle">' + d.toLocaleDateString('en-AU', { month: 'short' }) + (d.getMonth() === 0 || i === 0 ? ' ' + String(d.getFullYear()).slice(2) : '') + '</text>'; });
    svg += '</g>';
    months.forEach(function (m, i) {
      var cx = padL + band * i + band / 2, ha = m.quoted / max * ih, hb = m.won / max * ih;
      svg += '<rect class="hit" data-i="' + i + '" x="' + (padL + band * i) + '" y="' + padT + '" width="' + band + '" height="' + ih + '"/>';
      svg += '<g data-g="' + i + '"><path class="bar-a" d="' + colPath(cx - bw - 1, padT + ih - ha, bw, ha) + '"/><path class="bar-b" d="' + colPath(cx + 1, padT + ih - hb, bw, hb) + '"/></g>';
    });
    svg += '</svg><div class="tip panel" hidden></div>';
    box.innerHTML = svg;
    var tip = box.querySelector('.tip');
    box.querySelectorAll('.hit').forEach(function (r) {
      r.addEventListener('pointerenter', function () {
        var m = months[+r.getAttribute('data-i')], d = new Date(m.month + '-01T00:00:00');
        box.querySelectorAll('[data-g]').forEach(function (g) { g.classList.toggle('hov', g.getAttribute('data-g') === r.getAttribute('data-i')); });
        tip.innerHTML = '<b>' + d.toLocaleDateString('en-AU', { month: 'long', year: 'numeric' }) + '</b><div><span><i style="display:inline-block;width:9px;height:9px;border-radius:2px;background:var(--chart-a);margin-right:5px"></i>Quoted</span><span class="num">' + money(m.quoted, 0) + ' (' + m.count + ')</span></div><div><span><i style="display:inline-block;width:9px;height:9px;border-radius:2px;background:var(--chart-b);margin-right:5px"></i>Won</span><span class="num">' + money(m.won, 0) + ' (' + m.wonCount + ')</span></div>';
        tip.hidden = false;
        var rb = r.getBoundingClientRect(), bb = box.getBoundingClientRect(), left = rb.left - bb.left + rb.width / 2 - tip.offsetWidth / 2;
        tip.style.left = Math.max(0, Math.min(bb.width - tip.offsetWidth, left)) + 'px'; tip.style.top = '0px';
      });
      r.addEventListener('pointerleave', function () { tip.hidden = true; box.querySelectorAll('[data-g]').forEach(function (g) { g.classList.remove('hov'); }); });
    });
  }

  App.route('/reports', 'reports', function (ctx) {
    var months = +(ctx.query.months || 12), data = null, showTable = false;
    App.setTop({ title: 'Reports', sub: 'Quoting performance', actions: '<div class="seg sm" id="range">' + [6, 12, 24].map(function (m) { return '<button type="button" data-m="' + m + '"' + (m === months ? ' class="on"' : '') + '>' + m + ' months</button>'; }).join('') + '</div>' });
    document.getElementById('range').onclick = function (e) { var b = e.target.closest('[data-m]'); if (!b) return; months = +b.getAttribute('data-m'); document.querySelectorAll('#range button').forEach(function (x) { x.classList.toggle('on', x === b); }); load(); };
    function onResize() { if (data && !showTable) monthChart(ctx.el.querySelector('#chart'), data.months); }
    window.addEventListener('resize', onResize); ctx.onLeave(function () { window.removeEventListener('resize', onResize); });
    function load() {
      ctx.el.innerHTML = '<div class="page"><div class="empty">Loading…</div></div>';
      App.get('reports?months=' + months).then(function (d) {
        data = d; var t = d.totals;
        var kpi = function (l, v, sub) { return '<div class="card kpi"><div class="l">' + l + '</div><div class="v">' + v + '</div><div class="d">' + sub + '</div></div>'; };
        var maxS = Math.max.apply(null, d.services.map(function (s) { return s.quoted; }).concat([1]));
        ctx.el.innerHTML = '<div class="page"><div class="kpis">' + kpi('Quoted', money(t.quoted, 0), t.count + ' quotes') + kpi('Won', money(t.won, 0), t.wonCount + ' accepted') +
          kpi('Win rate', App.pct(t.winRate), 'Of quotes accepted or declined') + kpi('Gross margin on won work', App.pct(t.wonMargin), 'Average quote ' + money(t.average, 0)) + '</div>' +
          '<div class="card"><div class="card-h"><h2>Quoted and won by month</h2><button class="btn sm" id="tbl-toggle">' + (showTable ? 'Chart' : 'Table') + '</button></div><div class="card-b">' +
            '<div class="legend"><span><i style="background:var(--chart-a)"></i>Quoted</span><span><i style="background:var(--chart-b)"></i>Won</span></div><div class="chart" id="chart"></div></div></div>' +
          '<div class="cols even"><div class="card"><div class="card-h"><h2>By service</h2></div><div class="card-b">' +
            (d.services.length ? d.services.map(function (s) { return '<div class="hbar"><span><b>' + esc(s.name) + '</b><br><small class="muted">' + s.count + ' items · ' + esc(App.qty(s.qty, s.unit)) + '</small></span><span class="track"><span class="fill" style="display:block;width:' + Math.max(1, s.quoted / maxS * 100) + '%"></span></span><span class="num"><b>' + money(s.quoted, 0) + '</b><br><small class="muted">won ' + money(s.won, 0) + '</small></span></div>'; }).join('') : '<div class="empty">No quotes in this period.</div>') +
          '</div></div><div class="card"><div class="card-h"><h2>Top suburbs</h2></div><div class="tbl-wrap">' +
            (d.suburbs.length ? '<table class="tbl"><thead><tr><th>Suburb</th><th class="r">Quotes</th><th class="r">Value</th></tr></thead><tbody>' + d.suburbs.map(function (s) { return '<tr><td>' + esc(s.name) + '</td><td class="r">' + s.count + '</td><td class="r">' + money(s.value, 0) + '</td></tr>'; }).join('') + '</tbody></table>' : '<div class="empty">No quotes in this period.</div>') +
          '</div><div class="card-b"><h3 style="margin:12px 0 8px">Status</h3><div class="row">' + Object.keys(d.byStatus).map(function (s) { return App.pill(s) + ' <b class="num" style="margin-right:10px">' + d.byStatus[s] + '</b>'; }).join('') + '</div></div></div></div></div>';
        drawChart();
        ctx.el.querySelector('#tbl-toggle').onclick = function () { showTable = !showTable; this.textContent = showTable ? 'Chart' : 'Table'; drawChart(); };
      }).catch(function (e) { App.toast(e.message, 'err'); });
    }
    function drawChart() {
      var box = ctx.el.querySelector('#chart');
      if (showTable) box.innerHTML = '<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Month</th><th class="r">Quotes</th><th class="r">Quoted</th><th class="r">Won</th></tr></thead><tbody>' + data.months.map(function (m) { return '<tr><td>' + new Date(m.month + '-01T00:00:00').toLocaleDateString('en-AU', { month: 'long', year: 'numeric' }) + '</td><td class="r">' + m.count + '</td><td class="r">' + money(m.quoted, 0) + '</td><td class="r">' + money(m.won, 0) + '</td></tr>'; }).join('') + '</tbody></table></div>';
      else monthChart(box, data.months);
    }
    load();
  });
})();
