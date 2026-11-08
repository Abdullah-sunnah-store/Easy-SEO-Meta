// Meta templates: "{{title}} | {{shop}}" → "Blue Shirt | Acme". Client-safe.

export type Resource = "product" | "collection" | "page" | "article";
export const RESOURCES: Resource[] = ["product", "collection", "page", "article"];

export const RESOURCE_LABEL: Record<Resource, string> = {
  product: "Products",
  collection: "Collections",
  page: "Pages",
  article: "Blog posts",
};

// Search engines show roughly this much; longer is cut off in results.
export const TITLE_MAX = 60;
export const DESCRIPTION_MAX = 160;

export const TOKENS: Record<Resource | "alt", { token: string; label: string }[]> = {
  product: [
    { token: "title", label: "Product title" },
    { token: "shop", label: "Store name" },
    { token: "vendor", label: "Vendor" },
    { token: "product_type", label: "Product type" },
    { token: "price", label: "Price" },
    { token: "excerpt", label: "Start of description" },
  ],
  collection: [
    { token: "title", label: "Collection title" },
    { token: "shop", label: "Store name" },
    { token: "excerpt", label: "Start of description" },
  ],
  page: [
    { token: "title", label: "Page title" },
    { token: "shop", label: "Store name" },
    { token: "excerpt", label: "Start of content" },
  ],
  article: [
    { token: "title", label: "Post title" },
    { token: "shop", label: "Store name" },
    { token: "blog", label: "Blog name" },
    { token: "excerpt", label: "Start of post" },
  ],
  alt: [
    { token: "product_title", label: "Product title" },
    { token: "shop", label: "Store name" },
    { token: "vendor", label: "Vendor" },
    { token: "n", label: "Image number" },
  ],
};

export type Templates = {
  product: { title: string; description: string };
  collection: { title: string; description: string };
  page: { title: string; description: string };
  article: { title: string; description: string };
  alt: string;
};

export const DEFAULT_TEMPLATES: Templates = {
  product: { title: "{{title}} | {{shop}}", description: "{{excerpt}}" },
  collection: { title: "{{title}} | {{shop}}", description: "Shop {{title}} at {{shop}}. {{excerpt}}" },
  page: { title: "{{title}} | {{shop}}", description: "{{excerpt}}" },
  article: { title: "{{title}} | {{blog}}", description: "{{excerpt}}" },
  alt: "{{product_title}}",
};

export function parseTemplates(raw: string | null | undefined): Templates {
  let value: any = {};
  try {
    value = JSON.parse(raw || "{}") || {};
  } catch {
    value = {};
  }
  const out: any = {};
  for (const r of RESOURCES) {
    out[r] = {
      title: typeof value?.[r]?.title === "string" ? value[r].title.slice(0, 200) : DEFAULT_TEMPLATES[r].title,
      description:
        typeof value?.[r]?.description === "string"
          ? value[r].description.slice(0, 400)
          : DEFAULT_TEMPLATES[r].description,
    };
  }
  out.alt = typeof value?.alt === "string" ? value.alt.slice(0, 200) : DEFAULT_TEMPLATES.alt;
  return out as Templates;
}

/** Cuts at a word boundary and adds an ellipsis when over `max`. */
export function truncate(text: string, max: number): string {
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean.length <= max) return clean;
  const cut = clean.slice(0, max - 1);
  const space = cut.lastIndexOf(" ");
  return (space > max * 0.6 ? cut.slice(0, space) : cut).replace(/[\s,.;:–-]+$/, "") + "…";
}

/** Fills {{tokens}}; unknown or empty tokens vanish along with doubled separators. */
export function renderTemplate(template: string, ctx: Record<string, string | number | undefined>, max: number): string {
  const filled = template.replace(/\{\{\s*([a-z_]+)\s*\}\}/g, (_, key) => {
    const v = ctx[key];
    return v === undefined || v === null ? "" : String(v);
  });
  const tidy = filled
    .replace(/\s+/g, " ")
    .replace(/(\s*[|–-]\s*){2,}/g, " | ")
    .replace(/^\s*[|–-]\s*|\s*[|–-]\s*$/g, "")
    .trim();
  return truncate(tidy, max);
}

/** Plain text from HTML, for excerpts and length checks. */
export function htmlToText(html: string): string {
  return String(html || "")
    .replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ")
    .trim();
}
