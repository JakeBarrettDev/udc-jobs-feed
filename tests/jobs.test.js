import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import vm from "node:vm";
import { cleanText, isAllowedJobUrl, normalizeJobs } from "../src/normalizeJobs.js";
import { generateJobsFile, readJobsFile } from "../src/generateJobsFile.js";
import { parseListings, detectBlock, fetchPage } from "../src/scrapeJobs.js";
import { config } from "../src/config.js";

const fixture = fs.readFileSync(new URL("./fixtures/linkedin-page.html", import.meta.url), "utf8");

function evalJobsFile(source) {
  const sandbox = { window: {} };
  vm.runInNewContext(source, sandbox);
  return JSON.parse(JSON.stringify(sandbox.window.UDC_JOBS));
}

test("normalizes whitespace", () => {
  assert.equal(cleanText("  Project   Manager  "), "Project Manager");
});

test("decodes HTML entities", () => {
  assert.equal(cleanText("A &amp; B &#39;C&#39; &quot;D&quot;"), `A & B 'C' "D"`);
});

test("duplicate URLs produce one job", () => {
  const jobs = normalizeJobs([
    { title: "Superintendent", url: "https://www.linkedin.com/jobs/view/1?trk=a" },
    { title: "Superintendent", url: "https://www.linkedin.com/jobs/view/1?trk=b" },
    { title: "Foreman", url: "https://www.linkedin.com/jobs/view/1" },
  ]);
  assert.equal(jobs.length, 1);
  assert.equal(jobs[0].url, "https://www.linkedin.com/jobs/view/1");
});

test("sorts alphabetically by title", () => {
  const jobs = normalizeJobs([
    { title: "Superintendent", url: "https://www.linkedin.com/jobs/view/2" },
    { title: "Estimator", url: "https://www.linkedin.com/jobs/view/1" },
  ]);
  assert.deepEqual(jobs.map((j) => j.title), ["Estimator", "Superintendent"]);
});

test("URL validation rejects dangerous schemes and unknown hosts", () => {
  for (const bad of ["javascript:alert(1)", "data:text/html,hi", "file:///etc/passwd", "https://evil.example.com/jobs/1", "not a url"]) {
    assert.equal(isAllowedJobUrl(bad), false, bad);
  }
  assert.equal(isAllowedJobUrl("https://www.linkedin.com/jobs/view/1"), true);
  assert.equal(isAllowedJobUrl("http://www.linkedin.com/jobs/view/1"), true);
});

test("invalid URLs are dropped during normalization", () => {
  const jobs = normalizeJobs([{ title: "Bad", url: "javascript:alert(1)" }]);
  assert.equal(jobs.length, 0);
});

test("parses LinkedIn job cards", () => {
  const jobs = normalizeJobs(parseListings(fixture));
  assert.deepEqual(jobs, [
    { title: "Project Manager & Estimator 'Lead'", url: "https://www.linkedin.com/jobs/view/2222222222" },
    { title: "Superintendent", url: "https://www.linkedin.com/jobs/view/1111111111", location: "Kansas City, MO" },
  ]);
});

test("detects blocks and login walls", () => {
  assert.ok(detectBlock(999, ""));
  assert.ok(detectBlock(429, ""));
  assert.ok(detectBlock(200, '<a href="https://www.linkedin.com/authwall?x">'));
  assert.equal(detectBlock(200, fixture), null);
});

test("generated jobs.js parses and round-trips", () => {
  const jobs = [
    { title: `He said "hi" </script><script>alert(1)</script>`, url: "https://www.linkedin.com/jobs/view/1" },
    { title: "Line Sep São Paulo 😀", url: "https://www.linkedin.com/jobs/view/2" },
  ];
  const source = generateJobsFile(jobs);
  assert.match(source, /window\.UDC_JOBS = /);
  assert.doesNotMatch(source, /<\/script>/i);
  assert.match(source, /^[\x00-\x7e]*$/, "output should be pure ASCII");
  assert.deepEqual(evalJobsFile(source), jobs);
});

test("generated output is deterministic", () => {
  const input = [
    { title: "B", url: "https://www.linkedin.com/jobs/view/2" },
    { title: "A", url: "https://www.linkedin.com/jobs/view/1" },
  ];
  const date = new Date("2026-01-01T00:00:00Z");
  assert.equal(
    generateJobsFile(normalizeJobs(input), date),
    generateJobsFile(normalizeJobs([...input].reverse()), date)
  );
});

test("readJobsFile reads back what generateJobsFile wrote", () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "udc-")), "jobs.js");
  const jobs = [{ title: "A", url: "https://www.linkedin.com/jobs/view/1" }];
  fs.writeFileSync(file, generateJobsFile(jobs));
  assert.deepEqual(readJobsFile(file), jobs);
  assert.equal(readJobsFile(file + ".missing"), null);
});

// Replaces global fetch with a scripted sequence of responses (and makes
// retries instant); returns the call log. Uses a plain object rather than
// Response because Response rejects LinkedIn's non-standard 999 status.
function stubFetch(t, responses) {
  const calls = [];
  const realFetch = globalThis.fetch;
  const savedDelay = config.retryDelayMs;
  config.retryDelayMs = 0;
  t.mock.method(console, "log", () => {});
  globalThis.fetch = async (url) => {
    calls.push(url);
    const next = responses.shift();
    if (next instanceof Error) throw next;
    return { status: next.status, url, headers: new Headers(next.headers), text: async () => next.body ?? "" };
  };
  t.after(() => {
    globalThis.fetch = realFetch;
    config.retryDelayMs = savedDelay;
  });
  return calls;
}

test("retries once after a 429, then succeeds", async (t) => {
  const calls = stubFetch(t, [{ status: 429 }, { status: 200, body: fixture }]);
  const page = await fetchPage("123", 0);
  assert.equal(calls.length, 2);
  assert.equal(page.status, 200);
});

test("retries network errors once, then gives up", async (t) => {
  const calls = stubFetch(t, [new Error("ECONNRESET"), new Error("ECONNRESET")]);
  await assert.rejects(fetchPage("123", 0), /network error/);
  assert.equal(calls.length, 2);
});

test("does not retry a bot block (999)", async (t) => {
  const calls = stubFetch(t, [{ status: 999 }]);
  const page = await fetchPage("123", 0);
  assert.equal(calls.length, 1);
  assert.equal(page.status, 999);
});

test("gives up after one retry if still rate limited", async (t) => {
  const calls = stubFetch(t, [{ status: 429 }, { status: 429 }]);
  const page = await fetchPage("123", 0);
  assert.equal(calls.length, 2);
  assert.equal(page.status, 429); // scrapeJobs turns this into a failure via detectBlock
});
