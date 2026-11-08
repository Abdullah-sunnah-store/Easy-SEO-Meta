// "path,target" CSV for redirect import. Client-safe so the page can preview.

export type RedirectRow = { path: string; target: string; line: number; error?: string };

function splitLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') { cur += '"'; i += 1; }
      else if (ch === '"') quoted = false;
      else cur += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === "," || ch === ";" || ch === "\t") { out.push(cur); cur = ""; }
    else cur += ch;
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

/** Paths must start with "/"; targets may be a path or an absolute URL. */
export function parseRedirectCsv(text: string, max = 5000): RedirectRow[] {
  const rows: RedirectRow[] = [];
  const lines = text.replace(/^﻿/, "").split(/\r?\n/);
  lines.forEach((line, index) => {
    if (!line.trim() || rows.length >= max) return;
    const [path = "", target = ""] = splitLine(line);
    if (index === 0 && /^(redirect\s*from|path|from|old)/i.test(path)) return; // header
    const row: RedirectRow = { path, target, line: index + 1 };
    if (!path.startsWith("/")) row.error = "Path must start with /";
    else if (!target) row.error = "Missing target";
    else if (!target.startsWith("/") && !/^https?:\/\//i.test(target)) row.error = "Target must be a path or http(s) URL";
    else if (path === target) row.error = "Path and target are the same";
    rows.push(row);
  });
  return rows;
}
