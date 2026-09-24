# UDC Jobs Feed

Keeps the Squarespace **Jobs** page in sync with UDC's current public LinkedIn job openings.

```
GitHub Actions (daily) → fetch LinkedIn's public job listings → public/jobs.js
  → GitHub Pages → Squarespace code block renders the list
```

- There's no database, server, or login. It has no npm dependencies, just Node 20+.
- Each successful run replaces the whole list. Jobs that close disappear and new jobs appear.
- If a run fails (LinkedIn blocks the request, markup changes, or a suspicious empty result), the existing feed stays as it is and the Action run shows as failed. GitHub emails the repo owner about failed scheduled runs.

**Feed URL:** https://jakebarrettdev.github.io/udc-jobs-feed/jobs.js

## Run locally

```bash
npm test             # unit tests
npm run update-jobs  # scrape and regenerate public/jobs.js
```

To try it against a different company without editing config:

```bash
LINKEDIN_COMPANY_ID=1441 npm run update-jobs
```

## Configuration

All source settings are in [`src/config.js`](src/config.js):

| Setting | What it is |
|---|---|
| `linkedinCompanyId` | UDC's numeric LinkedIn company ID. To find it, open UDC's LinkedIn company page → **Jobs** → **See all jobs**. The URL contains `f_C=<id>`. |
| `companyJobsUrl` | The public "all openings" page (reference only; the Squarespace snippet has its own copy). |
| `selectors` | Every pattern that depends on LinkedIn's HTML. |

To switch to a different source later (for example an ATS), change `scrapeJobs()` in `src/scrapeJobs.js` so it returns `{ title, url, location }` objects, and add the ATS hostname to `allowedJobHosts`. The output format and the Squarespace code don't change.

## How it runs

[`.github/workflows/update-jobs.yml`](.github/workflows/update-jobs.yml) runs daily at 12:00 UTC:

1. Runs the tests.
2. Scrapes and regenerates `public/jobs.js`.
3. Commits `public/jobs.js` only if the job list changed (`chore: update UDC jobs feed`).
4. Deploys `public/` to GitHub Pages.

It also re-enables its own workflow on every run. GitHub automatically disables scheduled workflows after 60 days without repo activity, which would happen if the job list stayed the same for two months.

**Run it manually:** in the repo, go to **Actions → Update UDC jobs feed → Run workflow**, or run:

```bash
gh workflow run update-jobs.yml
```

**UDC genuinely has zero openings?** The scraper refuses to replace a non-empty feed with an empty one, because an empty result usually means something broke. Run the workflow manually with **allow_empty** checked. The page will then show "There are currently no listed openings."

## Squarespace

Paste the full contents of [`squarespace-snippet.html`](squarespace-snippet.html) into one **Code Block** on the Jobs page. After that, it never needs editing.

Notes:
- Squarespace only runs JavaScript in Code Blocks on plans that support custom code (Core/Business and up).
- If the feed can't be loaded, the block still shows the "View all current openings on LinkedIn" link.
- GitHub Pages caches files for about 10 minutes. If you ever need to force a refresh, change `jobs.js?v=1` to `?v=2` in the snippet.
- Titles and locations are inserted with `textContent`, never `innerHTML`, and links must be http(s).

## If LinkedIn changes its markup

Symptom: the Action fails with *"contains job cards but none could be parsed"*. The live feed keeps showing the last good list in the meantime.

1. Fetch a page of results and look at a job card:
   ```bash
   curl -s -A "Mozilla/5.0" "https://www.linkedin.com/jobs-guest/jobs/api/seeMoreJobPostings/search?f_C=<UDC_ID>&start=0" | head -80
   ```
2. Update the patterns in `selectors` in `src/config.js`.
3. Update `tests/fixtures/linkedin-page.html` to match the new markup, then run `npm test` and `npm run update-jobs`.

If the Action fails with a **999 / 429 / login wall** error, LinkedIn is blocking the request. This project deliberately doesn't try to get around that (no proxies, cookies, or logins). A single failure usually clears up on the next day's run. If it keeps failing, it's time to move to an ATS or a manually maintained list.
