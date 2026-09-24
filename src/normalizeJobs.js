import { config } from "./config.js";

const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

export function decodeEntities(text) {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, code) => {
    if (code[0] === "#") {
      const n = code[1].toLowerCase() === "x" ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return Number.isFinite(n) ? String.fromCodePoint(n) : match;
    }
    return ENTITIES[code.toLowerCase()] ?? match;
  });
}

export function cleanText(text) {
  if (typeof text !== "string") return "";
  return decodeEntities(text.replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim();
}

export function isAllowedJobUrl(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return false;
  const host = parsed.hostname.toLowerCase();
  return config.allowedJobHosts.some((allowed) => host === allowed || host.endsWith("." + allowed));
}

// Strips query strings and fragments (LinkedIn tracking params) from a job URL.
export function canonicalUrl(url) {
  const parsed = new URL(url);
  parsed.protocol = "https:";
  parsed.search = "";
  parsed.hash = "";
  return parsed.toString();
}

// Cleans, validates, dedupes, and sorts raw scraped jobs.
export function normalizeJobs(rawJobs) {
  const byUrl = new Map();
  const seenTitles = new Set();

  for (const raw of rawJobs) {
    const title = cleanText(raw.title);
    const rawUrl = cleanText(raw.url);
    if (!title || !isAllowedJobUrl(rawUrl)) continue;

    const url = canonicalUrl(rawUrl);
    const location = cleanText(raw.location);

    // Dedupe by canonical URL first, then by title+location as a fallback.
    const titleKey = `${title.toLowerCase()}|${location.toLowerCase()}`;
    if (byUrl.has(url) || seenTitles.has(titleKey)) continue;
    seenTitles.add(titleKey);

    const job = { title, url };
    if (location) job.location = location;
    byUrl.set(url, job);
  }

  return [...byUrl.values()].sort(
    (a, b) =>
      a.title.localeCompare(b.title, "en") ||
      (a.location || "").localeCompare(b.location || "", "en") ||
      a.url.localeCompare(b.url)
  );
}
