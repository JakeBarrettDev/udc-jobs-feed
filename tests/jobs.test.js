import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import vm from "node:vm";
import { cleanText, isAllowedJobUrl, normalizeJobs } from "../src/normalizeJobs.js";
import { generateJobsFile, readJobsFile } from "../src/generateJobsFile.js";
import { parseListings, detectBlock } from "../src/scrapeJobs.js";

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
