/* Seedsman Quote — core: API, icons, formatting, shell (sidebar + top bar), router, modal, menus, toasts, theme. */
(function () {
  'use strict';
  var KEY = 'seedsman-session';

  // ---------------- icons (GeoCanvas line style: 24px grid, 1.8 stroke) ----------------
  var P = {
    overview: '<rect x="3.5" y="3.5" width="7" height="7" rx="2"/><rect x="13.5" y="3.5" width="7" height="7" rx="2"/><rect x="3.5" y="13.5" width="7" height="7" rx="2"/><rect x="13.5" y="13.5" width="7" height="7" rx="2"/>',
    quote: '<path d="M7 3h7l5 5v12a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z"/><path d="M14 3v5h5M9 13h6M9 17h4"/>',
    users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.6-3.6 3.2-5.5 6.5-5.5s5.9 1.9 6.5 5.5M16 4.8a3.3 3.3 0 0 1 0 6.4M18 14.8c2 .7 3.2 2.4 3.5 5.2"/>',
    home: '<path d="M3.5 11 12 4l8.5 7M6 9.5V20h12V9.5M10 20v-5h4v5"/>',
    layers: '<path d="M12 3 2.5 8 12 13l9.5-5zM2.5 12.5 12 17.5l9.5-5M2.5 16.5 12 21.5l9.5-5"/>',
    calendar: '<rect x="3.5" y="5" width="17" height="15.5" rx="2.5"/><path d="M3.5 10h17M8 3v4M16 3v4"/>',
    tag: '<path d="M3.5 12.5V4.5a1 1 0 0 1 1-1h8l8 8-9 9z"/><circle cx="8.5" cy="8.5" r="1.6"/>',
    chart: '<path d="M4 20V11M10 20V5M16 20v-6M21 20H3"/>',
    gear: '<circle cx="12" cy="12" r="3.2"/><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M5.3 18.7l2.1-2.1M16.6 7.4l2.1-2.1"/>',
    plus: '<path d="M12 5v14M5 12h14"/>', search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m15.5 15.5 5 5"/>',
    close: '<path d="M6 6l12 12M18 6 6 18"/>', more: '<circle cx="5" cy="12" r="1.2"/><circle cx="12" cy="12" r="1.2"/><circle cx="19" cy="12" r="1.2"/>',
    line: '<path d="M4 18 9.5 9l5 6L20 6"/>', area: '<path d="M5 6.5 15 4l5 8-6 8-9-3z"/>',
    pin: '<path d="M12 21s-6.5-6.2-6.5-11a6.5 6.5 0 0 1 13 0c0 4.8-6.5 11-6.5 11z"/><circle cx="12" cy="10" r="2.4"/>',
    ruler: '<path d="M3.5 16.5 16.5 3.5l4 4-13 13z"/><path d="M7 13l1.8 1.8M9.5 10.5l2.6 2.6M12 8l1.8 1.8M14.5 5.5l2.6 2.6"/>',
    gps: '<path d="M20.5 3.5 3.5 10.6l7 2.9 2.9 7z"/>', expand: '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>',
    trash: '<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/>', copy: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/>',
    print: '<path d="M7 9V3h10v6M7 17H4.5a1 1 0 0 1-1-1v-6a1 1 0 0 1 1-1h15a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1H17"/><rect x="7" y="14" width="10" height="7" rx="1"/>',
    chev: '<path d="m9 6 6 6-6 6"/>', back: '<path d="M15 6l-6 6 6 6"/>',
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2.5V5M12 19v2.5M2.5 12H5M19 12h2.5M5.3 5.3l1.8 1.8M16.9 16.9l1.8 1.8M5.3 18.7l1.8-1.8M16.9 7.1l1.8-1.8"/>',
    moon: '<path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z"/>',
    logout: '<path d="M14 4h4a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-4M10 16l-4-4 4-4M6 12h10"/>',
    sidebar: '<rect x="3" y="4" width="18" height="16" rx="3"/><path d="M9 4v16"/>',
    leaf: '<path d="M5 19c0-8 5-14 15-15-1 10-7 15-15 15z"/><path d="M5 19l8-8"/>',
    hedge: '<circle cx="6" cy="6.5" r="2.5"/><circle cx="6" cy="17.5" r="2.5"/><path d="M8.2 8 20 17M8.2 16 20 7"/>',
    lawn: '<path d="M3 20h18M6 20c0-4-1-7-3-9M10 20c0-5 1-9 3-12M14 20c0-3 1-6 4-8M18 20c0-2 .5-4 2-5"/>',
    garden: '<circle cx="12" cy="7.5" r="3"/><path d="M12 10.5V21M12 16c-3-3-6-2-7 0 2 1 5 1 7 0zm0 0c3-3 6-2 7 0-2 1-5 1-7 0z"/>',
    tree: '<path d="M12 3 6 11h3l-4 6h14l-4-6h3z"/><path d="M12 17v4"/>',
    clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
    check: '<path d="m5 12.5 4.5 4.5L19 7"/>', edit: '<path d="M16.5 3.5 20.5 7.5 8 20l-4.5.5L4 16zM14 6l4 4"/>',
    hand: '<path d="M8 13V6.5a1.5 1.5 0 0 1 3 0V12m0-6.5V4.5a1.5 1.5 0 0 1 3 0V12m0-6a1.5 1.5 0 0 1 3 0v7m0-4a1.5 1.5 0 0 1 3 0V15a6 6 0 0 1-6 6h-1.5a6 6 0 0 1-5-2.7L4 14.5a1.6 1.6 0 0 1 2.6-1.8L8 14"/>',
    save: '<path d="M5 4h11l3 3v12a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1z"/><path d="M8 4v5h7V4M8 20v-6h8v6"/>',
    mail: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3.5 6.5 8.5 7 8.5-7"/>',
    phone: '<path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a1 1 0 0 1-1 1A16 16 0 0 1 4 5a1 1 0 0 1 1-1z"/>',
    truck: '<path d="M3 6h11v10H3zM14 9h4l3 3.5V16h-7"/><circle cx="7" cy="17.5" r="2"/><circle cx="17" cy="17.5" r="2"/>'
  };
  function icon(name) { return '<svg class="i" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + (P[name] || '') + '</svg>'; }
  var CATS = { Hedges: { icon: 'hedge', color: '#0f7a5f', map: '#3ddc84' }, Lawns: { icon: 'lawn', color: '#5c940d', map: '#a9e34b' }, Gardens: { icon: 'garden', color: '#ae3ec9', map: '#e599f7' }, Trees: { icon: 'tree', color: '#1c7ed6', map: '#74c0fc' }, Other: { icon: 'clock', color: '#868e96', map: '#dee2e6' } };
  function cat(c) { return CATS[c] || CATS.Other; }

  // ---------------- API ----------------
  function token() { try { return localStorage.getItem(KEY) || ''; } catch (e) { return ''; } }
  function setToken(t) { try { if (t) localStorage.setItem(KEY, t); else localStorage.removeItem(KEY); } catch (e) { /* private mode */ } }
  function goLogin() { location.href = '/login.html?next=' + encodeURIComponent(location.pathname + location.hash); }
  function call(method, path, body) {
    var headers = { 'Content-Type': 'application/json' };
    if (token()) headers.Authorization = 'Bearer ' + token();
    return fetch('/api/' + path, { method: method, headers: headers, body: body ? JSON.stringify(body) : undefined }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (d) {
        if (r.status === 401 && path !== 'auth/login') { setToken(''); goLogin(); throw new Error(d.error || 'Please sign in.'); }
        if (!r.ok) throw new Error(d.error || 'Something went wrong (' + r.status + ').');
        return d;
      });
    });
  }

  // ---------------- formatting ----------------
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function money(n, dp) { n = +n || 0; var d = dp == null ? 2 : dp; return (n < 0 ? '−$' : '$') + Math.abs(n).toFixed(d).replace(/\B(?=(\d{3})+(?!\d))/g, ','); }
  function money0(n) { return money(n, 0); }
  function qty(n, unit) { n = +n || 0; var d = unit === 'each' || unit === 'h' ? (n % 1 ? 2 : 0) : 1; return n.toFixed(d) + (unit ? ' ' + unit : ''); }
  function pct(n) { return n == null ? '—' : Math.round(n * 100) + '%'; }
  function parseDate(s) { if (!s) return null; var d = new Date(/T\d\d:\d\d$/.test(s) ? s : /T|Z/.test(s) ? s : String(s).replace(' ', 'T') + 'Z'); return isNaN(d) ? null : d; }
  function date(s) { var d = parseDate(s); return d ? d.toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' }) : ''; }
  function dateShort(s) { var d = parseDate(s); return d ? d.toLocaleDateString('en-AU', { day: 'numeric', month: 'short' }) : ''; }
  function ago(s) {
    var d = parseDate(s); if (!d) return '';
    var m = Math.round((Date.now() - d) / 60000);
    if (m < 1) return 'just now'; if (m < 60) return m + ' min ago';
    var h = Math.round(m / 60); if (h < 24) return h + ' h ago';
    var dd = Math.round(h / 24); if (dd < 14) return dd + (dd === 1 ? ' day ago' : ' days ago');
    return date(s);
  }
  function time(local) { if (!local) return ''; var t = local.slice(11, 16).split(':'), h = +t[0]; return (h % 12 || 12) + (t[1] !== '00' ? ':' + t[1] : '') + (h < 12 ? 'am' : 'pm'); }
  function pill(status) { return '<span class="pill s-' + esc(String(status || '').toLowerCase().replace(/\s+/g, '-')) + '">' + esc(status) + '</span>'; }
  function initials(name) { return String(name || '?').split(/\s+/).filter(Boolean).slice(0, 2).map(function (w) { return w[0]; }).join('').toUpperCase(); }
  function addr(p) { return p ? [p.address, p.suburb].filter(Boolean).join(', ') : ''; }

  // ---------------- toasts, modal, menus ----------------
  function toast(msg, kind, ms) {
    var box = document.getElementById('toasts'), t = document.createElement('div');
    t.className = 'toast' + (kind ? ' ' + kind : ''); t.textContent = msg; box.appendChild(t);
    setTimeout(function () { t.remove(); }, ms || 3800);
  }
  function modal(html, opts) {
    opts = opts || {};
    var wrap = document.getElementById('modal-wrap'), m = document.getElementById('modal');
    m.className = 'panel' + (opts.wide ? ' wide' : ''); m.innerHTML = html; wrap.hidden = false;
    var close = function () { wrap.hidden = true; m.innerHTML = ''; if (opts.onClose) opts.onClose(); };
    wrap.onclick = function (e) { if (e.target === wrap) close(); };
    m.querySelectorAll('[data-close]').forEach(function (b) { b.onclick = close; });
    var f = m.querySelector('input,select,textarea'); if (f && !opts.noFocus) setTimeout(function () { f.focus(); }, 30);
    return { el: m, close: close };
  }
  function confirmBox(title, text, okLabel, danger) {
    return new Promise(function (res) {
      var mm = modal('<h2>' + esc(title) + '</h2><p class="sub">' + esc(text) + '</p><div class="actions"><button class="btn" data-close>Cancel</button><button class="btn ' + (danger ? 'danger' : 'primary') + '" id="cf-ok">' + esc(okLabel || 'OK') + '</button></div>', { noFocus: true, onClose: function () { res(false); } });
      mm.el.querySelector('#cf-ok').onclick = function () { mm.el.querySelector('#cf-ok').disabled = true; res(true); document.getElementById('modal-wrap').hidden = true; };
    });
  }
  var openMenu = null;
  function menu(anchor, html, onPick) {
    closeMenu();
    var m = document.createElement('div'); m.className = 'panel menu-pop'; m.innerHTML = html; document.body.appendChild(m);
    var r = anchor.getBoundingClientRect(), w = m.offsetWidth, h = m.offsetHeight;
    var left = Math.min(Math.max(8, r.left), window.innerWidth - w - 8), top = r.bottom + 6;
    if (top + h > window.innerHeight - 8) top = Math.max(8, r.top - h - 6);
    m.style.left = left + 'px'; m.style.top = top + 'px';
    m.onclick = function (e) { var b = e.target.closest('[data-v]'); if (!b) return; closeMenu(); onPick(b.getAttribute('data-v')); };
    openMenu = m;
    setTimeout(function () { document.addEventListener('pointerdown', outside, true); }, 0);
  }
  function outside(e) { if (openMenu && !openMenu.contains(e.target)) closeMenu(); }
  function closeMenu() { if (openMenu) { openMenu.remove(); openMenu = null; document.removeEventListener('pointerdown', outside, true); } }

  // ---------------- theme ----------------
  function theme() { try { return localStorage.getItem('seedsman-theme') || 'auto'; } catch (e) { return 'auto'; } }
  function applyTheme(t) {
    if (t === 'light' || t === 'dark') document.documentElement.setAttribute('data-theme', t); else document.documentElement.removeAttribute('data-theme');
    try { localStorage.setItem('seedsman-theme', t); } catch (e) { /* ignore */ }
    var b = document.getElementById('theme-btn'); if (b) b.innerHTML = icon(isDark() ? 'sun' : 'moon');
  }
  function isDark() { var t = theme(); return t === 'dark' || (t === 'auto' && window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches); }

  // ---------------- shell ----------------
  var NAV = [
    { g: 'Work' }, { id: 'overview', href: '#/', icon: 'overview', label: 'Overview' }, { id: 'quotes', href: '#/quotes', icon: 'quote', label: 'Quotes' }, { id: 'schedule', href: '#/schedule', icon: 'calendar', label: 'Schedule' },
    { g: 'Records' }, { id: 'customers', href: '#/customers', icon: 'users', label: 'Customers' }, { id: 'properties', href: '#/properties', icon: 'home', label: 'Properties' }, { id: 'map', href: '#/map', icon: 'layers', label: 'Map' },
    { g: 'Business' }, { id: 'services', href: '#/services', icon: 'tag', label: 'Services & pricing' }, { id: 'reports', href: '#/reports', icon: 'chart', label: 'Reports' }, { id: 'settings', href: '#/settings', icon: 'gear', label: 'Settings' }
  ];
  function shell(me) {
    document.getElementById('side').innerHTML =
      '<a class="brand" href="#/"><span class="brand-mark">' + icon('leaf') + '</span><span><b>' + esc((me.business && me.business.tradingName) || 'Seedsman') + '</b><small>Quote · GeoCanvas family</small></span></a>' +
      '<a class="btn primary" href="#/quotes/new">' + icon('plus') + 'New quote</a>' +
      '<nav class="nav">' + NAV.map(function (n) { return n.g ? '<div class="nav-g">' + n.g + '</div>' : '<a href="' + n.href + '" data-nav="' + n.id + '">' + icon(n.icon) + '<span>' + n.label + '</span></a>'; }).join('') + '</nav>' +
      '<div class="side-foot"><span class="avatar">' + esc(initials(me.user.name)) + '</span><div class="me"><b>' + esc(me.user.name) + '</b><small>' + (me.user.role === 'field' ? 'Staff' : 'Admin') + '</small></div>' +
      '<button class="ib sm" id="theme-btn" title="Light or dark">' + icon(isDark() ? 'sun' : 'moon') + '</button><button class="ib sm" id="out-btn" title="Sign out">' + icon('logout') + '</button></div>';
    document.getElementById('theme-btn').onclick = function () { applyTheme(isDark() ? 'light' : 'dark'); };
    document.getElementById('out-btn').onclick = function () { call('POST', 'auth/logout').catch(function () {}).then(function () { setToken(''); location.href = '/login.html'; }); };
    document.getElementById('scrim').onclick = function () { document.body.classList.remove('nav-open'); document.getElementById('scrim').hidden = true; };
  }
  function setTop(o) {
    o = o || {};
    if (o.el && !o.el.isConnected) return null; // a late reply for a page you already left
    var top = document.getElementById('top');
    top.innerHTML = '<button class="ib menu" id="menu-btn" aria-label="Menu">' + icon('sidebar') + '</button>' +
      (o.back ? '<a class="ib" href="' + o.back + '" aria-label="Back">' + icon('back') + '</a>' : '') +
      '<div class="title-block"><div class="t">' + (o.titleHtml || esc(o.title || '')) + '</div>' + (o.sub != null ? '<div class="s">' + (o.subHtml || esc(o.sub)) + '</div>' : '') + '</div>' +
      '<div class="top-actions">' + (o.actions || '') + '</div>';
    document.getElementById('menu-btn').onclick = function () { document.body.classList.add('nav-open'); document.getElementById('scrim').hidden = false; };
    document.title = (o.title || 'Seedsman') + ' · Seedsman Quote';
    return top;
  }

  // ---------------- router ----------------
  var routes = [], leave = [];
  function route(pattern, nav, fn) { routes.push({ re: new RegExp('^' + pattern.replace(/:(\w+)/g, '([^/]+)') + '$'), nav: nav, fn: fn }); }
  function go(hash) { if (location.hash === hash) render(); else location.hash = hash; }
  function render() {
    leave.forEach(function (f) { try { f(); } catch (e) { /* ignore */ } }); leave = [];
    closeMenu();
    document.getElementById('modal-wrap').hidden = true;
    document.body.classList.remove('nav-open'); document.getElementById('scrim').hidden = true;
    var h = location.hash.replace(/^#/, '') || '/', path = h.split('?')[0], query = {};
    (h.split('?')[1] || '').split('&').forEach(function (kv) { if (kv) { var p = kv.split('='); query[decodeURIComponent(p[0])] = decodeURIComponent(p[1] || ''); } });
    for (var i = 0; i < routes.length; i++) {
      var m = routes[i].re.exec(path);
      if (!m) continue;
      document.querySelectorAll('[data-nav]').forEach(function (a) { a.classList.toggle('on', a.getAttribute('data-nav') === routes[i].nav); });
      var old = document.getElementById('view'), view = document.createElement('div'); // a fresh container: replies for a page you left land nowhere
      view.id = 'view'; old.replaceWith(view);
      window.scrollTo(0, 0);
      routes[i].fn({ params: m.slice(1).map(decodeURIComponent), query: query, el: view, onLeave: function (f) { leave.push(f); } });
      return;
    }
    go('#/');
  }

  var meP = null;
  function me() { if (!meP) meP = call('GET', 'me'); return meP; }
  function refreshMe() { meP = null; return me(); }

  function start() {
    applyTheme(theme());
    if (!token()) { goLogin(); return; }
    me().then(function (d) { shell(d); window.addEventListener('hashchange', render); render(); })
      .catch(function (e) { toast(e.message, 'err', 8000); });
  }

  window.App = {
    get: function (p) { return call('GET', p); }, post: function (p, b) { return call('POST', p, b || {}); }, put: function (p, b) { return call('PUT', p, b || {}); }, del: function (p) { return call('DELETE', p); },
    setToken: setToken, token: token, me: me, refreshMe: refreshMe, icon: icon, cat: cat, CATS: CATS,
    esc: esc, money: money, money0: money0, qty: qty, pct: pct, date: date, dateShort: dateShort, ago: ago, time: time, pill: pill, initials: initials, addr: addr, parseDate: parseDate,
    toast: toast, modal: modal, confirm: confirmBox, menu: menu, closeMenu: closeMenu, setTop: setTop, route: route, go: go, start: start, isDark: isDark
  };
})();
