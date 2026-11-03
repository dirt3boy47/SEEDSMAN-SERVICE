/* Seedsman Quote — Pipeline (CRM): every enquiry as a card, dragged from "New enquiry" through to "Done".
   Drag with the mouse, or press and hold a card on a phone/iPad. Cards also move by themselves when the quote is
   accepted, the job is booked and the job is closed out (worker: syncLeads). */
(function () {
  'use strict';
  var icon = App.icon, esc = App.esc, money = App.money;
  var COLORS = { 'New enquiry': '#2f6fd0', Contacted: '#7048e8', 'Site visit': '#ae3ec9', Quoted: '#e8590c', Won: '#0f9d58', Scheduled: '#1098ad', Done: '#5c940d', Lost: '#868e96' };
  var HINT = { 'New enquiry': 'Just came in', Contacted: 'Spoken to them', 'Site visit': 'Going to look / measure', Quoted: 'Quote started or sent', Won: 'Quote accepted', Scheduled: 'On the calendar', Done: 'Job finished', Lost: 'Didn’t go ahead' };
  var SERVICES = ['Hedge trimming', 'Lawn mowing', 'Garden tidy', 'Tree & shrub pruning', 'Green waste removal', 'Other'];

  function today() { var d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
  function addDays(n) { var d = new Date(); d.setDate(d.getDate() + n); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
  function daysSince(ts) { if (!ts) return 0; var t = new Date(ts.replace(' ', 'T') + (ts.length <= 19 ? 'Z' : '')); return Math.max(0, Math.floor((Date.now() - t) / 86400000)); }
  function valueOf(l) { return l.quote_total != null ? +l.quote_total : l.value != null ? +l.value : 0; }
  function servicesOf(l) { return (l.quote_services || (l.services || []).join(',') || '').replace(/,/g, ', '); }
  function follow(l) {
    if (!l.next_at || l.status === 'Done' || l.status === 'Lost') return '';
    var t = today(), d = l.next_at, cls = d < t ? 'over' : d === t ? 'due' : '';
    var txt = d < t ? 'Follow up — ' + Math.round((new Date(t) - new Date(d)) / 86400000) + 'd late' : d === t ? 'Follow up today' : 'Follow up ' + new Date(d + 'T00:00:00').toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short' });
    return '<span class="pfu ' + cls + '">' + icon('clock') + esc(txt) + '</span>';
  }

  App.route('/pipeline', 'pipeline', function (ctx) {
    var el = ctx.el, S = { leads: [], stages: [], sources: [], lostReasons: [], stats: {}, q: '' }, drag = null;
    el.className = 'wide';

    function load() {
      return App.get('leads').then(function (d) {
        if (!el.isConnected) return;
        S.leads = d.leads; S.stages = d.stages; S.sources = d.sources; S.lostReasons = d.lostReasons; S.stats = d.stats;
        if (App.badge) App.badge('pipeline', d.leads.filter(function (l) { return l.status === 'New enquiry'; }).length);
        render();
        if (ctx.query.lead) { var l = byId(ctx.query.lead); ctx.query.lead = null; if (l) sheet(l); }
      }).catch(function (e) { App.toast(e.message, 'err'); });
    }
    function byId(id) { return S.leads.filter(function (l) { return l.id === id; })[0]; }
    function visible() { var f = S.q.toLowerCase(); return S.leads.filter(function (l) { return !f || (l.name + ' ' + l.suburb + ' ' + l.address + ' ' + (l.phone || '') + ' ' + (l.quote_number || '')).toLowerCase().indexOf(f) >= 0; }); }

    function top() {
      var open = S.leads.filter(function (l) { return ['New enquiry', 'Contacted', 'Site visit', 'Quoted'].indexOf(l.status) >= 0; });
      var openVal = open.reduce(function (a, l) { return a + valueOf(l); }, 0), st = S.stats || {}, dec = (st.won90 || 0) + (st.lost90 || 0);
      App.setTop({ el: el, title: 'Pipeline', sub: open.length + ' open · ' + money(openVal, 0) + ' in play' + (dec ? ' · ' + Math.round(st.won90 / dec * 100) + '% won (90 days)' : ''),
        actions: '<button class="btn primary" id="new-lead">' + icon('plus') + '<span class="lbl">Enquiry</span></button>' });
      document.getElementById('new-lead').onclick = function () { enquiryForm(); };
    }
    function card(l) {
      var v = valueOf(l), svc = servicesOf(l), age = daysSince(l.stage_at || l.created_at);
      return '<div class="pcard" data-id="' + esc(l.id) + '" style="--c:' + COLORS[l.status] + '">' +
        '<div class="pc-top"><b>' + esc(l.name) + '</b>' + (v ? '<span class="pc-val">' + money(v, 0) + '</span>' : '') + '</div>' +
        '<small>' + esc([l.suburb || l.address, svc].filter(Boolean).join(' · ') || 'No details yet') + '</small>' +
        '<div class="pc-meta">' + follow(l) +
          (l.quote_number ? '<span class="tag">' + esc(l.quote_number) + (l.quote_status && l.status === 'Quoted' ? ' · ' + esc(l.quote_status) : '') + '</span>' : '') +
          (l.status === 'Scheduled' && l.job_start ? '<span class="tag info">' + new Date(l.job_start.slice(0, 10) + 'T00:00:00').toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short' }) + '</span>' : '') +
          (l.status === 'Lost' && l.lost_reason ? '<span class="tag">' + esc(l.lost_reason) + '</span>' : '') +
          (+l.photo_count ? '<span class="pc-src">📷 ' + l.photo_count + '</span>' : '') +
          (l.contact && l.status === 'New enquiry' ? '<span class="pc-src">prefers ' + esc(l.contact.toLowerCase()) + '</span>' : '') +
          (l.source && l.source !== 'Phone' ? '<span class="pc-src">' + esc(l.source) + '</span>' : '') +
          '<span class="pc-age" title="Days in this stage">' + (age ? age + 'd' : 'new') + '</span></div></div>';
    }
    function render() {
      top();
      var list = visible();
      if (!el.querySelector('.pipe-wrap')) {
        el.innerHTML = '<div class="pipe-wrap"><div class="pipe-bar"><label class="search">' + icon('search') + '<input class="input" id="pq" type="search" placeholder="Find a name, suburb, phone or quote"></label>' +
          '<div class="pipe-jump" id="pjump"></div></div><div class="pipe" id="pipe"></div></div>';
        el.querySelector('#pq').addEventListener('input', function (e) { S.q = e.target.value; render(); });
        el.querySelector('#pjump').onclick = function (e) { var b = e.target.closest('[data-jump]'); if (!b) return; var col = el.querySelector('.pcol[data-stage="' + b.getAttribute('data-jump') + '"]'); if (col) col.scrollIntoView({ behavior: 'smooth', inline: 'start', block: 'nearest' }); };
      }
      el.querySelector('#pjump').innerHTML = S.stages.map(function (s) { var n = list.filter(function (l) { return l.status === s; }).length; return '<button type="button" data-jump="' + esc(s) + '" style="--c:' + COLORS[s] + '"><i></i>' + esc(s) + ' <b>' + n + '</b></button>'; }).join('');
      var pipe = el.querySelector('#pipe'), keepX = pipe.scrollLeft;
      pipe.innerHTML = S.stages.map(function (s) {
        var cards = list.filter(function (l) { return l.status === s; }), val = cards.reduce(function (a, l) { return a + valueOf(l); }, 0);
        return '<section class="pcol' + (s === 'Lost' ? ' lost' : '') + '" data-stage="' + esc(s) + '" style="--c:' + COLORS[s] + '"><header><div><i></i><b>' + esc(s) + '</b><span class="tag">' + cards.length + '</span></div><small>' + (val ? money(val, 0) + ' · ' : '') + esc(HINT[s]) + '</small></header>' +
          '<div class="plist">' + (cards.length ? cards.map(card).join('') : '<div class="pempty">' + (s === 'New enquiry' ? 'Tap <b>+ Enquiry</b> when someone calls' : 'Drag a card here') + '</div>') + '</div>' +
          (s === 'New enquiry' ? '<button class="padd" data-add>' + icon('plus') + 'Add enquiry</button>' : '') + '</section>';
      }).join('');
      pipe.scrollLeft = keepX;
    }

    // ---------------- drag and drop: mouse drags straight away, a finger presses and holds ----------------
    function onDown(e) {
      var c = e.target.closest('.pcard'); if (!c || (e.button != null && e.button !== 0)) return;
      drag = { el: c, id: c.getAttribute('data-id'), x0: e.clientX, y0: e.clientY, pid: e.pointerId, touch: e.pointerType !== 'mouse', live: false, timer: null };
      if (drag.touch) drag.timer = setTimeout(function () { if (drag && !drag.live) lift(drag.x0, drag.y0); }, 280);
    }
    function lift(x, y) {
      var r = drag.el.getBoundingClientRect();
      drag.live = true; drag.dx = x - r.left; drag.dy = y - r.top;
      drag.ghost = drag.el.cloneNode(true); drag.ghost.classList.add('pghost'); drag.ghost.style.width = r.width + 'px';
      document.body.appendChild(drag.ghost);
      drag.ph = document.createElement('div'); drag.ph.className = 'pph'; drag.ph.style.height = r.height + 'px';
      drag.el.parentNode.insertBefore(drag.ph, drag.el); drag.el.classList.add('plifted');
      document.body.classList.add('pdragging');
      if (navigator.vibrate) try { navigator.vibrate(12); } catch (x) { /* ignore */ }
      move(x, y);
    }
    function move(x, y) {
      drag.ghost.style.transform = 'translate(' + (x - drag.dx) + 'px,' + (y - drag.dy) + 'px) rotate(2deg)';
      var pipe = el.querySelector('#pipe'), pr = pipe.getBoundingClientRect();
      drag.scroll = x < pr.left + 50 ? -14 : x > pr.right - 50 ? 14 : 0;
      if (drag.scroll && !drag.raf) { var step = function () { if (!drag || !drag.scroll) { if (drag) drag.raf = null; return; } pipe.scrollLeft += drag.scroll; drag.raf = requestAnimationFrame(step); }; drag.raf = requestAnimationFrame(step); }
      drag.ghost.style.display = 'none'; var under = document.elementFromPoint(x, y); drag.ghost.style.display = '';
      var col = under && under.closest('.pcol'); if (!col) return;
      var lst = col.querySelector('.plist'), cards = Array.prototype.filter.call(lst.querySelectorAll('.pcard'), function (c) { return c !== drag.el; }), before = null;
      for (var i = 0; i < cards.length; i++) { var b = cards[i].getBoundingClientRect(); if (y < b.top + b.height / 2) { before = cards[i]; break; } }
      var emp = lst.querySelector('.pempty'); if (emp) emp.remove();
      if (before) lst.insertBefore(drag.ph, before); else lst.appendChild(drag.ph);
      var lr = lst.getBoundingClientRect(); if (y < lr.top + 40) lst.scrollTop -= 10; else if (y > lr.bottom - 40) lst.scrollTop += 10;
    }
    function onMove(e) {
      if (!drag || e.pointerId !== drag.pid) return;
      if (!drag.live) {
        var far = Math.hypot(e.clientX - drag.x0, e.clientY - drag.y0) > 8;
        if (drag.touch) { if (far) { clearTimeout(drag.timer); drag = null; } return; } // a finger moving straight away is scrolling
        if (far) lift(e.clientX, e.clientY); else return;
      }
      e.preventDefault(); move(e.clientX, e.clientY);
    }
    function onUp(e) {
      if (!drag || e.pointerId !== drag.pid) return;
      var d = drag; drag = null; clearTimeout(d.timer);
      if (!d.live) { if (e.type !== 'pointercancel') { var l = byId(d.id); if (l) sheet(l); } return; }
      d.ghost.remove(); document.body.classList.remove('pdragging'); d.el.classList.remove('plifted');
      var col = d.ph.closest('.pcol'), lead = byId(d.id);
      if (!col || e.type === 'pointercancel') { d.ph.remove(); render(); return; }
      var stage = col.getAttribute('data-stage'), prev = d.ph.previousElementSibling, next = d.ph.nextElementSibling;
      while (prev && !prev.classList.contains('pcard')) prev = prev.previousElementSibling;
      while (next && (!next.classList.contains('pcard') || next === d.el)) next = next.nextElementSibling;
      var ps = prev && prev !== d.el ? byId(prev.getAttribute('data-id')).sort : null, ns = next ? byId(next.getAttribute('data-id')).sort : null;
      var sort = ps != null && ns != null ? (ps + ns) / 2 : ps != null ? ps + 1 : ns != null ? ns - 1 : 0;
      d.ph.remove();
      moveTo(lead, stage, sort);
    }
    el.addEventListener('pointerdown', onDown);
    window.addEventListener('pointermove', onMove, { passive: false });
    window.addEventListener('pointerup', onUp); window.addEventListener('pointercancel', onUp);
    // while a card is held, the finger drags the card instead of scrolling the page
    function noScroll(e) { if (drag && (drag.live || drag.timer)) { if (drag.live) e.preventDefault(); } }
    document.addEventListener('touchmove', noScroll, { passive: false });
    ctx.onLeave(function () { window.removeEventListener('pointermove', onMove); window.removeEventListener('pointerup', onUp); window.removeEventListener('pointercancel', onUp); document.removeEventListener('touchmove', noScroll); document.body.classList.remove('pdragging'); });
    el.addEventListener('click', function (e) { if (e.target.closest('[data-add]')) enquiryForm(); });

    /** Moving a card: some stages need a step first (accept the quote, book the job, say why it was lost). */
    function moveTo(lead, stage, sort) {
      var same = stage === lead.status;
      var put = function (extra) {
        lead.status = stage; lead.sort = sort; lead.stage_at = same ? lead.stage_at : new Date().toISOString().slice(0, 19).replace('T', ' '); render();
        return App.put('leads/' + lead.id, Object.assign({ stage: stage, sort: sort }, extra || {})).then(function (r) { Object.assign(lead, r.lead); render(); })
          .catch(function (x) { App.toast(x.message, 'err'); load(); });
      };
      if (same) return put();
      if (stage === 'Lost') return lostSheet(lead, function (reason) { put({ lost_reason: reason }).then(function () { App.toast(lead.name + ' moved to Lost.'); }); }, render);
      if (stage === 'Quoted' && !lead.quote_id) {
        return App.confirm('Start a quote for ' + lead.name + '?', 'We’ll set up the customer and property from the enquiry and open a new quote. The card moves along by itself once the quote is saved.', 'Start the quote').then(function (ok) { if (ok) startQuote(lead); else render(); });
      }
      if (stage === 'Won' && lead.quote_id && lead.quote_status !== 'Accepted') {
        return App.confirm('Mark ' + lead.quote_number + ' as accepted?', lead.name + ' said yes — the quote is marked Accepted and goes to the schedule’s To schedule tray.', 'Mark accepted').then(function (ok) {
          if (!ok) return render();
          App.put('quotes/' + lead.quote_id + '/status', { status: 'Accepted' }).then(function () { lead.quote_status = 'Accepted'; return put(); }).catch(function (x) { App.toast(x.message, 'err'); render(); });
        });
      }
      if (stage === 'Scheduled' && !lead.job_id) {
        if (lead.quote_id && (lead.quote_status === 'Accepted' || lead.status === 'Won')) { App.toast('Drag it onto a day to book it — the card moves to Scheduled by itself.'); location.hash = '#/schedule?quote=' + lead.quote_id; return; }
        App.toast('Accept the quote first — then book it on the calendar.', 'warn'); render(); return;
      }
      put().then(function () { App.toast(lead.name + ' → ' + stage); });
    }
    function startQuote(lead) {
      App.post('leads/' + lead.id + '/convert', {}).then(function (r) { location.hash = '#/quotes/new?property=' + encodeURIComponent(r.property_id); })
        .catch(function (x) { App.toast(x.message, 'err', 6000); render(); sheet(lead); });
    }
    function lostSheet(lead, onPick, onCancel) {
      var m = App.modal('<h2>Why didn’t ' + esc(lead.name) + ' go ahead?</h2><p class="sub">This shows up in your reports so you can see what loses work.</p><div class="lost-opts">' +
        S.lostReasons.map(function (r) { return '<button class="btn" data-r="' + esc(r) + '">' + esc(r) + '</button>'; }).join('') + '</div><div class="actions"><button class="btn" data-close>Cancel</button></div>', { onClose: function () { if (!picked) onCancel(); } });
      var picked = false;
      m.el.querySelector('.lost-opts').onclick = function (e) { var b = e.target.closest('[data-r]'); if (!b) return; picked = true; m.close(); onPick(b.getAttribute('data-r')); };
    }

    // ---------------- new enquiry ----------------
    function enquiryForm() {
      var chosen = [], src = 'Phone', when = addDays(1), pin = {};
      var m = App.modal('<h2>New enquiry</h2><p class="sub">Who called and what they want. You can quote it straight from the card.</p>' +
        '<div class="grid2"><label class="field span2">Name<input id="e-name" autocomplete="name" placeholder="e.g. Jenny Smith"></label>' +
        '<label class="field">Phone<input id="e-phone" type="tel" inputmode="tel" autocomplete="tel"></label><label class="field">Email<input id="e-email" type="email" autocomplete="email"></label>' +
        '<label class="field span2">Address<input id="e-addr" placeholder="Start typing the street"></label><label class="field span2">Suburb<input id="e-sub"></label></div>' +
        '<div class="field" style="margin-top:10px">What do they want?</div><div class="chips" id="e-svc">' + SERVICES.map(function (s) { return '<button type="button" class="chipb" data-s="' + esc(s) + '">' + esc(s) + '</button>'; }).join('') + '</div>' +
        '<label class="field" style="margin-top:10px">Notes<textarea id="e-msg" placeholder="e.g. Tall cypress along the front, wants it done before Christmas"></textarea></label>' +
        '<div class="field" style="margin-top:10px">How did they find you?</div><div class="chips" id="e-src">' + S.sources.map(function (s) { return '<button type="button" class="chipb' + (s === src ? ' on' : '') + '" data-v="' + esc(s) + '">' + esc(s) + '</button>'; }).join('') + '</div>' +
        '<div class="field" style="margin-top:10px">Follow up</div><div class="chips" id="e-when">' + [[today(), 'Today'], [addDays(1), 'Tomorrow'], [addDays(3), 'In 3 days'], [addDays(7), 'Next week'], ['', 'No reminder']].map(function (w) { return '<button type="button" class="chipb' + (w[0] === when ? ' on' : '') + '" data-w="' + w[0] + '">' + w[1] + '</button>'; }).join('') + '</div>' +
        '<div class="actions"><button class="btn" data-close>Cancel</button><button class="btn primary" id="e-ok">' + icon('check') + 'Add to pipeline</button></div>', { noFocus: false });
      var $ = function (id) { return m.el.querySelector('#' + id); };
      if (window.GIS && GIS.addressInput) GIS.addressInput($('e-addr'), { onPick: function (p) { $('e-addr').value = p.address; $('e-sub').value = p.suburb || ''; pin = { lat: p.lat, lng: p.lng }; } });
      $('e-svc').onclick = function (e) { var b = e.target.closest('[data-s]'); if (!b) return; b.classList.toggle('on'); var s = b.getAttribute('data-s'), i = chosen.indexOf(s); if (i >= 0) chosen.splice(i, 1); else chosen.push(s); };
      $('e-src').onclick = function (e) { var b = e.target.closest('[data-v]'); if (!b) return; src = b.getAttribute('data-v'); $('e-src').querySelectorAll('button').forEach(function (x) { x.classList.toggle('on', x === b); }); };
      $('e-when').onclick = function (e) { var b = e.target.closest('[data-w]'); if (!b) return; when = b.getAttribute('data-w'); $('e-when').querySelectorAll('button').forEach(function (x) { x.classList.toggle('on', x === b); }); };
      $('e-ok').onclick = function () {
        var btn = $('e-ok'); btn.disabled = true;
        App.post('leads', { name: $('e-name').value, phone: $('e-phone').value, email: $('e-email').value, address: $('e-addr').value, suburb: $('e-sub').value, services: chosen, message: $('e-msg').value, source: src, next_at: when || null, next_note: when ? 'Call back' : '', lat: pin.lat, lng: pin.lng })
          .then(function (r) { m.close(); S.leads.unshift(r.lead); render(); App.toast(r.lead.name + ' added to New enquiry.'); var c = el.querySelector('.pcard[data-id="' + r.lead.id + '"]'); if (c) { c.classList.add('pnew'); c.scrollIntoView({ block: 'nearest', inline: 'nearest' }); } })
          .catch(function (x) { btn.disabled = false; App.toast(x.message, 'err'); });
      };
    }

    // ---------------- the card's sheet: contact, next step, move, follow-up, details, history ----------------
    function sheet(l0) {
      App.get('leads/' + l0.id).then(function (d) {
        var l = d.lead, idx = S.leads.indexOf(l0); if (idx >= 0) S.leads[idx] = Object.assign(l0, l);
        var tel = (l.phone || '').replace(/[^\d+]/g, ''), mapq = encodeURIComponent([l.address, l.suburb].filter(Boolean).join(', '));
        var next = l.status === 'Lost' ? ['revive', 'Bring it back', 'refresh'] : l.job_id ? ['job', 'Open the job', 'calendar'] : l.status === 'Won' && l.quote_id ? ['book', 'Book it on the calendar', 'calendar'] : l.quote_id ? ['quote', 'Open quote ' + l.quote_number, 'quote'] : ['start', 'Start a quote', 'quote'];
        var m = App.modal('<div class="ls-head"><span class="ls-dot" style="background:' + COLORS[l.status] + '"></span><div class="grow"><h2>' + esc(l.name) + '</h2><p class="sub">' + esc(l.status) + ' · ' + esc(l.source) + ' · added ' + App.ago(l.created_at.replace(' ', 'T') + 'Z') + (valueOf(l) ? ' · <b>' + money(valueOf(l), 0) + '</b>' : '') + '</p></div></div>' +
          '<div class="ls-contact">' + (tel ? '<a class="btn" href="tel:' + esc(tel) + '" data-log="call">' + icon('phone') + 'Call</a><a class="btn" href="sms:' + esc(tel) + '" data-log="sms">' + icon('mail') + 'Text</a>' : '') +
            (l.email ? '<a class="btn" href="mailto:' + esc(l.email) + '" data-log="email">' + icon('mail') + 'Email</a>' : '') + (mapq ? '<a class="btn" target="_blank" rel="noopener" href="https://www.google.com/maps/dir/?api=1&destination=' + mapq + '">' + icon('gps') + 'Directions</a>' : '') + '</div>' +
          (l.contact || l.when ? '<p class="ls-pref">Prefers ' + esc([l.contact ? l.contact.toLowerCase() : '', l.when ? l.when.toLowerCase() : ''].filter(Boolean).join(' · ')) + '</p>' : '') +
          (l.message && l.source === 'Website' ? '<blockquote class="ls-msg">' + esc(l.message) + '</blockquote>' : '') +
          ((d.photos || []).length ? '<div class="ls-photos">' + d.photos.map(function (p) { return '<a href="' + esc(p.url) + '" target="_blank" rel="noopener" style="background-image:url(\'' + esc(p.url) + '\')" aria-label="Photo from the customer"></a>'; }).join('') + '</div>' : '') +
          '<button class="btn primary block ls-next" data-next="' + next[0] + '">' + icon(next[2] === 'refresh' ? 'chev' : next[2]) + esc(next[1]) + '</button>' +
          '<div class="field" style="margin-top:14px">Move to</div><div class="ls-stages">' + S.stages.map(function (s) { return '<button type="button" class="' + (s === l.status ? 'on' : '') + '" data-st="' + esc(s) + '" style="--c:' + COLORS[s] + '"><i></i>' + esc(s) + '</button>'; }).join('') + '</div>' +
          '<div class="field" style="margin-top:14px">Follow up</div><div class="ls-follow"><input type="date" id="l-next" class="input" value="' + esc(l.next_at || '') + '"><input id="l-nnote" class="input" placeholder="What to do (e.g. Call back)" value="' + esc(l.next_note || '') + '"></div>' +
          '<div class="chips" id="l-when">' + [[addDays(1), 'Tomorrow'], [addDays(3), 'In 3 days'], [addDays(7), 'Next week'], ['', 'Clear']].map(function (w) { return '<button type="button" class="chipb" data-w="' + w[0] + '">' + w[1] + '</button>'; }).join('') + '</div>' +
          '<details class="ls-details"' + (l.address ? '' : ' open') + '><summary>Details</summary><div class="grid2">' +
            '<label class="field span2">Name<input id="l-name" value="' + esc(l.name) + '"></label><label class="field">Phone<input id="l-phone" type="tel" value="' + esc(l.phone || '') + '"></label><label class="field">Email<input id="l-email" type="email" value="' + esc(l.email || '') + '"></label>' +
            '<label class="field span2">Address<input id="l-addr" value="' + esc(l.address || '') + '"></label><label class="field">Suburb<input id="l-sub" value="' + esc(l.suburb || '') + '"></label>' +
            '<label class="field">Source<select id="l-src">' + S.sources.map(function (s) { return '<option' + (s === l.source ? ' selected' : '') + '>' + esc(s) + '</option>'; }).join('') + '</select></label>' +
            (l.quote_id ? '' : '<label class="field">Rough value ($)<input id="l-val" type="number" inputmode="decimal" value="' + (l.value != null ? l.value : '') + '"></label><span></span>') +
            '<label class="field span2">What they want<textarea id="l-msg">' + esc(l.message || '') + '</textarea></label></div>' +
            ((l.services || []).length ? '<p class="muted small">Asked about: ' + esc(l.services.join(', ')) + '</p>' : '') + '</details>' +
          '<div class="field" style="margin-top:14px">History</div><div class="ls-note"><input id="l-note" class="input" placeholder="Add a note…"><button class="btn" id="l-add">Add</button></div>' +
          '<div class="ls-events">' + d.events.map(function (v) { return '<div class="ls-ev k-' + esc(v.kind) + '"><span>' + esc(v.text) + '</span><small>' + App.ago(v.created_at.replace(' ', 'T') + 'Z') + (v.by_name ? ' · ' + esc(v.by_name) : '') + '</small></div>'; }).join('') + '</div>' +
          (d.other.length ? '<div class="field" style="margin-top:14px">Other jobs for this customer</div><div class="list">' + d.other.map(function (o) { return '<a class="li" href="#/pipeline?lead=' + esc(o.id) + '"><span class="grow"><b>' + esc(o.quote_number || 'Enquiry') + '</b><small>' + esc(o.status) + ' · ' + App.dateShort(o.created_at) + '</small></span>' + (o.quote_total ? '<b class="num">' + money(o.quote_total, 0) + '</b>' : '') + '</a>'; }).join('') + '</div>' : '') +
          '<div class="actions"><button class="btn ghost" id="l-del" style="color:var(--danger)">' + icon('trash') + 'Remove</button>' + (l.customer_id ? '<a class="btn" href="#/customers/' + esc(l.customer_id) + '">' + icon('users') + 'Customer</a>' : '') + '<span class="spacer"></span><button class="btn" data-close>Close</button><button class="btn primary" id="l-save">Save</button></div>',
          { noFocus: true, onClose: function () { render(); } });
        var $ = function (id) { return m.el.querySelector('#' + id); }, pin = {};
        if (window.GIS && GIS.addressInput) GIS.addressInput($('l-addr'), { onPick: function (p) { $('l-addr').value = p.address; $('l-sub').value = p.suburb || ''; pin = { lat: p.lat, lng: p.lng }; } });
        m.el.addEventListener('click', function (e) {
          var a = e.target.closest('[data-log]'); if (a) { App.post('leads/' + l.id + '/events', { kind: a.getAttribute('data-log') }).then(function () { if (l.status === 'New enquiry') { l0.status = 'Contacted'; render(); } }).catch(function () {}); return; }
          var st = e.target.closest('[data-st]'); if (st) { m.close(); moveTo(l0, st.getAttribute('data-st'), l0.sort); return; }
          var w = e.target.closest('[data-w]'); if (w) { $('l-next').value = w.getAttribute('data-w'); if (!w.getAttribute('data-w')) $('l-nnote').value = ''; else if (!$('l-nnote').value) $('l-nnote').value = 'Call back'; return; }
          var nx = e.target.closest('[data-next]'); if (!nx) return;
          var k = nx.getAttribute('data-next'); m.close();
          if (k === 'start') startQuote(l0); else if (k === 'quote') location.hash = '#/quotes/' + l.quote_id; else if (k === 'book') location.hash = '#/schedule?quote=' + l.quote_id; else if (k === 'job') location.hash = '#/jobs/' + l.job_id;
          else if (k === 'revive') moveTo(l0, 'Contacted', l0.sort);
        });
        $('l-add').onclick = function () {
          var t = $('l-note').value.trim(); if (!t) return;
          App.post('leads/' + l.id + '/events', { kind: 'note', text: t }).then(function () { $('l-note').value = ''; m.el.querySelector('.ls-events').insertAdjacentHTML('afterbegin', '<div class="ls-ev k-note"><span>' + esc(t) + '</span><small>just now</small></div>'); }).catch(function (x) { App.toast(x.message, 'err'); });
        };
        $('l-note').addEventListener('keydown', function (e) { if (e.key === 'Enter') $('l-add').click(); });
        $('l-del').onclick = function () {
          App.confirm('Remove ' + l.name + ' from the pipeline?', 'The card is taken off the board. Quotes, customers and jobs stay as they are.', 'Remove', true).then(function (ok) {
            if (!ok) return; App.del('leads/' + l.id).then(function () { S.leads = S.leads.filter(function (x) { return x.id !== l.id; }); m.close(); render(); App.toast('Removed.'); });
          });
        };
        $('l-save').onclick = function () {
          var b = { name: $('l-name').value, phone: $('l-phone').value, email: $('l-email').value, address: $('l-addr').value, suburb: $('l-sub').value, source: $('l-src').value, message: $('l-msg').value, next_at: $('l-next').value || null, next_note: $('l-nnote').value };
          if ($('l-val')) b.value = $('l-val').value === '' ? null : $('l-val').value;
          if (pin.lat != null) { b.lat = pin.lat; b.lng = pin.lng; }
          App.put('leads/' + l.id, b).then(function (r) { Object.assign(l0, r.lead); m.close(); render(); App.toast('Saved.'); }).catch(function (x) { App.toast(x.message, 'err'); });
        };
      }).catch(function (e) { App.toast(e.message, 'err'); });
    }

    load();
  });
})();
