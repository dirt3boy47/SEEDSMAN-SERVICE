/* Seedsman — the GeoCanvas measure tool (js/measure.js), cut down for measuring hedges.
   Line: tap points along the hedge, or turn on Freehand and trace it (curved hedges).
   Area: tap the corners of the hedge's outline from above, or trace it; it closes itself.
   Drag a point to move it. Undo removes the last tapped point or the whole last traced stretch.
   Freehand: one finger, the mouse or a pencil traces; two fingers still move and zoom the map. */
(function () {
  'use strict';
  var Geo = window.Geo;
  var M = { on: false, mode: 'line', free: false, pts: [], trace: null, lastTrace: 0, done: null, cancel: null };
  var map, group, $ = function (id) { return document.getElementById(id); };
  var LINE = { color: '#ffd400', weight: 3, opacity: 1, dashArray: '8 6', interactive: false };
  var CASING = { color: '#000', weight: 6, opacity: 0.45, interactive: false };

  function fmtLen(m) { return (m >= 100 ? m.toFixed(1) : m.toFixed(2)) + ' m'; }
  function fmtArea(a) { return a.toFixed(a >= 100 ? 0 : 1) + ' m²'; }
  function lls() { return M.pts.map(function (p) { return p.ll; }); }
  function stats() {
    var l = lls(), s = { n: l.length, length: Geo.pathLength(l) };
    if (M.mode === 'area' && l.length >= 3) { s.area = Geo.ringArea(l); s.perimeter = Geo.perimeter(l); var b = Geo.bandSize(s.area, s.perimeter); s.bandLength = b.length; s.bandDepth = b.depth; }
    return s;
  }

  function render() {
    group.clearLayers();
    var l = lls(), s = stats();
    if (M.mode === 'area' && l.length >= 3) {
      group.addLayer(L.polygon(l, Object.assign({}, CASING, { fill: false })));
      group.addLayer(L.polygon(l, Object.assign({}, LINE, { fillColor: '#ffd400', fillOpacity: 0.18 })));
    } else if (l.length >= 2) {
      group.addLayer(L.polyline(l, CASING)); group.addLayer(L.polyline(l, LINE));
    }
    M.pts.forEach(function (p, i) {
      var end = i === 0 || i === M.pts.length - 1;
      if (!p.h && !end) return; // traced points: only the ends get handles
      var mk = L.marker(p.ll, { draggable: true, keyboard: false, zIndexOffset: 1000,
        icon: L.divIcon({ className: 'ms-vertex' + (i === 0 ? ' first' : ''), iconSize: [18, 18], iconAnchor: [9, 9] }) });
      mk.on('drag', function () { p.ll = mk.getLatLng(); group.eachLayer(function (x) { if (x instanceof L.Polyline) x.setLatLngs(lls()); }); update(); });
      mk.on('dragend', function () { M.lastTrace = Date.now(); render(); });
      group.addLayer(mk);
    });
    if (l.length >= 2) {
      var area = M.mode === 'area' && l.length >= 3;
      group.addLayer(L.marker(area ? L.polygon(l).getBounds().getCenter() : l[l.length - 1], { interactive: false, keyboard: false,
        icon: L.divIcon({ className: 'ms-label' + (area ? ' mid' : ''), iconSize: null, html: '<span>' + (area ? fmtArea(s.area) : fmtLen(s.length)) + '</span>' }) }));
    }
    update();
  }
  function update() {
    var s = stats(), rows;
    if (M.mode === 'line') rows = [['Length', s.n >= 2 ? fmtLen(s.length) : '—']];
    else rows = [['Area (top)', s.area != null ? fmtArea(s.area) : '—'], ['Length × depth', s.area != null ? fmtLen(s.bandLength) + ' × ' + fmtLen(s.bandDepth) : '—']];
    rows.push(['Points', String(s.n)]);
    $('ms-out').innerHTML = rows.map(function (r, i) { return '<div class="ms-row' + (i ? '' : ' big') + '"><span>' + r[0] + '</span><b>' + r[1] + '</b></div>'; }).join('');
    $('ms-hint').textContent = M.free
      ? 'Trace along the hedge with one finger, the mouse or a pencil. Two fingers move the map. Taps add straight bits.'
      : (M.mode === 'area' ? 'Tap the corners of the hedge seen from above. Drag a point to move it.' : 'Tap along the hedge to add points. Drag a point to move it.');
    $('ms-undo').disabled = $('ms-clear').disabled = !M.pts.length;
    $('ms-done').disabled = M.mode === 'area' ? M.pts.length < 3 : M.pts.length < 2;
    Array.prototype.forEach.call($('ms-mode').children, function (b) { b.classList.toggle('on', b.getAttribute('data-m') === M.mode); });
    $('ms-free').checked = M.free;
  }

  // ---------- input ----------
  function onClick(e) {
    if (!M.on) return;
    if (Date.now() - M.lastTrace < 450) return; // the click that ends a trace or a handle drag
    M.pts.push({ ll: e.latlng, h: true, cut: true });
    render();
  }
  function inMap(e) { var t = e.target; return map.getContainer().contains(t) && !(t.closest && (t.closest('.leaflet-control') || t.closest('.leaflet-marker-icon'))); }
  function cp(e) { var r = map.getContainer().getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; }
  var touches = {};
  function onDown(e) {
    if (e.pointerType === 'touch') touches[e.pointerId] = true;
    if (M.trace && Object.keys(touches).length > 1) { cancelTrace(); return; } // second finger: pinch the map instead
    if (!M.on || !M.free || !inMap(e) || (e.pointerType === 'mouse' && e.button !== 0) || Object.keys(touches).length > 1) return;
    if (e.pointerType !== 'touch') { e.stopPropagation(); e.preventDefault(); }
    M.trace = { id: e.pointerId, start: M.pts.length, cps: [cp(e)], moved: false };
  }
  function onMove(e) {
    var t = M.trace; if (!t || e.pointerId !== t.id) return;
    if (e.pointerType !== 'touch') { e.stopPropagation(); e.preventDefault(); }
    var evs = (e.getCoalescedEvents && e.getCoalescedEvents()) || []; if (!evs.length) evs = [e];
    evs.forEach(function (ev) { var p = cp(ev), q = t.cps[t.cps.length - 1]; if (Math.hypot(p[0] - q[0], p[1] - q[1]) >= 2.5) { t.cps.push(p); t.moved = true; } });
    if (!t.moved) return;
    M.pts.length = t.start;
    t.cps.forEach(function (p, i) { M.pts.push({ ll: map.containerPointToLatLng(L.point(p[0], p[1])), h: false, cut: i === 0 }); });
    render();
  }
  function onUp(e) {
    if (e && e.pointerType === 'touch') delete touches[e.pointerId];
    var t = M.trace; if (!t || (e && e.pointerId !== t.id)) return;
    M.trace = null;
    if (!t.moved) return; // a tap: the map's click handler adds the point
    M.lastTrace = Date.now();
    var simple = Geo.simplify(t.cps, 1); // remove hand jitter (under 1 px) without shortening real bends
    M.pts.length = t.start;
    simple.forEach(function (p, i) { M.pts.push({ ll: map.containerPointToLatLng(L.point(p[0], p[1])), h: false, cut: i === 0 }); });
    render();
  }
  function cancelTrace() { var t = M.trace; if (!t) return; M.trace = null; M.pts.length = t.start; render(); }

  function setFree(v) { M.free = v; if (v) map.dragging.disable(); else map.dragging.enable(); update(); }
  function finish(ok) {
    var s = stats(), cb = ok ? M.done : M.cancel, result = { mode: M.mode, pts: lls(), length: s.length, area: s.area, perimeter: s.perimeter, bandLength: s.bandLength, bandDepth: s.bandDepth };
    M.on = false; M.trace = null; M.pts = [];
    group.clearLayers(); map.dragging.enable();
    document.body.classList.remove('measuring');
    $('ms-bar').hidden = true;
    if (cb) cb(result);
  }

  function init(m) {
    map = m; group = L.layerGroup().addTo(map);
    map.on('click', onClick);
    window.addEventListener('pointerdown', onDown, { capture: true, passive: false });
    window.addEventListener('pointermove', onMove, { capture: true, passive: false });
    window.addEventListener('pointerup', onUp, true);
    window.addEventListener('pointercancel', function (e) { if (e.pointerType === 'touch') delete touches[e.pointerId]; if (M.trace && e.pointerId === M.trace.id) cancelTrace(); }, true);
    $('ms-mode').onclick = function (e) { var b = e.target.closest('[data-m]'); if (!b) return; M.mode = b.getAttribute('data-m'); render(); };
    $('ms-free').onchange = function () { setFree($('ms-free').checked); };
    $('ms-undo').onclick = function () { var i = M.pts.length - 1; while (i > 0 && !M.pts[i].cut) i--; M.pts.length = Math.max(0, i); render(); };
    $('ms-clear').onclick = function () { M.pts = []; render(); };
    $('ms-cancel').onclick = function () { finish(false); };
    $('ms-done').onclick = function () { finish(true); };
  }
  /** Start measuring. o: {mode:'line'|'area', pts:[LatLng], onDone(result), onCancel()} */
  function start(o) {
    if (M.on) finish(false);
    M.on = true; M.mode = o.mode || 'line'; M.done = o.onDone; M.cancel = o.onCancel;
    M.pts = (o.pts || []).map(function (ll, i) { return { ll: L.latLng(ll.lat, ll.lng), h: o.pts.length <= 40, cut: i === 0 || o.pts.length <= 40 }; });
    document.body.classList.add('measuring');
    $('ms-bar').hidden = false;
    setFree(M.free); render();
  }
  window.Measure = { init: init, start: start, isOn: function () { return M.on; }, cancel: function () { if (M.on) finish(false); } };
})();
