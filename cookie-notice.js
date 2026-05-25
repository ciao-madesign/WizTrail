/* cookie-notice.js — banner informativo privacy (non richiede consenso)
   Mostra una nota una volta sola. Nessun tracking, nessun cookie. */
(function () {
  const KEY = 'wt-privacy-notice-v1';
  if (localStorage.getItem(KEY)) return;

  const banner = document.createElement('div');
  banner.id = 'wt-cookie-notice';
  banner.innerHTML =
    '<span>Questo sito non usa cookie di tracciamento. Le mappe caricano tile da CARTO/OpenStreetMap (IP trasmesso). <a href="/privacy.html" style="color:inherit;font-weight:600;">Privacy policy</a></span>' +
    '<button id="wt-cookie-ok" aria-label="Chiudi">OK</button>';

  const style = document.createElement('style');
  style.textContent = [
    '#wt-cookie-notice{',
    '  position:fixed;bottom:0;left:0;right:0;z-index:9999;',
    '  display:flex;align-items:center;justify-content:space-between;gap:12px;',
    '  padding:12px 20px;',
    '  background:rgba(10,15,20,0.96);',
    '  border-top:1px solid rgba(255,255,255,0.08);',
    '  font-family:var(--font-mono,"DM Mono",monospace);',
    '  font-size:0.75rem;color:rgba(255,255,255,0.7);',
    '  backdrop-filter:blur(8px);',
    '}',
    '#wt-cookie-notice a{color:rgba(255,255,255,0.9);}',
    '#wt-cookie-ok{',
    '  flex-shrink:0;padding:5px 14px;border-radius:6px;',
    '  background:rgba(255,255,255,0.1);border:1px solid rgba(255,255,255,0.15);',
    '  color:#fff;font-size:0.75rem;cursor:pointer;white-space:nowrap;',
    '}',
    '#wt-cookie-ok:hover{background:rgba(255,255,255,0.18);}',
    '@media(max-width:600px){',
    '  #wt-cookie-notice{flex-direction:column;align-items:flex-start;}',
    '}',
  ].join('');

  document.head.appendChild(style);
  document.body.appendChild(banner);

  document.getElementById('wt-cookie-ok').addEventListener('click', function () {
    localStorage.setItem(KEY, '1');
    banner.remove();
    style.remove();
  });
})();
