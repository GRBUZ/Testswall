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
const DATA_VERSION = 6; // bump to invalidate cache on JSON
const GRID_SIZE = 100;
const CELL_PX = 10;

// Data holders (back-compat: either legacy map or new {cells, regions})
let cellsMap = {};   // {"50": {imageUrl, linkUrl}, ...}
let regions = [];    // [{start, w, h, imageUrl, linkUrl}, ...]
let pendingSet = new Set(); // blocks reserved by other users (server)
let activeReservationId = null;
let activeReservedBlocks = [];

/* ---------- Pricing ( +$0.01 per 1,000 pixels => every 10 blocks ) ---------- */
function buildSoldSet() {
  const set = new Set();
  for (const k of Object.keys(cellsMap)) set.add(+k);
  for (const r of regions) {
    const start = (r.start|0);
    const w = Math.max(1, r.w|0), h = Math.max(1, r.h|0);
    const sr = Math.floor(start / GRID_SIZE), sc = start % GRID_SIZE;
    for (let dy = 0; dy < h; dy++) {
      for (let dx = 0; dx < w; dx++) {
        const rr = sr + dy, cc = sc + dx;
        if (rr >= 0 && rr < GRID_SIZE && cc >= 0 && cc < GRID_SIZE) {
          set.add(rr * GRID_SIZE + cc);
        }
      }
    }
  }
  // add pending locks
  for (const b of pendingSet) set.add(b);
  return set;
}
function getBlocksSold() { 
  // sold = committed only, for pricing; pending doesn't change price
  const set = new Set();
  for (const k of Object.keys(cellsMap)) set.add(+k);
  for (const r of regions) {
    const start = (r.start|0);
    const w = Math.max(1, r.w|0), h = Math.max(1, r.h|0);
    const sr = Math.floor(start / GRID_SIZE), sc = start % GRID_SIZE;
    for (let dy = 0; dy < h; dy++) for (let dx = 0; dx < w; dx++) set.add((sr+dy)*GRID_SIZE+(sc+dx));
  }
  return set.size;
}
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
    const r = await fetch('/.netlify/functions/status');
    const s = await r.json();
    pendingSet = new Set(s.pending || []);
  } catch (e) {
    console.warn('status fetch failed', e);
    pendingSet = new Set();
  }
}

async function loadData() {
  const r = await fetch(`data/purchasedBlocks.json?v=${DATA_VERSION}`);
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

(async () => {
  try {
    await Promise.all([loadData(), loadStatus()]);
    document.title = `Influencers Wall – ${getBlocksSold()} blocks sold`;
    renderGrid(); refreshHeaderPricing(); refreshPixelsLeft(); updateBuyButtonLabel();
  } catch (err) {
    alert('Error initializing: ' + err.message);
    renderGrid();
  }
})();

/* ------------------------------ Grid rendering ----------------------------- */
function renderGrid() {
  const taken = buildSoldSet();

  // Base cells (only free ones are clickable)
  grid.innerHTML = '';
  for (let i = 0; i < GRID_SIZE * GRID_SIZE; i++) {
    if (taken.has(i)) continue; // skip sold or pending cells; regions will overlay
    const block = document.createElement('div');
    block.className = 'block';
    block.dataset.index = i;
    block.addEventListener('click', () => {
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

  // Buttons
  buyButton.addEventListener('click', onBuyClick);
  contactButton.addEventListener('click', () => { window.location.href = 'mailto:you@domain.com'; });
  cancelForm.addEventListener('click', onCancel);
}

function selectedIndices() {
  return Array.from(document.querySelectorAll('.block.selected')).map(el => parseInt(el.dataset.index));
}

async function onBuyClick() {
  const selected = selectedIndices();
  if (!selected.length) { alert('Please select at least one free block.'); return; }

  // Try to lock on server
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
        renderGrid();
        return;
      }
      throw new Error(err.error || ('HTTP '+r.status));
    }
    const res = await r.json();
    activeReservationId = res.reservationId;
    activeReservedBlocks = selected;
    infoForm.classList.remove('hidden');
    document.getElementById('blockIndex').value = selected.join(',');
  } catch (e) {
    alert('Could not reserve blocks: ' + e.message);
  }
}

async function onCancel() {
  infoForm.classList.add('hidden');
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
    renderGrid();
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
  const blocks = (data.get('blockIndex') || '').split(',').filter(Boolean);
  const total = Math.round(getCurrentBlockPrice() * blocks.length * 100) / 100;
  const note = `blocks-${blocks.join(',')}`;
  window.location.href = `${paymentUrl}/${total}?note=${note}`;
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
