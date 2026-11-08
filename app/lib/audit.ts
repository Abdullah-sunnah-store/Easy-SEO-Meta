// SEO checks and scoring. Client-safe: the dashboard shows the same labels.
import { DESCRIPTION_MAX, TITLE_MAX, type Resource } from "./templates";

export type IssueCode =
  | "title_missing"
  | "title_long"
  | "title_short"
  | "desc_missing"
  | "desc_long"
  | "desc_short"
  | "dup_title"
  | "dup_desc"
  | "alt_missing"
  | "thin_content"
  | "handle_long"
  | "broken_links";

export const ISSUES: Record<IssueCode, { label: string; weight: number; fix: string; severity: "critical" | "warning" }> = {
  title_missing: { label: "No custom SEO title", weight: 10, severity: "warning", fix: "Write a title, or apply a template in Meta tags." },
  title_long: { label: `SEO title over ${TITLE_MAX} characters`, weight: 10, severity: "warning", fix: "Shorten it so search results don't cut it off." },
  title_short: { label: "SEO title under 20 characters", weight: 5, severity: "warning", fix: "Add a keyword or your store name." },
  desc_missing: { label: "No meta description", weight: 15, severity: "critical", fix: "Write one, or apply a template in Meta tags." },
  desc_long: { label: `Meta description over ${DESCRIPTION_MAX} characters`, weight: 5, severity: "warning", fix: "Shorten it so it isn't cut off." },
  desc_short: { label: "Meta description under 70 characters", weight: 5, severity: "warning", fix: "Describe it in a full sentence." },
  dup_title: { label: "Same SEO title as another page", weight: 10, severity: "warning", fix: "Make each title unique." },
  dup_desc: { label: "Same meta description as another page", weight: 10, severity: "warning", fix: "Make each description unique." },
  alt_missing: { label: "Images without alt text", weight: 15, severity: "critical", fix: "Add alt text in Image alt text." },
  thin_content: { label: "Very short description (under 250 characters)", weight: 10, severity: "warning", fix: "Add a fuller description — search engines rank thin pages lower." },
  handle_long: { label: "URL handle over 60 characters", weight: 5, severity: "warning", fix: "Shorten the URL in Shopify (the app adds a 301 if auto-redirects are on)." },
  broken_links: { label: "Links to pages that don't exist", weight: 10, severity: "critical", fix: "Fix the links, or add redirects in Redirects." },
};

export type ItemFacts = {
  resource: Resource;
  title: string;
  handle: string;
  seoTitle: string;
  seoDescription: string;
  imageCount: number;
  missingAlt: number;
  bodyLength: number;
};

/** Issues that depend on the item alone (duplicates and broken links are added at finalize). */
export function itemIssues(f: ItemFacts): IssueCode[] {
  const out: IssueCode[] = [];
  const title = f.seoTitle.trim() || f.title.trim();
  if (!f.seoTitle.trim()) out.push("title_missing");
  if (title.length > TITLE_MAX) out.push("title_long");
  else if (title.length < 20) out.push("title_short");
  const desc = f.seoDescription.trim();
  if (!desc) out.push("desc_missing");
  else if (desc.length > DESCRIPTION_MAX) out.push("desc_long");
  else if (desc.length < 70) out.push("desc_short");
  if (f.missingAlt > 0) out.push("alt_missing");
  if (f.bodyLength < 250) out.push("thin_content");
  if (f.handle.length > 60) out.push("handle_long");
  return out;
}

export function scoreFor(issues: IssueCode[]): number {
  const lost = issues.reduce((sum, code) => sum + (ISSUES[code]?.weight ?? 0), 0);
  return Math.max(0, 100 - lost);
}

export function parseIssues(raw: string | null | undefined): IssueCode[] {
  try {
    const v = JSON.parse(raw || "[]");
    return Array.isArray(v) ? v.filter((c): c is IssueCode => c in ISSUES) : [];
  } catch {
    return [];
  }
}

export function scoreTone(score: number): "success" | "warning" | "critical" {
  return score >= 80 ? "success" : score >= 50 ? "warning" : "critical";
}
