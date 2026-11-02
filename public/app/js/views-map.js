/* Seedsman Quote — Map: the GIS workspace (all job locations, site drawings, draw and measure). */
(function () {
  'use strict';
  var icon = App.icon, esc = App.esc;

  App.route('/map', 'map', function (ctx) {
    var gis, props = [], sel = null, selData = null;
    ctx.onLeave(function () { if (gis) gis.destroy(); });
    App.setTop({ title: 'Map', sub: 'Job locations and site drawings', actions: '<a class="btn primary" href="#/quotes/new">' + icon('plus') + '<span class="lbl">New quote</span></a>' });
    ctx.el.className = 'wide';
    ctx.el.innerHTML = '<div style="position:relative;height:calc(100vh - 92px)"><div id="wmap" style="position:absolute;inset:0"></div>' +
      '<div class="panel" id="wpanel" style="position:absolute;z-index:810;left:10px;top:72px;bottom:10px;width:min(340px,calc(100% - 20px));display:flex;flex-direction:column;overflow:hidden"></div></div>';
    var panel = ctx.el.querySelector('#wpanel');
    App.me().then(function (me) {
      if (!ctx.el.isConnected) throw new Error('left');
      gis = GIS.create(ctx.el.querySelector('#wmap'), { start: me.business.mapStart, tools: [{ id: 'list', icon: 'sidebar', label: 'Panel' }, { id: 'draw', icon: 'ruler', label: 'Measure' }],
        onTool: function (t, b) { if (t === 'list') { panel.hidden = !panel.hidden; b.classList.toggle('on', !panel.hidden); } if (t === 'draw') measureOnly(); },
        onShapeClick: function (id) { var r = panel.querySelector('[data-d="' + id + '"]'); if (r) r.scrollIntoView({ block: 'center', behavior: 'smooth' }); } });
      ctx.el.querySelector('[data-tool=list]').classList.add('on');
      ctx.el.querySelector('.leaflet-top.leaflet-left').style.left = window.innerWidth > 760 ? '350px' : '';
      return App.get('properties');
    }).then(function (d) {
      props = d.properties;
      if (ctx.query.property) select(ctx.query.property); else listView();
    }).catch(function (e) { if (e.message !== 'left') App.toast(e.message, 'err'); });

    function pins() { gis.setProps(props.map(function (p) { return { id: p.id, lat: p.lat, lng: p.lng, title: p.address, sel: p.id === sel }; }), select); }
    function listView() {
      sel = null; selData = null; gis.setShapes([]); pins(); gis.fit();
      panel.innerHTML = '<div style="padding:12px 12px 8px"><label class="search">' + icon('search') + '<input class="input" type="search" id="pq" placeholder="Filter properties"></label></div><div class="list" id="plist" style="overflow:auto;flex:1"></div>';
      var draw = function () {
        var q = panel.querySelector('#pq').value.toLowerCase();
        panel.querySelector('#plist').innerHTML = props.filter(function (p) { return !q || (p.address + ' ' + p.suburb + ' ' + p.customer).toLowerCase().indexOf(q) >= 0; }).map(function (p) {
          return '<button class="li" data-p="' + esc(p.id) + '"><span class="avatar">' + icon('home') + '</span><span class="grow"><b>' + esc(p.address) + '</b><small>' + esc(p.suburb) + ' · ' + esc(p.customer) + (p.lat == null ? ' · not pinned' : '') + '</small></span><span class="end"><small>' + p.drawings + ' ' + icon('ruler').replace('class="i"', 'class="i" style="display:inline;width:13px;height:13px;vertical-align:-2px"') + '</small></span></button>';
        }).join('') || '<div class="empty">No properties yet. They are added with customers and quotes.</div>';
      };
      panel.querySelector('#pq').addEventListener('input', draw); draw();
      panel.querySelector('#plist').onclick = function (e) { var b = e.target.closest('[data-p]'); if (b) select(b.getAttribute('data-p')); };
    }
    function select(id) {
      sel = id; pins();
      App.get('properties/' + encodeURIComponent(id)).then(function (d) {
        selData = d; var p = d.property;
        gis.setShapes(d.drawings.map(function (x) { return { id: x.id, geometry: x.geometry, color: x.color || '#3ddc84', label: x.name }; }));
        if (!gis.fit([p.lat != null ? L.latLng(p.lat, p.lng) : null].filter(Boolean))) App.toast('This property has no pin yet — open it to pin the house.', 'warn');
        var total = { line: 0, area: 0 };
        d.drawings.forEach(function (x) { if (x.measure && x.measure.length && x.kind === 'line') total.line += x.measure.length; if (x.measure && x.measure.area) total.area += x.measure.area; });
        panel.innerHTML = '<div style="padding:10px 10px 4px" class="row"><button class="ib sm" id="pback" title="All properties">' + icon('back') + '</button><div style="flex:1;min-width:0"><b style="display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + esc(p.address) + '</b><small class="muted">' + esc(p.suburb) + ' · ' + esc(d.customer.name) + '</small></div></div>' +
          '<div class="row" style="padding:6px 12px 10px"><a class="btn sm primary" href="#/quotes/new?property=' + esc(p.id) + '">' + icon('plus') + 'New quote</a><button class="btn sm" id="pdraw">' + icon('ruler') + 'Draw</button><a class="btn sm" href="#/properties/' + esc(p.id) + '">Open</a></div>' +
          '<div style="padding:0 16px 8px" class="muted small">' + d.drawings.length + ' drawing' + (d.drawings.length === 1 ? '' : 's') + (total.area ? ' · ' + GIS.fmtArea(total.area) + ' of areas' : '') + (total.line ? ' · ' + GIS.fmtLen(total.line) + ' of lines' : '') + '</div>' +
          '<div class="list" style="overflow:auto;flex:1;border-top:1px solid var(--line)">' + (d.drawings.map(function (x) {
            var m = x.measure || {}; return '<div class="li" data-d="' + esc(x.id) + '"><span class="avatar">' + icon(x.kind === 'area' ? 'area' : x.kind === 'point' ? 'pin' : 'line') + '</span><span class="grow"><b>' + esc(x.name) + '</b><small>' + (x.kind === 'area' ? GIS.fmtArea(m.area || 0) : x.kind === 'line' ? GIS.fmtLen(m.length || 0) : (GIS.toLatLngs(x.geometry).length > 1 ? GIS.toLatLngs(x.geometry).length + ' points' : 'Point')) + '</small></span><button class="ib sm" data-zoom="' + esc(x.id) + '" title="Zoom to">' + icon('expand') + '</button></div>';
          }).join('') || '<div class="empty" style="padding:18px">No site drawings yet. Tap <b>Draw</b> to measure lines and areas and save them to this property.</div>') + '</div>' +
          (d.quotes.length ? '<div style="border-top:1px solid var(--line)"><div class="nav-g" style="margin:10px 16px 2px">Quotes</div><div class="list">' + d.quotes.slice(0, 3).map(function (q) { return '<a class="li" href="#/quotes/' + esc(q.id) + '"><span class="grow"><b>' + esc(q.number) + '</b><small>' + App.date(q.created_at) + '</small></span><span class="end">' + App.pill(q.status) + '</span></a>'; }).join('') + '</div></div>' : '');
        panel.querySelector('#pback').onclick = listView;
        panel.querySelector('#pdraw').onclick = function () { drawFor(p.id); };
        panel.onclick = function (e) { var z = e.target.closest('[data-zoom]'); if (!z) return; var x = d.drawings.filter(function (y) { return y.id === z.getAttribute('data-zoom'); })[0]; var lls = GIS.toLatLngs(x.geometry); if (lls.length > 1) gis.map.fitBounds(L.latLngBounds(lls), { padding: [80, 80], maxZoom: 21 }); else gis.map.setView(lls[0], 20); };
      }).catch(function (e) { App.toast(e.message, 'err'); });
    }
    function drawFor(pid) {
      gis.draw({ title: 'New site drawing', modes: ['line', 'area', 'points'], doneLabel: 'Save drawing', onDone: function (r) {
        var m = App.modal('<h2>Name this drawing</h2><p class="sub">' + (r.mode === 'area' ? GIS.fmtArea(r.area) : r.mode === 'line' ? GIS.fmtLen(r.length) : r.count + (r.count === 1 ? ' point' : ' points')) + '</p><label class="field">Name<input id="d-name" placeholder="e.g. Front hedge, back lawn"></label><div class="actions"><button class="btn" data-close>Discard</button><button class="btn primary" id="ok">Save</button></div>');
        m.el.querySelector('#ok').onclick = function () {
          App.post('drawings', { property_id: pid, name: m.el.querySelector('#d-name').value || 'Drawing', geometry: r.geometry, measure: { length: r.length, area: r.area, perimeter: r.perimeter, count: r.count } })
            .then(function () { m.close(); App.toast('Saved to the property.'); select(pid); }).catch(function (x) { App.toast(x.message, 'err'); });
        };
      } });
    }
    function measureOnly() {
      gis.draw({ title: 'Measure', modes: ['line', 'area'], doneLabel: sel ? 'Save to property' : 'Done', onDone: function (r) {
        if (!sel) { App.toast(r.mode === 'area' ? GIS.fmtArea(r.area) + ' · ' + GIS.fmtLen(r.perimeter) + ' perimeter' : GIS.fmtLen(r.length), null, 6000); return; }
        App.post('drawings', { property_id: sel, name: r.mode === 'area' ? 'Area ' + GIS.fmtArea(r.area) : 'Line ' + GIS.fmtLen(r.length), geometry: r.geometry, measure: { length: r.length, area: r.area, perimeter: r.perimeter, count: r.count } }).then(function () { App.toast('Saved to the property.'); select(sel); });
      } });
    }
  });
})();
