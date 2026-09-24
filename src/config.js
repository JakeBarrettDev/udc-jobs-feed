// All source-specific settings live here.
export const config = {
  // UDC's numeric LinkedIn company ID. Find it by opening UDC's LinkedIn
  // company page → Jobs → "See all jobs"; the URL contains f_C=<id>.
  // Can be overridden with the LINKEDIN_COMPANY_ID environment variable.
  linkedinCompanyId: process.env.LINKEDIN_COMPANY_ID || "3288198" // UDC - Ultra Defense Corp,

  // Public page used for the "View all current openings" fallback link.
  companyJobsUrl: "https://www.linkedin.com/company/udc-usa/jobs/",

  // LinkedIn's public (logged-out) job search results. This is the same
  // endpoint the public jobs page uses to load results; no login needed.
  // geoId 92000000 = Worldwide, so results aren't limited by the runner's IP location.
  sourceUrl: (companyId, start) =>
    `https://www.linkedin.com/jobs-guest/jobs/api/seeMoreJobPostings/search?f_C=${companyId}&geoId=92000000&start=${start}`,

  pageSize: 10,
  maxPages: 10, // hard cap: 100 jobs is plenty for UDC
  delayBetweenPagesMs: 2000,

  allowedJobHosts: ["linkedin.com"],

  outputPath: "public/jobs.js",
};

// Everything that depends on LinkedIn's markup is here. If LinkedIn changes
// its HTML, this is the only place that should need editing.
export const selectors = {
  // Each job card is a <li> in the results fragment.
  listing: /<li[\s>][\s\S]*?<\/li>/g,
  // Stable job ID; used to build a clean canonical URL.
  jobId: /data-entity-urn="urn:li:jobPosting:(\d+)"/,
  title: /<h3[^>]*class="[^"]*base-search-card__title[^"]*"[^>]*>([\s\S]*?)<\/h3>/,
  link: /<a[^>]*class="[^"]*base-card__full-link[^"]*"[^>]*href="([^"]+)"/,
  location: /<span[^>]*class="[^"]*job-search-card__location[^"]*"[^>]*>([\s\S]*?)<\/span>/,
};
