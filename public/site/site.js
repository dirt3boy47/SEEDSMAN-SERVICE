/* Seedsmans — website behaviour: navigation, reveals, the property linework, business details from the app, and the
   quote form (sent to the existing /api/public/enquiry endpoint, so it lands in the staff Pipeline as a New enquiry). */
(function () {
  'use strict';
  var $ = function (s, r) { return (r || document).querySelector(s); }, $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  var yr = $('#yr'); if (yr) yr.textContent = new Date().getFullYear();

  // business details (phone, email, ABN) from the app's Settings
  window.SM = window.SM || {};
  SM.biz = function (b) {
    b = b || {};
    $$('[data-biz]').forEach(function (el) { var v = b[el.getAttribute('data-biz')]; if (v) el.textContent = v; });
    var tel = (b.phone || '').replace(/[^\d+]/g, '');
    $$('[data-call]').forEach(function (a) { a.href = 'tel:' + tel; });
    $$('[data-mail]').forEach(function (a) { a.href = 'mailto:' + (b.email || ''); });
    $$('.call-only').forEach(function (el) { el.hidden = !tel; });
    $$('.mail-only').forEach(function (el) { el.hidden = !b.email; });
    $$('.abn-only').forEach(function (el) { el.hidden = !b.abn; });
  };
  SM.biz({});
  fetch('/api/public/business').then(function (r) { return r.ok ? r.json() : {}; }).then(SM.biz).catch(function () {});

  // navigation: transparent over the photograph, cream after; full-screen menu on phones
  var nav = $('#nav'), links = $('#links'), burger = $('#burger'), hero = $('.hero');
  function onScroll() { if (nav) nav.classList.toggle('solid', !hero || window.scrollY > hero.offsetHeight - 90); }
  window.addEventListener('scroll', onScroll, { passive: true }); onScroll();
  if (burger) {
    burger.onclick = function () { var open = !links.classList.contains('open'); links.classList.toggle('open', open); nav.classList.toggle('open', open); burger.setAttribute('aria-expanded', open); document.body.style.overflow = open ? 'hidden' : ''; };
    links.addEventListener('click', function (e) { if (e.target.closest('a')) { links.classList.remove('open'); nav.classList.remove('open'); burger.setAttribute('aria-expanded', 'false'); document.body.style.overflow = ''; } });
  }

  // reveal on scroll; the property linework draws itself in
  if ('IntersectionObserver' in window) {
    var io = new IntersectionObserver(function (es) { es.forEach(function (e) { if (e.isIntersecting) { e.target.classList.add('in'); if (e.target.id === 'aerial') e.target.classList.add('on'); io.unobserve(e.target); } }); }, { threshold: 0.18 });
    $$('.reveal').forEach(function (el) { io.observe(el); });
  } else $$('.reveal').forEach(function (el) { el.classList.add('in', 'on'); });

  // ---------- shared helpers (also used by the Map your property page) ----------
  /** Address suggestions (Photon / OpenStreetMap), biased to the Peninsula. onPick({address, suburb, lat, lng}) */
  SM.addressInput = function (input, box, onPick) {
    var list = [], t = null, seq = 0, active = -1;
    function show(items) { list = items; active = -1; box.innerHTML = items.map(function (p, i) { return '<button type="button" data-i="' + i + '">' + esc(p.address) + '<small>' + esc([p.suburb, p.postcode].filter(Boolean).join(' ')) + '</small></button>'; }).join(''); box.hidden = !items.length; }
    function pick(p) { input.value = p.address; box.hidden = true; onPick(p); }
    input.addEventListener('input', function () {
      clearTimeout(t); var q = input.value.trim(); if (q.length < 4) { box.hidden = true; return; }
      var my = ++seq;
      t = setTimeout(function () {
        fetch('https://photon.komoot.io/api/?q=' + encodeURIComponent(q + ' Victoria') + '&lat=-38.35&lon=145.0&limit=6&lang=en&bbox=144.5,-38.7,145.6,-37.9')
          .then(function (r) { return r.json(); }).then(function (d) {
            if (my !== seq) return;
            show((d.features || []).filter(function (f) { var p = f.properties || {}; return p.state === 'Victoria' && (p.street || p.name); }).map(function (f) {
              var p = f.properties; return { address: [p.housenumber, p.street || p.name].filter(Boolean).join(' '), suburb: p.city || p.district || p.locality || '', postcode: p.postcode || '', lat: f.geometry.coordinates[1], lng: f.geometry.coordinates[0] };
            }).filter(function (p, i, a) { return a.findIndex(function (x) { return x.address === p.address && x.suburb === p.suburb; }) === i; }).slice(0, 5));
          }).catch(function () { box.hidden = true; });
      }, 280);
    });
    input.addEventListener('keydown', function (e) {
      if (box.hidden || !list.length) return;
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); active = (active + (e.key === 'ArrowDown' ? 1 : -1) + list.length) % list.length; $$('button', box).forEach(function (b, i) { b.classList.toggle('on', i === active); }); }
      else if (e.key === 'Enter' && active >= 0) { e.preventDefault(); pick(list[active]); }
      else if (e.key === 'Escape') box.hidden = true;
    });
    box.addEventListener('mousedown', function (e) { e.preventDefault(); });
    box.addEventListener('click', function (e) { var b = e.target.closest('[data-i]'); if (b) pick(list[+b.getAttribute('data-i')]); });
    input.addEventListener('blur', function () { setTimeout(function () { box.hidden = true; }, 150); });
  };
  /** Photos shrunk on the device before sending. */
  SM.photoPicker = function (input, thumbs, max) {
    var photos = [];
    function shrink(file) {
      return new Promise(function (res) {
        var img = new Image(), url = URL.createObjectURL(file);
        img.onload = function () { var s = Math.min(1, 1600 / Math.max(img.width, img.height)), c = document.createElement('canvas'); c.width = Math.round(img.width * s); c.height = Math.round(img.height * s); c.getContext('2d').drawImage(img, 0, 0, c.width, c.height); URL.revokeObjectURL(url); c.toBlob(function (b) { res(b || file); }, 'image/jpeg', 0.82); };
        img.onerror = function () { URL.revokeObjectURL(url); res(file); };
        img.src = url;
      });
    }
    function draw() { thumbs.innerHTML = photos.map(function (p, i) { return '<span style="background-image:url(' + p.url + ')"><button type="button" data-x="' + i + '" aria-label="Remove photo">✕</button></span>'; }).join(''); }
    input.addEventListener('change', function () {
      var files = Array.prototype.slice.call(input.files || []).slice(0, max - photos.length);
      Promise.all(files.map(shrink)).then(function (bs) { bs.forEach(function (b) { photos.push({ blob: b, url: URL.createObjectURL(b) }); }); draw(); });
      input.value = '';
    });
    thumbs.addEventListener('click', function (e) { var b = e.target.closest('[data-x]'); if (!b) return; photos.splice(+b.getAttribute('data-x'), 1); draw(); });
    return photos;
  };
  /** One-choice or many-choice option buttons. */
  SM.options = function (box, many) {
    box.addEventListener('click', function (e) { var b = e.target.closest('[data-v]'); if (!b) return; if (many) b.classList.toggle('on'); else $$('[data-v]', box).forEach(function (x) { x.classList.toggle('on', x === b); }); box.dispatchEvent(new Event('change')); });
    return function () { var on = $$('[data-v].on', box).map(function (b) { return b.getAttribute('data-v'); }); return many ? on : on[0] || ''; };
  };
  /** Send an enquiry (and any photos) to the existing endpoint — it becomes a New enquiry in the Pipeline. */
  SM.sendEnquiry = function (body, photos) {
    return fetch('/api/public/enquiry', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      .then(function (r) { return r.json().then(function (d) { if (!r.ok) throw new Error(d.error || 'Something went wrong — please try again.'); return d; }); })
      .then(function (d) {
        if (!photos || !photos.length || !d.id) return d;
        return photos.reduce(function (p, ph) {
          return p.then(function () { return fetch('/api/public/enquiry/' + encodeURIComponent(d.id) + '/photo?t=' + encodeURIComponent(d.token), { method: 'POST', headers: { 'Content-Type': ph.blob.type || 'image/jpeg' }, body: ph.blob }).catch(function () {}); });
        }, Promise.resolve()).then(function () { return d; });
      });
  };
  SM.thanks = function (name, how) {
    return '<div class="thanks"><p class="label">Received</p><h3>Thank you, ' + esc(String(name).split(' ')[0]) + '.</h3><p>We have your details and will be in touch shortly.</p><ol>' +
      '<li><span>01</span>We’ll ' + esc(how) + ' you to discuss the property.</li><li><span>02</span>We measure the landscape and prepare your quote.</li><li><span>03</span>You receive a link to review and accept it online.</li></ol></div>';
  };

  // ---------- the quote form on the homepage ----------
  var form = $('#qform'); if (!form) return;
  var pin = null, services = SM.options($('#svc'), true), contact = SM.options($('#contactPref')), photos = SM.photoPicker($('#photos'), $('#thumbs'), 3);
  SM.addressInput($('#addr'), $('#suggest'), function (p) { if (p.suburb) $('#suburb').value = p.suburb; pin = { lat: p.lat, lng: p.lng }; });
  $('#addr').addEventListener('input', function () { pin = null; });
  form.addEventListener('submit', function (e) {
    e.preventDefault();
    var v = function (n) { return (form.elements[n].value || '').trim(); }, err = $('#err'), send = $('#send');
    if (!v('name')) { err.textContent = 'Please add your name.'; form.elements.name.focus(); return; }
    if (!v('phone') && !v('email')) { err.textContent = 'Please add a phone number or email.'; form.elements.phone.focus(); return; }
    err.textContent = ''; send.disabled = true; send.textContent = 'Sending…';
    var body = { name: v('name'), phone: v('phone'), email: v('email'), address: v('address'), suburb: v('suburb'), message: v('message'), services: services(), contact: contact(), website: v('website') };
    if (pin) { body.lat = pin.lat; body.lng = pin.lng; }
    SM.sendEnquiry(body, photos).then(function () {
      form.outerHTML = SM.thanks(body.name, contact() === 'Email' ? 'email' : contact() === 'Text' ? 'text' : 'call');
    }).catch(function (x) { err.textContent = x.message; send.disabled = false; send.textContent = 'Request a quote'; });
  });
})();
