# Image Selection & Adjustment Panel — Design Doc
_Date: 2026-02-23_

## Overview

Add per-image contrast/brightness/saturation adjustments to the gallery editor. Clicking an image selects it; when exactly one image is selected, an "Edit Image" button in the editor banner opens a floating adjust panel anchored to that image. Adjustments are persisted in localStorage and included in Publish, Export HTML, and Export Config.

---

## Interaction Model

### Click behavior (editor mode)
- **Click** an image → selects it (replaces click-to-cycle-size)
- **Shift+click** → adds/removes from multi-selection
- **Click empty gallery area** → deselects all
- **Drag** still reorders (existing 8px threshold unchanged)
- **Shift+drag crop** → removed
- **Size cycling (`cycleSize`)** → removed entirely

### Visual selection state
- Selected image: blue ring outline + small checkmark badge in corner
- Unselected images: no change

### Editor banner
- New **"✏ Edit Image"** button added to the banner
- Greyed/disabled when 0 or 2+ images are selected
- Active when exactly 1 image is selected
- Clicking opens the floating adjust panel for that image

---

## Floating Adjust Panel

Positioned `absolute` relative to the gallery container, anchored above the selected image. Auto-flips to below if the image is near the top of the viewport.

### Layout
```
┌─────────────────────────────┐
│ Contrast    [━━━●━━━━]  110 │
│ Brightness  [━━━━━●━━]  115 │
│ Saturation  [━━●━━━━━]   90 │
│          [Reset]  [Apply]   │
└─────────────────────────────┘
```

### Slider ranges
| Property   | Min | Max | Default |
|------------|-----|-----|---------|
| Contrast   | 50  | 150 | 100     |
| Brightness | 50  | 150 | 100     |
| Saturation | 0   | 200 | 100     |

### Behavior
- **Live preview**: CSS `filter` applied to `<img>` as sliders are dragged
- **Apply**: saves adjustments to item state, updates localStorage, closes panel
- **Reset**: returns all sliders to 100, clears `filter` on `<img>`, clears saved adjustments
- **Escape / click outside**: closes panel without applying (reverts live preview)

---

## Data Model

Each gallery item state gains an optional `adjustments` field:

```js
// Per-image state object (stored in localStorage config)
{
  src: "...",
  size: 1,
  crop: "50% 50%",
  adjustments: { contrast: 110, brightness: 115, saturation: 90 }  // NEW, optional
}
```

On render, if `adjustments` is present:
```css
filter: contrast(110%) brightness(115%) saturate(90%);
```
Applied as inline style on the `<img>` element.

---

## Persistence

| Target            | How adjustments are included                              |
|-------------------|-----------------------------------------------------------|
| localStorage      | `adjustments` field per item in existing layout JSON      |
| Publish (Worker)  | Included in the config JSON POSTed by `publishLayout()`   |
| Export HTML       | Inline `style="filter: contrast(…) brightness(…) …"` on `<img>` |
| Export Config     | `adjustments: {…}` field per image in config JSON         |

No new API endpoints or Worker changes needed — adjustments ride the existing publish payload.

---

## Removed Behaviors

- `cycleSize()` — removed; click-to-select replaces click-to-cycle
- Shift+drag crop focal point adjustment — removed
- Layout badge click (size cycling) — badge still renders for display but is no longer interactive

---

## Out of Scope

- Canvas/destructive crop
- Batch adjustments across multiple selected images
- Per-image undo history
- Upload of adjusted image blobs to the Worker
