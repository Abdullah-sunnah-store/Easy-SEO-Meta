// Product image compression, with a backup of every original.
//
// For each image:
//   1. download the original from Shopify's CDN;
//   2. resize to the longest-edge limit and re-encode (same format) with sharp;
//   3. skip it if that saves under 10% — not worth replacing;
//   4. upload the ORIGINAL bytes to the store's Files as a backup;
//   5. upload the compressed bytes and replace the product image in place with
//      fileUpdate(originalSource) — same media id, same URL, so variant images
//      and image order are untouched.
// Restoring points the image back at its backup the same way.
//
// Shopify already serves resized WebP/AVIF to shoppers from the original, so
// this mainly helps oversized uploads (multi-megabyte PNGs, 5000px photos):
// smaller originals, faster image processing, lighter downloads where themes
// use the full-size file.

import sharp from "sharp";
import prisma from "../db.server";
import { gql, userErrorText, type AdminClient, AdminError } from "./admin.server";

import { MIN_BYTES } from "../lib/images";
export { MIN_BYTES };
const MIN_SAVING = 0.1;
const STEP_BUDGET_MS = 18_000;

type StagedTarget = { url: string; resourceUrl: string; parameters: { name: string; value: string }[] };

async function stagedUpload(admin: AdminClient, bytes: Buffer, filename: string, mimeType: string): Promise<string> {
  const data = await gql(admin, `#graphql
    mutation SeoStaged($input: [StagedUploadInput!]!) {
      stagedUploadsCreate(input: $input) {
        stagedTargets { url resourceUrl parameters { name value } }
        userErrors { field message }
      }
    }`, { input: [{ filename, mimeType, resource: "IMAGE", httpMethod: "POST", fileSize: String(bytes.length) }] });
  const err = userErrorText(data?.stagedUploadsCreate?.userErrors);
  if (err) throw new AdminError(err);
  const target: StagedTarget | undefined = data?.stagedUploadsCreate?.stagedTargets?.[0];
  if (!target?.url) throw new AdminError("Shopify did not return an upload target.");
  const form = new FormData();
  for (const p of target.parameters) form.append(p.name, p.value);
  form.append("file", new Blob([new Uint8Array(bytes)], { type: mimeType }), filename);
  const res = await fetch(target.url, { method: "POST", body: form });
  if (!res.ok) throw new AdminError(`Upload to Shopify storage failed (${res.status}).`);
  return target.resourceUrl;
}

async function createBackupFile(admin: AdminClient, resourceUrl: string, filename: string): Promise<string> {
  const data = await gql(admin, `#graphql
    mutation SeoBackup($files: [FileCreateInput!]!) {
      fileCreate(files: $files) { files { id } userErrors { field message } }
    }`, { files: [{ originalSource: resourceUrl, contentType: "IMAGE", filename, alt: "Easy SEO backup — original before compression" }] });
  const err = userErrorText(data?.fileCreate?.userErrors);
  if (err) throw new AdminError(err);
  const id = data?.fileCreate?.files?.[0]?.id;
  if (!id) throw new AdminError("Shopify did not create the backup file.");
  return id;
}

async function replaceImage(admin: AdminClient, mediaId: string, source: string) {
  const data = await gql(admin, `#graphql
    mutation SeoReplace($files: [FileUpdateInput!]!) {
      fileUpdate(files: $files) { files { id } userErrors { field message } }
    }`, { files: [{ id: mediaId, originalSource: source }] });
  const err = userErrorText(data?.fileUpdate?.userErrors);
  if (err) throw new AdminError(err);
}

const MIME: Record<string, string> = { jpeg: "image/jpeg", png: "image/png", webp: "image/webp" };

/** Re-encodes in the same format. Null when the format isn't handled. */
export async function compressBuffer(input: Buffer, maxEdge: number, quality: number) {
  const meta = await sharp(input, { failOn: "none" }).metadata();
  const format = meta.format as string | undefined;
  if (!format || !(format in MIME)) return null;
  let p = sharp(input, { failOn: "none" })
    .rotate()
    .resize({ width: maxEdge, height: maxEdge, fit: "inside", withoutEnlargement: true });
  if (format === "jpeg") p = p.jpeg({ quality, mozjpeg: true });
  else if (format === "png") p = p.png({ compressionLevel: 9, palette: true, quality: Math.min(100, quality + 10), effort: 7 });
  else p = p.webp({ quality });
  const output = await p.toBuffer();
  return { output, format, mime: MIME[format] };
}

function fileNameFrom(url: string, fallback: string) {
  try {
    const name = new URL(url).pathname.split("/").pop() || fallback;
    return decodeURIComponent(name).replace(/[^\w.-]+/g, "-").slice(-80);
  } catch {
    return fallback;
  }
}

/** Images worth compressing that haven't been handled yet, biggest first. */
export async function eligibleImages(shop: string, take = 50) {
  const handled = await prisma.compressedImage.findMany({
    // Failed ones too: a run must not retry the same broken image forever.
    // "Retry failed" on the page clears those records first.
    where: { shop, status: { in: ["compressed", "skipped", "restored", "failed"] } },
    select: { mediaId: true },
  });
  const skip = handled.map((h) => h.mediaId);
  return prisma.auditImage.findMany({
    where: { shop, bytes: { gte: MIN_BYTES }, mediaId: { notIn: skip } },
    orderBy: { bytes: "desc" },
    take,
  });
}

export async function compressOne(
  admin: AdminClient,
  shop: string,
  img: { mediaId: string; productId: string; productTitle: string; url: string; bytes: number },
  opts: { maxEdge: number; quality: number },
): Promise<"compressed" | "skipped" | "failed"> {
  const record = (status: string, data: Record<string, unknown> = {}) =>
    prisma.compressedImage.upsert({
      where: { shop_mediaId: { shop, mediaId: img.mediaId } },
      create: { shop, mediaId: img.mediaId, productId: img.productId, productTitle: img.productTitle, status, ...data },
      update: { status, ...data },
    });
  try {
    const res = await fetch(img.url);
    if (!res.ok) throw new Error(`Couldn't download the image (${res.status}).`);
    const original = Buffer.from(await res.arrayBuffer());
    const result = await compressBuffer(original, opts.maxEdge, opts.quality);
    if (!result) {
      await record("skipped", { originalBytes: original.length, newBytes: original.length, message: "Format not supported (GIF/SVG/other)." });
      return "skipped";
    }
    if (result.output.length > original.length * (1 - MIN_SAVING)) {
      await record("skipped", { originalBytes: original.length, newBytes: result.output.length, message: "Already well optimised." });
      return "skipped";
    }
    const name = fileNameFrom(img.url, `image.${result.format}`);
    const backupSource = await stagedUpload(admin, original, `backup-${name}`, result.mime);
    const backupFileId = await createBackupFile(admin, backupSource, `easy-seo-backup-${name}`);
    const compressedSource = await stagedUpload(admin, result.output, name, result.mime);
    await replaceImage(admin, img.mediaId, compressedSource);
    await record("compressed", { backupFileId, originalBytes: original.length, newBytes: result.output.length, message: "" });
    await prisma.auditImage.updateMany({ where: { shop, mediaId: img.mediaId }, data: { bytes: result.output.length } });
    return "compressed";
  } catch (error: any) {
    await record("failed", { message: String(error?.message || error).slice(0, 400) }).catch(() => undefined);
    return "failed";
  }
}

/** Compresses as many eligible images as fit in one request. */
export async function compressBatch(admin: AdminClient, shop: string, allowance: number) {
  const settings = await prisma.shopSettings.findUnique({ where: { shop } });
  const opts = { maxEdge: settings?.compressMaxEdge ?? 2048, quality: settings?.compressQuality ?? 80 };
  const started = Date.now();
  const counts = { compressed: 0, skipped: 0, failed: 0 };
  let queue = await eligibleImages(shop, 10);
  while (queue.length && counts.compressed < allowance && Date.now() - started < STEP_BUDGET_MS) {
    const img = queue.shift()!;
    counts[await compressOne(admin, shop, img, opts)] += 1;
  }
  queue = await eligibleImages(shop, 1);
  return { ...counts, done: queue.length === 0 || counts.compressed >= allowance };
}

/** Puts the original back from its backup file. */
export async function restoreImage(admin: AdminClient, shop: string, mediaId: string) {
  const row = await prisma.compressedImage.findUnique({ where: { shop_mediaId: { shop, mediaId } } });
  if (!row || row.status !== "compressed" || !row.backupFileId) throw new AdminError("No backup for this image.");
  const data = await gql(admin, `#graphql
    query SeoBackupUrl($id: ID!) { node(id: $id) { ... on MediaImage { fileStatus image { url } } } }`, { id: row.backupFileId });
  const url = data?.node?.image?.url;
  if (!url || data?.node?.fileStatus !== "READY") throw new AdminError("The backup is still processing in Shopify. Try again in a minute.");
  await replaceImage(admin, mediaId, url);
  await prisma.compressedImage.update({ where: { id: row.id }, data: { status: "restored", newBytes: row.originalBytes } });
  await prisma.auditImage.updateMany({ where: { shop, mediaId }, data: { bytes: row.originalBytes } });
}
