# Design: Crop Feature + Publish Persistence Fix

**Date:** 2026-02-23
**Branch:** feature/image-adjustments (or new branch off main)
**Status:** Approved

---

## Overview

Two features in one plan:

1. **Non-destructive crop** — drag-handle UI inside the Edit Image panel, applies to both thumbnail and lightbox
2. **Publish persistence fix** — three bugs causing published layouts to not survive a fresh load on a different browser/device

---

## Part 1: Non-Destructive Crop

### Data Model

A new `_cropRect` object is stored on each gallery item element:

```js
item._cropRect = { x: 20, y: 10, w: 60, h: 80 }  // percentages, 0–100
```

- `x`, `y` = top-left corner of crop region (% of original image)
- `w`, `h` = width and height of crop region (% of original image)
- Default (no crop): `null` — treated as full image

This is **separate** from the existing `_cropState` / `object-position` pan system (Shift+drag, cycle presets). The existing pan system remains untouched. `_cropRect` is the authoritative crop for both thumbnail and lightbox.

### Persistence

`_cropRect` is serialized in both `saveState()` (localStorage) and `publishLayout()` (KV via Worker PUT):

```js
// in saveState / publishLayout entry:
if (item._cropRect) entry.cropRect = item._cropRect;
```

On load, `restoreState()` reads `entry.cropRect` and calls `applyThumbnailCrop(item, cropRect)`.

The old `crop` field (object-position string) is kept for backward compatibility on existing published galleries.

### Thumbnail Rendering

`applyThumbnailCrop(item, cropRect)`:

```js
var cx = cropRect.x + cropRect.w / 2;   // crop center X %
var cy = cropRect.y + cropRect.h / 2;   // crop center Y %
var scale = Math.min(100 / cropRect.w, 100 / cropRect.h);
img.style.objectPosition = cx + "% " + cy + "%";
img.style.transform = "scale(" + scale.toFixed(3) + ")";
img.style.transformOrigin = cx + "% " + cy + "%";
```

`object-fit: cover` + `object-position` aims at the crop center; the scale zooms in so the cropped region fills the container. No clip-path needed.

To clear: `img.style.objectPosition = ""; img.style.transform = ""; img.style.transformOrigin = "";`

### Lightbox Rendering

The gallery iframe sends crop data alongside src/alt in the postMessage to the parent Webflow page:

```js
// gallery9.js — building lightbox images array:
return {
  src:      i.src,
  alt:      i.alt || "",
  cropRect: item._cropRect || null   // NEW
};
```

The parent page (`WEBFLOW_EMBED_CODE.html`) applies the crop rect when showing a lightbox image:

```js
function applyLightboxCrop(cropRect) {
  var img = document.getElementById("lb-img");
  if (!cropRect) {
    img.style.width = "";
    img.style.height = "";
    img.style.position = "";
    img.style.left = "";
    img.style.top = "";
    img.style.transform = "";
    img.style.maxWidth = "75vw";
    img.style.maxHeight = "70vh";
    return;
  }
  // Scale image so cropped region = the available display area
  var scale = Math.min(100 / cropRect.w, 100 / cropRect.h);
  img.style.maxWidth  = "none";
  img.style.maxHeight = "none";
  img.style.width  = (75 * scale) + "vw";
  img.style.height = (70 * scale) + "vh";
  img.style.position      = "relative";
  img.style.objectFit     = "cover";
  img.style.objectPosition = (cropRect.x + cropRect.w / 2) + "% " + (cropRect.y + cropRect.h / 2) + "%";
  // Clip to just the cropped region
  var clipW = 75 + "vw";
  var clipH = 70 + "vh";
  img.style.clipPath = "inset(0 0 0 0)"; // parent container handles overflow:hidden
}
```

Simpler approach: wrap `lb-img` in an `overflow:hidden` container sized to `75vw × 70vh`, then position/scale the img inside it.

### Panel UI — Crop Tab

The existing adjust panel gets a **second tab row** at the top:

```
[ Adjust ]  [ Crop ]
```

Clicking "Crop" shows the crop view; clicking "Adjust" shows the sliders. Tab state is toggled by adding/removing a CSS class on the panel.

**Crop tab contents:**

```
┌─────────────────────────────────┐
│  [ Adjust ]  [ Crop ]           │
│ ┌─────────────────────────────┐ │
│ │                             │ │
│ │    ·─────────────────·      │ │
│ │    │  crop overlay   │      │ │
│ │    ·─────────────────·      │ │
│ │                             │ │
│ └─────────────────────────────┘ │
│  [  Reset Crop  ]  [  Apply  ]  │
└─────────────────────────────────┘
```

- Preview image: `~260×180px`, `object-fit: contain`, full image always visible
- Crop rect overlay: semi-transparent dark mask outside rect, bright border on rect
- 4 corner drag handles (12×12px squares on each corner of the rect)
- Handles are `position:absolute` divs inside the preview container

**Drag interaction:**

- `mousedown` on a corner handle → begin dragging that corner
- `mousemove` on document → update that corner's position, clamp to `[0, image bounds]`
- `mouseup` → end drag
- Live-update thumbnail via `applyThumbnailCrop()` on every `mousemove`
- Rect is stored in normalized form: `{ x, y, w, h }` where `w > 0` and `h > 0` always

**Initial state:** if `item._cropRect` exists, initialize the overlay to match. Otherwise default to full image (x:0, y:0, w:100, h:100).

### CSS

New styles in `gallery9.css`:

- `.adjust-panel .panel-tabs` — tab row
- `.adjust-panel .panel-tab` — individual tab button, `.active` modifier
- `.crop-preview-wrap` — relative container for preview + overlay
- `.crop-overlay` — absolute, full-size, semi-dark mask rendered via CSS (or canvas)
- `.crop-handle` — 12×12px corner handles, `cursor: nwse-resize` / `nesw-resize`

### Scope: what doesn't change

- Shift+drag pan (`moveCrop`) — unchanged, still works in non-crop-panel context
- Cycle presets (`cycleCrop`) — unchanged
- Export JSON — add `cropRect` field alongside existing `crop` field

---

## Part 2: Publish Persistence Fix

### Bug A — Worker `mergeLayout` drops most fields

**Root cause:** `mergeLayout` in `worker/index.js` only copies `size` and `crop` from the saved KV layout. Everything else (`colStart`, `rowStart`, `cols`, `rows`, `adjustments`, spacer entries) is discarded. The resulting GET response is nearly identical to a fresh CMS response regardless of what was published.

**Fix:** Pass all layout fields through. Spacer entries come through wholesale. Image entries get all saved fields merged in:

```js
// For image entries:
merged.push({
  id:          cmsImg.id,
  src:         cmsImg.src,      // always from CMS (authoritative URL)
  alt:         cmsImg.alt,      // always from CMS
  size:        entry.size      !== undefined ? entry.size      : cmsImg.size,
  crop:        entry.crop      || undefined,
  cropRect:    entry.cropRect  || undefined,
  colStart:    entry.colStart  || undefined,
  rowStart:    entry.rowStart  || undefined,
  cols:        entry.cols      || undefined,
  rows:        entry.rows      || undefined,
  adjustments: entry.adjustments || undefined,
});

// For spacer entries: pass through as-is (no CMS equivalent)
if (entry.type === "spacer") {
  merged.push(entry);
  return;
}
```

### Bug B — `restoreState()` (localStorage) silently overrides Worker data

**Root cause:** `init()` calls `renderGallery()` (uses Worker config), then immediately `restoreState()` (reads localStorage). In the same browser, localStorage always wins — including stale/old data from before a publish. This means:

- A publish followed by further edits that are NOT published will show the unpublished state on next reload
- Another device gets neither — it gets the stripped Worker data (Bug A)

**Fix:** After a successful PUT publish, clear the localStorage entry for this gallery so the next load is forced to use Worker data:

```js
// in publishLayout() .then() success handler:
localStorage.removeItem(STORAGE_KEY);
```

This ensures the Worker KV is the single source of truth after a publish. Local edits between publishes still work via `autoSave()` to localStorage, but publish resets the baseline.

### Bug C — Cloudflare CDN caches GET for 5 minutes

**Root cause:** Worker GET returns `Cache-Control: public, max-age=300`. After a PUT, Cloudflare's edge continues serving the stale response for up to 5 minutes.

**Fix:** Two-part:

1. Reduce `max-age` to `30` seconds (acceptable tradeoff — gallery config is small, 30s is fast enough)
2. Have `publishLayout()` display a "Published — changes live in ~30s" message instead of "Published!" to set expectations

Alternatively: store a `publishedAt` timestamp in the KV and include it in the GET response. The client can compare timestamps to know if its cached config is stale. But this adds complexity — the `max-age=30` approach is simpler and sufficient.

---

## Implementation Order

1. **Fix B** (clear localStorage on publish) — 3 lines, immediate win, no Worker deploy needed
2. **Fix A** (Worker mergeLayout) — update `worker/index.js`, deploy with `wrangler deploy`
3. **Fix C** (Cache-Control) — update `worker/index.js` alongside Fix A, same deploy
4. **Crop UI** — add tab + preview + handles to adjust panel (`gallery9.js` + `gallery9.css`)
5. **Crop thumbnail apply** — `applyThumbnailCrop()` function
6. **Crop postMessage** — include `cropRect` in lightbox postMessage payload
7. **Crop lightbox rendering** — update `WEBFLOW_EMBED_CODE.html`
8. **Crop persistence** — add `cropRect` to `saveState()`, `restoreState()`, `publishLayout()`
9. **Worker cropRect passthrough** — add `cropRect` to Fix A's merge (already included above)

---

## Files Changed

| File | Changes |
|------|---------|
| `gallery9.js` | Crop panel tab, preview, handles, drag logic, `applyThumbnailCrop()`, postMessage cropRect, saveState/restoreState/publishLayout cropRect, clear localStorage on publish |
| `gallery9.css` | Panel tab styles, crop preview, overlay, handles |
| `WEBFLOW_EMBED_CODE.html` | Apply cropRect in lightbox `showLb()` |
| `worker/index.js` | `mergeLayout` passthrough, `Cache-Control: max-age=30` |

---

## Success Criteria

- [ ] Crop handles drag freely inside preview, live-update thumbnail
- [ ] Crop applies to lightbox (parent page clips correctly)
- [ ] Crop persists through publish → fresh reload on another device
- [ ] Layout (positions, sizes, adjustments, spacers) persists through publish → fresh reload on another device
- [ ] localStorage is cleared on publish so Worker KV is the authoritative source
- [ ] Cache-Control reduced so published changes are visible within 30s
