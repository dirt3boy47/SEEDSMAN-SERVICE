/* Seedsman Quote — Schedule: a week of jobs, booked from accepted quotes. */
(function () {
  'use strict';
  var icon = App.icon, esc = App.esc, money = App.money;
  var STATUSES = ['Scheduled', 'In progress', 'Completed', 'Cancelled'];
  function iso(d) { return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
  function monday(d) { var x = new Date(d.getFullYear(), d.getMonth(), d.getDate()); x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); return x; }
  function hoursOf(j) { return (new Date(j.end + ':00Z') - new Date(j.start + ':00Z')) / 3600000; }

  App.route('/schedule', 'schedule', function (ctx) {
    var start = monday(ctx.query.date ? new Date(ctx.query.date + 'T00:00:00') : new Date()), jobs = [];
    function top() {
      var end = new Date(start); end.setDate(end.getDate() + 6);
      App.setTop({ title: 'Schedule', sub: start.toLocaleDateString('en-AU', { day: 'numeric', month: 'short' }) + ' – ' + end.toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' }),
        actions: '<button class="ib" id="prev" title="Previous week">' + icon('back') + '</button><button class="btn sm" id="today">Today</button><button class="ib" id="next" title="Next week">' + icon('chev') + '</button><button class="btn primary" id="book">' + icon('plus') + '<span class="lbl">Schedule job</span></button>' });
      document.getElementById('prev').onclick = function () { start.setDate(start.getDate() - 7); load(); };
      document.getElementById('next').onclick = function () { start.setDate(start.getDate() + 7); load(); };
      document.getElementById('today').onclick = function () { start = monday(new Date()); load(); };
      document.getElementById('book').onclick = function () { book(null); };
    }
    function load() {
      if (!ctx.el.isConnected) return;
      top();
      var end = new Date(start); end.setDate(end.getDate() + 7);
      App.get('jobs?from=' + iso(start) + 'T00:00&to=' + iso(end) + 'T00:00').then(function (d) { jobs = d.jobs; render(); }).catch(function (e) { App.toast(e.message, 'err'); });
    }
    function render() {
      var days = [], today = iso(new Date());
      for (var i = 0; i < 7; i++) { var d = new Date(start); d.setDate(d.getDate() + i); days.push(d); }
      var total = jobs.reduce(function (s, j) { return s + (+j.total || 0); }, 0);
      ctx.el.innerHTML = '<div class="page"><div class="muted small">' + jobs.length + ' job' + (jobs.length === 1 ? '' : 's') + ' this week · ' + money(total, 0) + ' of work incl. GST</div><div class="week">' + days.map(function (d) {
        var key = iso(d), list = jobs.filter(function (j) { return j.start.slice(0, 10) === key; });
        return '<div class="card day' + (key === today ? ' today' : '') + '"><div class="day-h"><span>' + d.toLocaleDateString('en-AU', { weekday: 'short' }) + '</span><b>' + d.getDate() + '</b></div>' +
          list.map(function (j) { return '<button class="job s-' + j.status.toLowerCase().replace(/\s+/g, '-') + '" data-j="' + esc(j.id) + '"><b>' + App.time(j.start) + ' · ' + esc(j.customer) + '</b><small>' + esc(j.suburb || j.address) + '</small><small>' + esc(j.crew) + ' · ' + hoursOf(j) + ' h</small></button>'; }).join('') +
          (list.length ? '' : '<div class="muted small" style="padding:4px">—</div>') + '</div>';
      }).join('') + '</div></div>';
    }
    ctx.el.addEventListener('click', function (e) { var b = e.target.closest('[data-j]'); if (b) edit(jobs.filter(function (j) { return j.id === b.getAttribute('data-j'); })[0]); });

    function book(quoteId) {
      App.get('dashboard').then(function (d) {
        var open = d.toSchedule;
        var pre = quoteId ? App.get('quotes/' + encodeURIComponent(quoteId)) : Promise.resolve(null);
        return pre.then(function (qd) {
          var opts = open.map(function (q) { return { id: q.id, label: q.number + ' · ' + q.customer + ' · ' + App.addr(q), hours: null }; });
          if (qd && !opts.some(function (o) { return o.id === qd.quote.id; })) opts.unshift({ id: qd.quote.id, label: qd.quote.number + ' · ' + qd.customer.name + ' · ' + App.addr(qd.property), hours: qd.quote.calculation.siteHours });
          if (!opts.length) { App.toast('No accepted quotes waiting. Mark a quote Accepted first.', 'warn', 5000); return; }
          var hrs = qd ? qd.quote.calculation.siteHours || 3 : 3;
          var m = App.modal('<h2>Schedule a job</h2><p class="sub">Book an accepted quote with a crew.</p><div class="grid2">' +
            '<label class="field span2">Quote<select id="j-q">' + opts.map(function (o) { return '<option value="' + esc(o.id) + '"' + (qd && o.id === qd.quote.id ? ' selected' : '') + '>' + esc(o.label) + '</option>'; }).join('') + '</select></label>' +
            '<label class="field">Date<input id="j-date" type="date" value="' + iso(new Date(Math.max(Date.now(), start.getTime()))) + '"></label><label class="field">Start<input id="j-time" type="time" value="08:00"></label>' +
            '<label class="field">Hours on site<input id="j-hours" type="number" min="0.25" step="0.25" value="' + hrs + '"></label><label class="field">Crew<input id="j-crew" value="Crew 1"></label>' +
            '<label class="field span2">Notes for the crew<textarea id="j-notes"></textarea></label></div><div class="actions"><button class="btn" data-close>Cancel</button><button class="btn primary" id="ok">Book job</button></div>');
          m.el.querySelector('#ok').onclick = function () {
            App.post('jobs', { quote_id: m.el.querySelector('#j-q').value, start: m.el.querySelector('#j-date').value + 'T' + m.el.querySelector('#j-time').value, hours: m.el.querySelector('#j-hours').value, crew: m.el.querySelector('#j-crew').value, notes: m.el.querySelector('#j-notes').value })
              .then(function (r) { m.close(); App.toast('Job booked for ' + App.date(r.job.start) + '.'); start = monday(new Date(r.job.start.slice(0, 10) + 'T00:00:00')); load(); }).catch(function (x) { App.toast(x.message, 'err', 5000); });
          };
        });
      }).catch(function (e) { App.toast(e.message, 'err'); });
    }
    function edit(j) {
      var m = App.modal('<h2>' + esc(j.customer) + '</h2><p class="sub">' + esc(App.addr(j)) + ' · <a href="#/quotes/' + esc(j.quote_id) + '">' + esc(j.quote_number) + '</a> · ' + money(j.total) + '</p><div class="grid2">' +
        '<label class="field">Date<input id="j-date" type="date" value="' + j.start.slice(0, 10) + '"></label><label class="field">Start<input id="j-time" type="time" value="' + j.start.slice(11, 16) + '"></label>' +
        '<label class="field">Hours on site<input id="j-hours" type="number" min="0.25" step="0.25" value="' + hoursOf(j) + '"></label><label class="field">Crew<input id="j-crew" value="' + esc(j.crew) + '"></label>' +
        '<label class="field">Status<select id="j-status">' + STATUSES.map(function (s) { return '<option' + (s === j.status ? ' selected' : '') + '>' + s + '</option>'; }).join('') + '</select></label>' +
        '<label class="field">Actual hours<input id="j-actual" type="number" min="0" step="0.25" value="' + (j.actual_hours || '') + '"></label>' +
        '<label class="field span2">Notes<textarea id="j-notes">' + esc(j.notes) + '</textarea></label></div>' +
        '<div class="actions"><a class="btn" href="https://www.google.com/maps/dir/?api=1&destination=' + (j.lat != null ? j.lat + ',' + j.lng : encodeURIComponent(App.addr(j))) + '" target="_blank" rel="noopener">' + icon('gps') + 'Directions</a><span class="spacer"></span><button class="btn" data-close>Close</button><button class="btn primary" id="ok">Save</button></div>', { noFocus: true });
      m.el.querySelector('#ok').onclick = function () {
        App.put('jobs/' + j.id, { start: m.el.querySelector('#j-date').value + 'T' + m.el.querySelector('#j-time').value, hours: m.el.querySelector('#j-hours').value, crew: m.el.querySelector('#j-crew').value, status: m.el.querySelector('#j-status').value, actual_hours: m.el.querySelector('#j-actual').value, notes: m.el.querySelector('#j-notes').value })
          .then(function () { m.close(); App.toast('Job saved.'); load(); }).catch(function (x) { App.toast(x.message, 'err', 5000); });
      };
    }
    load();
    if (ctx.query.quote) book(ctx.query.quote);
  });
})();
