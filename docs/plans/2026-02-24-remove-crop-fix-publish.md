# Remove Crop + Fix Publish Persistence Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Remove all crop feature code and diagnose + fix why published gallery layouts revert to default on fresh/incognito page load.

**Architecture:** The gallery runs inside an iframe on Webflow. The parent page derives a slug from `window.location.pathname` and passes it to the iframe as `?id=<slug>`. The iframe calls `GET /{slug}` on the Cloudflare Worker, which merges KV-stored layout data with live CMS image data and returns it. On publish, `PUT /{slug}` writes the layout to KV. The bug: published changes show on the same browser (localStorage) but not on fresh/incognito load (where the Worker GET result is used). We need to add diagnostics, find the break, then fix it.

**Tech Stack:** Vanilla JS, Cloudflare Workers (KV), GitHub Pages (static hosting), Webflow (iframe embed)

---

## Task 1: Remove crop from gallery9.js

**Files:**
- Modify: `gallery9.js`

Remove all crop-related code added in the 2026-02-23 session. The publish fixes (localStorage clear, publishLayout parity) must be kept.

**Step 1: Remove crop state variables**

Find and delete these four variable declarations (they are near the top of the file, grouped together):
```js
var _cropDragCorner = null;
var _cropDragStart  = null;
var _cropRectStart  = null;
var _cropDragging   = false;
```
Also find and remove `var cropPending` wherever it is declared (likely inside `openAdjustPanel` or near the panel state variables).

**Step 2: Remove all crop functions**

Delete the entire function bodies (including their `function` keyword lines) for each of:
- `applyThumbnailCrop`
- `initCropTab`
- `renderCropOverlay`
- `getContainRect`
- `setHandlePos`
- `bindCropHandles`
- `onCropHandleMove`
- `onCropHandleUp`
- `commitCrop`

**Step 3: Restore openAdjustPanel to single-tab layout**

Find `openAdjustPanel`. The current `adjustPanel.innerHTML` has a tab bar and two tab panes (Adjust + Crop). Replace the entire `innerHTML` assignment with the original single-pane version. It should have only the sliders (contrast, brightness, saturation) and no tab bar. Remove the tab-switching event listeners that were added after the innerHTML assignment.

Also restore `panelH` from `260` back to `160`.

**Step 4: Remove _cropDragging guard from onAdjustOutsideClick**

Find `onAdjustOutsideClick`. Remove the `if (_cropDragging) return;` line at the top.

**Step 5: Remove crop cleanup from closeAdjustPanel**

Find `closeAdjustPanel`. Remove these two lines (added for crop drag cleanup):
```js
document.removeEventListener("mousemove", onCropHandleMove);
document.removeEventListener("mouseup",   onCropHandleUp);
```
Also remove the crop revert line added by the reviewer fix:
```js
applyThumbnailCrop(adjustTarget, adjustTarget._cropRect || null);
```
And remove the drag state reset lines added by the reviewer fix:
```js
_cropDragCorner = null;
_cropDragging   = false;
```

**Step 6: Remove cropRect from saveState**

Find `saveState`. Remove:
```js
if (item._cropRect) entry.cropRect = item._cropRect;
```

**Step 7: Remove cropRect from restoreState**

Find `restoreState`. Remove:
```js
if (entry.cropRect) {
  item._cropRect = entry.cropRect;
  applyThumbnailCrop(item, entry.cropRect);
}
```

**Step 8: Remove cropRect from renderGallery**

Find `renderGallery`. Remove the block added by the reviewer fix:
```js
if (entry.cropRect) {
  div._cropRect = entry.cropRect;
  applyThumbnailCrop(div, entry.cropRect);
}
```

**Step 9: Remove cropRect from publishLayout**

Find `publishLayout`. Remove:
```js
if (item._cropRect) entry.cropRect = item._cropRect;
```

**Step 10: Remove cropRect from openLightbox postMessage path**

Find where `openLightbox` builds the `images` array for `postMessage`. Remove `cropRect: el._cropRect || null` from that map. The entry should only have `src` and `alt`.

**Step 11: Remove crop from openLightbox non-iframe path**

Find the `else` branch of `openLightbox` that sets `lightboxImg.src` directly. Remove the entire inline crop block:
```js
var lbCrop = item._cropRect || null;
if (lbCrop && ...) {
  // ... scale/objectPosition logic
} else {
  // ... clear crop styles
}
```
Also remove any `objectFit`, `objectPosition`, `transform`, `transformOrigin` style resets that were added only for crop.

**Step 12: Remove undo/redo crop support from applyUndoSnapshot**

Find `applyUndoSnapshot`. Remove the crop restore block added by the reviewer fix:
```js
if (entry.cropRect) {
  item._cropRect = entry.cropRect;
  applyThumbnailCrop(item, entry.cropRect);
} else {
  delete item._cropRect;
  applyThumbnailCrop(item, null);
}
```
Also remove the adjustments restore block if it was added by the reviewer fix (check if it existed before — the original `applyUndoSnapshot` may not have had adjustments restore either).

**Step 13: Commit**

```bash
cd /Users/dustintchambers/Documents/dev/lot43imagegallery
git add gallery9.js
git commit -m "feat: remove crop feature from gallery9.js"
```

---

## Task 2: Remove crop from gallery9.css

**Files:**
- Modify: `gallery9.css`

**Step 1: Remove all crop-related CSS rules**

Delete each of these rule blocks entirely (find by selector):
- `.panel-tabs { ... }`
- `.panel-tab { ... }`
- `.panel-tab.active { ... }`
- `.crop-tab-content { ... }` (and any `.crop-tab-content.active` variant)
- `.adjust-tab-content.hidden { ... }`
- `.crop-preview-wrap { ... }`
- `.crop-preview-img { ... }`
- `.crop-overlay-svg { ... }`
- `.crop-handle { ... }`
- `#crop-h-tl, #crop-h-br { cursor: nwse-resize; }`
- `#crop-h-tr, #crop-h-bl { cursor: nesw-resize; }`

**Step 2: Commit**

```bash
cd /Users/dustintchambers/Documents/dev/lot43imagegallery
git add gallery9.css
git commit -m "feat: remove crop styles from gallery9.css"
```

---

## Task 3: Remove crop from WEBFLOW_EMBED_CODE.html

**Files:**
- Modify: `WEBFLOW_EMBED_CODE.html`

**Step 1: Remove applyLightboxCrop function**

Delete the entire `applyLightboxCrop(cropRect)` function from the script block.

**Step 2: Remove applyLightboxCrop call from showLb**

In `showLb()`, remove the line:
```js
applyLightboxCrop(img.cropRect || null);
```

**Step 3: Restore lb-img to direct child (remove lb-img-wrap)**

The current HTML has:
```html
'<div id="lb-img-wrap" style="width:75vw;height:70vh;overflow:hidden;display:flex;align-items:center;justify-content:center;position:relative">' +
  '<img id="lb-img" style="width:100%;height:100%;object-fit:contain;transition:object-position 0.15s">' +
'</div>' +
```

Replace with the pre-crop version (no wrapper div, img directly in lbEl):
```html
'<img id="lb-img" style="max-width:90vw;max-height:85vh;object-fit:contain;border-radius:2px">' +
```

**Step 4: Update comment date**

Change `updated 2026-02-23` to `updated 2026-02-24`.

**Step 5: Commit**

```bash
cd /Users/dustintchambers/Documents/dev/lot43imagegallery
git add WEBFLOW_EMBED_CODE.html
git commit -m "feat: remove crop from WEBFLOW_EMBED_CODE.html"
```

---

## Task 4: Remove cropRect from worker/index.js

**Files:**
- Modify: `worker/index.js`

**Step 1: Remove cropRect from mergeLayout**

In `mergeLayout`, find the `merged.push({ ... })` call. Remove the `cropRect` line:
```js
cropRect:    entry.cropRect    != null ? entry.cropRect    : undefined,
```

Keep all other fields (`crop`, `colStart`, `rowStart`, `cols`, `rows`, `adjustments`, etc.) — those are needed for non-crop layout persistence.

**Step 2: Commit**

```bash
cd /Users/dustintchambers/Documents/dev/lot43imagegallery
git add worker/index.js
git commit -m "feat: remove cropRect from worker mergeLayout"
```

---

## Task 5: Add publish diagnostics + verify KV round-trip

**Files:**
- Modify: `gallery9.js`
- Modify: `worker/index.js`

The goal is to surface exactly where the PUT→GET round-trip breaks. We'll add `console.log` statements, deploy the worker, bump versions, and then manually test in the browser to read the logs.

**Step 1: Add boot source logging to gallery9.js**

In the `boot()` function (around line 15), add at the top:
```js
console.log("[gallery] boot — config source:", window.GALLERY_CONFIG ? "static GALLERY_CONFIG" : "fetched from worker ?id=");
console.log("[gallery] boot — config.id:", cfg.id, "| images:", cfg.images ? cfg.images.length : 0);
```

**Step 2: Add publish request/response logging to gallery9.js**

In `publishLayout()`, before the `fetch(...)` call, add:
```js
console.log("[gallery] publishLayout — PUT slug:", config.id, "| entries:", layout.length);
```

In the `.then(function(data) { ... })` success handler, add:
```js
console.log("[gallery] publishLayout — response:", data);
```

In the `.catch(function(err) { ... })` handler, add:
```js
console.error("[gallery] publishLayout — FAILED:", err);
```

**Step 3: Add KV read logging to worker/index.js**

In `handleGet`, after the `const savedLayout = await env.GALLERY_KV.get("layout:" + slug);` line, add:
```js
console.log("KV lookup: layout:" + slug, "found:", !!savedLayout, savedLayout ? "(len=" + savedLayout.length + ")" : "");
```

Also add after the successful `mergeLayout` call:
```js
console.log("merged images count:", images.length, "| first entry id:", images[0]?.id);
```

**Step 4: Deploy worker**

```bash
cd /Users/dustintchambers/Documents/dev/lot43imagegallery/worker
npx wrangler deploy
```

Expected output: `✓ Deployed lot43-gallery` with the worker URL.

**Step 5: Commit gallery9.js diagnostic logs**

```bash
cd /Users/dustintchambers/Documents/dev/lot43imagegallery
git add gallery9.js worker/index.js
git commit -m "debug: add publish + boot diagnostic console.log"
```

---

## Task 6: Bump version strings, push, manual test

**Files:**
- Modify: `gallery9.html`

**Step 1: Bump version strings**

In `gallery9.html`, find lines like:
```html
<link rel="stylesheet" href="gallery9.css?v=3">
<script src="gallery9.js?v=5"></script>
```

Increment both version numbers by 1:
- `gallery9.css?v=3` → `gallery9.css?v=4`
- `gallery9.js?v=5` → `gallery9.js?v=6`

**Step 2: Commit and push**

```bash
cd /Users/dustintchambers/Documents/dev/lot43imagegallery
git add gallery9.html
git commit -m "chore: bump versions to v4/v6 after crop removal + diagnostic logs"
git push origin main
```

**Step 3: Manual test — read the diagnostic logs**

Wait ~30 seconds for GitHub Pages to deploy, then:

1. Open `https://dustchambers.github.io/beltline-app-gallery/gallery9.html?id=<slug>&edit` in Chrome
2. Open DevTools → Console
3. Confirm you see:
   - `[gallery] boot — config source: fetched from worker ?id=`
   - `[gallery] boot — config.id: <slug> | images: N`
4. Move an image to a new position
5. Click Publish
6. Confirm you see:
   - `[gallery] publishLayout — PUT slug: <slug> | entries: N`
   - `[gallery] publishLayout — response: {ok: true}`
7. Open the URL in a **new incognito window** (no localStorage)
8. Check DevTools Console for boot log — it should show the same `config.id`
9. Check: does the layout match what you published?

**Step 4: Check Cloudflare Worker logs for KV entries**

Go to [dash.cloudflare.com](https://dash.cloudflare.com) → Workers & Pages → `lot43-gallery` → Logs (Real-time logs or Recent logs). After a GET request you should see:
```
KV lookup: layout:<slug> found: true (len=...)
merged images count: N | first entry id: img_0
```

If you see `found: false`, the KV write on PUT is failing or the slug doesn't match.

**Step 5: Document findings**

Note down what the logs showed. Specifically:
- Does the Worker GET find the KV layout?
- Does `config.id` from boot match what was used in the PUT?
- Is the merged count correct?

Report findings before proceeding to Task 7.

---

## Task 7: Fix the root cause (based on Task 6 findings)

This task branches based on what Task 6 diagnostics revealed. Implement whichever fix applies:

### Fix A: KV key mismatch (slug from URL ≠ slug used in PUT)

**Symptom:** Worker logs show `KV lookup: layout:<slug-A> found: false` but KV has data stored under a different slug.

**Fix:** In `WEBFLOW_EMBED_CODE.html`, change how the slug is derived. Instead of:
```js
var slug = window.location.pathname.split("/").pop();
```

Use the full last segment and strip any trailing slash more carefully:
```js
var slug = window.location.pathname.replace(/\/$/, "").split("/").pop();
```

Then verify this matches what `config.id` returns from the Worker GET.

### Fix B: Worker not receiving the PUT (auth failure)

**Symptom:** Publish console shows `[gallery] publishLayout — FAILED: HTTP 401` or similar.

**Fix:** The `EDIT_SECRET` in `gallery9.js` (`"grantpark"`) must match the `EDIT_SECRET` environment variable in the Cloudflare Worker. Check the Worker secrets:

```bash
cd /Users/dustintchambers/Documents/dev/lot43imagegallery/worker
npx wrangler secret list
```

If `EDIT_SECRET` is not listed, add it:
```bash
npx wrangler secret put EDIT_SECRET
# enter: grantpark
```

### Fix C: Worker not deployed with latest code

**Symptom:** Worker logs don't appear at all, or behavior doesn't match the code in `worker/index.js`.

**Fix:** Redeploy:
```bash
cd /Users/dustintchambers/Documents/dev/lot43imagegallery/worker
npx wrangler deploy
```

### Fix D: KV binding not configured

**Symptom:** Worker logs show an error about `GALLERY_KV` being undefined, or PUT returns 500.

**Fix:** Verify `wrangler.toml` has the correct KV binding and the namespace ID `4e6c92472dc74600bca92ad952e232bb` exists in your Cloudflare account. Go to dash.cloudflare.com → Workers & Pages → KV → verify the namespace exists.

**After applying fix:**

```bash
cd /Users/dustintchambers/Documents/dev/lot43imagegallery
git add -A
git commit -m "fix: <describe the root cause fix>"
git push origin main
```

---

## Task 8: Remove diagnostic logs + final version bump

Once publish is confirmed working, clean up the diagnostic `console.log` statements.

**Files:**
- Modify: `gallery9.js`
- Modify: `worker/index.js`

**Step 1: Remove diagnostic logs from gallery9.js**

Remove the three `console.log` blocks added in Task 5 Steps 1 and 2.

**Step 2: Remove diagnostic logs from worker/index.js**

Remove the two `console.log` lines added in Task 5 Step 3.

**Step 3: Redeploy worker**

```bash
cd /Users/dustintchambers/Documents/dev/lot43imagegallery/worker
npx wrangler deploy
```

**Step 4: Bump version strings**

In `gallery9.html`:
- `gallery9.js?v=6` → `gallery9.js?v=7`

(CSS didn't change in this task, no need to bump it.)

**Step 5: Commit and push**

```bash
cd /Users/dustintchambers/Documents/dev/lot43imagegallery
git add gallery9.js gallery9.html worker/index.js
git commit -m "chore: remove diagnostic logs; bump gallery9.js to v7"
git push origin main
```

**Step 6: Final verification checklist**

Open the gallery in incognito. Verify:
- [ ] Move an image → Publish → "Published — live in ~30s" appears
- [ ] Wait 30 seconds → Open incognito tab → Layout matches published state
- [ ] Open same incognito tab again → Still matches (KV is persistent)
- [ ] Edit brightness/contrast → Publish → Incognito confirms adjustment preserved
- [ ] Lightbox opens images correctly
- [ ] Edit mode still works (drag, resize, spacers)
