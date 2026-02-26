# Shuffle Direct Placement Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Eliminate gap rows in shuffleLayout() by directly assigning gridColumn/gridRow per item per recipe row, instead of clearing positions and letting pinAllItems() guess.

**Architecture:** Inside `shuffleLayout()`'s recipe assignment loop, instead of clearing `gridColumn`/`gridRow` and relying on `pinAllItems()` to place items, we maintain a `colCursor` and `rowCursor` and write explicit grid positions to every item. Row height = max height of all items in that recipe row, so every item in a row shares the same row span and there are no mid-row vertical gaps. `pinAllItems()` still gets called afterward — with all items already explicitly positioned, its Pass 1 honours them all and Pass 2 has nothing to do. All other parts of `shuffleLayout()` are unchanged.

**Tech Stack:** Vanilla ES5 JS (no build step). CSS Grid. No new helpers — uses existing `clearSizeClasses`, `applySizeClass`, `pinAllItems`, `mergeAdjacentSpacers`, `refreshOrderNumbers`, `refreshSlots`, `autoSave`.

---

## Reference

**File to modify:** `gallery9.js` — only `shuffleLayout()`, specifically the `while` loop (lines ~2942–2970).

**How pinAllItems() interacts with explicit positions:**
- Pass 1 (lines 1964-1972): items with `gridColumn` containing a start value (e.g. `"1 / span 6"`) are marked as occupied and skipped in Pass 2.
- Pass 2 (lines 1994-2011): items with no start value are placed into free cells.
- **Conclusion:** if we set `item.style.gridColumn = colStart + " / span " + cols` and `item.style.gridRow = rowStart + " / span " + rows` before calling `pinAllItems()`, Pass 1 will honour all positions and Pass 2 will be a no-op. No gaps.

**Grid spec:** 18 columns wide. Rows are auto-height in view mode; in edit mode each cell is a fixed unit. Row numbers are 1-based and unbounded.

**Module-scope constants already defined (do NOT redeclare inside function):**
```js
var VALID_HEIGHTS = { 4:[4,6,8], 6:[4,6,8,9], 9:[4,6], 12:[4,6], 18:[4,6,8] };
var RECIPES = [ [6,6,6]×5, [9,9]×4, [6,12]×3, [12,6]×3, [4,4,4,6]×2, [18]×1 ];
var HEIGHT_PALETTE = [4,4,4,4,4,4, 6,6,6,6, 8,8, 9];
```

**Current while-loop body (lines ~2942–2969) — the only thing being replaced:**
```js
while (remaining.length > 0) {
  var recipe = shuffleArray(pickRandom(RECIPES));
  if (recipe.length > remaining.length) {
    var opts = FALLBACK_RECIPES[remaining.length];
    recipe = opts ? shuffleArray(pickRandom(opts)) : [18];
  }
  // Assign sizes for this row
  for (var si = 0; si < recipe.length && remaining.length > 0; si++) {
    var item = remaining.shift();
    var cols = recipe[si];
    var validH = VALID_HEIGHTS[cols] || [4];
    var rows = pickRandom(HEIGHT_PALETTE);
    for (var attempt = 0; attempt < 10 && validH.indexOf(rows) === -1; attempt++) {
      rows = pickRandom(HEIGHT_PALETTE);
    }
    if (validH.indexOf(rows) === -1) rows = validH[0];
    var size = cols + "x" + rows;
    clearSizeClasses(item);
    applySizeClass(item, size);
    item.style.gridColumn = "";   // ← clears position; pinAllItems guesses
    item.style.gridRow    = "";   // ← clears position; pinAllItems guesses
    gallery.appendChild(item);
  }
}
```

---

### Task 1: Replace while-loop body with direct placement

**Files:**
- Modify: `gallery9.js` — the `while` loop body inside `shuffleLayout()` (~lines 2942–2969)

**Step 1: Locate the exact block**

```bash
grep -n "Assign sizes for this row" /Users/dustintchambers/Documents/dev/lot43imagegallery/gallery9.js
```

Read from ~10 lines before that line to the closing `}` of the while loop to confirm the exact text.

**Step 2: Replace the while loop**

Find the current while loop (from `while (remaining.length > 0) {` through its closing `}`, approximately lines 2942–2970), and replace it entirely with:

```js
    var colCursor = 1;   // next column to place into (1-based)
    var rowCursor = 1;   // current grid row (1-based)

    while (remaining.length > 0) {
      // Pick a recipe; fall back to safe pre-computed recipes when fewer items remain
      var recipe = shuffleArray(pickRandom(RECIPES));

      if (recipe.length > remaining.length) {
        var opts = FALLBACK_RECIPES[remaining.length];
        recipe = opts ? shuffleArray(pickRandom(opts)) : [18];
      }

      // ── Assign heights for this recipe row ──
      // Collect (cols, rows) for each slot, then normalise row height to the max
      // so all items in this recipe row share the same height — no mid-row gaps.
      var slots = [];
      for (var si = 0; si < recipe.length && remaining.length > 0; si++) {
        var cols = recipe[si];
        var validH = VALID_HEIGHTS[cols] || [4];
        var rows = pickRandom(HEIGHT_PALETTE);
        for (var attempt = 0; attempt < 10 && validH.indexOf(rows) === -1; attempt++) {
          rows = pickRandom(HEIGHT_PALETTE);
        }
        if (validH.indexOf(rows) === -1) rows = validH[0];
        slots.push({ item: remaining.shift(), cols: cols, rows: rows });
      }

      // Row height = tallest slot in this recipe row
      var rowHeight = 0;
      for (var k = 0; k < slots.length; k++) {
        if (slots[k].rows > rowHeight) rowHeight = slots[k].rows;
      }

      // ── Place each slot directly onto the grid ──
      for (var p = 0; p < slots.length; p++) {
        var slot = slots[p];
        clearSizeClasses(slot.item);
        applySizeClass(slot.item, slot.cols + "x" + slot.rows);
        slot.item.style.gridColumn = colCursor + " / span " + slot.cols;
        slot.item.style.gridRow    = rowCursor + " / span " + rowHeight;
        gallery.appendChild(slot.item);
        colCursor += slot.cols;
      }

      // Advance to the next row
      rowCursor += rowHeight;
      colCursor = 1;
    }
```

**Step 3: Syntax check**

```bash
node --check /Users/dustintchambers/Documents/dev/lot43imagegallery/gallery9.js
```
Expected: exits 0, no output.

**Step 4: Verify the structure around the change**

Read the full `shuffleLayout()` function after the edit and confirm:
- `pushUndo()` is still the first line
- Spacer removal is still there
- Fisher-Yates shuffle of `imgItems` is still there
- `pickRandom` and `shuffleArray` local function declarations are still there
- `FALLBACK_RECIPES` declaration is still there (before the while loop)
- The new while loop is in place
- `pinAllItems()`, `mergeAdjacentSpacers()`, `refreshOrderNumbers()`, `refreshSlots()`, `autoSave()` are all still called after the while loop

**Step 5: Bump JS version**

In `gallery9.html`, change:
```html
<script src="gallery9.js?v=12"></script>
```
to:
```html
<script src="gallery9.js?v=13"></script>
```

**Step 6: Commit**

```bash
cd /Users/dustintchambers/Documents/dev/lot43imagegallery
git add gallery9.js gallery9.html
git commit -m "feat: direct grid placement in shuffleLayout — eliminates gap rows

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

### Task 2: Spec + quality review

**Spec points to verify (read the new while loop):**

1. `colCursor` starts at 1, resets to 1 after each recipe row
2. `rowCursor` starts at 1, advances by `rowHeight` after each recipe row
3. `rowHeight` = max of `slot.rows` across all slots in the recipe row
4. Every item gets `gridColumn = colCursor + " / span " + slot.cols` and `gridRow = rowCursor + " / span " + rowHeight`
5. `colCursor += slot.cols` after each slot placement
6. `applySizeClass` uses `slot.cols + "x" + slot.rows` (the item's actual height, not rowHeight — items vertically align to the top of the row, and the CSS class determines their visual height even though their grid span is rowHeight)

**Wait — important nuance for Step 6:**

Using `rowHeight` as the grid row span but `slot.rows` in the size class means the item's CSS height class (`g9-6x4`) says 4 rows tall, but the grid cell is `rowHeight` rows tall (e.g. 6). The item will be 4 units tall inside a 6-unit cell. This may leave whitespace below the shorter item within the row.

**Decision:** Use `rowHeight` for BOTH the size class AND the grid span — so all items in a row are the same height. This removes height variety per item but guarantees zero vertical gaps within a row. The alternative (mixed heights) requires CSS alignment tricks and is out of scope.

**Revised Step 6 check:** Confirm `applySizeClass(slot.item, slot.cols + "x" + rowHeight)` (using `rowHeight`, not `slot.rows`). If the implementation used `slot.rows` instead, flag it as a spec gap.

**Quality points to check:**

- `colCursor` and `rowCursor` are declared with `var` (not `const`/`let`) — ES5 compliance
- No arrow functions
- No infinite-loop risk: each while iteration consumes at least one item via `remaining.shift()`
- `slots` array is declared fresh per iteration (no cross-row contamination)

Report: ✅ APPROVED or ❌ with specific issues.

---

### Task 3: Push to GitHub

**Step 1: Confirm clean working tree**

```bash
cd /Users/dustintchambers/Documents/dev/lot43imagegallery && git status
```
Expected: `nothing to commit, working tree clean`

**Step 2: Push**

```bash
git push origin main
```

Expected: commits appear on GitHub, GitHub Pages rebuilds with `gallery9.js?v=13`.
