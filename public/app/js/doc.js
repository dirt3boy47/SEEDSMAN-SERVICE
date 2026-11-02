/* Seedsman Quote — the customer-facing quotation: rendering, PDF, and sharing it with the PDF attached.
   Used by the staff document page and by the customer's own quote page (/quote.html). */
(function () {
  'use strict';
  var icon = App.icon, esc = App.esc, money = App.money;

  /** d: {business, customer, property, quote: {number, revision, updated_at, valid_until, items, calculation, notes, assumptions, exclusions}, colorOf(item)} */
  function render(container, d) {
    var q = d.quote, c = q.calculation || {}, b = d.business || {}, cu = d.customer || {}, p = d.property || {};
    var name = b.tradingName || b.name || 'Seedsman';
    var lines = c.document || (c.lines || []).map(function (l, i) { return { title: (q.items[i] && q.items[i].name) || l.serviceName || 'Hedge trimming', description: '', qty: l.qty != null ? l.qty : l.area, unit: l.unit || 'm²', amount: l.sell || 0 }; });
    container.innerHTML = '<div class="doc-wrap"><article class="doc">' +
      '<header class="doc-head"><div class="doc-brand"><span class="brand-mark">' + icon('leaf') + '</span><div><b>' + esc(name) + '</b><small>' + esc([b.phone, b.email].filter(Boolean).join(' · ')) + '</small>' + (b.abn ? '<small>ABN ' + esc(b.abn) + '</small>' : '') + (b.address ? '<small>' + esc(b.address) + '</small>' : '') + '</div></div>' +
      '<div class="doc-title"><h1>QUOTATION</h1><div><b>' + esc(q.number) + '</b>' + (q.revision > 1 ? ' · revision ' + q.revision : '') + '</div><div>Date: ' + App.date(q.updated_at) + '</div><div>Valid until: ' + App.date(q.valid_until) + '</div></div></header>' +
      '<section class="doc-meta"><div><h4>Prepared for</h4><b>' + esc(cu.name) + '</b><div>' + esc([cu.phone, cu.email].filter(Boolean).join(' · ')) + '</div></div><div><h4>Site</h4><b>' + esc(p.address) + '</b><div>' + esc(p.suburb) + '</div></div></section>' +
      '<div class="doc-map"><div class="doc-map-in"></div></div>' +
      '<table><thead><tr><th>Description</th><th class="r">Quantity</th><th class="r">Amount</th></tr></thead><tbody>' +
      lines.map(function (l) { return '<tr><td><b>' + esc(l.title) + '</b>' + (l.description ? '<small>' + esc(l.description) + '</small>' : '') + '</td><td class="r">' + (l.qty != null ? esc(App.qty(l.qty, l.unit)) : '') + '</td><td class="r">' + money(l.amount) + '</td></tr>'; }).join('') +
      '</tbody></table><div class="doc-totals"><div><span>Subtotal (excl. GST)</span><span class="num">' + money(c.exGst) + '</span></div><div><span>GST</span><span class="num">' + money(c.gst) + '</span></div><div class="grand"><span>Total (incl. GST)</span><span class="num">' + money(c.total) + '</span></div></div>' +
      '<section class="doc-notes">' + [['Notes', q.notes], ['Assumptions', q.assumptions], ['Exclusions', q.exclusions], ['Terms', b.terms || 'This quote is valid until the date shown. Sizes were measured from aerial imagery and are confirmed on site; we will discuss any change in price before starting.'], ['Payment', b.paymentTerms || 'Payment due within 7 days of completion.']]
        .filter(function (x) { return x[1]; }).map(function (x) { return '<div><h4>' + x[0] + '</h4><p>' + esc(x[1]) + '</p></div>'; }).join('') + '</section>' +
      (d.acceptance ? '<section class="doc-accepted">' + icon('check') + '<div><b>Accepted by ' + esc(d.acceptance.name) + '</b><small>' + App.date(d.acceptance.accepted_at) + ' · revision ' + d.acceptance.revision + '</small></div></section>'
        : '<section class="doc-accept"><div>Accepted by (name)</div><div>Signature</div><div>Date</div></section>') +
      '<footer class="doc-foot">' + esc(name) + ' · ' + esc(q.number) + ' · Thank you for the opportunity to quote.</footer></article></div>';
    var gis = GIS.create(container.querySelector('.doc-map-in'), { toolbar: false, interactive: false, basemap: 'world', print: true, start: p.lat != null ? { lat: p.lat, lng: p.lng, zoom: 19 } : null });
    gis.setShapes((q.items || []).filter(function (it) { return it.geometry; }).map(function (it) { return { geometry: it.geometry, color: d.colorOf ? d.colorOf(it) : '#3ddc84', label: it.name }; }));
    if (p.lat != null) gis.setPin(L.latLng(p.lat, p.lng));
    if (!gis.fit()) container.querySelector('.doc-map').hidden = true;
    return { gis: gis, el: container.querySelector('.doc'), name: name };
  }

  /** A4 PDF of the rendered document (as a Blob). Map tiles that don't allow copying are left out rather than failing. */
  var libsP = null;
  function libs() {
    if (window.jspdf && window.html2canvas) return Promise.resolve();
    if (libsP) return libsP;
    var load = function (src) { return new Promise(function (res, rej) { var sc = document.createElement('script'); sc.src = src; sc.onload = res; sc.onerror = function () { rej(new Error('Could not load ' + src)); }; document.head.appendChild(sc); }); };
    return (libsP = Promise.all([load('/vendor/jspdf.umd.min.js'), load('/vendor/html2canvas.min.js')]));
  }
  function pdf(docEl) {
    return libs().then(function () { return pdfNow(docEl); });
  }
  function pdfNow(docEl) {
    var jsPDF = window.jspdf && window.jspdf.jsPDF;
    return html2canvas(docEl, { scale: 2, useCORS: true, allowTaint: false, backgroundColor: '#ffffff', logging: false }).then(function (canvas) {
      var out = new jsPDF({ unit: 'mm', format: 'a4', compress: true }), W = 210, H = 297;
      var pageHpx = Math.floor(canvas.width * H / W), y = 0, first = true;
      while (y < canvas.height) {
        var h = Math.min(pageHpx, canvas.height - y), slice = document.createElement('canvas');
        slice.width = canvas.width; slice.height = h;
        slice.getContext('2d').drawImage(canvas, 0, y, canvas.width, h, 0, 0, canvas.width, h);
        if (!first) out.addPage();
        out.addImage(slice.toDataURL('image/jpeg', 0.88), 'JPEG', 0, 0, W, h * W / canvas.width);
        first = false; y += h;
      }
      return out.output('blob');
    });
  }
  function download(blob, filename) {
    var a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = filename;
    document.body.appendChild(a); a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 2000);
  }
  /** Email with the PDF attached: the device's share sheet where it can attach files (iPad, iPhone, Android, Windows),
      otherwise download the PDF and open the email (with a link to the quote in it). */
  function email(o) { // o: {blob, filename, to, cc, subject, body}
    var file = o.blob ? new File([o.blob], o.filename, { type: 'application/pdf' }) : null;
    if (file && navigator.canShare && navigator.canShare({ files: [file] })) {
      return navigator.share({ files: [file], title: o.subject, text: o.body }).then(function () { return 'shared'; }, function (e) {
        if (e && e.name === 'AbortError') return 'cancelled';
        return mail();
      });
    }
    return Promise.resolve(mail());
    function mail() {
      if (o.blob) download(o.blob, o.filename);
      location.href = 'mailto:' + encodeURIComponent(o.to || '') + '?subject=' + encodeURIComponent(o.subject) + (o.cc ? '&cc=' + encodeURIComponent(o.cc) : '') + '&body=' + encodeURIComponent(o.body);
      return o.blob ? 'downloaded' : 'mailto';
    }
  }

  window.Doc = { libs: libs, render: render, pdf: pdf, download: download, email: email };
})();
