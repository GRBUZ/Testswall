// === Reserve-on-click + 3-min expiry + robust unlock on exit ===
// - DATA_VERSION bumped to 13 (cache bust)
// - Polling at 1s for near-instant updates
// - navigator.sendBeacon to unlock on tab close
// - Keep track of myReservedSet + reservationId (persist in localStorage)
// - Deterministic grid (10k cells)

const grid = document.getElementById('pixelGrid');
const regionsLayer = document.getElementById('regionsLayer');
const buyButton = document.getElementById('buyButton');
const contactButton = document.getElementById('contactButton');
const infoForm = document.getElementById('infoForm');
const influencerForm = document.getElementById('influencerForm');
const cancelForm = document.getElementById('cancelForm');
const priceLine = document.getElementById('priceLine');
const pixelsLeftEl = document.getElementById('pixelsLeft');
const paymentUrl = 'https://paypal.me/YourUSAccount'; // TODO

const TOTAL_PIXELS = 1_000_000;
const DATA_VERSION = 13;
const GRID_SIZE = 100;
const CELL_PX = 10;
const STATUS_POLL_MS = 1000;

let cellsMap = {};
let regions = [];
let pendingSet = new Set();     // all pending (everyone)
let myReservedSet = new Set();  // only my reserved blocks
let activeReservationId = localStorage.getItem('iw_reservation_id') || null;
let lastStatusAt = 0;

function committedSoldSet() {
  const set = new Set();
  for (const k of Object.keys(cellsMap)) set.add(+k);
  for (const r of regions) {
    const start = (r.start|0), w = Math.max(1, r.w|0), h = Math.max(1, r.h|0);
    const sr = Math.floor(start / GRID_SIZE), sc = start % GRID_SIZE;
    for (let dy = 0; dy < h; dy++) for (let dx = 0; dx < w; dx++) set.add((sr+dy)*GRID_SIZE+(sc+dx));
  }
  return set;
}
function takenSet() { const s = committedSoldSet(); for (const b of pendingSet) s.add(+b); return s; }
function getBlocksSold() { return committedSoldSet().size; }
function getCurrentPixelPrice() { const steps = Math.floor(getBlocksSold() / 10); return Math.round((1 + steps * 0.01) * 100) / 100; }
function getCurrentBlockPrice() { return Math.round(getCurrentPixelPrice() * 100 * 100) / 100; }
function formatUSD(n) { return '$' + n.toFixed(2); }
function refreshHeaderPricing() { priceLine.textContent = `1 Pixel = ${formatUSD(getCurrentPixelPrice())}`; }
function refreshPixelsLeft() { const left = TOTAL_PIXELS - getBlocksSold() * 100; pixelsLeftEl.textContent = `${left.toLocaleString()} pixels left`; }

async function loadStatus() {
  try {
    const r = await fetch('/.netlify/functions/status', { cache:'no-store' });
    const s = await r.json();
    pendingSet = new Set((s && s.pending) || []);
    lastStatusAt = Date.now();
  } catch (e) {
    console.warn('status fetch failed', e);
  }
}
async function maybeRefreshStatus(maxAgeMs = 500) { if (Date.now() - lastStatusAt > maxAgeMs) await loadStatus(); }

async function loadData() {
  const r = await fetch(`data/purchasedBlocks.json?v=${DATA_VERSION}`, { cache: 'no-store' });
  if (!r.ok) throw new Error(`HTTP ${r.status} fetching purchasedBlocks.json`);
  const data = await r.json();
  if (data && (data.cells || data.regions)) { cellsMap = data.cells || {}; regions = data.regions || []; }
  else { cellsMap = data || {}; regions = []; }
}

function renderGrid() {
  const sold = committedSoldSet();

  grid.innerHTML = '';
  for (let i = 0; i < GRID_SIZE * GRID_SIZE; i++) {
    const el = document.createElement('div');
    el.className = 'block';
    el.dataset.index = i;

    const isSold = sold.has(i);
    const isMine = myReservedSet.has(i);
    const isPending = pendingSet.has(i);

    if (isSold) {
      el.classList.add('sold'); el.title = 'Sold';
    } else if (isMine) {
      el.classList.add('pending', 'selected');
      el.title = 'Your selection (reserved)';
      el.addEventListener('click', () => removeOne(i));
    } else if (isPending) {
      el.classList.add('pending'); el.title = 'Reserved (pending)';
    } else {
      el.addEventListener('click', () => addOne(i));
    }
    grid.appendChild(el);
  }

  // Overlay (sold regions/images)
  regionsLayer.innerHTML = '';
  for (const [k, info] of Object.entries(cellsMap)) {
    const idx = +k;
    const row = Math.floor(idx / GRID_SIZE), col = idx % GRID_SIZE;
    const a = document.createElement('a');
    a.href = info.linkUrl || '#'; a.target = '_blank'; a.className = 'region';
    a.style.left = (col * CELL_PX) + 'px'; a.style.top = (row * CELL_PX) + 'px';
    a.style.width = CELL_PX + 'px'; a.style.height = CELL_PX + 'px';
    a.style.backgroundImage = `url(${info.imageUrl})`; a.title = info.linkUrl || '';
    regionsLayer.appendChild(a);
  }
  for (const r of regions) {
    const start = (r.start|0), w = Math.max(1, r.w|0), h = Math.max(1, r.h|0);
    const row = Math.floor(start / GRID_SIZE), col = start % GRID_SIZE;
    const a = document.createElement('a');
    a.href = r.linkUrl || '#'; a.target = '_blank'; a.className = 'region';
    a.style.left = (col * CELL_PX) + 'px'; a.style.top = (row * CELL_PX) + 'px';
    a.style.width = (w * CELL_PX) + 'px'; a.style.height = (h * CELL_PX) + 'px';
    a.style.backgroundImage = `url(${r.imageUrl})`; a.title = r.linkUrl || '';
    regionsLayer.appendChild(a);
  }

  updateBuyButtonLabel();
}

async function addOne(idx) {
  await maybeRefreshStatus(0);
  const sold = committedSoldSet();
  if (pendingSet.has(idx) || sold.has(idx)) { renderGrid(); return; }
  try {
    const r = await fetch('/.netlify/functions/lock', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ op:'add', blocks:[idx], reservationId: activeReservationId || undefined })
    });
    const res = await r.json();
    if (!r.ok) { if (r.status === 409) { await loadStatus(); renderGrid(); return; } throw new Error(res.error || ('HTTP '+r.status)); }
    activeReservationId = res.reservationId || activeReservationId;
    localStorage.setItem('iw_reservation_id', activeReservationId);
    myReservedSet = new Set(res.blocks || []);
    for (const b of myReservedSet) pendingSet.add(b);
    localStorage.setItem('iw_my_blocks', JSON.stringify(Array.from(myReservedSet)));
    renderGrid();
  } catch (e) { alert('Reservation error: ' + e.message); }
}

async function removeOne(idx) {
  try {
    const r = await fetch('/.netlify/functions/lock', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ op:'remove', blocks:[idx], reservationId: activeReservationId })
    });
    const res = await r.json();
    if (!r.ok) throw new Error(res.error || ('HTTP '+r.status));
    if (!res.reservationId) {
      // Reservation deleted
      activeReservationId = null; localStorage.removeItem('iw_reservation_id');
      myReservedSet = new Set(); localStorage.removeItem('iw_my_blocks');
      await loadStatus(); renderGrid(); return;
    }
    activeReservationId = res.reservationId; localStorage.setItem('iw_reservation_id', activeReservationId);
    myReservedSet = new Set(res.blocks || []); localStorage.setItem('iw_my_blocks', JSON.stringify(Array.from(myReservedSet)));
    pendingSet = new Set([...pendingSet].filter(b => b !== idx)); for (const b of myReservedSet) pendingSet.add(b);
    renderGrid();
  } catch (e) { alert('Unreserve error: ' + e.message); }
}

function selectedCount() { return myReservedSet.size; }
function updateBuyButtonLabel() {
  const count = selectedCount();
  if (count === 0) buyButton.textContent = 'Buy Pixels';
  else buyButton.textContent = `Buy ${count} block${count>1?'s':''} (${count*100} px) – ${formatUSD(getCurrentBlockPrice()*count)}`;
}

async function onBuyClick() {
  const count = selectedCount();
  if (!activeReservationId || count === 0) { alert('Please select blocks first.'); return; }
  infoForm.classList.remove('hidden');
  document.getElementById('blockIndex').value = Array.from(myReservedSet).join(',');
}

async function onCancel() {
  infoForm.classList.add('hidden');
  if (activeReservationId) {
    try {
      await fetch('/.netlify/functions/unlock', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ reservationId: activeReservationId })
      });
    } catch {}
    activeReservationId = null; localStorage.removeItem('iw_reservation_id');
    myReservedSet = new Set(); localStorage.removeItem('iw_my_blocks');
    await loadStatus(); renderGrid();
  }
}

influencerForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const data = new FormData(influencerForm);
  try { await fetch(influencerForm.action || '/', { method: 'POST', body: data }); } catch {}
  const blocks = Array.from(myReservedSet);
  const total = Math.round(getCurrentBlockPrice() * blocks.length * 100) / 100;
  const note = `blocks-${blocks.join(',')}`;
  window.location.href = `${paymentUrl}/${total}?note=${note}`;
});

(async () => {
  try { await Promise.all([loadData(), loadStatus()]); } catch (e) { alert('Init failed: ' + e.message); }
  // Restore my selection from storage (best effort)
  try {
    const saved = JSON.parse(localStorage.getItem('iw_my_blocks') || '[]');
    if (Array.isArray(saved)) myReservedSet = new Set(saved.map(n=>+n).filter(n=>Number.isInteger(n)));
  } catch {}
  document.title = `Influencers Wall – ${getBlocksSold()} blocks sold`;
  renderGrid(); refreshHeaderPricing(); refreshPixelsLeft(); updateBuyButtonLabel();

  buyButton.addEventListener('click', onBuyClick);
  contactButton.addEventListener('click', () => { window.location.href = 'mailto:you@domain.com'; });
  cancelForm.addEventListener('click', onCancel);

  setInterval(async () => {
    const before = JSON.stringify([...pendingSet].sort());
    await loadStatus();
    const after = JSON.stringify([...pendingSet].sort());
    if (before !== after) { renderGrid(); }
  }, STATUS_POLL_MS);
})();

// Robust unlock on exit using sendBeacon
window.addEventListener('pagehide', () => {
  if (!activeReservationId) return;
  try {
    const payload = JSON.stringify({ reservationId: activeReservationId });
    const blob = new Blob([payload], { type: 'application/json' });
    navigator.sendBeacon('/.netlify/functions/unlock', blob);
  } catch {}
});
