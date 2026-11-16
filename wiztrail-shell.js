/* wiztrail-shell.js — guscio UI condiviso (M1)
   Header/tab bar/footer sono già nell'HTML (funzionano senza JS): qui si aggiunge
   aria-current, icone, toggle tema persistente, skip-link, modale accessibile.
   Nessuna dipendenza. Espone window.WizShell. */
window.WizShell = (function () {
  'use strict';
  var KEY = 'wiztrail_theme';
  var d = document, root = d.documentElement;

  /* ---------- Tema ---------- */
  function saved() { try { var t = localStorage.getItem(KEY); return t === 'light' || t === 'dark' ? t : null; } catch (e) { return null; } }
  function preferred() { return saved() || (window.matchMedia && matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark'); }
  function apply(t) {
    root.setAttribute('data-theme', t);
    if (d.body) d.body.setAttribute('data-theme', t);
    var sel = d.getElementById('themeSel'); if (sel) sel.value = t;
    var b = d.querySelector('.theme-toggle');
    if (b) { b.setAttribute('aria-pressed', t === 'light'); b.setAttribute('aria-label', 'Tema ' + (t === 'light' ? 'chiaro' : 'scuro') + ': cambia'); }
  }
  function setTheme(t) { try { localStorage.setItem(KEY, t); } catch (e) {} apply(t); }
  var SUN = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>';
  var MOON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg>';
  function addToggle() {
    var host = d.querySelector('.app-nav') || d.querySelector('.app-header');
    if (!host || d.querySelector('.theme-toggle') || !d.getElementById('themeSel') && !d.querySelector('.tabbar')) return;
    var b = d.createElement('button');
    b.type = 'button'; b.className = 'theme-toggle';
    b.innerHTML = d.body.getAttribute('data-theme') === 'light' ? MOON : SUN;
    b.addEventListener('click', function () {
      var t = d.body.getAttribute('data-theme') === 'light' ? 'dark' : 'light';
      setTheme(t); b.innerHTML = t === 'light' ? MOON : SUN;
    });
    host.appendChild(b);
    apply(d.body.getAttribute('data-theme') || preferred());
  }

  /* ---------- Navigazione ---------- */
  var ICONS = {
    calc: '<path d="M3 20l6-11 4 6 3-4 5 9z"/>',
    training: '<path d="M3 12h4l3-8 4 16 3-8h4"/>',
    ranking: '<path d="M6 20V11M12 20V4M18 20v-6"/>',
    metodo: '<path d="M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2z"/><path d="M8 7h7"/>'
  };
  function markNav() {
    var page = (location.pathname.split('/').pop() || 'landing.html').toLowerCase();
    d.querySelectorAll('.app-nav a, .tabbar a').forEach(function (a) {
      var href = (a.getAttribute('href') || '').split('#')[0].split('?')[0].split('/').pop().toLowerCase();
      var on = href === page;
      a.classList.remove('nav-active');
      if (on) { a.setAttribute('aria-current', 'page'); if (a.closest('.app-nav') && !a.classList.contains('nav-cta')) a.classList.add('nav-active'); }
      else a.removeAttribute('aria-current');
      var k = a.getAttribute('data-i');
      if (k && ICONS[k] && !a.querySelector('svg'))
        a.insertAdjacentHTML('afterbegin', '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + ICONS[k] + '</svg>');
    });
    if (d.querySelector('.tabbar')) d.body.classList.add('has-tabbar');
  }
  function addSkip() {
    var main = d.querySelector('.wrap') || d.querySelector('main');
    if (!main || d.querySelector('.skip-link')) return;
    if (!main.id) main.id = 'main';
    var a = d.createElement('a');
    a.className = 'skip-link'; a.href = '#' + main.id; a.textContent = 'Vai al contenuto';
    d.body.insertBefore(a, d.body.firstChild);
  }

  /* ---------- Modale accessibile: role=dialog, focus trap, ESC, ripristino focus ---------- */
  var FOCUS = 'a[href],button:not([disabled]),input:not([disabled]),select,textarea,[tabindex]:not([tabindex="-1"])';
  var cur = null, opener = null;
  function onKey(e) {
    if (!cur) return;
    if (e.key === 'Escape') { e.preventDefault(); close(); return; }
    if (e.key !== 'Tab') return;
    var f = Array.prototype.filter.call(cur.querySelectorAll(FOCUS), function (x) { return x.offsetParent !== null; });
    if (!f.length) { e.preventDefault(); return; }
    var first = f[0], last = f[f.length - 1];
    if (e.shiftKey && (d.activeElement === first || !cur.contains(d.activeElement))) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && (d.activeElement === last || !cur.contains(d.activeElement))) { e.preventDefault(); first.focus(); }
  }
  function open(el, trigger) {
    if (typeof el === 'string') el = d.getElementById(el);
    if (!el) return;
    opener = trigger || d.activeElement; cur = el;
    el.classList.add('is-open'); el.removeAttribute('aria-hidden');
    d.body.classList.add('is-modal');
    var panel = el.querySelector('[role="dialog"]') || el;
    d.addEventListener('keydown', onKey, true);
    (panel.querySelector('h1,h2,h3') || panel).setAttribute('tabindex', '-1');
    (panel.querySelector('h1,h2,h3') || panel).focus();
  }
  function close() {
    if (!cur) return;
    cur.classList.remove('is-open'); cur.setAttribute('aria-hidden', 'true');
    d.body.classList.remove('is-modal');
    d.removeEventListener('keydown', onKey, true);
    cur = null;
    if (opener && opener.focus) opener.focus();
    opener = null;
  }
  function backdrop(e) { if (cur && e.target === cur) close(); }

  /* Azioni non disponibili: aria-disabled="true" non esegue nulla (il motivo è sempre visibile nell'HTML) */
  function blockUnavailable(e) {
    var t = e.target.closest && e.target.closest('[aria-disabled="true"]');
    if (t) { e.preventDefault(); e.stopPropagation(); }
  }

  /* aria-expanded dei pulsanti che mostrano/nascondono un riquadro (data-expands + aria-controls) */
  function syncExpanded(e) {
    var b = e.target.closest && e.target.closest('[data-expands][aria-controls]');
    if (!b) return;
    setTimeout(function () {
      var t = d.getElementById(b.getAttribute('aria-controls'));
      b.setAttribute('aria-expanded', t && getComputedStyle(t).display !== 'none' ? 'true' : 'false');
    }, 0);
  }

  function init() {
    root.classList.add('wt-shell');
    apply(d.body.getAttribute('data-theme') || preferred());
    markNav(); addToggle(); addSkip();
    d.addEventListener('click', blockUnavailable, true);
    d.addEventListener('click', backdrop);
    d.addEventListener('click', syncExpanded);
    if (window.matchMedia) {
      var mq = matchMedia('(prefers-color-scheme: light)');
      var fn = function () { if (!saved()) apply(preferred()); };
      mq.addEventListener ? mq.addEventListener('change', fn) : mq.addListener && mq.addListener(fn);
    }
  }
  if (d.readyState === 'loading') d.addEventListener('DOMContentLoaded', init); else init();

  return { setTheme: setTheme, modal: { open: open, close: close } };
})();
