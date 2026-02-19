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
    "2x2": "g9-2x2",
    "3x3": "g9-3x3",
    "3x2": "g9-3x2",
    "4x2": "g9-4x2",
    "6x4": "g9-6x4",
    "9x6": "g9-9x6",
    "2x3": "g9-2x3",
    "2x4": "g9-2x4",
    "4x6": "g9-4x6"
  };

  var ALL_SIZE_CLASSES = [
    "g9-2x2", "g9-3x3", "g9-3x2", "g9-4x2",
    "g9-6x4", "g9-9x6", "g9-2x3", "g9-2x4", "g9-4x6"
  ];

  // Orientation groups for the 3-button UI
  var ORIENT_GROUPS = {
    square: ["1x1", "2x2", "3x3"],
    horiz:  ["3x2", "4x2", "6x4", "9x6"],
    vert:   ["2x3", "2x4", "4x6"]
  };

  var BADGE_LABELS = {
    "1x1": "1\u00d71",
    "2x2": "2\u00d72", "3x3": "3\u00d73",
    "3x2": "3\u00d72", "4x2": "4\u00d72",
    "6x4": "6\u00d74", "9x6": "9\u00d76",
    "2x3": "2\u00d73", "2x4": "2\u00d74", "4x6": "4\u00d76"
  };

  var BADGE_COLORS = {
    "1x1": "rgba(0,0,0,0.5)",
    "2x2": "#1a1a1a", "3x3": "#555",
    "3x2": "#c44",    "4x2": "#a44",
    "6x4": "#36c",    "9x6": "#24a",
    "2x3": "#2a7",    "2x4": "#1a6", "4x6": "#084"
  };

  var DRAG_THRESHOLD = 8;

  // ── State ──

  var lightbox, lightboxImg, lightboxCaption, lightboxCounter;
  var visibleItems = [];
  var currentIndex = 0;

  var editorMode = false;
  var editorOverlay = null;

  var activeItem = null;
  var dragStartX = 0;
  var dragStartY = 0;
  var isDragging = false;
  var isCropping = false;
  var dragGhost = null;
  var lastDropTarget = null;
  var lastInsertBefore = true;

  // Spacer corner-drag resize state
  var resizingItem = null;
  var resizeCorner = null;   // "tl" | "tr" | "bl" | "br"
  var resizeStartX = 0;
  var resizeStartY = 0;
  var resizeStartCols = 1;
  var resizeStartRows = 1;

  // ── DOM Helpers ──

  function getGalleryItems() {
    // Returns real items only — excludes slot placeholders (.g9-slot)
    return [].slice.call(
      document.querySelectorAll(".g9-item:not(.g9-slot)")
    );
  }

  function getGallery() {
    return document.getElementById("gallery");
  }

  // ── Render Gallery from Config ──

  function isSpacer(item) {
    return item.classList.contains("g9-spacer");
  }

  function createSpacerElement(cols, rows) {
    var div = document.createElement("div");
    div.className = "g9-item g9-spacer";
    if (cols > 1) div.style.gridColumn = "span " + cols;
    if (rows > 1) div.style.gridRow = "span " + rows;
    var label = document.createElement("span");
    label.className = "g9-spacer-label";
    label.textContent = "spacer";
    div.appendChild(label);
    return div;
  }

  function renderGallery() {
    var gallery = getGallery();
    if (!gallery) return;

    config.images.forEach(function (entry) {
      if (entry.type === "spacer") {
        var spacer = createSpacerElement(entry.cols || 1, entry.rows || 1);
        gallery.appendChild(spacer);
        return;
      }

      var div = document.createElement("div");
      div.className = "g9-item";

      var sizeClass = SIZE_CLASS_MAP[entry.size];
      if (sizeClass) div.classList.add(sizeClass);

      var img = document.createElement("img");
      img.src = entry.src;
      img.alt = entry.alt || "";
      img.loading = "lazy";
      img.dataset.imageId = entry.id;

      if (entry.crop && entry.crop !== "50% 50%") {
        img.style.objectPosition = entry.crop;
      }

      // Auto-default size based on orientation (only if no saved size)
      if (!entry.size) {
        img.addEventListener("load", function () {
          if (getSize(div) !== "1x1") return; // already resized
          var defaultSize;
          if (img.naturalWidth > img.naturalHeight * 1.1) {
            defaultSize = "3x2"; // landscape
          } else if (img.naturalHeight > img.naturalWidth * 1.1) {
            defaultSize = "2x3"; // portrait
          }
          // square: leave as 1x1
          if (defaultSize) {
            applySizeClass(div, defaultSize);
            if (editorMode) updateBadge(div);
          }
        });
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
    if (item.classList.contains("g9-9x6")) return "9x6";
    if (item.classList.contains("g9-6x4")) return "6x4";
    if (item.classList.contains("g9-4x6")) return "4x6";
    if (item.classList.contains("g9-4x2")) return "4x2";
    if (item.classList.contains("g9-3x3")) return "3x3";
    if (item.classList.contains("g9-3x2")) return "3x2";
    if (item.classList.contains("g9-2x4")) return "2x4";
    if (item.classList.contains("g9-2x3")) return "2x3";
    if (item.classList.contains("g9-2x2")) return "2x2";
    return "1x1";
  }

  function getOrientGroup(size) {
    if (ORIENT_GROUPS.horiz.indexOf(size) !== -1) return "horiz";
    if (ORIENT_GROUPS.vert.indexOf(size) !== -1) return "vert";
    return "square";
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

  function getSpacerSpans(item) {
    // Read inline grid-column/row span values set by corner-drag
    var col = item.style.gridColumn || "";
    var row = item.style.gridRow || "";
    var cols = parseInt((col.match(/span (\d+)/) || [0, 1])[1]);
    var rows = parseInt((row.match(/span (\d+)/) || [0, 1])[1]);
    return { cols: cols || 1, rows: rows || 1 };
  }

  function getGridMetrics() {
    var grid = getGallery();
    var rect = grid.getBoundingClientRect();
    var cols = 9;
    var gap = 8;
    var colWidth = (rect.width - gap * (cols - 1)) / cols;
    return { colWidth: colWidth, rowHeight: colWidth, gap: gap, rect: rect };
  }

  function addSpacerHandles(item) {
    ["tl", "tr", "bl", "br"].forEach(function (corner) {
      var h = document.createElement("div");
      h.className = "spacer-handle " + corner;
      h.dataset.corner = corner;
      h.addEventListener("mousedown", function (e) {
        e.stopPropagation();
        e.preventDefault();
        resizingItem = item;
        resizeCorner = corner;
        resizeStartX = e.clientX;
        resizeStartY = e.clientY;
        var spans = getSpacerSpans(item);
        resizeStartCols = spans.cols;
        resizeStartRows = spans.rows;
      });
      item.appendChild(h);
    });
  }

  function removeSpacerHandles(item) {
    item.querySelectorAll(".spacer-handle").forEach(function (h) { h.remove(); });
  }

  function moveResize(e) {
    if (!resizingItem) return;
    var m = getGridMetrics();
    var dx = e.clientX - resizeStartX;
    var dy = e.clientY - resizeStartY;
    var dCols = Math.round(dx / (m.colWidth + m.gap));
    var dRows = Math.round(dy / (m.rowHeight + m.gap));

    var newCols, newRows;
    if (resizeCorner === "br") {
      newCols = Math.max(1, Math.min(9, resizeStartCols + dCols));
      newRows = Math.max(1, Math.min(12, resizeStartRows + dRows));
    } else if (resizeCorner === "bl") {
      newCols = Math.max(1, Math.min(9, resizeStartCols - dCols));
      newRows = Math.max(1, Math.min(12, resizeStartRows + dRows));
    } else if (resizeCorner === "tr") {
      newCols = Math.max(1, Math.min(9, resizeStartCols + dCols));
      newRows = Math.max(1, Math.min(12, resizeStartRows - dRows));
    } else { // tl
      newCols = Math.max(1, Math.min(9, resizeStartCols - dCols));
      newRows = Math.max(1, Math.min(12, resizeStartRows - dRows));
    }

    resizingItem.style.gridColumn = "span " + newCols;
    resizingItem.style.gridRow = "span " + newRows;
  }

  function endResize() {
    if (!resizingItem) return;
    autoSave();
    refreshSlots();
    resizingItem = null;
    resizeCorner = null;
  }

  function saveState() {
    var items = getGalleryItems();
    var state = items.map(function (item) {
      if (isSpacer(item)) {
        var spans = getSpacerSpans(item);
        return { type: "spacer", cols: spans.cols, rows: spans.rows };
      }
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
        var img = item.querySelector("img");
        if (img) itemMap[img.dataset.imageId] = item;
      });

      var restoredIds = {};

      state.forEach(function (entry) {
        if (entry.type === "spacer") {
          var spacer = createSpacerElement(entry.cols || 1, entry.rows || 1);
          gallery.appendChild(spacer);
          if (editorMode) setupEditorItem(spacer);
          return;
        }
        var item = itemMap[entry.id];
        if (!item) return;

        gallery.appendChild(item);
        restoredIds[entry.id] = true;
        applySizeClass(item, entry.size);

        if (entry.crop) {
          item.querySelector("img").style.objectPosition = entry.crop;
        }
      });

      items.forEach(function (item) {
        var img = item.querySelector("img");
        if (img && !restoredIds[img.dataset.imageId]) {
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
    visibleItems = getGalleryItems().filter(function (item) {
      return !isSpacer(item);
    });
    visibleItems.forEach(function (item, i) {
      item.onclick = function () {
        if (!editorMode) openLightbox(i);
      };
    });
  }

  // ── Badges & Order Numbers ──

  function updateBadge(item) {
    if (isSpacer(item)) return; // spacers have no badge
    var badge = item.querySelector(".layout-badge");
    if (!badge) {
      badge = document.createElement("span");
      badge.className = "layout-badge";
      item.appendChild(badge);
    }
    var size = getSize(item);
    badge.textContent = BADGE_LABELS[size] || size;
    badge.style.cssText =
      "position: absolute; bottom: 6px; left: 6px;" +
      "background: " + (BADGE_COLORS[size] || "rgba(0,0,0,0.5)") + ";" +
      "color: #EDEBE0; padding: 3px 8px;" +
      "font-family: 'Inconsolata', monospace; font-size: 11px;" +
      "letter-spacing: 0.08em; z-index: 10; pointer-events: none;";
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

  function getColSpan(item) {
    var sizeMap = {
      "9x6": 9, "6x4": 6, "4x6": 4, "4x2": 4,
      "3x3": 3, "3x2": 3,
      "2x4": 2, "2x3": 2, "2x2": 2
    };
    return sizeMap[getSize(item)] || 1;
  }

  function refreshSlots() {
    // Remove existing slots
    getGallery().querySelectorAll(".g9-slot").forEach(function (s) { s.remove(); });
    if (!editorMode) return;

    // Count columns used in the last partial row
    var items = getGalleryItems();
    var colsUsed = 0;
    items.forEach(function (item) {
      var spans = isSpacer(item) ? getSpacerSpans(item) : { cols: getColSpan(item), rows: 1 };
      colsUsed = (colsUsed + spans.cols) % 9;
    });

    // Fill the trailing partial row
    var remainder = colsUsed === 0 ? 0 : 9 - colsUsed;
    var gallery = getGallery();
    for (var i = 0; i < remainder; i++) {
      var slot = document.createElement("div");
      slot.className = "g9-slot";
      gallery.appendChild(slot);
    }
  }

  // ── Orientation Buttons ──

  function removeOrientBtns(item) {
    var existing = item.querySelector(".orient-btns");
    if (existing) existing.remove();
  }

  function setOrientation(item, group) {
    var currentSize = getSize(item);
    var currentGroup = getOrientGroup(currentSize);
    var cycle = ORIENT_GROUPS[group];
    var nextSize;

    if (currentGroup === group) {
      // Same group: advance to next in cycle
      var idx = cycle.indexOf(currentSize);
      nextSize = cycle[(idx + 1) % cycle.length];
    } else {
      // Different group: jump to first in that group
      nextSize = cycle[0];
    }

    applySizeClass(item, nextSize);
    updateBadge(item);
    updateOrientBtns(item);
    autoSave();
    refreshSlots();
  }

  function updateOrientBtns(item) {
    var btns = item.querySelector(".orient-btns");
    if (!btns) return;
    var currentGroup = getOrientGroup(getSize(item));
    btns.querySelectorAll(".orient-btn").forEach(function (btn) {
      if (btn.dataset.group === currentGroup) {
        btn.classList.add("active");
      } else {
        btn.classList.remove("active");
      }
    });
  }

  function showOrientBtns(item) {
    if (isSpacer(item)) return;
    removeOrientBtns(item);

    var btns = document.createElement("div");
    btns.className = "orient-btns";

    [
      { group: "square", label: "\u25a0", title: "Square" },
      { group: "horiz",  label: "\u25ac", title: "Horizontal" },
      { group: "vert",   label: "\u25ae", title: "Vertical" }
    ].forEach(function (def) {
      var btn = document.createElement("button");
      btn.className = "orient-btn";
      btn.dataset.group = def.group;
      btn.title = def.title;
      btn.textContent = def.label;
      btn.addEventListener("mousedown", function (e) {
        e.stopPropagation(); // don't trigger drag
      });
      btn.addEventListener("click", function (e) {
        e.stopPropagation();
        setOrientation(item, def.group);
      });
      btns.appendChild(btn);
    });

    item.appendChild(btns);
    updateOrientBtns(item);
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

    dragGhost = document.createElement("div");
    dragGhost.className = "drag-ghost";

    if (isSpacer(item)) {
      dragGhost.innerHTML = '<div style="width:100%;height:100%;background:#ECEAE4;display:flex;align-items:center;justify-content:center;font-family:Inconsolata,monospace;font-size:10px;letter-spacing:0.1em;color:rgba(0,0,0,0.35)">spacer</div>';
    } else {
      var img = item.querySelector("img");
      dragGhost.innerHTML =
        '<img src="' + img.src + '" style="width:100%;height:100%;object-fit:cover;object-position:' +
        (img.style.objectPosition || "50% 50%") + '">';
    }
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
    if (!isSpacer(item)) {
      showOrientBtns(item);
    } else {
      addSpacerHandles(item);
    }

    item._onMouseDown = function (e) {
      if (!editorMode || e.button !== 0) return;
      e.preventDefault();
      activeItem = item;
      dragStartX = e.clientX;
      dragStartY = e.clientY;
      isDragging = false;
      isCropping = false;
    };

    item.addEventListener("mousedown", item._onMouseDown);
  }

  // ── Export HTML ──

  function exportAll() {
    var items = getGalleryItems();
    var output = "<!-- Gallery Layout -->\n";
    items.forEach(function (item) {
      if (isSpacer(item)) {
        var spans = getSpacerSpans(item);
        var style = "";
        if (spans.cols > 1) style += "grid-column:span " + spans.cols + ";";
        if (spans.rows > 1) style += "grid-row:span " + spans.rows + ";";
        output += '<div class="g9-item g9-spacer"' + (style ? ' style="' + style + '"' : '') + '></div>\n';
        return;
      }

      var img = item.querySelector("img");
      var size = getSize(item);
      var objPos = img.style.objectPosition;
      var posAttr = objPos && objPos !== "50% 50%" ? ' style="object-position: ' + objPos + '"' : "";
      var sizeCls = SIZE_CLASS_MAP[size];
      var cls = sizeCls ? ' class="g9-item ' + sizeCls + '"' : ' class="g9-item"';

      output +=
        "<div" + cls + ">\n" +
        '  <img src="' + img.src + '" alt="' + (img.alt || "") + '" loading="lazy"' + posAttr + ">\n" +
        "</div>\n";
    });

    navigator.clipboard.writeText(output).then(function () {
      var btn = document.getElementById("editor-export");
      btn.textContent = "Copied HTML!";
      setTimeout(function () { btn.textContent = "Export HTML"; }, 2000);
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
      if (isSpacer(item)) {
        var spans = getSpacerSpans(item);
        return { type: "spacer", cols: spans.cols, rows: spans.rows };
      }
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
      if (isSpacer(item)) {
        var spans = getSpacerSpans(item);
        return { type: "spacer", cols: spans.cols, rows: spans.rows };
      }
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
        "EDITOR \u2014 Click: orient \u00b7 Drag: reorder \u00b7 Shift+Drag: crop \u00b7 " +
        '<span class="save-indicator" style="opacity:0.4;font-size:11px;margin-left:4px">\u2713 saved</span>' +
        '<button id="editor-done">Done</button>' +
        (canEdit ? '<button id="editor-publish">Publish</button>' : '') +
        '<button id="editor-export">Export HTML</button>' +
        '<button id="editor-export-config">Export Config</button>' +
        '<button id="editor-reset">Reset</button>' +
        '<button id="editor-add-spacer">+ Spacer</button>' +
        "</div>";
      document.body.appendChild(editorOverlay);
      document.body.classList.add("edit-mode");

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

      document.getElementById("editor-add-spacer").addEventListener("click", function () {
        var gallery = getGallery();
        var spacer = createSpacerElement(1, 1);
        gallery.appendChild(spacer);
        setupEditorItem(spacer);
        refreshOrderNumbers();
        refreshSlots();
        autoSave();
      });

      getGalleryItems().forEach(function (item) {
        setupEditorItem(item);
      });
      refreshSlots();

      // Hide the edit trigger button while in editor mode
      var trigger = document.querySelector(".gallery-edit-trigger");
      if (trigger) {
        trigger.style.display = "none";
      }

      window._editorMouseMove = function (e) {
        if (resizingItem) { moveResize(e); return; }
        if (!activeItem) return;

        var dx = e.clientX - dragStartX;
        var dy = e.clientY - dragStartY;
        var dist = Math.sqrt(dx * dx + dy * dy);

        if (!isDragging && !isCropping && dist > DRAG_THRESHOLD) {
          if (e.shiftKey) {
            isCropping = true;
            activeItem.style.cursor = "crosshair";
            var crop = getCropState(activeItem);
            activeItem._cropStartX = crop.objX;
            activeItem._cropStartY = crop.objY;
          } else {
            isDragging = true;
            startDrag(activeItem, e);
          }
        }

        if (isDragging) {
          moveDrag(e);
        } else if (isCropping) {
          moveCrop(activeItem, e);
        }
      };

      window._editorMouseUp = function () {
        if (resizingItem) { endResize(); return; }
        if (!activeItem) return;

        if (isDragging) {
          endDrag();
        } else if (isCropping) {
          endCrop(activeItem);
        } else {
          showOrientBtns(activeItem);
        }

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

      getGalleryItems().forEach(function (item) {
        var badge = item.querySelector(".layout-badge");
        if (badge) badge.remove();
        var orderNum = item.querySelector(".order-number");
        if (orderNum) orderNum.remove();
        removeOrientBtns(item);
        removeSpacerHandles(item);
        item.style.cursor = "pointer";
        item.style.opacity = "";
        if (item._onMouseDown) {
          item.removeEventListener("mousedown", item._onMouseDown);
        }
      });

      window.removeEventListener("mousemove", window._editorMouseMove);
      window.removeEventListener("mouseup", window._editorMouseUp);

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
          getGalleryItems().filter(function(i){return !i.classList.contains("hidden");})
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
