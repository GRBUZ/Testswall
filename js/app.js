// === Reserve-on-click frontend patch ===
// - Clicking a free block immediately calls the lock function (op:add) and marks it PENDING if success.
// - Clicking again (selected) removes it from the reservation (op:remove).
// - No more "select then reserve later": reservation exists as you select.
// - Uses a single reservationId per session until cancel/submit.

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

function renderGrid() {
  const taken = takenSet();
  const sold = committedSoldSet();

  grid.innerHTML = '';
  for (let i = 0; i < GRID_SIZE * GRID_SIZE; i++) {
    const el = document.createElement('div');
    el.className = 'block';
    el.dataset.index = i;

    if (sold.has(i)) {
      el.classList.add('sold'); el.title = 'Sold';
    } else if (pendingSet.has(i)) {
      el.classList.add('pending'); el.title = 'Reserved (pending)';
    } else {
      // Reserve-on-click
      el.addEventListener('click', async () => {
        const idx = parseInt(el.dataset.index);
        await maybeRefreshStatus(0);
        if (pendingSet.has(idx) || sold.has(idx)) { renderGrid(); return; }

        const isSelected = el.classList.contains('selected');
        const op = isSelected ? 'remove' : 'add';

        try {
          const r = await fetch('/.netlify/functions/lock', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ op, blocks: [idx], reservationId: activeReservationId || undefined })
          });
          const res = await r.json();
          if (!r.ok) {
            if (r.status === 409 && res.conflicts) {
              alert('Just reserved by someone else.');
              await loadStatus(); renderGrid(); return;
            }
            throw new Error(res.error || ('HTTP '+r.status));
          }
          // Created or updated reservation
          activeReservationId = res.reservationId || activeReservationId;

          if (op === 'add') {
            pendingSet.add(idx);
            el.classList.add('selected');
          } else {
            pendingSet.delete(idx);
            el.classList.remove('selected');
          }
          renderGrid(); updateBuyButtonLabel();
        } catch (e) {
          alert('Reservation error: ' + e.message);
        }
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
    a.style.left = (col * 10) + 'px'; a.style.top = (row * 10) + 'px';
    a.style.width = '10px'; a.style.height = '10px';
    a.style.backgroundImage = `url(${info.imageUrl})`;
    a.title = info.linkUrl || '';
    regionsLayer.appendChild(a);
  }
  for (const r of regions) {
    const start = (r.start|0), w = Math.max(1, r.w|0), h = Math.max(1, r.h|0);
    const row = Math.floor(start / GRID_SIZE), col = start % GRID_SIZE;
    const a = document.createElement('a');
    a.href = r.linkUrl || '#'; a.target = '_blank'; a.className = 'region';
    a.style.left = (col * 10) + 'px'; a.style.top = (row * 10) + 'px';
    a.style.width = (w * 10) + 'px'; a.style.height = (h * 10) + 'px';
    a.style.backgroundImage = `url(${r.imageUrl})`; a.title = r.linkUrl || '';
    regionsLayer.appendChild(a);
  }
}

function selectedCount() {
  // Selected = blocks in our active reservation that we also mark with .selected locally.
  return document.querySelectorAll('.block.selected').length;
}

function updateBuyButtonLabel() {
  const count = selectedCount();
  if (count === 0) buyButton.textContent = 'Buy Pixels';
  else buyButton.textContent = `Buy ${count} block${count>1?'s':''} (${count*100} px) – ${formatUSD(getCurrentBlockPrice()*count)}`;
}

async function onBuyClick() {
  const count = selectedCount();
  if (!activeReservationId || count === 0) { alert('Please select blocks first.'); return; }
  infoForm.classList.remove('hidden');
  // Fill hidden field with current selected indices
  const selected = Array.from(document.querySelectorAll('.block.selected')).map(el => parseInt(el.dataset.index));
  document.getElementById('blockIndex').value = selected.join(',');
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
    // clear our local selections
    pendingSet = new Set();
    renderGrid(); updateBuyButtonLabel();
    await loadStatus(); renderGrid(); updateBuyButtonLabel();
  }
}

// Netlify: store submission, then redirect to PayPal
influencerForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const data = new FormData(influencerForm);
  try { await fetch(influencerForm.action || '/', { method: 'POST', body: data }); } catch {}
  // Keep reservation until payment webhook converts to SOLD or expires
  //const blocks = (data.get('blockIndex') || '').split(',').filter(Boolean); juste pour enlever le paiement (enleve le comment apres)
  //const total = Math.round(getCurrentBlockPrice() * blocks.length * 100) / 100;juste pour enlever le paiement (enleve le comment apres)
  //const note = `blocks-${blocks.join(',')}`;juste pour enlever le paiement (enleve le comment apres)
  //window.location.href = `${paymentUrl}/${total}?note=${note}`;juste pour enlever le paiement (enleve le comment apres)
    window.location.href = influencerForm.action || '/success.html'; // test: page de succès
});

/* ---------- Init ---------- */
(async () => {
  try { await Promise.all([loadData(), loadStatus()]); } catch (e) { alert('Init failed: ' + e.message); }
  document.title = `Influencers Wall – ${getBlocksSold()} blocks sold`;
  renderGrid(); refreshHeaderPricing(); refreshPixelsLeft(); updateBuyButtonLabel();

  buyButton.addEventListener('click', onBuyClick);
  contactButton.addEventListener('click', () => { window.location.href = 'mailto:you@domain.com'; });
  cancelForm.addEventListener('click', onCancel);

  // Poll server to keep pendingSet in sync across users
  setInterval(async () => {
    const before = JSON.stringify([...pendingSet].sort());
    await loadStatus();
    const after = JSON.stringify([...pendingSet].sort());
    if (before !== after) { renderGrid(); updateBuyButtonLabel(); }
  }, STATUS_POLL_MS);
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
