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

    // Extract images from multi-image field
    const rawImages = fields.images || fields["gallery-images"] || [];

    let images = rawImages.map((img, i) => ({
      id: `img_${i}`,
      src: img.url || img.fileId || "",
      alt: fields.name || "Gallery Image",
      size: 1,
    }));

    // ── Merge KV layout overrides ──
    const savedLayout = await env.GALLERY_KV.get("layout:" + slug);

    if (savedLayout) {
      try {
        const layout = JSON.parse(savedLayout);
        images = mergeLayout(images, layout);
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
        "Cache-Control": "public, max-age=300",
      },
    });
  } catch (err) {
    return Response.json(
      { error: "Failed to fetch from Webflow: " + err.message },
      { status: 500, headers: corsHeaders }
    );
  }
}

// Merge a saved layout over CMS images.
// Layout defines order + size/crop overrides.
// CMS images not in layout are appended at the end.
function mergeLayout(cmsImages, layout) {
  // Build lookup of CMS images by id
  const cmsMap = {};
  cmsImages.forEach(function (img) {
    cmsMap[img.id] = img;
  });

  const merged = [];
  const usedIds = {};

  // Walk layout in order — pull matching CMS image, apply overrides
  layout.forEach(function (entry) {
    const cmsImg = cmsMap[entry.id];
    if (!cmsImg) return; // image was removed from CMS — skip

    merged.push({
      id: cmsImg.id,
      src: cmsImg.src,
      alt: cmsImg.alt,
      size: entry.size !== undefined ? entry.size : cmsImg.size,
      crop: entry.crop || undefined,
    });

    usedIds[entry.id] = true;
  });

  // Append any CMS images not in the layout (new uploads)
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
