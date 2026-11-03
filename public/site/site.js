/* Seedsman's Hedges — public website: business details from the app, menu, address suggestions, photos, and the
   enquiry form, which lands in the staff Pipeline as a New enquiry (with any photos) and starts the CRM process. */
(function () {
  'use strict';
  var $ = function (s, r) { return (r || document).querySelector(s); }, $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  $('#yr').textContent = new Date().getFullYear();

  // ---------- business details (phone, email, ABN) come from the app's settings ----------
  var BIZ = {};
  function applyBiz(b) {
    BIZ = b || {};
    $$('[data-biz]').forEach(function (el) { var v = BIZ[el.getAttribute('data-biz')]; if (v) el.textContent = v; });
    var tel = (BIZ.phone || '').replace(/[^\d+]/g, '');
    $$('[data-call]').forEach(function (a) { a.href = 'tel:' + tel; });
    $$('.call-only').forEach(function (el) { el.hidden = !tel; });
    $$('[data-mail]').forEach(function (a) { a.href = 'mailto:' + (BIZ.email || ''); });
    $$('.mail-only').forEach(function (el) { el.hidden = !BIZ.email; });
    $$('.abn-only').forEach(function (el) { el.hidden = !BIZ.abn; });
    var dock = $('#dock'); if (dock && !tel) dock.querySelector('.btn.primary').style.flex = '1 1 100%';
  }
  applyBiz({});
  fetch('/api/public/business').then(function (r) { return r.ok ? r.json() : {}; }).then(applyBiz).catch(function () {});

  // ---------- header, menu, phone dock ----------
  var nav = $('#nav'), dock = $('#dock'), links = $('#links'), menu = $('#menu');
  function onScroll() {
    nav.classList.toggle('scrolled', window.scrollY > 8);
    var q = $('#quote').getBoundingClientRect(), inForm = q.top < window.innerHeight * 0.6 && q.bottom > 120;
    dock.classList.toggle('show', window.scrollY > 520 && !inForm);
  }
  window.addEventListener('scroll', onScroll, { passive: true }); onScroll();
  menu.onclick = function () { var open = !links.classList.contains('open'); links.classList.toggle('open', open); menu.setAttribute('aria-expanded', open); };
  links.addEventListener('click', function (e) { if (e.target.closest('a')) { links.classList.remove('open'); menu.setAttribute('aria-expanded', 'false'); } });

  // ---------- services chips (from the app's services, grouped into plain choices) ----------
  var CHOICES = ['Hedge trimming', 'Tall hedges', 'Lawn mowing', 'Garden tidy & weeding', 'Mulching', 'Shrub & tree pruning', 'Stump grinding', 'Green waste removal', 'Regular maintenance', 'Something else'];
  var picked = [];
  $('#chips').innerHTML = CHOICES.map(function (c) { return '<button type="button" data-v="' + esc(c) + '">' + esc(c) + '</button>'; }).join('');
  $('#chips').onclick = function (e) { var b = e.target.closest('[data-v]'); if (!b) return; var v = b.getAttribute('data-v'), i = picked.indexOf(v); if (i >= 0) picked.splice(i, 1); else picked.push(v); b.classList.toggle('on', i < 0); };
  function oneOf(id) { var box = $(id); box.onclick = function (e) { var b = e.target.closest('[data-v]'); if (!b) return; $$('button', box).forEach(function (x) { x.classList.toggle('on', x === b); }); }; return function () { var on = $('button.on', box); return on ? on.getAttribute('data-v') : ''; }; }
  var contactOf = oneOf('#contact'), whenOf = oneOf('#when');
  // a service card tapped → straight to the form with it ticked
  $$('#svc-cards .card').forEach(function (c) {
    c.style.cursor = 'pointer';
    c.addEventListener('click', function () {
      var match = c.getAttribute('data-pick');
      if (match && picked.indexOf(match) < 0) { picked.push(match); var b = $('#chips [data-v="' + match + '"]'); if (b) b.classList.add('on'); }
      $('#quote').scrollIntoView({ behavior: 'smooth' });
    });
  });

  // ---------- address suggestions (Photon / OpenStreetMap), biased to the Peninsula ----------
  var addr = $('#addr'), sug = $('#suggest'), pin = null, list = [], t = null, seq = 0, active = -1;
  function showSug(items) {
    list = items; active = -1;
    sug.innerHTML = items.map(function (p, i) { return '<button type="button" data-i="' + i + '">' + esc(p.address) + '<small>' + esc([p.suburb, p.postcode].filter(Boolean).join(' ')) + '</small></button>'; }).join('');
    sug.hidden = !items.length;
  }
  function pick(p) { addr.value = p.address; if (p.suburb) $('#suburb').value = p.suburb; pin = { lat: p.lat, lng: p.lng }; sug.hidden = true; }
  addr.addEventListener('input', function () {
    pin = null; clearTimeout(t); var q = addr.value.trim(); if (q.length < 4) { sug.hidden = true; return; }
    var my = ++seq;
    t = setTimeout(function () {
      fetch('https://photon.komoot.io/api/?q=' + encodeURIComponent(q + ' Victoria') + '&lat=-38.33&lon=145.05&limit=6&lang=en&bbox=144.6,-38.6,145.5,-38.0')
        .then(function (r) { return r.json(); }).then(function (d) {
          if (my !== seq) return;
          showSug((d.features || []).filter(function (f) { var p = f.properties || {}; return p.state === 'Victoria' && (p.street || p.name); }).map(function (f) {
            var p = f.properties; return { address: [p.housenumber, p.street || p.name].filter(Boolean).join(' '), suburb: p.city || p.district || p.locality || p.county || '', postcode: p.postcode || '', lat: f.geometry.coordinates[1], lng: f.geometry.coordinates[0] };
          }).filter(function (p, i, arr) { return arr.findIndex(function (x) { return x.address === p.address && x.suburb === p.suburb; }) === i; }).slice(0, 5));
        }).catch(function () { sug.hidden = true; });
    }, 280);
  });
  addr.addEventListener('keydown', function (e) {
    if (sug.hidden || !list.length) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); active = (active + (e.key === 'ArrowDown' ? 1 : -1) + list.length) % list.length; $$('button', sug).forEach(function (b, i) { b.classList.toggle('on', i === active); }); }
    else if (e.key === 'Enter' && active >= 0) { e.preventDefault(); pick(list[active]); }
    else if (e.key === 'Escape') sug.hidden = true;
  });
  sug.addEventListener('mousedown', function (e) { e.preventDefault(); });
  sug.onclick = function (e) { var b = e.target.closest('[data-i]'); if (b) pick(list[+b.getAttribute('data-i')]); };
  addr.addEventListener('blur', function () { setTimeout(function () { sug.hidden = true; }, 150); });

  // ---------- photos: shrunk on the phone before sending ----------
  var photos = [];
  function shrink(file) {
    return new Promise(function (res) {
      var img = new Image(), url = URL.createObjectURL(file);
      img.onload = function () {
        var s = Math.min(1, 1600 / Math.max(img.width, img.height)), c = document.createElement('canvas');
        c.width = Math.round(img.width * s); c.height = Math.round(img.height * s); c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        URL.revokeObjectURL(url); c.toBlob(function (b) { res(b || file); }, 'image/jpeg', 0.82);
      };
      img.onerror = function () { URL.revokeObjectURL(url); res(file); };
      img.src = url;
    });
  }
  function drawThumbs() { $('#thumbs').innerHTML = photos.map(function (p, i) { return '<span style="background-image:url(' + p.url + ')"><button type="button" data-x="' + i + '" aria-label="Remove photo">✕</button></span>'; }).join(''); }
  $('#photos').addEventListener('change', function (e) {
    var files = Array.prototype.slice.call(e.target.files || []).slice(0, 3 - photos.length);
    Promise.all(files.map(shrink)).then(function (blobs) { blobs.forEach(function (b) { photos.push({ blob: b, url: URL.createObjectURL(b) }); }); drawThumbs(); });
    e.target.value = '';
  });
  $('#thumbs').onclick = function (e) { var b = e.target.closest('[data-x]'); if (!b) return; photos.splice(+b.getAttribute('data-x'), 1); drawThumbs(); };

  // ---------- send: becomes a New enquiry in the staff Pipeline ----------
  $('#qform').addEventListener('submit', function (e) {
    e.preventDefault();
    var f = e.target, v = function (n) { return (f.elements[n].value || '').trim(); }, err = $('#err'), send = $('#send');
    if (!v('name')) { err.textContent = 'Please add your name.'; f.elements.name.focus(); return; }
    if (!v('phone') && !v('email')) { err.textContent = 'Please add a phone number or email so we can get back to you.'; f.elements.phone.focus(); return; }
    err.textContent = ''; send.disabled = true; send.textContent = 'Sending…';
    var body = { name: v('name'), phone: v('phone'), email: v('email'), address: v('address'), suburb: v('suburb'), message: v('message'), services: picked, contact: contactOf(), when: whenOf(), website: v('website') };
    if (pin) { body.lat = pin.lat; body.lng = pin.lng; }
    fetch('/api/public/enquiry', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      .then(function (r) { return r.json().then(function (d) { if (!r.ok) throw new Error(d.error || 'Something went wrong — please try again or give us a call.'); return d; }); })
      .then(function (d) {
        if (!photos.length || !d.id) return d;
        send.textContent = 'Sending photos…';
        return photos.reduce(function (p, ph) {
          return p.then(function () { return fetch('/api/public/enquiry/' + encodeURIComponent(d.id) + '/photo?t=' + encodeURIComponent(d.token), { method: 'POST', headers: { 'Content-Type': ph.blob.type || 'image/jpeg' }, body: ph.blob }).catch(function () {}); });
        }, Promise.resolve()).then(function () { return d; });
      })
      .then(function () {
        var first = esc(v('name').split(' ')[0]), how = contactOf() === 'Email' ? 'email' : contactOf() === 'Text' ? 'text' : 'call';
        f.outerHTML = '<div class="qform"><div class="done"><div class="tick"><svg viewBox="0 0 24 24"><path d="m5 12.5 4.5 4.5L19 7"/></svg></div><h3>Thanks, ' + first + '!</h3>' +
          '<p>We’ve got your enquiry' + (photos.length ? ' and photos' : '') + '. Here’s what happens next:</p><ol class="next">' +
          '<li><b>1</b><span>We’ll ' + how + ' you to talk through the job.</span></li>' +
          '<li><b>2</b><span>We measure it up and put your quote together.</span></li>' +
          '<li><b>3</b><span>You get a link to view your quote and accept it online.</span></li></ol></div></div>';
        $('#quote').scrollIntoView({ behavior: 'smooth' });
      })
      .catch(function (x) { err.textContent = x.message; send.disabled = false; send.textContent = 'Send my enquiry'; });
  });
})();
