# 9-Column Gallery — Design Doc
_2026-02-18_

## Summary

A new gallery variant (`gallery9.html/css/js`) built on a 9-column CSS grid with `grid-auto-flow: row` (no dense packing). Photos maintain their authored order. Large items push items below them down rather than triggering reflow. Spacers have corner-drag resize. Edit mode shows visible empty grid slots.

## Files

| New file | Source |
|---|---|
| `gallery9.html` | copied from `gallery.html` |
| `gallery9.css` | new — 9-col grid |
| `gallery9.js` | copied from `gallery.js`, heavily modified |

Originals (`gallery.html/css/js`) are **not modified**. `gallery6.*` lives on a separate branch and is also untouched.

Worktree: `~/.config/superpowers/worktrees/untitled-folder/9col-gallery` (branch `feature/9col-gallery`)

---

## Grid

- **9 columns**: `grid-template-columns: repeat(9, 1fr)`
- **Square cells**: `grid-auto-rows: auto` + `aspect-ratio: 1/1` on `.g9-item`
- **Flow**: `grid-auto-flow: row` — NO dense packing, order always preserved
- **Gap**: `8px`
- **Max-width**: `1400px`, `padding: 0 1rem` — wide, minimal side margin

### CSS Size Classes (prefix `g9-`)

| Key | Cols × Rows | Class |
|---|---|---|
| `1x1` (default) | 1×1 | _(none)_ |
| `2x2` | 2×2 | `g9-2x2` |
| `3x3` | 3×3 | `g9-3x3` |
| `3x2` | 3×2 | `g9-3x2` |
| `4x2` | 4×2 | `g9-4x2` |
| `6x4` | 6×4 | `g9-6x4` |
| `9x6` | 9×6 | `g9-9x6` |
| `2x3` | 2×3 | `g9-2x3` |
| `2x4` | 2×4 | `g9-2x4` |
| `4x6` | 4×6 | `g9-4x6` |

Spacers additionally support arbitrary col/row spans via inline `grid-column: span N; grid-row: span N` set by corner-drag (see below).

---

## Orientation Buttons (Photo Resize UI)

Each photo in edit mode shows **3 small buttons** overlaid on the item (top-right corner), replacing the old single-click cycle:

| Button | Symbol | Group | Cycle order on repeated click |
|---|---|---|---|
| Square | `■` | square | 1×1 → 2×2 → 3×3 → back to 1×1 |
| Horizontal | `▬` | horiz | 3×2 → 4×2 → 6×4 → 9×6 → back to 3×2 |
| Vertical | `▮` | vert | 2×3 → 2×4 → 4×6 → back to 2×3 |

**Behavior:**
- Clicking a button whose group is **not currently active**: jump to the first size in that group
- Clicking a button whose group **is currently active**: advance to the next size in that group
- Active button is visually highlighted
- Badge in bottom-left shows current size label (e.g. `3×2`)

**Auto-default on load:** landscape photos (naturalWidth > naturalHeight) with no saved size default to `3x2`. Portrait photos default to `2x3`. Square photos default to `1x1`. Applied on image `load` event, only if no saved size exists.

---

## Spacers

- Added via `+ Spacer` button in editor toolbar
- Default size: 1×1
- DOM: `<div class="g9-item g9-spacer">` with no `<img>` inside
- In public view: invisible (background matches page `#ECEAE4`)
- In edit mode: dashed border + centered "spacer" label

### Corner-Drag Resize

In edit mode, spacers show **4 corner handles** (small `×` or `◢` indicators, 12×12px, positioned at each corner via `position: absolute`).

**Drag behavior:**
- User mousedowns on a corner handle
- As they drag, compute the nearest grid column/row boundary based on mouse position relative to the grid
- Show a live preview outline of the new size
- On mouseup: apply `grid-column: span N; grid-row: span M` as inline styles
- Items below shift down automatically (CSS handles this with `row` flow)
- `autoSave()` called on release

**Snap calculation:**
- Get the grid element's bounding rect and `gap` value
- Column width = `(gridWidth - gap * 8) / 9`
- Row height = column width (square cells)
- `cols = Math.max(1, Math.round(dragDeltaX / (colWidth + gap)))`
- Clamp to `[1, 9]` for cols, `[1, 12]` for rows (arbitrary max)

**Size is stored as:** `{ type: "spacer", cols: N, rows: M }` in save state and exports.

---

## Empty Slot Visualization (Edit Mode)

`grid-auto-flow: row` naturally leaves gaps when items don't fill a full row. In edit mode only:

1. After rendering all items, compute how many cells the current row has used
2. Append faint `g9-slot` placeholder divs to fill the remainder of the last partial row
3. These are `position` in the grid as 1×1 cells, styled with a very faint dotted border and no background
4. They are **not saved, not exported** — removed when exiting edit mode
5. They do not participate in drag-reorder

```css
.g9-slot {
  border: 1px dotted rgba(0,0,0,0.12);
  background: transparent;
  pointer-events: none;
}
```

> **Note:** showing slots for every row (not just the last) requires knowing exact grid placement, which CSS grid handles internally. Simplification: only fill the trailing partial row. Interior gaps from large items wrapping are left as natural whitespace — this is fine and expected with `row` flow.

---

## Drag Reorder

Unchanged from `gallery.js` — mousedown threshold drag with FLIP animation and hysteresis. Spacers participate in reorder identically to photos.

Orientation buttons do NOT appear during drag.

---

## Export / Save

### localStorage

```json
[
  { "id": "img-abc", "size": "3x2", "crop": "60% 40%" },
  { "type": "spacer", "cols": 2, "rows": 3 },
  { "id": "img-def", "size": "1x1" }
]
```

### HTML Export

```html
<div class="g9-item g9-3x2">
  <img src="..." alt="..." loading="lazy">
</div>
<div class="g9-item g9-spacer" style="grid-column:span 2;grid-row:span 3"></div>
```

### JSON Config Export

Same as localStorage format above.

---

## Responsive Breakpoints

| Breakpoint | Columns | Notes |
|---|---|---|
| > 900px | 9 | Full layout |
| ≤ 900px | 3 | All spans reset to 1×1 |
| ≤ 480px | 1 | Single column |

---

## What's Different from gallery6

| | gallery6 | gallery9 |
|---|---|---|
| Columns | 6 | 9 |
| Flow | dense | row |
| Photo resize UI | click to cycle all | 3 orientation buttons |
| Spacer resize | click to cycle sizes | corner-drag snap-to-grid |
| Empty slots in edit | hidden | visible (trailing row) |
| Max width | 900px | 1400px |
| Default landscape size | 3×2 | 3×2 |
| Default portrait size | none | 2×3 |
