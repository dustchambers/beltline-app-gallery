# Live CMS Gallery — Design

## Problem
Team members need to create photo galleries without touching code. Currently requires editing config files and pushing to GitHub.

## Solution
One `gallery.html` on GitHub Pages serves all galleries. Images come from Webflow CMS via a Cloudflare Worker proxy. Team uploads images in Webflow, gallery is live immediately.

## Architecture

```
Webflow CMS                 Cloudflare Worker           GitHub Pages
"Photo Galleries"    →    worker.dev/{slug}    →     gallery.html?id={slug}
 collection                (adds API token,           (fetches images,
 + multi-image)             returns JSON)              renders gallery)
```

## Webflow CMS: "Photo Galleries" Collection
- `Name` (title): "Beltline App"
- `Slug` (auto): "beltline-app"
- `Subtitle` (text): "January 15, 2026"
- `Images` (multi-image): all photos for this gallery

CMS template page includes iframe:
`<iframe src="https://dustchambers.github.io/beltline-app-gallery/gallery.html?id={slug}">`

## Cloudflare Worker
- Receives `GET /{gallery-slug}`
- Calls Webflow API: `GET /v2/collections/{id}/items` filtered by slug
- Returns JSON array of image objects with CDN URLs
- API token stored as Worker secret (never exposed to browser)
- Free tier: 100K requests/day

## gallery.html Changes
- Reads `?id=` from URL params
- Fetches from Cloudflare Worker instead of reading `window.GALLERY_CONFIG`
- Falls back to `window.GALLERY_CONFIG` if present (for local dev / static galleries)
- All editor functionality preserved (sizing, reorder, crop saved to localStorage per gallery ID)

## Team Workflow
1. Go to Webflow CMS → "Photo Galleries" → New Item
2. Name it, upload images
3. Publish site
4. Gallery is live with full interactive editor

## Files to Create/Modify
- `gallery.html` — new universal gallery page (reads ?id= param)
- `gallery.js` — add fetch-from-API mode alongside config mode
- `worker/index.js` — Cloudflare Worker code (~30 lines)
- Keep `galleries/beltline-app.js` as static fallback
