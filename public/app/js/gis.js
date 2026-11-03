/* Seedsman Quote — GIS component with GeoCanvas map controls.
   Aerial/street basemaps, address search, GPS, fullscreen, property pins, saved shapes, and the GeoCanvas
   measure tool (Line / Area / Point, tap or freehand trace, draggable points, undo). */
(function () {
  'use strict';
  var Geo = window.Geo, icon = App.icon, esc = App.esc;
  var ESRI = 'https://server.arcgisonline.com/ArcGIS/rest/services/';
  var ROADS = { url: ESRI + 'Reference/World_Transportation/MapServer/tile/{z}/{y}/{x}', o: { maxNativeZoom: 19, attribution: 'Roads © Esri' } };
  // Vicmap Basemaps aerial (WMTS, Web Mercator 256 px). A licensed service: it falls back to world imagery if it doesn't load.
  var VIC = { url: 'https://base.maps.vic.gov.au/service?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=AERIAL_WM_256&STYLE=default&FORMAT=image/png&TILEMATRIXSET=EPSG:3857:256&TILEMATRIX=EPSG:3857:256:{z}&TILEROW={y}&TILECOL={x}', o: { maxNativeZoom: 20, attribution: 'Imagery © State of Victoria (Vicmap)' }, watch: true };
  var WORLD = { url: ESRI + 'World_Imagery/MapServer/tile/{z}/{y}/{x}', o: { maxNativeZoom: 19, attribution: 'Imagery © Esri, Maxar, Earthstar Geographics' } };
  var CLARITY = { url: 'https://clarity.maptiles.arcgis.com/arcgis/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', o: { maxNativeZoom: 20, attribution: 'Imagery © Esri (Clarity), Maxar' }, watch: true };
  var OSM = { url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png', o: { maxNativeZoom: 19, attribution: '© OpenStreetMap contributors' } };
  var BASEMAPS = {}, DEFAULT_BASE = 'world';
  /** Build the imagery list; subscription imagery (Nearmap, MetroMap) appears when its API key is set in Settings. */
  function configure(im) {
    im = im || {};
    BASEMAPS = {};
    if (im.nearmapKey) BASEMAPS.nearmap = { label: 'Nearmap (latest, high detail)', layers: [{ url: 'https://api.nearmap.com/tiles/v3/Vert/{z}/{x}/{y}.jpg?apikey=' + encodeURIComponent(im.nearmapKey), o: { maxNativeZoom: 21, attribution: 'Imagery © Nearmap' }, watch: true }, ROADS] };
    if (im.metromapKey) BASEMAPS.metromap = { label: 'MetroMap (latest, high detail)', layers: [{ url: 'https://api-v3.metromap.com.au/tiles/xyz/' + encodeURIComponent(im.metromapLayer || 'Australia_latest') + '/{z}/{y}/{x}.png?key=' + encodeURIComponent(im.metromapKey), o: { maxNativeZoom: 22, attribution: 'Imagery © MetroMap (Aerometrex)' }, watch: true }, ROADS] };
    if (im.googleKey) BASEMAPS.google = { label: 'Google satellite', google: im.googleKey, layers: [] };
    BASEMAPS.clarity = { label: 'Satellite HD (Esri Clarity)', layers: [CLARITY, ROADS] };
    BASEMAPS.world = { label: 'Satellite (Esri)', layers: [WORLD, ROADS] };
    BASEMAPS.vic = { label: 'Vicmap aerial (VIC, licensed)', layers: [VIC, ROADS] };
    BASEMAPS.street = { label: 'Street map', layers: [OSM] };
    DEFAULT_BASE = BASEMAPS[im.default] ? im.default : BASEMAPS.nearmap ? 'nearmap' : BASEMAPS.metromap ? 'metromap' : BASEMAPS.google ? 'google' : 'world';
  }
  configure(null);

  // Google Map Tiles API (2D satellite with roads and labels): one session token, reused until it expires (about two weeks).
  var GTILES = 'https://tile.googleapis.com';
  var gSessionP = {};
  function googleSession(key) {
    try {
      var c = JSON.parse(localStorage.getItem('seedsman-gsession') || 'null');
      if (c && c.key === key && c.expiry * 1000 > Date.now() + 3600000) return Promise.resolve(c.session);
    } catch (e) { /* no storage */ }
    if (gSessionP[key]) return gSessionP[key];
    gSessionP[key] = fetch(GTILES + '/v1/createSession?key=' + encodeURIComponent(key), { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mapType: 'satellite', language: 'en-AU', region: 'AU', layerTypes: ['layerRoadmap'], overlay: false }) })
      .then(function (r) { return r.json().then(function (d) { if (!r.ok || !d.session) throw new Error((d.error && d.error.message) || 'Google satellite is not available with this key'); return d; }); })
      .then(function (d) { try { localStorage.setItem('seedsman-gsession', JSON.stringify({ key: key, session: d.session, expiry: +d.expiry || Date.now() / 1000 + 86400 })); } catch (e) { /* ignore */ } return d.session; })
      .catch(function (e) { delete gSessionP[key]; throw e; });
    return gSessionP[key];
  }
  var START = { lat: -38.33, lng: 145.03, zoom: 12 }; // Mornington Peninsula
  var LIVE = { color: '#ffd400', weight: 3, opacity: 1, dashArray: '8 6', interactive: false };
  var CASING = { color: '#000', weight: 6, opacity: 0.45, interactive: false };

  function isPt(m) { return m === 'point' || m === 'points'; }
  function toLatLngs(g) {
    if (!g) return [];
    if (g.type === 'Point') return [L.latLng(g.coordinates[1], g.coordinates[0])];
    if (g.type === 'MultiPoint') return g.coordinates.map(function (p) { return L.latLng(p[1], p[0]); });
    var c = g.type === 'Polygon' ? g.coordinates[0].slice(0, -1) : g.coordinates;
    return c.map(function (p) { return L.latLng(p[1], p[0]); });
  }
  function toGeo(mode, lls) {
    var r = function (ll) { return [Math.round(ll.lng * 1e7) / 1e7, Math.round(ll.lat * 1e7) / 1e7]; };
    if (mode === 'point') return { type: 'Point', coordinates: r(lls[0]) };
    if (mode === 'points') return { type: 'MultiPoint', coordinates: lls.map(r) };
    var c = lls.map(r);
    return mode === 'area' ? { type: 'Polygon', coordinates: [c.concat([c[0]])] } : { type: 'LineString', coordinates: c };
  }
  function modeOf(g) { return !g ? null : g.type === 'Polygon' ? 'area' : g.type === 'Point' ? 'point' : g.type === 'MultiPoint' ? 'points' : 'line'; }
  function fmtLen(m) { return m >= 1000 ? (m / 1000).toFixed(2) + ' km' : (m >= 100 ? m.toFixed(1) : m.toFixed(2)) + ' m'; }
  function fmtArea(a) { return a >= 10000 ? (a / 10000).toFixed(3) + ' ha' : a.toFixed(a >= 100 ? 0 : 1) + ' m²'; }
  function measureOf(g) {
    var lls = toLatLngs(g), m = modeOf(g);
    if (m === 'area') { var a = Geo.ringArea(lls), p = Geo.perimeter(lls), b = Geo.bandSize(a, p); return { area: a, perimeter: p, length: b.length, depth: b.depth }; }
    if (m === 'line') return { length: Geo.pathLength(lls) };
    return { count: lls.length };
  }
  function pinIcon(cls, ic) { return L.divIcon({ className: 'map-pin ' + (cls || ''), iconSize: [30, 30], iconAnchor: [15, 30], html: '<span>' + icon(ic || 'home') + '</span>' }); }
  function label(ll, text, cls) { return L.marker(ll, { interactive: false, keyboard: false, icon: L.divIcon({ className: 'map-label ' + (cls || ''), iconSize: null, html: '<span>' + esc(text) + '</span>' }) }); }
  function centreOf(g) { var lls = toLatLngs(g); return modeOf(g) === 'area' ? L.polygon(lls).getBounds().getCenter() : lls[Math.floor((lls.length - 1) / 2)]; }

  function search(q, map) {
    var b = map.getBounds().pad(2);
    var url = 'https://nominatim.openstreetmap.org/search?format=jsonv2&addressdetails=1&limit=6&countrycodes=au&viewbox=' +
      [b.getWest(), b.getNorth(), b.getEast(), b.getSouth()].map(function (n) { return n.toFixed(3); }).join(',') + '&q=' + encodeURIComponent(q);
    return fetch(url, { headers: { Accept: 'application/json' } }).then(function (r) { return r.json(); }).then(function (list) {
      return list.map(function (p) {
        var a = p.address || {}, street = [a.house_number, a.road].filter(Boolean).join(' ');
        return { label: p.display_name, lat: +p.lat, lng: +p.lon, address: street || p.display_name.split(', ')[0], suburb: a.suburb || a.town || a.city || a.village || '' };
      });
    });
  }

  /** opts: {toolbar, start, onShapeClick(id), onSearchPick(place), tools:[{id,icon,label}], onTool(id), interactive} */
  function create(container, opts) {
    opts = opts || {};
    container.classList.add('gis');
    container.innerHTML = '<div class="map"></div>' +
      (opts.toolbar === false ? '' :
        '<div class="gis-bar panel"><form autocomplete="off"><input type="search" placeholder="Search address or place" aria-label="Search address">' +
        '<button class="tb" type="submit">' + icon('search') + '<span>Find</span></button></form><div class="sep"></div>' +
        (opts.tools || []).map(function (t) { return '<button class="tb" type="button" data-tool="' + t.id + '" title="' + esc(t.label) + '">' + icon(t.icon) + '<span>' + esc(t.label) + '</span></button>'; }).join('') +
        '<label class="basemap tb" title="Basemap">' + icon('layers') + '<select aria-label="Basemap">' + Object.keys(BASEMAPS).map(function (k) { return '<option value="' + k + '">' + BASEMAPS[k].label + '</option>'; }).join('') + '</select></label>' +
        '<button class="tb" type="button" data-tool="gps" title="My location">' + icon('gps') + '<span>GPS</span></button>' +
        '<button class="tb" type="button" data-tool="full" title="Full screen">' + icon('expand') + '<span>Full</span></button></div>' +
        '<div class="gis-results panel" hidden></div>');
    var mapEl = container.querySelector('.map');
    var interactive = opts.interactive !== false;
    var map = L.map(mapEl, { maxZoom: 22, minZoom: 4, zoomSnap: 0.25, zoomDelta: 0.5, boxZoom: false, attributionControl: false, zoomControl: interactive && opts.toolbar !== false,
      dragging: interactive, scrollWheelZoom: interactive, doubleClickZoom: interactive, touchZoom: interactive, keyboard: interactive });
    L.control.attribution({ position: 'bottomright', prefix: false }).addTo(map);
    if (map.zoomControl) map.zoomControl.setPosition('topleft');
    var s = opts.start || START; map.setView([s.lat, s.lng], s.zoom || 15);

    // basemaps
    var baseLayers = [], sel = container.querySelector('.basemap select');
    var gAttr = null, gTimer = null, current = null;
    function googleAttribution() { // Google requires its logo and the imagery copyright for the area in view
      clearTimeout(gTimer);
      gTimer = setTimeout(function () {
        var def = BASEMAPS[current]; if (dead || !def || !def.google || !def.session) return;
        var b = map.getBounds();
        fetch(GTILES + '/tile/v1/viewport?session=' + def.session + '&key=' + encodeURIComponent(def.google) + '&zoom=' + Math.round(map.getZoom()) +
          '&north=' + b.getNorth().toFixed(5) + '&south=' + b.getSouth().toFixed(5) + '&east=' + b.getEast().toFixed(5) + '&west=' + b.getWest().toFixed(5))
          .then(function (r) { return r.json(); }).then(function (d) { if (!dead) setGoogleAttr(d.copyright || ''); }).catch(function () {});
      }, 500);
    }
    function setGoogleAttr(text) {
      if (gAttr) map.attributionControl.removeAttribution(gAttr);
      gAttr = '<b class="g-logo">Google</b>' + (text ? ' ' + esc(text) : '');
      map.attributionControl.addAttribution(gAttr);
    }
    map.on('moveend', function () { if (BASEMAPS[current] && BASEMAPS[current].google) googleAttribution(); });
    function setBase(key, auto) {
      if (!BASEMAPS[key]) key = DEFAULT_BASE;
      baseLayers.forEach(function (l) { map.removeLayer(l); }); baseLayers = [];
      if (gAttr) { map.attributionControl.removeAttribution(gAttr); gAttr = null; }
      current = key;
      if (sel) sel.value = key;
      if (!auto) { try { localStorage.setItem('seedsman-basemap', key); } catch (e) { /* ignore */ } }
      var def = BASEMAPS[key];
      if (def.google) {
        googleSession(def.google).then(function (session) {
          if (dead || current !== key) return;
          def.session = session;
          var tl = L.tileLayer(GTILES + '/v1/2dtiles/{z}/{x}/{y}?session=' + session + '&key=' + encodeURIComponent(def.google), { maxZoom: 22, maxNativeZoom: 21, keepBuffer: 4, crossOrigin: opts.print ? 'anonymous' : undefined }).addTo(map);
          tl.setZIndex(0); watch(tl); baseLayers.push(tl);
          setGoogleAttr(''); googleAttribution();
        }).catch(function (e) {
          if (dead || current !== key) return;
          try { App.post('diag', { kind: 'google-tiles', message: e.message, page: location.hash }); } catch (x) { /* ignore */ }
          App.toast('Google satellite didn’t start (' + e.message + '). Check the Map Tiles API is enabled for the key. Showing Esri satellite.', 'warn', 8000);
          setBase('world', true);
        });
        return;
      }
      def.layers.forEach(function (d, i) {
        var tl = L.tileLayer(d.url, Object.assign({ maxZoom: 22, keepBuffer: 4, crossOrigin: opts.print ? 'anonymous' : undefined }, d.o)).addTo(map);
        tl.setZIndex(i); if (d.watch) watch(tl); baseLayers.push(tl);
      });
    }
    function watch(tl) {
      var ok = 0, bad = 0, done = false;
      tl.on('tileload', function () { ok++; });
      tl.on('tileerror', function (ev) {
        bad++; if (done || ok || bad < 6 || navigator.onLine === false) return; done = true;
        try { App.post('diag', { kind: 'tiles-failed', message: current + ' tiles failed', detail: ev && ev.tile ? String(ev.tile.src).replace(/key=[^&]+/, 'key=…').replace(/apikey=[^&]+/, 'apikey=…').slice(0, 300) : '', page: location.hash }); } catch (x) { /* ignore */ }
        App.toast('That imagery isn’t loading here (check the key or subscription), so Esri satellite is shown instead.', 'warn', 6000);
        setBase('world', true);
      });
    }
    var saved = null; try { saved = localStorage.getItem('seedsman-basemap'); } catch (e) { /* ignore */ }
    setBase(opts.basemap || (BASEMAPS[saved] ? saved : DEFAULT_BASE), true);
    if (sel) sel.onchange = function () { setBase(sel.value); };

    var shapes = L.layerGroup().addTo(map), props = L.layerGroup().addTo(map), live = L.layerGroup().addTo(map), pin = null;
    var g = { map: map, el: container };

    // toolbar
    var form = container.querySelector('.gis-bar form'), results = container.querySelector('.gis-results');
    if (form) {
      form.onsubmit = function (e) {
        e.preventDefault();
        var q = form.querySelector('input').value.trim(); if (!q) return;
        results.hidden = false; results.innerHTML = '<p>Searching…</p>';
        search(q, map).then(function (list) {
          if (!list.length) { results.innerHTML = '<p>Nothing found. Try the street and suburb.</p>'; return; }
          results.innerHTML = list.map(function (p, i) { return '<button type="button" data-i="' + i + '">' + esc(p.label) + '</button>'; }).join('');
          results.onclick = function (ev) {
            var b = ev.target.closest('button'); if (!b) return;
            var p = list[+b.getAttribute('data-i')]; results.hidden = true; map.setView([p.lat, p.lng], 20);
            if (opts.onSearchPick) opts.onSearchPick(p);
          };
        }).catch(function () { results.innerHTML = '<p>Search is not available right now.</p>'; });
      };
      form.querySelector('input').addEventListener('input', function (e) { if (!e.target.value) results.hidden = true; });
    }
    container.addEventListener('click', function (e) {
      var b = e.target.closest('[data-tool]'); if (!b || !container.contains(b)) return;
      var t = b.getAttribute('data-tool');
      if (t === 'full') { container.classList.toggle('fs'); b.classList.toggle('on', container.classList.contains('fs')); setTimeout(function () { map.invalidateSize(); }, 50); return; }
      if (t === 'gps') { if (!window.isSecureContext) { App.toast('GPS needs the https:// address.', 'warn'); return; } map.locate({ setView: true, maxZoom: 19, enableHighAccuracy: true }); return; }
      if (opts.onTool) opts.onTool(t, b);
    });
    map.on('locationerror', function () { App.toast('Could not get your location.', 'warn'); });
    function onKey(e) { if (e.key === 'Escape' && container.classList.contains('fs') && !M.on) { container.classList.remove('fs'); map.invalidateSize(); } }
    document.addEventListener('keydown', onKey);

    g.setPin = function (ll, o) {
      o = o || {};
      if (pin) { map.removeLayer(pin); pin = null; }
      if (!ll) return;
      pin = L.marker(ll, { draggable: !!o.draggable, keyboard: false, zIndexOffset: 500, title: o.title || 'House', icon: pinIcon('', 'home') }).addTo(map);
      if (o.onMove) pin.on('dragend', function () { o.onMove(pin.getLatLng()); });
    };
    g.getPin = function () { return pin ? pin.getLatLng() : null; };
    /** list: [{id, lat, lng, title, sel}] */
    g.setProps = function (list, onClick) {
      props.clearLayers();
      (list || []).forEach(function (p) {
        if (p.lat == null) return;
        var mk = L.marker([p.lat, p.lng], { keyboard: false, title: p.title || '', icon: pinIcon(p.sel ? 'sel' : 'prop', 'home'), zIndexOffset: p.sel ? 400 : 0 });
        if (onClick) mk.on('click', function () { onClick(p.id); });
        props.addLayer(mk);
      });
    };
    /** list: [{id, geometry, label, color, dashed, faded}] */
    var snapPts = [];
    g.setShapes = function (list) {
      shapes.clearLayers(); snapPts = [];
      var rank = function (s) { var m = modeOf(s.geometry); return m === 'area' ? -Geo.ringArea(toLatLngs(s.geometry)) : m === 'line' ? 1e12 : 2e12; }; // points on top
      (list || []).filter(function (s) { return s.geometry; }).sort(function (a, b) { return rank(a) - rank(b); }).forEach(function (s) {
        toLatLngs(s.geometry).forEach(function (ll) { snapPts.push(ll); });
        if (!s.geometry) return;
        var lls = toLatLngs(s.geometry), m = modeOf(s.geometry), color = s.color || '#3ddc84', layer;
        if (isPt(m)) {
          layer = L.featureGroup(lls.map(function (ll) { return L.circleMarker(ll, { radius: 8, color: '#fff', weight: 2, fillColor: color, fillOpacity: 1 }); }));
        } else {
          var mk = m === 'area' ? L.polygon : L.polyline;
          shapes.addLayer(mk(lls, { color: '#000', weight: s.faded ? 5 : 8, opacity: s.faded ? 0.25 : 0.4, interactive: false, fill: false }));
          layer = mk(lls, { color: color, weight: s.faded ? 3 : 5, opacity: s.faded ? 0.7 : 1, dashArray: s.dashed ? '6 6' : null, fillColor: color, fillOpacity: m === 'area' ? (s.faded ? 0.12 : 0.25) : 0 });
        }
        if (opts.onShapeClick && s.id) layer.on('click', function (e) { if (M.on) return; L.DomEvent.stopPropagation(e); opts.onShapeClick(s.id); }); // while drawing, taps go through to the map
        shapes.addLayer(layer);
        if (s.label) shapes.addLayer(label(m === 'points' ? lls[0] : centreOf(s.geometry), s.label, m === 'area' ? 'mid' : ''));
      });
    };
    g.fit = function (extra) {
      var b = L.latLngBounds([]);
      shapes.eachLayer(function (l) { if (l.getBounds) b.extend(l.getBounds()); else if (l.getLatLng && !(l.options.icon && /map-label/.test(l.options.icon.options.className || ''))) b.extend(l.getLatLng()); });
      props.eachLayer(function (l) { b.extend(l.getLatLng()); });
      if (pin) b.extend(pin.getLatLng());
      (extra || []).forEach(function (ll) { b.extend(ll); });
      if (b.isValid()) { if (b.getNorthEast().equals(b.getSouthWest())) map.setView(b.getCenter(), 19); else map.fitBounds(b, { padding: [70, 70], maxZoom: 20 }); return true; }
      return false;
    };

    // ---------------- the measure / draw tool ----------------
    var M = { on: false, mode: 'line', modes: ['line', 'area'], free: false, pts: [], trace: null, lastTrace: 0, o: null };
    var panel = null;
    function lls() { return M.pts.map(function (p) { return p.ll; }); }
    function stats() {
      var l = lls(), st = { n: l.length };
      if (M.mode === 'area' && l.length >= 3) { st.area = Geo.ringArea(l); st.perimeter = Geo.perimeter(l); var b = Geo.bandSize(st.area, st.perimeter); st.length = b.length; st.depth = b.depth; }
      else if (!isPt(M.mode)) st.length = Geo.pathLength(l);
      return st;
    }
    function renderLive() {
      live.clearLayers();
      var l = lls(), st = stats();
      if (M.mode === 'area' && l.length >= 3) { live.addLayer(L.polygon(l, Object.assign({}, CASING, { fill: false }))); live.addLayer(L.polygon(l, Object.assign({}, LIVE, { fillColor: '#ffd400', fillOpacity: 0.18 }))); }
      else if (!isPt(M.mode) && l.length >= 2) { live.addLayer(L.polyline(l, CASING)); live.addLayer(L.polyline(l, LIVE)); }
      M.pts.forEach(function (p, i) {
        if (!isPt(M.mode) && !p.h && i !== 0 && i !== M.pts.length - 1) return;
        var mk = L.marker(p.ll, { draggable: true, keyboard: false, zIndexOffset: 1000, icon: M.mode === 'points'
          ? L.divIcon({ className: 'ms-point', iconSize: [24, 24], iconAnchor: [12, 12], html: '<span>' + (i + 1) + '</span>' })
          : L.divIcon({ className: 'ms-vertex' + (i === 0 ? ' first' : ''), iconSize: [18, 18], iconAnchor: [9, 9] }) });
        mk.on('drag', function () { p.ll = mk.getLatLng(); live.eachLayer(function (x) { if (x instanceof L.Polyline) x.setLatLngs(lls()); }); updatePanel(); });
        mk.on('dragend', function () { M.lastTrace = Date.now(); renderLive(); });
        live.addLayer(mk);
      });
      if (l.length >= 2 && !isPt(M.mode)) {
        var isArea = M.mode === 'area' && l.length >= 3;
        live.addLayer(label(isArea ? L.polygon(l).getBounds().getCenter() : l[l.length - 1], isArea ? fmtArea(st.area) : fmtLen(st.length), 'live' + (isArea ? ' mid' : '')));
      }
      updatePanel();
    }
    function updatePanel() {
      if (!panel) return;
      var st = stats(), rows = [];
      if (M.mode === 'line') rows.push(['Length', st.n >= 2 ? fmtLen(st.length) : '—']);
      if (M.mode === 'area') { rows.push(['Area', st.area != null ? fmtArea(st.area) : '—']); rows.push(['Perimeter', st.perimeter != null ? fmtLen(st.perimeter) : '—']); }
      if (M.mode === 'point') rows.push(['Point', st.n ? 'Placed' : '—']);
      if (M.mode === 'points') rows.push(['Points placed', String(st.n)]);
      if (M.mode !== 'points') rows.push(['Points', String(st.n)]);
      panel.querySelector('.ms-rows').innerHTML = rows.map(function (r, i) { return '<div class="ms-row' + (i ? '' : ' big') + '"><span>' + r[0] + '</span><b>' + r[1] + '</b></div>'; }).join('');
      panel.querySelector('.ms-hint').textContent = M.mode === 'points' ? 'Tap each tree or spot — every tap adds a point. Drag one to move it; Undo removes the last.' : M.mode === 'point' ? 'Tap the map to place the point. Drag it to move it.' : M.free
        ? 'Trace with one finger, the mouse or a pencil. Two fingers move the map. Taps add straight bits.'
        : M.mode === 'area' ? 'Tap the corners of the area — taps snap to nearby corners of other shapes. Drag a point to move it.' : 'Tap along the line to add points — taps snap to nearby corners. Drag a point to move it.';
      panel.querySelectorAll('.seg button').forEach(function (b) { b.classList.toggle('on', b.getAttribute('data-m') === M.mode); });
      panel.querySelector('.ms-free').hidden = isPt(M.mode);
      panel.querySelector('[data-a=undo]').disabled = panel.querySelector('[data-a=clear]').disabled = !M.pts.length;
      panel.querySelector('[data-a=done]').disabled = M.pts.length < (M.mode === 'area' ? 3 : M.mode === 'line' ? 2 : 1);
    }
    /** A corner of an existing shape (or of the house pin) within 12 px of the tap, so shapes can share exact corners. */
    function snap(ll) {
      var pt = map.latLngToContainerPoint(ll), best = null, bd = 12;
      snapPts.concat(pin ? [pin.getLatLng()] : []).forEach(function (c) { var d = map.latLngToContainerPoint(c).distanceTo(pt); if (d < bd) { bd = d; best = c; } });
      return best ? L.latLng(best.lat, best.lng) : null;
    }
    function onClick(e) {
      if (!M.on || Date.now() - M.lastTrace < 450) return;
      var ll = M.mode === 'points' ? e.latlng : (snap(e.latlng) || e.latlng); // separate trees never merge
      if (M.mode === 'point') M.pts = [{ ll: ll, h: true, cut: true }];
      else M.pts.push({ ll: ll, h: true, cut: true });
      renderLive();
    }
    map.on('click', onClick);
    function inMap(e) { var t = e.target; return mapEl.contains(t) && !(t.closest && (t.closest('.leaflet-control') || t.closest('.leaflet-marker-icon'))); }
    function cp(e) { var r = mapEl.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; }
    var touches = {};
    function onDown(e) {
      if (e.pointerType === 'touch') touches[e.pointerId] = true;
      if (M.trace && Object.keys(touches).length > 1) { cancelTrace(); return; }
      if (!M.on || !M.free || isPt(M.mode) || !inMap(e) || (e.pointerType === 'mouse' && e.button !== 0) || Object.keys(touches).length > 1) return;
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
      renderLive();
    }
    function onUp(e) {
      if (e && e.pointerType === 'touch') delete touches[e.pointerId];
      var t = M.trace; if (!t || (e && e.pointerId !== t.id)) return;
      M.trace = null; if (!t.moved) return;
      M.lastTrace = Date.now();
      var simple = Geo.simplify(t.cps, 1);
      M.pts.length = t.start;
      simple.forEach(function (p, i) { M.pts.push({ ll: map.containerPointToLatLng(L.point(p[0], p[1])), h: false, cut: i === 0 }); });
      renderLive();
    }
    function onCancelPtr(e) { if (e.pointerType === 'touch') delete touches[e.pointerId]; if (M.trace && e.pointerId === M.trace.id) cancelTrace(); }
    function cancelTrace() { var t = M.trace; if (!t) return; M.trace = null; M.pts.length = t.start; renderLive(); }
    window.addEventListener('pointerdown', onDown, { capture: true, passive: false });
    window.addEventListener('pointermove', onMove, { capture: true, passive: false });
    window.addEventListener('pointerup', onUp, true);
    window.addEventListener('pointercancel', onCancelPtr, true);
    function setFree(v) { M.free = v; if (v && !isPt(M.mode)) map.dragging.disable(); else map.dragging.enable(); updatePanel(); }

    function finish(ok) {
      var st = stats(), o = M.o || {}, l = lls();
      var res = ok ? { mode: M.mode, pts: l, geometry: toGeo(M.mode, l), length: st.length, area: st.area, perimeter: st.perimeter, depth: st.depth, count: l.length } : null;
      M.on = false; M.trace = null; M.pts = []; M.o = null;
      live.clearLayers(); map.dragging.enable(); if (interactive) map.doubleClickZoom.enable(); container.classList.remove('measuring');
      if (panel) { panel.remove(); panel = null; }
      if (ok && o.onDone) o.onDone(res); else if (!ok && o.onCancel) o.onCancel();
    }
    /** Start drawing. o: {mode, modes, pts, title, doneLabel, onDone(res), onCancel()} */
    g.draw = function (o) {
      if (M.on) finish(false);
      M.on = true; M.o = o; M.modes = o.modes || ['line', 'area']; M.mode = o.mode || M.modes[0];
      M.pts = (o.pts || []).map(function (ll, i) { return { ll: L.latLng(ll.lat, ll.lng), h: o.pts.length <= 40, cut: i === 0 || o.pts.length <= 40 }; });
      container.classList.add('measuring');
      panel = document.createElement('div'); panel.className = 'ms panel';
      var names = { line: ['line', 'Line'], area: ['area', 'Area'], point: ['pin', 'Point'], points: ['pin', 'Points'] };
      map.doubleClickZoom.disable(); // quick taps place points instead of zooming
      panel.innerHTML = '<div class="ms-h"><b>' + esc(o.title || 'Measure') + '</b><button class="ib sm" data-a="cancel" title="Cancel">' + icon('close') + '</button></div>' +
        (M.modes.length > 1 ? '<div class="seg">' + M.modes.map(function (m) { return '<button type="button" data-m="' + m + '">' + icon(names[m][0]) + names[m][1] + '</button>'; }).join('') + '</div>' : '') +
        '<label class="check ms-free"><input type="checkbox"> Freehand: trace a winding line or outline</label>' +
        '<div class="ms-rows"></div><p class="ms-hint"></p>' +
        '<div class="ms-btns"><button class="btn" data-a="undo">Undo</button><button class="btn" data-a="clear">Clear</button><span class="spacer"></span><button class="btn primary" data-a="done">' + icon('check') + esc(o.doneLabel || 'Use measurement') + '</button></div>';
      container.appendChild(panel);
      L.DomEvent.disableClickPropagation(panel); L.DomEvent.disableScrollPropagation(panel);
      panel.querySelector('.ms-free input').checked = M.free;
      panel.querySelector('.ms-free input').onchange = function (e) { setFree(e.target.checked); };
      panel.onclick = function (e) {
        var m = e.target.closest('[data-m]'); if (m) { M.mode = m.getAttribute('data-m'); if (M.mode === 'point') M.pts = M.pts.slice(-1); setFree(M.free); renderLive(); return; }
        var a = e.target.closest('[data-a]'); if (!a) return;
        var act = a.getAttribute('data-a');
        if (act === 'undo') { var i = M.pts.length - 1; while (i > 0 && !M.pts[i].cut) i--; M.pts.length = Math.max(0, i); renderLive(); }
        if (act === 'clear') { M.pts = []; renderLive(); }
        if (act === 'cancel') finish(false);
        if (act === 'done') finish(true);
      };
      setFree(M.free); renderLive();
    };
    g.cancelDraw = function () { if (M.on) finish(false); };
    g.isDrawing = function () { return M.on; };
    g.destroy = function () {
      window.removeEventListener('pointerdown', onDown, true); window.removeEventListener('pointermove', onMove, true);
      window.removeEventListener('pointerup', onUp, true); window.removeEventListener('pointercancel', onCancelPtr, true);
      document.removeEventListener('keydown', onKey);
      clearTimeout(gTimer);
      map.stop();
      var rm = function () { try { map.remove(); } catch (e) { /* already gone */ } };
      if (map._animatingZoom) setTimeout(rm, 320); else rm(); // let a running zoom animation finish first (Leaflet ends it on a timer)
    };
    g.invalidate = function () { setTimeout(function () { if (!dead) map.invalidateSize(); }, 30); };
    // once destroyed, late callers (replies for a page you left) are ignored
    var dead = false, destroy = g.destroy;
    Object.keys(g).forEach(function (k) { var f = g[k]; if (typeof f !== 'function') return; g[k] = function () { if (dead) return k === 'isDrawing' || k === 'fit' ? false : undefined; return f.apply(g, arguments); }; });
    var guarded = g.destroy; g.destroy = function () { if (dead) return; guarded(); dead = true; };
    void destroy;
    return g;
  }

  // ---------------- address suggestions and road distance ----------------
  var AU = '112,-44,154,-10';
  function placeFromPhoton(f) {
    var p = f.properties || {}, c = f.geometry.coordinates;
    var street = [p.housenumber, p.street || (p.housenumber ? '' : p.name)].filter(Boolean).join(' ') || p.name || '';
    var suburb = p.district || p.locality || p.city || p.county || '';
    return { label: [street, suburb, p.state, p.postcode].filter(Boolean).join(', '), address: street, suburb: suburb, state: p.state || '', postcode: p.postcode || '', lat: c[1], lng: c[0] };
  }
  /** Suggestions while typing (Photon, made for search-as-you-type over OpenStreetMap), biased towards `near`. */
  function suggest(q, near) {
    var url = 'https://photon.komoot.io/api/?limit=6&lang=en&bbox=' + AU + '&q=' + encodeURIComponent(q) + (near ? '&lat=' + near.lat.toFixed(4) + '&lon=' + near.lng.toFixed(4) : '');
    return fetch(url).then(function (r) { if (!r.ok) throw new Error('suggest'); return r.json(); }).then(function (d) {
      var seen = {};
      return (d.features || []).filter(function (f) { return (f.properties || {}).countrycode === 'AU' || !(f.properties || {}).countrycode; }).map(placeFromPhoton)
        .filter(function (p) { if (!p.address || seen[p.label]) return false; seen[p.label] = 1; return true; });
    });
  }
  function straightKm(a, b) {
    var D = Math.PI / 180, dLat = (b.lat - a.lat) * D, dLng = (b.lng - a.lng) * D;
    var h = Math.sin(dLat / 2) * Math.sin(dLat / 2) + Math.cos(a.lat * D) * Math.cos(b.lat * D) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
    return 2 * 6371 * Math.asin(Math.min(1, Math.sqrt(h)));
  }
  /** One-way driving distance and time from the app's router (Google traffic or OSRM roads, see worker routeApi). */
  /** Drive times for many legs: sent in batches of 10 (the server stays under Cloudflare's per-request limit), answers
      joined back in order. Says once per session if Google drive times aren't working, rather than failing silently. */
  var warnedGoogle = false;
  function routes(legs, geometry) {
    var chunks = [];
    for (var i = 0; i < legs.length; i += 10) chunks.push(legs.slice(i, i + 10));
    return Promise.all(chunks.map(function (c) { return App.post('route', { geometry: !!geometry, legs: c }); })).then(function (rs) {
      var bad = rs.filter(function (r) { return r.google && !r.google.ok; })[0];
      if (bad && !warnedGoogle) { warnedGoogle = true; App.toast('Google drive times aren’t working right now (' + (bad.google.error || 'no answer') + ') — using road estimates instead. Settings › Test Google keys shows more.', 'warn', 9000); }
      return { legs: [].concat.apply([], rs.map(function (r) { return r.legs || []; })) };
    });
  }
  function drive(a, b, depart) {
    var est = function () { var km = straightKm(a, b) * 1.35; return { km: km, min: km / 50 * 60, road: false }; };
    if (!window.App || !App.token()) return Promise.resolve(est());
    return routes([{ from: a, to: b, depart: depart || null }]).then(function (d) {
      var l = d.legs && d.legs[0]; if (!l) return est();
      return { km: l.km, min: l.min, low: l.low, high: l.high, road: l.source !== 'estimate', source: l.source };
    }).catch(est);
  }
  /** Turn a text input into an address field with suggestions. opts: {near(): {lat,lng}, onPick(place)} */
  function addressInput(input, opts) {
    var box = document.createElement('div'); box.className = 'addr-suggest panel'; box.hidden = true;
    input.parentNode.style.position = 'relative'; input.parentNode.appendChild(box);
    input.setAttribute('autocomplete', 'off');
    var list = [], active = -1, t = null, seq = 0;
    function show(items, note) {
      list = items; active = -1;
      box.innerHTML = items.map(function (p, i) { return '<button type="button" data-i="' + i + '">' + App.icon('pin') + '<span><b>' + esc(p.address) + '</b><small>' + esc([p.suburb, p.state, p.postcode].filter(Boolean).join(' ')) + '</small></span></button>'; }).join('') + (note ? '<p>' + note + '</p>' : '');
      box.hidden = !items.length && !note;
    }
    function pick(p) { box.hidden = true; input.value = p.address; if (opts.onPick) opts.onPick(p); }
    function fallback(q) { // full search (allowed for single searches) when suggestions are unavailable
      return search(q, { getBounds: function () { var n = (opts.near && opts.near()) || START; return L.latLngBounds([n.lat - 1, n.lng - 1], [n.lat + 1, n.lng + 1]); } });
    }
    input.addEventListener('input', function () {
      clearTimeout(t);
      var q = input.value.trim(); if (q.length < 3) { box.hidden = true; return; }
      var my = ++seq;
      t = setTimeout(function () {
        suggest(q, opts.near && opts.near()).then(function (items) { if (my === seq) show(items, items.length ? '' : 'No match yet — keep typing, or press Enter to search.'); })
          .catch(function () { if (my === seq) show([], 'Press Enter to search for this address.'); });
      }, 280);
    });
    input.addEventListener('keydown', function (e) {
      var btns = box.querySelectorAll('button');
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { if (!btns.length) return; e.preventDefault(); active = (active + (e.key === 'ArrowDown' ? 1 : -1) + btns.length) % btns.length; btns.forEach(function (b, i) { b.classList.toggle('on', i === active); }); }
      else if (e.key === 'Enter') {
        e.preventDefault();
        if (active >= 0 && list[active]) { pick(list[active]); return; }
        if (list.length) { pick(list[0]); return; }
        var q = input.value.trim(); if (!q) return;
        show([], 'Searching…');
        fallback(q).then(function (r) { r = r.map(function (p) { return Object.assign(p, { address: p.address }); }); show(r, r.length ? '' : 'Address not found. Check the spelling, or place the pin on the map.'); }).catch(function () { show([], 'Search is not available right now.'); });
      } else if (e.key === 'Escape') box.hidden = true;
    });
    box.addEventListener('mousedown', function (e) { e.preventDefault(); });
    box.addEventListener('click', function (e) { var b = e.target.closest('[data-i]'); if (b) pick(list[+b.getAttribute('data-i')]); });
    input.addEventListener('blur', function () { setTimeout(function () { box.hidden = true; }, 150); });
  }

  window.GIS = { isPt: isPt, configure: configure, suggest: suggest, drive: drive, routes: routes, straightKm: straightKm, addressInput: addressInput, create: create, toLatLngs: toLatLngs, toGeo: toGeo, modeOf: modeOf, measureOf: measureOf, fmtLen: fmtLen, fmtArea: fmtArea, search: search, START: START };
})();
