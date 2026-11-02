/* Seedsman — hedge quote: measure hedges on the aerial photo, choose the faces to cut, price by m² of face. */
(function () {
  'use strict';
  var R = window.SeedsmanRates, Geo = window.Geo, esc = App.esc, money = App.money;
  var $ = function (id) { return document.getElementById(id); };
  var DRAFT = 'seedsman-quote-draft-v2';
  App.header('quote');

  var rates = R.normalise(null), biz = {};
  var Q = newQuote();
  function newQuote() { return { id: null, number: null, revision: 0, status: 'Draft', customerId: null, propertyId: null, customer: null, hedges: [], pin: null }; }
  function newHedge() { return { assetId: null, name: '', condition: 'maintained', length: 0, height: 1.8, depth: 0.8, faces: { top: true, front: true, back: true, lhs: false, rhs: false }, geometry: null, measuredLength: null, measuredArea: null }; }

  // ---------------- map ----------------
  var map = SeedMap.create('map', { select: $('basemap') });
  Measure.init(map);
  var hedgeLayer = L.layerGroup().addTo(map), pinMarker = null, redrawing = null;
  SeedMap.searchBox($('search-form'), $('search-q'), $('search-results'), map, function (p) {
    setPin(L.latLng(p.lat, p.lng));
    if (!$('p-address').value) $('p-address').value = p.address;
    if (!$('p-suburb').value) $('p-suburb').value = p.suburb;
    saveDraft();
  });
  $('locate').onclick = function () {
    if (!window.isSecureContext) { App.toast('Location needs the https:// address of this site.'); return; }
    map.locate({ setView: true, maxZoom: 19, enableHighAccuracy: true });
  };
  map.on('locationerror', function () { App.toast('Could not get your location.'); });
  function setPin(ll) {
    Q.pin = ll ? L.latLng(ll.lat, ll.lng) : null;
    if (pinMarker) { map.removeLayer(pinMarker); pinMarker = null; }
    if (!Q.pin) return;
    pinMarker = L.marker(Q.pin, { draggable: true, keyboard: false, title: 'House (drag to move)',
      icon: L.divIcon({ className: 'house-pin', iconSize: [30, 30], iconAnchor: [15, 28], html: '<span>⌂</span>' }) }).addTo(map);
    pinMarker.on('dragend', function () { Q.pin = pinMarker.getLatLng(); saveDraft(); });
  }
  $('p-pin').onclick = function () { setPin(map.getCenter()); saveDraft(); App.toast('House pin placed. Drag it to adjust.'); };

  // geometry helpers: GeoJSON ⇄ Leaflet
  function toLatLngs(g) {
    if (!g) return [];
    var c = g.type === 'Polygon' ? g.coordinates[0].slice(0, -1) : g.coordinates;
    return c.map(function (p) { return L.latLng(p[1], p[0]); });
  }
  function toGeo(mode, lls) {
    var r = function (ll) { return [Math.round(ll.lng * 1e7) / 1e7, Math.round(ll.lat * 1e7) / 1e7]; };
    var c = lls.map(r);
    return mode === 'area' ? { type: 'Polygon', coordinates: [c.concat([c[0]])] } : { type: 'LineString', coordinates: c };
  }

  // ---------------- measuring a hedge ----------------
  function measure(h, isNew) {
    redrawing = isNew ? null : h; renderMap();
    var g = h.geometry;
    Measure.start({
      mode: g && g.type === 'Polygon' ? 'area' : 'line', pts: toLatLngs(g),
      onDone: function (r) {
        redrawing = null;
        if (r.mode === 'line' && r.pts.length < 2) { renderAll(); return; }
        if (r.mode === 'area' && r.pts.length < 3) { renderAll(); return; }
        h.geometry = toGeo(r.mode, r.pts);
        if (r.mode === 'area') {
          h.measuredArea = round1(r.area); h.measuredLength = round1(r.bandLength);
          h.length = round1(r.bandLength); h.depth = Math.max(0.1, round1(r.bandDepth));
        } else { h.measuredLength = round1(r.length); h.measuredArea = null; h.length = round1(r.length); }
        if (isNew) { h.name = 'Hedge ' + (Q.hedges.length + 1); Q.hedges.push(h); }
        if (!Q.pin) setPin(r.pts[0]);
        renderAll();
        App.toast(h.name + ': ' + App.metres(h.length) + (r.mode === 'area' ? ', ' + App.m2(h.measuredArea) + ' from above' : '') + '.');
      },
      onCancel: function () { redrawing = null; renderAll(); }
    });
    if (window.innerWidth < 900) document.querySelector('.map-wrap').scrollIntoView({ behavior: 'smooth' });
  }
  function round1(n) { return Math.round((n || 0) * 10) / 10; }
  $('add-hedge').onclick = function () { measure(newHedge(), true); };
  $('add-typed').onclick = function () {
    var h = newHedge(); h.name = 'Hedge ' + (Q.hedges.length + 1); h.length = 10; Q.hedges.push(h); renderAll();
    var cards = document.querySelectorAll('#hedges .hedge'); var inp = cards[cards.length - 1] && cards[cards.length - 1].querySelector('.h-len'); if (inp) { inp.focus(); inp.select(); }
  };

  // ---------------- drawing ----------------
  function renderMap() {
    hedgeLayer.clearLayers();
    Q.hedges.forEach(function (h, i) {
      var lls = toLatLngs(h.geometry);
      if (lls.length < 2 || h === redrawing) return;
      var poly = h.geometry.type === 'Polygon';
      var mk = poly ? L.polygon : L.polyline;
      hedgeLayer.addLayer(mk(lls, { color: '#000', weight: 8, opacity: 0.4, interactive: false, fill: false }));
      var shape = mk(lls, { color: '#3ddc84', weight: 5, opacity: 1, fillColor: '#3ddc84', fillOpacity: 0.25 });
      shape.on('click', function (e) { L.DomEvent.stopPropagation(e); focusCard(i); });
      hedgeLayer.addLayer(shape);
      var at = poly ? L.polygon(lls).getBounds().getCenter() : lls[Math.floor((lls.length - 1) / 2)];
      hedgeLayer.addLayer(L.marker(at, { interactive: false, keyboard: false,
        icon: L.divIcon({ className: 'ms-label hl', iconSize: null, html: '<span>' + esc(h.name) + ' · ' + esc(App.metres(h.length)) + '</span>' }) }));
    });
  }
  function focusCard(i) {
    var card = document.querySelectorAll('#hedges .hedge')[i]; if (!card) return;
    card.scrollIntoView({ behavior: 'smooth', block: 'center' });
    card.classList.add('flash'); setTimeout(function () { card.classList.remove('flash'); }, 900);
  }
  function hedgeInfo(h) {
    var c = R.hedgeCalc(rates, h), a = c.areas, parts = [];
    R.FACES.forEach(function (f) { if (a[f.id]) parts.push(f.label.replace(' end', '') + ' ' + a[f.id].toFixed(1)); });
    return { c: c, text: (parts.length ? parts.join(' + ') + ' = ' : '') + App.m2(c.area) };
  }
  function renderCards() {
    $('no-hedges').hidden = Q.hedges.length > 0;
    var conds = rates.conditions;
    $('hedges').innerHTML = Q.hedges.map(function (h, i) {
      var info = hedgeInfo(h), c = info.c;
      var note = h.geometry ? (h.geometry.type === 'Polygon' ? 'Outlined on the map (' + App.m2(h.measuredArea) + ' from above)' : 'Measured on the map') : 'Sizes typed in';
      if (h.geometry && h.measuredLength != null && Math.abs(h.length - h.measuredLength) >= 0.05) note += '; length changed by hand from ' + App.metres(h.measuredLength);
      return '<div class="hedge" data-i="' + i + '">' +
        '<div class="hedge-head"><input class="h-name" value="' + esc(h.name) + '" aria-label="Hedge name"><b class="h-area">' + esc(App.m2(c.area)) + '</b></div>' +
        '<label>Condition<select class="h-cond">' + conds.map(function (x) { return '<option value="' + esc(x.id) + '"' + (x.id === h.condition ? ' selected' : '') + '>' + esc(x.label) + '</option>'; }).join('') + '</select></label>' +
        '<div class="hedge-grid three">' +
          '<label>Length (m)<input class="h-num" data-k="length" type="number" inputmode="decimal" min="0" step="0.1" value="' + (h.length || '') + '"></label>' +
          '<label>Height (m)<input class="h-num" data-k="height" type="number" inputmode="decimal" min="0" step="0.1" value="' + (h.height || '') + '"></label>' +
          '<label>Depth (m)<input class="h-num" data-k="depth" type="number" inputmode="decimal" min="0" step="0.1" value="' + (h.depth || '') + '"></label>' +
        '</div>' +
        '<div class="faces"><span>Cut:</span>' + R.FACES.map(function (f) { return '<label class="chip"><input type="checkbox" class="h-face" data-f="' + f.id + '"' + (h.faces[f.id] ? ' checked' : '') + '> ' + f.label + '</label>'; }).join('') + '</div>' +
        '<div class="h-calc"><span class="h-areas">' + esc(info.text) + '</span><span class="h-time">' + esc(timeText(c)) + '</span></div>' +
        '<div class="hedge-foot"><small>' + esc(note) + '</small><span>' +
          (h.geometry ? '<button class="link" data-act="show">Show</button>' : '') +
          '<button class="link" data-act="redo">' + (h.geometry ? 'Re-measure' : 'Measure on map') + '</button>' +
          '<button class="link danger" data-act="del">Delete</button></span></div>' +
      '</div>';
    }).join('');
  }
  function timeText(c) { return c.tier + ' · ' + c.productivity + ' m²/h · ' + c.hours.toFixed(2) + ' h' + (c.picker ? ' · cherry picker' : ''); }
  function calc() { return R.quoteCalc(rates, Q.hedges, options()); }
  function options() { return { removeWaste: $('o-waste').checked, travelKm: parseFloat($('o-km').value) || 0 }; }
  function renderTotals() {
    if (!Q.hedges.length) { $('totals').innerHTML = '<p class="hint">No hedges yet.</p>'; return; }
    var t = calc();
    var rows = [['Hedge face to cut', App.m2(t.area), ''], ['Time', t.personHours + ' person-hours', 'about ' + t.siteHours + ' h on site with ' + rates.crew + ' crew']].map(function (r) {
      return '<div class="t-row info"><span>' + esc(r[0]) + (r[2] ? '<small>' + esc(r[2]) + '</small>' : '') + '</span><b>' + esc(r[1]) + '</b></div>';
    });
    t.items.forEach(function (i) { rows.push('<div class="t-row"><span>' + esc(i.label) + (i.detail ? '<small>' + esc(i.detail) + '</small>' : '') + '</span><b>' + money(i.amount) + '</b></div>'); });
    if (t.risk) rows.push('<div class="t-row"><span>Contingency (' + Math.round(rates.risk * 100) + '%)</span><b>' + money(t.risk) + '</b></div>');
    if (t.minimumTopUp) rows.push('<div class="t-row"><span>Minimum charge is ' + money(rates.minimum) + '</span><b>' + money(t.minimumTopUp) + '</b></div>');
    rows.push('<div class="t-row sub"><span>Total excl. GST</span><b>' + money(t.exGst) + '</b></div>');
    rows.push('<div class="t-row"><span>GST</span><b>' + money(t.gst) + '</b></div>');
    rows.push('<div class="t-row total"><span>Total incl. GST</span><b>' + money(t.total) + '</b></div>');
    $('totals').innerHTML = rows.join('');
  }
  function renderHead() {
    $('q-title').textContent = Q.number ? 'Quote ' + Q.number : 'New quote';
    $('q-sub').textContent = Q.number ? 'Revision ' + Q.revision + '. Saving again makes a new revision.' : 'Not saved yet.';
    $('q-status').hidden = !Q.id; $('q-status').value = Q.status;
    var linked = !!Q.customerId;
    $('cust-pick').hidden = linked;
    $('cust-linked').hidden = !linked;
    if (linked) $('cust-linked').innerHTML = '<div><b>' + esc($('c-name').value) + '</b><br><small>' + esc([$('c-phone').value, $('c-email').value].filter(Boolean).join(' · ')) + '</small></div>' +
      '<span><a class="link" href="/customers/view.html?id=' + encodeURIComponent(Q.customerId) + '">Open customer</a>' + (Q.id ? '' : '<button class="link" type="button" id="cust-unlink">Change</button>') + '</span>';
    var un = $('cust-unlink'); if (un) un.onclick = function () { Q.customerId = null; Q.propertyId = null; renderHead(); };
    $('rate-note').textContent = 'Rate card ' + rates.version + (rates.approval === 'sample' ? ' (sample rates — set yours in Rates & settings)' : '') + '. Prices exclude GST until the total.';
  }
  function renderAll() { renderMap(); renderCards(); renderTotals(); renderHead(); saveDraft(); }

  // card edits: update in place so the field being typed in keeps focus
  $('hedges').addEventListener('input', onCardEdit);
  $('hedges').addEventListener('change', onCardEdit);
  function onCardEdit(e) {
    var card = e.target.closest('.hedge'); if (!card) return;
    var h = Q.hedges[+card.getAttribute('data-i')], cl = e.target.classList;
    if (cl.contains('h-name')) h.name = e.target.value;
    else if (cl.contains('h-num')) h[e.target.getAttribute('data-k')] = Math.max(0, parseFloat(e.target.value) || 0);
    else if (cl.contains('h-face')) h.faces[e.target.getAttribute('data-f')] = e.target.checked;
    else if (cl.contains('h-cond')) h.condition = e.target.value;
    var info = hedgeInfo(h);
    card.querySelector('.h-area').textContent = App.m2(info.c.area);
    card.querySelector('.h-areas').textContent = info.text;
    card.querySelector('.h-time').textContent = timeText(info.c);
    renderTotals(); saveDraft();
    if (e.type === 'change' && cl.contains('h-name')) renderMap();
  }
  $('hedges').addEventListener('click', function (e) {
    var b = e.target.closest('[data-act]'); if (!b) return;
    var i = +b.closest('.hedge').getAttribute('data-i'), h = Q.hedges[i], act = b.getAttribute('data-act');
    if (act === 'show') { map.fitBounds(L.polyline(toLatLngs(h.geometry)).getBounds(), { padding: [60, 60], maxZoom: 20 }); if (window.innerWidth < 900) document.querySelector('.map-wrap').scrollIntoView({ behavior: 'smooth' }); }
    if (act === 'redo') measure(h, false);
    if (act === 'del' && confirm('Remove ' + (h.name || 'this hedge') + ' from this quote?')) { Measure.cancel(); Q.hedges.splice(i, 1); renderAll(); }
  });
  ['o-waste', 'o-km'].forEach(function (id) { $(id).addEventListener('input', function () { renderTotals(); saveDraft(); }); });
  ['c-name', 'c-phone', 'c-email', 'p-address', 'p-suburb', 'q-notes'].forEach(function (id) { $(id).addEventListener('input', saveDraft); });
  $('q-status').onchange = function () {
    if (!Q.id) return;
    App.put('quotes/' + Q.id + '/status', { status: $('q-status').value }).then(function () { Q.status = $('q-status').value; App.toast('Marked ' + Q.status + '.'); }, function (e) { App.toast(e.message); });
  };

  // ---------------- customers ----------------
  var searchT;
  $('cust-q').addEventListener('input', function () {
    clearTimeout(searchT);
    var q = $('cust-q').value.trim(), box = $('cust-results');
    if (!q) { box.hidden = true; return; }
    searchT = setTimeout(function () {
      App.get('customers?q=' + encodeURIComponent(q)).then(function (d) {
        box.hidden = false;
        box.innerHTML = d.customers.length ? d.customers.slice(0, 8).map(function (c) {
          return '<button type="button" data-id="' + esc(c.id) + '"><b>' + esc(c.name) + '</b><small>' + esc([c.address, c.phone].filter(Boolean).join(' · ')) + '</small></button>';
        }).join('') : '<p class="hint">No customer found. Fill in the new customer below.</p>';
      }).catch(function (e) { App.toast(e.message); });
    }, 250);
  });
  $('cust-results').onclick = function (e) {
    var b = e.target.closest('[data-id]'); if (!b) return;
    $('cust-results').hidden = true; $('cust-q').value = '';
    loadCustomer(b.getAttribute('data-id'));
  };
  function fillCustomer(c) { Q.customerId = c.id; $('c-name').value = c.name || ''; $('c-phone').value = c.phone || ''; $('c-email').value = c.email || ''; }
  function fillProperty(p, hedges) {
    Q.propertyId = p ? p.id : null;
    $('p-address').value = p ? p.address : ''; $('p-suburb').value = p ? p.suburb : '';
    setPin(p && p.lat != null ? L.latLng(p.lat, p.lng) : null);
    if (hedges && !Q.hedges.length) Q.hedges = hedges.map(fromAsset);
    fitAll(p);
  }
  function fromAsset(a) {
    var i = a.inputs || {}, h = newHedge();
    h.assetId = a.id || a.assetId; h.name = a.name; h.geometry = a.geometry || null;
    ['length', 'height', 'depth', 'measuredLength', 'measuredArea', 'condition'].forEach(function (k) { if (i[k] != null) h[k] = i[k]; });
    if (i.faces) h.faces = Object.assign({}, h.faces, i.faces);
    return h;
  }
  function loadCustomer(id, propertyId) {
    return App.get('customers/' + encodeURIComponent(id)).then(function (d) {
      fillCustomer(d.customer);
      var p = d.properties.filter(function (x) { return x.id === propertyId; })[0] || d.properties[0] || null;
      fillProperty(p, p ? p.hedges : null);
      renderAll();
    }).catch(function (e) { App.toast(e.message); });
  }
  function fitAll(p) {
    var g = L.featureGroup(Q.hedges.filter(function (h) { return h.geometry; }).map(function (h) { return L.polyline(toLatLngs(h.geometry)); }));
    if (g.getLayers().length) map.fitBounds(g.getBounds(), { padding: [60, 60], maxZoom: 20 });
    else if (p && p.lat != null) map.setView([p.lat, p.lng], p.zoom || 19);
  }

  // ---------------- saving ----------------
  function payload() {
    var at = Q.pin || (Q.hedges.filter(function (h) { return h.geometry; }).map(function (h) { return toLatLngs(h.geometry)[0]; })[0]) || null;
    return {
      id: Q.id, customerId: Q.customerId, propertyId: Q.propertyId,
      customer: { name: $('c-name').value, phone: $('c-phone').value, email: $('c-email').value },
      property: { address: $('p-address').value, suburb: $('p-suburb').value, lat: at ? at.lat : null, lng: at ? at.lng : null, zoom: map.getZoom() },
      hedges: Q.hedges, options: options(), notes: $('q-notes').value, status: Q.status
    };
  }
  $('save-quote').onclick = function () {
    if (Measure.isOn()) { App.toast('Finish measuring first (Done or Cancel).'); return; }
    if (!Q.hedges.length) { App.toast('Measure a hedge first.'); return; }
    if (!Q.customerId && !$('c-name').value.trim()) { App.toast('Choose a customer or type the new customer’s name.'); $('c-name').focus(); return; }
    if (!Q.propertyId && !$('p-address').value.trim()) { App.toast('Type the property address.'); $('p-address').focus(); return; }
    var btn = $('save-quote'); btn.disabled = true; btn.textContent = 'Saving…';
    App.post('quotes', payload()).then(function (d) {
      loadQuoteData(d);
      try { localStorage.removeItem(DRAFT); } catch (e) { /* ignore */ }
      history.replaceState(null, '', '/quote/hedge.html?quote=' + encodeURIComponent(d.quote.id));
      App.toast('Saved ' + d.quote.number + ' (revision ' + d.quote.revision + '): ' + money(d.quote.calculation.total) + ' incl. GST.');
    }).catch(function (e) { App.toast(e.message, 6000); }).then(function () { btn.disabled = false; btn.textContent = 'Save quote'; });
  };
  function loadQuoteData(d) {
    var q = d.quote;
    Q.id = q.id; Q.number = q.number; Q.revision = q.revision; Q.status = q.status;
    fillCustomer(d.customer);
    Q.hedges = q.hedges.map(function (h) { return fromAsset({ assetId: h.assetId, name: h.name, geometry: h.geometry, inputs: h.inputs }); });
    fillProperty(d.property, null);
    var o = q.calculation.options || {};
    $('o-waste').checked = !!o.removeWaste; $('o-km').value = o.travelKm || 0; $('q-notes').value = q.notes || '';
    renderAll();
  }

  // ---------------- the quote as text: copy, email, print ----------------
  function quoteText() {
    var t = calc(), out = [], name = biz.tradingName || biz.name || 'Seedsman';
    out.push(name + ' — Hedge trimming quote' + (Q.number ? ' ' + Q.number : ''));
    out.push('Date: ' + new Date().toLocaleDateString('en-AU', { day: 'numeric', month: 'long', year: 'numeric' }));
    if ($('c-name').value) out.push('For: ' + $('c-name').value);
    var addr = [$('p-address').value, $('p-suburb').value].filter(Boolean).join(', ');
    if (addr) out.push('Property: ' + addr);
    out.push('');
    Q.hedges.forEach(function (h) {
      var c = R.hedgeCalc(rates, h), faces = R.FACES.filter(function (f) { return h.faces[f.id]; }).map(function (f) { return f.label; }).join(', ');
      out.push(h.name + ': ' + App.metres(h.length) + ' long, ' + App.metres(h.height) + ' high, ' + App.metres(h.depth) + ' deep — cut ' + (faces || 'nothing') + ' (' + App.m2(c.area) + ')' + (c.picker ? ', cherry picker' : ''));
    });
    out.push('');
    t.items.forEach(function (i) { out.push(i.label + ': ' + money(i.amount)); });
    if (t.risk) out.push('Contingency: ' + money(t.risk));
    if (t.minimumTopUp) out.push('Minimum charge top-up: ' + money(t.minimumTopUp));
    out.push('Total excl. GST: ' + money(t.exGst));
    out.push('GST: ' + money(t.gst));
    out.push('TOTAL incl. GST: ' + money(t.total));
    if ($('q-notes').value) { out.push(''); out.push('Notes: ' + $('q-notes').value); }
    out.push('');
    out.push('Sizes were measured from aerial imagery; the price is confirmed on site.');
    var contact = [biz.phone, biz.email].filter(Boolean).join(' · ');
    out.push(name + (contact ? ' · ' + contact : '') + (biz.abn ? ' · ABN ' + biz.abn : ''));
    return out.join('\n');
  }
  function needHedges() { if (Q.hedges.length) return true; App.toast('Measure a hedge first.'); return false; }
  $('copy-quote').onclick = function () {
    if (!needHedges()) return;
    var text = quoteText();
    var fallback = function () {
      var ta = document.createElement('textarea'); ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select(); try { document.execCommand('copy'); App.toast('Quote copied.'); } catch (e) { App.toast('Copy did not work on this device.'); }
      document.body.removeChild(ta);
    };
    if (navigator.clipboard && window.isSecureContext) navigator.clipboard.writeText(text).then(function () { App.toast('Quote copied.'); }, fallback); else fallback();
  };
  $('email-quote').onclick = function () {
    if (!needHedges()) return;
    var to = $('c-email').value.trim(), cc = biz.email && biz.email !== to ? biz.email : '';
    location.href = 'mailto:' + encodeURIComponent(to) + '?subject=' + encodeURIComponent((biz.tradingName || biz.name || 'Seedsman') + ' — hedge trimming quote' + (Q.number ? ' ' + Q.number : '')) +
      (cc ? '&cc=' + encodeURIComponent(cc) : '') + '&body=' + encodeURIComponent(quoteText());
  };
  $('print-quote').onclick = function () { if (!needHedges()) return; $('print-out').textContent = quoteText(); window.print(); };
  window.addEventListener('beforeprint', function () { $('print-out').textContent = quoteText(); });

  // ---------------- draft of an unsaved quote (this browser only) ----------------
  function saveDraft() {
    if (Q.id) return;
    try {
      localStorage.setItem(DRAFT, JSON.stringify({ customerId: Q.customerId, propertyId: Q.propertyId, hedges: Q.hedges, pin: Q.pin ? [Q.pin.lat, Q.pin.lng] : null,
        f: ['c-name', 'c-phone', 'c-email', 'p-address', 'p-suburb', 'q-notes', 'o-km'].reduce(function (o, id) { o[id] = $(id).value; return o; }, {}), waste: $('o-waste').checked }));
    } catch (e) { /* storage unavailable */ }
  }
  function loadDraft() {
    try {
      var d = JSON.parse(localStorage.getItem(DRAFT) || 'null'); if (!d) return false;
      Q.customerId = d.customerId; Q.propertyId = d.propertyId; Q.hedges = d.hedges || [];
      Object.keys(d.f || {}).forEach(function (id) { if ($(id)) $(id).value = d.f[id]; });
      $('o-waste').checked = d.waste !== false;
      if (d.pin) setPin(L.latLng(d.pin[0], d.pin[1]));
      fitAll(d.pin ? { lat: d.pin[0], lng: d.pin[1] } : null);
      return Q.hedges.length > 0 || !!d.customerId;
    } catch (e) { return false; }
  }

  // ---------------- start ----------------
  App.me().then(function (d) {
    rates = d.rates; biz = d.business || {};
    if (biz.mapStart && !App.params().quote) map.setView([biz.mapStart.lat, biz.mapStart.lng], biz.mapStart.zoom || 15);
    var p = App.params();
    if (p.quote) return App.get('quotes/' + encodeURIComponent(p.quote)).then(loadQuoteData);
    if (p.property) return App.get('properties/' + encodeURIComponent(p.property)).then(function (d2) { fillCustomer(d2.customer); fillProperty(d2.property, d2.hedges); renderAll(); });
    if (p.customer) return loadCustomer(p.customer);
    if (loadDraft()) App.toast('Carried on with the quote you hadn’t saved.');
    renderAll();
  }).catch(function (e) { App.toast(e.message, 6000); renderAll(); });
})();
