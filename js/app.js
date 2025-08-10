// === Reserve-on-click: fix regression ===
// Key changes:
// - Track your own reserved blocks in myReservedSet
// - Pending blocks that are YOURS stay clickable (to remove)
// - Buy button uses myReservedSet (not DOM .selected which gets re-rendered)
// - Deterministic 10k-cell grid

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
const DATA_VERSION = 6;
const GRID_SIZE = 100;
const CELL_PX = 10;
const STATUS_POLL_MS = 3000;

let cellsMap = {};
let regions = [];
let pendingSet = new Set();     // all pending (everyone)
let myReservedSet = new Set();  // only my reservation blocks
let activeReservationId = null;
let lastStatusAt = 0;

/* ---------- Pricing ---------- */
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

/* ---------- Data ---------- */
async function loadStatus() {
  try { const r = await fetch('/.netlify/functions/status', { cache:'no-store' }); const s = await r.json(); pendingSet = new Set((s && s.pending) || []); lastStatusAt = Date.now(); } catch {}
}
async function maybeRefreshStatus(maxAgeMs = 1000) { if (Date.now() - lastStatusAt > maxAgeMs) await loadStatus(); }
async function loadData() {
  const r = await fetch(`data/purchasedBlocks.json?v=${DATA_VERSION}`, { cache: 'no-store' });
  if (!r.ok) throw new Error(`HTTP ${r.status} fetching purchasedBlocks.json`);
  const data = await r.json();
  if (data && (data.cells || data.regions)) { cellsMap = data.cells || {}; regions = data.regions || []; }
  else { cellsMap = data || {}; regions = []; }
}

/* ---------- UI ---------- */
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
      // Your own reserved block: keep clickable to REMOVE
      el.classList.add('pending', 'selected');
      el.title = 'Your selection (reserved)';
      el.addEventListener('click', () => removeOne(i));
    } else if (isPending) {
      // Someone else’s pending: non-clickable
      el.classList.add('pending'); el.title = 'Reserved (pending)';
    } else {
      // Free: clickable to ADD
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

/* ---------- Add / Remove helpers ---------- */
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
    if (!r.ok) {
      if (r.status === 409) { await loadStatus(); renderGrid(); return; }
      throw new Error(res.error || ('HTTP '+r.status));
    }
    activeReservationId = res.reservationId || activeReservationId;
    // Trust server state: use returned array of blocks for my selection
    myReservedSet = new Set(res.blocks || []);
    // Also mark globally pending
    for (const b of myReservedSet) pendingSet.add(b);
    renderGrid();
  } catch (e) {
    alert('Reservation error: ' + e.message);
  }
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
      // Reservation deleted (empty)
      activeReservationId = null;
      myReservedSet = new Set();
      await loadStatus();
      renderGrid();
      return;
    }
    myReservedSet = new Set(res.blocks || []);
    // Sync pending with server list (remove idx at least)
    pendingSet.delete(idx);
    // But keep other pending we might have
    for (const b of myReservedSet) pendingSet.add(b);
    renderGrid();
  } catch (e) {
    alert('Unreserve error: ' + e.message);
  }
}

/* ---------- Buy / Cancel ---------- */
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
    activeReservationId = null;
    myReservedSet = new Set();
    await loadStatus();
    renderGrid();
  }
}

// Netlify: store submission, then redirect to PayPal
influencerForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const data = new FormData(influencerForm);
  try { await fetch(influencerForm.action || '/', { method: 'POST', body: data }); } catch {}
  const blocks = Array.from(myReservedSet);
  const total = Math.round(getCurrentBlockPrice() * blocks.length * 100) / 100;
  const note = `blocks-${blocks.join(',')}`;
  window.location.href = `${paymentUrl}/${total}?note=${note}`;
});

/* ---------- Init ---------- */
(async () => {
  try { await Promise.all([loadData(), loadStatus()]); } catch (e) { alert('Init failed: ' + e.message); }
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

// Free reservation if tab closes (best effort)
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
