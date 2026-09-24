import fs from "node:fs";
import { pathToFileURL } from "node:url";
import { config, selectors } from "./config.js";
import { normalizeJobs } from "./normalizeJobs.js";
import { generateJobsFile, readJobsFile } from "./generateJobsFile.js";

const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36";

class ScrapeError extends Error {}

// Extracts raw { title, url, location } objects from one page of results.
export function parseListings(html) {
  const jobs = [];
  for (const [card] of html.matchAll(selectors.listing)) {
    const id = card.match(selectors.jobId)?.[1];
    const title = card.match(selectors.title)?.[1];
    const href = card.match(selectors.link)?.[1];
    const location = card.match(selectors.location)?.[1];

    // Prefer the stable job ID for a clean URL; fall back to the card's link.
    const url = id ? `https://www.linkedin.com/jobs/view/${id}` : href;
    if (title && url) jobs.push({ title, url, location });
  }
  return jobs;
}

// Returns a reason string if the response looks like a block/login wall, else null.
export function detectBlock(status, html) {
  if (status === 999) return "LinkedIn returned status 999 (request blocked as a bot)";
  if (status === 429) return "LinkedIn returned 429 (rate limited)";
  if (status === 401 || status === 403) return `LinkedIn returned ${status} (access denied)`;
  if (/authwall|checkpoint\/challenge|captcha|uas\/login/i.test(html)) {
    return "Response looks like a login wall or bot challenge";
  }
  return null;
}

async function fetchPage(companyId, start) {
  let response;
  try {
    response = await fetch(config.sourceUrl(companyId, start), {
      headers: { "User-Agent": USER_AGENT, "Accept-Language": "en-US,en;q=0.9" },
      redirect: "follow",
      signal: AbortSignal.timeout(30_000),
    });
  } catch (err) {
    throw new ScrapeError(`Could not load jobs source (network error: ${err.message})`);
  }
  const html = await response.text();
  return { status: response.status, html, finalUrl: response.url };
}

export async function scrapeJobs(companyId) {
  const all = [];

  for (let page = 0; page < config.maxPages; page++) {
    const start = page * config.pageSize;
    const { status, html, finalUrl } = await fetchPage(companyId, start);

    const blocked = detectBlock(status, html) || (/login|authwall/.test(finalUrl) ? `Redirected to ${finalUrl}` : null);
    if (blocked) throw new ScrapeError(blocked);

    // LinkedIn answers 400 with an empty body once you page past the last result.
    if (status === 400 && page > 0) break;
    if (status !== 200) throw new ScrapeError(`Unexpected HTTP ${status} loading page ${page + 1}`);

    const listings = parseListings(html);
    const looksLikeCards = /<li[\s>]/.test(html) || html.includes("jobPosting:");
    if (listings.length === 0 && looksLikeCards) {
      throw new ScrapeError(
        `Page ${page + 1} contains job cards but none could be parsed. LinkedIn's markup probably changed; update selectors in src/config.js.`
      );
    }

    all.push(...listings);
    if (listings.length < config.pageSize) break;
    await new Promise((resolve) => setTimeout(resolve, config.delayBetweenPagesMs));
  }

  return all;
}

function summarizeChanges(previous, next) {
  const prevUrls = new Set(previous.map((j) => j.url));
  const nextUrls = new Set(next.map((j) => j.url));
  const added = next.filter((j) => !prevUrls.has(j.url));
  const removed = previous.filter((j) => !nextUrls.has(j.url));
  for (const j of added) console.log(`  + ${j.title}`);
  for (const j of removed) console.log(`  - ${j.title}`);
}

async function main() {
  const companyId = config.linkedinCompanyId;
  if (!/^\d+$/.test(companyId)) {
    throw new ScrapeError("linkedinCompanyId is not set in src/config.js (or LINKEDIN_COMPANY_ID).");
  }

  console.log(`Loading jobs source (LinkedIn company ${companyId})…`);
  const raw = await scrapeJobs(companyId);
  console.log(`Found ${raw.length} candidate listings.`);

  const jobs = normalizeJobs(raw);
  console.log(`Normalized ${jobs.length} unique jobs.`);

  const previous = readJobsFile(config.outputPath);
  console.log(previous ? `Previous feed contained ${previous.length} jobs.` : "No previous feed found.");

  // Safety rule: never replace a non-empty feed with an empty one unless explicitly allowed.
  if (previous?.length > 0 && jobs.length === 0 && process.env.ALLOW_EMPTY !== "true") {
    throw new ScrapeError(
      "Scrape returned 0 jobs but the previous feed had jobs. Treating as suspicious and keeping the existing feed. " +
        "If UDC truly has no openings, re-run the workflow manually with allow_empty = true."
    );
  }

  if (previous && JSON.stringify(previous) === JSON.stringify(jobs)) {
    console.log("No changes detected.");
    return;
  }

  summarizeChanges(previous || [], jobs);
  fs.writeFileSync(config.outputPath, generateJobsFile(jobs));
  console.log(`Updated ${config.outputPath}.`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(`FAILED: ${err.message}`);
    console.error("Existing feed left unchanged.");
    process.exit(1);
  });
}
