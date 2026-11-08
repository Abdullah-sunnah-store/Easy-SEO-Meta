// AI-written SEO titles and meta descriptions, via Google's Gemini API.
//
// Gemini has a free tier (an API key from aistudio.google.com, no billing
// account), which is why it was chosen: the feature costs nothing to run. Two
// things come with that tier and the merchant-facing copy should not promise
// otherwise:
//   • limits are per Google Cloud project, i.e. shared by every shop using this
//     app — the per-plan monthly caps in lib/plans.ts keep one shop from using
//     them all up;
//   • Google may use free-tier prompts to improve its products. We only send
//     public catalogue text (titles, descriptions, vendor, price), never
//     customer data.
//
// Set GEMINI_API_KEY on the host. GEMINI_MODEL optionally pins a model; by
// default the first of FALLBACK_MODELS that exists is used, so a retired model
// name degrades to the next one instead of breaking the button.

import { gql, type AdminClient } from "./admin.server";
import { DESCRIPTION_MAX, TITLE_MAX, htmlToText, truncate } from "../lib/templates";

export class AiError extends Error {
  constructor(message: string, readonly code: "quota" | "other" = "other") {
    super(message);
  }
}

export type AiField = "title" | "description" | "both";

const FALLBACK_MODELS = ["gemini-3.5-flash-lite", "gemini-3.1-flash-lite", "gemini-2.5-flash-lite", "gemini-2.0-flash-lite"];
const ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/models";
const TIMEOUT_MS = 15_000;

export function aiConfigured(): boolean {
  return Boolean(process.env.GEMINI_API_KEY?.trim());
}

// The first model that answered; reused for the life of the function instance.
let workingModel: string | undefined;

function models(): string[] {
  const pinned = process.env.GEMINI_MODEL?.trim();
  if (pinned) return [pinned];
  return workingModel ? [workingModel, ...FALLBACK_MODELS.filter((m) => m !== workingModel)] : FALLBACK_MODELS;
}

export type SourceContent = {
  kind: "product" | "collection" | "page" | "article";
  title: string;
  text: string;
  vendor?: string;
  productType?: string;
  tags?: string[];
  price?: string;
  blog?: string;
};

const SOURCE_QUERY = `#graphql
  query SeoAiSource($id: ID!) {
    node(id: $id) {
      __typename
      ... on Product {
        title description vendor productType tags
        priceRangeV2 { minVariantPrice { amount currencyCode } }
      }
      ... on Collection { title description }
      ... on Page { title body }
      ... on Article { title body blog { title } }
    }
  }`;

/** Reads the live text of the product / collection / page / article to write from. */
export async function loadSource(admin: AdminClient, resourceId: string): Promise<SourceContent> {
  const data = await gql<any>(admin, SOURCE_QUERY, { id: resourceId });
  const n = data?.node;
  if (!n) throw new AiError("That item no longer exists in Shopify.");
  switch (n.__typename) {
    case "Product": {
      const p = n.priceRangeV2?.minVariantPrice;
      return {
        kind: "product",
        title: n.title,
        text: n.description || "",
        vendor: n.vendor || undefined,
        productType: n.productType || undefined,
        tags: (n.tags || []).slice(0, 10),
        price: p ? `${Number(p.amount).toFixed(2)} ${p.currencyCode}` : undefined,
      };
    }
    case "Collection":
      return { kind: "collection", title: n.title, text: n.description || "" };
    case "Page":
      return { kind: "page", title: n.title, text: htmlToText(n.body || "") };
    case "Article":
      return { kind: "article", title: n.title, text: htmlToText(n.body || ""), blog: n.blog?.title };
    default:
      throw new AiError("AI writing isn't available for this item.");
  }
}

const SYSTEM = [
  "You write search-engine metadata for a Shopify store.",
  `Return JSON with "title" (at most ${TITLE_MAX} characters) and "description" (between 120 and ${DESCRIPTION_MAX} characters).`,
  "The title names the item plainly with its most-searched keyword first; no ALL CAPS, no emoji, no quotation marks, no clickbait.",
  "The description says what it is and why someone would want it, in natural sentences, ending with a soft call to action.",
  "Use only facts present in the input. Never invent materials, sizes, prices, discounts, shipping offers or claims.",
  "Write in the same language as the input text.",
].join(" ");

function prompt(src: SourceContent, store: string): string {
  const lines = [
    `Store: ${store}`,
    `Type: ${src.kind}`,
    `Name: ${src.title}`,
    src.vendor && `Brand: ${src.vendor}`,
    src.productType && `Category: ${src.productType}`,
    src.tags?.length && `Tags: ${src.tags.join(", ")}`,
    src.price && `Price from: ${src.price}`,
    src.blog && `Blog: ${src.blog}`,
    `Text: ${truncate(src.text || "(none)", 2500)}`,
  ];
  return lines.filter(Boolean).join("\n");
}

async function callGemini(model: string, key: string, body: unknown): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    return await fetch(`${ENDPOINT}/${encodeURIComponent(model)}:generateContent`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": key },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (error: any) {
    throw new AiError(error?.name === "AbortError" ? "The AI took too long to answer. Try again." : "Couldn't reach the AI service. Try again.");
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Sends one request to the first available model and returns the parsed JSON
 * answer. Throws AiError with a merchant-readable message.
 */
async function askGemini(body: Record<string, unknown>): Promise<any> {
  const key = process.env.GEMINI_API_KEY?.trim();
  if (!key) throw new AiError("AI writing isn't set up yet.");
  for (const model of models()) {
    const res = await callGemini(model, key, body);
    if (res.status === 404) continue; // model retired or not on this tier — try the next one
    if (res.status === 429) throw new AiError("The free AI quota is used up for the moment. Try again in a minute.", "quota");
    if (res.status === 400 || res.status === 401 || res.status === 403) {
      const detail = await res.text().catch(() => "");
      console.error(`Easy SEO AI: Gemini ${res.status} on ${model}:`, detail.slice(0, 300));
      throw new AiError(/API key/i.test(detail) ? "The AI key isn't valid. Check GEMINI_API_KEY." : "The AI service refused the request.");
    }
    if (!res.ok) throw new AiError("The AI service had a problem. Try again.");

    workingModel = model;
    const json: any = await res.json();
    const text = (json?.candidates?.[0]?.content?.parts ?? []).map((p: any) => p?.text ?? "").join("");
    try {
      return JSON.parse(text);
    } catch {
      throw new AiError("The AI answer was unreadable. Try again.");
    }
  }
  throw new AiError("No AI model is available for this key. Set GEMINI_MODEL to a current Gemini model.");
}

const clean = (s: unknown) => String(s ?? "").replace(/^["'\s]+|["'\s]+$/g, "").replace(/\s+/g, " ");

/** Writes a title and description for `src`. Throws AiError with a merchant-readable message. */
export async function generateMeta(src: SourceContent, store: string): Promise<{ title: string; description: string }> {
  const out = await askGemini({
    systemInstruction: { parts: [{ text: SYSTEM }] },
    contents: [{ role: "user", parts: [{ text: prompt(src, store) }] }],
    generationConfig: {
      temperature: 0.6,
      maxOutputTokens: 400,
      responseMimeType: "application/json",
      responseSchema: {
        type: "OBJECT",
        properties: { title: { type: "STRING" }, description: { type: "STRING" } },
        required: ["title", "description"],
      },
    },
  });
  const title = truncate(clean(out?.title), TITLE_MAX);
  const description = truncate(clean(out?.description), DESCRIPTION_MAX);
  if (!title && !description) throw new AiError("The AI didn't return any text. Try again.");
  return { title, description };
}

export const ALT_MAX = 125;
const MAX_IMAGE_BYTES = 4 * 1024 * 1024;

const ALT_SYSTEM = [
  "You write alt text for product images in a Shopify store, for search engines and screen-reader users.",
  `Return JSON with "alt": one plain sentence fragment, at most ${ALT_MAX} characters.`,
  "Describe what is actually visible: the item, its colour, material or setting, and any visible text that matters.",
  'Do not start with "image of" or "picture of". No emoji, no hashtags, no keyword lists, no prices or claims.',
  "If the image shows the named product, use the product name naturally. Write in the same language as the product name.",
].join(" ");

/** Shopify CDN URLs resize on request; 768px is plenty to describe a photo. */
function sizedUrl(url: string): string {
  if (!/cdn\.shopify\.com|shopifycdn|myshopify\.com/.test(url)) return url;
  return url + (url.includes("?") ? "&" : "?") + "width=768";
}

async function fetchImage(url: string): Promise<{ mimeType: string; data: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  try {
    const res = await fetch(sizedUrl(url), { signal: controller.signal });
    if (!res.ok) throw new AiError("Couldn't load that image.");
    const mimeType = (res.headers.get("content-type") || "").split(";")[0].trim();
    if (!/^image\/(jpeg|png|webp|heic|heif|gif)$/.test(mimeType)) throw new AiError("That image format can't be described by the AI.");
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > MAX_IMAGE_BYTES) throw new AiError("That image is too large for the AI to read.");
    return { mimeType: mimeType === "image/gif" ? "image/png" : mimeType, data: buf.toString("base64") };
  } catch (error: any) {
    if (error instanceof AiError) throw error;
    throw new AiError(error?.name === "AbortError" ? "Loading the image took too long." : "Couldn't load that image.");
  } finally {
    clearTimeout(timer);
  }
}

/** Looks at the image itself and writes alt text for it. */
export async function generateAlt(args: { imageUrl: string; productTitle: string; store: string }): Promise<string> {
  if (!aiConfigured()) throw new AiError("AI writing isn't set up yet.");
  const image = await fetchImage(args.imageUrl);
  const out = await askGemini({
    systemInstruction: { parts: [{ text: ALT_SYSTEM }] },
    contents: [
      {
        role: "user",
        parts: [
          { inlineData: image },
          { text: `Store: ${args.store}\nProduct: ${args.productTitle}` },
        ],
      },
    ],
    generationConfig: {
      temperature: 0.4,
      maxOutputTokens: 200,
      responseMimeType: "application/json",
      responseSchema: { type: "OBJECT", properties: { alt: { type: "STRING" } }, required: ["alt"] },
    },
  });
  const alt = truncate(clean(out?.alt).replace(/^(an? )?(image|picture|photo) of /i, ""), ALT_MAX);
  if (!alt) throw new AiError("The AI didn't return any text. Try again.");
  return alt.charAt(0).toUpperCase() + alt.slice(1);
}
