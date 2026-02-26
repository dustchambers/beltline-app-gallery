# Shuffle Row-Recipe Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the per-item orientation-split palette in `shuffleLayout()` with a row-recipe approach that guarantees every row's column widths sum to 18, eliminating orphan empty columns.

**Architecture:** A single function block inside `shuffleLayout()` replaces the existing `LANDSCAPE_PALETTE` / `PORTRAIT_PALETTE` / forEach loop. Instead of picking a size per image, we pick a row recipe (a list of col-widths summing to 18), take that many images from the shuffled array, assign each a width from the recipe plus a random valid height, then repeat until all images are placed. The rest of `shuffleLayout()` is unchanged.

**Tech Stack:** Vanilla ES5 JS (no build step), CSS class assignment via `applySizeClass(item, size)` / `clearSizeClasses(item)`.

---

## Reference

**File to modify:** `gallery9.js` — one function, `shuffleLayout()`, lines ~2873–2942.

**Key helpers (already exist, do not rewrite):**
- `applySizeClass(item, size)` — clears existing size classes, adds `SIZE_CLASS_MAP[size]` class
- `clearSizeClasses(item)` — removes all size classes
- `pinAllItems()` — 2-pass occupancy-grid placement; assigns `gridColumn` / `gridRow` to all items
- `mergeAdjacentSpacers()`, `refreshOrderNumbers()`, `refreshSlots()`, `autoSave()` — called unchanged at end

**SIZE_CLASS_MAP valid keys** (WxH — only these exist in CSS):
```
4x4, 4x6, 4x8
6x4, 6x6, 6x8, 6x9
9x4, 9x6
12x4, 12x6
18x4, 18x6, 18x8
```
Any size key not in this list will silently fail (no CSS class applied). The implementation MUST only produce keys from this list.

**Valid height options per column width:**
```js
var VALID_HEIGHTS = {
  4:  [4, 6, 8],
  6:  [4, 6, 8, 9],
  9:  [4, 6],
  12: [4, 6],
  18: [4, 6, 8]
};
```

**Row recipes** (col-widths summing to 18):
```js
var RECIPES = [
  [6,6,6],   [6,6,6],   [6,6,6],   [6,6,6],   [6,6,6],  // weight 5
  [9,9],     [9,9],     [9,9],     [9,9],                 // weight 4
  [6,12],    [6,12],    [6,12],                           // weight 3
  [12,6],    [12,6],    [12,6],                           // weight 3
  [4,4,4,6], [4,4,4,6],                                   // weight 2
  [18]                                                     // weight 1
];
```

The `[4,4,4,6]` recipe must be Fisher-Yates shuffled before use so the `6`-wide slot lands in a random position within the row.

**Height palette** (weighted, assigned per image independently):
```js
var HEIGHT_PALETTE = [4,4,4,4,4,4, 6,6,6,6, 8,8, 9];
```

---

### Task 1: Replace palette logic in `shuffleLayout()`

**Files:**
- Modify: `gallery9.js` lines ~2893–2935 (the palette + forEach block inside `shuffleLayout()`)

**Step 1: Locate the exact block to replace**

In `gallery9.js`, find the comment `// Weighted size palettes — portrait vs landscape` and note the line number. The block to replace runs from that comment through the closing `gallery.appendChild(item);` and `});` of the forEach — approximately:

```js
// Weighted size palettes — portrait vs landscape
// Flat arrays: entry count = weight, pick by random index
var LANDSCAPE_PALETTE = [ ... ];
var PORTRAIT_PALETTE = [ ... ];

var prevSize = null;

imgItems.forEach(function (item) {
  ...
  gallery.appendChild(item);
});
```

**Step 2: Replace that block with the row-recipe implementation**

Replace the entire block (from `// Weighted size palettes` through the closing `});` of the forEach) with:

```js
    // ── Row-recipe size assignment ──
    // Recipes are col-width arrays that sum to 18 — guarantees no orphan columns.
    // Heights are assigned per-image from a weighted palette, filtered to valid
    // combinations for that column width.
    var VALID_HEIGHTS = {
      4:  [4, 6, 8],
      6:  [4, 6, 8, 9],
      9:  [4, 6],
      12: [4, 6],
      18: [4, 6, 8]
    };

    // Flat weighted recipe array — pick by random index
    var RECIPES = [
      [6,6,6],   [6,6,6],   [6,6,6],   [6,6,6],   [6,6,6],
      [9,9],     [9,9],     [9,9],     [9,9],
      [6,12],    [6,12],    [6,12],
      [12,6],    [12,6],    [12,6],
      [4,4,4,6], [4,4,4,6],
      [18]
    ];

    var HEIGHT_PALETTE = [4,4,4,4,4,4, 6,6,6,6, 8,8, 9];

    function pickRandom(arr) {
      return arr[Math.floor(Math.random() * arr.length)];
    }

    // Fisher-Yates shuffle a copy of an array (used to randomise recipe slot order)
    function shuffleArray(arr) {
      var a = arr.slice();
      for (var i = a.length - 1; i > 0; i--) {
        var j = Math.floor(Math.random() * (i + 1));
        var t = a[i]; a[i] = a[j]; a[j] = t;
      }
      return a;
    }

    var remaining = imgItems.slice(); // work from a copy

    while (remaining.length > 0) {
      // Pick a recipe; if it needs more items than remain, fall back to [6,6,6] or smaller
      var recipe = shuffleArray(pickRandom(RECIPES));

      // Trim recipe to available items (avoids leaving a row half-specified)
      if (recipe.length > remaining.length) {
        // Build a recipe that uses exactly remaining.length items summing to 18
        // Fallback: use [6,6,6] sliced, or just give each remaining item 6 cols
        // and let pinAllItems handle any remainder gracefully
        var fallbackCols = [6, 6, 6, 6, 9, 9, 12, 18];
        recipe = [];
        var colsLeft = 18;
        for (var ri = 0; ri < remaining.length - 1; ri++) {
          // pick a width that leaves room for at least one more valid width
          var w = pickRandom([6, 6, 9]);
          if (w > colsLeft - 6) w = 6; // ensure at least 6 cols for next item
          recipe.push(w);
          colsLeft -= w;
        }
        recipe.push(colsLeft > 0 ? colsLeft : 6); // last item takes remaining cols
      }

      // Assign sizes for this row
      for (var ri2 = 0; ri2 < recipe.length && remaining.length > 0; ri2++) {
        var item = remaining.shift();
        var cols = recipe[ri2];
        var validH = VALID_HEIGHTS[cols] || [4];
        var rows = pickRandom(HEIGHT_PALETTE);
        // Re-roll until we get a height valid for this width (max 10 attempts)
        for (var attempt = 0; attempt < 10 && validH.indexOf(rows) === -1; attempt++) {
          rows = pickRandom(HEIGHT_PALETTE);
        }
        if (validH.indexOf(rows) === -1) rows = validH[0]; // guaranteed fallback

        var size = cols + "x" + rows;
        clearSizeClasses(item);
        applySizeClass(item, size);
        item.style.gridColumn = "";
        item.style.gridRow    = "";
        gallery.appendChild(item);
      }
    }
```

**Step 3: Syntax check**

```bash
node --check gallery9.js
```
Expected: no output (clean).

**Step 4: Bump JS version in gallery9.html**

In `gallery9.html`, change:
```html
<script src="gallery9.js?v=11"></script>
```
to:
```html
<script src="gallery9.js?v=12"></script>
```

**Step 5: Manual smoke test**

Open `gallery9.html` directly in a browser (file:// or local server).
- Add `?gedit` to the URL to enter edit mode
- Click **Shuffle** several times
- Verify: every row spans edge-to-edge (no orphan blank columns on the right)
- Verify: ⌘Z undoes the shuffle
- Verify: images appear (no blank grey boxes from invalid size keys)

**Step 6: Commit**

```bash
git add gallery9.js gallery9.html
git commit -m "feat: replace per-item palette with row-recipe shuffle (no orphan columns)"
```

---

### Task 2: Spec compliance review

**Step 1: Verify all assigned size keys are valid**

Mentally (or by adding a temporary `console.log(size)`) confirm that every size string produced by the new code is of the form `WxH` where:
- W ∈ {4, 6, 9, 12, 18}
- H is in `VALID_HEIGHTS[W]`

**Step 2: Verify row widths sum to 18**

For each recipe in `RECIPES`, confirm the sum: `[6,6,6]=18` ✓, `[9,9]=18` ✓, `[6,12]=18` ✓, `[12,6]=18` ✓, `[4,4,4,6]=18` ✓, `[18]=18` ✓.

**Step 3: Verify fallback path**

When `remaining.length < recipe.length` (the last partial row), the fallback builds a recipe summing as close to 18 as possible. Trace through the fallback logic manually for `remaining.length = 1` and `remaining.length = 2` to confirm no crash and no invalid size keys.

**Step 4: Verify undo**

`pushUndo()` is still called at the top of `shuffleLayout()` (unchanged). Confirm it's still there after the edit.

---

### Task 3: Push to GitHub

**Step 1: Confirm clean working tree**

```bash
git status
```
Expected: `nothing to commit, working tree clean`

**Step 2: Push**

```bash
git push origin main
```

Expected: commits appear on GitHub, GitHub Pages rebuilds with `gallery9.js?v=12`.
