// Overlay helpers (safe defaults if CSS missing)
(function ensureOverlaySizing(){
  try {
    const rl = document.getElementById('regionsLayer');
    const pg = document.getElementById('pixelGrid');
    if (rl) {
      rl.style.position = rl.style.position || 'absolute';
      if (!rl.style.inset) rl.style.inset = '0';
      rl.style.zIndex = rl.style.zIndex || '20';
    }
    if (pg) {
      pg.style.position = pg.style.position || 'relative';
      pg.style.zIndex = pg.style.zIndex || '10';
    }
  } catch {}
})();
