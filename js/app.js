// === Deterministic grid patch ===
// Always render all 10,000 cells; mark SOLD/PENDING with classes (non-clickable).
// Prevents any mismatch between visual position and block index.

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
let pendingSet = new Set();
let activeReservationId = null;
let activeReservedBlocks = [];
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
function takenSet() {
  const set = committedSoldSet();
  for (const b of pendingSet) set.add(+b);
  return set;
}
function getBlocksSold() { return committedSoldSet().size; }
function getCurrentPixelPrice() {
  const steps = Math.floor(getBlocksSold() / 10);
  return Math.round((1 + steps * 0.01) * 100) / 100;
}
function getCurrentBlockPrice() { return Math.round(getCurrentPixelPrice() * 100 * 100) / 100; }
function formatUSD(n) { return '$' + n.toFixed(2); }
function refreshHeaderPricing() { priceLine.textContent = `1 Pixel = ${formatUSD(getCurrentPixelPrice())}`; }
function refreshPixelsLeft() {
  const left = TOTAL_PIXELS - getBlocksSold() * 100;
  pixelsLeftEl.textContent = `${left.toLocaleString()} pixels left`;
}

/* ---------- Data ---------- */
async function loadStatus() {
  try {
    const r = await fetch('/.netlify/functions/status', { cache: 'no-store' });
    const s = await r.json();
    pendingSet = new Set((s && s.pending) || []);
    lastStatusAt = Date.now();
  } catch {}
}
async function maybeRefreshStatus(maxAgeMs = 1000) {
  if (Date.now() - lastStatusAt > maxAgeMs) await loadStatus();
}
async function loadData() {
  const r = await fetch(`data/purchasedBlocks.json?v=${DATA_VERSION}`, { cache: 'no-store' });
  if (!r.ok) throw new Error(`HTTP ${r.status} fetching purchasedBlocks.json`);
  const data = await r.json();
  if (data && (data.cells || data.regions)) { cellsMap = data.cells || {}; regions = data.regions || []; }
  else { cellsMap = data || {}; regions = []; }
}

/* ---------- UI ---------- */
function renderGrid() {
  const taken = takenSet();
  const sold = committedSoldSet();

  grid.innerHTML = '';
  for (let i = 0; i < GRID_SIZE * GRID_SIZE; i++) {
    const el = document.createElement('div');
    el.className = 'block';
    el.dataset.index = i;

    if (sold.has(i)) {
      el.classList.add('sold');
      el.title = 'Sold';
      // Sold blocks are not clickable
    } else if (pendingSet.has(i)) {
      el.classList.add('pending');
      el.title = 'Reserved (pending)';
      // Pending blocks are not clickable
    } else {
      // Free: clickable to select
      el.addEventListener('click', () => {
        el.classList.toggle('selected');
        updateBuyButtonLabel();
      });
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
}

function selectedIndices() {
  return Array.from(document.querySelectorAll('.block.selected')).map(el => parseInt(el.dataset.index));
}

async function onBuyClick() {
  const selected = selectedIndices();
  if (!selected.length) { alert('Please select at least one free block.'); return; }

  // Server-side recheck before reserve
  await maybeRefreshStatus(0);
  const conflicts = selected.filter(b => pendingSet.has(b) || committedSoldSet().has(b));
  if (conflicts.length) {
    alert('Some blocks just got taken: ' + conflicts.join(', '));
    renderGrid(); updateBuyButtonLabel(); return;
  }

  try {
    const r = await fetch('/.netlify/functions/lock', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ blocks: selected })
    });
    const res = await r.json();
    if (!r.ok) {
      if (r.status === 409 && res.conflicts) {
        alert('Some blocks just got reserved by someone else: ' + res.conflicts.join(', '));
        await loadStatus(); renderGrid(); updateBuyButtonLabel(); return;
      }
      throw new Error(res.error || ('HTTP '+r.status));
    }

    activeReservationId = res.reservationId;
    activeReservedBlocks = selected.slice();

    // Optimistic: mark as pending locally
    for (const b of selected) pendingSet.add(b);
    renderGrid(); updateBuyButtonLabel();

    // Show form
    infoForm.classList.remove('hidden');
    document.getElementById('blockIndex').value = selected.join(',');
  } catch (e) {
    alert('Could not reserve blocks: ' + e.message);
  }
}

async function onCancel() {
  infoForm.classList.add('hidden');
  for (const b of activeReservedBlocks) pendingSet.delete(b);
  renderGrid(); updateBuyButtonLabel();

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
    await loadStatus(); renderGrid(); updateBuyButtonLabel();
  }
}

influencerForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const data = new FormData(influencerForm);
  try { await fetch(influencerForm.action || '/', { method: 'POST', body: data }); } catch {}
  
  //const blocks = (data.get('blockIndex') || '').split(',').filter(Boolean); juste pour enlever le paiement (enleve le comment apres)
  //const total = Math.round(getCurrentBlockPrice() * blocks.length * 100) / 100;juste pour enlever le paiement (enleve le comment apres)
  //const note = `blocks-${blocks.join(',')}`;juste pour enlever le paiement (enleve le comment apres)
  //window.location.href = `${paymentUrl}/${total}?note=${note}`;juste pour enlever le paiement (enleve le comment apres)
    window.location.href = influencerForm.action || '/success.html'; // test: page de succès
});

function updateBuyButtonLabel() {
  const count = selectedIndices().length;
  if (count === 0) buyButton.textContent = 'Buy Pixels';
  else buyButton.textContent = `Buy ${count} block${count>1?'s':''} (${count*100} px) – ${formatUSD(getCurrentBlockPrice()*count)}`;
}

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
    if (before !== after) { renderGrid(); updateBuyButtonLabel(); }
  }, STATUS_POLL_MS);
})();

// Optional: free reservation if tab closes
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
