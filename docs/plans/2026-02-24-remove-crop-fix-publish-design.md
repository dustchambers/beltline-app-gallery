# Design: Remove Crop + Fix Publish Persistence

**Date:** 2026-02-24
**Status:** Approved

---

## Background

The crop feature added in the previous session is being removed. The publish persistence fix (3 bugs) from the same session is being kept. A new diagnosis step is being added to find why published layouts show a default layout on fresh load (symptom: publishes "succeed" but changes don't survive an incognito/fresh load).

---

## Part 1 — Remove Crop

Strip all crop-related code added in the 2026-02-23 session. Keep all publish-pipeline fixes.

### Files to clean

**`gallery9.js`**
- Remove state vars: `_cropDragCorner`, `_cropDragStart`, `_cropRectStart`, `_cropDragging`, `cropPending`
- Remove functions: `applyThumbnailCrop`, `initCropTab`, `renderCropOverlay`, `getContainRect`, `bindCropHandles`, `onCropHandleMove`, `onCropHandleUp`, `commitCrop`, `setHandlePos`
- Remove from `openAdjustPanel`: entire tab bar HTML, Crop tab content, tab-switching listeners, crop apply/reset listeners; restore single-tab Adjust panel
- Remove `panelH` change (restore 160 from 260)
- Remove `_cropDragging` guard from `onAdjustOutsideClick`
- Remove crop listener cleanup from `closeAdjustPanel`
- Remove crop revert line from `closeAdjustPanel(revert)` block (added in reviewer fix)
- Remove `cropRect` serialization from `saveState` and `publishLayout`
- Remove `cropRect` restore from `restoreState`
- Remove `cropRect` field from `renderGallery` image construction
- Remove `cropRect` from `openLightbox` postMessage images array
- Remove crop apply logic from `openLightbox` non-iframe path
- Remove undo/redo crop restore from `applyUndoSnapshot` (added in reviewer fix)
- Remove crop capture from `captureSnapshot` if present

**`gallery9.css`**
- Remove: `.panel-tabs`, `.panel-tab`, `.panel-tab.active`, `.crop-tab-content`, `.crop-tab-content.active`, `.adjust-tab-content.hidden`, `.crop-preview-wrap`, `.crop-preview-img`, `.crop-overlay-svg`, `.crop-handle`, `#crop-h-tl`, `#crop-h-tr`, `#crop-h-bl`, `#crop-h-br` cursor rules

**`WEBFLOW_EMBED_CODE.html`**
- Remove `applyLightboxCrop(cropRect)` function
- Remove `lb-img-wrap` div wrapper; restore `lb-img` as direct child of its container
- Remove `applyLightboxCrop(img.cropRect || null)` call from `showLb()`
- Revert `lb-img` styles to pre-crop values
- Update date comment

**`worker/index.js`**
- Remove `cropRect` field from `mergeLayout` merged object
- Keep all other publish fixes (full field passthrough, `!= null` guards, `max-age=30`)

**`gallery9.html`**
- Bump `gallery9.css?v=N` and `gallery9.js?v=N` (cache bust)

---

## Part 2 — Diagnose Publish Persistence

### Root cause hypothesis

The Webflow embed likely injects `window.GALLERY_CONFIG` as a static object. The gallery boots from that static config — it never calls `GET /{slug}` on the Worker. So even after a successful `PUT` (KV write), the next page load reads the stale static config and ignores KV entirely.

### Diagnosis additions

1. **Boot path logging** — in the `boot()` function, log which config source was used:
   ```js
   console.log("[gallery] boot: config source =", window.GALLERY_CONFIG ? "static GALLERY_CONFIG" : "fetched from worker");
   ```

2. **Publish response logging** — in `publishLayout()` `.then()`, log the response body:
   ```js
   console.log("[gallery] publish response:", data);
   ```

3. **KV read logging** — in the Worker `handleGet`, log whether a KV layout was found:
   ```js
   console.log("KV layout found:", !!savedLayout, savedLayout ? savedLayout.slice(0, 100) : "");
   ```

### Expected fix

Inspect `WEBFLOW_EMBED_CODE.html`. If it contains a `window.GALLERY_CONFIG = { ... }` block with static image data:

**Change:** Remove the static `GALLERY_CONFIG` injection. Instead, set only the gallery ID and let the script fetch from the Worker:
```html
<script>
  window.GALLERY_ID = "lot43-beltline"; // or whatever the slug is
</script>
```

Then in `gallery9.js`, update the boot path to also accept `window.GALLERY_ID` as the `?id=` equivalent, triggering the Worker GET fetch on every page load. This means the Webflow site always loads the latest published KV layout.

### Success criteria

- Open gallery in incognito (no localStorage)
- Worker GET is called, returns merged layout from KV
- Layout matches what was published
- No `window.GALLERY_CONFIG` static injection short-circuiting the Worker

---

## Implementation order

1. Remove crop from `gallery9.js`
2. Remove crop from `gallery9.css`
3. Remove crop from `WEBFLOW_EMBED_CODE.html`
4. Remove `cropRect` from `worker/index.js`
5. Add boot/publish diagnostic logging
6. Inspect `WEBFLOW_EMBED_CODE.html` for static config injection
7. Fix the config loading path if static injection is confirmed
8. Redeploy worker if Worker changes were made
9. Bump version strings in `gallery9.html`, commit + push
10. Manual verification: incognito fresh load shows published layout
