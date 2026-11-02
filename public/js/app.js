/* Seedsman — shared helpers for the staff pages: sign-in, API calls, header, formatting. */
(function () {
  'use strict';
  var KEY = 'seedsman-session';
  function token() { try { return localStorage.getItem(KEY) || ''; } catch (e) { return ''; } }
  function setToken(t) { try { if (t) localStorage.setItem(KEY, t); else localStorage.removeItem(KEY); } catch (e) { /* private mode */ } }
  function goLogin() { location.href = '/login.html?next=' + encodeURIComponent(location.pathname + location.search); }

  function call(method, path, body) {
    var headers = { 'Content-Type': 'application/json' };
    if (token()) headers.Authorization = 'Bearer ' + token();
    return fetch('/api/' + path, { method: method, headers: headers, body: body ? JSON.stringify(body) : undefined }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (d) {
        if (r.status === 401 && path !== 'auth/login') { setToken(''); goLogin(); throw new Error(d.error || 'Please sign in.'); }
        if (!r.ok) throw new Error(d.error || ('Something went wrong (' + r.status + ').'));
        return d;
      });
    });
  }

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function money(n) { n = +n || 0; return '$' + n.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ','); }
  function m2(n) { return (Math.round((+n || 0) * 10) / 10).toFixed(1) + ' m²'; }
  function metres(n) { return (Math.round((+n || 0) * 10) / 10).toFixed(1) + ' m'; }
  function date(s) {
    if (!s) return '';
    var d = new Date(/T|Z/.test(s) ? s : String(s).replace(' ', 'T') + 'Z');
    return isNaN(d) ? s : d.toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' });
  }
  var toastT;
  function toast(msg, ms) {
    var t = document.getElementById('toast');
    if (!t) { t = document.createElement('div'); t.id = 'toast'; t.className = 'toast'; document.body.appendChild(t); }
    t.textContent = msg; t.hidden = false;
    clearTimeout(toastT); toastT = setTimeout(function () { t.hidden = true; }, ms || 3500);
  }
  function params() { var o = {}; location.search.replace(/^\?/, '').split('&').forEach(function (kv) { if (!kv) return; var p = kv.split('='); o[decodeURIComponent(p[0])] = decodeURIComponent((p[1] || '').replace(/\+/g, ' ')); }); return o; }

  var mePromise = null;
  /** The signed-in user, the business details and the active rate card (sends to sign-in if signed out). */
  function me() {
    if (!token()) { goLogin(); return new Promise(function () {}); }
    if (!mePromise) mePromise = call('GET', 'me');
    return mePromise;
  }

  /** Fill <header class="top" id="top"> with the staff menu. */
  function header(active, extraHtml) {
    var el = document.getElementById('top'); if (!el) return;
    var links = [['quote', '/quote/hedge.html', 'New quote'], ['customers', '/customers/', 'Customers'], ['settings', '/settings.html', 'Rates & settings']];
    el.innerHTML = '<a class="brand" href="/customers/">Seedsman</a><nav class="nav">' +
      links.map(function (l) { return '<a href="' + l[1] + '"' + (l[0] === active ? ' class="on"' : '') + '>' + l[2] + '</a>'; }).join('') +
      '</nav>' + (extraHtml || '') + '<button class="btn ghost small" id="sign-out" type="button">Sign out</button>';
    document.getElementById('sign-out').onclick = function () {
      call('POST', 'auth/logout').catch(function () {}).then(function () { setToken(''); location.href = '/login.html'; });
    };
  }

  window.App = {
    get: function (p) { return call('GET', p); }, post: function (p, b) { return call('POST', p, b || {}); },
    put: function (p, b) { return call('PUT', p, b || {}); }, del: function (p) { return call('DELETE', p); },
    token: token, setToken: setToken, me: me, header: header,
    esc: esc, money: money, m2: m2, metres: metres, date: date, toast: toast, params: params
  };
})();
