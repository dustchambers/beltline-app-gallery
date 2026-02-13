const lightbox = document.getElementById("lightbox");
const lightboxImg = document.getElementById("lightbox-img");
const lightboxCaption = document.getElementById("lightbox-caption");
const lightboxCounter = document.getElementById("lightbox-counter");
const allItems = document.querySelectorAll(".gallery-item");

let visibleItems = [...allItems];
let currentIndex = 0;

// ── Crop Repositioning ──
let editMode = false;
let editOverlay = null;

function toggleEditMode() {
  editMode = !editMode;

  if (editMode) {
    // Create overlay banner
    editOverlay = document.createElement("div");
    editOverlay.id = "edit-overlay";
    editOverlay.innerHTML = `
      <div class="edit-banner">
        CROP EDIT MODE — Drag images to reposition ·
        <button id="edit-done">Done</button>
        <button id="edit-export">Export Positions</button>
      </div>
    `;
    document.body.appendChild(editOverlay);
    document.body.classList.add("edit-mode");

    document.getElementById("edit-done").addEventListener("click", toggleEditMode);
    document.getElementById("edit-export").addEventListener("click", exportPositions);

    // Make each gallery image draggable within its crop
    allItems.forEach((item) => {
      const img = item.querySelector("img");
      item.style.cursor = "grab";

      let isDragging = false;
      let startX, startY, startObjX, startObjY;

      // Get current object-position as percentages
      const computed = getComputedStyle(img);
      const pos = computed.objectPosition.split(" ");
      let objX = parseFloat(pos[0]) || 50;
      let objY = parseFloat(pos[1]) || 50;

      item._dragStart = (e) => {
        if (!editMode) return;
        e.preventDefault();
        isDragging = true;
        item.style.cursor = "grabbing";
        const touch = e.touches ? e.touches[0] : e;
        startX = touch.clientX;
        startY = touch.clientY;
        startObjX = objX;
        startObjY = objY;
      };

      item._dragMove = (e) => {
        if (!isDragging || !editMode) return;
        e.preventDefault();
        const touch = e.touches ? e.touches[0] : e;
        const dx = touch.clientX - startX;
        const dy = touch.clientY - startY;

        // Convert pixel movement to percentage (invert because moving image opposite to drag)
        objX = Math.max(0, Math.min(100, startObjX - (dx / item.offsetWidth) * 100));
        objY = Math.max(0, Math.min(100, startObjY - (dy / item.offsetHeight) * 100));

        img.style.objectPosition = `${objX.toFixed(1)}% ${objY.toFixed(1)}%`;
      };

      item._dragEnd = () => {
        isDragging = false;
        item.style.cursor = "grab";
      };

      item.addEventListener("mousedown", item._dragStart);
      window.addEventListener("mousemove", item._dragMove);
      window.addEventListener("mouseup", item._dragEnd);
      item.addEventListener("touchstart", item._dragStart, { passive: false });
      window.addEventListener("touchmove", item._dragMove, { passive: false });
      window.addEventListener("touchend", item._dragEnd);
    });

  } else {
    // Exit edit mode
    if (editOverlay) editOverlay.remove();
    document.body.classList.remove("edit-mode");

    allItems.forEach((item) => {
      item.style.cursor = "pointer";
      if (item._dragStart) {
        item.removeEventListener("mousedown", item._dragStart);
        window.removeEventListener("mousemove", item._dragMove);
        window.removeEventListener("mouseup", item._dragEnd);
        item.removeEventListener("touchstart", item._dragStart);
        window.removeEventListener("touchmove", item._dragMove);
        window.removeEventListener("touchend", item._dragEnd);
      }
    });
  }
}

function exportPositions() {
  let output = "/* Paste these into your gallery-item img styles or as inline styles */\n\n";
  allItems.forEach((item, i) => {
    const img = item.querySelector("img");
    const pos = img.style.objectPosition;
    if (pos && pos !== "50% 50%") {
      const filename = img.src.split("/").pop();
      output += `/* ${filename} */\nstyle="object-position: ${pos}"\n\n`;
    }
  });

  // Copy to clipboard
  navigator.clipboard.writeText(output).then(() => {
    const btn = document.getElementById("edit-export");
    btn.textContent = "Copied!";
    setTimeout(() => btn.textContent = "Export Positions", 2000);
  });

  console.log(output);
}

// Toggle edit mode with Shift+E
document.addEventListener("keydown", (e) => {
  if (e.key === "E" && e.shiftKey && !lightbox.classList.contains("active")) {
    toggleEditMode();
  }
});

// ── Lightbox ──
function openLightbox(index) {
  if (editMode) return; // Don't open lightbox in edit mode
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

    allItems.forEach((item) => {
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

// Initial bind
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
