(function () {
  "use strict";

  // ── Config Resolution ──
  // Priority: 1) window.GALLERY_CONFIG (static), 2) ?id= param → API fetch

  var WORKER_URL = "https://lot43-gallery.dustintchambers.workers.dev";

  var config = window.GALLERY_CONFIG || null;

  function getGalleryIdFromUrl() {
    var params = new URLSearchParams(window.location.search);
    return params.get("id");
  }

  function boot(cfg) {
    config = cfg;
    STORAGE_KEY = "galleryLayout_" + config.id;
    init();
    // Auto-enter edit mode if ?edit is in URL
    if (hasEditParam()) toggleEditor();
  }

  if (config) {
    // Static config provided — boot immediately (after IIFE body is defined)
    // Handled at the bottom via init()
  } else {
    var galleryId = getGalleryIdFromUrl();
    if (galleryId) {
      // Fetch config from Cloudflare Worker
      fetch(WORKER_URL + "/" + encodeURIComponent(galleryId))
        .then(function (res) {
          if (!res.ok) throw new Error("API returned " + res.status);
          return res.json();
        })
        .then(function (cfg) {
          boot(cfg);
        })
        .catch(function (err) {
          console.error("gallery.js: Failed to fetch gallery config:", err);
          var gallery = document.getElementById("gallery");
          if (gallery) {
            gallery.innerHTML =
              '<p style="text-align:center;padding:4rem;color:#999;font-family:sans-serif">' +
              'Gallery not found. Check the URL or try again later.</p>';
          }
        });
    } else {
      console.warn("gallery.js: No GALLERY_CONFIG and no ?id= parameter.");
      return;
    }
  }

  // ── Constants ──

  var STORAGE_KEY = config ? "galleryLayout_" + config.id : "";

  var SIZE_CLASS_MAP = {
    2: "featured",
    3: "featured-wide",
    "2x2": "featured-2x2",
    "tall": "featured-tall",
    "4x2": "featured-4x2"
  };

  var ALL_SIZE_CLASSES = ["featured", "featured-wide", "featured-2x2", "featured-tall", "featured-4x2"];

  var BADGE_LABELS = { 1: "1\u00d7", 2: "2w", "2x2": "2\u00d72", 3: "3w", "tall": "tall", "4x2": "4\u00d72" };
  var BADGE_COLORS = { 1: "rgba(0,0,0,0.5)", 2: "#1a1a1a", "2x2": "#36c", 3: "#c44", "tall": "#2a7", "4x2": "#a4c" };

  var DRAG_THRESHOLD = 8;

  // ── State ──

  var lightbox, lightboxImg, lightboxCaption, lightboxCounter;
  var visibleItems = [];
  var currentIndex = 0;

  var editorMode = false;
  var editorOverlay = null;
  var selectedItems = new Set();

  var adjustPanel = null;
  var adjustTarget = null;
  var adjustPending = { contrast: 100, brightness: 100, saturation: 100 };

  var activeItem = null;
  var dragStartX = 0;
  var dragStartY = 0;
  var isDragging = false;
  var dragGhost = null;
  var lastDropTarget = null;
  var lastInsertBefore = true;

  // ── DOM Helpers ──

  function getGalleryItems() {
    return [].slice.call(
      document.querySelectorAll(".gallery-item")
    );
  }

  function getGallery() {
    return document.getElementById("gallery");
  }

  // ── Render Gallery from Config ──

  function renderGallery() {
    var gallery = getGallery();
    if (!gallery) return;

    config.images.forEach(function (entry) {
      var div = document.createElement("div");
      div.className = "gallery-item";

      var sizeClass = SIZE_CLASS_MAP[entry.size];
      if (sizeClass) {
        div.classList.add(sizeClass);
      }

      var img = document.createElement("img");
      img.src = entry.src;
      img.alt = entry.alt || "";
      img.loading = "lazy";
      img.dataset.imageId = entry.id;

      if (entry.crop && entry.crop !== "50% 50%") {
        img.style.objectPosition = entry.crop;
      }

      div.appendChild(img);
      gallery.appendChild(div);
    });
  }

  // ── Self-Creating Lightbox ──

  function ensureLightbox() {
    lightbox = document.getElementById("lightbox");

    if (!lightbox) {
      lightbox = document.createElement("div");
      lightbox.className = "lightbox";
      lightbox.id = "lightbox";
      lightbox.innerHTML =
        '<button class="lightbox-close" id="lightbox-close">&times;</button>' +
        '<button class="lightbox-nav lightbox-prev" id="lightbox-prev">&#8249;</button>' +
        '<button class="lightbox-nav lightbox-next" id="lightbox-next">&#8250;</button>' +
        '<img src="" alt="" id="lightbox-img">' +
        '<p class="lightbox-caption" id="lightbox-caption"></p>' +
        '<span class="lightbox-counter" id="lightbox-counter"></span>';
      document.body.appendChild(lightbox);
    }

    lightboxImg = document.getElementById("lightbox-img");
    lightboxCaption = document.getElementById("lightbox-caption");
    lightboxCounter = document.getElementById("lightbox-counter");
  }

  // ── Size Helpers ──

  function getSize(item) {
    if (item.classList.contains("featured-4x2")) return "4x2";
    if (item.classList.contains("featured-tall")) return "tall";
    if (item.classList.contains("featured-wide")) return 3;
    if (item.classList.contains("featured-2x2")) return "2x2";
    if (item.classList.contains("featured")) return 2;
    return 1;
  }

  function clearSizeClasses(item) {
    ALL_SIZE_CLASSES.forEach(function (cls) {
      item.classList.remove(cls);
    });
  }

  function applySizeClass(item, size) {
    clearSizeClasses(item);
    var cls = SIZE_CLASS_MAP[size];
    if (cls) {
      item.classList.add(cls);
    }
  }

  // ── Crop State ──

  function getCropState(item) {
    if (!item._cropState) {
      var img = item.querySelector("img");
      var computed = getComputedStyle(img);
      var pos = computed.objectPosition.split(" ");
      item._cropState = {
        objX: parseFloat(pos[0]) || 50,
        objY: parseFloat(pos[1]) || 50
      };
    }
    return item._cropState;
  }

  // ── Save & Restore State ──

  function saveState() {
    var items = getGalleryItems();
    var state = items.map(function (item) {
      var img = item.querySelector("img");
      var crop = img.style.objectPosition || "";
      return {
        id: img.dataset.imageId || "",
        size: getSize(item),
        crop: (crop && crop !== "50% 50%") ? crop : null
      };
    });
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }

  function restoreState() {
    var saved = localStorage.getItem(STORAGE_KEY);
    if (!saved) return;

    try {
      var state = JSON.parse(saved);
      var gallery = getGallery();
      var items = getGalleryItems();

      var itemMap = {};
      items.forEach(function (item) {
        var id = item.querySelector("img").dataset.imageId;
        if (id) {
          itemMap[id] = item;
        }
      });

      var restoredIds = {};

      state.forEach(function (entry) {
        var item = itemMap[entry.id];
        if (!item) return;

        gallery.appendChild(item);
        restoredIds[entry.id] = true;

        applySizeClass(item, entry.size);

        if (entry.crop) {
          item.querySelector("img").style.objectPosition = entry.crop;
        }
      });

      // Append any new images not present in saved state
      items.forEach(function (item) {
        var id = item.querySelector("img").dataset.imageId;
        if (!restoredIds[id]) {
          gallery.appendChild(item);
        }
      });
    } catch (e) {
      console.warn("Could not restore gallery state:", e);
    }
  }

  function autoSave() {
    saveState();
    var banner = document.querySelector(".edit-banner");
    if (!banner) return;
    var indicator = banner.querySelector(".save-indicator");
    if (!indicator) return;
    indicator.textContent = "\u2713 saved";
    indicator.style.opacity = "1";
    setTimeout(function () {
      indicator.style.opacity = "0.4";
    }, 1000);
  }

  // ── Lightbox ──

  var isIframe = window.self !== window.top;
  var lightboxOpen = false;

  function openLightbox(index) {
    if (editorMode) return;
    currentIndex = index;
    var item = visibleItems[index];
    var img = item.querySelector("img");

    // In iframe: delegate lightbox to parent page (position:fixed works there)
    if (isIframe) {
      var images = visibleItems.map(function(el) {
        var i = el.querySelector("img");
        return { src: i.src, alt: i.alt || "" };
      });
      window.parent.postMessage({
        type: "lightbox",
        images: images,
        index: index
      }, "*");
      return;
    }

    lightboxImg.src = img.src;
    lightboxImg.alt = img.alt;
    lightboxCaption.textContent = img.alt || "";
    lightboxCounter.textContent = (index + 1) + " / " + visibleItems.length;

    lightboxOpen = true;
    lightbox.classList.add("active");
    document.body.style.overflow = "hidden";
  }

  function closeLightbox() {
    lightbox.classList.remove("active");
    lightboxOpen = false;
    document.body.style.overflow = "";
  }

  function navigate(direction) {
    currentIndex =
      (currentIndex + direction + visibleItems.length) % visibleItems.length;
    openLightbox(currentIndex);
  }

  function bindClicks() {
    visibleItems = getGalleryItems();
    visibleItems.forEach(function (item, i) {
      item.onclick = function () {
        openLightbox(i);
      };
    });
  }

  // ── Badges & Order Numbers ──

  function updateBadge(item) {
    var badge = item.querySelector(".layout-badge");
    if (!badge) {
      badge = document.createElement("span");
      badge.className = "layout-badge";
      item.appendChild(badge);
    }
    var size = getSize(item);
    badge.textContent = BADGE_LABELS[size];
    badge.style.cssText =
      "position: absolute; top: 8px; left: 8px;" +
      "background: " + BADGE_COLORS[size] + ";" +
      "color: #EDEBE0; padding: 4px 10px;" +
      "font-family: 'Inconsolata', monospace; font-size: 13px;" +
      "letter-spacing: 0.1em; z-index: 10; pointer-events: none;";
  }

  function addOrderNumber(item) {
    var num = item.querySelector(".order-number");
    if (!num) {
      num = document.createElement("span");
      num.className = "order-number";
      item.appendChild(num);
    }
    num.textContent = "#" + (getGalleryItems().indexOf(item) + 1);
    num.style.cssText =
      "position: absolute; bottom: 8px; right: 8px;" +
      "background: rgba(0,0,0,0.6); color: #EDEBE0;" +
      "padding: 3px 8px; font-family: 'Inconsolata', monospace;" +
      "font-size: 12px; letter-spacing: 0.05em;" +
      "z-index: 10; pointer-events: none;";
  }

  function refreshOrderNumbers() {
    getGalleryItems().forEach(function (item) {
      addOrderNumber(item);
    });
  }

  // ── Reorder Drag (Live Sliding Preview) ──

  function flipAnimate(draggedItem) {
    var items = getGalleryItems();
    var firstRects = [];
    items.forEach(function (item) {
      if (item === draggedItem) return;
      firstRects.push({ el: item, rect: item.getBoundingClientRect() });
    });
    return function play() {
      firstRects.forEach(function (entry) {
        var last = entry.el.getBoundingClientRect();
        var dx = entry.rect.left - last.left;
        var dy = entry.rect.top - last.top;
        if (dx === 0 && dy === 0) return;
        entry.el.style.transition = "none";
        entry.el.style.transform = "translate(" + dx + "px," + dy + "px)";
        entry.el.offsetHeight; // force reflow
        entry.el.style.transition = "transform 0.25s ease";
        entry.el.style.transform = "";
      });
    };
  }

  function startDrag(item, e) {
    item.classList.add("drag-placeholder");
    item.style.cursor = "grabbing";

    var img = item.querySelector("img");
    dragGhost = document.createElement("div");
    dragGhost.className = "drag-ghost";
    dragGhost.innerHTML =
      '<img src="' + img.src + '" style="width:100%;height:100%;object-fit:cover;object-position:' +
      (img.style.objectPosition || "50% 50%") + '">';
    dragGhost.style.cssText =
      "position: fixed; z-index: 10000; pointer-events: none;" +
      "width: 140px; height: 105px; opacity: 0.9;" +
      "border: 2px solid #1a1a1a; border-radius: 4px; overflow: hidden;" +
      "box-shadow: 0 12px 32px rgba(0,0,0,0.35);" +
      "transform: translate(-50%, -50%) scale(1.05);" +
      "left: " + e.clientX + "px; top: " + e.clientY + "px;" +
      "transition: none;";
    document.body.appendChild(dragGhost);

    lastDropTarget = null;
    lastInsertBefore = true;
  }

  function moveDrag(e) {
    if (dragGhost) {
      dragGhost.style.left = e.clientX + "px";
      dragGhost.style.top = e.clientY + "px";
    }

    var items = getGalleryItems();
    var closestItem = null;
    var insertBefore = true;
    var minDist = Infinity;

    items.forEach(function (item) {
      if (item === activeItem) return;
      var rect = item.getBoundingClientRect();
      var centerX = rect.left + rect.width / 2;
      var centerY = rect.top + rect.height / 2;
      var dist = Math.sqrt(
        Math.pow(e.clientX - centerX, 2) + Math.pow(e.clientY - centerY, 2)
      );

      if (dist < minDist) {
        minDist = dist;
        closestItem = item;
      }
    });

    if (!closestItem) return;

    // Hysteresis: require 15px improvement to switch targets
    if (lastDropTarget && closestItem !== lastDropTarget) {
      var lastRect = lastDropTarget.getBoundingClientRect();
      var lastDist = Math.sqrt(
        Math.pow(e.clientX - (lastRect.left + lastRect.width / 2), 2) +
        Math.pow(e.clientY - (lastRect.top + lastRect.height / 2), 2)
      );
      if (minDist > lastDist - 15) return;
    }

    // Dead zone for insert side
    var closestRect = closestItem.getBoundingClientRect();
    var centerX = closestRect.left + closestRect.width / 2;
    var deadZone = closestRect.width * 0.2;
    if (e.clientX < centerX - deadZone) {
      insertBefore = true;
    } else if (e.clientX > centerX + deadZone) {
      insertBefore = false;
    } else {
      insertBefore = lastInsertBefore;
    }

    if (closestItem !== lastDropTarget || insertBefore !== lastInsertBefore) {
      var gallery = getGallery();
      var play = flipAnimate(activeItem);

      if (insertBefore) {
        gallery.insertBefore(activeItem, closestItem);
      } else {
        var next = closestItem.nextSibling;
        if (next) {
          gallery.insertBefore(activeItem, next);
        } else {
          gallery.appendChild(activeItem);
        }
      }

      play();
      lastDropTarget = closestItem;
      lastInsertBefore = insertBefore;
      refreshOrderNumbers();
    }
  }

  function endDrag() {
    if (dragGhost) {
      dragGhost.remove();
      dragGhost = null;
    }

    activeItem.classList.remove("drag-placeholder");
    activeItem.style.cursor = "grab";

    lastDropTarget = null;
    lastInsertBefore = true;
    refreshOrderNumbers();
    autoSave();
  }

  // ── Crop Reposition (Shift+Drag) ──

  function moveCrop(item, e) {
    var img = item.querySelector("img");
    var crop = getCropState(item);
    var dx = e.clientX - dragStartX;
    var dy = e.clientY - dragStartY;

    crop.objX = Math.max(
      0,
      Math.min(100, item._cropStartX - (dx / item.offsetWidth) * 100)
    );
    crop.objY = Math.max(
      0,
      Math.min(100, item._cropStartY - (dy / item.offsetHeight) * 100)
    );

    img.style.objectPosition =
      crop.objX.toFixed(1) + "% " + crop.objY.toFixed(1) + "%";
  }

  function endCrop(item) {
    item.style.cursor = "grab";
    autoSave();
  }

  // ── Editor Item Setup ──

  function setupEditorItem(item) {
    updateBadge(item);
    addOrderNumber(item);
    item.style.cursor = "grab";

    item._onMouseDown = function (e) {
      if (!editorMode || e.button !== 0) return;
      e.preventDefault();
      activeItem = item;
      dragStartX = e.clientX;
      dragStartY = e.clientY;
      isDragging = false;
    };

    item.addEventListener("mousedown", item._onMouseDown);
  }

  // ── Selection ──

  function toggleSelect(item, e) {
    var isShift = e && e.shiftKey;
    if (!isShift) {
      selectedItems.forEach(function (el) {
        el.classList.remove("selected");
      });
      selectedItems.clear();
    }
    if (selectedItems.has(item)) {
      selectedItems.delete(item);
      item.classList.remove("selected");
    } else {
      selectedItems.add(item);
      item.classList.add("selected");
    }
    updateEditButton();
  }

  function clearSelection() {
    selectedItems.forEach(function (el) {
      el.classList.remove("selected");
    });
    selectedItems.clear();
    updateEditButton();
  }

  function updateEditButton() {
    var btn = document.getElementById("editor-edit-image");
    if (!btn) return;
    var count = selectedItems.size;
    btn.disabled = count !== 1;
    btn.title = count === 0 ? "Select one image to edit"
      : count > 1 ? "Select only one image to edit"
      : "";
  }

  // ── Adjust Panel ──

  function openAdjustPanel(item) {
    adjustTarget = item;
    var saved = item._adjustments || { contrast: 100, brightness: 100, saturation: 100 };
    adjustPending = { contrast: saved.contrast, brightness: saved.brightness, saturation: saved.saturation };

    if (!adjustPanel) {
      adjustPanel = document.createElement("div");
      adjustPanel.id = "adjust-panel";
      adjustPanel.innerHTML =
        '<div class="adjust-row"><label>Contrast</label>' +
        '<input type="range" id="adj-contrast" min="50" max="150" step="1">' +
        '<span id="adj-contrast-val"></span></div>' +
        '<div class="adjust-row"><label>Brightness</label>' +
        '<input type="range" id="adj-brightness" min="50" max="150" step="1">' +
        '<span id="adj-brightness-val"></span></div>' +
        '<div class="adjust-row"><label>Saturation</label>' +
        '<input type="range" id="adj-saturation" min="0" max="200" step="1">' +
        '<span id="adj-saturation-val"></span></div>' +
        '<div class="adjust-actions">' +
        '<button id="adj-reset">Reset</button>' +
        '<button id="adj-apply">Apply</button></div>';
      document.body.appendChild(adjustPanel);

      ["contrast", "brightness", "saturation"].forEach(function (prop) {
        var input = document.getElementById("adj-" + prop);
        input.addEventListener("input", function () {
          adjustPending[prop] = parseInt(input.value, 10);
          document.getElementById("adj-" + prop + "-val").textContent = input.value;
          applyAdjustPreview();
        });
      });

      document.getElementById("adj-reset").addEventListener("click", function () {
        adjustPending = { contrast: 100, brightness: 100, saturation: 100 };
        syncAdjustSliders();
        applyAdjustPreview();
      });

      document.getElementById("adj-apply").addEventListener("click", function () {
        commitAdjustments();
        closeAdjustPanel(false);
      });
    }

    syncAdjustSliders();
    applyAdjustPreview();
    positionAdjustPanel(item);
    adjustPanel.classList.add("active");

    setTimeout(function () {
      document.addEventListener("mousedown", onAdjustOutsideClick);
    }, 0);
    document.addEventListener("keydown", onAdjustEscape);
  }

  function syncAdjustSliders() {
    ["contrast", "brightness", "saturation"].forEach(function (prop) {
      var input = document.getElementById("adj-" + prop);
      if (input) {
        input.value = adjustPending[prop];
        document.getElementById("adj-" + prop + "-val").textContent = adjustPending[prop];
      }
    });
  }

  function applyAdjustPreview() {
    if (!adjustTarget) return;
    var img = adjustTarget.querySelector("img");
    var f = adjustPending;
    if (f.contrast === 100 && f.brightness === 100 && f.saturation === 100) {
      img.style.filter = "";
    } else {
      img.style.filter =
        "contrast(" + f.contrast + "%) " +
        "brightness(" + f.brightness + "%) " +
        "saturate(" + f.saturation + "%)";
    }
  }

  function commitAdjustments() {
    if (!adjustTarget) return;
    var f = adjustPending;
    if (f.contrast === 100 && f.brightness === 100 && f.saturation === 100) {
      delete adjustTarget._adjustments;
    } else {
      adjustTarget._adjustments = { contrast: f.contrast, brightness: f.brightness, saturation: f.saturation };
    }
    autoSave();
  }

  function closeAdjustPanel(revert) {
    if (revert && adjustTarget) {
      var saved = adjustTarget._adjustments;
      var img = adjustTarget.querySelector("img");
      if (saved) {
        img.style.filter =
          "contrast(" + saved.contrast + "%) " +
          "brightness(" + saved.brightness + "%) " +
          "saturate(" + saved.saturation + "%)";
      } else {
        img.style.filter = "";
      }
    }
    if (adjustPanel) adjustPanel.classList.remove("active");
    adjustTarget = null;
    document.removeEventListener("mousedown", onAdjustOutsideClick);
    document.removeEventListener("keydown", onAdjustEscape);
  }

  function onAdjustOutsideClick(e) {
    if (adjustPanel && !adjustPanel.contains(e.target)) {
      closeAdjustPanel(true);
    }
  }

  function onAdjustEscape(e) {
    if (e.key === "Escape") closeAdjustPanel(true);
  }

  function positionAdjustPanel(item) {
    var rect = item.getBoundingClientRect();
    var panelH = 160;
    var top, left;
    if (rect.top > panelH + 8) {
      top = rect.top + window.scrollY - panelH - 8;
    } else {
      top = rect.bottom + window.scrollY + 8;
    }
    left = rect.left + window.scrollX + (rect.width / 2) - 150;
    left = Math.max(8, Math.min(left, window.innerWidth - 308));
    adjustPanel.style.top = top + "px";
    adjustPanel.style.left = left + "px";
  }

  // ── Export HTML ──

  function exportAll() {
    var items = getGalleryItems();
    var output = "<!-- Gallery Layout -->\n";
    items.forEach(function (item) {
      var img = item.querySelector("img");
      var size = getSize(item);
      var objPos = img.style.objectPosition;
      var posAttr =
        objPos && objPos !== "50% 50%"
          ? ' style="object-position: ' + objPos + '"'
          : "";

      var cls;
      if (size === "4x2") {
        cls = ' class="gallery-item featured-4x2"';
      } else if (size === "tall") {
        cls = ' class="gallery-item featured-tall"';
      } else if (size === 3) {
        cls = ' class="gallery-item featured-wide"';
      } else if (size === "2x2") {
        cls = ' class="gallery-item featured-2x2"';
      } else if (size === 2) {
        cls = ' class="gallery-item featured"';
      } else {
        cls = ' class="gallery-item"';
      }

      output +=
        "<div" + cls + ">\n" +
        '  <img src="' + img.src + '" alt="' + (img.alt || "") + '" loading="lazy"' + posAttr + ">\n" +
        "</div>\n";
    });

    navigator.clipboard.writeText(output).then(function () {
      var btn = document.getElementById("editor-export");
      btn.textContent = "Copied HTML!";
      setTimeout(function () {
        btn.textContent = "Export HTML";
      }, 2000);
    });

    console.log(output);
  }

  // ── Publish Layout (to Cloudflare KV) ──

  function hasEditParam() {
    var params = new URLSearchParams(window.location.search);
    return params.has("edit");
  }

  function publishLayout() {
    var items = getGalleryItems();
    var layout = items.map(function (item) {
      var img = item.querySelector("img");
      var crop = img.style.objectPosition || "";
      return {
        id: img.dataset.imageId || "",
        size: getSize(item),
        crop: (crop && crop !== "50% 50%") ? crop : null
      };
    });

    var btn = document.getElementById("editor-publish");

    fetch(WORKER_URL + "/" + encodeURIComponent(config.id), {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        "Authorization": "Bearer grantpark"
      },
      body: JSON.stringify(layout)
    })
      .then(function (res) {
        if (!res.ok) throw new Error("HTTP " + res.status);
        return res.json();
      })
      .then(function () {
        if (btn) {
          btn.textContent = "Published!";
          setTimeout(function () { btn.textContent = "Publish"; }, 2000);
        }
      })
      .catch(function (err) {
        console.error("Publish failed:", err);
        if (btn) {
          btn.textContent = "Failed!";
          setTimeout(function () { btn.textContent = "Publish"; }, 2000);
        }
      });
  }

  // ── Export Config (JSON) ──

  function exportConfig() {
    var items = getGalleryItems();
    var result = items.map(function (item) {
      var img = item.querySelector("img");
      var size = getSize(item);
      var objPos = img.style.objectPosition || "";
      var entry = {
        id: img.dataset.imageId || "",
        src: img.src,
        alt: img.alt || "",
        size: size
      };
      if (objPos && objPos !== "50% 50%") {
        entry.crop = objPos;
      }
      return entry;
    });

    var json = JSON.stringify(result, null, 2);
    navigator.clipboard.writeText(json).then(function () {
      var btn = document.getElementById("editor-export-config");
      btn.textContent = "Copied JSON!";
      setTimeout(function () {
        btn.textContent = "Export Config";
      }, 2000);
    });

    console.log(json);
  }

  // ── Editor Mode Toggle ──

  function toggleEditor() {
    editorMode = !editorMode;

    if (editorMode) {
      var canEdit = hasEditParam();

      editorOverlay = document.createElement("div");
      editorOverlay.id = "edit-overlay";
      editorOverlay.innerHTML =
        '<div class="edit-banner">' +
        "EDITOR \u2014 Click: select \u00b7 Shift+Click: multi-select \u00b7 Drag: reorder \u00b7 " +
        '<span class="save-indicator" style="opacity:0.4;font-size:11px;margin-left:4px">\u2713 saved</span>' +
        '<button id="editor-done">Done</button>' +
        '<button id="editor-edit-image" disabled>\u270f Edit Image</button>' +
        (canEdit ? '<button id="editor-publish">Publish</button>' : '') +
        '<button id="editor-export">Export HTML</button>' +
        '<button id="editor-export-config">Export Config</button>' +
        '<button id="editor-reset">Reset</button>' +
        "</div>";
      document.body.appendChild(editorOverlay);
      document.body.classList.add("edit-mode");

      var galleryEl = getGallery();
      galleryEl._onGalleryClick = function (e) {
        if (e.target === galleryEl) clearSelection();
      };
      galleryEl.addEventListener("click", galleryEl._onGalleryClick);

      document
        .getElementById("editor-done")
        .addEventListener("click", toggleEditor);
      if (canEdit) {
        document
          .getElementById("editor-publish")
          .addEventListener("click", publishLayout);
      }
      document
        .getElementById("editor-export")
        .addEventListener("click", exportAll);
      document
        .getElementById("editor-export-config")
        .addEventListener("click", exportConfig);
      document
        .getElementById("editor-reset")
        .addEventListener("click", function () {
          localStorage.removeItem(STORAGE_KEY);
          location.reload();
        });
      document
        .getElementById("editor-edit-image")
        .addEventListener("click", function () {
          var items = Array.from(selectedItems);
          if (items.length === 1) openAdjustPanel(items[0]);
        });

      getGalleryItems().forEach(function (item) {
        setupEditorItem(item);
      });

      // Hide the edit trigger button while in editor mode
      var trigger = document.querySelector(".gallery-edit-trigger");
      if (trigger) {
        trigger.style.display = "none";
      }

      window._editorMouseMove = function (e) {
        window._lastMouseEvent = e;
        if (!activeItem) return;
        var dx = e.clientX - dragStartX;
        var dy = e.clientY - dragStartY;
        var dist = Math.sqrt(dx * dx + dy * dy);
        if (!isDragging && dist > DRAG_THRESHOLD) {
          isDragging = true;
          startDrag(activeItem, e);
        }
        if (isDragging) moveDrag(e);
      };

      window._editorMouseUp = function () {
        if (!activeItem) return;
        if (isDragging) {
          endDrag();
        } else {
          toggleSelect(activeItem, window._lastMouseEvent);
        }
        activeItem = null;
        isDragging = false;
      };

      window.addEventListener("mousemove", window._editorMouseMove);
      window.addEventListener("mouseup", window._editorMouseUp);
    } else {
      // Exit editor
      if (editorOverlay) editorOverlay.remove();
      document.body.classList.remove("edit-mode");

      getGalleryItems().forEach(function (item) {
        var badge = item.querySelector(".layout-badge");
        if (badge) badge.remove();
        var orderNum = item.querySelector(".order-number");
        if (orderNum) orderNum.remove();
        item.style.cursor = "pointer";
        item.style.opacity = "";
        if (item._onMouseDown) {
          item.removeEventListener("mousedown", item._onMouseDown);
        }
      });

      window.removeEventListener("mousemove", window._editorMouseMove);
      window.removeEventListener("mouseup", window._editorMouseUp);

      var galleryEl = getGallery();
      if (galleryEl._onGalleryClick) {
        galleryEl.removeEventListener("click", galleryEl._onGalleryClick);
      }
      clearSelection();

      // Show the edit trigger button again
      var trigger = document.querySelector(".gallery-edit-trigger");
      if (trigger) {
        trigger.style.display = "";
      }

      visibleItems = getGalleryItems();
      bindClicks();
    }
  }

  // ── Filter Buttons (if present) ──

  function bindFilterButtons() {
    var buttons = document.querySelectorAll(".filter-btn");
    buttons.forEach(function (btn) {
      btn.addEventListener("click", function () {
        var activeBtn = document.querySelector(".filter-btn.active");
        if (activeBtn) activeBtn.classList.remove("active");
        btn.classList.add("active");

        var filter = btn.dataset.filter;
        getGalleryItems().forEach(function (item) {
          if (filter === "all" || item.dataset.category === filter) {
            item.classList.remove("hidden");
          } else {
            item.classList.add("hidden");
          }
        });

        visibleItems = [].slice.call(
          document.querySelectorAll(".gallery-item:not(.hidden)")
        );
        bindClicks();
      });
    });
  }

  // ── Keyboard Shortcuts ──

  function bindKeyboard() {
    document.addEventListener("keydown", function (e) {
      // Shift+L toggles editor (only when ?edit is in URL and lightbox is not open)
      if (e.key === "L" && e.shiftKey && hasEditParam() && !lightbox.classList.contains("active")) {
        toggleEditor();
        return;
      }

      // Lightbox navigation
      if (!lightbox.classList.contains("active")) return;
      if (e.key === "Escape") closeLightbox();
      if (e.key === "ArrowLeft") navigate(-1);
      if (e.key === "ArrowRight") navigate(1);
    });
  }

  // ── Gallery Title ──

  function renderTitle() {
    var gallery = getGallery();
    if (!gallery || !config.title) return;
    // Don't render title if embedded in iframe
    if (window.self !== window.top) return;

    var header = document.createElement("div");
    header.className = "gallery-header";
    header.innerHTML =
      '<h1 class="gallery-title">' + config.title + '</h1>' +
      (config.subtitle ? '<p class="gallery-subtitle">' + config.subtitle + '</p>' : '');

    gallery.parentNode.insertBefore(header, gallery);
  }

  // ── Iframe Embed ──

  function setupIframeEmbed() {
    if (window.self === window.top) return;

    document.body.classList.add("embedded");

    function postHeight() {
      var h = document.documentElement.scrollHeight;
      window.parent.postMessage({ type: "resize", height: h }, "*");
    }

    window.addEventListener("load", postHeight);
    new MutationObserver(postHeight).observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true
    });
  }

  // ── Initialize ──

  function init() {
    renderGallery();
    ensureLightbox();
    restoreState();
    bindClicks();

    // Lightbox controls
    document
      .getElementById("lightbox-close")
      .addEventListener("click", closeLightbox);
    document
      .getElementById("lightbox-prev")
      .addEventListener("click", function () {
        navigate(-1);
      });
    document
      .getElementById("lightbox-next")
      .addEventListener("click", function () {
        navigate(1);
      });

    lightbox.addEventListener("click", function (e) {
      if (e.target === lightbox) closeLightbox();
    });

    bindFilterButtons();
    bindKeyboard();
    renderTitle();
    setupIframeEmbed();
  }

  // Only init immediately if config was provided statically.
  // If fetching from API, boot() calls init() after the fetch resolves.
  if (config) {
    init();
    if (hasEditParam()) toggleEditor();
  }
})();
