// === Influencers Wall – Reservations hardening patch ===
// Goals:
// - Prevent selecting blocks that just became PENDING (pre-check on click)
// - Faster polling (3s) to catch other users quickly
// - Cross-tab sync via localStorage (instant within same browser)
// - Keep single binding for event listeners

const grid = document.getElementById('pixelGrid');
const regionsLayer = document.getElementById('regionsLayer');
const buyButton = document.getElementById('buyButton');
const contactButton = document.getElementById('contactButton');
const infoForm = document.getElementById('infoForm');
const influencerForm = document.getElementById('influencerForm');
const cancelForm = document.getElementById('cancelForm');
const priceLine = document.getElementById('priceLine');
const pixelsLeftEl = document.getElementById('pixelsLeft');
const paymentUrl = 'https://paypal.me/YourUSAccount'; // TODO: set yours

const TOTAL_PIXELS = 1_000_000; // 100x100 blocks * 100 pixels each
const DATA_VERSION = 6; // JSON cache buster (unchanged here)
const GRID_SIZE = 100;
const CELL_PX = 10;
const STATUS_POLL_MS = 3000;

// Data holders (back-compat: either legacy map or new {cells, regions})
let cellsMap = {};   // {"50": {imageUrl, linkUrl}, ...}
let regions = [];    // [{start, w, h, imageUrl, linkUrl}, ...]
let pendingSet = new Set(); // blocks reserved by others (server) or by us (optimistic)
let activeReservationId = null;
let activeReservedBlocks = [];
let lastStatusAt = 0;

/* ---------- Pricing ( +$0.01 per 1,000 pixels => every 10 blocks ) ---------- */
function calcSoldSetCommittedOnly() {
  // committed = sold only, used for pricing
  const set = new Set();
  for (const k of Object.keys(cellsMap)) set.add(+k);
  for (const r of regions) {
    const start = (r.start|0);
    const w = Math.max(1, r.w|0), h = Math.max(1, r.h|0);
    const sr = Math.floor(start / GRID_SIZE), sc = start % GRID_SIZE;
    for (let dy = 0; dy < h; dy++) for (let dx = 0; dx < w; dx++) set.add((sr+dy)*GRID_SIZE+(sc+dx));
  }
  return set;
}
function buildTakenSet() {
  // taken = committed SOLD + PENDING reservations (cannot be selected)
  const taken = calcSoldSetCommittedOnly();
  for (const b of pendingSet) taken.add(b);
  return taken;
}
function getBlocksSold() { return calcSoldSetCommittedOnly().size; } // 1 block = 100 px
function getCurrentPixelPrice() {
  const steps = Math.floor(getBlocksSold() / 10); // 10 blocks = 1,000 px
  const price = 1 + steps * 0.01;
  return Math.round(price * 100) / 100;
}
function getCurrentBlockPrice() { return Math.round(getCurrentPixelPrice() * 100 * 100) / 100; }
function formatUSD(n) { return '$' + n.toFixed(2); }
function refreshHeaderPricing() { priceLine.textContent = `1 Pixel = ${formatUSD(getCurrentPixelPrice())}`; }
function refreshPixelsLeft() {
  const left = TOTAL_PIXELS - getBlocksSold() * 100;
  pixelsLeftEl.textContent = `${left.toLocaleString()} pixels left`;
}

/* ---------------------- Load data + server status --------------------- */
async function loadStatus() {
  try {
    const r = await fetch('/.netlify/functions/status', { cache: 'no-store' });
    const s = await r.json();
    pendingSet = new Set(s.pending || []);
    lastStatusAt = Date.now();
  } catch (e) {
    console.warn('status fetch failed', e);
  }
}
async function maybeRefreshStatus(maxAgeMs = 1000) {
  if (Date.now() - lastStatusAt > maxAgeMs) {
    await loadStatus();
  }
}

async function loadData() {
  const r = await fetch(`data/purchasedBlocks.json?v=${DATA_VERSION}`, { cache: 'no-store' });
  if (!r.ok) throw new Error(`HTTP ${r.status} fetching purchasedBlocks.json`);
  const data = await r.json();
  if (data && (data.cells || data.regions)) {
    cellsMap = data.cells || {};
    regions = data.regions || [];
  } else {
    cellsMap = data || {};
    regions = [];
  }
}

/* ------------------------------ Grid rendering ----------------------------- */
function renderGrid() {
  const taken = buildTakenSet();

  // Base cells (only free ones are clickable)
  grid.innerHTML = '';
  for (let i = 0; i < GRID_SIZE * GRID_SIZE; i++) {
    if (taken.has(i)) continue; // skip SOLD or PENDING cells; regions overlay handles sold visuals
    const block = document.createElement('div');
    block.className = 'block';
    block.dataset.index = i;
    block.addEventListener('click', async () => {
      const idx = parseInt(block.dataset.index);
      // Fast deny if our cache already shows pending
      if (pendingSet.has(idx)) { alert('This block was just reserved.'); renderGrid(); return; }
      // Re-check server (fresh) before letting user select
      await maybeRefreshStatus(0);
      if (pendingSet.has(idx)) { alert('This block was just reserved.'); renderGrid(); return; }
      block.classList.toggle('selected');
      updateBuyButtonLabel();
    });
    grid.appendChild(block);
  }

  // Overlay: regions (multi-block images)
  regionsLayer.innerHTML = '';

  // Legacy single cells as 1×1 regions
  for (const [k, info] of Object.entries(cellsMap)) {
    const idx = +k;
    const row = Math.floor(idx / GRID_SIZE), col = idx % GRID_SIZE;
    const a = document.createElement('a');
    a.href = info.linkUrl || '#';
    a.target = '_blank';
    a.className = 'region';
    a.style.left = (col * CELL_PX) + 'px';
    a.style.top = (row * CELL_PX) + 'px';
    a.style.width = CELL_PX + 'px';
    a.style.height = CELL_PX + 'px';
    a.style.backgroundImage = `url(${info.imageUrl})`;
    a.title = info.linkUrl || '';
    regionsLayer.appendChild(a);
  }

  // New multi-block regions
  for (const r of regions) {
    const start = (r.start|0);
    const w = Math.max(1, r.w|0), h = Math.max(1, r.h|0);
    const row = Math.floor(start / GRID_SIZE), col = start % GRID_SIZE;

    const a = document.createElement('a');
    a.href = r.linkUrl || '#';
    a.target = '_blank';
    a.className = 'region';
    a.style.left = (col * CELL_PX) + 'px';
    a.style.top = (row * CELL_PX) + 'px';
    a.style.width = (w * CELL_PX) + 'px';
    a.style.height = (h * CELL_PX) + 'px';
    a.style.backgroundImage = `url(${r.imageUrl})`;
    a.title = r.linkUrl || '';
    regionsLayer.appendChild(a);
  }
}

function selectedIndices() {
  return Array.from(document.querySelectorAll('.block.selected')).map(el => parseInt(el.dataset.index));
}

async function onBuyClick() {
  const selected = selectedIndices();
  if (!selected.length) { alert('Please select at least one free block.'); return; }

  // Double-check with server before attempting lock
  await maybeRefreshStatus(0);
  const conflictLocal = selected.filter(b => pendingSet.has(b));
  if (conflictLocal.length) {
    alert('Some blocks were just reserved: ' + conflictLocal.join(', '));
    renderGrid(); updateBuyButtonLabel(); return;
  }

  try {
    const r = await fetch('/.netlify/functions/lock', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ blocks: selected })
    });
    if (!r.ok) {
      const err = await r.json().catch(() => ({}));
      if (r.status === 409 && err.conflicts) {
        alert('Some blocks just got reserved by someone else: ' + err.conflicts.join(', '));
        await loadStatus(); // refresh pending from server
        renderGrid(); updateBuyButtonLabel();
        return;
      }
      throw new Error(err.error || ('HTTP '+r.status));
    }
    const res = await r.json();
    activeReservationId = res.reservationId;
    activeReservedBlocks = selected.slice();

    // Mark as PENDING locally immediately
    for (const b of selected) pendingSet.add(b);
    renderGrid();
    updateBuyButtonLabel();

    // Cross-tab broadcast (same browser)
    try {
      localStorage.setItem('iw_pending_update', JSON.stringify({ op: 'add', blocks: selected, ts: Date.now() }));
    } catch {}

    // Open form
    infoForm.classList.remove('hidden');
    document.getElementById('blockIndex').value = selected.join(',');
  } catch (e) {
    alert('Could not reserve blocks: ' + e.message);
  }
}

async function onCancel() {
  infoForm.classList.add('hidden');
  // Optimistically free locally
  for (const b of activeReservedBlocks) pendingSet.delete(b);
  renderGrid(); updateBuyButtonLabel();

  // Cross-tab broadcast
  try { localStorage.setItem('iw_pending_update', JSON.stringify({ op: 'remove', blocks: activeReservedBlocks, ts: Date.now() })); } catch {}

  // Unlock reservation if we created one
  if (activeReservationId) {
    try {
      await fetch('/.netlify/functions/unlock', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ reservationId: activeReservationId })
      });
    } catch {}
    activeReservationId = null;
    activeReservedBlocks = [];
    await loadStatus();
    renderGrid(); updateBuyButtonLabel();
  }
}

// Netlify: store submission, then redirect to PayPal
influencerForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const data = new FormData(influencerForm);
  try {
    await fetch(influencerForm.action || '/', { method: 'POST', body: data });
  } catch (err) {
    console.error('Netlify form post failed:', err);
  }
  // Keep reservation until payment webhook converts to SOLD or expires
//const blocks = (data.get('blockIndex') || '').split(',').filter(Boolean); juste pour enlever le paiement (enleve le comment apres)
  //const total = Math.round(getCurrentBlockPrice() * blocks.length * 100) / 100;juste pour enlever le paiement (enleve le comment apres)
  //const note = `blocks-${blocks.join(',')}`;juste pour enlever le paiement (enleve le comment apres)
  //window.location.href = `${paymentUrl}/${total}?note=${note}`;juste pour enlever le paiement (enleve le comment apres)
    window.location.href = influencerForm.action || '/success.html'; // test: page de succès
});

function updateBuyButtonLabel() {
  const count = selectedIndices().length;
  if (count === 0) {
    buyButton.textContent = 'Buy Pixels';
  } else {
    const total = getCurrentBlockPrice() * count;
    buyButton.textContent = `Buy ${count} block${count>1?'s':''} (${count*100} px) – ${formatUSD(total)}`;
  }
}

/* ------------------------------ One-time setup ----------------------------- */
(async () => {
  try {
    await Promise.all([loadData(), loadStatus()]);
    document.title = `Influencers Wall – ${getBlocksSold()} blocks sold`;
  } catch (err) {
    alert('Error initializing: ' + err.message);
  }
  // Initial render and UI setup
  renderGrid(); refreshHeaderPricing(); refreshPixelsLeft(); updateBuyButtonLabel();

  // Bind handlers ONCE
  buyButton.addEventListener('click', onBuyClick);
  contactButton.addEventListener('click', () => { window.location.href = 'mailto:you@domain.com'; });
  cancelForm.addEventListener('click', onCancel);

  // Poll server every 3s to keep pending locks fresh for everyone
  setInterval(async () => {
    const before = JSON.stringify([...pendingSet].sort());
    await loadStatus();
    const after = JSON.stringify([...pendingSet].sort());
    if (before !== after) { renderGrid(); updateBuyButtonLabel(); }
  }, STATUS_POLL_MS);

  // Cross-tab (same browser) instant sync
  window.addEventListener('storage', (e) => {
    if (e.key !== 'iw_pending_update' || !e.newValue) return;
    try {
      const { op, blocks } = JSON.parse(e.newValue);
      if (Array.isArray(blocks)) {
        if (op === 'add') blocks.forEach(b => pendingSet.add(b));
        if (op === 'remove') blocks.forEach(b => pendingSet.delete(b));
        renderGrid(); updateBuyButtonLabel();
      }
    } catch {}
  });
})();

// Free reservation if tab closes
window.addEventListener('pagehide', async () => {
  if (!activeReservationId) return;
  try {
    await fetch('/.netlify/functions/unlock', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ reservationId: activeReservationId })
    });
  } catch {}
});
