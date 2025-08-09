# Influencers Wall – Regions (multi-block images)

This build supports **multi-block photos** (one image spanning several blocks).

## Data format (backward compatible)
Edit `data/purchasedBlocks.json` in one of two ways:

### A) New schema (recommended)
```json
{
  "cells": {
    "50": { "imageUrl": "https://…", "linkUrl": "https://…" }
  },
  "regions": [
    { "start": 101, "w": 5, "h": 6, "imageUrl": "https://…", "linkUrl": "https://…" }
  ]
}
```
- `start` is the top-left block index (0-based).  
  `row = Math.floor(start/100)` and `col = start % 100`.
- `w`, `h` are in **blocks**, not pixels. `w=5,h=6` = **30 blocks**.

### B) Legacy schema (still works)
```json
{
  "50": { "imageUrl": "https://…", "linkUrl": "https://…" },
  "123": { "imageUrl": "https://…", "linkUrl": "https://…" }
}
```
The app will render these as 1×1 regions.

## Example (30 blocks: 5×6 rect)
Top-left at block index 200 (row 2, col 0):
```json
{
  "cells": {},
  "regions": [
    {
      "start": 200,
      "w": 5,
      "h": 6,
      "imageUrl": "https://picsum.photos/500/600?random=2",
      "linkUrl": "https://example.com"
    }
  ]
}
```

## Cache busting
- `index.html` includes `?v=6` on CSS/JS
- `js/app.js` uses `DATA_VERSION = 6` for the JSON fetch

## Debug page
Open `/debug.html` to visualize loaded **cells/regions** and image load status.
