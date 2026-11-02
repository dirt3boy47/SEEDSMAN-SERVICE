/* Seedsman Service — hedge quote.
   A cut-down GeoCanvas: Queensland aerial imagery and the GeoCanvas measure tool (tap points along
   a line, drag them to adjust, undo). Each measured hedge is priced from js/config.js. */
(function () {
  'use strict';
  var CFG = window.SEEDSMAN, H = CFG.hedge, BIZ = CFG.business, Geo = window.Geo;
  var STORE = 'seedsman-hedge-quote-v1';

  function $(id) { return document.getElementById(id); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function money(n) { return '$' + n.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ','); }
  function metres(m) { return (Math.round(m * 10) / 10).toFixed(1) + ' m'; }
  var toastT;
  function toast(msg, ms) {
    var t = $('toast'); t.textContent = msg; t.hidden = false;
    clearTimeout(toastT); toastT = setTimeout(function () { t.hidden = true; }, ms || 3500);
  }

  // ---------------- map (from GeoCanvas) ----------------
  var map = L.map('map', { maxZoom: 22, minZoom: 5, zoomSnap: 0.25, zoomDelta: 0.5, boxZoom: false, attributionControl: false });
  L.control.attribution({ position: 'bottomleft', prefix: '<a href="https://leafletjs.com" target="_blank" rel="noopener">Leaflet</a>' }).addTo(map);
  map.setView([CFG.mapStart.lat, CFG.mapStart.lng], CFG.mapStart.zoom);

  var QLD = 'https://spatial-img.information.qld.gov.au/arcgis/rest/services/Basemaps/LatestStateProgram_AllUsers/ImageServer/tile/{z}/{y}/{x}';
  var QLD_ATTR = 'Imagery © State of Queensland (Dept of Resources), <a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noopener">CC BY 4.0</a>';
  var ESRI = 'https://server.arcgisonline.com/ArcGIS/rest/services/';
  var ESRI_ATTR = 'Imagery © Esri, Maxar, Earthstar Geographics';
  var ROADS = { url: ESRI + 'Reference/World_Transportation/MapServer/tile/{z}/{y}/{x}', o: { maxNativeZoom: 19, attribution: 'Roads © Esri' } };
  var BASEMAPS = {
    qldroads: { label: 'QLD aerial + roads', layers: [{ url: QLD, o: { maxNativeZoom: 20, attribution: QLD_ATTR, crossOrigin: true }, qld: true }, ROADS] },
    qld: { label: 'QLD aerial', layers: [{ url: QLD, o: { maxNativeZoom: 20, attribution: QLD_ATTR, crossOrigin: true }, qld: true }] },
    esriroads: { label: 'World aerial + roads', layers: [{ url: ESRI + 'World_Imagery/MapServer/tile/{z}/{y}/{x}', o: { maxNativeZoom: 19, attribution: ESRI_ATTR } }, ROADS] },
    osm: { label: 'Street map', layers: [{ url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png', o: { maxNativeZoom: 19, attribution: '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors' } }] }
  };
  var baseLayers = [];
  function setBasemap(key, opts) {
    opts = opts || {};
    if (!BASEMAPS[key]) key = 'qldroads';
    baseLayers.forEach(function (l) { map.removeLayer(l); });
    baseLayers = [];
    BASEMAPS[key].layers.forEach(function (d, i) {
      var o = Object.assign({ maxZoom: 22, keepBuffer: 4 }, d.o);
      if (d.qld && opts.noCors) delete o.crossOrigin;
      var tl = L.tileLayer(d.url, o).addTo(map);
      tl.setZIndex(i);
      if (d.qld) watchQld(tl, key, opts);
      baseLayers.push(tl);
    });
    $('basemap').value = key;
  }
  // If the Queensland imagery doesn't load, retry without CORS, then fall back to Esri imagery.
  function watchQld(tl, key, opts) {
    var ok = 0, bad = 0, done = false;
    tl.on('tileload', function () { ok++; });
    tl.on('tileerror', function () {
      bad++;
      if (done || ok || bad < 6 || navigator.onLine === false) return;
      done = true;
      if (!opts.noCors) { setBasemap(key, { noCors: true }); return; }
      toast('The Queensland imagery is not responding, so world imagery is shown instead.', 6000);
      setBasemap('esriroads');
    });
  }
  Object.keys(BASEMAPS).forEach(function (k) { var o = document.createElement('option'); o.value = k; o.textContent = BASEMAPS[k].label; $('basemap').appendChild(o); });
  $('basemap').onchange = function () { setBasemap($('basemap').value); };
  setBasemap('qldroads');

  // ---------------- quote state ----------------
  var Q = { hedges: [], next: 1, waste: false };
  var drawing = null; // { h: hedge, pts: [LatLng], isNew: bool }
  var hedgeLayer = L.layerGroup().addTo(map), drawLayer = L.layerGroup().addTo(map), addrMarker = null;
  var LINE = { color: '#ffd400', weight: 3, opacity: 1, dashArray: '8 6', interactive: false };
  var CASING = { color: '#000', weight: 6, opacity: 0.45, interactive: false };

  function heightOf(id) { for (var i = 0; i < H.heights.length; i++) if (H.heights[i].id === id) return H.heights[i]; return H.heights[0]; }
  function rateOf(h) { return heightOf(h.height).perMetre * h.faces + (h.top ? H.topPerMetre : 0); }
  function priceOf(h) { return (h.length || 0) * rateOf(h); }
  function describe(h) { return heightOf(h.height).label + ' high, ' + (h.faces === 2 ? 'both sides' : 'one side') + (h.top ? ' + top' : ''); }
  function totals() {
    var t = { metres: 0, trim: 0 };
    Q.hedges.forEach(function (h) { t.metres += h.length || 0; t.trim += priceOf(h); });
    t.waste = Q.waste ? t.metres * H.wastePerMetre : 0;
    t.callOut = Q.hedges.length ? H.callOut : 0;
    var sub = t.trim + t.waste + t.callOut;
    t.topUp = Q.hedges.length && sub < H.minimum ? H.minimum - sub : 0;
    t.total = sub + t.topUp;
    return t;
  }

  // ---------------- measuring (the GeoCanvas measure tool, line mode) ----------------
  function startDraw(h, isNew) {
    if (drawing) cancelDraw();
    drawing = { h: h, pts: h.pts.slice(), isNew: isNew };
    document.body.classList.add('measuring');
    $('draw-bar').hidden = false;
    renderHedges(); renderDraw();
    if (window.innerWidth < 900) document.querySelector('.map-wrap').scrollIntoView({ behavior: 'smooth' });
  }
  function endDraw() {
    drawing = null; drawLayer.clearLayers();
    document.body.classList.remove('measuring');
    $('draw-bar').hidden = true;
    renderAll();
  }
  function cancelDraw() { endDraw(); }
  function doneDraw() {
    var d = drawing;
    if (d.pts.length < 2) { toast('Tap at least two points along the hedge.'); return; }
    var h = d.h;
    h.pts = d.pts.map(function (p) { return L.latLng(p.lat, p.lng); });
    h.measured = Math.round(Geo.pathLength(h.pts) * 10) / 10;
    h.length = h.measured;
    if (d.isNew) { h.name = 'Hedge ' + Q.next++; Q.hedges.push(h); }
    endDraw();
    toast(h.name + ': ' + metres(h.length) + '.');
  }
  function renderDraw() {
    drawLayer.clearLayers();
    var d = drawing; if (!d) return;
    var lls = d.pts, len = Geo.pathLength(lls);
    if (lls.length >= 2) { drawLayer.addLayer(L.polyline(lls, CASING)); drawLayer.addLayer(L.polyline(lls, LINE)); }
    lls.forEach(function (p, i) {
      var mk = L.marker(p, { draggable: true, keyboard: false, zIndexOffset: 1000,
        icon: L.divIcon({ className: 'ms-vertex' + (i === 0 ? ' first' : ''), iconSize: [18, 18], iconAnchor: [9, 9] }) });
      mk.on('drag', function () {
        lls[i] = mk.getLatLng();
        drawLayer.eachLayer(function (x) { if (x instanceof L.Polyline) x.setLatLngs(lls); });
        $('draw-len').textContent = metres(Geo.pathLength(lls));
      });
      mk.on('dragend', renderDraw);
      drawLayer.addLayer(mk);
    });
    if (lls.length >= 2) {
      drawLayer.addLayer(L.marker(lls[lls.length - 1], { interactive: false, keyboard: false,
        icon: L.divIcon({ className: 'ms-label', iconSize: null, html: '<span>' + esc(metres(len)) + '</span>' }) }));
    }
    $('draw-len').textContent = metres(len);
    $('draw-undo').disabled = $('draw-clear').disabled = !lls.length;
    $('draw-done').disabled = lls.length < 2;
  }
  map.on('click', function (e) {
    if (!drawing) return;
    drawing.pts.push(e.latlng);
    renderDraw();
  });
  $('draw-undo').onclick = function () { if (drawing) { drawing.pts.pop(); renderDraw(); } };
  $('draw-clear').onclick = function () { if (drawing) { drawing.pts = []; renderDraw(); } };
  $('draw-cancel').onclick = cancelDraw;
  $('draw-done').onclick = doneDraw;

  function newHedge() { return { name: '', pts: [], measured: 0, length: 0, height: H.defaultHeight, faces: H.defaultFaces, top: H.defaultTop }; }
  $('add-hedge').onclick = function () { startDraw(newHedge(), true); };
  $('add-typed').onclick = function () {
    var h = newHedge(); h.name = 'Hedge ' + Q.next++; Q.hedges.push(h); renderAll();
    var inputs = document.querySelectorAll('#hedges .h-len'); var last = inputs[inputs.length - 1]; if (last) last.focus();
  };

  // ---------------- drawing the hedges ----------------
  function renderHedges() {
    hedgeLayer.clearLayers();
    Q.hedges.forEach(function (h, i) {
      if (h.pts.length < 2 || (drawing && drawing.h === h)) return;
      hedgeLayer.addLayer(L.polyline(h.pts, { color: '#000', weight: 8, opacity: 0.4, interactive: false }));
      var line = L.polyline(h.pts, { color: '#3ddc84', weight: 5, opacity: 1 });
      line.on('click', function (e) { L.DomEvent.stopPropagation(e); focusCard(i); });
      hedgeLayer.addLayer(line);
      hedgeLayer.addLayer(L.marker(h.pts[Math.floor((h.pts.length - 1) / 2)], { interactive: false, keyboard: false,
        icon: L.divIcon({ className: 'ms-label hl', iconSize: null, html: '<span>' + esc(h.name) + ' · ' + esc(metres(h.length)) + '</span>' }) }));
    });
  }
  function focusCard(i) {
    var card = document.querySelectorAll('#hedges .hedge')[i]; if (!card) return;
    card.scrollIntoView({ behavior: 'smooth', block: 'center' });
    card.classList.add('flash'); setTimeout(function () { card.classList.remove('flash'); }, 900);
  }
  function renderCards() {
    $('no-hedges').hidden = Q.hedges.length > 0;
    $('hedges').innerHTML = Q.hedges.map(function (h, i) {
      var heights = H.heights.map(function (x) { return '<option value="' + x.id + '"' + (x.id === h.height ? ' selected' : '') + '>' + esc(x.label) + '</option>'; }).join('');
      var note = h.pts.length >= 2 ? (Math.abs(h.length - h.measured) < 0.05 ? 'Measured on the map' : 'Measured ' + metres(h.measured) + ' on the map; length changed by hand') : 'Length typed in';
      return '<div class="hedge" data-i="' + i + '">' +
        '<div class="hedge-head"><input class="h-name" value="' + esc(h.name) + '" aria-label="Hedge name"><b class="h-price">' + money(priceOf(h)) + '</b></div>' +
        '<div class="hedge-grid">' +
          '<label>Length (m)<input class="h-len" type="number" inputmode="decimal" min="0" step="0.1" value="' + (h.length ? h.length : '') + '"></label>' +
          '<label>Height<select class="h-height">' + heights + '</select></label>' +
          '<label>Sides<select class="h-faces"><option value="1"' + (h.faces === 1 ? ' selected' : '') + '>One side</option><option value="2"' + (h.faces === 2 ? ' selected' : '') + '>Both sides</option></select></label>' +
          '<label class="check"><input class="h-top" type="checkbox"' + (h.top ? ' checked' : '') + '> Top</label>' +
        '</div>' +
        '<div class="hedge-foot"><small>' + esc(note) + ' · ' + money(rateOf(h)) + '/m</small>' +
          '<span>' + (h.pts.length >= 2 ? '<button class="link" data-act="show">Show</button>' : '') +
          '<button class="link" data-act="redo">' + (h.pts.length >= 2 ? 'Re-measure' : 'Measure on map') + '</button>' +
          '<button class="link danger" data-act="del">Delete</button></span></div>' +
      '</div>';
    }).join('');
  }
  function renderTotals() {
    var t = totals(), rows = [];
    if (!Q.hedges.length) { $('totals').innerHTML = '<p class="hint">No hedges yet.</p>'; return; }
    rows.push(['Trimming · ' + Q.hedges.length + (Q.hedges.length === 1 ? ' hedge' : ' hedges') + ', ' + metres(t.metres), t.trim]);
    if (Q.waste) rows.push(['Green waste removal · ' + metres(t.metres) + ' at ' + money(H.wastePerMetre) + '/m', t.waste]);
    if (t.callOut) rows.push(['Call-out', t.callOut]);
    if (t.topUp) rows.push(['Minimum charge is ' + money(H.minimum), t.topUp]);
    $('totals').innerHTML = rows.map(function (r) { return '<div class="t-row"><span>' + esc(r[0]) + '</span><b>' + money(r[1]) + '</b></div>'; }).join('') +
      '<div class="t-row total"><span>Total (inc GST)</span><b>' + money(t.total) + '</b></div>';
  }
  function renderAll() { renderHedges(); renderCards(); renderTotals(); save(); }

  // Card edits: update in place so the field being typed in keeps focus.
  $('hedges').addEventListener('input', onCardEdit);
  $('hedges').addEventListener('change', onCardEdit);
  function onCardEdit(e) {
    var card = e.target.closest('.hedge'); if (!card) return;
    var h = Q.hedges[+card.getAttribute('data-i')], c = e.target.classList;
    if (c.contains('h-name')) h.name = e.target.value;
    else if (c.contains('h-len')) h.length = Math.max(0, parseFloat(e.target.value) || 0);
    else if (c.contains('h-height')) h.height = e.target.value;
    else if (c.contains('h-faces')) h.faces = +e.target.value;
    else if (c.contains('h-top')) h.top = e.target.checked;
    card.querySelector('.h-price').textContent = money(priceOf(h));
    renderTotals(); save();
    if (e.type === 'change') renderHedges();
  }
  $('hedges').addEventListener('click', function (e) {
    var b = e.target.closest('[data-act]'); if (!b) return;
    var i = +b.closest('.hedge').getAttribute('data-i'), h = Q.hedges[i], act = b.getAttribute('data-act');
    if (act === 'show') { map.fitBounds(L.polyline(h.pts).getBounds(), { padding: [60, 60], maxZoom: 20 }); if (window.innerWidth < 900) document.querySelector('.map-wrap').scrollIntoView({ behavior: 'smooth' }); }
    if (act === 'redo') startDraw(h, false);
    if (act === 'del' && confirm('Delete ' + (h.name || 'this hedge') + '?')) { if (drawing && drawing.h === h) endDraw(); Q.hedges.splice(i, 1); renderAll(); }
  });
  $('waste').onchange = function () { Q.waste = $('waste').checked; renderTotals(); save(); };

  // ---------------- address search (OpenStreetMap Nominatim, as in GeoCanvas) ----------------
  $('search-form').onsubmit = function (e) {
    e.preventDefault();
    var q = $('search-q').value.trim(), res = $('search-results'); if (!q) return;
    res.hidden = false; res.innerHTML = '<p class="hint">Searching…</p>';
    var url = 'https://nominatim.openstreetmap.org/search?format=jsonv2&limit=6&countrycodes=au&viewbox=151.3,-27.0,152.6,-28.1&q=' + encodeURIComponent(q);
    fetch(url, { headers: { 'Accept': 'application/json' } }).then(function (r) { return r.json(); }).then(function (list) {
      if (!list.length) { res.innerHTML = '<p class="hint">Nothing found. Try the street and suburb, or move the map there yourself.</p>'; return; }
      res.innerHTML = list.map(function (p, i) { return '<button type="button" data-i="' + i + '">' + esc(p.display_name) + '</button>'; }).join('');
      res.onclick = function (ev) {
        var b = ev.target.closest('button'); if (!b) return;
        var p = list[+b.getAttribute('data-i')], ll = L.latLng(+p.lat, +p.lon);
        res.hidden = true;
        map.setView(ll, 20);
        if (addrMarker) map.removeLayer(addrMarker);
        addrMarker = L.marker(ll, { interactive: false, keyboard: false }).addTo(map);
        if (!$('c-address').value) { $('c-address').value = p.display_name.split(', ').slice(0, 4).join(', '); save(); }
      };
    }).catch(function () { res.innerHTML = '<p class="hint">Search is not available right now. Move the map to the property yourself.</p>'; });
  };
  $('search-q').addEventListener('input', function () { if (!$('search-q').value) $('search-results').hidden = true; });

  $('locate').onclick = function () {
    if (!window.isSecureContext) { toast('Location needs the https:// address of this site.'); return; }
    map.locate({ setView: true, maxZoom: 19, enableHighAccuracy: true });
  };
  map.on('locationerror', function () { toast('Could not get your location.'); });

  // ---------------- the quote as text: copy, email, print ----------------
  var CUST = ['c-name', 'c-phone', 'c-email', 'c-address', 'c-notes'];
  function quoteText() {
    var t = totals(), L1 = [], d = new Date();
    L1.push(BIZ.name + ' — Hedge trimming quote');
    L1.push('Date: ' + d.toLocaleDateString('en-AU', { day: 'numeric', month: 'long', year: 'numeric' }));
    if ($('c-name').value) L1.push('For: ' + $('c-name').value);
    if ($('c-address').value) L1.push('Address: ' + $('c-address').value);
    if ($('c-phone').value) L1.push('Phone: ' + $('c-phone').value);
    if ($('c-email').value) L1.push('Email: ' + $('c-email').value);
    L1.push('');
    Q.hedges.forEach(function (h) { L1.push(h.name + ': ' + metres(h.length) + ', ' + describe(h) + ' — ' + money(priceOf(h))); });
    if (Q.waste) L1.push('Green waste removal (' + metres(t.metres) + '): ' + money(t.waste));
    if (t.callOut) L1.push('Call-out: ' + money(t.callOut));
    if (t.topUp) L1.push('Minimum charge top-up: ' + money(t.topUp));
    L1.push('');
    L1.push('TOTAL (inc GST): ' + money(t.total));
    if ($('c-notes').value) { L1.push(''); L1.push('Notes: ' + $('c-notes').value); }
    L1.push('');
    L1.push('Lengths were measured from aerial imagery; the price is confirmed on site.');
    var contact = [BIZ.phone, BIZ.email].filter(Boolean).join(' · ');
    L1.push(BIZ.name + (contact ? ' · ' + contact : '') + (BIZ.abn ? ' · ABN ' + BIZ.abn : ''));
    return L1.join('\n');
  }
  function needHedges() { if (Q.hedges.length) return true; toast('Measure a hedge first.'); return false; }
  $('copy-quote').onclick = function () {
    if (!needHedges()) return;
    var text = quoteText();
    var fallback = function () {
      var ta = document.createElement('textarea'); ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select(); try { document.execCommand('copy'); toast('Quote copied.'); } catch (e) { toast('Copy did not work on this device.'); }
      document.body.removeChild(ta);
    };
    if (navigator.clipboard && window.isSecureContext) navigator.clipboard.writeText(text).then(function () { toast('Quote copied.'); }, fallback); else fallback();
  };
  $('email-quote').onclick = function () {
    if (!needHedges()) return;
    var to = $('c-email').value.trim(), cc = BIZ.email && BIZ.email !== to ? BIZ.email : '';
    var q = 'subject=' + encodeURIComponent(BIZ.name + ' — hedge trimming quote') + (cc ? '&cc=' + encodeURIComponent(cc) : '') + '&body=' + encodeURIComponent(quoteText());
    location.href = 'mailto:' + encodeURIComponent(to) + '?' + q;
  };
  $('print-quote').onclick = function () { if (!needHedges()) return; $('print-out').textContent = quoteText(); window.print(); };
  window.addEventListener('beforeprint', function () { $('print-out').textContent = quoteText(); });

  // ---------------- keep the quote if the page is reloaded (this browser only) ----------------
  function save() {
    try {
      var c = {}; CUST.forEach(function (id) { c[id] = $(id).value; });
      localStorage.setItem(STORE, JSON.stringify({ q: { next: Q.next, waste: Q.waste, hedges: Q.hedges.map(function (h) {
        return { name: h.name, measured: h.measured, length: h.length, height: h.height, faces: h.faces, top: h.top, pts: h.pts.map(function (p) { return [p.lat, p.lng]; }) };
      }) }, c: c }));
    } catch (e) { /* storage unavailable: the quote still works, it just isn't kept */ }
  }
  function load() {
    try {
      var s = JSON.parse(localStorage.getItem(STORE) || 'null'); if (!s) return;
      Q.next = s.q.next || 1; Q.waste = !!s.q.waste;
      Q.hedges = (s.q.hedges || []).map(function (h) { h.pts = (h.pts || []).map(function (p) { return L.latLng(p[0], p[1]); }); return h; });
      CUST.forEach(function (id) { $(id).value = (s.c && s.c[id]) || ''; });
      $('waste').checked = Q.waste;
      var withPts = Q.hedges.filter(function (h) { return h.pts.length >= 2; });
      if (withPts.length) map.fitBounds(L.featureGroup(withPts.map(function (h) { return L.polyline(h.pts); })).getBounds(), { padding: [60, 60], maxZoom: 20 });
    } catch (e) { /* ignore a broken saved quote */ }
  }
  CUST.forEach(function (id) { $(id).addEventListener('input', save); });
  $('new-quote').onclick = function () {
    if ((Q.hedges.length || $('c-name').value) && !confirm('Start a new quote? This one will be cleared.')) return;
    if (drawing) endDraw();
    Q = { hedges: [], next: 1, waste: false };
    CUST.forEach(function (id) { $(id).value = ''; });
    $('waste').checked = false; $('search-q').value = '';
    if (addrMarker) { map.removeLayer(addrMarker); addrMarker = null; }
    renderAll();
  };

  load();
  renderAll();
})();
