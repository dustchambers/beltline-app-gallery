# Selection Ring + Multi-Select Drag Fix Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix two editor bugs: (1) selection ring disappears after page load, (2) multi-select drag only moves one item.

---

## Task 1: Fix selection ring CSS in gallery9.css

**Files:**
- Modify: `gallery9.css`

**Step 1: Replace box-shadow with outline**

Find this block (around line 856):
```css
body.edit-mode .g9-item.g9-selected {
  box-shadow: inset 0 0 0 4px #4A90D9 !important;
  outline: none !important;
}
```

Replace with:
```css
body.edit-mode .g9-item.g9-selected {
  outline: 3px solid #4A90D9 !important;
  outline-offset: -3px;
  box-shadow: none;
}
```

**Step 2: Verify**

The only `.g9-selected` rule in the file should now use `outline`, not `box-shadow`.

**Step 3: Commit**

```bash
cd /Users/dustintchambers/Documents/dev/lot43imagegallery
git add gallery9.css
git commit -m "fix: swap selection ring from box-shadow to outline for reliable repaint"
```

---

## Task 2: Fix multi-select drag in gallery9.js

**Files:**
- Modify: `gallery9.js`

**Step 1: Update mousedown selection logic in setupEditorItem**

Find this block (around line 2490-2506):
```js
if (!isSpacer(item)) {
  if (e.shiftKey) {
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
    clearSelection();
    selectedItems.push(item);
    item.classList.add("g9-selected");
    updateEditButton();
  }
}
```

Replace with:
```js
if (!isSpacer(item)) {
  if (e.shiftKey) {
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
    // If item is already in a multi-selection, keep the group intact for drag.
    // The group will be cleared after drag completes (in endDrag).
    if (selectedItems.length > 1 && selectedItems.indexOf(item) !== -1) {
      // keep selection — drag will move the whole group
    } else {
      clearSelection();
      selectedItems.push(item);
      item.classList.add("g9-selected");
      updateEditButton();
    }
  }
}
```

**Step 2: Verify**

Search for `selectedItems.indexOf` in gallery9.js — should appear 3 times: once in the shift block, once in the new group-drag guard, and once in `startDrag`.

**Step 3: Commit**

```bash
cd /Users/dustintchambers/Documents/dev/lot43imagegallery
git add gallery9.js
git commit -m "fix: preserve multi-selection when clicking selected item for group drag"
```

---

## Task 3: Bump versions, commit, push

**Files:**
- Modify: `gallery9.html`

**Step 1: Bump version strings**

In `gallery9.html`, find:
```html
<link rel="stylesheet" href="gallery9.css?v=4">
<script src="gallery9.js?v=7"></script>
```

Change to:
```html
<link rel="stylesheet" href="gallery9.css?v=5">
<script src="gallery9.js?v=8"></script>
```

**Step 2: Commit and push**

```bash
cd /Users/dustintchambers/Documents/dev/lot43imagegallery
git add gallery9.html
git commit -m "chore: bump versions to css?v=5, js?v=8 after selection fixes"
git push origin main
```

**Step 3: Verify push succeeded**

```bash
git log --oneline -4
```

Should show the 3 new commits at top.
