# Crop Feature + Publish Persistence Fix Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix three publish-persistence bugs so layouts survive a fresh load on any device, then add a non-destructive crop tool with drag handles in the Edit Image panel that applies to both thumbnail and lightbox.

**Architecture:** Publish persistence is fixed in three layers: clear localStorage on publish (gallery9.js), pass all layout fields through `mergeLayout` (worker/index.js), reduce CDN cache TTL (worker/index.js). Crop stores a `_cropRect` `{x,y,w,h}` percentage object on the item DOM node; thumbnail rendering uses `object-position` + `transform:scale`; lightbox receives `cropRect` via postMessage; the adjust panel gains a "Crop" tab with a drag-handle preview.

**Tech Stack:** Vanilla JS (ES5, IIFE), CSS, Cloudflare Workers KV, Wrangler CLI for worker deploy.

---

## Task 1: Fix B — Clear localStorage on publish

**Files:**
- Modify: `gallery9.js` around line 2674 (the `.then()` success handler inside `publishLayout()`)

**Context:** `publishLayout()` does a `fetch(WORKER_URL + "/" + ..., { method: "PUT", ... })`. The `.then()` success handler currently just updates the button text. We need to add `localStorage.removeItem(STORAGE_KEY)` there so the next page load reads from Worker KV instead of stale local state.

**Step 1: Locate the exact success handler**

Open `gallery9.js` and find the `publishLayout()` function (~line 2608). The success `.then()` looks like:

```js
.then(function () {
  if (btn) {
    btn.textContent = "Published!";
    setTimeout(function () { btn.textContent = "Publish"; }, 2000);
  }
})
```

**Step 2: Edit the success handler**

Replace that block with:

```js
.then(function () {
  localStorage.removeItem(STORAGE_KEY);
  if (btn) {
    btn.textContent = "Published \u2014 live in ~30s";
    setTimeout(function () { btn.textContent = "Publish"; }, 3000);
  }
})
```

The message change sets correct expectations for Bug C (CDN cache, fixed in Task 2).

**Step 3: Verify manually**

Open the gallery in edit mode (`?edit`), make a change, click Publish. Open browser DevTools → Application → Local Storage. Confirm the `galleryLayout_<slug>` key is gone after publish.

**Step 4: Commit**

```bash
git add gallery9.js
git commit -m "fix: clear localStorage on publish so KV is authoritative source"
```

---

## Task 2: Fix A + C — Worker mergeLayout passthrough + Cache-Control

**Files:**
- Modify: `worker/index.js` — `mergeLayout()` function (~line 161) and GET response `Cache-Control` (~line 147)

**Context:** `mergeLayout` currently only passes `size` and `crop` from the KV layout back to the GET response. All positioning, adjustments, and spacer entries are dropped. The GET response also caches for 5 minutes (`max-age=300`).

**Step 1: Replace the mergeLayout function**

Find `mergeLayout` (~line 161). Replace the entire function body with:

```js
function mergeLayout(cmsImages, layout) {
  const cmsMap = {};
  cmsImages.forEach(function (img) {
    cmsMap[img.id] = img;
  });

  const merged = [];
  const usedIds = {};

  layout.forEach(function (entry) {
    // Spacer entries have no CMS equivalent — pass through as-is
    if (entry.type === "spacer") {
      merged.push(entry);
      return;
    }

    const cmsImg = cmsMap[entry.id];
    if (!cmsImg) return; // image removed from CMS — skip

    // src and alt always come from CMS (authoritative URLs)
    // all layout overrides (position, size, adjustments, crop) come from KV
    merged.push({
      id:          cmsImg.id,
      src:         cmsImg.src,
      alt:         cmsImg.alt,
      size:        entry.size        !== undefined ? entry.size        : cmsImg.size,
      crop:        entry.crop        || undefined,
      cropRect:    entry.cropRect    || undefined,
      colStart:    entry.colStart    || undefined,
      rowStart:    entry.rowStart    || undefined,
      cols:        entry.cols        || undefined,
      rows:        entry.rows        || undefined,
      adjustments: entry.adjustments || undefined,
    });

    usedIds[entry.id] = true;
  });

  // Append new CMS images not present in the saved layout
  cmsImages.forEach(function (img) {
    if (!usedIds[img.id]) {
      merged.push(img);
    }
  });

  return merged;
}
```

**Step 2: Reduce Cache-Control in handleGet**

Find the GET response (~line 143):

```js
return Response.json(config, {
  headers: {
    ...corsHeaders,
    "Content-Type": "application/json",
    "Cache-Control": "public, max-age=300",
  },
});
```

Change `max-age=300` to `max-age=30`:

```js
"Cache-Control": "public, max-age=30",
```

**Step 3: Also update restoreState() to handle the new fields from the Worker**

Open `gallery9.js`, find `restoreState()` (~line 1308). After the existing `if (entry.crop)` block (~line 1364), add handling for the new fields that now come back from the Worker:

```js
// These fields now come through from the Worker GET (mergeLayout fix)
// restoreState already handles: crop, adjustments, cols/rows, colStart/rowStart, size
// cropRect is handled by Task 5 (applyThumbnailCrop)
// No additional changes needed here for the basic persistence fix
```

Actually — `restoreState` already handles `cols`, `rows`, `colStart`, `rowStart`, `size`, `crop`, `adjustments` from the KV layout. The only new field it doesn't yet handle is `cropRect`, which is added in Task 5. So no change to `restoreState` is needed here.

**Step 4: Deploy the Worker**

```bash
cd worker
npx wrangler deploy
```

Expected output: `Deployed lot43-gallery-worker ...`

If wrangler isn't installed: `npm install -g wrangler` first.

**Step 5: Test end-to-end persistence**

1. Open gallery in edit mode in Browser A. Move an image, change a size, add a spacer. Click Publish.
2. Open the same gallery URL (no `?edit`) in Browser B (incognito or different browser).
3. Confirm layout matches what was published — correct positions, sizes, spacers all present.

**Step 6: Commit**

```bash
cd ..
git add worker/index.js
git commit -m "fix: Worker mergeLayout passes all layout fields through; reduce CDN cache to 30s"
```

---

## Task 3: Update publishLayout() to include all fields (parity with saveState)

**Files:**
- Modify: `gallery9.js` — `publishLayout()` function (~line 2608)

**Context:** `publishLayout()` currently serializes `id`, `crop`, `colStart`, `rowStart`, `size`/`cols`/`rows`, and `adjustments`. This is already correct for the base fields. This task just confirms parity and removes any remaining gaps — specifically that spacer entries include all their fields (they already do).

**Step 1: Audit publishLayout vs saveState**

Read `saveState()` (~line 1248) and `publishLayout()` (~line 2608) side by side. They are nearly identical. The only current gap is `cropRect` — which will be added in Task 6 (after the crop UI is built).

No code changes needed in this task — it's a verification step.

**Step 2: Verify via Export**

In the gallery editor, click Export → JSON. Open browser console and compare the exported JSON structure to what `saveState` writes to localStorage. Confirm fields match.

**Step 3: Commit (no-op if no changes)**

If no code changed, skip this commit.

---

## Task 4: Add Crop tab to the adjust panel (UI skeleton)

**Files:**
- Modify: `gallery9.js` — `openAdjustPanel()` function (~line 2760), `adjustPanel` HTML
- Modify: `gallery9.css` — after line 1067 (end of `#adj-apply` block)

**Context:** The adjust panel is a `<div id="adjust-panel">` built lazily on first call to `openAdjustPanel()`. Its `innerHTML` is set once. We add a tab bar at the top and a crop-tab section that is shown/hidden based on which tab is active.

**Step 1: Add CSS for tab bar and crop tab**

Append to `gallery9.css` after the last rule (line 1069):

```css
/* ── Adjust Panel: Tab Bar ── */
.panel-tabs {
  display: flex;
  gap: 0;
  margin-bottom: 12px;
  border-bottom: 1px solid #333;
}
.panel-tab {
  flex: 1;
  background: none;
  border: none;
  border-bottom: 2px solid transparent;
  color: #888;
  font-family: 'Inconsolata', monospace;
  font-size: 12px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  padding: 6px 0 8px;
  cursor: pointer;
  transition: color 0.15s, border-color 0.15s;
  margin-bottom: -1px;
}
.panel-tab:hover { color: #EDEBE0; }
.panel-tab.active {
  color: #4A90D9;
  border-bottom-color: #4A90D9;
}

/* ── Adjust Panel: Crop Tab ── */
.crop-tab-content { display: none; }
.crop-tab-content.active { display: block; }
.adjust-tab-content { display: block; }
.adjust-tab-content.hidden { display: none; }

.crop-preview-wrap {
  position: relative;
  width: 260px;
  height: 180px;
  background: #111;
  margin-bottom: 10px;
  overflow: hidden;
  user-select: none;
}
.crop-preview-img {
  width: 100%;
  height: 100%;
  object-fit: contain;
  display: block;
  pointer-events: none;
}
/* SVG overlay sits on top of image */
.crop-overlay-svg {
  position: absolute;
  top: 0; left: 0;
  width: 100%; height: 100%;
  pointer-events: none;
}
.crop-handle {
  position: absolute;
  width: 12px;
  height: 12px;
  background: #fff;
  border: 2px solid #4A90D9;
  border-radius: 2px;
  transform: translate(-50%, -50%);
  cursor: pointer;
  pointer-events: all;
  z-index: 10;
}
```

**Step 2: Update adjust panel innerHTML to include tabs and crop tab**

In `openAdjustPanel()` (~line 2768), replace the `adjustPanel.innerHTML = ...` assignment with:

```js
adjustPanel.innerHTML =
  '<div class="panel-tabs">' +
    '<button class="panel-tab active" id="adj-tab-adjust">Adjust</button>' +
    '<button class="panel-tab" id="adj-tab-crop">Crop</button>' +
  '</div>' +
  '<div class="adjust-tab-content" id="adj-adjust-section">' +
    '<div class="adjust-row"><label>Contrast</label>' +
    '<input type="range" id="adj-contrast" min="50" max="150" step="1">' +
    '<span id="adj-contrast-val"></span></div>' +
    '<div class="adjust-row"><label>Brightness</label>' +
    '<input type="range" id="adj-brightness" min="50" max="150" step="1">' +
    '<span id="adj-brightness-val"></span></div>' +
    '<div class="adjust-row"><label>Saturation</label>' +
    '<input type="range" id="adj-saturation" min="0" max="200" step="1">' +
    '<span id="adj-saturation-val"></span></div>' +
    '<div class="adjust-actions">' +
    '<button id="adj-reset">Reset</button>' +
    '<button id="adj-apply">Apply</button></div>' +
  '</div>' +
  '<div class="crop-tab-content" id="adj-crop-section">' +
    '<div class="crop-preview-wrap" id="crop-preview-wrap">' +
      '<img class="crop-preview-img" id="crop-preview-img" src="" alt="">' +
      '<svg class="crop-overlay-svg" id="crop-overlay-svg"></svg>' +
      '<div class="crop-handle" id="crop-h-tl"></div>' +
      '<div class="crop-handle" id="crop-h-tr"></div>' +
      '<div class="crop-handle" id="crop-h-bl"></div>' +
      '<div class="crop-handle" id="crop-h-br"></div>' +
    '</div>' +
    '<div class="adjust-actions">' +
    '<button id="crop-reset">Reset Crop</button>' +
    '<button id="crop-apply" style="background:#4A90D9;border-color:#4A90D9;color:#fff">Apply</button>' +
    '</div>' +
  '</div>';
```

**Step 3: Add tab-switching event listeners**

Immediately after the existing `document.getElementById("adj-apply").addEventListener(...)` block (around line 2799), add:

```js
// Tab switching
document.getElementById("adj-tab-adjust").addEventListener("click", function () {
  document.getElementById("adj-tab-adjust").classList.add("active");
  document.getElementById("adj-tab-crop").classList.remove("active");
  document.getElementById("adj-adjust-section").classList.remove("hidden");
  document.getElementById("adj-crop-section").classList.remove("active");
});
document.getElementById("adj-tab-crop").addEventListener("click", function () {
  document.getElementById("adj-tab-crop").classList.add("active");
  document.getElementById("adj-tab-adjust").classList.remove("active");
  document.getElementById("adj-adjust-section").classList.add("hidden");
  document.getElementById("adj-crop-section").classList.add("active");
  initCropTab();
});

// Crop reset / apply (wired in Task 5)
document.getElementById("crop-reset").addEventListener("click", function () {
  cropPending = { x: 0, y: 0, w: 100, h: 100 };
  renderCropOverlay();
  if (adjustTarget) applyThumbnailCrop(adjustTarget, null);
});
document.getElementById("crop-apply").addEventListener("click", function () {
  commitCrop();
  closeAdjustPanel(false);
});
```

**Step 4: Add cropPending state variable**

Near the top of the IIFE where `adjustPanel`, `adjustTarget`, `adjustPending` are declared (~line 131), add:

```js
var cropPending = { x: 0, y: 0, w: 100, h: 100 };
```

**Step 5: Update positionAdjustPanel to account for crop tab height**

Find `positionAdjustPanel` (~line 2875). Change `var panelH = 160;` to `var panelH = 260;` so the panel doesn't clip when the crop tab is taller.

**Step 6: Smoke test**

Open gallery with `?edit`, select an image, click Edit Image. Verify:
- Panel shows "Adjust" and "Crop" tabs
- Clicking "Crop" tab shows the crop section (empty preview for now)
- Clicking "Adjust" tab shows the sliders again

**Step 7: Commit**

```bash
git add gallery9.js gallery9.css
git commit -m "feat: add Crop tab skeleton to Edit Image panel"
```

---

## Task 5: Implement applyThumbnailCrop and crop overlay rendering

**Files:**
- Modify: `gallery9.js` — add new functions after `positionAdjustPanel` (~line 2885)

**Context:** This task adds the three functions that make the crop tab work: `applyThumbnailCrop` (applies crop to the gallery thumbnail), `initCropTab` (populates the preview when the tab is opened), and `renderCropOverlay` (draws the dark mask + bright rect + handle positions on the SVG overlay).

**Step 1: Add applyThumbnailCrop function**

After `positionAdjustPanel` (~line 2885), add:

```js
// ── Crop Functions ──

// Apply a cropRect { x, y, w, h } (percentages) to the thumbnail image.
// Pass null to clear any crop.
function applyThumbnailCrop(item, cropRect) {
  var img = item.querySelector("img");
  if (!cropRect || (cropRect.x === 0 && cropRect.y === 0 && cropRect.w === 100 && cropRect.h === 100)) {
    img.style.objectPosition = "";
    img.style.transform = "";
    img.style.transformOrigin = "";
    return;
  }
  var cx = cropRect.x + cropRect.w / 2;
  var cy = cropRect.y + cropRect.h / 2;
  var scale = Math.min(100 / cropRect.w, 100 / cropRect.h);
  img.style.objectPosition = cx + "% " + cy + "%";
  img.style.transform = "scale(" + scale.toFixed(4) + ")";
  img.style.transformOrigin = cx + "% " + cy + "%";
}

// Called when user clicks the Crop tab — load image into preview, init handles.
function initCropTab() {
  if (!adjustTarget) return;
  var src = adjustTarget.querySelector("img").src;
  document.getElementById("crop-preview-img").src = src;
  // Initialize from saved cropRect, or full image
  var saved = adjustTarget._cropRect;
  cropPending = saved
    ? { x: saved.x, y: saved.y, w: saved.w, h: saved.h }
    : { x: 0, y: 0, w: 100, h: 100 };
  renderCropOverlay();
  bindCropHandles();
}

// Render the SVG dark-mask overlay and position the 4 corner handles.
function renderCropOverlay() {
  var wrap = document.getElementById("crop-preview-wrap");
  var svg  = document.getElementById("crop-overlay-svg");
  if (!wrap || !svg) return;

  var W = wrap.offsetWidth;
  var H = wrap.offsetHeight;
  var r = cropPending;

  // Pixel positions of crop rect
  var x1 = (r.x / 100) * W;
  var y1 = (r.y / 100) * H;
  var x2 = ((r.x + r.w) / 100) * W;
  var y2 = ((r.y + r.h) / 100) * H;

  // SVG: dark mask with a transparent cut-out for the crop area
  // Using a clip-path rect path with an evenodd fill
  svg.innerHTML =
    '<defs>' +
      '<clipPath id="crop-cutout">' +
        '<rect x="0" y="0" width="' + W + '" height="' + H + '"/>' +
      '</clipPath>' +
    '</defs>' +
    '<rect x="0" y="0" width="' + W + '" height="' + H + '" fill="rgba(0,0,0,0.55)"/>' +
    '<rect x="' + x1 + '" y="' + y1 + '" width="' + (x2 - x1) + '" height="' + (y2 - y1) + '" fill="transparent" style="mix-blend-mode:destination-out"/>' +
    '<rect x="' + x1 + '" y="' + y1 + '" width="' + (x2 - x1) + '" height="' + (y2 - y1) + '" fill="none" stroke="#4A90D9" stroke-width="1.5"/>';

  // Note: SVG mix-blend-mode for cut-out requires isolate — simpler to use two rects
  // If the mask doesn't cut out cleanly, replace with a path using evenodd winding:
  // See Task 5 Step 2 for the evenodd fallback.

  // Position corner handles (CSS transform: translate(-50%,-50%) is in the CSS)
  setHandlePos("crop-h-tl", x1, y1);
  setHandlePos("crop-h-tr", x2, y1);
  setHandlePos("crop-h-bl", x1, y2);
  setHandlePos("crop-h-br", x2, y2);
}

function setHandlePos(id, x, y) {
  var el = document.getElementById(id);
  if (el) { el.style.left = x + "px"; el.style.top = y + "px"; }
}
```

**Step 2: If SVG mix-blend-mode cut-out doesn't work — use evenodd path fallback**

SVG `mix-blend-mode: destination-out` can be unreliable cross-browser. If the mask doesn't show a transparent window, replace the two SVG `<rect>` elements with a single `<path>` using evenodd:

```js
// Replace the svg.innerHTML assignment with:
var path =
  "M0,0 L" + W + ",0 L" + W + "," + H + " L0," + H + " Z " +
  "M" + x1 + "," + y1 + " L" + x2 + "," + y1 + " L" + x2 + "," + y2 + " L" + x1 + "," + y2 + " Z";
svg.innerHTML =
  '<path d="' + path + '" fill="rgba(0,0,0,0.55)" fill-rule="evenodd"/>' +
  '<rect x="' + x1 + '" y="' + y1 + '" width="' + (x2-x1) + '" height="' + (y2-y1) + '" fill="none" stroke="#4A90D9" stroke-width="1.5"/>';
```

Use the evenodd version — it's more reliable.

**Step 3: Add bindCropHandles function**

After `renderCropOverlay`, add:

```js
var _cropDragCorner = null;
var _cropDragStart = null;
var _cropRectStart = null;

function bindCropHandles() {
  var wrap = document.getElementById("crop-preview-wrap");
  if (!wrap) return;
  var corners = ["tl", "tr", "bl", "br"];
  corners.forEach(function (c) {
    var el = document.getElementById("crop-h-" + c);
    if (!el) return;
    el.onmousedown = function (e) {
      e.stopPropagation();
      e.preventDefault();
      _cropDragCorner = c;
      _cropDragStart = { x: e.clientX, y: e.clientY };
      _cropRectStart = { x: cropPending.x, y: cropPending.y, w: cropPending.w, h: cropPending.h };
    };
  });

  document.addEventListener("mousemove", onCropHandleMove);
  document.addEventListener("mouseup",   onCropHandleUp);
}

function onCropHandleMove(e) {
  if (!_cropDragCorner) return;
  var wrap = document.getElementById("crop-preview-wrap");
  if (!wrap) return;
  var W = wrap.offsetWidth;
  var H = wrap.offsetHeight;

  var dx = ((e.clientX - _cropDragStart.x) / W) * 100;
  var dy = ((e.clientY - _cropDragStart.y) / H) * 100;

  var r = { x: _cropRectStart.x, y: _cropRectStart.y, w: _cropRectStart.w, h: _cropRectStart.h };

  var MIN_SIZE = 5; // minimum 5% in each dimension

  if (_cropDragCorner === "tl") {
    r.x = Math.min(_cropRectStart.x + dx, _cropRectStart.x + _cropRectStart.w - MIN_SIZE);
    r.y = Math.min(_cropRectStart.y + dy, _cropRectStart.y + _cropRectStart.h - MIN_SIZE);
    r.w = _cropRectStart.w - (r.x - _cropRectStart.x);
    r.h = _cropRectStart.h - (r.y - _cropRectStart.y);
  } else if (_cropDragCorner === "tr") {
    r.y = Math.min(_cropRectStart.y + dy, _cropRectStart.y + _cropRectStart.h - MIN_SIZE);
    r.w = Math.max(_cropRectStart.w + dx, MIN_SIZE);
    r.h = _cropRectStart.h - (r.y - _cropRectStart.y);
  } else if (_cropDragCorner === "bl") {
    r.x = Math.min(_cropRectStart.x + dx, _cropRectStart.x + _cropRectStart.w - MIN_SIZE);
    r.w = _cropRectStart.w - (r.x - _cropRectStart.x);
    r.h = Math.max(_cropRectStart.h + dy, MIN_SIZE);
  } else { // br
    r.w = Math.max(_cropRectStart.w + dx, MIN_SIZE);
    r.h = Math.max(_cropRectStart.h + dy, MIN_SIZE);
  }

  // Clamp everything to [0, 100]
  r.x = Math.max(0, Math.min(r.x, 100 - MIN_SIZE));
  r.y = Math.max(0, Math.min(r.y, 100 - MIN_SIZE));
  r.w = Math.min(r.w, 100 - r.x);
  r.h = Math.min(r.h, 100 - r.y);

  cropPending = r;
  renderCropOverlay();
  if (adjustTarget) applyThumbnailCrop(adjustTarget, cropPending);
}

function onCropHandleUp() {
  _cropDragCorner = null;
}

function commitCrop() {
  if (!adjustTarget) return;
  var r = cropPending;
  var isFullImage = (r.x === 0 && r.y === 0 && r.w === 100 && r.h === 100);
  if (isFullImage) {
    delete adjustTarget._cropRect;
    applyThumbnailCrop(adjustTarget, null);
  } else {
    adjustTarget._cropRect = { x: r.x, y: r.y, w: r.w, h: r.h };
    applyThumbnailCrop(adjustTarget, adjustTarget._cropRect);
  }
  autoSave();
}
```

**Step 4: Smoke test**

Open gallery `?edit`, select image, click Edit Image, click Crop tab. Verify:
- Preview shows the image
- Crop handles appear at corners
- Dragging a corner moves the handle, redraws the overlay, and live-updates the thumbnail
- Reset Crop resets to full image
- Apply closes the panel

**Step 5: Commit**

```bash
git add gallery9.js
git commit -m "feat: crop preview with drag handles, applyThumbnailCrop, live thumbnail update"
```

---

## Task 6: Persist cropRect in saveState / restoreState / publishLayout

**Files:**
- Modify: `gallery9.js` — `saveState()` (~line 1302), `restoreState()` (~line 1364), `publishLayout()` (~line 2656)

**Context:** `_cropRect` needs to survive page reload (via localStorage) and publish (via Worker KV).

**Step 1: Add cropRect to saveState**

Find `saveState()` around line 1302 where `if (item._adjustments) entry.adjustments = item._adjustments;`:

```js
// BEFORE (existing line):
if (item._adjustments) entry.adjustments = item._adjustments;

// ADD AFTER:
if (item._cropRect) entry.cropRect = item._cropRect;
```

**Step 2: Add cropRect restore in restoreState**

Find `restoreState()` around line 1364, after the `if (entry.crop)` block:

```js
// Existing block:
if (entry.crop) {
  item.querySelector("img").style.objectPosition = entry.crop;
}

// ADD AFTER:
if (entry.cropRect) {
  item._cropRect = entry.cropRect;
  applyThumbnailCrop(item, entry.cropRect);
}
```

**Step 3: Add cropRect to publishLayout**

Find `publishLayout()` around line 2656, same pattern:

```js
// BEFORE (existing line):
if (item._adjustments) entry.adjustments = item._adjustments;

// ADD AFTER:
if (item._cropRect) entry.cropRect = item._cropRect;
```

**Step 4: Test persistence**

1. Open gallery `?edit`, crop an image, click Apply.
2. Reload the page. Confirm thumbnail shows the crop.
3. Click Publish. Open incognito. Confirm crop is applied on fresh load.

**Step 5: Commit**

```bash
git add gallery9.js
git commit -m "feat: persist cropRect in localStorage and KV publish"
```

---

## Task 7: Add cropRect to lightbox postMessage and apply in WEBFLOW_EMBED_CODE.html

**Files:**
- Modify: `gallery9.js` — `openLightbox()` (~line 1564), the `isIframe` branch that builds the images array
- Modify: `WEBFLOW_EMBED_CODE.html` — `showLb()` function and lightbox `<img>` markup

**Context:** The gallery iframe sends a `postMessage({ type: "lightbox", images, index })` to the parent page. The parent renders the lightbox. We need to:
1. Include `cropRect` in each image object sent via postMessage
2. In the parent, apply the crop when showing each image

**Step 1: Include cropRect in postMessage images array**

Find `openLightbox()` in `gallery9.js` (~line 1564), the `isIframe` branch:

```js
// EXISTING:
var images = visibleItems.map(function(el) {
  var i = el.querySelector("img");
  return { src: i.src, alt: i.alt || "" };
});

// REPLACE WITH:
var images = visibleItems.map(function(el) {
  var i = el.querySelector("img");
  return { src: i.src, alt: i.alt || "", cropRect: el._cropRect || null };
});
```

**Step 2: Update WEBFLOW_EMBED_CODE.html — wrap lb-img in a clip container**

Find the lightbox `buildLightbox()` function in `WEBFLOW_EMBED_CODE.html` (~line 24). The current `lb-img` is a bare `<img>`. Replace it with a container div that provides the crop clip:

Find this line in `lbEl.innerHTML`:

```js
'<img id="lb-img" style="max-width:75vw;max-height:70vh;object-fit:contain">' +
```

Replace with:

```js
'<div id="lb-img-wrap" style="width:75vw;height:70vh;overflow:hidden;display:flex;align-items:center;justify-content:center;position:relative">' +
  '<img id="lb-img" style="width:100%;height:100%;object-fit:contain">' +
'</div>' +
```

**Step 3: Add applyLightboxCrop function in WEBFLOW_EMBED_CODE.html**

Add this function after the `closeLb` function (~line 62):

```js
function applyLightboxCrop(cropRect) {
  var img = document.getElementById("lb-img");
  if (!cropRect || (cropRect.x === 0 && cropRect.y === 0 && cropRect.w === 100 && cropRect.h === 100)) {
    img.style.objectFit = "contain";
    img.style.objectPosition = "";
    img.style.transform = "";
    img.style.transformOrigin = "";
    return;
  }
  var cx = cropRect.x + cropRect.w / 2;
  var cy = cropRect.y + cropRect.h / 2;
  var scale = Math.min(100 / cropRect.w, 100 / cropRect.h);
  img.style.objectFit = "cover";
  img.style.objectPosition = cx + "% " + cy + "%";
  img.style.transform = "scale(" + scale.toFixed(4) + ")";
  img.style.transformOrigin = cx + "% " + cy + "%";
}
```

**Step 4: Call applyLightboxCrop in showLb**

Find `showLb` (~line 42). After setting `lb-img` src/alt, add the crop call:

```js
// EXISTING:
document.getElementById("lb-img").src = img.src;
document.getElementById("lb-img").alt = img.alt;

// ADD:
applyLightboxCrop(img.cropRect || null);
```

**Step 5: Test lightbox crop**

1. Crop a gallery image via the Edit panel (Task 5).
2. Click the thumbnail to open the lightbox.
3. Confirm lightbox shows the cropped region.
4. Navigate to an un-cropped image (arrow key or button) — confirm it shows full image.

**Step 6: Commit**

```bash
git add gallery9.js WEBFLOW_EMBED_CODE.html
git commit -m "feat: pass cropRect via postMessage to parent lightbox"
```

---

## Task 8: Bump version query strings and final verification

**Files:**
- Modify: `gallery9.html` — `?v=` query strings on script/css tags
- Modify: `WEBFLOW_EMBED_CODE.html` — note for manual Webflow paste

**Context:** GitHub Pages serves static files with aggressive caching. Bumping the `?v=` param on the script/css tags forces browsers to load the new versions.

**Step 1: Bump version numbers in gallery9.html**

Open `gallery9.html`. Find:
```html
<link rel="stylesheet" href="gallery9.css?v=2">
...
<script src="gallery9.js?v=3"></script>
```

Change to `?v=3` on CSS and `?v=4` on JS:
```html
<link rel="stylesheet" href="gallery9.css?v=3">
...
<script src="gallery9.js?v=4"></script>
```

**Step 2: Add a version comment to WEBFLOW_EMBED_CODE.html**

At the top of `WEBFLOW_EMBED_CODE.html`, update the comment to note the date so it's clear when it was last pasted into Webflow:

```html
<!-- Webflow Embed Code for Photo Galleries Template — updated 2026-02-23 -->
```

**Step 3: Push to GitHub (deploys to GitHub Pages)**

```bash
git add gallery9.html WEBFLOW_EMBED_CODE.html
git commit -m "chore: bump gallery9 version strings for cache bust"
git push origin main
```

Wait ~30 seconds for GitHub Pages to deploy.

**Step 4: Full end-to-end test**

Run through the full success checklist:
- [ ] Open gallery in edit mode. Move images, resize, add spacer. Publish. Open incognito — layout matches.
- [ ] Edit an image's contrast. Publish. Open incognito — contrast is applied.
- [ ] Crop an image. Apply. Publish. Open incognito — thumbnail and lightbox both show the crop.
- [ ] Publish button shows "Published — live in ~30s" message.
- [ ] After 30 seconds, refresh incognito — still shows published state.
- [ ] Open Edit Image panel — Adjust and Crop tabs both work; switching between them is smooth.

**Step 5: Paste updated WEBFLOW_EMBED_CODE.html into Webflow**

Copy the contents of `WEBFLOW_EMBED_CODE.html` and paste into the Webflow HTML Embed block (the one that contains the iframe). This is a manual step in the Webflow editor — it is not automated by pushing to GitHub.

**Step 6: Final commit (if any last tweaks)**

```bash
git add -A
git commit -m "chore: post-deploy cleanup and version bump"
git push origin main
```

---

## Quick Reference: Key Functions

| Function | File | Purpose |
|----------|------|---------|
| `applyThumbnailCrop(item, cropRect)` | gallery9.js | Apply/clear crop on thumbnail img |
| `initCropTab()` | gallery9.js | Populate crop preview when tab opens |
| `renderCropOverlay()` | gallery9.js | Redraw SVG mask + reposition handles |
| `bindCropHandles()` | gallery9.js | Attach mousedown to 4 corner handles |
| `commitCrop()` | gallery9.js | Save `_cropRect` to item, autoSave |
| `applyLightboxCrop(cropRect)` | WEBFLOW_EMBED_CODE.html | Apply/clear crop on lightbox img |
| `mergeLayout(cmsImages, layout)` | worker/index.js | Merge KV layout into CMS images |
| `publishLayout()` | gallery9.js | PUT layout to Worker KV |
| `saveState()` / `restoreState()` | gallery9.js | localStorage persistence |

## Quick Reference: Key Variables

| Variable | Location | Purpose |
|----------|----------|---------|
| `item._cropRect` | DOM node | `{x,y,w,h}` percentages, or undefined |
| `cropPending` | gallery9.js closure | Working copy while crop panel is open |
| `_cropDragCorner` | gallery9.js closure | Which corner is being dragged (`"tl"` etc.) |
| `adjustTarget` | gallery9.js closure | The gallery item currently being edited |
| `STORAGE_KEY` | gallery9.js closure | `"galleryLayout_<slug>"` |
