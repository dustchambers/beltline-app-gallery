# Lot43 Photo Layout
A standalone photo layout editor for photographers. Arrange images, resize frames, reposition crops, add text and spacing, and export a layout. Plain HTML, CSS, and JavaScript; no build step or account.

**[Try the demo and download the HTML](https://dustchambers.github.io/beltline-app-gallery/share/)** · **[Get the source](index.html)**

## Start in three steps
1. Download `index.html` from this folder (open it on GitHub, then choose **Download raw file**) or use the demo's **Download HTML** button.
2. Open the HTML in a text editor. Find `window.GALLERY_CONFIG`. Replace each sample `src` with your image URL or a relative path such as `photos/portrait.jpg`; update `alt` text, title, subtitle, and give each gallery a unique `id`.
3. Serve the file and your photos together. For a local preview, run `python3 -m http.server 8000` in that folder, then visit `http://localhost:8000/index.html?edit`. Rename the downloaded file to `index.html` first, or use its actual filename in the URL.

The hosted demo includes abstract sample artwork, not licensed photographs. Replace it with your own images.

## Edit and keep your layout
- Add `?edit` to enter the desktop editor. Drag images, use their resize handles, and use Shift+drag on an image to reposition the crop.
- Shift+click selects multiple items. Cmd/Ctrl+Z undoes changes.
- Empty slots let you add spacers and text.
- Changes autosave **only in the current browser**. They are not published to other visitors.
- Choose **Export → Export Config** (or **Copy layout JSON**). Paste the copied array into the `images` property of `window.GALLERY_CONFIG`, replacing the existing array, and upload the updated file.
- Local previews on localhost support clipboard export. Public hosting should use HTTPS. Browser opening via `file://` has inconsistent storage and clipboard behavior.
- Remove `?edit` for the public view. The grid scales proportionally on small screens; the editor is designed for a mouse and keyboard.

## What's included
Everything is embedded in one HTML file: styles, editor code, configuration, and sample artwork. No fonts, backend calls, Webflow account, or build tools are required. Your own externally hosted image URLs will of course need a network connection.

This standalone edition is derived from `gallery9.js` and `gallery9.css` at source commit `7fb14568da739149e9bc45f6ca9c34b6ca35a92c` (July 30, 2026), the latest committed version when packaged on October 6, 2026. The legacy filename says “9”; the current engine uses an 18-column grid for finer placement. Remote config loading and publishing were removed; the publishing button now copies layout JSON.

## License
The files in this `share/` folder are MIT licensed. See [LICENSE](LICENSE). That license does **not** cover photographs or other assets elsewhere in this repository.

## Validation
Inline scripts passed JavaScript syntax checks. The package was checked for remote backend calls and embedded authorization values. A browser rendering test could not run in the packaging environment; no cross-browser or accessibility certification is claimed.
