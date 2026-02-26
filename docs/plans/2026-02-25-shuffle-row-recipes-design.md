# Shuffle Row-Recipe Design

**Date:** 2026-02-25
**Status:** Approved
**Goal:** Eliminate orphan columns in shuffleLayout() by assigning sizes row-by-row using width recipes that sum to exactly 18.

---

## Problem

The current `shuffleLayout()` assigns a size class to each image independently, picking from orientation-split palettes. Because widths like `4`, `6`, `9`, `12` don't reliably sum to 18 in random sequence, `pinAllItems()` always leaves orphan cells — empty column gaps at row ends, and row height mismatches between adjacent items.

## Solution

Replace per-item size assignment with **row-recipe** assignment:

1. Fisher-Yates shuffle image order (unchanged)
2. Pull images from the shuffled array **row by row**:
   - Pick a weighted-random recipe (list of column widths summing to 18)
   - Take the next `recipe.length` images
   - Assign each image: its column width from the recipe + a random height from the height palette
3. Repeat until all images are placed

This guarantees **zero orphan columns** by construction — every row's widths sum to 18.

## Available Sizes

Grid is 18 columns wide. Available `WxH` sizes from `SIZE_CLASS_MAP`:

| Width | Heights available |
|-------|-------------------|
| 4     | 4, 6, 8           |
| 6     | 4, 6, 8, 9        |
| 9     | 4, 6              |
| 12    | 4, 6              |
| 18    | 4, 6, 8           |

Note: `2x2` excluded (too small). `9x8`, `9x9`, `12x8` don't exist — height options are constrained by available CSS classes.

## Row Recipes

Width combinations that sum to exactly 18, using available widths (`4`, `6`, `9`, `12`, `18`):

| Recipe       | Items | Weight | Feel                     |
|--------------|-------|--------|--------------------------|
| `[6, 6, 6]`  | 3     | 5      | Workhorse trio           |
| `[9, 9]`     | 2     | 4      | Bold pair                |
| `[6, 12]`    | 2     | 3      | Accent + hero            |
| `[12, 6]`    | 2     | 3      | Hero + accent            |
| `[4,4,4,6]`  | 4     | 2      | Dense quad (shuffled)    |
| `[18]`       | 1     | 1      | Full-width statement     |

The `[4,4,4,6]` recipe is itself Fisher-Yates shuffled before assignment so the wide item lands in a random position within the row.

## Height Palette

Heights are assigned **per image** independently of the recipe (not normalised per row). Weighted toward `4` for a clean editorial feel:

```
[4, 4, 4, 4, 4, 4,   // weight 6 — standard
 6, 6, 6, 6,         // weight 4 — medium tall
 8, 8,               // weight 2 — statement
 9]                  // weight 1 — dramatic
```

Heights are filtered per image against what CSS classes actually exist for that width. For example, `9`-wide images can only be `9x4` or `9x6` — height `8` and `9` are not available, so the height is re-rolled until a valid combination is found (with a fallback to `4`).

## Orientation

The portrait/landscape palette split is **removed**. Any image can receive any size. `object-fit: cover` + `object-position: center` crops the image to fill the box. This mirrors editorial/magazine layout practice where images are freely cropped to serve the composition.

## Out of Scope

- Row-height normalisation (making adjacent images in the same row share the same height). This would eliminate the remaining row-gap issue but is a separate pass.
- Focal-point-aware `object-position`. The current `center center` crop is sufficient for now.
- Full-width hero (`18x_`) gating — any image may become a hero; no content-awareness applied.

## Success Criteria

- After shuffle, no row has orphan empty columns (every row's widths sum to 18)
- All assigned size keys exist in `SIZE_CLASS_MAP`
- ⌘Z undoes the shuffle (via existing `pushUndo()`)
- `node --check gallery9.js` passes
- Visually: gallery fills edge-to-edge horizontally on every row
