/* Seedsman — the map: aerial imagery (from GeoCanvas, plus Victoria's Vicmap) and address search. */
(function () {
  'use strict';
  var ESRI = 'https://server.arcgisonline.com/ArcGIS/rest/services/';
  var ROADS = { url: ESRI + 'Reference/World_Transportation/MapServer/tile/{z}/{y}/{x}', o: { maxNativeZoom: 19, attribution: 'Roads © Esri' } };
  var VIC = { url: 'https://base.maps.vic.gov.au/wmts/AERIAL_WM/EPSG:3857/{z}/{x}/{y}.png', o: { maxNativeZoom: 20, attribution: 'Imagery © State of Victoria (Vicmap), <a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noopener">CC BY 4.0</a>' }, watch: true };
  var QLD = { url: 'https://spatial-img.information.qld.gov.au/arcgis/rest/services/Basemaps/LatestStateProgram_AllUsers/ImageServer/tile/{z}/{y}/{x}', o: { maxNativeZoom: 20, attribution: 'Imagery © State of Queensland, CC BY 4.0' }, watch: true };
  var WORLD = { url: ESRI + 'World_Imagery/MapServer/tile/{z}/{y}/{x}', o: { maxNativeZoom: 19, attribution: 'Imagery © Esri, Maxar, Earthstar Geographics' } };
  var BASEMAPS = {
    vic: { label: 'VIC aerial + roads', layers: [VIC, ROADS] },
    world: { label: 'World aerial + roads', layers: [WORLD, ROADS] },
    qld: { label: 'QLD aerial + roads', layers: [QLD, ROADS] },
    osm: { label: 'Street map', layers: [{ url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png', o: { maxNativeZoom: 19, attribution: '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors' } }] }
  };
  var DEFAULT_START = { lat: -38.33, lng: 145.03, zoom: 12 }; // Mornington Peninsula

  /** Make a Leaflet map in element `id`. opts: {start:{lat,lng,zoom}, select: <select> element for imagery} */
  function create(id, opts) {
    opts = opts || {};
    var map = L.map(id, { maxZoom: 22, minZoom: 4, zoomSnap: 0.25, zoomDelta: 0.5, boxZoom: false, attributionControl: false });
    L.control.attribution({ position: 'bottomleft', prefix: '<a href="https://leafletjs.com" target="_blank" rel="noopener">Leaflet</a>' }).addTo(map);
    var s = opts.start || DEFAULT_START;
    map.setView([s.lat, s.lng], s.zoom || 15);
    var layers = [], key0 = null;
    try { key0 = localStorage.getItem('seedsman-basemap'); } catch (e) { /* ignore */ }
    function set(key, auto) {
      if (!BASEMAPS[key]) key = 'vic';
      layers.forEach(function (l) { map.removeLayer(l); }); layers = [];
      BASEMAPS[key].layers.forEach(function (d, i) {
        var tl = L.tileLayer(d.url, Object.assign({ maxZoom: 22, keepBuffer: 4 }, d.o)).addTo(map);
        tl.setZIndex(i);
        if (d.watch) watch(tl);
        layers.push(tl);
      });
      if (opts.select) opts.select.value = key;
      if (!auto) { try { localStorage.setItem('seedsman-basemap', key); } catch (e) { /* ignore */ } }
    }
    // A state imagery service that fails (or has no photo here) falls back to world imagery.
    function watch(tl) {
      var ok = 0, bad = 0, done = false;
      tl.on('tileload', function () { ok++; });
      tl.on('tileerror', function () {
        bad++;
        if (done || ok || bad < 6 || navigator.onLine === false) return;
        done = true;
        if (window.App) App.toast('That aerial imagery is not loading here, so world imagery is shown instead.', 6000);
        set('world', true);
      });
    }
    if (opts.select) {
      Object.keys(BASEMAPS).forEach(function (k) { var o = document.createElement('option'); o.value = k; o.textContent = BASEMAPS[k].label; opts.select.appendChild(o); });
      opts.select.onchange = function () { set(opts.select.value); };
    }
    set(key0 || 'vic', true);
    return map;
  }

  /** Address search (OpenStreetMap Nominatim, as in GeoCanvas), preferring places near the map. */
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

  /** Wire a search form: input + results box; onPick({lat,lng,address,suburb,label}). */
  function searchBox(form, input, results, map, onPick) {
    form.onsubmit = function (e) {
      e.preventDefault();
      var q = input.value.trim(); if (!q) return;
      results.hidden = false; results.innerHTML = '<p class="hint">Searching…</p>';
      search(q, map).then(function (list) {
        if (!list.length) { results.innerHTML = '<p class="hint">Nothing found. Try the street and suburb, or move the map there yourself.</p>'; return; }
        results.innerHTML = list.map(function (p, i) { return '<button type="button" data-i="' + i + '">' + App.esc(p.label) + '</button>'; }).join('');
        results.onclick = function (ev) {
          var b = ev.target.closest('button'); if (!b) return;
          var p = list[+b.getAttribute('data-i')];
          results.hidden = true; map.setView([p.lat, p.lng], 20); onPick(p);
        };
      }).catch(function () { results.innerHTML = '<p class="hint">Search is not available right now. Move the map to the property yourself.</p>'; });
    };
    input.addEventListener('input', function () { if (!input.value) results.hidden = true; });
  }

  window.SeedMap = { create: create, search: search, searchBox: searchBox, DEFAULT_START: DEFAULT_START };
})();
