// Cloudflare Worker — Webflow CMS Proxy for Gallery
//
// Deploy to Cloudflare Workers with these secrets:
//   WEBFLOW_API_TOKEN   — your Webflow Data API token
//   COLLECTION_ID       — the "Photo Galleries" collection ID
//   EDIT_SECRET          — secret key for publish authorization
//
// Usage:
//   GET  /{gallery-slug}   — returns gallery config (merges KV layout if published)
//   PUT  /{gallery-slug}   — saves layout to KV (requires Authorization: Bearer <secret>)

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const slug = url.pathname.replace(/^\//, "").replace(/\/$/, "");

    // CORS headers for iframe/cross-origin access
    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, PUT, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
    };

    // Handle preflight
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    if (!slug) {
      return Response.json(
        { error: "Usage: GET /{gallery-slug} or PUT /{gallery-slug}" },
        { status: 400, headers: corsHeaders }
      );
    }

    // ── PUT: Save layout to KV ──
    if (request.method === "PUT") {
      return handlePut(request, env, slug, corsHeaders);
    }

    // ── GET: Fetch gallery config (with KV merge) ──
    if (request.method === "GET") {
      return handleGet(env, slug, corsHeaders);
    }

    return Response.json(
      { error: "Method not allowed" },
      { status: 405, headers: corsHeaders }
    );
  },
};

async function handlePut(request, env, slug, corsHeaders) {
  // Validate auth
  const authHeader = request.headers.get("Authorization") || "";
  const token = authHeader.replace(/^Bearer\s+/i, "");

  if (!token || token !== env.EDIT_SECRET) {
    return Response.json(
      { error: "Unauthorized" },
      { status: 401, headers: corsHeaders }
    );
  }

  // Read and validate body
  let layout;
  try {
    layout = await request.json();
  } catch (e) {
    return Response.json(
      { error: "Invalid JSON body" },
      { status: 400, headers: corsHeaders }
    );
  }

  if (!Array.isArray(layout)) {
    return Response.json(
      { error: "Body must be a JSON array" },
      { status: 400, headers: corsHeaders }
    );
  }

  // Write to KV
  await env.GALLERY_KV.put("layout:" + slug, JSON.stringify(layout));

  return Response.json(
    { ok: true },
    { headers: corsHeaders }
  );
}

async function handleGet(env, slug, corsHeaders) {
  try {
    // Fetch all items from the collection
    const items = await fetchAllItems(env.COLLECTION_ID, env.WEBFLOW_API_TOKEN);

    // Find the gallery item matching the slug
    const gallery = items.find(
      (item) =>
        item.fieldData?.slug === slug ||
        item.fieldData?.name?.toLowerCase().replace(/\s+/g, "-") === slug
    );

    if (!gallery) {
      return Response.json(
        { error: `Gallery "${slug}" not found` },
        { status: 404, headers: corsHeaders }
      );
    }

    const fields = gallery.fieldData;

    // Extract images from all multi-image fields (supports >25 via images-2, images-3).
    // IDs are index-based (img_0…img_N) across the full concatenated array.
    // Note: removing images from an earlier field shifts IDs for later fields.
    // Supports up to ~75 images (3 fields × 25); add images-4 here to extend further.
    const rawImages = [
      ...(fields["images"] || fields["gallery-images"] || []),
      ...(fields["images-2"] || []),
      ...(fields["images-3"] || []),
    ];

    let images = rawImages.map((img, i) => ({
      id: `img_${i}`,
      src: img.url || img.fileId || "",
      alt: fields.name || "Gallery Image",
      size: 1,
    }));

    // ── Merge KV layout overrides ──
    const savedLayout = await env.GALLERY_KV.get("layout:" + slug);
    console.log("KV lookup: layout:" + slug, "| found:", !!savedLayout, savedLayout ? "(len=" + savedLayout.length + ")" : "(empty)");

    if (savedLayout) {
      try {
        const layout = JSON.parse(savedLayout);
        images = mergeLayout(images, layout);
        console.log("mergeLayout complete | images:", images.length, "| first id:", images[0] && images[0].id);
      } catch (e) {
        // If layout is corrupt, just use CMS order
        console.error("Failed to parse saved layout:", e);
      }
    }

    const config = {
      id: slug,
      title: fields.name || slug,
      subtitle: fields.subtitle || fields["sub-title"] || "",
      images: images,
    };

    return Response.json(config, {
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json",
        "Cache-Control": "public, max-age=30",
      },
    });
  } catch (err) {
    return Response.json(
      { error: "Failed to fetch from Webflow: " + err.message },
      { status: 500, headers: corsHeaders }
    );
  }
}

function mergeLayout(cmsImages, layout) {
  const cmsMap = {};
  cmsImages.forEach(function (img) {
    cmsMap[img.id] = img;
  });

  const merged = [];
  const usedIds = {};

  layout.forEach(function (entry) {
    // Spacer entries have no CMS equivalent — pass through as-is
    if (entry.type === "spacer") {
      merged.push(entry);
      return;
    }

    const cmsImg = cmsMap[entry.id];
    if (!cmsImg) return; // image removed from CMS — skip

    // src and alt always come from CMS (authoritative URLs)
    // all layout overrides (position, size, adjustments, crop) come from KV
    merged.push({
      id:          cmsImg.id,
      src:         cmsImg.src,
      alt:         cmsImg.alt,
      size:        entry.size        !== undefined ? entry.size        : cmsImg.size,
      crop:        entry.crop        != null ? entry.crop        : undefined,
      colStart:    entry.colStart    != null ? entry.colStart    : undefined,
      rowStart:    entry.rowStart    != null ? entry.rowStart    : undefined,
      cols:        entry.cols        != null ? entry.cols        : undefined,
      rows:        entry.rows        != null ? entry.rows        : undefined,
      adjustments: entry.adjustments != null ? entry.adjustments : undefined,
    });

    usedIds[entry.id] = true;
  });

  // Append new CMS images not present in the saved layout
  cmsImages.forEach(function (img) {
    if (!usedIds[img.id]) {
      merged.push(img);
    }
  });

  return merged;
}

async function fetchAllItems(collectionId, apiToken) {
  const items = [];
  let offset = 0;

  while (true) {
    const res = await fetch(
      `https://api.webflow.com/v2/collections/${collectionId}/items?limit=100&offset=${offset}`,
      {
        headers: {
          Authorization: `Bearer ${apiToken}`,
          "accept-version": "2.0.0",
        },
      }
    );

    if (!res.ok) {
      throw new Error(`Webflow API ${res.status}: ${await res.text()}`);
    }

    const data = await res.json();
    items.push(...data.items);

    if (items.length >= data.pagination.total) break;
    offset += 100;
  }

  return items;
}
