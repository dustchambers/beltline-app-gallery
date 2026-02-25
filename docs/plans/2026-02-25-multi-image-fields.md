# Multi-Image Fields (>25 Images) Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Support galleries with more than 25 images by concatenating up to three Webflow multi-image fields (`images`, `images-2`, `images-3`) in the Cloudflare Worker.

**Architecture:** Worker-only change. `handleGet` concatenates all three multi-image fields into one flat array before building the config response. Gallery receives a single flat image array as always. Image IDs remain globally sequential (`img_0`…`img_N`).

**Tech Stack:** Cloudflare Workers, Wrangler CLI, Webflow CMS API v2

---

## Task 1: Update worker/index.js to concatenate multiple image fields

**Files:**
- Modify: `worker/index.js`

**Context:**

Currently `handleGet` extracts images like this (around line 113):
```js
const rawImages = fields.images || fields["gallery-images"] || [];

let images = rawImages.map((img, i) => ({
  id: `img_${i}`,
  src: img.url || img.fileId || "",
  alt: fields.name || "Gallery Image",
  size: 1,
}));
```

The fix concatenates three fields before mapping, keeping the index global.

**Step 1: Open worker/index.js and find the image extraction block**

Look for the comment `// Extract images from multi-image field` around line 112–121.

**Step 2: Replace the extraction block**

Replace:
```js
// Extract images from multi-image field
const rawImages = fields.images || fields["gallery-images"] || [];

let images = rawImages.map((img, i) => ({
  id: `img_${i}`,
  src: img.url || img.fileId || "",
  alt: fields.name || "Gallery Image",
  size: 1,
}));
```

With:
```js
// Extract images from all multi-image fields (supports >25 via images-2, images-3)
// IDs are globally sequential across all fields so KV layouts remain stable.
const rawImages = [
  ...(fields["images"]         || fields["gallery-images"] || []),
  ...(fields["images-2"]       || []),
  ...(fields["images-3"]       || []),
];

let images = rawImages.map((img, i) => ({
  id: `img_${i}`,
  src: img.url || img.fileId || "",
  alt: fields.name || "Gallery Image",
  size: 1,
}));
```

**Step 3: Verify the change manually**

Read the file and confirm:
- The three-field spread is present
- `img_${i}` still uses the loop index `i` (global across all fields)
- No other image extraction logic was affected

**Step 4: Commit**

```bash
cd /Users/dustintchambers/Documents/dev/lot43imagegallery
git add worker/index.js
git commit -m "feat: support >25 images via images-2 and images-3 Webflow fields"
```

---

## Task 2: Deploy the updated worker to Cloudflare

**Files:**
- No file changes — this is a deploy step

**Context:**

The worker is deployed via Wrangler. Unlike GitHub Pages, Cloudflare Workers require an explicit deploy command. The wrangler.toml is at `worker/wrangler.toml`.

**Step 1: Deploy**

```bash
cd /Users/dustintchambers/Documents/dev/lot43imagegallery/worker
npx wrangler deploy
```

Expected output includes:
```
Deployed lot43-gallery triggers (1 route)
  https://lot43-gallery.dustintchambers.workers.dev
```

If authentication is needed, run `npx wrangler login` first.

**Step 2: Verify the deploy succeeded**

```bash
curl -s "https://lot43-gallery.dustintchambers.workers.dev/stills" | python3 -c "
import sys, json
d = json.load(sys.stdin)
imgs = d.get('images', [])
print('Image count:', len(imgs))
print('First ID:', imgs[0]['id'] if imgs else 'none')
print('Last ID:', imgs[-1]['id'] if imgs else 'none')
print('OK: IDs sequential from img_0')
"
```

Expected: image count matches Webflow (e.g. 24), IDs run `img_0` through `img_23`.

**Step 3: Smoke-test with existing stills gallery**

Confirm existing gallery still works — no regression for galleries with <25 images.

```bash
curl -s "https://lot43-gallery.dustintchambers.workers.dev/stills" | python3 -c "
import sys, json
d = json.load(sys.stdin)
print('title:', d.get('title'))
print('image count:', len(d.get('images', [])))
print('first src non-empty:', bool(d['images'][0]['src']) if d.get('images') else False)
"
```

---

## Task 3: Write design doc, commit, push

**Files:**
- Already created: `docs/plans/2026-02-25-multi-image-fields-design.md`
- Already created: `docs/plans/2026-02-25-multi-image-fields.md`

**Step 1: Commit the docs and push everything**

```bash
cd /Users/dustintchambers/Documents/dev/lot43imagegallery
git add docs/plans/2026-02-25-multi-image-fields-design.md
git add docs/plans/2026-02-25-multi-image-fields.md
git commit -m "docs: add multi-image-fields design and implementation plan"
git push origin main
```

**Step 2: Verify push succeeded**

```bash
git log --oneline -5
```

Should show the two new commits at top.

---

## Webflow Manual Steps (user does after worker deploy)

These are not automatable — the user must do them in the Webflow Designer:

1. Open Webflow → CMS → "Photo Galleries" collection → Edit fields
2. Add field: type = **Multi-image**, name = `Images 2`, slug = `images-2`
3. Add field: type = **Multi-image**, name = `Images 3`, slug = `images-3`
4. Save the collection schema
5. For any gallery needing >25 photos: open the CMS item, upload photos 26–50 to `Images 2`, 51–75 to `Images 3`
6. Publish Webflow site
7. Test: open the gallery URL and verify all images appear

---

## Success Criteria

- [ ] `curl /stills` still returns the correct image count with sequential IDs
- [ ] A gallery with images in `images-2` returns all images concatenated in one flat array
- [ ] IDs are globally sequential: `img_0` through `img_N` without gaps or resets
- [ ] Existing KV-saved layouts (referencing `img_0`…`img_24`) continue to work
