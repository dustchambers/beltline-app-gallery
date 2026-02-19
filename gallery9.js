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

  // ── 18-col size vocabulary ──
  // Default photo: 6x4 (horiz, 1/3 width) and 4x6 (vert).
  // Spacer bars: 9x1 (half-width), 18x1 (full-width).
  var SIZE_CLASS_MAP = {
    // Square
    "2x2":  "g9-2x2",
    "4x4":  "g9-4x4",
    "6x6":  "g9-6x6",
    // Horizontal
    "6x4":  "g9-6x4",
    "9x4":  "g9-9x4",
    "9x6":  "g9-9x6",
    "12x4": "g9-12x4",
    "12x6": "g9-12x6",
    "18x4": "g9-18x4",
    "18x6": "g9-18x6",
    "18x8": "g9-18x8",
    // Vertical
    "4x6":  "g9-4x6",
    "4x8":  "g9-4x8",
    "6x8":  "g9-6x8",
    "6x9":  "g9-6x9",
    // Spacer bars
    "9x1":  "g9-9x1",
    "9x2":  "g9-9x2",
    "18x1": "g9-18x1",
    "18x2": "g9-18x2"
  };

  var ALL_SIZE_CLASSES = [
    "g9-2x2",  "g9-4x4",  "g9-6x6",
    "g9-6x4",  "g9-9x4",  "g9-9x6",
    "g9-12x4", "g9-12x6",
    "g9-18x4", "g9-18x6", "g9-18x8",
    "g9-4x6",  "g9-4x8",  "g9-6x8", "g9-6x9",
    "g9-9x1",  "g9-9x2",  "g9-18x1", "g9-18x2"
  ];

  // Orientation groups for the 3-button UI
  var ORIENT_GROUPS = {
    square: ["2x2", "4x4", "6x6"],
    horiz:  ["6x4", "9x4", "9x6", "12x4", "12x6", "18x4", "18x6", "18x8"],
    vert:   ["4x6", "4x8", "6x8", "6x9"]
  };

  var BADGE_LABELS = {
    "1x1":  "1\u00d71",
    "2x2":  "2\u00d72",  "4x4":  "4\u00d74",  "6x6":  "6\u00d76",
    "6x4":  "6\u00d74",  "9x4":  "9\u00d74",  "9x6":  "9\u00d76",
    "12x4": "12\u00d74", "12x6": "12\u00d76",
    "18x4": "18\u00d74", "18x6": "18\u00d76", "18x8": "18\u00d78",
    "4x6":  "4\u00d76",  "4x8":  "4\u00d78",
    "6x8":  "6\u00d78",  "6x9":  "6\u00d79",
    "9x1":  "9\u00d71",  "9x2":  "9\u00d72",
    "18x1": "18\u00d71", "18x2": "18\u00d72"
  };

  var BADGE_COLORS = {
    "1x1":  "rgba(0,0,0,0.5)",
    "2x2":  "#1a1a1a", "4x4": "#333",  "6x6": "#555",
    "6x4":  "#36c",    "9x4": "#25b",  "9x6": "#14a",
    "12x4": "#136",    "12x6":"#124",
    "18x4": "#047",    "18x6":"#036",  "18x8":"#024",
    "4x6":  "#2a7",    "4x8": "#196",
    "6x8":  "#0a5",    "6x9": "#084",
    "9x1":  "#888",    "9x2": "#666",
    "18x1": "#555",    "18x2":"#444"
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

  // Spacer / image edge-drag resize state
  var resizingItem = null;
  var resizeCorner = null;   // "tl"|"tr"|"bl"|"br" (spacer) | "r"|"b"|"br" (image)
  var resizeMode   = null;   // "spacer" | "image"
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

  function createSpacerElement(cols, rows, text, align, valign) {
    var div = document.createElement("div");
    div.className = "g9-item g9-spacer";
    if (cols > 1) div.style.gridColumn = "span " + cols;
    if (rows > 1) div.style.gridRow = "span " + rows;

    // Faint "spacer" label (hidden when text overlay is active)
    var label = document.createElement("span");
    label.className = "g9-spacer-label";
    label.textContent = "spacer";
    div.appendChild(label);

    // Text overlay — always present; empty = hidden in view mode
    var textEl = document.createElement("div");
    textEl.className = "spacer-text";
    textEl.contentEditable = "false"; // enabled only in edit mode via addSpacerHandles
    textEl.dataset.placeholder = "Type here\u2026";
    if (text) textEl.textContent = text;
    if (align) textEl.style.textAlign = align;
    // Vertical alignment via CSS class
    textEl.classList.add(valign === "middle" ? "valign-middle"
                       : valign === "bottom" ? "valign-bottom"
                       : "valign-top");
    // Show the text layer and hide the "spacer" label when there is content
    if (text) {
      label.style.display = "none";
      div.classList.add("has-text");
    }
    div.appendChild(textEl);

    return div;
  }

  function renderGallery() {
    var gallery = getGallery();
    if (!gallery) return;

    config.images.forEach(function (entry) {
      if (entry.type === "spacer") {
        var spacer = createSpacerElement(
          entry.cols || 1, entry.rows || 1,
          entry.text || null, entry.align || null, entry.valign || null
        );
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

      // Auto-default size based on orientation if no saved size
      img.addEventListener("load", function () {
        if (entry.size) return; // saved size takes priority
        if (getSize(div) !== "1x1") return; // already resized
        var defaultSize;
        if (img.naturalWidth > img.naturalHeight * 1.1) {
          defaultSize = "6x4"; // landscape — 1/3 width default
        } else if (img.naturalHeight > img.naturalWidth * 1.1) {
          defaultSize = "4x6"; // portrait — 2/9 width default
        }
        // square photos stay 1x1
        if (defaultSize) {
          applySizeClass(div, defaultSize);
          if (editorMode) updateBadge(div);
        }
      });

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
    // Custom drag-resize: no named class, but inline grid spans set
    var col = item.style.gridColumn || "";
    var row = item.style.gridRow || "";
    var inlineCols = parseInt((col.match(/span (\d+)/) || [0, 0])[1]);
    var inlineRows = parseInt((row.match(/span (\d+)/) || [0, 0])[1]);
    if (inlineCols && inlineRows && !isSpacer(item)) {
      return inlineCols + "x" + inlineRows;
    }
    // 18-col named sizes — check widest first to avoid prefix matches
    if (item.classList.contains("g9-18x8")) return "18x8";
    if (item.classList.contains("g9-18x6")) return "18x6";
    if (item.classList.contains("g9-18x4")) return "18x4";
    if (item.classList.contains("g9-18x2")) return "18x2";
    if (item.classList.contains("g9-18x1")) return "18x1";
    if (item.classList.contains("g9-12x6")) return "12x6";
    if (item.classList.contains("g9-12x4")) return "12x4";
    if (item.classList.contains("g9-9x6"))  return "9x6";
    if (item.classList.contains("g9-9x4"))  return "9x4";
    if (item.classList.contains("g9-9x2"))  return "9x2";
    if (item.classList.contains("g9-9x1"))  return "9x1";
    if (item.classList.contains("g9-6x9"))  return "6x9";
    if (item.classList.contains("g9-6x8"))  return "6x8";
    if (item.classList.contains("g9-6x6"))  return "6x6";
    if (item.classList.contains("g9-6x4"))  return "6x4";
    if (item.classList.contains("g9-4x8"))  return "4x8";
    if (item.classList.contains("g9-4x6"))  return "4x6";
    if (item.classList.contains("g9-4x4"))  return "4x4";
    if (item.classList.contains("g9-2x2"))  return "2x2";
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
    if (isSpacer(item)) return null;
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

  // Named size → row count lookup (col count comes from getColSpan)
  var SIZE_ROWS = {
    "1x1": 1,
    // Square
    "2x2": 2, "4x4": 4, "6x6": 6,
    // Horizontal
    "6x4": 4, "9x4": 4, "9x6": 6,
    "12x4": 4, "12x6": 6,
    "18x4": 4, "18x6": 6, "18x8": 8,
    // Vertical
    "4x6": 6, "4x8": 8, "6x8": 8, "6x9": 9,
    // Spacer bars
    "9x1": 1, "9x2": 2, "18x1": 1, "18x2": 2
  };

  function getItemSpans(item) {
    // If the item has inline grid styles (custom drag-resize), use those.
    // Otherwise derive from the named size class.
    var col = item.style.gridColumn || "";
    var row = item.style.gridRow || "";
    var inlineCols = parseInt((col.match(/span (\d+)/) || [0, 0])[1]);
    var inlineRows = parseInt((row.match(/span (\d+)/) || [0, 0])[1]);
    if (inlineCols && inlineRows) {
      return { cols: inlineCols, rows: inlineRows, custom: true };
    }
    var size = getSize(item);
    return {
      cols: getColSpan(item),
      rows: SIZE_ROWS[size] || 1,
      custom: false
    };
  }

  function getGridMetrics() {
    var grid = getGallery();
    var rect = grid.getBoundingClientRect();
    var cols = 18;
    // Read the computed gap from the CSS custom property --s
    var gap = parseFloat(getComputedStyle(grid).getPropertyValue("gap")) || 16;
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

    // Duplicate button — top-center of spacer
    var dupBtn = document.createElement("button");
    dupBtn.className = "spacer-dup-btn";
    dupBtn.textContent = "\u29c9"; // ⧉
    dupBtn.title = "Duplicate spacer";
    dupBtn.addEventListener("mousedown", function (e) { e.stopPropagation(); });
    dupBtn.addEventListener("click", function (e) {
      e.stopPropagation();
      var spans = getSpacerSpans(item);
      var clone = createSpacerElement(spans.cols, spans.rows);
      // Insert immediately after the original
      var next = item.nextSibling;
      if (next) {
        getGallery().insertBefore(clone, next);
      } else {
        getGallery().appendChild(clone);
      }
      setupEditorItem(clone);
      refreshOrderNumbers();
      refreshSlots();
      autoSave();
    });
    item.appendChild(dupBtn);

    // Delete button — top-right of spacer
    var delBtn = document.createElement("button");
    delBtn.className = "spacer-del-btn";
    delBtn.textContent = "\u00d7"; // ×
    delBtn.title = "Delete spacer";
    delBtn.addEventListener("mousedown", function (e) { e.stopPropagation(); });
    delBtn.addEventListener("click", function (e) {
      e.stopPropagation();
      item.remove();
      refreshOrderNumbers();
      refreshSlots();
      autoSave();
    });
    item.appendChild(delBtn);

    // ── Text controls ──
    var textEl = item.querySelector(".spacer-text");

    // Helper: sync the has-text class and label visibility
    function syncTextState() {
      var hasText = textEl.textContent.trim().length > 0;
      var label = item.querySelector(".g9-spacer-label");
      item.classList.toggle("has-text", hasText);
      if (label) label.style.display = hasText ? "none" : "";
    }

    // ── Horizontal alignment bar (L / C / R) ──
    var alignBar = document.createElement("div");
    alignBar.className = "spacer-align-bar";
    ["left", "center", "right"].forEach(function (align) {
      var btn = document.createElement("button");
      btn.className = "spacer-align-btn";
      btn.dataset.align = align;
      btn.title = align.charAt(0).toUpperCase() + align.slice(1) + " align";
      btn.textContent = align === "left" ? "\u2190" : align === "center" ? "\u2194" : "\u2192";
      btn.addEventListener("mousedown", function (e) { e.stopPropagation(); });
      btn.addEventListener("click", function (e) {
        e.stopPropagation();
        textEl.style.textAlign = align;
        alignBar.querySelectorAll(".spacer-align-btn").forEach(function (b) {
          b.classList.toggle("active", b.dataset.align === align);
        });
        autoSave();
      });
      var currentAlign = textEl.style.textAlign || "left";
      if (align === currentAlign) btn.classList.add("active");
      alignBar.appendChild(btn);
    });
    item.appendChild(alignBar);

    // ── Vertical alignment bar (T / M / B) ──
    var vAlignBar = document.createElement("div");
    vAlignBar.className = "spacer-align-vbar";
    [
      { val: "top",    label: "\u2191", title: "Align top" },
      { val: "middle", label: "\u2195", title: "Align middle" },
      { val: "bottom", label: "\u2193", title: "Align bottom" }
    ].forEach(function (def) {
      var btn = document.createElement("button");
      btn.className = "spacer-align-btn";
      btn.dataset.valign = def.val;
      btn.title = def.title;
      btn.textContent = def.label;
      btn.addEventListener("mousedown", function (e) { e.stopPropagation(); });
      btn.addEventListener("click", function (e) {
        e.stopPropagation();
        // Remove existing valign classes then apply chosen one
        textEl.classList.remove("valign-top", "valign-middle", "valign-bottom");
        textEl.classList.add("valign-" + def.val);
        vAlignBar.querySelectorAll(".spacer-align-btn").forEach(function (b) {
          b.classList.toggle("active", b.dataset.valign === def.val);
        });
        autoSave();
      });
      // Mark active based on current class
      var currentValign = textEl.classList.contains("valign-middle") ? "middle"
                        : textEl.classList.contains("valign-bottom") ? "bottom"
                        : "top";
      if (def.val === currentValign) btn.classList.add("active");
      vAlignBar.appendChild(btn);
    });
    item.appendChild(vAlignBar);

    // T toggle button — enables/disables text editing on the spacer
    var textBtn = document.createElement("button");
    textBtn.className = "spacer-text-btn";
    textBtn.textContent = "T";
    textBtn.title = "Add text";

    var textActive = false;

    function activateTextMode() {
      textActive = true;
      textEl.contentEditable = "true";
      textEl.classList.add("editing");
      alignBar.classList.add("visible");
      vAlignBar.classList.add("visible");
      textBtn.classList.add("active");
      textEl.focus();
      // Place cursor at end
      if (textEl.textContent.length) {
        var range = document.createRange();
        range.selectNodeContents(textEl);
        range.collapse(false);
        var sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
      }
    }

    function deactivateTextMode() {
      textActive = false;
      textEl.contentEditable = "false";
      textEl.classList.remove("editing");
      alignBar.classList.remove("visible");
      vAlignBar.classList.remove("visible");
      textBtn.classList.remove("active");
      syncTextState();
      autoSave();
    }

    textBtn.addEventListener("mousedown", function (e) { e.stopPropagation(); });
    textBtn.addEventListener("click", function (e) {
      e.stopPropagation();
      if (textActive) {
        deactivateTextMode();
      } else {
        activateTextMode();
      }
    });
    item.appendChild(textBtn);

    // Prevent text-area clicks from triggering drag
    textEl.addEventListener("mousedown", function (e) {
      if (textActive) e.stopPropagation();
    });

    // Debounced save on text input
    var saveTimer = null;
    textEl.addEventListener("input", function () {
      syncTextState();
      clearTimeout(saveTimer);
      saveTimer = setTimeout(autoSave, 600);
    });

    // Deactivate text mode when clicking outside the spacer
    textEl.addEventListener("blur", function () {
      if (textActive) {
        // Small delay so click on align buttons registers first
        setTimeout(function () {
          if (textActive && document.activeElement !== textEl) {
            deactivateTextMode();
          }
        }, 150);
      }
    });
  }

  function removeSpacerHandles(item) {
    item.querySelectorAll(
      ".spacer-handle, .spacer-dup-btn, .spacer-del-btn, .spacer-text-btn, .spacer-align-bar, .spacer-align-vbar"
    ).forEach(function (h) { h.remove(); });
    // Lock text element back to non-editable
    var textEl = item.querySelector(".spacer-text");
    if (textEl) {
      textEl.contentEditable = "false";
      textEl.classList.remove("editing");
    }
  }

  // ── Image Edge-Drag Resize Handles ──

  function addItemResizeHandles(item) {
    // All 8 handles: 4 edges + 4 corners
    ["r", "l", "b", "t", "br", "bl", "tr", "tl"].forEach(function (edge) {
      var h = document.createElement("div");
      h.className = "item-resize-handle item-resize-" + edge;
      h.dataset.edge = edge;
      h.addEventListener("mousedown", function (e) {
        e.stopPropagation();
        e.preventDefault();
        resizingItem = item;
        resizeCorner = edge;
        resizeMode   = "image";
        resizeStartX = e.clientX;
        resizeStartY = e.clientY;
        var spans = getItemSpans(item);
        resizeStartCols = spans.cols;
        resizeStartRows = spans.rows;
      });
      item.appendChild(h);
    });
  }

  function removeItemResizeHandles(item) {
    item.querySelectorAll(".item-resize-handle").forEach(function (h) { h.remove(); });
  }

  function moveResize(e) {
    if (!resizingItem) return;
    var m = getGridMetrics();
    var dx = e.clientX - resizeStartX;
    var dy = e.clientY - resizeStartY;
    var dCols = Math.round(dx / (m.colWidth + m.gap));
    var dRows = Math.round(dy / (m.rowHeight + m.gap));

    var newCols, newRows;

    if (resizeMode === "image") {
      // Resolve col delta: right/tr/br edges add; left/tl/bl edges invert
      var colDelta = (resizeCorner === "l"  || resizeCorner === "tl" || resizeCorner === "bl")
                   ? -dCols : dCols;
      // Resolve row delta: bottom/bl/br edges add; top/tl/tr edges invert
      var rowDelta = (resizeCorner === "t"  || resizeCorner === "tl" || resizeCorner === "tr")
                   ? -dRows : dRows;

      var colOnly = (resizeCorner === "r" || resizeCorner === "l");
      var rowOnly = (resizeCorner === "b" || resizeCorner === "t");

      newCols = rowOnly ? resizeStartCols
                        : Math.max(1, Math.min(18, resizeStartCols + colDelta));
      newRows = colOnly ? resizeStartRows
                        : Math.max(1, Math.min(16, resizeStartRows + rowDelta));
    } else {
      // Spacer four-corner drag
      if (resizeCorner === "br") {
        newCols = Math.max(1, Math.min(18, resizeStartCols + dCols));
        newRows = Math.max(1, Math.min(16, resizeStartRows + dRows));
      } else if (resizeCorner === "bl") {
        newCols = Math.max(1, Math.min(18, resizeStartCols - dCols));
        newRows = Math.max(1, Math.min(16, resizeStartRows + dRows));
      } else if (resizeCorner === "tr") {
        newCols = Math.max(1, Math.min(18, resizeStartCols + dCols));
        newRows = Math.max(1, Math.min(16, resizeStartRows - dRows));
      } else { // tl
        newCols = Math.max(1, Math.min(18, resizeStartCols - dCols));
        newRows = Math.max(1, Math.min(16, resizeStartRows - dRows));
      }
    }

    resizingItem.style.gridColumn = "span " + newCols;
    resizingItem.style.gridRow = "span " + newRows;
  }

  function endResize() {
    if (!resizingItem) return;
    if (resizeMode === "image") {
      // Strip named size classes — item now lives entirely by inline spans
      clearSizeClasses(resizingItem);
      updateBadge(resizingItem);
    }
    autoSave();
    refreshSlots();
    resizingItem = null;
    resizeCorner = null;
    resizeMode   = null;
  }

  function saveState() {
    var items = getGalleryItems();
    var state = items.map(function (item) {
      if (isSpacer(item)) {
        var spans = getSpacerSpans(item);
        var textEl = item.querySelector(".spacer-text");
        var spacerText   = textEl ? textEl.textContent.trim() : "";
        var spacerAlign  = textEl ? (textEl.style.textAlign || "") : "";
        var spacerValign = textEl
          ? (textEl.classList.contains("valign-middle") ? "middle"
           : textEl.classList.contains("valign-bottom") ? "bottom" : "")
          : "";
        return {
          type:   "spacer",
          cols:   spans.cols,
          rows:   spans.rows,
          text:   spacerText   || null,
          align:  spacerAlign  || null,
          valign: spacerValign || null
        };
      }
      var img = item.querySelector("img");
      var crop = img.style.objectPosition || "";
      var spans = getItemSpans(item);
      var entry = {
        id: img.dataset.imageId || "",
        crop: (crop && crop !== "50% 50%") ? crop : null
      };
      if (spans.custom) {
        // Custom inline-drag size: persist raw col/row counts, no size class
        entry.cols = spans.cols;
        entry.rows = spans.rows;
      } else {
        entry.size = getSize(item);
      }
      return entry;
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
          var spacer = createSpacerElement(
            entry.cols || 1, entry.rows || 1,
            entry.text || null, entry.align || null, entry.valign || null
          );
          gallery.appendChild(spacer);
          if (editorMode) setupEditorItem(spacer);
          return;
        }
        var item = itemMap[entry.id];
        if (!item) return;

        gallery.appendChild(item);
        restoredIds[entry.id] = true;

        if (entry.cols && entry.rows) {
          // Custom drag-resized item: restore raw inline spans
          clearSizeClasses(item);
          item.style.gridColumn = "span " + entry.cols;
          item.style.gridRow    = "span " + entry.rows;
        } else {
          applySizeClass(item, entry.size);
        }

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
    if (isSpacer(item)) return; // spacers don't get numbered
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
      // Square
      "2x2": 2,  "4x4": 4,  "6x6": 6,
      // Horizontal
      "6x4": 6,  "9x4": 9,  "9x6": 9,
      "12x4": 12, "12x6": 12,
      "18x4": 18, "18x6": 18, "18x8": 18,
      // Vertical
      "4x6": 4,  "4x8": 4,  "6x8": 6,  "6x9": 6,
      // Spacer bars
      "9x1": 9,  "9x2": 9,  "18x1": 18, "18x2": 18
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
      colsUsed = (colsUsed + spans.cols) % 18;
    });

    // Fill the trailing partial row with interactive slots
    var remainder = colsUsed === 0 ? 0 : 18 - colsUsed;
    var gallery = getGallery();
    for (var i = 0; i < remainder; i++) {
      var slot = document.createElement("div");
      slot.className = "g9-slot";

      // "Fill with spacer" button centered in the slot
      var fillBtn = document.createElement("button");
      fillBtn.className = "slot-fill-btn";
      fillBtn.textContent = "+ spacer";
      fillBtn.title = "Fill this slot with a spacer";
      fillBtn.addEventListener("click", function (e) {
        e.stopPropagation();
        // Insert 1×1 spacer before the first slot (takes this visual position)
        var firstSlot = getGallery().querySelector(".g9-slot");
        var spacer = createSpacerElement(1, 1);
        if (firstSlot) {
          getGallery().insertBefore(spacer, firstSlot);
        } else {
          getGallery().appendChild(spacer);
        }
        setupEditorItem(spacer);
        refreshOrderNumbers();
        refreshSlots();
        autoSave();
      });
      slot.appendChild(fillBtn);

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

  // ── Crop ──

  // Cycle object-position presets on plain click: center → top-left → top-right → bottom-right → bottom-left → center
  var CROP_PRESETS = ["50% 50%", "25% 25%", "75% 25%", "75% 75%", "25% 75%"];

  function cycleCrop(item) {
    if (isSpacer(item)) return;
    var img = item.querySelector("img");
    if (!img) return;
    var current = img.style.objectPosition || "50% 50%";
    // Find current preset index (fuzzy match by trimming spaces)
    var idx = CROP_PRESETS.indexOf(current.trim());
    var next = CROP_PRESETS[(idx + 1) % CROP_PRESETS.length];
    img.style.objectPosition = next;
    if (item._cropState) {
      var parts = next.split(" ");
      item._cropState.objX = parseFloat(parts[0]);
      item._cropState.objY = parseFloat(parts[1]);
    }
    autoSave();
  }

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
    if (!isSpacer(item)) addOrderNumber(item);
    item.style.cursor = "grab";
    if (!isSpacer(item)) {
      showOrientBtns(item);
      addItemResizeHandles(item);
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
        var textEl = item.querySelector(".spacer-text");
        var sText   = textEl ? textEl.textContent.trim() : "";
        var sAlign  = textEl ? (textEl.style.textAlign || "") : "";
        var sValign = textEl
          ? (textEl.classList.contains("valign-middle") ? "valign-middle"
           : textEl.classList.contains("valign-bottom") ? "valign-bottom" : "")
          : "";
        var tClass  = ["spacer-text", "valign-top", sValign].filter(Boolean).join(" ").trim();
        var inner  = sText
          ? '\n  <div class="' + tClass + '"' +
            (sAlign ? ' style="text-align:' + sAlign + '"' : '') +
            '>' + sText + '</div>\n'
          : "";
        output += '<div class="g9-item g9-spacer"' +
          (style ? ' style="' + style + '"' : '') + '>' + inner + '</div>\n';
        return;
      }

      var img = item.querySelector("img");
      var objPos = img.style.objectPosition;
      var posAttr = objPos && objPos !== "50% 50%" ? ' style="object-position: ' + objPos + '"' : "";
      var spans = getItemSpans(item);
      var divStyle = "";
      var cls;
      if (spans.custom) {
        // Custom drag-resized: no size class, use inline grid spans
        divStyle = ' style="grid-column:span ' + spans.cols + ';grid-row:span ' + spans.rows + ';"';
        cls = ' class="g9-item"';
      } else {
        var size = getSize(item);
        var sizeCls = SIZE_CLASS_MAP[size];
        cls = sizeCls ? ' class="g9-item ' + sizeCls + '"' : ' class="g9-item"';
      }

      output +=
        "<div" + cls + divStyle + ">\n" +
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
        var tEl = item.querySelector(".spacer-text");
        var tValign = tEl
          ? (tEl.classList.contains("valign-middle") ? "middle"
           : tEl.classList.contains("valign-bottom") ? "bottom" : null)
          : null;
        return {
          type:   "spacer",
          cols:   spans.cols,
          rows:   spans.rows,
          text:   tEl && tEl.textContent.trim() ? tEl.textContent.trim() : null,
          align:  tEl && tEl.style.textAlign     ? tEl.style.textAlign     : null,
          valign: tValign
        };
      }
      var img = item.querySelector("img");
      var crop = img.style.objectPosition || "";
      var spans = getItemSpans(item);
      var entry = {
        id: img.dataset.imageId || "",
        crop: (crop && crop !== "50% 50%") ? crop : null
      };
      if (spans.custom) {
        entry.cols = spans.cols;
        entry.rows = spans.rows;
      } else {
        entry.size = getSize(item);
      }
      return entry;
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
        var tEl = item.querySelector(".spacer-text");
        var tValign = tEl
          ? (tEl.classList.contains("valign-middle") ? "middle"
           : tEl.classList.contains("valign-bottom") ? "bottom" : null)
          : null;
        return {
          type:   "spacer",
          cols:   spans.cols,
          rows:   spans.rows,
          text:   tEl && tEl.textContent.trim() ? tEl.textContent.trim() : null,
          align:  tEl && tEl.style.textAlign     ? tEl.style.textAlign     : null,
          valign: tValign
        };
      }
      var img = item.querySelector("img");
      var objPos = img.style.objectPosition || "";
      var spans = getItemSpans(item);
      var entry = {
        id: img.dataset.imageId || "",
        src: img.src,
        alt: img.alt || ""
      };
      if (spans.custom) {
        entry.cols = spans.cols;
        entry.rows = spans.rows;
      } else {
        entry.size = getSize(item);
      }
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
          // Plain tap: cycle to next size within current orientation group
          var tappedGroup = getOrientGroup(getSize(activeItem));
          setOrientation(activeItem, tappedGroup);
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
      if (e.key === "L" && e.shiftKey && hasEditParam() && (!lightbox || !lightbox.classList.contains("active"))) {
        toggleEditor();
        return;
      }

      // Lightbox navigation
      if (!lightbox || !lightbox.classList.contains("active")) return;
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
