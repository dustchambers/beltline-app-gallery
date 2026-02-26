# Design: Artful Shuffle Button

**Date:** 2026-02-25
**Status:** Approved

---

## Behaviour

A **Shuffle** button in the editor banner. One click:

1. Pushes an undo snapshot (⌘Z reverts)
2. Removes all spacers (clean slate)
3. Fisher-Yates shuffles the image DOM order
4. Assigns each image a size from a weighted palette, respecting portrait/landscape orientation, with a no-repeat-adjacent rule
5. Clears all inline `gridColumn`/`gridRow` positions
6. Re-appends items to gallery in shuffled order
7. Calls `pinAllItems()` — gap-free placement, no bin-packing code needed
8. Calls `autoSave()` — persists to localStorage

---

## Size Palette — "Editorial" mode

Portrait = `img.naturalHeight > img.naturalWidth * 1.1`

**Landscape palette** (cols × rows, total weight = 20):
| Size | Weight | Character |
|------|--------|-----------|
| 6×4  | 7      | Standard — workhorse |
| 9×4  | 4      | Wide medium |
| 9×6  | 2      | Wide tall |
| 12×4 | 3      | Hero landscape |
| 12×6 | 2      | Large hero |
| 4×4  | 2      | Square accent |

**Portrait palette** (cols × rows, total weight = 20):
| Size | Weight | Character |
|------|--------|-----------|
| 4×6  | 8      | Standard portrait |
| 4×8  | 3      | Tall portrait |
| 6×8  | 4      | Wide portrait |
| 6×9  | 2      | Statement portrait |
| 6×6  | 3      | Square accent |

**No-repeat-adjacent rule**: if the randomly chosen size equals the previous image's size, re-roll once. This prevents runs of identical blocks.

---

## Weighted Random Selection

Use a flat weighted array rather than a probability calculation:

```js
// Landscape weights expand to:
// ["6x4","6x4","6x4","6x4","6x4","6x4","6x4",
//  "9x4","9x4","9x4","9x4",
//  "9x6","9x6",
//  "12x4","12x4","12x4",
//  "12x6","12x6",
//  "4x4","4x4"]
// Pick: palette[Math.floor(Math.random() * palette.length)]
```

---

## UI

Single **Shuffle** button added to the editor banner, placed between "Publish" and "Reset":

```
Done  ✏ Edit Image  Publish  Shuffle  Reset
```

No dropdown, no mood picker — one mode only for now.

---

## What It Reuses (zero new infrastructure)

- `pushUndo()` — undo snapshot
- `isSpacer()` — spacer detection
- `img.naturalWidth / naturalHeight` — orientation
- `clearSizeClasses()` + `applySizeClass()` — size assignment
- `pinAllItems()` — gap-free grid placement
- `autoSave()` — localStorage persistence
- Reset handler pattern — exact template for the new function

---

## Files Changed

- `gallery9.js` — add `shuffleLayout()` function + Shuffle button in banner HTML + event listener wiring
- `gallery9.html` — version bump `js?v=11`

No CSS changes needed — Shuffle button inherits `.edit-banner-actions button` styles.

---

## Success Criteria

- [ ] Shuffle button appears in editor banner between Publish and Reset
- [ ] Clicking Shuffle randomises image order
- [ ] Portrait images always get portrait sizes; landscape always get landscape sizes
- [ ] No two adjacent images have the same size (after one re-roll)
- [ ] All spacers are removed
- [ ] ⌘Z reverts the shuffle
- [ ] Layout auto-saves to localStorage after shuffle
- [ ] `node --check` passes
