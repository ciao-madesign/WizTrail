/* wiztrail-slider.js — sync --fill CSS custom property for range inputs */
(function () {
  function syncSlider(r) {
    const min  = parseFloat(r.min)  || 0;
    const max  = parseFloat(r.max)  || 100;
    const val  = parseFloat(r.value);
    const pct  = ((val - min) / (max - min)) * 100;
    r.style.setProperty('--fill', pct.toFixed(1) + '%');
  }

  function initSliders() {
    document.querySelectorAll('input[type=range]').forEach(r => {
      syncSlider(r);
      r.addEventListener('input', () => syncSlider(r));
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initSliders);
  } else {
    initSliders();
  }
})();
