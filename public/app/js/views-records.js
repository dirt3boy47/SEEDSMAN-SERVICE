/* Seedsman Quote — customers and properties (job locations), with saved site drawings. */
(function () {
  'use strict';
  var icon = App.icon, esc = App.esc, money = App.money;
  var SOURCES = ['Phone', 'Website', 'Referral', 'Repeat customer', 'Walk-in', 'Other'];

  function customerForm(c, withProperty) {
    c = c || {};
    return '<div class="grid2"><label class="field span2">Name<input id="f-name" value="' + esc(c.name) + '"></label><label class="field">Phone<input id="f-phone" type="tel" value="' + esc(c.phone) + '"></label>' +
      '<label class="field">Email<input id="f-email" type="email" value="' + esc(c.email) + '"></label><label class="field">How they found us<select id="f-source">' + SOURCES.map(function (s) { return '<option' + (s === c.source ? ' selected' : '') + '>' + s + '</option>'; }).join('') + '</select></label><span></span>' +
      (withProperty ? '<label class="field span2">Property address<input id="f-address"></label><label class="field">Suburb<input id="f-suburb"></label><label class="field">Access / gate code<input id="f-access"></label>' : '') +
      '<label class="field span2">Notes<textarea id="f-notes">' + esc(c.notes) + '</textarea></label></div>';
  }
  function val(m, id) { var e = m.querySelector('#' + id); return e ? e.value : ''; }
  function quoteLi(q) { return '<a class="li" href="#/quotes/' + esc(q.id) + '"><span class="grow"><b>' + esc(q.number) + ' ' + App.pill(q.status) + '</b><small>' + App.date(q.created_at) + ' · ' + esc(q.services || 'Hedge trimming') + '</small></span><span class="end"><b class="num">' + money(q.total) + '</b><small>incl. GST</small></span></a>'; }
  function jobLi(j) { return '<a class="li" href="#/jobs/' + esc(j.id) + '"><span class="grow"><b>' + App.date(j.start) + ' · ' + App.time(j.start) + ' ' + App.pill(j.status) + '</b><small>' + esc(j.crew) + ' · ' + esc(j.quote_number) + '</small></span></a>'; }
  function card(title, body, action) { return '<div class="card"><div class="card-h"><h2>' + title + '</h2>' + (action || '') + '</div>' + body + '</div>'; }

  // ======================= customers =======================
  App.route('/customers', 'customers', function (ctx) {
    App.setTop({ title: 'Customers', sub: 'People and businesses you quote for', actions: '<button class="btn primary" id="add">' + icon('plus') + '<span class="lbl">Add customer</span></button>' });
    ctx.el.innerHTML = '<div class="page"><div class="toolbar"><label class="search">' + icon('search') + '<input class="input" type="search" id="q" placeholder="Search name, phone, email or address"></label></div><div class="card"><div class="tbl-wrap" id="list"><div class="empty">Loading…</div></div></div></div>';
    var t;
    function load() {
      App.get('customers?q=' + encodeURIComponent(ctx.el.querySelector('#q').value.trim())).then(function (d) {
        var el = ctx.el.querySelector('#list');
        if (!d.customers.length) { el.innerHTML = '<div class="empty">' + icon('users') + '<b>No customers found</b>Add one, or save a quote and the customer is added for you.</div>'; return; }
        el.innerHTML = '<table class="tbl"><thead><tr><th>Customer</th><th>Phone</th><th>Property</th><th class="r">Quotes</th><th class="r">Won</th></tr></thead><tbody>' + d.customers.map(function (c) {
          return '<tr class="click" data-href="#/customers/' + esc(c.id) + '"><td><div class="row" style="flex-wrap:nowrap"><span class="avatar">' + esc(App.initials(c.name)) + '</span><div><b>' + esc(c.name) + '</b><small>' + esc(c.email) + '</small></div></div></td><td>' + esc(c.phone) + '</td><td>' + esc(c.address || '') + (c.properties > 1 ? ' <span class="tag">+' + (c.properties - 1) + '</span>' : '') + '</td><td class="r">' + c.quotes + '</td><td class="r">' + (c.won ? money(c.won, 0) : '—') + '</td></tr>';
        }).join('') + '</tbody></table>';
      }).catch(function (e) { App.toast(e.message, 'err'); });
    }
    ctx.el.querySelector('#q').addEventListener('input', function () { clearTimeout(t); t = setTimeout(load, 250); });
    ctx.el.addEventListener('click', function (e) { var r = e.target.closest('tr[data-href]'); if (r) App.go(r.getAttribute('data-href')); });
    document.getElementById('add').onclick = function () {
      var m = App.modal('<h2>Add customer</h2><p class="sub">Their property can be pinned on the map afterwards.</p>' + customerForm({}, true) + '<div class="actions"><button class="btn" data-close>Cancel</button><button class="btn primary" id="ok">Add customer</button></div>');
      m.el.querySelector('#ok').onclick = function () {
        App.post('customers', { name: val(m.el, 'f-name'), phone: val(m.el, 'f-phone'), email: val(m.el, 'f-email'), source: val(m.el, 'f-source'), notes: val(m.el, 'f-notes'),
          property: { address: val(m.el, 'f-address'), suburb: val(m.el, 'f-suburb'), access: val(m.el, 'f-access') } })
          .then(function (d) { m.close(); App.go(d.propertyId ? '#/properties/' + d.propertyId : '#/customers/' + d.id); }).catch(function (x) { App.toast(x.message, 'err'); });
      };
    };
    load();
  });

  App.route('/customers/:id', 'customers', function (ctx) {
    var id = ctx.params[0];
    function load() {
      App.get('customers/' + encodeURIComponent(id)).then(function (d) {
        var c = d.customer, p0 = d.properties[0];
        if (!ctx.el.isConnected) return;
        App.setTop({ el: ctx.el, back: '#/customers', title: c.name, sub: [c.phone, c.email].filter(Boolean).join(' · ') || 'Customer',
          actions: '<button class="btn" id="edit">' + icon('edit') + '<span class="lbl">Edit</span></button><a class="btn primary" href="#/quotes/new?' + (p0 ? 'property=' + esc(p0.id) : 'customer=' + esc(c.id)) + '">' + icon('plus') + '<span class="lbl">New quote</span></a>' });
        ctx.el.innerHTML = '<div class="page"><div class="cols"><div class="stack">' +
          card('Properties', d.properties.length ? '<div class="list">' + d.properties.map(function (p) { return '<a class="li" href="#/properties/' + esc(p.id) + '"><span class="avatar">' + icon('home') + '</span><span class="grow"><b>' + esc(p.address) + '</b><small>' + esc(p.suburb) + ' · ' + p.drawings + ' site drawing' + (p.drawings === 1 ? '' : 's') + (p.lat == null ? ' · not pinned' : '') + '</small></span><span class="chev muted">' + icon('chev') + '</span></a>'; }).join('') + '</div>' : '<div class="empty">No property yet.</div>', '<button class="btn sm" id="add-prop">' + icon('plus') + 'Add property</button>') +
          card('Quotes', d.quotes.length ? '<div class="list">' + d.quotes.map(quoteLi).join('') + '</div>' : '<div class="empty">No quotes yet.</div>') +
        '</div><div class="stack">' +
          card('Details', '<div class="card-b stack"><div class="row">' + (c.phone ? '<a class="btn sm" href="tel:' + esc(c.phone) + '">' + icon('phone') + esc(c.phone) + '</a>' : '') + (c.email ? '<a class="btn sm" href="mailto:' + esc(c.email) + '">' + icon('mail') + 'Email</a>' : '') + '</div>' +
            '<div><h3>Found us by</h3><div>' + esc(c.source) + '</div></div><div><h3>Customer since</h3><div>' + App.date(c.created_at) + '</div></div>' + (c.notes ? '<div><h3>Notes</h3><div style="white-space:pre-wrap">' + esc(c.notes) + '</div></div>' : '') + '</div>') +
          card('Jobs', d.jobs.length ? '<div class="list">' + d.jobs.map(jobLi).join('') + '</div>' : '<div class="empty" style="padding:18px">No jobs booked.</div>') +
          '<button class="btn ghost" id="del" style="color:var(--danger)">' + icon('trash') + 'Delete customer</button>' +
        '</div></div></div>';
        document.getElementById('edit').onclick = function () {
          var m = App.modal('<h2>Edit customer</h2>' + customerForm(c, false) + '<div class="actions"><button class="btn" data-close>Cancel</button><button class="btn primary" id="ok">Save</button></div>');
          m.el.querySelector('#ok').onclick = function () { App.put('customers/' + id, { name: val(m.el, 'f-name'), phone: val(m.el, 'f-phone'), email: val(m.el, 'f-email'), source: val(m.el, 'f-source'), notes: val(m.el, 'f-notes') }).then(function () { m.close(); App.toast('Saved.'); load(); }).catch(function (x) { App.toast(x.message, 'err'); }); };
        };
        ctx.el.querySelector('#add-prop').onclick = function () {
          var m = App.modal('<h2>Add property</h2><div class="grid2"><label class="field span2">Address<input id="f-address"></label><label class="field">Suburb<input id="f-suburb"></label><label class="field">Access / gate code<input id="f-access"></label></div><div class="actions"><button class="btn" data-close>Cancel</button><button class="btn primary" id="ok">Add property</button></div>');
          m.el.querySelector('#ok').onclick = function () { App.post('properties', { customer_id: id, address: val(m.el, 'f-address'), suburb: val(m.el, 'f-suburb'), access: val(m.el, 'f-access') }).then(function (r) { m.close(); App.go('#/properties/' + r.id); }).catch(function (x) { App.toast(x.message, 'err'); }); };
        };
        ctx.el.querySelector('#del').onclick = function () { App.confirm('Delete ' + c.name + '?', 'They disappear from your lists. Their quotes are kept.', 'Delete', true).then(function (ok) { if (ok) App.del('customers/' + id).then(function () { App.go('#/customers'); }); }); };
      }).catch(function (e) { App.toast(e.message, 'err'); });
    }
    load();
  });

  // ======================= properties =======================
  App.route('/properties', 'properties', function (ctx) {
    var gis, list = [];
    ctx.onLeave(function () { if (gis) gis.destroy(); });
    App.setTop({ title: 'Properties', sub: 'Job locations', actions: '<a class="btn" href="#/map">' + icon('layers') + '<span class="lbl">Open map</span></a>' });
    ctx.el.innerHTML = '<div class="page"><div class="cols even"><div class="stack"><div class="toolbar"><label class="search" style="max-width:none">' + icon('search') + '<input class="input" type="search" id="q" placeholder="Search address, suburb or customer"></label></div><div class="card"><div class="list" id="list"><div class="empty">Loading…</div></div></div></div>' +
      '<div><div id="pmap" style="height:calc(100vh - 110px);position:sticky;top:84px"></div></div></div></div>';
    App.me().then(function (me) {
      if (!ctx.el.isConnected) return;
      gis = GIS.create(ctx.el.querySelector('#pmap'), { start: me.business.mapStart });
      load();
    });
    var t;
    function load() {
      App.get('properties?q=' + encodeURIComponent(ctx.el.querySelector('#q').value.trim())).then(function (d) {
        list = d.properties;
        ctx.el.querySelector('#list').innerHTML = list.length ? list.map(function (p) {
          return '<a class="li" href="#/properties/' + esc(p.id) + '" data-id="' + esc(p.id) + '"><span class="avatar">' + icon('home') + '</span><span class="grow"><b>' + esc(p.address) + '</b><small>' + esc(p.suburb) + ' · ' + esc(p.customer) + '</small></span><span class="end">' + (p.last_status ? App.pill(p.last_status) : '') + '<small>' + (p.next_job ? 'Job ' + App.dateShort(p.next_job) : p.drawings + ' drawing' + (p.drawings === 1 ? '' : 's')) + '</small></span></a>';
        }).join('') : '<div class="empty">' + icon('home') + '<b>No properties</b>They are added with customers and quotes.</div>';
        gis.setProps(list.map(function (p) { return { id: p.id, lat: p.lat, lng: p.lng, title: p.address }; }), function (pid) { App.go('#/properties/' + pid); });
        if (!gis.fit()) gis.map.setView([GIS.START.lat, GIS.START.lng], 11);
      }).catch(function (e) { App.toast(e.message, 'err'); });
    }
    ctx.el.querySelector('#q').addEventListener('input', function () { clearTimeout(t); t = setTimeout(load, 250); });
  });

  App.route('/properties/:id', 'properties', function (ctx) {
    var id = ctx.params[0], gis = null, data = null, moved = null;
    ctx.onLeave(function () { if (gis) gis.destroy(); });
    function render() {
      var p = data.property, c = data.customer;
      if (!ctx.el.isConnected) return;
      App.setTop({ el: ctx.el, back: '#/customers/' + c.id, title: p.address, sub: [p.suburb, c.name].filter(Boolean).join(' · '),
        actions: '<a class="btn" href="#/map?property=' + esc(p.id) + '">' + icon('layers') + '<span class="lbl">Map workspace</span></a><a class="btn primary" href="#/quotes/new?property=' + esc(p.id) + '">' + icon('plus') + '<span class="lbl">New quote</span></a>' });
      if (!gis) {
        ctx.el.innerHTML = '<div class="page"><div class="cols"><div class="stack"><div id="pm" style="height:min(62vh,560px)"></div><div id="pin-bar" class="card" hidden><div class="card-h"><span>House pin moved.</span><span class="row"><button class="btn sm" id="pin-undo">Undo</button><button class="btn sm primary" id="pin-save">Save pin</button></span></div></div><div id="left"></div></div><div class="stack" id="right"></div></div></div>';
        gis = GIS.create(ctx.el.querySelector('#pm'), { start: p.lat != null ? { lat: p.lat, lng: p.lng, zoom: p.zoom || 19 } : null, tools: [{ id: 'draw', icon: 'ruler', label: 'Draw' }],
          onTool: function (t) { if (t === 'draw') newDrawing(); }, onShapeClick: function (did) { var r = ctx.el.querySelector('[data-d="' + did + '"]'); if (r) { r.scrollIntoView({ behavior: 'smooth', block: 'center' }); } },
          onSearchPick: function (pl) { setPinAt(L.latLng(pl.lat, pl.lng)); } });
        ctx.el.querySelector('#pin-save').onclick = function () { App.put('properties/' + id, { lat: moved.lat, lng: moved.lng, zoom: gis.map.getZoom() }).then(function () { moved = null; ctx.el.querySelector('#pin-bar').hidden = true; App.toast('House pin saved.'); load(); }); };
        ctx.el.querySelector('#pin-undo').onclick = function () { moved = null; ctx.el.querySelector('#pin-bar').hidden = true; showPin(); };
      }
      showPin();
      gis.setShapes(data.drawings.map(function (d) { return { id: d.id, geometry: d.geometry, color: d.color || '#3ddc84', label: d.name }; }));
      if (!gis.fit() && p.address) GIS.search([p.address, p.suburb].join(', '), gis.map).then(function (r) { if (r[0]) { gis.map.setView([r[0].lat, r[0].lng], 19); App.toast('Found the address. Drag the pin onto the house and save it.', 'warn', 6000); setPinAt(L.latLng(r[0].lat, r[0].lng)); } }).catch(function () {});
      ctx.el.querySelector('#left').innerHTML = card('Site drawings', data.drawings.length ? '<div class="list">' + data.drawings.map(function (d) {
        var m = d.measure || {}, meas = d.kind === 'area' ? (m.area ? GIS.fmtArea(m.area) : '') + (m.perimeter ? ' · ' + GIS.fmtLen(m.perimeter) + ' perimeter' : '') : d.kind === 'line' ? (m.length ? GIS.fmtLen(m.length) : '') : (GIS.toLatLngs(d.geometry).length > 1 ? GIS.toLatLngs(d.geometry).length + ' points' : 'Point');
        return '<div class="li" data-d="' + esc(d.id) + '"><span class="avatar">' + icon(d.kind === 'area' ? 'area' : d.kind === 'point' ? 'pin' : 'line') + '</span><span class="grow"><b>' + esc(d.name) + '</b><small>' + esc(meas) + ' · ' + App.dateShort(d.updated_at) + (d.service ? ' · from a quote' : '') + '</small></span>' +
          '<button class="ib sm" data-da="redraw" title="Redraw">' + icon('edit') + '</button><button class="ib sm" data-da="del" title="Delete">' + icon('trash') + '</button></div>';
      }).join('') + '</div>' : '<div class="empty" style="padding:18px">Draw lines, areas and points on the map with <b>Draw</b>. Measured quote items are saved here too.</div>', '<button class="btn sm" id="draw2">' + icon('ruler') + 'Draw</button>');
      ctx.el.querySelector('#draw2').onclick = newDrawing;
      ctx.el.querySelector('#right').innerHTML =
        card('Property', '<div class="card-b grid2"><label class="field span2">Address<input id="p-address" value="' + esc(p.address) + '"></label><label class="field">Suburb<input id="p-suburb" value="' + esc(p.suburb) + '"></label><label class="field">Access / gate code<input id="p-access" value="' + esc(p.access) + '"></label><label class="field span2">Hazards<input id="p-hazards" value="' + esc(p.hazards) + '" placeholder="Dogs, power lines, slopes…"></label><div class="full"><button class="btn sm" id="p-save">' + icon('save') + 'Save property</button></div></div>') +
        card('Customer', '<a class="li" href="#/customers/' + esc(c.id) + '"><span class="avatar">' + esc(App.initials(c.name)) + '</span><span class="grow"><b>' + esc(c.name) + '</b><small>' + esc([c.phone, c.email].filter(Boolean).join(' · ')) + '</small></span></a>') +
        card('Quotes', data.quotes.length ? '<div class="list">' + data.quotes.map(quoteLi).join('') + '</div>' : '<div class="empty" style="padding:18px">No quotes for this property yet.</div>') +
        card('Jobs', data.jobs.length ? '<div class="list">' + data.jobs.map(jobLi).join('') + '</div>' : '<div class="empty" style="padding:18px">No jobs booked.</div>');
      ctx.el.querySelector('#p-save').onclick = function () { App.put('properties/' + id, { address: ctx.el.querySelector('#p-address').value, suburb: ctx.el.querySelector('#p-suburb').value, access: ctx.el.querySelector('#p-access').value, hazards: ctx.el.querySelector('#p-hazards').value }).then(function () { App.toast('Property saved.'); load(); }).catch(function (x) { App.toast(x.message, 'err'); }); };
    }
    function showPin() { var p = data.property; gis.setPin(moved || (p.lat != null ? L.latLng(p.lat, p.lng) : null), { draggable: true, title: 'House — drag to move', onMove: setPinAt }); }
    function setPinAt(ll) { moved = ll; ctx.el.querySelector('#pin-bar').hidden = false; showPin(); }
    function newDrawing() {
      gis.draw({ title: 'New site drawing', modes: ['line', 'area', 'points'], doneLabel: 'Save drawing', onDone: function (r) {
        var m = App.modal('<h2>Name this drawing</h2><p class="sub">' + (r.mode === 'area' ? GIS.fmtArea(r.area) + ' · ' + GIS.fmtLen(r.perimeter) + ' perimeter' : r.mode === 'line' ? GIS.fmtLen(r.length) : r.count + (r.count === 1 ? ' point' : ' points')) + '</p><label class="field">Name<input id="d-name" placeholder="e.g. Front hedge, back lawn"></label><label class="field" style="margin-top:10px">Notes<input id="d-notes"></label><div class="actions"><button class="btn" data-close>Discard</button><button class="btn primary" id="ok">Save drawing</button></div>');
        m.el.querySelector('#ok').onclick = function () {
          App.post('drawings', { property_id: id, name: val(m.el, 'd-name') || (r.mode === 'area' ? 'Area' : r.mode === 'line' ? 'Line' : r.count + ' trees'), notes: val(m.el, 'd-notes'), geometry: r.geometry, measure: { length: r.length, area: r.area, perimeter: r.perimeter, count: r.count } })
            .then(function () { m.close(); App.toast('Drawing saved to the property.'); load(); }).catch(function (x) { App.toast(x.message, 'err'); });
        };
      } });
    }
    ctx.el.addEventListener('click', function (e) {
      var b = e.target.closest('[data-da]'); if (!b) return;
      var d = data.drawings.filter(function (x) { return x.id === b.closest('[data-d]').getAttribute('data-d'); })[0];
      if (b.getAttribute('data-da') === 'del') App.confirm('Delete ' + d.name + '?', 'The drawing is removed from the property. Quotes that used it keep their measurements.', 'Delete', true).then(function (ok) { if (ok) App.del('drawings/' + d.id).then(load); });
      else gis.draw({ title: 'Redraw ' + d.name, modes: [d.kind], pts: GIS.toLatLngs(d.geometry), doneLabel: 'Save', onDone: function (r) { App.put('drawings/' + d.id, { geometry: r.geometry, measure: { length: r.length, area: r.area, perimeter: r.perimeter, count: r.count } }).then(function () { App.toast('Drawing updated.'); load(); }); } });
    });
    function load() { App.get('properties/' + encodeURIComponent(id)).then(function (d) { data = d; render(); }).catch(function (e) { App.toast(e.message, 'err'); }); }
    load();
  });
})();
