const lightbox = document.getElementById("lightbox");
const lightboxImg = document.getElementById("lightbox-img");
const lightboxCaption = document.getElementById("lightbox-caption");
const lightboxCounter = document.getElementById("lightbox-counter");

let visibleItems = [];
let currentIndex = 0;

function getGalleryItems() {
  return [...document.querySelectorAll(".gallery-item:not(.gallery-add-btn)")];
}

// ══════════════════════════════════════════════
// EDITOR MODE (Shift+L)
//   Click        → cycle size (1× → 2w → 3w → 2×2 → tall)
//   Drag         → reorder (live preview with sliding)
//   Shift+Drag   → reposition crop focal point
//   Delete btn   → remove image
//   + button     → add images from file picker
// ══════════════════════════════════════════════

let editorMode = false;
let editorOverlay = null;

// Drag state
let activeItem = null;
let dragStartX = 0;
let dragStartY = 0;
let isDragging = false;
let isCropping = false;
let dragGhost = null;
let lastDropTarget = null;
const DRAG_THRESHOLD = 8;

// Crop state per item
function getCropState(item) {
  if (!item._cropState) {
    const img = item.querySelector("img");
    const computed = getComputedStyle(img);
    const pos = computed.objectPosition.split(" ");
    item._cropState = {
      objX: parseFloat(pos[0]) || 50,
      objY: parseFloat(pos[1]) || 50
    };
  }
  return item._cropState;
}

function toggleEditor() {
  editorMode = !editorMode;

  if (editorMode) {
    editorOverlay = document.createElement("div");
    editorOverlay.id = "edit-overlay";
    editorOverlay.innerHTML = `
      <div class="edit-banner">
        EDITOR — Click: size · Drag: reorder · Shift+Drag: crop ·
        <span class="save-indicator" style="opacity:0.4;font-size:11px;margin-left:4px">✓ saved</span>
        <button id="editor-done">Done</button>
        <button id="editor-export">Export HTML</button>
        <button id="editor-reset">Reset</button>
      </div>
    `;
    document.body.appendChild(editorOverlay);
    document.body.classList.add("edit-mode");

    document.getElementById("editor-done").addEventListener("click", toggleEditor);
    document.getElementById("editor-export").addEventListener("click", exportAll);
    document.getElementById("editor-reset").addEventListener("click", () => {
      localStorage.removeItem("galleryLayout");
      location.reload();
    });

    // Setup each gallery item
    getGalleryItems().forEach((item) => {
      setupEditorItem(item);
    });

    // Add the "+" button at the end
    addAddButton();

    // Hidden file input for adding images
    if (!document.getElementById("image-file-input")) {
      const input = document.createElement("input");
      input.type = "file";
      input.id = "image-file-input";
      input.multiple = true;
      input.accept = "image/*";
      input.style.display = "none";
      input.addEventListener("change", handleFileAdd);
      document.body.appendChild(input);
    }

    // Global mouse handlers
    window._editorMouseMove = (e) => {
      if (!activeItem) return;

      const dx = e.clientX - dragStartX;
      const dy = e.clientY - dragStartY;
      const dist = Math.sqrt(dx * dx + dy * dy);

      if (!isDragging && !isCropping && dist > DRAG_THRESHOLD) {
        if (e.shiftKey) {
          isCropping = true;
          activeItem.style.cursor = "crosshair";
          const crop = getCropState(activeItem);
          activeItem._cropStartX = crop.objX;
          activeItem._cropStartY = crop.objY;
        } else {
          isDragging = true;
          startDrag(activeItem, e);
        }
      }

      if (isDragging) moveDrag(e);
      else if (isCropping) moveCrop(activeItem, e);
    };

    window._editorMouseUp = (e) => {
      if (!activeItem) return;

      if (isDragging) endDrag();
      else if (isCropping) endCrop(activeItem);
      else cycleSize(activeItem);

      activeItem = null;
      isDragging = false;
      isCropping = false;
    };

    window.addEventListener("mousemove", window._editorMouseMove);
    window.addEventListener("mouseup", window._editorMouseUp);

  } else {
    // Exit editor
    if (editorOverlay) editorOverlay.remove();
    document.body.classList.remove("edit-mode");

    getGalleryItems().forEach((item) => {
      const badge = item.querySelector(".layout-badge");
      if (badge) badge.remove();
      const orderNum = item.querySelector(".order-number");
      if (orderNum) orderNum.remove();
      const delBtn = item.querySelector(".delete-btn");
      if (delBtn) delBtn.remove();
      item.style.cursor = "pointer";
      item.style.opacity = "";
      if (item._onMouseDown) {
        item.removeEventListener("mousedown", item._onMouseDown);
      }
    });

    // Remove add button
    const addBtn = document.querySelector(".gallery-add-btn");
    if (addBtn) addBtn.remove();

    window.removeEventListener("mousemove", window._editorMouseMove);
    window.removeEventListener("mouseup", window._editorMouseUp);

    visibleItems = getGalleryItems();
    bindClicks();
  }
}

function setupEditorItem(item) {
  updateBadge(item);
  addOrderNumber(item);
  addDeleteButton(item);
  item.style.cursor = "grab";

  item._onMouseDown = (e) => {
    if (!editorMode || e.button !== 0) return;
    // Don't start drag if clicking delete button
    if (e.target.classList.contains("delete-btn")) return;
    e.preventDefault();
    activeItem = item;
    dragStartX = e.clientX;
    dragStartY = e.clientY;
    isDragging = false;
    isCropping = false;
  };

  item.addEventListener("mousedown", item._onMouseDown);
}

// ── Delete ──

function addDeleteButton(item) {
  if (item.querySelector(".delete-btn")) return;
  const btn = document.createElement("button");
  btn.className = "delete-btn";
  btn.textContent = "×";
  btn.title = "Remove image";
  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    deleteImage(item);
  });
  item.appendChild(btn);
}

function deleteImage(item) {
  const img = item.querySelector("img");
  const filename = img.src.split("/").pop();

  // Animate out
  item.style.transform = "scale(0.8)";
  item.style.opacity = "0";

  setTimeout(() => {
    item.remove();
    refreshOrderNumbers();
    autoSave();
  }, 250);
}

// ── Add Images ──

function addAddButton() {
  if (document.querySelector(".gallery-add-btn")) return;
  const btn = document.createElement("div");
  btn.className = "gallery-add-btn";
  btn.innerHTML = "+ ADD IMAGES";
  btn.addEventListener("click", () => {
    document.getElementById("image-file-input").click();
  });
  document.getElementById("gallery").appendChild(btn);
}

function handleFileAdd(e) {
  const files = e.target.files;
  if (!files.length) return;

  const gallery = document.getElementById("gallery");
  const addBtn = document.querySelector(".gallery-add-btn");

  Array.from(files).forEach((file) => {
    // Create object URL for preview (works locally)
    const url = URL.createObjectURL(file);

    const item = document.createElement("div");
    item.className = "gallery-item";
    item.style.opacity = "1"; // skip animation for added items

    const img = document.createElement("img");
    img.src = url;
    img.alt = "Beltline App";
    img.loading = "lazy";
    img.dataset.filename = file.name; // store original filename

    item.appendChild(img);
    gallery.insertBefore(item, addBtn);
    setupEditorItem(item);
  });

  refreshOrderNumbers();
  autoSave();

  // Reset input so same files can be re-added
  e.target.value = "";
}

// ── Reorder Drag (Live Sliding Preview) ──

function startDrag(item, e) {
  // Make the original item a ghost placeholder
  item.classList.add("drag-placeholder");
  item.style.cursor = "grabbing";

  // Create floating ghost thumbnail
  const img = item.querySelector("img");
  dragGhost = document.createElement("div");
  dragGhost.className = "drag-ghost";
  dragGhost.innerHTML = `<img src="${img.src}" style="width:100%;height:100%;object-fit:cover;object-position:${img.style.objectPosition || '50% 50%'}">`;
  dragGhost.style.cssText = `
    position: fixed; z-index: 10000; pointer-events: none;
    width: 140px; height: 105px; opacity: 0.9;
    border: 2px solid #1a1a1a; border-radius: 4px; overflow: hidden;
    box-shadow: 0 12px 32px rgba(0,0,0,0.35);
    transform: translate(-50%, -50%) scale(1.05);
    left: ${e.clientX}px; top: ${e.clientY}px;
    transition: none;
  `;
  document.body.appendChild(dragGhost);

  lastDropTarget = null;
}

function moveDrag(e) {
  if (dragGhost) {
    dragGhost.style.left = e.clientX + "px";
    dragGhost.style.top = e.clientY + "px";
  }

  // Find which item we're hovering over
  const items = getGalleryItems();
  let closestItem = null;
  let insertBefore = true;
  let minDist = Infinity;

  items.forEach((item) => {
    if (item === activeItem) return;
    const rect = item.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    const dist = Math.sqrt((e.clientX - centerX) ** 2 + (e.clientY - centerY) ** 2);

    if (dist < minDist) {
      minDist = dist;
      closestItem = item;
      // Use horizontal position relative to center to decide before/after
      insertBefore = e.clientX < centerX;
    }
  });

  // Live reorder: actually move the DOM element
  if (closestItem && closestItem !== lastDropTarget) {
    const gallery = document.getElementById("gallery");
    const addBtn = document.querySelector(".gallery-add-btn");

    if (insertBefore) {
      gallery.insertBefore(activeItem, closestItem);
    } else {
      const next = closestItem.nextSibling;
      // Don't insert after the add button
      if (next && next !== addBtn) {
        gallery.insertBefore(activeItem, next);
      } else if (next === addBtn) {
        gallery.insertBefore(activeItem, addBtn);
      } else {
        gallery.insertBefore(activeItem, addBtn);
      }
    }

    lastDropTarget = closestItem;
    refreshOrderNumbers();
  }
}

function endDrag() {
  if (dragGhost) { dragGhost.remove(); dragGhost = null; }

  activeItem.classList.remove("drag-placeholder");
  activeItem.style.cursor = "grab";

  lastDropTarget = null;
  refreshOrderNumbers();
  autoSave();
}

// ── Crop Reposition (Shift+Drag) ──

function moveCrop(item, e) {
  const img = item.querySelector("img");
  const crop = getCropState(item);
  const dx = e.clientX - dragStartX;
  const dy = e.clientY - dragStartY;

  crop.objX = Math.max(0, Math.min(100, item._cropStartX - (dx / item.offsetWidth) * 100));
  crop.objY = Math.max(0, Math.min(100, item._cropStartY - (dy / item.offsetHeight) * 100));

  img.style.objectPosition = `${crop.objX.toFixed(1)}% ${crop.objY.toFixed(1)}%`;
}

function endCrop(item) {
  item.style.cursor = "grab";
  autoSave();
}

// ── Size Cycling ──
// 1× → 2w → 2×2 → 3w → tall → 1×

function getSize(item) {
  if (item.classList.contains("featured-tall")) return "tall";
  if (item.classList.contains("featured-wide")) return 3;
  if (item.classList.contains("featured-2x2")) return "2x2";
  if (item.classList.contains("featured")) return 2;
  return 1;
}

function cycleSize(item) {
  const current = getSize(item);
  item.classList.remove("featured", "featured-wide", "featured-tall", "featured-2x2");

  if (current === 1) item.classList.add("featured");        // → 2w
  else if (current === 2) item.classList.add("featured-2x2"); // → 2×2
  else if (current === "2x2") item.classList.add("featured-wide"); // → 3w
  else if (current === 3) item.classList.add("featured-tall"); // → tall
  // "tall" → back to 1

  updateBadge(item);
  autoSave();
}

// ── Badges & Order Numbers ──

const BADGE_LABELS = { 1: "1×", 2: "2w", "2x2": "2×2", 3: "3w", "tall": "tall" };
const BADGE_COLORS = { 1: "rgba(0,0,0,0.5)", 2: "#1a1a1a", "2x2": "#36c", 3: "#c44", "tall": "#2a7" };

function updateBadge(item) {
  let badge = item.querySelector(".layout-badge");
  if (!badge) {
    badge = document.createElement("span");
    badge.className = "layout-badge";
    item.appendChild(badge);
  }
  const size = getSize(item);
  badge.textContent = BADGE_LABELS[size];
  badge.style.cssText = `
    position: absolute; top: 8px; left: 8px;
    background: ${BADGE_COLORS[size]};
    color: #EDEBE0; padding: 4px 10px;
    font-family: 'Inconsolata', monospace; font-size: 13px;
    letter-spacing: 0.1em; z-index: 10; pointer-events: none;
  `;
}

function addOrderNumber(item) {
  let num = item.querySelector(".order-number");
  if (!num) {
    num = document.createElement("span");
    num.className = "order-number";
    item.appendChild(num);
  }
  num.textContent = "#" + (getGalleryItems().indexOf(item) + 1);
  num.style.cssText = `
    position: absolute; bottom: 8px; right: 8px;
    background: rgba(0,0,0,0.6); color: #EDEBE0;
    padding: 3px 8px; font-family: 'Inconsolata', monospace;
    font-size: 12px; letter-spacing: 0.05em;
    z-index: 10; pointer-events: none;
  `;
}

function refreshOrderNumbers() {
  getGalleryItems().forEach((item) => addOrderNumber(item));
}

// ── Save & Restore State ──

function saveState() {
  const items = getGalleryItems();
  const state = items.map((item) => {
    const img = item.querySelector("img");
    const src = img.dataset.filename || img.src.split("/").pop();
    const crop = img.style.objectPosition || "";
    return {
      file: src,
      size: getSize(item),
      crop: crop && crop !== "50% 50%" ? crop : null
    };
  });
  localStorage.setItem("galleryLayout", JSON.stringify(state));
}

function restoreState() {
  const saved = localStorage.getItem("galleryLayout");
  if (!saved) return;

  try {
    const state = JSON.parse(saved);
    const gallery = document.getElementById("gallery");
    const items = getGalleryItems();

    const itemMap = {};
    items.forEach((item) => {
      const filename = item.querySelector("img").src.split("/").pop();
      itemMap[filename] = item;
    });

    // Track which items from the saved state still exist
    const restoredItems = new Set();

    state.forEach((entry) => {
      const item = itemMap[entry.file];
      if (!item) return;

      gallery.appendChild(item);
      restoredItems.add(entry.file);

      item.classList.remove("featured", "featured-wide", "featured-tall", "featured-2x2");
      if (entry.size === 2) item.classList.add("featured");
      else if (entry.size === 3) item.classList.add("featured-wide");
      else if (entry.size === "tall") item.classList.add("featured-tall");
      else if (entry.size === "2x2") item.classList.add("featured-2x2");

      if (entry.crop) {
        item.querySelector("img").style.objectPosition = entry.crop;
      }
    });

    // Append any new images not in saved state
    items.forEach((item) => {
      const filename = item.querySelector("img").src.split("/").pop();
      if (!restoredItems.has(filename)) {
        gallery.appendChild(item);
      }
    });

  } catch (e) {
    console.warn("Could not restore gallery state:", e);
  }
}

function autoSave() {
  saveState();
  const banner = document.querySelector(".edit-banner");
  if (banner) {
    const indicator = banner.querySelector(".save-indicator");
    if (indicator) {
      indicator.textContent = "✓ saved";
      indicator.style.opacity = "1";
      setTimeout(() => { indicator.style.opacity = "0.4"; }, 1000);
    }
  }
}

// ── Export ──

function exportAll() {
  const items = getGalleryItems();
  let output = "<!-- Gallery Layout -->\n";
  items.forEach((item) => {
    const img = item.querySelector("img");
    const filename = img.dataset.filename || img.src.split("/").pop();
    const size = getSize(item);
    const objPos = img.style.objectPosition;
    const posAttr = objPos && objPos !== "50% 50%" ? ` style="object-position: ${objPos}"` : "";
    const cls = size === "tall" ? ' class="gallery-item featured-tall"' :
                size === 3 ? ' class="gallery-item featured-wide"' :
                size === "2x2" ? ' class="gallery-item featured-2x2"' :
                size === 2 ? ' class="gallery-item featured"' :
                ' class="gallery-item"';
    output += `<div${cls}>\n  <img src="images/beltline_app/${filename}" alt="Beltline App" loading="lazy"${posAttr}>\n</div>\n`;
  });

  navigator.clipboard.writeText(output).then(() => {
    const btn = document.getElementById("editor-export");
    btn.textContent = "Copied HTML!";
    setTimeout(() => btn.textContent = "Export HTML", 2000);
  });

  console.log(output);
}

// Toggle with Shift+L
document.addEventListener("keydown", (e) => {
  if (e.key === "L" && e.shiftKey && !lightbox.classList.contains("active")) {
    toggleEditor();
  }
});

// ══════════════════════════════════════════════
// LIGHTBOX
// ══════════════════════════════════════════════

function openLightbox(index) {
  if (editorMode) return;
  currentIndex = index;
  const item = visibleItems[index];
  const img = item.querySelector("img");

  lightboxImg.src = img.src;
  lightboxImg.alt = img.alt;
  lightboxCaption.textContent = img.alt || "";
  lightboxCounter.textContent = (index + 1) + " / " + visibleItems.length;
  lightbox.classList.add("active");
  document.body.style.overflow = "hidden";
}

function closeLightbox() {
  lightbox.classList.remove("active");
  document.body.style.overflow = "";
}

function navigate(direction) {
  currentIndex = (currentIndex + direction + visibleItems.length) % visibleItems.length;
  openLightbox(currentIndex);
}

function bindClicks() {
  visibleItems = getGalleryItems();
  visibleItems.forEach((item, i) => {
    item.onclick = () => openLightbox(i);
  });
}

// Filter buttons (if present)
document.querySelectorAll(".filter-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelector(".filter-btn.active").classList.remove("active");
    btn.classList.add("active");

    const filter = btn.dataset.filter;
    getGalleryItems().forEach((item) => {
      if (filter === "all" || item.dataset.category === filter) {
        item.classList.remove("hidden");
      } else {
        item.classList.add("hidden");
      }
    });

    visibleItems = [...document.querySelectorAll(".gallery-item:not(.hidden)")];
    bindClicks();
  });
});

// Restore saved layout, then bind
restoreState();
bindClicks();

// Lightbox controls
document.getElementById("lightbox-close").addEventListener("click", closeLightbox);
document.getElementById("lightbox-prev").addEventListener("click", () => navigate(-1));
document.getElementById("lightbox-next").addEventListener("click", () => navigate(1));

lightbox.addEventListener("click", (e) => {
  if (e.target === lightbox) closeLightbox();
});

document.addEventListener("keydown", (e) => {
  if (!lightbox.classList.contains("active")) return;
  if (e.key === "Escape") closeLightbox();
  if (e.key === "ArrowLeft") navigate(-1);
  if (e.key === "ArrowRight") navigate(1);
});
