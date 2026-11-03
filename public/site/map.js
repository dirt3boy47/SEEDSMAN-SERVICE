/* Seedsmans — Map your property. Find the property on Google satellite, draw the hedges (lines), lawns to mow (areas)
   and trees to prune (points), describe them, add access and photos, and request a quote. The enquiry arrives in the
   Pipeline with the property pin, a written summary and the shapes themselves — starting the quote puts the shapes on
   the property as saved drawings, ready to add to the quote. */
(function () {
  'use strict';
  var $ = function (s, r) { return (r || document).querySelector(s); }, $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  var LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  var HEIGHTS = ['Under 1.5 m', '1.5 – 2.5 m', '2.5 – 4 m', 'Over 4 m'], SIDES = ['Top', 'Street side', 'Garden side', 'Ends'], CONDS = ['Kept regularly', 'Overgrown', 'Needs reducing'];
  var MOWING = ['One-off cut', 'Regular mowing'], TREE_SIZES = ['Small, under 3 m', 'Medium, 3 – 6 m', 'Large, over 6 m'];
  var ACCESS = ['Open access', 'Narrow side access', 'Steep or uneven', 'Over a fence or neighbour’s side', 'Pool or delicate garden nearby'];
  var KINDS = {
    hedge: { label: 'Hedge', plural: 'Hedges', how: 'Tap along the hedge, then Finish hedge.', min: 2, finish: 'Finish hedge' },
    lawn: { label: 'Lawn', plural: 'Lawns to mow', how: 'Tap around the edge of the lawn, then Finish lawn.', min: 3, finish: 'Finish lawn' },
    trees: { label: 'Trees', plural: 'Trees to prune', how: 'Tap each tree, then Finish trees.', min: 1, finish: 'Finish trees' }
  };

  var S = { step: 0, pin: null, address: '', suburb: '', mode: 'hedge', shapes: [], cur: null, skip: false, describe: '', access: [], waste: 'Take it away', notes: '', name: '', phone: '', email: '', contact: 'Call' };
  var photos = [];

  // ---------- the map: Google satellite only (same Map Tiles imagery and key as the staff app) ----------
  var map = L.map('map', { zoomControl: false, attributionControl: false, maxZoom: 22 }).setView([-38.38, 145.05], 11);
  var attribution = L.control.attribution({ position: 'topright', prefix: '<a href="https://leafletjs.com">Leaflet</a>' }).addTo(map);
  L.control.zoom({ position: 'topright' }).addTo(map);
  window.SMmap = map; // for testing
  var GT = 'https://tile.googleapis.com', gKey = null, gSession = null, gAttr = null, gTimer = null;
  function googleSession(key) {
    try { var c = JSON.parse(localStorage.getItem('sm-gsession') || 'null'); if (c && c.key === key && c.expiry * 1000 > Date.now() + 3600000) return Promise.resolve(c.session); } catch (e) { /* no storage */ }
    return fetch(GT + '/v1/createSession?key=' + encodeURIComponent(key), { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mapType: 'satellite', language: 'en-AU', region: 'AU', layerTypes: ['layerRoadmap'], overlay: false }) })
      .then(function (r) { return r.json().then(function (d) { if (!r.ok || !d.session) throw new Error((d.error && d.error.message) || 'no session'); return d; }); })
      .then(function (d) { try { localStorage.setItem('sm-gsession', JSON.stringify({ key: key, session: d.session, expiry: +d.expiry || Date.now() / 1000 + 86400 })); } catch (e) { /* ignore */ } return d.session; });
  }
  function googleCredit() {
    clearTimeout(gTimer);
    gTimer = setTimeout(function () {
      if (!gSession) return; var b = map.getBounds();
      fetch(GT + '/tile/v1/viewport?session=' + gSession + '&key=' + encodeURIComponent(gKey) + '&zoom=' + Math.round(map.getZoom()) + '&north=' + b.getNorth().toFixed(5) + '&south=' + b.getSouth().toFixed(5) + '&east=' + b.getEast().toFixed(5) + '&west=' + b.getWest().toFixed(5))
        .then(function (r) { return r.json(); }).then(function (d) { setCredit(d.copyright || ''); }).catch(function () {});
    }, 500);
  }
  function setCredit(text) { if (gAttr) attribution.removeAttribution(gAttr); gAttr = '<b class="g-logo">Google</b>' + (text ? ' ' + esc(text) : ''); attribution.addAttribution(gAttr); }
  function fallback() { L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { maxNativeZoom: 19, maxZoom: 22, attribution: 'Imagery © Esri, Maxar' }).addTo(map); }
  fetch('/api/public/business').then(function (r) { return r.ok ? r.json() : {}; }).then(function (b) {
    if (!b.mapKey) throw new Error('no key');
    gKey = b.mapKey;
    return googleSession(gKey).then(function (session) {
      gSession = session;
      L.tileLayer(GT + '/v1/2dtiles/{z}/{x}/{y}?session=' + session + '&key=' + encodeURIComponent(gKey), { maxZoom: 22, maxNativeZoom: 21, keepBuffer: 4 }).addTo(map);
      setCredit(''); googleCredit(); map.on('moveend', googleCredit);
    });
  }).catch(fallback);

  var pinMarker = null, layer = L.layerGroup().addTo(map);
  var pinIcon = L.divIcon({ className: 'mpin', html: '<span></span>', iconSize: [26, 26], iconAnchor: [13, 13] });

  // ---------- measuring ----------
  function dist(a, b) { var R = 6371000, d = Math.PI / 180, x = Math.sin((b.lat - a.lat) * d / 2), y = Math.sin((b.lng - a.lng) * d / 2); return 2 * R * Math.asin(Math.sqrt(x * x + Math.cos(a.lat * d) * Math.cos(b.lat * d) * y * y)); }
  function lenOf(pts) { var s = 0; for (var i = 1; i < pts.length; i++) s += dist(pts[i - 1], pts[i]); return s; }
  function areaOf(pts) { // square metres, on a local flat projection (fine at property scale)
    if (pts.length < 3) return 0;
    var R = 6371000, d = Math.PI / 180, lat0 = pts[0].lat * d, s = 0;
    var xy = pts.map(function (p) { return [R * (p.lng - pts[0].lng) * d * Math.cos(lat0), R * (p.lat - pts[0].lat) * d]; });
    for (var i = 0; i < xy.length; i++) { var j = (i + 1) % xy.length; s += xy[i][0] * xy[j][1] - xy[j][0] * xy[i][1]; }
    return Math.abs(s) / 2;
  }
  function fmtLen(m) { return m < 10 ? m.toFixed(1) + ' m' : Math.round(m) + ' m'; }
  function fmtArea(a) { return Math.round(a) + ' m²'; }
  function size(x) { return x.type === 'hedge' ? fmtLen(lenOf(x.pts)) : x.type === 'lawn' ? fmtArea(areaOf(x.pts)) : x.pts.length + ' tree' + (x.pts.length === 1 ? '' : 's'); }
  function nameOf(x) {
    var same = S.shapes.filter(function (y) { return y.type === x.type; }), i = same.indexOf(x); if (i < 0) i = same.length;
    return x.type === 'hedge' ? 'Hedge ' + LETTERS[i] : x.type === 'lawn' ? 'Lawn ' + (i + 1) : 'Trees ' + (i + 1);
  }
  function of(type) { return S.shapes.filter(function (x) { return x.type === type; }); }
  function totals() { return { lm: of('hedge').reduce(function (a, x) { return a + lenOf(x.pts); }, 0), m2: of('lawn').reduce(function (a, x) { return a + areaOf(x.pts); }, 0), trees: of('trees').reduce(function (a, x) { return a + x.pts.length; }, 0) }; }

  // ---------- drawing on the map ----------
  function tag(ll, text) { L.marker(ll, { interactive: false, icon: L.divIcon({ className: 'mtag', html: '<span>' + esc(text) + '</span>', iconSize: null }) }).addTo(layer); }
  function draw() {
    layer.clearLayers();
    S.shapes.concat(S.cur ? [S.cur] : []).forEach(function (x) {
      var ll = x.pts.map(function (p) { return [p.lat, p.lng]; }), cur = x === S.cur, label = nameOf(x).toUpperCase() + ' · ' + size(x).toUpperCase();
      if (x.type === 'hedge') {
        if (ll.length > 1) { L.polyline(ll, { color: '#1b2a25', weight: 8, opacity: .35, interactive: false }).addTo(layer); L.polyline(ll, { color: '#FAFAF7', weight: 3.5, dashArray: cur ? '6 6' : null, interactive: false }).addTo(layer); }
        ll.forEach(function (p) { L.circleMarker(p, { radius: 4, color: '#FAFAF7', weight: 2, fillColor: '#243C35', fillOpacity: 1, interactive: false }).addTo(layer); });
        if (ll.length > 1) { var m = Math.floor((ll.length - 1) / 2); tag([(ll[m][0] + ll[m + 1][0]) / 2, (ll[m][1] + ll[m + 1][1]) / 2], label); }
      } else if (x.type === 'lawn') {
        if (ll.length > 2) L.polygon(ll, { color: '#FAFAF7', weight: 2.5, dashArray: cur ? '6 6' : null, fillColor: '#D5C8AD', fillOpacity: .28, interactive: false }).addTo(layer);
        else if (ll.length > 1) L.polyline(ll, { color: '#FAFAF7', weight: 2.5, dashArray: '6 6', interactive: false }).addTo(layer);
        ll.forEach(function (p) { L.circleMarker(p, { radius: 4, color: '#FAFAF7', weight: 2, fillColor: '#87927A', fillOpacity: 1, interactive: false }).addTo(layer); });
        if (ll.length > 2) { var c = L.polygon(ll).getBounds().getCenter(); tag([c.lat, c.lng], label); }
      } else {
        ll.forEach(function (p) { L.circleMarker(p, { radius: 9, color: '#FAFAF7', weight: 2.5, fillColor: '#243C35', fillOpacity: .55, interactive: false }).addTo(layer); L.circleMarker(p, { radius: 2.5, color: '#FAFAF7', weight: 0, fillColor: '#FAFAF7', fillOpacity: 1, interactive: false }).addTo(layer); });
        if (ll.length) tag(ll[ll.length - 1], label);
      }
    });
  }
  map.on('click', function (e) {
    if (S.step === 0) { setPin(e.latlng); return; }
    if (S.step !== 1) return;
    if (!S.cur) S.cur = S.mode === 'hedge' ? { type: 'hedge', pts: [], height: '', sides: ['Top', 'Street side'], cond: '' } : S.mode === 'lawn' ? { type: 'lawn', pts: [], mowing: '' } : { type: 'trees', pts: [], size: '' };
    S.cur.pts.push({ lat: e.latlng.lat, lng: e.latlng.lng });
    draw(); tools(); render();
  });
  function setPin(ll) {
    S.pin = { lat: ll.lat, lng: ll.lng };
    if (!pinMarker) { pinMarker = L.marker(ll, { draggable: true, icon: pinIcon }).addTo(map); pinMarker.on('dragend', function () { var p = pinMarker.getLatLng(); S.pin = { lat: p.lat, lng: p.lng }; }); }
    else pinMarker.setLatLng(ll);
    render();
  }
  function finishCur() { if (!S.cur) return; if (S.cur.pts.length >= KINDS[S.cur.type].min) S.shapes.push(S.cur); S.cur = null; draw(); }
  function tools() {
    var t = $('#tools'), h = $('#hint'), k = KINDS[S.cur ? S.cur.type : S.mode];
    t.hidden = S.step !== 1 || !S.cur;
    $('#finish').textContent = k.finish;
    $('#finish').disabled = !S.cur || S.cur.pts.length < k.min;
    $('#undo').textContent = S.cur && S.cur.type === 'trees' ? 'Undo tree' : 'Undo point';
    h.hidden = S.step > 1;
    h.textContent = S.step === 0 ? (S.pin ? 'Drag the pin onto the house if it’s not quite right.' : 'Search your address, or tap the map to drop a pin.') : k.how;
  }
  $('#undo').onclick = function () { if (!S.cur) return; S.cur.pts.pop(); if (!S.cur.pts.length) S.cur = null; draw(); tools(); render(); };
  $('#finish').onclick = function () { finishCur(); tools(); render(); };

  // ---------- the steps ----------
  function opts(name, list, cur, many) { return '<div class="opts' + (many ? '' : ' one') + '" data-name="' + name + '">' + list.map(function (o) { var on = many ? cur.indexOf(o) >= 0 : cur === o; return '<button type="button" data-v="' + esc(o) + '" class="' + (on ? 'on' : '') + '">' + esc(o) + '</button>'; }).join('') + '</div>'; }
  function valid() {
    if (S.step === 0) return !!S.pin;
    if (S.step === 1) return S.shapes.length > 0 || !!(S.cur && S.cur.pts.length >= KINDS[S.cur.type].min) || S.skip;
    if (S.step === 2) return S.skip && !S.shapes.length ? S.describe.trim().length > 3 : S.shapes.every(function (x) { return x.type === 'hedge' ? x.height && x.cond : x.type === 'trees' ? !!x.size : true; });
    if (S.step === 4) return !!(S.name.trim() && (S.phone.trim() || S.email.trim()));
    return true;
  }
  function render() {
    var el = $('#step'), h = '';
    $$('#prog li').forEach(function (li) { var s = +li.getAttribute('data-s'); li.classList.toggle('on', s === S.step); li.classList.toggle('done', s < S.step); });
    if (S.step === 0) {
      h = '<p class="label">01 — The property</p><h2>Find your property.</h2><p class="lede">Search the address, then check the pin sits on the house.</p>' +
        '<label class="mfield">Address<input id="m-addr" value="' + esc(S.address) + '" placeholder="Start typing your street" autocomplete="off"><div class="suggest" id="m-sug" hidden></div></label>' +
        (S.pin ? '<p class="mnote">Pin placed' + (S.suburb ? ' · ' + esc(S.suburb) : '') + '. Drag it if it isn’t on the house.</p>' : '');
    } else if (S.step === 1) {
      var t = totals();
      h = '<p class="label">02 — Draw</p><h2>Show us what needs doing.</h2><p class="lede">Pick what to draw, then tap on the map.</p>' +
        '<div class="mmodes" id="m-modes">' + Object.keys(KINDS).map(function (k) { return '<button type="button" data-mode="' + k + '" class="' + (S.mode === k ? 'on' : '') + '"><i class="mi-' + k + '"></i>' + esc(KINDS[k].plural) + '</button>'; }).join('') + '</div>' +
        '<p class="mhow">' + esc(KINDS[S.mode].how) + '</p>' +
        '<div class="mlist">' + (S.shapes.length ? S.shapes.map(function (x, i) { return '<div class="mrow"><span class="mletter mi-' + x.type + '"></span><span class="grow">' + esc(nameOf(x)) + '<small>' + esc(size(x)) + '</small></span><button type="button" class="mx" data-del="' + i + '" aria-label="Remove ' + esc(nameOf(x)) + '">Remove</button></div>'; }).join('') : '<p class="mempty">Nothing drawn yet.</p>') + '</div>' +
        (S.shapes.length ? '<div class="mtotals">' + (t.lm ? '<p><span>Hedge</span><b>' + Math.round(t.lm) + ' LM</b></p>' : '') + (t.m2 ? '<p><span>Lawn</span><b>' + Math.round(t.m2) + ' M²</b></p>' : '') + (t.trees ? '<p><span>Trees</span><b>' + t.trees + '</b></p>' : '') + '</div>' : '') +
        '<button type="button" class="mskip" id="m-skip">' + (S.skip ? '✓ I’ll describe it instead' : 'Can’t see it clearly? Describe it instead') + '</button>';
    } else if (S.step === 2) {
      h = '<p class="label">03 — Details</p><h2>A little more about each.</h2>';
      if (S.skip && !S.shapes.length) h += '<label class="mfield">Describe the work<textarea id="m-desc" rows="5" placeholder="e.g. Cypress along the front fence, about 30 m long and 3 m high; back lawn; two gums to prune">' + esc(S.describe) + '</textarea></label>';
      else h += S.shapes.map(function (x, i) {
        var head = '<div class="mhh"><span class="mletter mi-' + x.type + '"></span><b>' + esc(nameOf(x)) + '</b><small>' + esc(size(x)) + '</small></div>';
        if (x.type === 'hedge') return '<div class="mhedge" data-i="' + i + '">' + head + '<p class="mlab">Height</p>' + opts('height', HEIGHTS, x.height) + '<p class="mlab">Faces to cut</p>' + opts('sides', SIDES, x.sides, true) + '<p class="mlab">Condition</p>' + opts('cond', CONDS, x.cond) + '</div>';
        if (x.type === 'lawn') return '<div class="mhedge" data-i="' + i + '">' + head + '<p class="mlab">Mowing <small>optional</small></p>' + opts('mowing', MOWING, x.mowing) + '</div>';
        return '<div class="mhedge" data-i="' + i + '">' + head + '<p class="mlab">Tree size</p>' + opts('size', TREE_SIZES, x.size) + '</div>';
      }).join('');
    } else if (S.step === 3) {
      h = '<p class="label">04 — Access</p><h2>Access and clean-up.</h2>' +
        '<p class="mlab">Getting in</p>' + opts('access', ACCESS, S.access, true) +
        '<p class="mlab">Green waste</p>' + opts('waste', ['Take it away', 'Leave on site'], S.waste) +
        '<p class="mlab">Photographs <small>optional · up to 3</small></p><label class="photo"><input type="file" id="m-photos" accept="image/*" multiple><span>Add photographs</span></label><div class="thumbs" id="m-thumbs"></div>' +
        '<label class="mfield">Anything else?<textarea id="m-notes" rows="3" placeholder="Gate codes, dogs, timing">' + esc(S.notes) + '</textarea></label>';
    } else if (S.step === 4) {
      var tt = totals(), parts = [tt.lm ? Math.round(tt.lm) + ' LM hedge' : '', tt.m2 ? Math.round(tt.m2) + ' m² lawn' : '', tt.trees ? tt.trees + ' tree' + (tt.trees === 1 ? '' : 's') : ''].filter(Boolean);
      h = '<p class="label">05 — Contact</p><h2>Where should we send the quote?</h2>' +
        '<label class="mfield">Name<input id="m-name" autocomplete="name" value="' + esc(S.name) + '"></label>' +
        '<label class="mfield">Phone<input id="m-phone" type="tel" inputmode="tel" autocomplete="tel" value="' + esc(S.phone) + '"></label>' +
        '<label class="mfield">Email<input id="m-email" type="email" autocomplete="email" value="' + esc(S.email) + '"></label>' +
        '<p class="mlab">Preferred contact</p>' + opts('contact', ['Call', 'Text', 'Email'], S.contact) +
        '<div class="msum"><span>' + esc(S.address || 'Pinned property') + '</span><span>' + esc(parts.join(' · ') || 'Described in notes') + '</span></div>' +
        '<p class="err" id="m-err"></p>';
    }
    el.innerHTML = h; el.scrollTop = 0;
    var panel = $('#panel'), low = S.step === 1 && window.innerWidth <= 860; // phones: the panel drops down while drawing
    if (panel.dataset.lowFor !== String(S.step)) { panel.dataset.lowFor = String(S.step); panel.classList.toggle('low', low); setTimeout(function () { map.invalidateSize(); }, 320); }
    $('#back').style.visibility = S.step ? 'visible' : 'hidden';
    $('#next').textContent = S.step === 4 ? 'Request a quote' : 'Continue';
    $('#next').disabled = !valid();
    wire(); tools();
  }
  function wire() {
    var a = $('#m-addr');
    if (a) { SM.addressInput(a, $('#m-sug'), function (p) { S.address = p.address; S.suburb = p.suburb || ''; map.setView([p.lat, p.lng], 19); setPin({ lat: p.lat, lng: p.lng }); }); a.addEventListener('input', function () { S.address = a.value; }); }
    var modes = $('#m-modes'); if (modes) modes.onclick = function (e) { var b = e.target.closest('[data-mode]'); if (!b) return; finishCur(); S.mode = b.getAttribute('data-mode'); render(); };
    $$('[data-del]').forEach(function (b) { b.onclick = function () { S.shapes.splice(+b.getAttribute('data-del'), 1); draw(); render(); }; });
    var sk = $('#m-skip'); if (sk) sk.onclick = function () { S.skip = !S.skip; render(); };
    $$('.opts[data-name]').forEach(function (box) {
      box.addEventListener('click', function (e) {
        var b = e.target.closest('[data-v]'); if (!b) return;
        var key = box.getAttribute('data-name'), v = b.getAttribute('data-v'), card = box.closest('.mhedge'), tgt = card ? S.shapes[+card.getAttribute('data-i')] : S;
        if (Array.isArray(tgt[key])) { var i = tgt[key].indexOf(v); if (i >= 0) tgt[key].splice(i, 1); else tgt[key].push(v); b.classList.toggle('on'); }
        else { tgt[key] = tgt[key] === v && key === 'mowing' ? '' : v; $$('[data-v]', box).forEach(function (x) { x.classList.toggle('on', x === b && tgt[key] === v); }); }
        $('#next').disabled = !valid();
      });
    });
    [['m-desc', 'describe'], ['m-notes', 'notes'], ['m-name', 'name'], ['m-phone', 'phone'], ['m-email', 'email']].forEach(function (p) { var i = $('#' + p[0]); if (i) i.addEventListener('input', function () { S[p[1]] = i.value; $('#next').disabled = !valid(); }); });
    var ph = $('#m-photos'); if (ph) { var list = SM.photoPicker(ph, $('#m-thumbs'), 3); list.push.apply(list, photos.splice(0)); photos = list; redrawThumbs(); }
  }
  function redrawThumbs() { var t = $('#m-thumbs'); if (t) t.innerHTML = photos.map(function (p, i) { return '<span style="background-image:url(' + p.url + ')"><button type="button" data-x="' + i + '" aria-label="Remove photo">✕</button></span>'; }).join(''); }

  $('#back').onclick = function () { if (S.step > 0) { S.step--; render(); } };
  $('#next').onclick = function () {
    if (!valid()) return;
    if (S.step === 1) finishCur();
    if (S.step < 4) {
      S.step++; render();
      if (S.step === 1 && S.pin) map.setView([S.pin.lat, S.pin.lng], Math.max(map.getZoom(), 19), { animate: false });
      if (S.step === 2 && S.shapes.length) map.fitBounds(L.featureGroup(layer.getLayers()).getBounds().pad(0.3));
      return;
    }
    submit();
  };

  // ---------- sending: a written summary for people, the shapes themselves for the quote ----------
  function geometryOf(x) {
    var c = x.pts.map(function (p) { return [+p.lng.toFixed(7), +p.lat.toFixed(7)]; });
    if (x.type === 'hedge') return { type: 'LineString', coordinates: c };
    if (x.type === 'lawn') return { type: 'Polygon', coordinates: [c.concat([c[0]])] };
    return { type: 'MultiPoint', coordinates: c };
  }
  function summary() {
    var lines = [], t = totals(), parts = [];
    if (t.lm) parts.push(of('hedge').length + ' hedge' + (of('hedge').length === 1 ? '' : 's') + ' (' + Math.round(t.lm) + ' m)');
    if (t.m2) parts.push(of('lawn').length + ' lawn' + (of('lawn').length === 1 ? '' : 's') + ' (' + Math.round(t.m2) + ' m²)');
    if (t.trees) parts.push(t.trees + ' tree' + (t.trees === 1 ? '' : 's') + ' to prune');
    if (parts.length) lines.push('Mapped on the website — ' + parts.join(', ') + '.');
    S.shapes.forEach(function (x) {
      if (x.type === 'hedge') lines.push(nameOf(x) + ': ' + size(x) + ' · ' + x.height + ' high · ' + (x.sides.length ? x.sides.join(', ').toLowerCase() : 'faces not set') + ' · ' + x.cond.toLowerCase());
      else if (x.type === 'lawn') lines.push(nameOf(x) + ': ' + size(x) + (x.mowing ? ' · ' + x.mowing.toLowerCase() : ''));
      else lines.push(nameOf(x) + ': ' + size(x) + ' · ' + x.size.toLowerCase());
    });
    if (!S.shapes.length && S.describe) lines.push('Described: ' + S.describe.trim());
    if (S.access.length) lines.push('Access: ' + S.access.join(', ').toLowerCase() + '.');
    lines.push('Green waste: ' + S.waste.toLowerCase() + '.');
    if (S.notes.trim()) lines.push('Notes: ' + S.notes.trim());
    return lines.join('\n');
  }
  function submit() {
    var btn = $('#next'), err = $('#m-err'); btn.disabled = true; btn.textContent = 'Sending…';
    var services = [];
    if (of('hedge').length) services.push(of('hedge').some(function (h) { return h.cond === 'Needs reducing'; }) ? 'Hedge reductions' : 'Hedge cutting');
    if (of('lawn').length) services.push('Lawn mowing');
    if (of('trees').length) services.push('Tree pruning');
    if (S.waste === 'Take it away') services.push('Green waste');
    var shapes = S.shapes.map(function (x) {
      return { type: x.type, name: nameOf(x), geometry: geometryOf(x), length: x.type === 'hedge' ? Math.round(lenOf(x.pts) * 10) / 10 : null, area: x.type === 'lawn' ? Math.round(areaOf(x.pts) * 10) / 10 : null,
        height: x.height || '', sides: x.sides || [], cond: x.cond || '', size: x.size || (x.mowing || '') };
    });
    var body = { name: S.name.trim(), phone: S.phone.trim(), email: S.email.trim(), address: S.address, suburb: S.suburb, message: summary(), services: services, contact: S.contact, lat: S.pin.lat, lng: S.pin.lng, shapes: shapes };
    SM.sendEnquiry(body, photos).then(function () {
      var t = totals(), parts = [t.lm ? Math.round(t.lm) + ' LM of hedge' : '', t.m2 ? Math.round(t.m2) + ' m² of lawn' : '', t.trees ? t.trees + ' tree' + (t.trees === 1 ? '' : 's') : ''].filter(Boolean);
      $('#step').innerHTML = SM.thanks(S.name, S.contact === 'Email' ? 'email' : S.contact === 'Text' ? 'text' : 'call') + (parts.length ? '<p class="mnote">Your drawing (' + esc(parts.join(', ')) + ') came through with your enquiry.</p>' : '') + '<a class="btn line" href="/">Back to Seedsmans</a>';
      $('.mnav').hidden = true; $('#tools').hidden = true; $('#hint').hidden = true;
      $$('#prog li').forEach(function (li) { li.classList.add('done'); li.classList.remove('on'); });
    }).catch(function (x) { if (err) err.textContent = x.message; btn.disabled = false; btn.textContent = 'Request a quote'; });
  }

  $('#grab').addEventListener('click', function () { $('#panel').classList.toggle('low'); setTimeout(function () { map.invalidateSize(); }, 300); });
  render();
})();
