# Design: >25 Images via Multiple Webflow Multi-Image Fields

**Date:** 2026-02-25
**Status:** Approved

---

## Problem

Webflow's multi-image CMS field is capped at 25 items. A single gallery CMS item cannot hold more than 25 photos.

## Solution (Option D)

Add `images-2` and `images-3` as additional multi-image fields to the "Photo Galleries" Webflow CMS collection. The Cloudflare Worker concatenates all three fields into a single flat image array before returning the config to the gallery. The gallery sees one array of N images — it never knows about the multi-field origin.

## Architecture

```
Webflow CMS item "stills":
  fields.images      → [img_0 … img_24]   (up to 25)
  fields["images-2"] → [img_25 … img_49]  (up to 25)
  fields["images-3"] → [img_50 … img_74]  (up to 25)
                                              ↓
                          worker concatenates → [img_0 … img_74]
                                              ↓
                          gallery receives flat array, renders normally
```

## Image ID Stability

IDs are assigned globally across the concatenated array: `img_0`, `img_1`, …, `img_N`. An image's ID is stable as long as it stays in the same relative position across all fields. Adding new images to `images-2` after a layout is published appends them at the end — the existing `mergeLayout` logic already handles new images not in the saved layout (they are appended after saved entries).

## What Changes

- **worker/index.js**: Replace single-field extraction with three-field concatenation (3 lines)
- **Webflow CMS**: Add `images-2` and `images-3` multi-image fields (manual, done by user)
- **Nothing else**: gallery9.js, gallery9.css, gallery9.html — untouched

## Webflow Manual Steps (user does this)

1. Webflow Designer → CMS → "Photo Galleries" collection → Edit fields
2. Add new field: type = Multi-image, name = `Images 2`, slug auto-set to `images-2`
3. Add new field: type = Multi-image, name = `Images 3`, slug auto-set to `images-3`
4. Save collection schema
5. For any gallery with >25 photos: open CMS item, upload overflow photos to Images 2 / Images 3
6. Publish Webflow site

## Edge Cases

- Gallery with <25 images: `images-2` and `images-3` fields exist but are empty → spread of `[]` is a no-op
- Gallery with exactly 25: `images-2` empty → same as before
- Existing KV layouts: IDs `img_0`…`img_24` are unchanged → fully backward compatible
- Images added to `images-2` after publish: they appear at the end after merge (same as adding a new CMS image today)

## Success Criteria

- [ ] GET /stills returns all images from `images`, `images-2`, `images-3` concatenated
- [ ] IDs are globally sequential: `img_0` through `img_N`
- [ ] Existing KV layouts (with <25 images) continue to work unchanged
- [ ] A gallery with 30 images (25 in field 1, 5 in field 2) renders all 30 correctly
