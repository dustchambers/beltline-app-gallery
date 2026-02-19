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

    // Read current h-align: inline style or default "left"
    var currentAlign = textEl.style.textAlign || "left";

    [
      { val: "left",   label: "\u2190", title: "Align left" },
      { val: "center", label: "\u2194", title: "Align center" },
      { val: "right",  label: "\u2192", title: "Align right" }
    ].forEach(function (def) {
      var btn = document.createElement("button");
      btn.className = "spacer-align-btn";
      btn.dataset.align = def.val;
      btn.title = def.title;
      btn.textContent = def.label;
      if (def.val === currentAlign) btn.classList.add("active");
      btn.addEventListener("mousedown", function (e) { e.stopPropagation(); });
      btn.addEventListener("click", function (e) {
        e.stopPropagation();
        textEl.style.textAlign = def.val;
        alignBar.querySelectorAll(".spacer-align-btn").forEach(function (b) {
          b.classList.toggle("active", b.dataset.align === def.val);
        });
        autoSave();
      });
      alignBar.appendChild(btn);
    });
    item.appendChild(alignBar);

    // ── Vertical alignment bar (T / M / B) ──
    var vAlignBar = document.createElement("div");
    vAlignBar.className = "spacer-align-vbar";

    // Read current v-align from class
    var currentValign = textEl.classList.contains("valign-middle") ? "middle"
                      : textEl.classList.contains("valign-bottom") ? "bottom"
                      : "top";

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
      if (def.val === currentValign) btn.classList.add("active");
      btn.addEventListener("mousedown", function (e) { e.stopPropagation(); });
      btn.addEventListener("click", function (e) {
        e.stopPropagation();
        textEl.classList.remove("valign-top", "valign-middle", "valign-bottom");
        textEl.classList.add("valign-" + def.val);
        vAlignBar.querySelectorAll(".spacer-align-btn").forEach(function (b) {
          b.classList.toggle("active", b.dataset.valign === def.val);
        });
        autoSave();
      });
      vAlignBar.appendChild(btn);
    });
    item.appendChild(vAlignBar);

    // T toggle button — enables/disables text editing on the spacer
    var textBtn = document.createElement("button");
    textBtn.className = "spacer-text-btn";
    textBtn.textContent = "T";
    textBtn.title = "Add text";

    var textActive = false;
    // Guard flag: set true on mousedown of any in-spacer button so focusout
    // doesn't deactivate before the click event fires (relatedTarget is
    // unreliable across browsers when clicking buttons).
    var suppressDeactivate = false;

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

    // Any mousedown inside the spacer item suppresses the focusout deactivation
    // for this event cycle (cleared after click fires via setTimeout(0)).
    function suppressNext(e) {
      e.stopPropagation();
      suppressDeactivate = true;
      setTimeout(function () { suppressDeactivate = false; }, 0);
    }

    textBtn.addEventListener("mousedown", suppressNext);
    textBtn.addEventListener("click", function (e) {
      e.stopPropagation();
      if (textActive) {
        deactivateTextMode();
      } else {
        activateTextMode();
      }
    });
    item.appendChild(textBtn);

    // Align buttons also suppress deactivation on mousedown
    alignBar.addEventListener("mousedown", suppressNext);
    vAlignBar.addEventListener("mousedown", suppressNext);

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

    // Deactivate when focus truly leaves this spacer.
    // suppressDeactivate is set by any in-spacer button's mousedown, so we
    // don't collapse the panel mid-click even when relatedTarget is unreliable.
    textEl.addEventListener("focusout", function (e) {
      if (!textActive || suppressDeactivate) return;
      var dest = e.relatedTarget;
      if (dest && item.contains(dest)) return; // focus moving to our own button
      deactivateTextMode();
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

    // Preserve explicit column/row start if already pinned; only update the span
    var curCol = parseGridStyle(resizingItem.style.gridColumn);
    var curRow = parseGridStyle(resizingItem.style.gridRow);
    var colStart = curCol.start || 1;
    var rowStart = curRow.start || 1;
    resizingItem.style.gridColumn = colStart + " / span " + newCols;
    resizingItem.style.gridRow    = rowStart + " / span " + newRows;
    // Update gap slots live so adjacent empty space shrinks/grows as you drag
    refreshSlots();
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

  // Parse grid-column / grid-row style into { start, span } — handles both
  // "span 6" (auto-placed) and "7 / span 6" (explicit start) formats.
  function parseGridStyle(styleStr) {
    if (!styleStr) return { start: null, span: 1 };
    var explicitMatch = styleStr.match(/^(\d+)\s*\/\s*span\s+(\d+)/);
    if (explicitMatch) return { start: parseInt(explicitMatch[1]), span: parseInt(explicitMatch[2]) };
    var spanMatch = styleStr.match(/span\s+(\d+)/);
    if (spanMatch) return { start: null, span: parseInt(spanMatch[1]) };
    return { start: null, span: 1 };
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
        var spc = parseGridStyle(item.style.gridColumn);
        var spr = parseGridStyle(item.style.gridRow);
        return {
          type:     "spacer",
          cols:     spans.cols,
          rows:     spans.rows,
          colStart: spc.start || null,
          rowStart: spr.start || null,
          text:     spacerText   || null,
          align:    spacerAlign  || null,
          valign:   spacerValign || null
        };
      }
      var img = item.querySelector("img");
      var crop = img.style.objectPosition || "";
      var spans = getItemSpans(item);
      var colP = parseGridStyle(item.style.gridColumn);
      var rowP = parseGridStyle(item.style.gridRow);
      var entry = {
        id:       img.dataset.imageId || "",
        crop:     (crop && crop !== "50% 50%") ? crop : null,
        colStart: colP.start || null,
        rowStart: rowP.start || null
      };
      if (spans.custom || (colP.span > 1 && !SIZE_CLASS_MAP[colP.span + "x" + rowP.span])) {
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
          if (entry.colStart && entry.rowStart) {
            spacer.style.gridColumn = entry.colStart + " / span " + (entry.cols || 1);
            spacer.style.gridRow    = entry.rowStart + " / span " + (entry.rows || 1);
          }
          gallery.appendChild(spacer);
          if (editorMode) setupEditorItem(spacer);
          return;
        }
        var item = itemMap[entry.id];
        if (!item) return;

        gallery.appendChild(item);
        restoredIds[entry.id] = true;

        if (entry.cols && entry.rows) {
          // Custom drag-resized item: restore raw inline spans (with explicit start if saved)
          clearSizeClasses(item);
          item.style.gridColumn = (entry.colStart ? entry.colStart + " / " : "") + "span " + entry.cols;
          item.style.gridRow    = (entry.rowStart ? entry.rowStart + " / " : "") + "span " + entry.rows;
        } else {
          applySizeClass(item, entry.size);
          if (entry.colStart && entry.rowStart) {
            // Also restore explicit position for named-size items
            var spans = getItemSpans(item);
            item.style.gridColumn = entry.colStart + " / span " + spans.cols;
            item.style.gridRow    = entry.rowStart + " / span " + spans.rows;
          }
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

  function makeSlot(cols, rows, insertBeforeNode) {
    // Build one unified slot spanning `cols` columns × `rows` rows.
    // Clicking the + replaces itself with a spacer of the same dimensions.
    var gallery = getGallery();
    var slot = document.createElement("div");
    slot.className = "g9-slot";
    slot.style.gridColumn = "span " + cols;
    slot.style.gridRow    = "span " + rows;
    slot.dataset.slotCols = cols;
    slot.dataset.slotRows = rows;

    var plusBtn = document.createElement("button");
    plusBtn.className = "slot-plus-btn";
    plusBtn.textContent = "+";
    plusBtn.title = "Add spacer (" + cols + "\u00d7" + rows + ")";
    plusBtn.addEventListener("click", function (e) {
      e.stopPropagation();
      // Read this slot's explicit position before removing it
      var slotCol = parseGridStyle(slot.style.gridColumn);
      var slotRow = parseGridStyle(slot.style.gridRow);
      var spacer = createSpacerElement(cols, rows);
      // Give the new spacer the exact position the slot occupied
      spacer.style.gridColumn = (slotCol.start || 1) + " / span " + cols;
      spacer.style.gridRow    = (slotRow.start || 1) + " / span " + rows;
      gallery.insertBefore(spacer, slot);
      slot.remove();
      setupEditorItem(spacer);
      refreshOrderNumbers();
      refreshSlots();
      autoSave();
    });
    slot.appendChild(plusBtn);

    if (insertBeforeNode) {
      gallery.insertBefore(slot, insertBeforeNode);
    } else {
      gallery.appendChild(slot);
    }
    return slot;
  }

  function refreshSlots() {
    getGallery().querySelectorAll(".g9-slot").forEach(function (s) { s.remove(); });
    if (!editorMode) return;

    var items = getGalleryItems();
    if (items.length === 0) return;

    // Build a per-row-band occupancy map from explicit grid placements.
    // Each item occupies cells [colStart .. colStart+w-1] on rows [rowStart .. rowStart+h-1].
    // We find gaps (columns not occupied in a given row band) and emit slots for them.
    //
    // "Row band" = a contiguous group of grid rows that share the same set of items.
    // For simplicity, we work row-by-row (each band is 1 row tall).

    // Collect { colStart, colEnd, rowStart, rowEnd } for each item
    var rects = [];
    var maxRow = 0;

    items.forEach(function (item) {
      var colStyle = item.style.gridColumn || "";
      var rowStyle = item.style.gridRow    || "";
      var cp = parseGridStyle(colStyle);
      var rp = parseGridStyle(rowStyle);
      var cStart = cp.start || 1;
      var rStart = rp.start || 1;
      rects.push({
        cStart: cStart,
        cEnd:   cStart + cp.span - 1, // inclusive
        rStart: rStart,
        rEnd:   rStart + rp.span - 1  // inclusive
      });
      maxRow = Math.max(maxRow, rStart + rp.span - 1);
    });

    if (maxRow === 0) return;

    // For each grid row band 1..maxRow, find which columns are unoccupied
    // but have occupied cells in the same row band on at least one side
    // (meaning it's a genuine gap, not trailing space).
    var gallery = getGallery();
    var slotsAdded = 0;

    for (var r = 1; r <= maxRow; r++) {
      // Which columns are occupied in this row?
      var occupied = {}; // col → true
      rects.forEach(function (rc) {
        if (rc.rStart <= r && rc.rEnd >= r) {
          for (var c = rc.cStart; c <= rc.cEnd; c++) {
            occupied[c] = true;
          }
        }
      });

      // Find contiguous runs of unoccupied columns
      var c = 1;
      while (c <= 18) {
        if (!occupied[c]) {
          // Start of a gap
          var gapStart = c;
          while (c <= 18 && !occupied[c]) c++;
          var gapEnd = c - 1; // inclusive
          var gapWidth = gapEnd - gapStart + 1;

          // Only emit a slot if this row actually has something occupied
          // (i.e. it's not an entirely empty row band — avoid spurious trailing rows)
          var rowHasContent = false;
          for (var cc = 1; cc <= 18; cc++) {
            if (occupied[cc]) { rowHasContent = true; break; }
          }
          if (rowHasContent) {
            // How tall is this gap? Find the max height of items adjacent to it
            // For simplicity: use 1 row tall — the slot will just fill its visual band
            makeSlot(gapWidth, 1, null);
            // Manually set explicit position so it lands in the right cell
            var lastSlot = gallery.lastChild;
            if (lastSlot && lastSlot.classList.contains("g9-slot")) {
              lastSlot.style.gridColumn = gapStart + " / span " + gapWidth;
              lastSlot.style.gridRow    = r + " / span 1";
              slotsAdded++;
            }
          }
        } else {
          c++;
        }
      }
    }
  }

  // ── Orientation Buttons ──

  // ── Reorder Drag ──
  // Strategy: activeItem stays in its original DOM position throughout the drag
  // (so grid-auto-flow:dense never backfills its space). A lightweight
  // dropIndicator element moves to show the intended drop position. On
  // mouseup the actual DOM move happens once — one reflow, no upward snap.

  var dropIndicator = null;  // in-grid insertion preview element
  var dragCellCursor = null; // 1×1 cell highlight that follows the cursor

  // ── Explicit Grid Placement ──
  // In editor mode, every item is pinned with grid-column-start / grid-row-start
  // computed from a linear layout simulation. This lets us place the drop
  // indicator at any arbitrary cell — not just next to existing items —
  // and items stay exactly where placed instead of auto-packing leftward.

  // Simulate CSS Grid auto-placement (row mode) for all items and assign
  // explicit  grid-column: C / span N  and  grid-row: R / span M  to each.
  // Called when entering editor mode and after every drop.
  function pinAllItems() {
    var items = getGalleryItems();
    var colCursor = 1; // 1-based
    var rowCursor = 1;
    var rowMaxH   = 1; // tallest item in the current row band

    items.forEach(function (item) {
      var spans = isSpacer(item) ? getSpacerSpans(item) : getItemSpans(item);
      var w = Math.max(1, spans.cols);
      var h = Math.max(1, spans.rows);

      // Wrap to next row if this item won't fit
      if (colCursor + w - 1 > 18) {
        rowCursor += rowMaxH;
        colCursor  = 1;
        rowMaxH    = 1;
      }

      item.style.gridColumn = colCursor + " / span " + w;
      item.style.gridRow    = rowCursor + " / span " + h;

      colCursor += w;
      rowMaxH    = Math.max(rowMaxH, h);

      // If we've exactly filled 18 cols, advance the row
      if (colCursor > 18) {
        rowCursor += rowMaxH;
        colCursor  = 1;
        rowMaxH    = 1;
      }
    });
  }

  // Strip explicit placement from all items (back to auto-flow for view mode)
  function unpinAllItems() {
    getGalleryItems().forEach(function (item) {
      // Restore to just "span N" form (no start) so auto-flow takes over
      var spans = isSpacer(item) ? getSpacerSpans(item) : getItemSpans(item);
      if (spans.cols > 1) {
        item.style.gridColumn = "span " + spans.cols;
      } else {
        item.style.gridColumn = "";
      }
      if (spans.rows > 1) {
        item.style.gridRow = "span " + spans.rows;
      } else {
        item.style.gridRow = "";
      }
    });
  }

  // Convert clientX/Y to 1-based grid col/row. Returns null if outside grid.
  function clientToGridCell(clientX, clientY) {
    var m = getGridMetrics();
    var x = clientX - m.rect.left;
    var y = clientY - m.rect.top + window.scrollY; // account for scroll

    // Also account for scroll in rect
    var scrolledY = clientY - (m.rect.top - (window.pageYOffset || document.documentElement.scrollTop));

    // Recompute without scroll confusion: use the actual viewport rect
    x = clientX - m.rect.left;
    y = clientY - m.rect.top;

    var cellStep = m.colWidth + m.gap;
    var col = Math.floor(x / cellStep) + 1; // 1-based
    var row = Math.max(1, Math.floor(y / (m.rowHeight + m.gap)) + 1); // 1-based

    col = Math.max(1, Math.min(18, col));
    return { col: col, row: row };
  }

  // Update the 1×1 cell highlight to follow the cursor snapped to grid cells.
  function updateCellCursor(clientX, clientY) {
    if (!dragCellCursor) return;
    var m = getGridMetrics();
    var x = clientX - m.rect.left;
    if (x < 0 || x > m.rect.width) {
      dragCellCursor.style.opacity = "0";
      return;
    }
    var cell = clientToGridCell(clientX, clientY);
    var cellX = m.rect.left + (cell.col - 1) * (m.colWidth + m.gap);
    var cellY = m.rect.top  + (cell.row - 1) * (m.rowHeight + m.gap);
    dragCellCursor.style.opacity = "1";
    dragCellCursor.style.left   = cellX + "px";
    dragCellCursor.style.top    = cellY + "px";
    dragCellCursor.style.width  = m.colWidth + "px";
    dragCellCursor.style.height = m.rowHeight + "px";
  }

  function startDrag(item, e) {
    document.body.classList.add("dragging");

    // Hide dragged item in-place (keeps its grid space, doesn't cause reflow)
    item.style.visibility = "hidden";
    item.style.cursor = "grabbing";

    // Ghost follows the cursor
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

    // 1×1 cell cursor highlight
    dragCellCursor = document.createElement("div");
    dragCellCursor.className = "drag-cell-cursor";
    document.body.appendChild(dragCellCursor);
    updateCellCursor(e.clientX, e.clientY);

    // Drop indicator — same size as dragged item, placed at cursor cell
    var spans = isSpacer(item) ? getSpacerSpans(item) : getItemSpans(item);
    dropIndicator = document.createElement("div");
    dropIndicator.className = "drop-indicator";
    var cell = clientToGridCell(e.clientX, e.clientY);
    dropIndicator.style.gridColumn = cell.col + " / span " + spans.cols;
    dropIndicator.style.gridRow    = cell.row + " / span " + spans.rows;
    dropIndicator.style.pointerEvents = "none";
    dropIndicator.style.zIndex = "5";
    getGallery().appendChild(dropIndicator);

    lastDropTarget = null;
    lastInsertBefore = true;
  }

  function moveDrag(e) {
    if (dragGhost) {
      dragGhost.style.left = e.clientX + "px";
      dragGhost.style.top = e.clientY + "px";
    }
    updateCellCursor(e.clientX, e.clientY);

    if (!dropIndicator || !activeItem) return;

    // Move drop indicator to cursor's grid cell
    var spans = isSpacer(activeItem) ? getSpacerSpans(activeItem) : getItemSpans(activeItem);
    var cell = clientToGridCell(e.clientX, e.clientY);

    // Clamp so indicator doesn't overflow 18 cols
    var startCol = Math.min(cell.col, 18 - spans.cols + 1);
    startCol = Math.max(1, startCol);

    dropIndicator.style.gridColumn = startCol + " / span " + spans.cols;
    dropIndicator.style.gridRow    = cell.row + " / span " + spans.rows;
  }

  function endDrag() {
    if (dragGhost) {
      dragGhost.remove();
      dragGhost = null;
    }
    if (dragCellCursor) {
      dragCellCursor.remove();
      dragCellCursor = null;
    }
    document.body.classList.remove("dragging");

    if (dropIndicator && activeItem) {
      // Read the final drop position from the indicator's explicit placement
      var colStyle = dropIndicator.style.gridColumn; // e.g. "7 / span 6"
      var rowStyle = dropIndicator.style.gridRow;

      // Apply exact position to the dropped item
      activeItem.style.gridColumn = colStyle;
      activeItem.style.gridRow    = rowStyle;
      activeItem.style.visibility = "";
      activeItem._pinnedCol = parseInt(colStyle);
      activeItem._pinnedRow = parseInt(rowStyle);

      dropIndicator.remove();
      dropIndicator = null;
    } else if (activeItem) {
      activeItem.style.visibility = "";
    }

    activeItem.style.cursor = "grab";

    lastDropTarget = null;
    lastInsertBefore = true;
    refreshOrderNumbers();
    refreshSlots();
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

      getGalleryItems().forEach(function (item) {
        setupEditorItem(item);
      });
      pinAllItems();
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
          // Plain tap: cycle crop position
          if (!isSpacer(activeItem)) cycleCrop(activeItem);
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

      // Remove slots and any lingering drag artifacts before cleanup
      getGallery().querySelectorAll(".g9-slot").forEach(function (s) { s.remove(); });
      if (dropIndicator)   { dropIndicator.remove();   dropIndicator = null; }
      if (dragCellCursor)  { dragCellCursor.remove();  dragCellCursor = null; }
      document.body.classList.remove("dragging");
      unpinAllItems();

      getGalleryItems().forEach(function (item) {
        var badge = item.querySelector(".layout-badge");
        if (badge) badge.remove();
        var orderNum = item.querySelector(".order-number");
        if (orderNum) orderNum.remove();
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
