const grid = document.getElementById('pixelGrid');
const buyButton = document.getElementById('buyButton');
const contactButton = document.getElementById('contactButton');
const infoForm = document.getElementById('infoForm');
const influencerForm = document.getElementById('influencerForm');
const cancelForm = document.getElementById('cancelForm');
const priceLine = document.getElementById('priceLine');
const pixelsLeftEl = document.getElementById('pixelsLeft');
const paymentUrl = 'https://paypal.me/YourUSAccount'; // TODO: set yours

const TOTAL_PIXELS = 1_000_000; // 100x100 blocks * 100 pixels each
//const DATA_VERSION = 4; // bump to invalidate cache on JSON
const DATA_VERSION = 5;

// +$0.01 every 1,000 pixels = every 10 blocks
function getBlocksSold() { return Object.keys(purchasedBlocks).length; } // 1 block = 100 px
function getCurrentPixelPrice() {
  const steps = Math.floor(getBlocksSold() / 10); // 10 blocks = 1,000 px
  const price = 1 + steps * 0.01;
  return Math.round(price * 100) / 100;
}
function getCurrentBlockPrice() { return Math.round(getCurrentPixelPrice() * 100 * 100) / 100; }
function formatUSD(n) { return '$' + n.toFixed(2); }
function refreshHeaderPricing() {
  const p = getCurrentPixelPrice();
  priceLine.textContent = `1 Pixel = ${formatUSD(p)}`;
}
function refreshPixelsLeft() {
  const left = TOTAL_PIXELS - getBlocksSold() * 100;
  pixelsLeftEl.textContent = `${left.toLocaleString()} pixels left`;
}

let purchasedBlocks = {};
fetch(`data/purchasedBlocks.json?v=${DATA_VERSION}`)
  .then(async (r) => {
    if (!r.ok) throw new Error(`HTTP ${r.status} fetching purchasedBlocks.json`);
    return r.json();
  })
  .then((data) => {
    purchasedBlocks = data;
    document.title = `Influencers Wall – ${Object.keys(purchasedBlocks).length} sold`;
    renderGrid(); refreshHeaderPricing(); refreshPixelsLeft(); updateBuyButtonLabel();
  })
  .catch((err) => {
    alert('Error loading purchasedBlocks.json: ' + err.message);
    purchasedBlocks = {}; // fallback
    renderGrid(); refreshHeaderPricing(); refreshPixelsLeft(); updateBuyButtonLabel();
  });

function renderGrid() {
  for (let i = 0; i < 10000; i++) {
    const index = i;
    const info = purchasedBlocks[index];
    let block;

    if (info) {
      // Sold block: clickable <a> with background image
      block = document.createElement('a');
      block.href = info.linkUrl || '#';
      block.target = '_blank';
      block.className = 'block sold';
      // DEBUG: colorer le bloc vendu si l’image ne charge pas
block.style.backgroundColor = '#8b5cf6';
      block.style.backgroundImage = `url(${info.imageUrl})`;
      block.title = info.linkUrl || '';
    } else {
      // Free block: selectable <div>
      block = document.createElement('div');
      block.className = 'block';
      block.addEventListener('click', () => {
        block.classList.toggle('selected');
        updateBuyButtonLabel();
      });
    }

    block.dataset.index = index;
    grid.appendChild(block);
  }

  buyButton.addEventListener('click', () => {
    const selected = Array.from(document.querySelectorAll('.block.selected')).map(el => parseInt(el.dataset.index));
    if (!selected.length) { alert('Please select at least one free block.'); return; }
    infoForm.classList.remove('hidden');
    document.getElementById('blockIndex').value = selected.join(',');
  });

  contactButton.addEventListener('click', () => {
    window.location.href = 'mailto:you@domain.com';
  });

  cancelForm.addEventListener('click', () => {
    infoForm.classList.add('hidden');
  });

  // Netlify: store submission, then redirect to PayPal
  influencerForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const data = new FormData(influencerForm);
    try {
      await fetch(influencerForm.action || '/', { method: 'POST', body: data });
    } catch (err) {
      console.error('Netlify form post failed:', err);
    }
    const blocks = data.get('blockIndex').split(',');
    const total = Math.round(getCurrentBlockPrice() * blocks.length * 100) / 100;
    const note = `blocks-${blocks.join(',')}`;
    window.location.href = `${paymentUrl}/${total}?note=${note}`;
  });
}

function updateBuyButtonLabel() {
  const count = document.querySelectorAll('.block.selected').length;
  if (count === 0) {
    buyButton.textContent = 'Buy Pixels';
  } else {
    const total = getCurrentBlockPrice() * count;
    buyButton.textContent = `Buy ${count} block${count>1?'s':''} (${count*100} px) – ${formatUSD(total)}`;
  }
}
