/* Seedsman Quote — quotes: list, the quote workspace (map + quote sheet), and the customer-facing document. */
(function () {
  'use strict';
  var P = window.SeedsmanPricing, icon = App.icon, esc = App.esc, money = App.money;
  var STATUSES = ['Draft', 'Sent', 'Accepted', 'Declined'];
  var DRAFT = 'seedsman-quote-draft-v3';
  function uid() { return 'itm_' + Math.random().toString(36).slice(2, 10); }

  // ======================= list =======================
  App.route('/quotes', 'quotes', function (ctx) {
    var status = ctx.query.status || '';
    App.setTop({ title: 'Quotes', sub: 'Every quote and estimate', actions: '<a class="btn primary" href="#/quotes/new">' + icon('plus') + '<span class="lbl">New quote</span></a>' });
    ctx.el.innerHTML = '<div class="page"><div class="toolbar"><label class="search">' + icon('search') + '<input class="input" type="search" id="q" placeholder="Search number, customer or address"></label>' +
      '<div class="seg" id="st">' + [''].concat(STATUSES).map(function (s) { return '<button type="button" data-s="' + s + '"' + (s === status ? ' class="on"' : '') + '>' + (s || 'All') + '</button>'; }).join('') + '</div></div>' +
      '<div class="card"><div class="tbl-wrap" id="list"><div class="empty">Loading…</div></div></div></div>';
    var t;
    function load() {
      App.get('quotes?status=' + encodeURIComponent(status) + '&q=' + encodeURIComponent(ctx.el.querySelector('#q').value.trim())).then(function (d) {
        var el = ctx.el.querySelector('#list');
        if (!d.quotes.length) { el.innerHTML = '<div class="empty">' + icon('quote') + '<b>No quotes ' + (status ? 'marked ' + status.toLowerCase() : 'yet') + '</b>Start one with <a href="#/quotes/new">New quote</a>.</div>'; return; }
        el.innerHTML = '<table class="tbl"><thead><tr><th>Quote</th><th>Customer & property</th><th>Services</th><th>Status</th><th class="r">Total</th><th class="r">Updated</th></tr></thead><tbody>' +
          d.quotes.map(function (q) {
            return '<tr class="click" data-href="#/quotes/' + esc(q.id) + '"><td><b>' + esc(q.number) + '</b><small>' + App.date(q.created_at) + (q.revision > 1 ? ' · rev ' + q.revision : '') + '</small></td>' +
              '<td><b>' + esc(q.customer) + '</b><small>' + esc(App.addr(q)) + '</small></td><td><small>' + esc(q.services || 'Hedge trimming') + '</small></td>' +
              '<td>' + App.pill(q.status) + (q.job_id ? ' <span class="tag">Scheduled</span>' : '') + '</td><td class="r"><b>' + money(q.total) + '</b></td><td class="r"><small>' + App.ago(q.updated_at) + '</small></td></tr>';
          }).join('') + '</tbody></table>';
      }).catch(function (e) { App.toast(e.message, 'err'); });
    }
    ctx.el.querySelector('#q').addEventListener('input', function () { clearTimeout(t); t = setTimeout(load, 250); });
    ctx.el.querySelector('#st').onclick = function (e) { var b = e.target.closest('[data-s]'); if (!b) return; status = b.getAttribute('data-s'); ctx.el.querySelectorAll('#st button').forEach(function (x) { x.classList.toggle('on', x === b); }); load(); };
    ctx.el.addEventListener('click', function (e) { var r = e.target.closest('tr[data-href]'); if (r) App.go(r.getAttribute('data-href')); });
    load();
  });

  // ======================= workspace =======================
  App.route('/quotes/new', 'quotes', function (ctx) { workspace(ctx, null); });
  App.route('/quotes/:id', 'quotes', function (ctx) { workspace(ctx, ctx.params[0]); });

  function workspace(ctx, quoteId) {
    var rates, biz, gis, S = blank(), el = ctx.el;
    function blank() { return { id: null, number: null, revision: 0, status: 'Draft', customerId: null, propertyId: null, customer: { name: '', phone: '', email: '' }, property: { address: '', suburb: '', lat: null, lng: null }, items: [], options: { removeWaste: true, travelKm: 0, markup: null, setupHours: null }, notes: '', assumptions: '', exclusions: '', drawings: [], job: null, open: {}, dirty: false, properties: [] }; }
    el.className = 'wide';
    el.innerHTML = '<div class="seg qw-tabs" id="tabs"><button type="button" data-p="quote" class="on">' + icon('quote') + 'Quote</button><button type="button" data-p="map">' + icon('layers') + 'Map</button></div>' +
      '<div class="qw" id="qw" data-pane="quote"><div id="gis"></div><div class="qw-sheet" id="sheet"></div></div>';
    var qw = el.querySelector('#qw');
    el.querySelector('#tabs').onclick = function (e) { var b = e.target.closest('[data-p]'); if (!b) return; showPane(b.getAttribute('data-p')); };
    function showPane(p) { qw.setAttribute('data-pane', p); el.querySelectorAll('#tabs button').forEach(function (x) { x.classList.toggle('on', x.getAttribute('data-p') === p); }); if (gis) gis.invalidate(); }
    function narrow() { return window.matchMedia('(max-width: 1100px)').matches; }

    function onBeforeUnload(e) { if (S.dirty) { e.preventDefault(); e.returnValue = ''; } }
    window.addEventListener('beforeunload', onBeforeUnload);
    ctx.onLeave(function () { window.removeEventListener('beforeunload', onBeforeUnload); if (S.dirty && !S.id) saveDraft(); if (gis) gis.destroy(); });

    App.me().then(function (me) {
      if (!el.isConnected) return;
      rates = me.rates; biz = me.business || {};
      gis = GIS.create(el.querySelector('#gis'), {
        start: biz.mapStart, onShapeClick: function (id) { var it = S.items.filter(function (x) { return x.id === id; })[0]; if (it) { S.open[id] = true; renderSheet(); flash(id); if (narrow()) showPane('quote'); } },
        onSearchPick: function (p) { if (!S.propertyId) { if (!S.property.address) S.property.address = p.address; if (!S.property.suburb) S.property.suburb = p.suburb; } setHouse(L.latLng(p.lat, p.lng)); dirty(); renderSheet(); }
      });
      if (quoteId) return App.get('quotes/' + encodeURIComponent(quoteId)).then(loadQuote);
      if (ctx.query.property) return App.get('properties/' + encodeURIComponent(ctx.query.property)).then(function (d) { useCustomer(d.customer); useProperty(d.property, d.drawings); render(); gis.fit(); workOutTravel(true); });
      if (ctx.query.customer) return pickCustomer(ctx.query.customer);
      var d = loadDraft();
      render();
      if (d) App.toast('Carried on with the quote you hadn’t saved.');
      if (!gis.fit() && S.property.lat == null && !d) { /* stay on the business start */ }
    }).catch(function (e) { App.toast(e.message, 'err', 7000); });

    // ---------- loading ----------
    function loadQuote(d) {
      var q = d.quote;
      S = blank();
      S.id = q.id; S.number = q.number; S.revision = q.revision; S.status = q.status; S.job = d.job;
      useCustomer(d.customer); useProperty(d.property, d.drawings);
      S.items = q.items.map(function (it) { var x = P.normaliseItem(it); x.id = x.id || uid(); x.measure = it.measure || null; return x; });
      var o = q.calculation.options || {};
      S.options = { removeWaste: o.removeWaste !== false, travelKm: o.travelKm || 0, markup: o.markup != null ? o.markup : null, setupHours: o.setupHours != null ? o.setupHours : null };
      S.notes = q.notes || ''; S.assumptions = q.assumptions || ''; S.exclusions = q.exclusions || '';
      S.dirty = false;
      render(); gis.fit();
    }
    function useCustomer(c) { S.customerId = c ? c.id : null; S.customer = { name: c ? c.name : '', phone: c ? c.phone : '', email: c ? c.email : '' }; }
    function useProperty(p, drawings) {
      S.propertyId = p ? p.id : null;
      S.property = p ? { address: p.address, suburb: p.suburb, lat: p.lat, lng: p.lng } : { address: '', suburb: '', lat: null, lng: null };
      S.drawings = drawings || [];
      setHouse(p && p.lat != null ? L.latLng(p.lat, p.lng) : null);
    }
    function setHouse(ll) {
      if (ll) { S.property.lat = ll.lat; S.property.lng = ll.lng; }
      gis.setPin(ll, { draggable: true, title: 'House — drag to move', onMove: function (x) { S.property.lat = x.lat; S.property.lng = x.lng; dirty(); if (S.options.travelAuto !== false) workOutTravel(true); } });
    }
    function pickCustomer(id) {
      return App.get('customers/' + encodeURIComponent(id)).then(function (d) {
        useCustomer(d.customer); S.properties = d.properties;
        var p = d.properties[0];
        if (!p) { useProperty(null); dirty(); render(); return; }
        return App.get('properties/' + encodeURIComponent(p.id)).then(function (pd) { useProperty(pd.property, pd.drawings); dirty(); render(); gis.fit(); if (!S.id) workOutTravel(true); });
      }).catch(function (e) { App.toast(e.message, 'err'); });
    }

    // ---------- drafts (unsaved new quotes, this browser only) ----------
    function saveDraft() { try { localStorage.setItem(DRAFT, JSON.stringify({ S: Object.assign({}, S, { open: {} }), at: Date.now() })); } catch (e) { /* ignore */ } }
    function loadDraft() {
      try {
        var d = JSON.parse(localStorage.getItem(DRAFT) || 'null'); if (!d || Date.now() - d.at > 7 * 86400000) return false;
        S = Object.assign(blank(), d.S, { open: {}, dirty: true });
        if (S.property.lat != null) setHouse(L.latLng(S.property.lat, S.property.lng));
        return S.items.length > 0 || !!S.customer.name;
      } catch (e) { return false; }
    }
    function clearDraft() { try { localStorage.removeItem(DRAFT); } catch (e) { /* ignore */ } }
    function dirty() { S.dirty = true; renderTop(); }

    // ---------- calculation ----------
    function calc() { return P.quoteCalc(rates, S.items, S.options); }
    function svc(it) { return P.serviceOf(rates, it.service) || { name: it.name || 'Item', method: 'hours', unit: 'h', category: 'Other', measure: 'none' }; }

    // ---------- rendering ----------
    function render() { renderTop(); renderSheet(); renderMap(); }
    var topKey = null;
    function renderTop() {
      if (!el.isConnected) return;
      var t = S.items.length ? calc() : null, key = [S.id, S.number, S.status].join('|');
      var sub = [S.customer.name, App.addr(S.property)].filter(Boolean).join(' · ') + (S.dirty ? ' · Unsaved changes' : S.number ? ' · Saved, revision ' + S.revision : '');
      var top = document.getElementById('top');
      if (key === topKey && top.querySelector('#q-total')) { // update in place so a click on Save is never lost to a re-render
        top.querySelector('.title-block .s').textContent = sub;
        top.querySelector('#q-total').textContent = t ? money(t.total) : '';
        return;
      }
      topKey = key;
      App.setTop({ el: el, back: '#/quotes',
        titleHtml: esc(S.number ? 'Quote ' + S.number : 'New quote') + (S.number ? ' ' + App.pill(S.status) : ''), sub: sub,
        actions: '<span class="num" id="q-total" style="font-weight:700;margin-right:6px">' + (t ? money(t.total) : '') + '</span>' +
          (S.id ? '<a class="btn" href="#/quotes/' + esc(S.id) + '/document">' + icon('print') + '<span class="lbl">Document</span></a>' : '') +
          '<button class="btn primary" id="save">' + icon('save') + '<span class="lbl">' + (S.id ? 'Save' : 'Save quote') + '</span></button>' });
      document.getElementById('save').onclick = save;
    }
    function renderMap() {
      var used = {}, list = [];
      S.items.forEach(function (it) {
        if (!it.geometry) return;
        if (it.drawingId) used[it.drawingId] = true;
        var c = calc().lines[S.items.indexOf(it)], s = svc(it);
        list.push({ id: it.id, geometry: it.geometry, color: App.cat(s.category).map, label: (it.name || s.name) + (c && c.qty ? ' · ' + App.qty(c.qty, c.unit) : '') });
      });
      S.drawings.forEach(function (d) { if (!used[d.id]) list.unshift({ id: 'drw:' + d.id, geometry: d.geometry, color: '#cfd8d2', dashed: true, faded: true, label: d.name }); });
      gis.setShapes(list);
    }

    function renderSheet() {
      var sheet = el.querySelector('#sheet'), t = S.items.length ? calc() : null;
      sheet.innerHTML = customerCard() + itemsCard(t) + jobCard() + summaryCard(t) + notesCard();
      wireSheet(); showTravel();
    }
    function wireSheet() {
      var a = el.querySelector('#p-address');
      if (a) GIS.addressInput(a, { near: function () { return biz.depot || gis.map.getCenter(); }, onPick: function (pl) {
        S.property.address = pl.address; S.property.suburb = pl.suburb;
        var sb = el.querySelector('#p-suburb'); if (sb) sb.value = pl.suburb;
        setHouse(L.latLng(pl.lat, pl.lng)); gis.map.setView([pl.lat, pl.lng], 20);
        S.options.travelAuto = true; dirty(); renderTop(); workOutTravel();
        if (narrow()) App.toast('Found it — the map is on the property.');
      } });
    }
    /** Return trip from the home base to the property (by road when the routing service answers). */
    function workOutTravel(quiet) {
      var box = el.querySelector('#travel-hint');
      if (!biz.depot) { if (box) box.innerHTML = 'Set your <a href="#/settings">home base</a> to work this out automatically.'; return; }
      if (S.property.lat == null) { if (box) box.textContent = 'Place the house pin to work out travel.'; return; }
      if (box) box.textContent = 'Working out the drive…';
      GIS.drive(biz.depot, { lat: S.property.lat, lng: S.property.lng }).then(function (r) {
        if (!el.isConnected) return;
        S.travelInfo = r;
        S.options.travelKm = Math.round(r.km * 2); S.options.travelAuto = true;
        var f = el.querySelector('[data-o=travelKm]'); if (f) f.value = S.options.travelKm;
        showTravel();
        dirty(); S.items.forEach(function (x) { refreshNumbers(x.id); }); if (!S.items.length) renderTop();
        if (!quiet) App.toast('Travel: ' + S.options.travelKm + ' km return from your home base' + (r.road ? '' : ' (estimated)') + '.');
      });
    }
    function showTravel() {
      var box = el.querySelector('#travel-hint'), r = S.travelInfo; if (!box) return;
      if (r) box.textContent = r.km.toFixed(1) + ' km each way · about ' + Math.round(r.min) + ' min' + (r.road ? ' by road' : ' (estimate: straight line × 1.35)') + ' from home base';
      else if (biz.depot) box.innerHTML = '<button type="button" class="link" id="travel-calc" style="padding:0">Work out from home base</button>';
      else box.innerHTML = 'Set your <a href="#/settings">home base</a> to work this out automatically.';
    }
    function customerCard() {
      if (S.customerId) {
        var props = S.properties && S.properties.length > 1 ? '<label class="field">Property<select id="prop-sel">' + S.properties.map(function (p) { return '<option value="' + esc(p.id) + '"' + (p.id === S.propertyId ? ' selected' : '') + '>' + esc(App.addr(p)) + '</option>'; }).join('') + '</select></label>' : '';
        return '<div class="card"><div class="cust-sum"><span class="avatar">' + esc(App.initials(S.customer.name)) + '</span><div class="grow"><b>' + esc(S.customer.name) + '</b><small>' + esc(App.addr(S.property) || 'No property address yet') + '</small><small>' + esc([S.customer.phone, S.customer.email].filter(Boolean).join(' · ')) + '</small></div>' +
          '<a class="ib sm" href="#/customers/' + esc(S.customerId) + '" title="Open customer">' + icon('users') + '</a>' + (S.id ? '' : '<button class="ib sm" id="cust-change" title="Change customer">' + icon('edit') + '</button>') + '</div>' +
          (props || (!S.propertyId ? '<div class="card-b grid2"><label class="field span2">Property address<input id="p-address" value="' + esc(S.property.address) + '"></label><label class="field">Suburb<input id="p-suburb" value="' + esc(S.property.suburb) + '"></label></div>' : '')) + '</div>';
      }
      return '<div class="card"><div class="card-h"><h2>Customer & property</h2></div><div class="card-b stack">' +
        '<label class="search">' + icon('search') + '<input class="input" type="search" id="cust-q" placeholder="Find an existing customer" autocomplete="off"></label><div class="card" id="cust-res" hidden style="box-shadow:none"></div>' +
        '<div class="grid2"><label class="field">New customer name<input id="c-name" value="' + esc(S.customer.name) + '"></label><label class="field">Phone<input id="c-phone" type="tel" value="' + esc(S.customer.phone) + '"></label>' +
        '<label class="field span2">Email<input id="c-email" type="email" value="' + esc(S.customer.email) + '"></label>' +
        '<label class="field span2">Property address<input id="p-address" value="' + esc(S.property.address) + '" placeholder="Search it on the map to drop the house pin"></label><label class="field">Suburb<input id="p-suburb" value="' + esc(S.property.suburb) + '"></label>' +
        '<label class="field">House pin<button class="btn block" type="button" id="pin-centre" style="margin-top:4px">' + icon('pin') + 'Map centre</button></label></div></div></div>';
    }
    function itemsCard(t) {
      return '<div class="card"><div class="card-h"><h2>Services</h2><button class="btn sm primary" id="add-svc">' + icon('plus') + 'Add service</button></div><div class="card-b">' +
        (S.items.length ? S.items.map(function (it, i) { return itemCard(it, t.lines[i]); }).join('') :
          '<div class="empty" style="padding:20px 6px">' + icon('ruler') + '<b>Add the first service</b>Pick a service, then measure it on the map — the length or area goes straight into the quote.</div>') + '</div></div>';
    }
    function itemCard(it, l) {
      var s = svc(it), c = App.cat(s.category), open = !!S.open[it.id];
      var sub = l.qty ? App.qty(l.qty, l.unit) + (l.detail ? ' · ' + l.detail : '') : 'Not measured yet';
      return '<div class="svc' + (open ? ' open' : '') + '" data-id="' + esc(it.id) + '"><div class="svc-h" data-act="toggle"><span class="svc-dot" style="background:' + c.color + '">' + icon(c.icon) + '</span>' +
        '<div class="grow"><b>' + esc(it.name || s.name) + '</b><small>' + esc(sub) + (l.picker ? ' · cherry picker' : '') + '</small></div><span class="amt">' + money(l.sell) + '</span><span class="chev">' + icon('chev') + '</span></div>' +
        '<div class="svc-b">' + itemBody(it, s, l) + '</div></div>';
    }
    function num(v) { return v == null || v === '' ? '' : v; }
    function itemBody(it, s, l) {
      var i = it.inputs, h = '';
      h += '<div class="grid2"><label class="field span2">Name on the quote<input data-f="name" value="' + esc(it.name || s.name) + '"></label></div>';
      // measuring
      if (s.measure !== 'none' || s.method === 'hedge') {
        var m = it.measure || {}, src = it.geometry ? (GIS.modeOf(it.geometry) === 'area' ? 'Outlined on the map' + (m.area ? ' · ' + GIS.fmtArea(m.area) : '') : GIS.modeOf(it.geometry) === 'point' ? 'Marked on the map' : 'Measured on the map' + (m.length ? ' · ' + GIS.fmtLen(m.length) : '')) : 'Not on the map';
        var compatible = S.drawings.filter(function (d) { return d.kind !== 'point' || s.measure === 'point'; }).length;
        h += '<div class="measure-box"><span class="grow">' + icon('ruler').replace('class="i"', 'class="i" style="display:inline;vertical-align:-4px;width:16px;height:16px"') + ' ' + esc(src) + '</span>' +
          '<button class="btn sm" data-act="measure">' + icon(s.measure === 'point' ? 'pin' : s.measure === 'area' ? 'area' : 'line') + (it.geometry ? 'Re-measure' : 'Measure on map') + '</button>' +
          (compatible ? '<button class="btn sm" data-act="drawing">' + icon('layers') + 'Saved drawing</button>' : '') +
          (it.geometry ? '<button class="ib sm" data-act="show" title="Show on map">' + icon('expand') + '</button>' : '') + '</div>';
      }
      if (s.method === 'hedge') {
        h += '<label class="field">Condition<select data-f="condition">' + rates.conditions.map(function (c) { return '<option value="' + esc(c.id) + '"' + (c.id === (i.condition || 'maintained') ? ' selected' : '') + '>' + esc(c.label) + '</option>'; }).join('') + '</select></label>';
        h += '<div class="grid3"><label class="field">Length (m)<input data-i="length" type="number" inputmode="decimal" min="0" step="0.1" value="' + num(i.length) + '"></label>' +
          '<label class="field">Height (m)<input data-i="height" type="number" inputmode="decimal" min="0" step="0.1" value="' + num(i.height) + '"></label>' +
          '<label class="field">Depth (m)<input data-i="depth" type="number" inputmode="decimal" min="0" step="0.1" value="' + num(i.depth) + '"></label></div>';
        var cond = rates.conditions.filter(function (c) { return c.id === (i.condition || 'maintained'); })[0] || rates.conditions[0];
        h += '<div class="grid3"><label class="field">Cut back (cm)<input data-i="cutBack" type="number" inputmode="decimal" min="0" step="1" placeholder="' + Math.round(cond.cutBack * 100) + '" value="' + num(i.cutBack) + '"></label>' +
          '<div class="field span2">Green waste<div class="waste-out" data-waste>' + wasteText(l) + '</div></div></div>';
        h += '<div><div class="field" style="margin-bottom:6px">Faces to cut</div><div class="faces">' + P.FACES.map(function (f) { return '<label class="chip"><input type="checkbox" data-face="' + f.id + '"' + (i.faces && i.faces[f.id] ? ' checked' : '') + '>' + f.label + ' <span class="muted num" data-fa="' + f.id + '">' + (l.areas && l.areas[f.id] ? l.areas[f.id].toFixed(1) + ' m²' : '') + '</span></label>'; }).join('') + '</div></div>';
      } else {
        var lbl = s.method === 'hours' ? 'Hours' : s.method === 'unit' ? 'Quantity (each)' : 'Quantity (' + s.unit + ')';
        h += '<div class="grid2"><label class="field">' + lbl + '<input data-i="qty" type="number" inputmode="decimal" min="0" step="' + (s.method === 'unit' ? 1 : 0.1) + '" value="' + num(i.qty) + '"></label></div>';
      }
      h += '<table class="breakdown" data-bd>' + breakdownRows(l) + '</table>';
      h += '<div class="grid2"><label class="field">Price override (excl. GST)<input data-f="priceOverride" type="number" inputmode="decimal" min="0" step="1" placeholder="' + l.sellCalc.toFixed(2) + '" value="' + num(it.priceOverride) + '"></label>' +
        '<label class="field">Description on the quote<input data-f="description" value="' + esc(it.description || s.description || '') + '"></label></div>';
      h += '<div class="row"><span class="spacer"></span><button class="link" data-act="dup">' + 'Duplicate</button><button class="link danger" data-act="del">Remove</button></div>';
      return h;
    }
    function wasteText(l) {
      if (l.method !== 'hedge') return '';
      return '<b class="num">' + (l.waste || 0).toFixed(2) + ' m³</b> <span class="muted small">' + (l.qty || 0).toFixed(1) + ' m² × ' + Math.round((l.cutBack || 0) * 100) + ' cm cut × ' + rates.looseFactor + ' loose</span>';
    }
    function breakdownRows(l) {
      var rows = [];
      if (l.hours) rows.push(['Labour', l.hours.toFixed(2) + ' h × ' + money(rates.labourCost), l.labour]);
      if (l.materials) rows.push(['Materials', '', l.materials]);
      if (l.equipment) rows.push(['Equipment', '', l.equipment]);
      rows.push(['Cost', '', l.cost]);
      return rows.map(function (r) { return '<tr><td>' + r[0] + (r[1] ? ' <span class="muted">' + esc(r[1]) + '</span>' : '') + '</td><td class="r">' + money(r[2]) + '</td></tr>'; }).join('') +
        '<tr class="t"><td>Price' + (l.override != null ? ' (override)' : ' (cost + ' + Math.round((S.options.markup != null && S.options.markup !== '' ? +S.options.markup : rates.markup) * 100) + '%)') + '</td><td class="r">' + money(l.sell) + '</td></tr>';
    }
    function jobCard() {
      var mk = S.options.markup != null && S.options.markup !== '' ? Math.round(S.options.markup * 100) : '';
      return '<div class="card"><div class="card-h"><h2>Job</h2></div><div class="card-b grid2">' +
        '<label class="check span2"><input type="checkbox" data-o="removeWaste"' + (S.options.removeWaste ? ' checked' : '') + '> Take the green waste away</label>' +
        '<label class="field">Travel, return (km)<input data-o="travelKm" type="number" min="0" step="1" inputmode="numeric" value="' + num(S.options.travelKm) + '"><span class="travel-hint" id="travel-hint"></span></label>' +
        '<label class="field">Setup (crew hours)<input data-o="setupHours" type="number" min="0" step="0.25" placeholder="' + rates.setupHours + '" value="' + num(S.options.setupHours) + '"></label>' +
        '<label class="field">Markup on cost (%)<input data-o="markup" type="number" min="0" step="1" placeholder="' + Math.round(rates.markup * 100) + '" value="' + mk + '"></label>' +
        '<label class="field">Crew<input disabled value="' + rates.crew + ' people"></label></div></div>';
    }
    function summaryCard(t) {
      if (!t) return '';
      var rows = t.lines.map(function (l, i) { return '<div class="sum-row"><span>' + esc(S.items[i].name || l.serviceName) + '<small>' + esc(App.qty(l.qty, l.unit)) + '</small></span><b>' + money(l.sell) + '</b></div>'; });
      t.job.forEach(function (j) { rows.push('<div class="sum-row"><span>' + esc(j.label) + (j.detail ? '<small>' + esc(j.detail) + '</small>' : '') + '</span><b>' + money(j.sell) + '</b></div>'); });
      if (t.risk) rows.push('<div class="sum-row"><span>Contingency<small>' + Math.round(rates.risk * 100) + '%</small></span><b>' + money(t.risk) + '</b></div>');
      if (t.minimumTopUp) rows.push('<div class="sum-row"><span>Minimum charge top-up<small>Minimum ' + money(rates.minimum) + '</small></span><b>' + money(t.minimumTopUp) + '</b></div>');
      rows.push('<div class="sum-row sub"><span>Total excl. GST</span><b>' + money(t.exGst) + '</b></div>');
      rows.push('<div class="sum-row"><span>GST</span><b>' + money(t.gst) + '</b></div>');
      rows.push('<div class="sum-row total"><span>Total incl. GST</span><b>' + money(t.total) + '</b></div>');
      return '<div class="card" id="sum"><div class="card-h"><h2>Summary</h2><span class="muted small">Rate card ' + esc(rates.version) + '</span></div><div class="card-b">' + rows.join('') +
        '<div class="internal"><div><small>Cost</small><b>' + money(t.costs.total) + '</b></div><div><small>Gross profit</small><b>' + money(t.profit) + '</b></div><div><small>Margin</small><b>' + App.pct(t.margin) + '</b></div><div><small>Est. man-hours</small><b>' + t.personHours + ' h</b><small>≈ ' + t.siteHours + ' h with ' + t.crew + ' men</small></div></div>' +
        '<p class="muted small" style="margin:8px 2px 0">Cost, profit and margin are for you only; the customer document shows prices.</p></div></div>';
    }
    function notesCard() {
      return '<div class="card"><div class="card-h"><h2>On the document</h2></div><div class="card-b stack">' +
        '<label class="field">Notes for the customer<textarea data-n="notes">' + esc(S.notes) + '</textarea></label>' +
        '<div class="grid2"><label class="field">Assumptions<textarea data-n="assumptions" placeholder="e.g. Clear access to both sides">' + esc(S.assumptions) + '</textarea></label>' +
        '<label class="field">Exclusions<textarea data-n="exclusions" placeholder="e.g. Removal of large trees">' + esc(S.exclusions) + '</textarea></label></div></div></div>';
    }

    // refresh just the numbers of one card + the summary (keeps focus while typing)
    function refreshNumbers(id) {
      var t = calc(), sheet = el.querySelector('#sheet');
      S.items.forEach(function (it, i) {
        if (id && it.id !== id) return;
        var card = sheet.querySelector('.svc[data-id="' + it.id + '"]'); if (!card) return;
        var l = t.lines[i];
        card.querySelector('.amt').textContent = money(l.sell);
        card.querySelector('.svc-h small').textContent = (l.qty ? App.qty(l.qty, l.unit) + (l.detail ? ' · ' + l.detail : '') : 'Not measured yet') + (l.picker ? ' · cherry picker' : '');
        var bd = card.querySelector('[data-bd]'); if (bd) bd.innerHTML = breakdownRows(l);
        P.FACES.forEach(function (f) { var x = card.querySelector('[data-fa="' + f.id + '"]'); if (x) x.textContent = l.areas && l.areas[f.id] ? l.areas[f.id].toFixed(1) + ' m²' : ''; });
        var po = card.querySelector('[data-f=priceOverride]'); if (po) po.placeholder = l.sellCalc.toFixed(2);
        var wo = card.querySelector('[data-waste]'); if (wo) wo.innerHTML = wasteText(l);
        var cb = card.querySelector('[data-i=cutBack]'); if (cb && l.cutBack != null && it.inputs.cutBack == null) cb.placeholder = Math.round(l.cutBack * 100);
      });
      var sc = sheet.querySelector('#sum');
      if (sc && S.items.length) { var tmp = document.createElement('div'); tmp.innerHTML = summaryCard(t); sc.replaceWith(tmp.firstChild); }
      renderTop();
    }
    function flash(id) { var c = el.querySelector('.svc[data-id="' + id + '"]'); if (c) { c.scrollIntoView({ behavior: 'smooth', block: 'center' }); c.classList.add('flash'); setTimeout(function () { c.classList.remove('flash'); }, 900); } }

    // ---------- events ----------
    var sheetEl = el.querySelector('#sheet');
    sheetEl.addEventListener('input', onEdit);
    sheetEl.addEventListener('change', onEdit);
    function itemOf(target) { var c = target.closest('.svc'); return c ? S.items.filter(function (x) { return x.id === c.getAttribute('data-id'); })[0] : null; }
    function onEdit(e) {
      var tg = e.target, it = itemOf(tg);
      if (tg.id === 'c-name' || tg.id === 'c-phone' || tg.id === 'c-email') { S.customer[tg.id.slice(2)] = tg.value; dirty(); return; }
      if (tg.id === 'p-address' || tg.id === 'p-suburb') { S.property[tg.id.slice(2)] = tg.value; dirty(); return; }
      if (tg.id === 'prop-sel' && e.type === 'change') { App.get('properties/' + encodeURIComponent(tg.value)).then(function (pd) { useProperty(pd.property, pd.drawings); dirty(); render(); gis.fit(); }); return; }
      if (tg.hasAttribute('data-n')) { S[tg.getAttribute('data-n')] = tg.value; dirty(); return; }
      if (tg.hasAttribute('data-o')) {
        var k = tg.getAttribute('data-o');
        if (k === 'travelKm') { S.options.travelAuto = false; S.travelInfo = null; var th = el.querySelector('#travel-hint'); if (th) th.innerHTML = '<button type="button" class="link" id="travel-calc" style="padding:0">Work out from home base</button>'; }
        S.options[k] = k === 'removeWaste' ? tg.checked : tg.value === '' ? null : k === 'markup' ? (parseFloat(tg.value) || 0) / 100 : parseFloat(tg.value) || 0;
        dirty(); S.items.forEach(function (x) { refreshNumbers(x.id); }); if (!S.items.length) renderTop(); return;
      }
      if (!it) return;
      if (tg.hasAttribute('data-i')) it.inputs[tg.getAttribute('data-i')] = tg.value === '' ? null : Math.max(0, parseFloat(tg.value) || 0);
      else if (tg.hasAttribute('data-face')) { it.inputs.faces = it.inputs.faces || {}; it.inputs.faces[tg.getAttribute('data-face')] = tg.checked; }
      else if (tg.getAttribute('data-f') === 'condition') it.inputs.condition = tg.value;
      else if (tg.getAttribute('data-f') === 'priceOverride') it.priceOverride = tg.value === '' ? null : Math.max(0, parseFloat(tg.value) || 0);
      else if (tg.hasAttribute('data-f')) { it[tg.getAttribute('data-f')] = tg.value; if (tg.getAttribute('data-f') === 'name') { var b = tg.closest('.svc').querySelector('.svc-h b'); if (b) b.textContent = tg.value; } }
      dirty(); refreshNumbers(it.id);
      if (e.type === 'change') renderMap();
    }
    sheetEl.addEventListener('click', function (e) {
      var tg = e.target;
      if (tg.closest('#add-svc')) { addServiceMenu(tg.closest('#add-svc')); return; }
      if (tg.closest('#cust-change')) { S.customerId = null; S.propertyId = null; S.drawings = []; S.properties = []; renderSheet(); renderMap(); return; }
      if (tg.closest('#travel-calc')) { workOutTravel(); return; }
      if (tg.closest('#pin-centre')) { setHouse(gis.map.getCenter()); dirty(); App.toast('House pin placed at the map centre. Drag it onto the house.'); return; }
      var cr = tg.closest('[data-cust]'); if (cr) { el.querySelector('#cust-res').hidden = true; pickCustomer(cr.getAttribute('data-cust')); return; }
      var a = tg.closest('[data-act]'); if (!a) return;
      var it = itemOf(a), act = a.getAttribute('data-act'); if (!it) return;
      if (act === 'toggle') { S.open[it.id] = !S.open[it.id]; a.closest('.svc').classList.toggle('open', S.open[it.id]); return; }
      if (act === 'measure') measure(it);
      if (act === 'drawing') drawingMenu(a, it);
      if (act === 'show') { gis.fit(GIS.toLatLngs(it.geometry)); if (narrow()) showPane('map'); var lls = GIS.toLatLngs(it.geometry); if (lls.length > 1) gis.map.fitBounds(L.latLngBounds(lls), { padding: [80, 80], maxZoom: 20 }); else gis.map.setView(lls[0], 20); }
      if (act === 'dup') { var c = JSON.parse(JSON.stringify(it)); c.id = uid(); c.drawingId = null; S.items.splice(S.items.indexOf(it) + 1, 0, c); S.open[c.id] = true; dirty(); render(); }
      if (act === 'del') App.confirm('Remove ' + (it.name || 'this service') + '?', 'It comes off this quote. A saved site drawing stays on the property.', 'Remove', true).then(function (ok) { if (!ok) return; S.items.splice(S.items.indexOf(it), 1); dirty(); render(); });
    });
    var custT;
    sheetEl.addEventListener('input', function (e) {
      if (e.target.id !== 'cust-q') return;
      clearTimeout(custT);
      var q = e.target.value.trim(), box = el.querySelector('#cust-res');
      if (!q) { box.hidden = true; return; }
      custT = setTimeout(function () {
        App.get('customers?q=' + encodeURIComponent(q)).then(function (d) {
          box.hidden = false;
          box.innerHTML = d.customers.length ? '<div class="list">' + d.customers.slice(0, 6).map(function (c) { return '<button class="li" data-cust="' + esc(c.id) + '"><span class="avatar">' + esc(App.initials(c.name)) + '</span><span class="grow"><b>' + esc(c.name) + '</b><small>' + esc([c.address, c.phone].filter(Boolean).join(' · ')) + '</small></span></button>'; }).join('') + '</div>'
            : '<div class="empty" style="padding:14px">No customer matches — fill in the new customer below.</div>';
        });
      }, 250);
    });

    function addServiceMenu(anchor) {
      var groups = {};
      rates.services.forEach(function (s) { if (s.active === false) return; (groups[s.category || 'Other'] = groups[s.category || 'Other'] || []).push(s); });
      App.menu(anchor, Object.keys(groups).map(function (g) {
        return '<div class="g">' + esc(g) + '</div>' + groups[g].map(function (s) { var c = App.cat(s.category); return '<button data-v="' + esc(s.id) + '"><span class="svc-dot" style="background:' + c.color + ';width:28px;height:28px">' + icon(c.icon) + '</span><span><b>' + esc(s.name) + '</b><small>' + esc(P.METHODS[s.method]) + '</small></span></button>'; }).join('');
      }).join(''), function (id) {
        var s = P.serviceOf(rates, id), it = { id: uid(), service: id, name: s.name, description: s.description || '', inputs: {}, geometry: null, measure: null, drawingId: null, priceOverride: null, notes: '' };
        if (s.method === 'hedge') it.inputs = { length: null, height: 1.8, depth: 0.8, condition: 'maintained', faces: { top: true, front: true, back: true, lhs: false, rhs: false } };
        else it.inputs = { qty: s.method === 'unit' ? 1 : s.method === 'hours' ? 1 : null };
        S.items.push(it); S.open = {}; S.open[it.id] = true; dirty(); render();
        if (s.measure !== 'none' && s.method !== 'hours') measure(it); else flash(it.id);
      });
    }
    function modesFor(s) { return s.method === 'hedge' ? ['line', 'area'] : s.measure === 'area' ? ['area'] : s.measure === 'point' ? ['point'] : s.method === 'length' ? ['line', 'area'] : ['line']; }
    function applyMeasure(it, res) {
      var s = svc(it), r1 = function (n) { return Math.round((n || 0) * 10) / 10; };
      it.geometry = res.geometry; it.measure = { length: res.length != null ? r1(res.length) : null, area: res.area != null ? r1(res.area) : null, perimeter: res.perimeter != null ? r1(res.perimeter) : null };
      if (s.method === 'hedge') {
        if (res.mode === 'area') { it.inputs.length = r1(res.length); it.inputs.depth = Math.max(0.1, r1(res.depth)); it.inputs.measuredArea = r1(res.area); }
        else it.inputs.length = r1(res.length);
        it.inputs.measuredLength = r1(res.length);
      } else if (s.method === 'area') it.inputs.qty = r1(res.area);
      else if (s.method === 'length') it.inputs.qty = r1(res.mode === 'area' ? res.perimeter : res.length);
      else if (s.method === 'unit' && !it.inputs.qty) it.inputs.qty = 1;
    }
    function measure(it) {
      var s = svc(it), modes = modesFor(s);
      if (narrow()) showPane('map');
      gis.draw({ title: (it.name || s.name), modes: modes, mode: it.geometry ? GIS.modeOf(it.geometry) : modes[0], pts: GIS.toLatLngs(it.geometry), doneLabel: 'Use in quote',
        onDone: function (res) {
          applyMeasure(it, res);
          if (S.property.lat == null) setHouse(res.pts[0]);
          S.open = {}; S.open[it.id] = true; dirty(); render();
          if (narrow()) showPane('quote');
          setTimeout(function () { flash(it.id); }, 50);
          App.toast((it.name || s.name) + ': ' + App.qty(calc().lines[S.items.indexOf(it)].qty, calc().lines[S.items.indexOf(it)].unit) + ' added to the quote.');
        },
        onCancel: function () { if (narrow()) showPane('quote'); } });
    }
    function drawingMenu(anchor, it) {
      var s = svc(it), modes = modesFor(s), list = S.drawings.filter(function (d) { return modes.indexOf(d.kind) >= 0; });
      if (!list.length) { App.toast('No saved drawings of the right kind on this property.', 'warn'); return; }
      App.menu(anchor, '<div class="g">Saved site drawings</div>' + list.map(function (d) {
        var m = d.measure || {}; return '<button data-v="' + esc(d.id) + '">' + icon(d.kind === 'area' ? 'area' : d.kind === 'point' ? 'pin' : 'line') + '<span><b>' + esc(d.name) + '</b><small>' + (m.area ? GIS.fmtArea(m.area) : m.length ? GIS.fmtLen(m.length) : d.kind) + ' · ' + App.dateShort(d.updated_at) + '</small></span></button>';
      }).join(''), function (id) {
        var d = S.drawings.filter(function (x) { return x.id === id; })[0]; if (!d) return;
        var mm = GIS.measureOf(d.geometry);
        applyMeasure(it, { mode: d.kind, geometry: d.geometry, length: mm.length, area: mm.area, perimeter: mm.perimeter, depth: mm.depth, pts: GIS.toLatLngs(d.geometry) });
        it.drawingId = d.id; if (!it.name || it.name === s.name) it.name = d.name;
        dirty(); render(); flash(it.id);
      });
    }

    // ---------- save ----------
    function save() {
      if (gis.isDrawing()) { App.toast('Finish measuring first (Use in quote or cancel).', 'warn'); return; }
      if (!S.items.length) { App.toast('Add a service first.', 'warn'); return; }
      if (!S.customerId && !S.customer.name.trim()) { App.toast('Choose a customer or type the new customer’s name.', 'warn'); var f = el.querySelector('#c-name'); if (f) f.focus(); return; }
      if (!S.propertyId && !S.property.address.trim()) { App.toast('Type the property address.', 'warn'); var g2 = el.querySelector('#p-address'); if (g2) g2.focus(); return; }
      var btn = document.getElementById('save'); btn.disabled = true;
      App.post('quotes', { id: S.id, customerId: S.customerId, propertyId: S.propertyId, customer: S.customer, property: Object.assign({}, S.property, { zoom: gis.map.getZoom() }),
        items: S.items, options: S.options, notes: S.notes, assumptions: S.assumptions, exclusions: S.exclusions, status: S.status })
        .then(function (d) {
          clearDraft();
          var open = S.open;
          loadQuote(d); S.open = open; renderSheet();
          history.replaceState(null, '', '#/quotes/' + encodeURIComponent(d.quote.id));
          App.toast('Saved ' + d.quote.number + ' (revision ' + d.quote.revision + ') — ' + money(d.quote.calculation.total) + ' incl. GST.');
        }).catch(function (e) { App.toast(e.message, 'err', 6000); btn.disabled = false; });
    }

    // status + scheduling live on the top bar's title pill menu
    document.getElementById('top').addEventListener('click', function (e) {
      var p = e.target.closest('.pill'); if (!p || !S.id) return;
      App.menu(p, '<div class="g">Mark quote as</div>' + STATUSES.map(function (s) { return '<button data-v="' + s + '">' + App.pill(s) + '</button>'; }).join('') +
        '<div class="g">Job</div><button data-v="__job">' + icon('calendar') + '<span><b>' + (S.job ? 'Open in schedule' : 'Schedule the job') + '</b><small>' + (S.job ? App.date(S.job.start) + ' · ' + esc(S.job.crew) : 'Drag it onto the calendar') + '</small></span></button>', function (v) {
        if (v === '__job') { App.go(S.job ? '#/schedule?date=' + S.job.start.slice(0, 10) : '#/schedule?quote=' + S.id); return; }
        App.put('quotes/' + S.id + '/status', { status: v }).then(function () { S.status = v; topKey = null; renderTop(); App.toast('Marked ' + v + '.'); }).catch(function (x) { App.toast(x.message, 'err'); });
      });
    });
  }

  // ======================= customer-facing document =======================
  App.route('/quotes/:id/document', 'quotes', function (ctx) {
    var view = null, pdfP = null, link = null;
    ctx.onLeave(function () { if (view) view.gis.destroy(); });
    App.setTop({ back: '#/quotes/' + ctx.params[0], title: 'Quote document', sub: 'Loading…' });
    Promise.all([App.me(), App.get('quotes/' + encodeURIComponent(ctx.params[0])), App.get('quotes/' + encodeURIComponent(ctx.params[0]) + '/link').catch(function () { return {}; })]).then(function (r) {
      if (!ctx.el.isConnected) return;
      var me = r[0], d = r[1], q = d.quote, b = me.business || {}, cu = d.customer, p = d.property;
      link = r[2].url || null;
      var filename = (b.tradingName || 'Quote').replace(/[^\w\- ]+/g, '').trim() + ' ' + q.number + '.pdf';
      App.setTop({ el: ctx.el, back: '#/quotes/' + q.id, title: 'Quote ' + q.number, sub: 'Customer document · ' + cu.name + (cu.email ? ' · ' + cu.email : ''),
        actions: '<button class="btn" id="link" title="Copy the customer’s link">' + icon('copy') + '<span class="lbl">Customer link</span></button><button class="btn" id="dl">' + icon('print') + '<span class="lbl">Download PDF</span></button><button class="btn primary" id="mail">' + icon('mail') + '<span class="lbl">Email with PDF</span></button>' });
      view = Doc.render(ctx.el, { business: b, customer: cu, property: p, quote: q, acceptance: d.acceptance, colorOf: function (it) { return App.cat((P.serviceOf(me.rates, it.service) || {}).category).map; } });
      // make the PDF in the background once the map has drawn, so Email can attach it straight away (phones only allow sharing right after a tap)
      setTimeout(function () { if (ctx.el.isConnected) pdfP = Doc.pdf(view.el).catch(function () { return null; }); }, 1800);
      function getPdf() { return pdfP || (pdfP = Doc.pdf(view.el).catch(function () { return null; })); }
      document.getElementById('dl').onclick = function () { App.toast('Making the PDF…'); getPdf().then(function (blob) { if (blob) Doc.download(blob, filename); else window.print(); }); };
      document.getElementById('link').onclick = function () {
        if (!link) return App.toast('The customer link is not available.', 'err');
        (navigator.clipboard && window.isSecureContext ? navigator.clipboard.writeText(link) : Promise.reject()).then(function () { App.toast('Link copied — the customer can view, download and accept the quote there.'); }, function () { prompt('Customer link:', link); });
      };
      document.getElementById('mail').onclick = function () {
        var first = (cu.name || '').split(' ')[0] || 'there', name = view.name;
        var body = 'Hi ' + first + ',\n\nThank you for the opportunity to quote. Please find our quote ' + q.number + ' for ' + [p.address, p.suburb].filter(Boolean).join(', ') + ' attached.\n\n' +
          'Total: ' + money(q.calculation.total) + ' incl. GST (valid until ' + App.date(q.valid_until) + ').\n' +
          (link ? '\nYou can also view the quote and accept it online here:\n' + link + '\n' : '') + '\nKind regards,\n' + name + (b.phone ? '\n' + b.phone : '');
        var go = function (blob) {
          Doc.email({ blob: blob, filename: filename, to: cu.email, cc: b.email && b.email !== cu.email ? b.email : '', subject: name + ' — quote ' + q.number, body: body }).then(function (how) {
            if (how === 'downloaded') App.toast('The PDF has downloaded — drag it from Downloads into the email. The email also has the customer’s link to the quote.', 'warn', 9000);
            if (how === 'shared' && q.status === 'Draft') App.put('quotes/' + q.id + '/status', { status: 'Sent' }).then(function () { App.toast('Marked Sent.'); });
          });
        };
        if (pdfP) pdfP.then(go); else { App.toast('Making the PDF…'); getPdf().then(go); }
      };
    }).catch(function (e) { App.toast(e.message, 'err'); });
  });
})();
