// Cloudflare Worker — Webflow CMS Proxy for Gallery
//
// Deploy to Cloudflare Workers with these secrets:
//   WEBFLOW_API_TOKEN   — your Webflow Data API token
//   COLLECTION_ID       — the "Photo Galleries" collection ID
//
// Usage: GET https://your-worker.workers.dev/{gallery-slug}
// Returns: { id, title, subtitle, images: [{ id, src, alt, size }] }

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const slug = url.pathname.replace(/^\//, "").replace(/\/$/, "");

    // CORS headers for iframe/cross-origin access
    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    };

    // Handle preflight
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    if (!slug) {
      return Response.json(
        { error: "Usage: GET /{gallery-slug}" },
        { status: 400, headers: corsHeaders }
      );
    }

    try {
      // Fetch all items from the collection
      const items = await fetchAllItems(env.COLLECTION_ID, env.WEBFLOW_API_TOKEN);

      // Find the gallery item matching the slug
      const gallery = items.find(
        (item) => item.fieldData?.slug === slug || item.fieldData?.name?.toLowerCase().replace(/\s+/g, "-") === slug
      );

      if (!gallery) {
        return Response.json(
          { error: `Gallery "${slug}" not found` },
          { status: 404, headers: corsHeaders }
        );
      }

      const fields = gallery.fieldData;

      // Extract images from multi-image field
      // Webflow multi-image fields return an array of image objects
      const rawImages = fields.images || fields["gallery-images"] || [];

      const images = rawImages.map((img, i) => ({
        id: `img_${i}`,
        src: img.url || img.fileId || "",
        alt: fields.name || "Gallery Image",
        size: 1, // Default size — user can adjust in editor, saved to localStorage
      }));

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
          "Cache-Control": "public, max-age=300", // Cache 5 min
        },
      });
    } catch (err) {
      return Response.json(
        { error: "Failed to fetch from Webflow: " + err.message },
        { status: 500, headers: corsHeaders }
      );
    }
  },
};

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
