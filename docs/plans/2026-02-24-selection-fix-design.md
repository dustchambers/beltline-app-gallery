# Design: Fix Selection Ring + Multi-Select Drag

**Date:** 2026-02-24
**Status:** Approved

---

## Background

The gallery editor allows multi-select (shift+click) and group drag. Two bugs:

1. **Selection ring disappears**: The blue `box-shadow: inset` ring is briefly visible after click but disappears once the full DOM settles. Root cause: on every drag or `appendChild` reorder, the iframe's compositor drops the inset box-shadow repaint. Fix: swap to `outline` which is painted outside the element and always repaints reliably.

2. **Multi-select drag moves only one item**: `selectedItems[]` is populated by mousedown, and `startDrag` correctly reads it (`var group = selectedItems.indexOf(item) !== -1 ? selectedItems.slice() : [item]`). However, a race condition in `_editorBgClick` (window mousedown) may clear `selectedItems` before `startDrag` reads it — because both handlers fire on the same mousedown event. Additionally, the existing selection on re-click without shift clears selection then re-adds only the clicked item.

---

## Fix 1 — Selection Ring CSS

**File:** `gallery9.css`

Replace:
```css
body.edit-mode .g9-item.g9-selected {
  box-shadow: inset 0 0 0 4px #4A90D9 !important;
  outline: none !important;
}
```

With:
```css
body.edit-mode .g9-item.g9-selected {
  outline: 3px solid #4A90D9 !important;
  outline-offset: -3px;
  box-shadow: none;
}
```

`outline-offset: -3px` pulls the ring inside the element boundary so it doesn't overlap neighboring items.

---

## Fix 2 — _editorBgClick Race Condition

**File:** `gallery9.js`

The window-level `mousedown` handler fires on the same tick as the item's own `mousedown`. Because event bubbling runs from item → parent → window, the item handler runs first (adds to `selectedItems`). The window handler then checks `!e.target.closest(".g9-item")` — this guard is already correct and won't fire when clicking an item.

**No change needed** here after investigation — the guard is correct.

However: when clicking a **non-shift** item that IS already in `selectedItems`, `clearSelection()` then re-adds it. This means a drag on a previously selected item works fine (it re-adds itself before `startDrag`). The issue is solely the visual ring, not the selection state.

---

## Fix 3 — Multi-Select Drag Root Cause

**File:** `gallery9.js`

The group drag code in `startDrag` is:
```js
var group = (selectedItems.length > 0 && selectedItems.indexOf(item) !== -1)
  ? selectedItems.slice() : [item];
```

The problem: when the user clicks (non-shift) on an item that is **already** in `selectedItems`, the mousedown handler calls `clearSelection()` first, then re-adds only that one item. So by the time `startDrag` runs, `selectedItems` only has one item.

**Fix:** In the mousedown handler, when NOT using shift, check if the clicked item is already in the selection. If it is AND there are multiple selected items, do NOT call `clearSelection()` — keep the full group selection so dragging works. Only clear if clicking a completely different item.

Updated logic in `setupEditorItem` mousedown:
```js
if (e.shiftKey) {
  // toggle clicked item in/out of selection
  var _idx = selectedItems.indexOf(item);
  if (_idx === -1) {
    selectedItems.push(item);
    item.classList.add("g9-selected");
  } else {
    selectedItems.splice(_idx, 1);
    item.classList.remove("g9-selected");
  }
  updateEditButton();
} else {
  // Non-shift: if item is already in a multi-selection, keep group for drag
  if (selectedItems.length > 1 && selectedItems.indexOf(item) !== -1) {
    // Keep selection intact — startDrag will use the full group
    // (clicking without shift on a selected item in a group starts group drag)
  } else {
    clearSelection();
    selectedItems.push(item);
    item.classList.add("g9-selected");
    updateEditButton();
  }
}
```

Note: after `endDrag`, `clearSelection()` is already called, so the group is cleared after the drag completes. This is correct behavior.

---

## Implementation Order

1. Fix CSS in `gallery9.css`
2. Fix mousedown selection logic in `gallery9.js`
3. Bump `gallery9.js?v=8` and `gallery9.css?v=5` in `gallery9.html`
4. Commit + push

---

## Success Criteria

- [ ] Single click shows persistent blue ring that does NOT disappear after full load
- [ ] Clicking a second item without shift deselects the first and selects the second
- [ ] Shift+click adds to selection, shift+click on selected removes it
- [ ] Dragging one of multiple selected items moves all of them
- [ ] After drag completes, selection is cleared
