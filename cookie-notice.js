/* cookie-notice.js — banner informativo privacy (non richiede consenso)
   Mostra una nota una volta sola. Nessun tracking, nessun cookie.
   M1: layout compatto (bottone in linea), colori da token, sopra la tab bar mobile,
   accesso a localStorage protetto (Safari privato / storage bloccato). */
(function () {
  const KEY = 'wt-privacy-notice-v1';
  try { if (localStorage.getItem(KEY)) return; } catch (e) { /* storage non disponibile: mostra la nota */ }

  const banner = document.createElement('div');
  banner.id = 'wt-cookie-notice';
  banner.setAttribute('role', 'region');
  banner.setAttribute('aria-label', 'Informativa privacy');
  banner.innerHTML =
    '<span>Questo sito non usa cookie di tracciamento. Le mappe caricano tile da CARTO/OpenStreetMap (IP trasmesso). <a href="/privacy.html" style="color:inherit;font-weight:600;">Privacy policy</a></span>' +
    '<button id="wt-cookie-ok" type="button" aria-label="Chiudi">OK</button>';

  const style = document.createElement('style');
  style.textContent = [
    '#wt-cookie-notice{',
    '  position:fixed;bottom:0;left:0;right:0;z-index:9999;',
    '  display:flex;align-items:center;justify-content:space-between;gap:12px;',
    '  padding:10px 16px;',
    '  background:var(--card,#121a22);color:var(--ink,#e8f2ff);',
    '  border-top:1px solid var(--border,#2a394d);',
    '  font-family:var(--font-sans,system-ui,sans-serif);',
    '  font-size:0.8125rem;line-height:1.4;',
    '}',
    '#wt-cookie-notice a{color:inherit;}',
    '#wt-cookie-ok{',
    '  flex-shrink:0;min-width:44px;min-height:44px;padding:0 14px;border-radius:8px;',
    '  background:var(--accent,#4fd1c5);border:0;',
    '  color:var(--on-accent,#062827);font:inherit;font-weight:700;cursor:pointer;white-space:nowrap;',
    '}',
    '@media(max-width:600px){',
    /* sopra la tab bar (se presente), mai sopra di essa */
    '  body:has(.tabbar) #wt-cookie-notice{bottom:calc(var(--tabbar-h,56px) + env(safe-area-inset-bottom));z-index:59;}',
    '}',
  ].join('');

  document.head.appendChild(style);
  document.body.appendChild(banner);

  document.getElementById('wt-cookie-ok').addEventListener('click', function () {
    try { localStorage.setItem(KEY, '1'); } catch (e) { /* ignora */ }
    banner.remove();
    style.remove();
  });
})();
