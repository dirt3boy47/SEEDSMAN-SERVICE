/* Seedsman Quote — Services & pricing (the rate card) and Settings. */
(function () {
  'use strict';
  var P = window.SeedsmanPricing, icon = App.icon, esc = App.esc, money = App.money;
  var CATS = ['Hedges', 'Lawns', 'Gardens', 'Trees', 'Other'];

  // ======================= services & pricing =======================
  App.route('/services', 'services', function (ctx) {
    var R, history = [], open = {};
    function top() {
      if (!ctx.el.isConnected) return;
      App.setTop({ el: ctx.el, title: 'Services & pricing', sub: R ? 'Rate card ' + R.version + (R.approval === 'sample' ? ' (sample)' : '') + ' · all prices excl. GST' : '',
        actions: '<button class="btn" id="sugg">Suggested rates</button><button class="btn primary" id="save">' + icon('save') + '<span class="lbl">Save rate card</span></button>' });
      document.getElementById('save').onclick = save;
      document.getElementById('sugg').onclick = function () { App.confirm('Fill in the suggested rates?', 'Every field is replaced with the starting figures. Nothing is saved until you tap Save rate card.', 'Fill in').then(function (ok) { if (!ok) return; var v = R.version, a = R.approval; R = P.normalise(P.DEFAULTS); R.version = v; R.approval = a; render(); }); };
    }
    function n(path, step, extra) { var v = path.split('.').reduce(function (o, k) { return o == null ? o : o[k]; }, R); return '<input type="number" step="' + (step || 'any') + '" min="0" data-r="' + path + '" value="' + (v == null ? '' : v) + '"' + (extra || '') + '>'; }
    function pctIn(path) { var v = path.split('.').reduce(function (o, k) { return o[k]; }, R); return '<input type="number" step="1" min="0" data-r="' + path + '" data-pct="1" value="' + Math.round(v * 1000) / 10 + '">'; }
    function render() {
      top();
      var gm = R.markup / (1 + R.markup);
      ctx.el.innerHTML = '<div class="page">' +
        '<div class="card"><div class="card-h"><h2>Labour, markup and job costs</h2><span class="muted small">Markup ' + Math.round(R.markup * 100) + '% on cost = ' + Math.round(gm * 100) + '% gross margin · labour sells at ' + money(R.labourCost * (1 + R.markup)) + '/h</span></div><div class="card-b grid4">' +
          '<label class="field">Labour cost ($ / man-hour)' + n('labourCost', 0.5) + '</label><label class="field">Markup on cost (%)' + pctIn('markup') + '</label>' +
          '<label class="field">Crew size' + n('crew', 1) + '</label><label class="field">Setup per job (crew hours)' + n('setupHours', 0.25) + '</label>' +
          '<label class="field">Equipment per job ($)' + n('equipment', 1) + '</label><label class="field">Travel ($ / km)' + n('travelRate', 0.05) + '</label>' +
          '<label class="field">Contingency (%)' + pctIn('risk') + '</label><label class="field">Minimum (excl. GST)' + n('minimum', 5) + '</label>' +
          '<label class="field">GST (%)' + pctIn('gst') + '</label><label class="field">Green waste disposal ($ / m³)' + n('waste.rate', 1) + '</label><label class="field">Loading (min / m³)' + n('waste.loadMinutesPerM3', 1) + '</label></div></div>' +
        '<div class="card"><div class="card-h"><h2>Services</h2><button class="btn sm" id="svc-add">' + icon('plus') + 'Add service</button></div><div class="card-b">' + R.services.map(serviceCard).join('') + '</div></div>' +
        '<div class="cols even"><div class="card"><div class="card-h"><h2>Hedge height tiers</h2><button class="btn sm" id="tier-add">' + icon('plus') + 'Tier</button></div><div class="tbl-wrap"><table class="tbl edit"><thead><tr><th>Name</th><th>Up to (m)</th><th>m² / man-hour</th><th>Cherry picker</th><th></th></tr></thead><tbody>' +
          R.tiers.map(function (t, i) { var lo = i ? R.tiers[i - 1].upTo : 0; return '<tr><td><input data-t="' + i + '.label" value="' + esc(t.label) + '"></td><td><input type="number" step="0.1" data-t="' + i + '.upTo" value="' + t.upTo + '"></td><td><input type="number" step="1" data-t="' + i + '.productivity" value="' + t.productivity + '"></td><td class="muted small">' + (lo >= R.picker.fromHeight ? 'Yes' : t.upTo > R.picker.fromHeight ? 'Above ' + R.picker.fromHeight + ' m' : '—') + '</td><td>' + (R.tiers.length > 1 ? '<button class="ib sm" data-del-tier="' + i + '">' + icon('trash') + '</button>' : '') + '</td></tr>'; }).join('') +
          '</tbody></table></div><div class="card-b grid2" style="margin-top:10px"><label class="field">Tops are slower by (×)' + n('topFactor', 0.05) + '</label><label class="field">Loose waste per m³ cut off' + n('looseFactor', 0.05) + '</label><p class="muted small full" style="margin:0">Green waste = face m² × cut-back depth × this factor (hedge foliage is mostly air; clippings settle in the trailer).</p></div></div>' +
        '<div class="stack"><div class="card"><div class="card-h"><h2>Cherry picker</h2></div><div class="card-b grid2"><label class="field">Needed above (m)' + n('picker.fromHeight', 0.1) + '</label><label class="field">Half day covers (h on site)' + n('picker.halfDayHours', 0.5) + '</label><label class="field">Half-day hire ($)' + n('picker.halfDay', 5) + '</label><label class="field">Full-day hire ($)' + n('picker.fullDay', 5) + '</label><label class="field">Delivery ($)' + n('picker.delivery', 5) + '</label></div></div>' +
          '<div class="card"><div class="card-h"><h2>Hedge condition</h2><button class="btn sm" id="cond-add">' + icon('plus') + 'Condition</button></div><div class="tbl-wrap"><table class="tbl edit"><thead><tr><th>Condition</th><th>Time ×</th><th>Cut back (cm)</th><th></th></tr></thead><tbody>' +
            R.conditions.map(function (c, i) { return '<tr><td><input data-c="' + i + '.label" value="' + esc(c.label) + '"></td><td><input type="number" step="0.1" data-c="' + i + '.time" value="' + c.time + '"></td><td><input type="number" step="1" data-c="' + i + '.cutBack" data-cm="1" value="' + Math.round((c.cutBack || 0) * 100) + '"></td><td>' + (i ? '<button class="ib sm" data-del-cond="' + i + '">' + icon('trash') + '</button>' : '') + '</td></tr>'; }).join('') + '</tbody></table></div></div></div></div>' +
        '<div class="card"><div class="card-h"><h2>Try it</h2></div><div class="card-b" id="example"></div></div>' +
        '<div class="card"><div class="card-h"><h2>Rate card history</h2></div><div class="list">' + history.map(function (h) { return '<div class="li"><span class="grow"><b>' + esc(h.id) + '</b><small>Effective ' + App.date(h.effective_date) + ' · ' + esc(h.approval_status) + '</small></span>' + (h.active ? App.pill('In use') : '') + '</div>'; }).join('') + '</div></div></div>';
      example();
    }
    function serviceCard(s, i) {
      var c = App.cat(s.category), isOpen = open[i], m = s.method;
      var body = '<div class="grid4"><label class="field span2">Name<input data-s="' + i + '.name" value="' + esc(s.name) + '"></label><label class="field">Category<select data-s="' + i + '.category">' + CATS.map(function (x) { return '<option' + (x === s.category ? ' selected' : '') + '>' + x + '</option>'; }).join('') + '</select></label>' +
        '<label class="field">Priced by<select data-s="' + i + '.method"' + (m === 'hedge' ? ' disabled' : '') + '>' + Object.keys(P.METHODS).filter(function (k) { return k !== 'hedge' || m === 'hedge'; }).map(function (k) { return '<option value="' + k + '"' + (k === m ? ' selected' : '') + '>' + P.METHODS[k] + '</option>'; }).join('') + '</select></label>';
      if (m === 'hedge') body += '<p class="muted small full" style="margin:0">Hedges are priced by m² of face (Top, Front, Back, LHS, RHS) using the height tiers, conditions and cherry picker below.</p>';
      else {
        if (m === 'area' || m === 'length') body += '<label class="field">Productivity (' + (m === 'area' ? 'm²' : 'm') + ' / man-hour)<input type="number" step="any" data-s="' + i + '.productivity" value="' + (s.productivity || '') + '"></label>';
        if (m === 'unit') body += '<label class="field">Hours each<input type="number" step="0.05" data-s="' + i + '.hoursPerUnit" value="' + (s.hoursPerUnit || '') + '"></label>';
        body += '<label class="field">Materials ($ per ' + esc(s.unit) + ')<input type="number" step="0.05" data-s="' + i + '.materialPerUnit" value="' + (s.materialPerUnit || 0) + '"></label>' +
          '<label class="field">Equipment ($ per item)<input type="number" step="1" data-s="' + i + '.equipmentPerLine" value="' + (s.equipmentPerLine || 0) + '"></label>' +
          '<label class="field">Green waste (m³ per ' + esc(s.unit) + ')<input type="number" step="0.001" data-s="' + i + '.wastePerUnit" value="' + (s.wastePerUnit || 0) + '"></label>' +
          '<label class="field">Measure on map<select data-s="' + i + '.measure">' + [['area', 'Area'], ['line', 'Line'], ['point', 'Point'], ['none', 'No map']].map(function (o) { return '<option value="' + o[0] + '"' + (o[0] === s.measure ? ' selected' : '') + '>' + o[1] + '</option>'; }).join('') + '</select></label>';
      }
      body += '<label class="field full">Description on quotes<input data-s="' + i + '.description" value="' + esc(s.description || '') + '"></label>' +
        '<label class="check span2"><input type="checkbox" data-s="' + i + '.active"' + (s.active === false ? '' : ' checked') + '> Offer this service on new quotes</label>' + (m === 'hedge' ? '' : '<div class="span2" style="text-align:right"><button class="link danger" data-del-svc="' + i + '">Remove service</button></div>') + '</div>';
      var unitCost = m === 'hedge' ? '' : m === 'hours' ? money(R.labourCost * (1 + R.markup)) + ' / h' : m === 'unit' ? money(((s.hoursPerUnit || 0) * R.labourCost + (s.materialPerUnit || 0)) * (1 + R.markup)) + ' each' : s.productivity ? money((R.labourCost / s.productivity + (s.materialPerUnit || 0)) * (1 + R.markup)) + ' / ' + s.unit : '';
      return '<div class="svc' + (isOpen ? ' open' : '') + '" data-si="' + i + '"><div class="svc-h" data-toggle="' + i + '"><span class="svc-dot" style="background:' + c.color + '">' + icon(c.icon) + '</span><div class="grow"><b>' + esc(s.name) + (s.active === false ? ' <span class="tag">Hidden</span>' : '') + '</b><small>' + esc(P.METHODS[m]) + ' · ' + esc(s.category) + '</small></div><span class="amt">' + unitCost + '</span><span class="chev">' + icon('chev') + '</span></div><div class="svc-b">' + body + '</div></div>';
    }
    function setPath(o, path, v) { var k = path.split('.'), last = k.pop(); k.reduce(function (x, kk) { return x[kk]; }, o)[last] = v; }
    function example() {
      var items = [{ service: 'hedge', inputs: { length: 20, height: 1.8, depth: 0.8, condition: 'maintained', faces: { top: true, front: true, back: true } } }];
      var t = P.quoteCalc(R, items, { removeWaste: true }), t2 = P.quoteCalc(R, [{ service: 'hedge', inputs: { length: 20, height: 4, depth: 1, condition: 'maintained', faces: { top: true, front: true, back: true } } }], { removeWaste: true });
      var lawn = R.services.filter(function (s) { return s.method === 'area'; })[0], t3 = lawn ? P.quoteCalc(R, [{ service: lawn.id, inputs: { qty: 400 } }], { removeWaste: true }) : null;
      var row = function (label, x) { return '<div class="sum-row"><span>' + label + '<small>' + x.personHours + ' man-hours · cost ' + money(x.costs.total) + ' · margin ' + App.pct(x.margin) + (x.needsPicker ? ' · cherry picker' : '') + '</small></span><b>' + money(x.exGst) + ' <span class="muted small">+GST ' + money(x.total) + '</span></b></div>'; };
      ctx.el.querySelector('#example').innerHTML = row('20 m hedge, 1.8 m high, 0.8 m deep — front, back and top, waste removed', t) + row('The same hedge 4 m high and 1 m deep', t2) + (t3 ? row('400 m² of ' + esc(lawn.name.toLowerCase()), t3) : '');
    }
    ctx.el.addEventListener('input', onInput); ctx.el.addEventListener('change', onInput);
    function onInput(e) {
      var tg = e.target, v = tg.type === 'checkbox' ? tg.checked : tg.type === 'number' ? (parseFloat(tg.value) || 0) : tg.value;
      if (tg.hasAttribute('data-r')) setPath(R, tg.getAttribute('data-r'), tg.hasAttribute('data-pct') ? v / 100 : v);
      else if (tg.hasAttribute('data-t')) setPath(R.tiers, tg.getAttribute('data-t'), v);
      else if (tg.hasAttribute('data-c')) setPath(R.conditions, tg.getAttribute('data-c'), tg.hasAttribute('data-cm') ? v / 100 : v);
      else if (tg.hasAttribute('data-s')) {
        var p = tg.getAttribute('data-s'), i = +p.split('.')[0], k = p.split('.')[1];
        R.services[i][k] = v;
        if (k === 'method') { R.services[i].unit = { area: 'm²', length: 'm', unit: 'each', hours: 'h' }[v]; R.services[i].measure = { area: 'area', length: 'line', unit: 'point', hours: 'none' }[v]; }
        if (e.type === 'change' && (k === 'method' || k === 'category' || k === 'active')) { render(); return; }
      } else return;
      example();
    }
    ctx.el.addEventListener('click', function (e) {
      var tg = e.target, b;
      if ((b = tg.closest('[data-toggle]')) && !tg.closest('input,select')) { var i = +b.getAttribute('data-toggle'); open[i] = !open[i]; b.closest('.svc').classList.toggle('open', open[i]); return; }
      if (tg.closest('#svc-add')) { R.services.push({ id: 'svc_' + Date.now().toString(36), name: 'New service', method: 'area', unit: 'm²', measure: 'area', category: 'Gardens', productivity: 20, materialPerUnit: 0, equipmentPerLine: 0, wastePerUnit: 0, description: '' }); open[R.services.length - 1] = true; render(); return; }
      if ((b = tg.closest('[data-del-svc]'))) { R.services.splice(+b.getAttribute('data-del-svc'), 1); open = {}; render(); return; }
      if (tg.closest('#tier-add')) { var last = R.tiers[R.tiers.length - 1]; R.tiers.push({ label: 'New tier', upTo: last.upTo + 2, productivity: Math.max(5, last.productivity - 4) }); render(); return; }
      if ((b = tg.closest('[data-del-tier]'))) { R.tiers.splice(+b.getAttribute('data-del-tier'), 1); render(); return; }
      if (tg.closest('#cond-add')) { R.conditions.push({ id: 'c' + Date.now().toString(36), label: 'New condition', time: 1, cutBack: 0.1 }); render(); return; }
      if ((b = tg.closest('[data-del-cond]'))) { R.conditions.splice(+b.getAttribute('data-del-cond'), 1); render(); }
    });
    function save() {
      R.tiers.sort(function (a, b) { return a.upTo - b.upTo; });
      App.post('rates', { rates: R }).then(function (d) { R = d.rates; App.refreshMe(); App.toast('Rate card saved as ' + R.version + '. New quotes use it.'); return App.get('rates'); }).then(function (d) { history = d.history; render(); }).catch(function (x) { App.toast(x.message, 'err'); });
    }
    App.get('rates').then(function (d) { R = P.normalise(d.rates); R.version = d.rates.version; R.approval = d.rates.approval; history = d.history; render(); }).catch(function (e) { App.toast(e.message, 'err'); });
  });

  // ======================= settings =======================
  App.route('/settings', 'settings', function (ctx) {
    App.setTop({ title: 'Settings', sub: 'Business, documents, staff and appearance' });
    App.refreshMe().then(function (me) {
      var b = me.business || {}, im = b.imagery || {}, rt = b.routing || {}, f = function (id, label, v, type, span) { return '<label class="field' + (span ? ' ' + span : '') + '">' + label + '<input id="' + id + '" type="' + (type || 'text') + '" value="' + esc(v || '') + '"></label>'; };
      var theme = (function () { try { return localStorage.getItem('seedsman-theme') || 'auto'; } catch (e) { return 'auto'; } })();
      ctx.el.innerHTML = '<div class="page"><div class="cols"><div class="stack">' +
        '<div class="card"><div class="card-h"><h2>Business details</h2><span class="muted small">Shown on quote documents</span></div><div class="card-b grid2">' +
          f('b-name', 'Business name', b.name) + f('b-tradingName', 'Trading name', b.tradingName) + f('b-phone', 'Phone', b.phone, 'tel') + f('b-email', 'Email (copied on emailed quotes)', b.email, 'email') +
          f('b-abn', 'ABN', b.abn) + f('b-days', 'Quotes valid for (days)', b.quoteValidityDays || 30, 'number') + f('b-address', 'Business address', b.address, 'text', 'span2') +
          '<label class="field span2">Quote terms<textarea id="b-terms" placeholder="e.g. Sizes measured from aerial imagery are confirmed on site…">' + esc(b.terms || '') + '</textarea></label>' +
          '<label class="field span2">Payment terms<textarea id="b-pay" placeholder="e.g. Payment due within 7 days of completion.">' + esc(b.paymentTerms || '') + '</textarea></label>' +
          '<div class="full"><button class="btn primary" id="b-save">' + icon('save') + 'Save business details</button></div></div></div>' +
        '<div class="card"><div class="card-h"><h2>Staff logins</h2></div><div id="users"></div><div class="card-b grid4" id="u-form"><label class="field">Name<input id="u-name"></label><label class="field">Email<input id="u-email" type="email"></label><label class="field">Password (8+)<input id="u-pw"></label><label class="field">Role<select id="u-role"><option value="field">Staff</option><option value="admin">Admin</option></select></label><div class="full"><button class="btn" id="u-add">' + icon('plus') + 'Add login</button></div></div></div>' +
        '</div><div class="stack">' +
        '<div class="card"><div class="card-h"><h2>Appearance</h2></div><div class="card-b"><div class="seg" id="theme">' + [['auto', 'Automatic'], ['light', 'Light'], ['dark', 'Dark']].map(function (t) { return '<button type="button" data-t="' + t[0] + '"' + (t[0] === theme ? ' class="on"' : '') + '>' + t[1] + '</button>'; }).join('') + '</div><p class="muted small">Automatic follows the device, like GeoCanvas.</p></div></div>' +
        '<div class="card"><div class="card-h"><h2>Map imagery</h2></div><div class="card-b stack"><p class="muted small" style="margin:0">For the sharpest, most recent aerial photos of Victoria, add a Nearmap or MetroMap subscription key. Only signed-in staff use it; customers never see it. Restrict the key to this website’s address in your Nearmap / MetroMap account.</p>' +
          '<label class="field">Nearmap API key<input id="im-nm" type="password" autocomplete="off" value="' + esc(im.nearmapKey || '') + '" placeholder="From Nearmap › Account › API keys"></label>' +
          '<div class="grid2"><label class="field">MetroMap API key<input id="im-mm" type="password" autocomplete="off" value="' + esc(im.metromapKey || '') + '" placeholder="From MetroMap support"></label><label class="field">MetroMap layer<input id="im-ml" value="' + esc(im.metromapLayer || 'Australia_latest') + '"></label></div>' +
          '<label class="field">Open maps with<select id="im-def">' + [['', 'Best available'], ['nearmap', 'Nearmap'], ['metromap', 'MetroMap'], ['clarity', 'Satellite HD (Esri Clarity)'], ['world', 'Satellite (Esri)'], ['vic', 'Vicmap aerial (licensed)'], ['street', 'Street map']].map(function (o) { return '<option value="' + o[0] + '"' + ((im.default || '') === o[0] ? ' selected' : '') + '>' + o[1] + '</option>'; }).join('') + '</select></label>' +
          '<div><button class="btn" id="im-save">' + icon('save') + 'Save imagery</button></div></div></div>' +
        '<div class="card"><div class="card-h"><h2>Drive times</h2><span class="tag">' + (rt.hasGoogleKey ? 'Google traffic' : 'Open-source roads') + '</span></div><div class="card-b stack">' +
          '<p class="muted small" style="margin:0">Drive times come from real road routes (OSRM, open source, on OpenStreetMap) with a range for typical traffic. For traffic-aware times — Google’s prediction for the departure time, with an optimistic–pessimistic range — add a Google Maps API key with the <b>Distance Matrix API</b> enabled. The key stays on the server.</p>' +
          '<label class="field">Google Maps API key<input id="rt-key" type="password" autocomplete="off" placeholder="' + (rt.hasGoogleKey ? 'Saved — type a new key to replace it' : 'Optional') + '"></label>' +
          '<div class="row"><button class="btn" id="rt-save">' + icon('save') + 'Save key</button>' + (rt.hasGoogleKey ? '<button class="btn ghost" id="rt-del" style="color:var(--danger)">Remove key</button>' : '') + '</div></div></div>' +
        '<div class="card"><div class="card-h"><h2>Home base</h2></div><div class="card-b stack"><p class="muted small" style="margin:0">Where the crew starts from. Quotes work out the return trip from here.</p>' +
          '<label class="field">Address<input id="hb-addr" value="' + esc((b.depot && b.depot.address) || '') + '" placeholder="Start typing your yard or home address"></label><div class="muted small" id="hb-note">' + (b.depot ? 'Saved: ' + esc(b.depot.address) : 'Not set yet.') + '</div></div></div>' +
        '<div class="card"><div class="card-h"><h2>Map start</h2></div><div class="card-b"><p class="muted small" style="margin-top:0">New maps open on ' + (b.mapStart ? 'your saved spot' : 'the Mornington Peninsula') + '.</p><button class="btn" id="map-here">' + icon('gps') + 'Use my current location</button></div></div>' +
        '<div class="card"><div class="card-h"><h2>Your password</h2></div><div class="card-b grid2"><label class="field">Current<input id="pw-cur" type="password" autocomplete="current-password"></label><label class="field">New (8+)<input id="pw-new" type="password" autocomplete="new-password"></label><div class="full"><button class="btn" id="pw-save">Change password</button></div></div></div>' +
        '</div></div></div>';
      var $ = function (id) { return ctx.el.querySelector('#' + id); };
      $('b-save').onclick = function () {
        App.put('business', { name: $('b-name').value, tradingName: $('b-tradingName').value, phone: $('b-phone').value, email: $('b-email').value, abn: $('b-abn').value, quoteValidityDays: $('b-days').value, address: $('b-address').value, terms: $('b-terms').value, paymentTerms: $('b-pay').value })
          .then(function () { App.refreshMe(); App.toast('Business details saved.'); }).catch(function (x) { App.toast(x.message, 'err'); });
      };
      $('theme').onclick = function (e) { var t = e.target.closest('[data-t]'); if (!t) return; ctx.el.querySelectorAll('#theme button').forEach(function (x) { x.classList.toggle('on', x === t); }); var v = t.getAttribute('data-t'); if (v === 'auto') { document.documentElement.removeAttribute('data-theme'); try { localStorage.setItem('seedsman-theme', 'auto'); } catch (er) { /* ignore */ } } else { document.documentElement.setAttribute('data-theme', v); try { localStorage.setItem('seedsman-theme', v); } catch (er) { /* ignore */ } } };
      var saveRt = function (k) { App.put('business', { routing: { googleKey: k } }).then(function () { App.toast(k ? 'Google key saved — drive times now use traffic predictions.' : 'Google key removed — drive times use open-source road routes.'); App.refreshMe(); App.go('#/settings'); }).catch(function (x) { App.toast(x.message, 'err'); }); };
      $('rt-save').onclick = function () { var k = $('rt-key').value.trim(); if (!k) return App.toast('Paste the key first.', 'warn'); saveRt(k); };
      if ($('rt-del')) $('rt-del').onclick = function () { saveRt(''); };
      $('im-save').onclick = function () {
        App.put('business', { imagery: { nearmapKey: $('im-nm').value, metromapKey: $('im-mm').value, metromapLayer: $('im-ml').value, default: $('im-def').value } }).then(function () {
          try { localStorage.removeItem('seedsman-basemap'); } catch (e) { /* ignore */ }
          return App.refreshMe();
        }).then(function () { App.toast('Imagery saved. Maps open with it from now on (the Satellite menu on any map switches).'); }).catch(function (x) { App.toast(x.message, 'err'); });
      };
      GIS.addressInput($('hb-addr'), { near: function () { return b.depot || b.mapStart || GIS.START; }, onPick: function (pl) {
        var depot = { lat: pl.lat, lng: pl.lng, address: [pl.address, pl.suburb, pl.state].filter(Boolean).join(', ') };
        App.put('business', { depot: depot, mapStart: b.mapStart || { lat: pl.lat, lng: pl.lng, zoom: 13 } }).then(function () { b.depot = depot; $('hb-note').textContent = 'Saved: ' + depot.address; App.refreshMe(); App.toast('Home base saved. Quotes will work out travel from here.'); }).catch(function (x) { App.toast(x.message, 'err'); });
      } });
      $('map-here').onclick = function () {
        if (!navigator.geolocation) return App.toast('Location is not available.', 'warn');
        navigator.geolocation.getCurrentPosition(function (p) { App.put('business', { mapStart: { lat: p.coords.latitude, lng: p.coords.longitude, zoom: 13 } }).then(function () { App.refreshMe(); App.toast('Maps now open here.'); }); }, function () { App.toast('Could not get your location.', 'warn'); });
      };
      $('pw-save').onclick = function () { App.post('me/password', { current: $('pw-cur').value, password: $('pw-new').value }).then(function () { App.toast('Password changed. Other devices are signed out.'); $('pw-cur').value = $('pw-new').value = ''; }).catch(function (x) { App.toast(x.message, 'err'); }); };
      function users() {
        App.get('users').then(function (d) { $('users').innerHTML = '<div class="list">' + d.users.map(function (u) { return '<div class="li"><span class="avatar">' + esc(App.initials(u.name)) + '</span><span class="grow"><b>' + esc(u.name) + '</b><small>' + esc(u.email) + '</small></span><span class="tag">' + (u.role === 'field' ? 'Staff' : 'Admin') + '</span></div>'; }).join('') + '</div>'; })
          .catch(function () { $('users').innerHTML = '<div class="empty" style="padding:14px">Only admins can see and add staff logins.</div>'; $('u-form').hidden = true; });
      }
      $('u-add').onclick = function () { App.post('users', { name: $('u-name').value, email: $('u-email').value, password: $('u-pw').value, role: $('u-role').value }).then(function () { App.toast('Login added. Give them the email and password.'); ['u-name', 'u-email', 'u-pw'].forEach(function (k) { $(k).value = ''; }); users(); }).catch(function (x) { App.toast(x.message, 'err'); }); };
      users();
    });
  });
})();
