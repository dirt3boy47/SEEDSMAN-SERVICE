/* Seedsmans — Map your property. Find the property on the aerial, trace each hedge, describe height, sides, condition
   and access, add photos, and request a quote. Sent to the existing public enquiry endpoint: the property pin goes in as
   the location and the traced hedges (lengths and details) go in the notes, so it arrives in the Pipeline ready to quote. */
(function () {
  'use strict';
  var $ = function (s, r) { return (r || document).querySelector(s); }, $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  var LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  var HEIGHTS = ['Under 1.5 m', '1.5 – 2.5 m', '2.5 – 4 m', 'Over 4 m'], SIDES = ['Top', 'Street side', 'Garden side', 'Ends'], CONDS = ['Kept regularly', 'Overgrown', 'Needs reducing'];
  var ACCESS = ['Open access', 'Narrow side access', 'Steep or uneven', 'Over a fence or neighbour’s side', 'Pool or delicate garden nearby'];

  var S = { step: 0, pin: null, address: '', suburb: '', hedges: [], cur: null, skip: false, describe: '', access: [], waste: 'Take it away', notes: '', name: '', phone: '', email: '', contact: 'Call' };
  var photos = [];

  // ---------- the aerial map ----------
  var map = L.map('map', { zoomControl: false, attributionControl: false, maxZoom: 21 }).setView([-38.38, 145.05], 11);
  var attribution = L.control.attribution({ position: 'topright', prefix: '<a href="https://leafletjs.com">Leaflet</a>' }).addTo(map);
  L.control.zoom({ position: 'topright' }).addTo(map);
  window.SMmap = map; // for testing
  // Google satellite only — the same Google Map Tiles imagery as the staff app — with Google's logo and imagery credit
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
  function fallback() { // only if Google can't be reached, so the page is never blank
    L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { maxNativeZoom: 19, maxZoom: 21, attribution: 'Imagery © Esri, Maxar' }).addTo(map);
  }
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

  function dist(a, b) { var R = 6371000, d = Math.PI / 180, x = Math.sin((b.lat - a.lat) * d / 2), y = Math.sin((b.lng - a.lng) * d / 2); return 2 * R * Math.asin(Math.sqrt(x * x + Math.cos(a.lat * d) * Math.cos(b.lat * d) * y * y)); }
  function lenOf(pts) { var s = 0; for (var i = 1; i < pts.length; i++) s += dist(pts[i - 1], pts[i]); return s; }
  function fmt(m) { return m < 10 ? m.toFixed(1) + ' m' : Math.round(m) + ' m'; }
  function totalLen() { return S.hedges.reduce(function (a, h) { return a + lenOf(h.pts); }, 0); }

  function drawHedges() {
    layer.clearLayers();
    S.hedges.concat(S.cur ? [S.cur] : []).forEach(function (h, i) {
      var pts = h.pts.map(function (p) { return [p.lat, p.lng]; }), isCur = h === S.cur, letter = LETTERS[isCur ? S.hedges.length : i];
      if (pts.length > 1) { L.polyline(pts, { color: '#1b2a25', weight: 8, opacity: .35, interactive: false }).addTo(layer); L.polyline(pts, { color: '#FAFAF7', weight: 3.5, dashArray: isCur ? '6 6' : null, interactive: false }).addTo(layer); }
      pts.forEach(function (p) { L.circleMarker(p, { radius: 4, color: '#FAFAF7', weight: 2, fillColor: '#243C35', fillOpacity: 1, interactive: false }).addTo(layer); });
      if (pts.length > 1) { var mid = pts[Math.floor((pts.length - 1) / 2)], nx = pts[Math.floor((pts.length - 1) / 2) + 1]; L.marker([(mid[0] + nx[0]) / 2, (mid[1] + nx[1]) / 2], { interactive: false, icon: L.divIcon({ className: 'mtag', html: '<span>' + letter + ' · ' + fmt(lenOf(h.pts)) + '</span>', iconSize: null }) }).addTo(layer); }
    });
  }
  map.on('click', function (e) {
    if (S.step === 0) { setPin(e.latlng); return; }
    if (S.step !== 1) return;
    if (!S.cur) S.cur = { pts: [], height: '', sides: ['Top', 'Street side'], cond: '' };
    S.cur.pts.push({ lat: e.latlng.lat, lng: e.latlng.lng });
    drawHedges(); tools(); if (S.step === 1) render();
  });
  function setPin(ll) {
    S.pin = { lat: ll.lat, lng: ll.lng };
    if (!pinMarker) { pinMarker = L.marker(ll, { draggable: true, icon: pinIcon }).addTo(map); pinMarker.on('dragend', function () { var p = pinMarker.getLatLng(); S.pin = { lat: p.lat, lng: p.lng }; }); }
    else pinMarker.setLatLng(ll);
    render();
  }
  function tools() {
    var t = $('#tools'), h = $('#hint');
    t.hidden = S.step !== 1 || !S.cur;
    $('#finish').disabled = !S.cur || S.cur.pts.length < 2;
    h.hidden = S.step > 1;
    h.textContent = S.step === 0 ? (S.pin ? 'Drag the pin onto the house if it’s not quite right.' : 'Search your address, or tap the map to drop a pin.') : !S.cur ? 'Tap the start of a hedge, then tap along it.' : S.cur.pts.length < 2 ? 'Now tap the next point along the hedge.' : 'Keep tapping along the hedge — Finish hedge at the end.';
  }
  $('#undo').onclick = function () { if (!S.cur) return; S.cur.pts.pop(); if (!S.cur.pts.length) S.cur = null; drawHedges(); tools(); render(); };
  $('#finish').onclick = function () { if (!S.cur || S.cur.pts.length < 2) return; S.hedges.push(S.cur); S.cur = null; drawHedges(); tools(); render(); };

  // ---------- the steps ----------
  function opts(name, list, cur, many) { return '<div class="opts' + (many ? '' : ' one') + '" data-name="' + name + '">' + list.map(function (o) { var on = many ? cur.indexOf(o) >= 0 : cur === o; return '<button type="button" data-v="' + esc(o) + '" class="' + (on ? 'on' : '') + '">' + esc(o) + '</button>'; }).join('') + '</div>'; }
  function valid() {
    if (S.step === 0) return !!S.pin;
    if (S.step === 1) return S.hedges.length > 0 || S.skip;
    if (S.step === 2) return S.skip ? S.describe.trim().length > 3 : S.hedges.every(function (h) { return h.height && h.cond; });
    if (S.step === 3) return true;
    if (S.step === 4) return S.name.trim() && (S.phone.trim() || S.email.trim());
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
      var tl = totalLen();
      h = '<p class="label">02 — Hedges</p><h2>Trace your hedges.</h2><p class="lede">Tap along each hedge on the aerial, then <b>Finish hedge</b>. Do one line per hedge.</p>' +
        '<div class="mlist">' + (S.hedges.length ? S.hedges.map(function (x, i) { return '<div class="mrow"><span class="mletter">' + LETTERS[i] + '</span><span class="grow">Hedge ' + LETTERS[i] + '<small>' + fmt(lenOf(x.pts)) + '</small></span><button type="button" class="mx" data-del="' + i + '" aria-label="Remove hedge ' + LETTERS[i] + '">Remove</button></div>'; }).join('') : '<p class="mempty">No hedges traced yet.</p>') + '</div>' +
        (S.hedges.length ? '<p class="mtotal"><span>Hedge / total</span><b>' + Math.round(tl) + ' LM</b></p>' : '') +
        '<button type="button" class="mskip" id="m-skip">' + (S.skip ? '✓ I’ll describe the hedges instead' : 'Can’t see them clearly? Describe them instead') + '</button>';
    } else if (S.step === 2) {
      h = '<p class="label">03 — Details</p><h2>Tell us about each hedge.</h2>';
      if (S.skip && !S.hedges.length) h += '<label class="mfield">Describe the hedges<textarea id="m-desc" rows="5" placeholder="e.g. Cypress along the front fence, about 30 m long and 3 m high">' + esc(S.describe) + '</textarea></label>';
      else h += S.hedges.map(function (x, i) {
        return '<div class="mhedge" data-i="' + i + '"><div class="mhh"><span class="mletter">' + LETTERS[i] + '</span><b>Hedge ' + LETTERS[i] + '</b><small>' + fmt(lenOf(x.pts)) + '</small></div>' +
          '<p class="mlab">Height</p>' + opts('height', HEIGHTS, x.height) + '<p class="mlab">Faces to cut</p>' + opts('sides', SIDES, x.sides, true) + '<p class="mlab">Condition</p>' + opts('cond', CONDS, x.cond) + '</div>';
      }).join('');
    } else if (S.step === 3) {
      h = '<p class="label">04 — Access</p><h2>Access and clean-up.</h2>' +
        '<p class="mlab">Getting to the hedges</p>' + opts('access', ACCESS, S.access, true) +
        '<p class="mlab">Green waste</p>' + opts('waste', ['Take it away', 'Leave on site'], S.waste) +
        '<p class="mlab">Photographs <small>optional · up to 3</small></p><label class="photo"><input type="file" id="m-photos" accept="image/*" multiple><span>Add photographs</span></label><div class="thumbs" id="m-thumbs"></div>' +
        '<label class="mfield">Anything else?<textarea id="m-notes" rows="3" placeholder="Gate codes, dogs, timing">' + esc(S.notes) + '</textarea></label>';
    } else if (S.step === 4) {
      h = '<p class="label">05 — Contact</p><h2>Where should we send the quote?</h2>' +
        '<label class="mfield">Name<input id="m-name" autocomplete="name" value="' + esc(S.name) + '"></label>' +
        '<label class="mfield">Phone<input id="m-phone" type="tel" inputmode="tel" autocomplete="tel" value="' + esc(S.phone) + '"></label>' +
        '<label class="mfield">Email<input id="m-email" type="email" autocomplete="email" value="' + esc(S.email) + '"></label>' +
        '<p class="mlab">Preferred contact</p>' + opts('contact', ['Call', 'Text', 'Email'], S.contact) +
        '<div class="msum"><span>' + esc(S.address || 'Pinned property') + '</span><span>' + (S.hedges.length ? S.hedges.length + ' hedge' + (S.hedges.length === 1 ? '' : 's') + ' · ' + Math.round(totalLen()) + ' LM' : 'Hedges described') + '</span></div>' +
        '<p class="err" id="m-err"></p>';
    }
    el.innerHTML = h;
    el.scrollTop = 0;
    // phones: while tracing hedges the panel drops down so most of the screen is map
    var panel = $('#panel'), low = S.step === 1 && window.innerWidth <= 860;
    if (panel.dataset.lowFor !== String(S.step)) { panel.dataset.lowFor = String(S.step); panel.classList.toggle('low', low); setTimeout(function () { map.invalidateSize(); }, 320); }
    $('#back').style.visibility = S.step ? 'visible' : 'hidden';
    $('#next').textContent = S.step === 4 ? 'Request a quote' : 'Continue';
    $('#next').disabled = !valid();
    wire(); tools();
  }
  function wire() {
    var a = $('#m-addr');
    if (a) {
      SM.addressInput(a, $('#m-sug'), function (p) { S.address = p.address; S.suburb = p.suburb || ''; map.setView([p.lat, p.lng], 19); setPin({ lat: p.lat, lng: p.lng }); });
      a.addEventListener('input', function () { S.address = a.value; });
    }
    $$('[data-del]').forEach(function (b) { b.onclick = function () { S.hedges.splice(+b.getAttribute('data-del'), 1); drawHedges(); render(); }; });
    var sk = $('#m-skip'); if (sk) sk.onclick = function () { S.skip = !S.skip; render(); };
    $$('.opts[data-name]').forEach(function (box) {
      box.addEventListener('click', function (e) {
        var b = e.target.closest('[data-v]'); if (!b) return;
        var name = box.getAttribute('data-name'), v = b.getAttribute('data-v'), hd = box.closest('.mhedge'), tgt = hd ? S.hedges[+hd.getAttribute('data-i')] : S;
        var key = { height: 'height', sides: 'sides', cond: 'cond', access: 'access', waste: 'waste', contact: 'contact' }[name];
        if (Array.isArray(tgt[key])) { var i = tgt[key].indexOf(v); if (i >= 0) tgt[key].splice(i, 1); else tgt[key].push(v); b.classList.toggle('on'); }
        else { tgt[key] = v; $$('[data-v]', box).forEach(function (x) { x.classList.toggle('on', x === b); }); }
        $('#next').disabled = !valid();
      });
    });
    [['m-desc', 'describe'], ['m-notes', 'notes'], ['m-name', 'name'], ['m-phone', 'phone'], ['m-email', 'email']].forEach(function (p) {
      var i = $('#' + p[0]); if (i) i.addEventListener('input', function () { S[p[1]] = i.value; $('#next').disabled = !valid(); });
    });
    var ph = $('#m-photos'); if (ph) { var list = SM.photoPicker(ph, $('#m-thumbs'), 3); list.push.apply(list, photos.splice(0)); photos = list; redrawThumbs(); } // keep photos added earlier
  }
  function redrawThumbs() { var t = $('#m-thumbs'); if (t) t.innerHTML = photos.map(function (p, i) { return '<span style="background-image:url(' + p.url + ')"><button type="button" data-x="' + i + '" aria-label="Remove photo">✕</button></span>'; }).join(''); }

  $('#back').onclick = function () { if (S.step > 0) { S.step--; render(); } };
  $('#next').onclick = function () {
    if (!valid()) return;
    if (S.step === 1 && S.cur && S.cur.pts.length > 1) { S.hedges.push(S.cur); S.cur = null; drawHedges(); }
    if (S.step < 4) { S.step++; render(); if (S.step === 1 && S.pin) map.setView([S.pin.lat, S.pin.lng], Math.max(map.getZoom(), 19), { animate: false }); if (S.step === 2 && S.hedges.length) map.fitBounds(L.featureGroup(layer.getLayers()).getBounds().pad(0.3)); return; }
    submit();
  };

  function summary() {
    var lines = [];
    if (S.hedges.length) {
      lines.push('Mapped on the website — ' + S.hedges.length + ' hedge' + (S.hedges.length === 1 ? '' : 's') + ', about ' + Math.round(totalLen()) + ' m in total.');
      S.hedges.forEach(function (x, i) { lines.push(LETTERS[i] + ': ' + fmt(lenOf(x.pts)) + ' · ' + x.height + ' high · ' + (x.sides.length ? x.sides.join(', ').toLowerCase() : 'faces not set') + ' · ' + x.cond.toLowerCase()); });
    } else if (S.describe) lines.push('Hedges (described): ' + S.describe.trim());
    if (S.access.length) lines.push('Access: ' + S.access.join(', ').toLowerCase() + '.');
    lines.push('Green waste: ' + S.waste.toLowerCase() + '.');
    if (S.notes.trim()) lines.push('Notes: ' + S.notes.trim());
    return lines.join('\n');
  }
  function submit() {
    var btn = $('#next'), err = $('#m-err'); btn.disabled = true; btn.textContent = 'Sending…';
    var services = [S.hedges.some(function (h) { return h.cond === 'Needs reducing'; }) ? 'Hedge reductions' : 'Hedge cutting'];
    if (S.waste === 'Take it away') services.push('Green waste');
    var body = { name: S.name.trim(), phone: S.phone.trim(), email: S.email.trim(), address: S.address, suburb: S.suburb, message: summary(), services: services, contact: S.contact, lat: S.pin.lat, lng: S.pin.lng };
    SM.sendEnquiry(body, photos).then(function () {
      $('#step').innerHTML = SM.thanks(S.name, S.contact === 'Email' ? 'email' : S.contact === 'Text' ? 'text' : 'call') + '<p class="mnote">Your traced hedges (' + Math.round(totalLen()) + ' LM) came through with your enquiry.</p><a class="btn line" href="/">Back to Seedsmans</a>';
      $('.mnav').hidden = true; $('#tools').hidden = true; $('#hint').hidden = true;
      $$('#prog li').forEach(function (li) { li.classList.add('done'); li.classList.remove('on'); });
    }).catch(function (x) { if (err) err.textContent = x.message; btn.disabled = false; btn.textContent = 'Request a quote'; });
  }

  // phones: the panel is a sheet that can be pulled down to see more of the map
  $('#grab').addEventListener('click', function () { $('#panel').classList.toggle('low'); setTimeout(function () { map.invalidateSize(); }, 300); });
  render();
})();
