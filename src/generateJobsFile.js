import fs from "node:fs";
import vm from "node:vm";

// Serializes jobs as JavaScript. JSON is valid JS; we additionally escape
// characters that could break out of a <script> tag, and all non-ASCII so the
// file renders correctly no matter what charset the browser assumes.
export function generateJobsFile(jobs, generatedAt = new Date()) {
  const json = JSON.stringify(jobs, null, 2).replace(
    /[<>&]|[^\x00-\x7e]/g,
    (c) => "\\u" + c.charCodeAt(0).toString(16).padStart(4, "0")
  );

  return `// Generated automatically by the UDC jobs feed on ${generatedAt.toISOString()}. Do not edit by hand.
window.UDC_JOBS = ${json};
`;
}

// Reads the job list out of an existing jobs.js. Returns null if missing or unreadable.
export function readJobsFile(path) {
  if (!fs.existsSync(path)) return null;
  try {
    const sandbox = { window: {} };
    vm.runInNewContext(fs.readFileSync(path, "utf8"), sandbox, { timeout: 1000 });
    // JSON round-trip turns the sandbox objects into plain local data.
    return Array.isArray(sandbox.window.UDC_JOBS) ? JSON.parse(JSON.stringify(sandbox.window.UDC_JOBS)) : null;
  } catch {
    return null;
  }
}
