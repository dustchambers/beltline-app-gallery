# Image Selection & Adjustment Panel Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace click-to-cycle-size with a selection model, add an "Edit Image" banner button that opens a floating panel with contrast/brightness/saturation sliders, persisted in localStorage and published via existing Publish flow.

**Architecture:** All changes are in `gallery.js` (vanilla JS IIFE) and `gallery.css`. Selection state is tracked in a `Set` (`selectedItems`). Adjustments are stored as `{contrast, brightness, saturation}` per item, serialized alongside existing `size`/`crop` fields. The floating panel is a single DOM element repositioned on each open.

**Tech Stack:** Vanilla JS, CSS custom properties, no build step. Test by opening `gallery.html?edit` in browser.

---

### Task 1: Remove size cycling & shift+drag crop, add selection state

**Files:**
- Modify: `gallery.js`

**Step 1: Add `selectedItems` Set to state variables (near line 79)**

Find the state block:
```js
var editorMode = false;
var editorOverlay = null;
```
Add after it:
```js
var selectedItems = new Set();
```

**Step 2: Remove `cycleSize()` function (lines 371–390)**

Delete the entire function:
```js
function cycleSize(item) { ... }
```

**Step 3: Remove shift+drag crop logic from `_editorMouseMove` (lines 760–777)**

In `window._editorMouseMove`, remove the `if (e.shiftKey)` branch and `isCropping` references entirely. The block should simplify to:

```js
window._editorMouseMove = function (e) {
  if (!activeItem) return;
  var dx = e.clientX - dragStartX;
  var dy = e.clientY - dragStartY;
  var dist = Math.sqrt(dx * dx + dy * dy);
  if (!isDragging && dist > DRAG_THRESHOLD) {
    isDragging = true;
    startDrag(activeItem, e);
  }
  if (isDragging) moveDrag(e);
};
```

**Step 4: Remove `isCropping` from `_editorMouseUp` (lines 780–794)**

Simplify to:
```js
window._editorMouseUp = function () {
  if (!activeItem) return;
  if (isDragging) {
    endDrag();
  } else {
    toggleSelect(activeItem, window._lastMouseEvent);
  }
  activeItem = null;
  isDragging = false;
};
```
_(We'll define `toggleSelect` in Task 2. Also store the last mouse event — add `window._lastMouseEvent = e;` at the top of `_editorMouseMove`.)_

**Step 5: Remove `cycleSize(activeItem)` call in old mouseUp (already replaced above)**

**Step 6: Manual test**
Open `gallery.html?edit`. Confirm: clicking images no longer cycles size. Dragging still reorders.

**Step 7: Commit**
```bash
git add gallery.js
git commit -m "refactor: remove size cycling and shift+drag crop, add selectedItems state"
```

---

### Task 2: Implement selection toggle & visual feedback

**Files:**
- Modify: `gallery.js`
- Modify: `gallery.css`

**Step 1: Add `toggleSelect()` function after `setupEditorItem()`**

```js
function toggleSelect(item, e) {
  var isShift = e && e.shiftKey;
  if (!isShift) {
    // Clear all other selections
    selectedItems.forEach(function (el) {
      el.classList.remove("selected");
    });
    selectedItems.clear();
  }
  if (selectedItems.has(item)) {
    selectedItems.delete(item);
    item.classList.remove("selected");
  } else {
    selectedItems.add(item);
    item.classList.add("selected");
  }
  updateEditButton();
}
```

**Step 2: Add `clearSelection()` helper**

```js
function clearSelection() {
  selectedItems.forEach(function (el) {
    el.classList.remove("selected");
  });
  selectedItems.clear();
  updateEditButton();
}
```

**Step 3: Clear selection on click of empty gallery area**

In `toggleEditor()`, after `document.body.classList.add("edit-mode")`, add:
```js
var gallery = getGallery();
gallery._onGalleryClick = function (e) {
  if (e.target === gallery) clearSelection();
};
gallery.addEventListener("click", gallery._onGalleryClick);
```

And in the `else` (exit editor) block, add:
```js
var gallery = getGallery();
if (gallery._onGalleryClick) {
  gallery.removeEventListener("click", gallery._onGalleryClick);
}
clearSelection();
```

**Step 4: Add CSS for selected state in `gallery.css`**

```css
/* Editor selection */
.edit-mode .gallery-item.selected {
  outline: 3px solid #4A90D9;
  outline-offset: -3px;
}

.edit-mode .gallery-item.selected::after {
  content: "✓";
  position: absolute;
  top: 8px;
  right: 8px;
  width: 22px;
  height: 22px;
  background: #4A90D9;
  color: #fff;
  font-size: 13px;
  line-height: 22px;
  text-align: center;
  z-index: 11;
  pointer-events: none;
}
```

**Step 5: Manual test**
Open `gallery.html?edit`. Click image → blue ring + checkmark appears. Click another image → first deselects. Shift+click → both selected. Click empty area → deselected.

**Step 6: Commit**
```bash
git add gallery.js gallery.css
git commit -m "feat: image selection with blue ring + checkmark in editor mode"
```

---

### Task 3: Add "Edit Image" button to editor banner

**Files:**
- Modify: `gallery.js`

**Step 1: Add the button to the banner HTML in `toggleEditor()` (around line 710)**

In the `editorOverlay.innerHTML` string, add the Edit Image button after the Done button:
```js
'<button id="editor-edit-image" disabled>✏ Edit Image</button>' +
```

Update the banner hint text from:
```
"EDITOR \u2014 Click: size \u00b7 Drag: reorder \u00b7 Shift+Drag: crop \u00b7 "
```
to:
```
"EDITOR \u2014 Click: select \u00b7 Shift+Click: multi-select \u00b7 Drag: reorder \u00b7 "
```

**Step 2: Bind the Edit Image button click**

After the existing button bindings in `toggleEditor()`, add:
```js
document.getElementById("editor-edit-image")
  .addEventListener("click", function () {
    var items = Array.from(selectedItems);
    if (items.length === 1) openAdjustPanel(items[0]);
  });
```

**Step 3: Add `updateEditButton()` function**

```js
function updateEditButton() {
  var btn = document.getElementById("editor-edit-image");
  if (!btn) return;
  var count = selectedItems.size;
  btn.disabled = count !== 1;
  btn.title = count === 0 ? "Select one image to edit"
    : count > 1 ? "Select only one image to edit"
    : "";
}
```

**Step 4: Manual test**
Open `gallery.html?edit`. "✏ Edit Image" button appears, greyed out. Select one image → button becomes active. Select two → greyed again.

**Step 5: Commit**
```bash
git add gallery.js
git commit -m "feat: add Edit Image button to editor banner, enabled when exactly 1 selected"
```

---

### Task 4: Build the floating adjust panel

**Files:**
- Modify: `gallery.js`
- Modify: `gallery.css`

**Step 1: Add adjust panel state variables (near other state vars)**

```js
var adjustPanel = null;
var adjustTarget = null;
var adjustPending = { contrast: 100, brightness: 100, saturation: 100 };
```

**Step 2: Add `openAdjustPanel(item)` function**

```js
function openAdjustPanel(item) {
  adjustTarget = item;
  var img = item.querySelector("img");
  var saved = item._adjustments || { contrast: 100, brightness: 100, saturation: 100 };
  adjustPending = { contrast: saved.contrast, brightness: saved.brightness, saturation: saved.saturation };

  if (!adjustPanel) {
    adjustPanel = document.createElement("div");
    adjustPanel.id = "adjust-panel";
    adjustPanel.innerHTML =
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
      '<button id="adj-apply">Apply</button></div>';
    document.body.appendChild(adjustPanel);

    // Bind slider events
    ["contrast", "brightness", "saturation"].forEach(function (prop) {
      var input = document.getElementById("adj-" + prop);
      input.addEventListener("input", function () {
        adjustPending[prop] = parseInt(input.value, 10);
        document.getElementById("adj-" + prop + "-val").textContent = input.value;
        applyAdjustPreview();
      });
    });

    document.getElementById("adj-reset").addEventListener("click", function () {
      adjustPending = { contrast: 100, brightness: 100, saturation: 100 };
      syncAdjustSliders();
      applyAdjustPreview();
    });

    document.getElementById("adj-apply").addEventListener("click", function () {
      commitAdjustments();
      closeAdjustPanel();
    });
  }

  syncAdjustSliders();
  applyAdjustPreview();
  positionAdjustPanel(item);
  adjustPanel.classList.add("active");

  // Close on outside click
  setTimeout(function () {
    document.addEventListener("mousedown", onAdjustOutsideClick);
  }, 0);

  // Close on Escape
  document.addEventListener("keydown", onAdjustEscape);
}
```

**Step 3: Add helper functions**

```js
function syncAdjustSliders() {
  ["contrast", "brightness", "saturation"].forEach(function (prop) {
    var input = document.getElementById("adj-" + prop);
    if (input) {
      input.value = adjustPending[prop];
      document.getElementById("adj-" + prop + "-val").textContent = adjustPending[prop];
    }
  });
}

function applyAdjustPreview() {
  if (!adjustTarget) return;
  var img = adjustTarget.querySelector("img");
  var f = adjustPending;
  if (f.contrast === 100 && f.brightness === 100 && f.saturation === 100) {
    img.style.filter = "";
  } else {
    img.style.filter =
      "contrast(" + f.contrast + "%) " +
      "brightness(" + f.brightness + "%) " +
      "saturate(" + f.saturation + "%)";
  }
}

function commitAdjustments() {
  if (!adjustTarget) return;
  var f = adjustPending;
  if (f.contrast === 100 && f.brightness === 100 && f.saturation === 100) {
    delete adjustTarget._adjustments;
  } else {
    adjustTarget._adjustments = { contrast: f.contrast, brightness: f.brightness, saturation: f.saturation };
  }
  autoSave();
}

function closeAdjustPanel(revert) {
  if (revert && adjustTarget) {
    // Revert preview to saved state
    var saved = adjustTarget._adjustments;
    var img = adjustTarget.querySelector("img");
    if (saved) {
      img.style.filter =
        "contrast(" + saved.contrast + "%) " +
        "brightness(" + saved.brightness + "%) " +
        "saturate(" + saved.saturation + "%)";
    } else {
      img.style.filter = "";
    }
  }
  if (adjustPanel) adjustPanel.classList.remove("active");
  adjustTarget = null;
  document.removeEventListener("mousedown", onAdjustOutsideClick);
  document.removeEventListener("keydown", onAdjustEscape);
}

function onAdjustOutsideClick(e) {
  if (adjustPanel && !adjustPanel.contains(e.target)) {
    closeAdjustPanel(true);
  }
}

function onAdjustEscape(e) {
  if (e.key === "Escape") closeAdjustPanel(true);
}

function positionAdjustPanel(item) {
  var rect = item.getBoundingClientRect();
  var panelH = 160; // estimated
  var spaceAbove = rect.top;
  var top, left;

  if (spaceAbove > panelH + 8) {
    top = rect.top + window.scrollY - panelH - 8;
  } else {
    top = rect.bottom + window.scrollY + 8;
  }
  left = rect.left + window.scrollX + (rect.width / 2) - 150; // 300px wide panel, centered
  left = Math.max(8, Math.min(left, window.innerWidth - 308));

  adjustPanel.style.top = top + "px";
  adjustPanel.style.left = left + "px";
}
```

**Step 4: Add CSS for the panel in `gallery.css`**

```css
/* Adjust Panel */
#adjust-panel {
  display: none;
  position: absolute;
  z-index: 1000;
  width: 300px;
  background: #1a1a1a;
  border: 1px solid #444;
  padding: 14px 16px 12px;
  box-shadow: 0 4px 20px rgba(0,0,0,0.5);
  font-family: 'Inconsolata', monospace;
}
#adjust-panel.active {
  display: block;
}
.adjust-row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 10px;
}
.adjust-row label {
  color: #aaa;
  font-size: 12px;
  width: 74px;
  flex-shrink: 0;
}
.adjust-row input[type="range"] {
  flex: 1;
  accent-color: #4A90D9;
}
.adjust-row span {
  color: #EDEBE0;
  font-size: 12px;
  width: 32px;
  text-align: right;
}
.adjust-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 4px;
}
.adjust-actions button {
  background: #333;
  color: #EDEBE0;
  border: 1px solid #555;
  padding: 4px 14px;
  font-family: 'Inconsolata', monospace;
  font-size: 12px;
  cursor: pointer;
}
.adjust-actions button:hover {
  background: #444;
}
#adj-apply {
  background: #4A90D9;
  border-color: #4A90D9;
  color: #fff;
}
#adj-apply:hover {
  background: #5a9fe8;
}
```

**Step 5: Manual test**
Select one image → click "✏ Edit Image" → panel appears above/below image. Move sliders → live preview on image. Reset → all back to 100. Apply → filter stays, panel closes. Escape → reverts to pre-open state.

**Step 6: Commit**
```bash
git add gallery.js gallery.css
git commit -m "feat: floating adjust panel with contrast/brightness/saturation sliders"
```

---

### Task 5: Persist adjustments in saveState / restoreState

**Files:**
- Modify: `gallery.js`

**Step 1: Update `saveState()` to include adjustments (around line 199)**

In the `.map()` inside `saveState()`, add `adjustments` to the returned object:
```js
var adj = item._adjustments || null;
return {
  id: img.dataset.imageId || "",
  size: getSize(item),
  crop: (crop && crop !== "50% 50%") ? crop : null,
  adjustments: adj
};
```

**Step 2: Update `restoreState()` to apply adjustments (around line 241)**

After the `if (entry.crop)` block, add:
```js
if (entry.adjustments) {
  var img = item.querySelector("img");
  var f = entry.adjustments;
  item._adjustments = f;
  img.style.filter =
    "contrast(" + f.contrast + "%) " +
    "brightness(" + f.brightness + "%) " +
    "saturate(" + f.saturation + "%)";
}
```

**Step 3: Update `renderGallery()` to apply adjustments from initial config (around line 124)**

After the crop block:
```js
if (entry.adjustments) {
  var f = entry.adjustments;
  img.style.filter =
    "contrast(" + f.contrast + "%) " +
    "brightness(" + f.brightness + "%) " +
    "saturate(" + f.saturation + "%)";
  div._adjustments = f;
}
```

**Step 4: Manual test**
Apply adjustments, reload page → adjustments persist. Clear localStorage → no adjustments on fresh load.

**Step 5: Commit**
```bash
git add gallery.js
git commit -m "feat: persist image adjustments in localStorage save/restore"
```

---

### Task 6: Include adjustments in Publish, Export HTML, Export Config

**Files:**
- Modify: `gallery.js`

**Step 1: Update `publishLayout()` to include adjustments (around line 626)**

In the `.map()` inside `publishLayout()`:
```js
return {
  id: img.dataset.imageId || "",
  size: getSize(item),
  crop: (crop && crop !== "50% 50%") ? crop : null,
  adjustments: item._adjustments || null
};
```

**Step 2: Update `exportAll()` (HTML export, around line 575)**

After the `posAttr` logic, add a `filterAttr`:
```js
var adj = item._adjustments;
var filterAttr = "";
if (adj && (adj.contrast !== 100 || adj.brightness !== 100 || adj.saturation !== 100)) {
  var existingStyle = posAttr ? posAttr.slice(8, -1) + "; " : "";
  filterAttr = ' style="' + existingStyle +
    "filter: contrast(" + adj.contrast + "%) " +
    "brightness(" + adj.brightness + "%) " +
    "saturate(" + adj.saturation + '%)"';
  posAttr = ""; // combined into filterAttr
}
```
Then replace `posAttr` with `filterAttr || posAttr` in the output string.

**Step 3: Update `exportConfig()` to include adjustments (around line 669)**

```js
if (item._adjustments) {
  entry.adjustments = item._adjustments;
}
```

**Step 4: Manual test**
Apply adjustments → Publish → reload page (fetches from worker) → adjustments visible. Export HTML → check `<img style="filter: ...">`. Export Config → check JSON has `adjustments` field.

**Step 5: Commit**
```bash
git add gallery.js
git commit -m "feat: include adjustments in Publish, Export HTML, and Export Config"
```

---

### Task 7: Clean up — remove dead code & update banner hint

**Files:**
- Modify: `gallery.js`

**Step 1: Remove `getCropState()`, `moveCrop()`, `endCrop()` functions**

These were only used by shift+drag crop. Search for and delete them entirely.

**Step 2: Remove `isCropping` variable declaration (line 86)**

```js
var isCropping = false;  // DELETE
```

**Step 3: Verify `isCropping` has no remaining references**

Run:
```bash
grep -n "isCropping" gallery.js
```
Expected: no results.

**Step 4: Remove `cycleSize` dead reference check**

Run:
```bash
grep -n "cycleSize" gallery.js
```
Expected: no results (already removed in Task 1).

**Step 5: Final manual smoke test**
- Editor mode enters/exits cleanly
- Click selects, shift-click multi-selects, click empty deselects
- Drag reorders
- Edit Image button enables with exactly 1 selected
- Panel opens, sliders work live, Apply saves, Reset clears, Escape reverts
- Publish includes adjustments, Export HTML has inline filter, Export Config has adjustments field
- No JS console errors

**Step 6: Final commit**
```bash
git add gallery.js
git commit -m "refactor: remove dead crop state code, finalize image adjustment feature"
```
