import { runSearch } from "./live.js?v=7";

const chunks = [];
for await (const chunk of process.stdin) chunks.push(chunk);
const raw = Buffer.concat(chunks).toString("utf8").trim();
let request = {};
try {
  request = raw ? JSON.parse(raw) : {};
} catch {
  process.stderr.write("bad request\n");
  process.exit(1);
}

try {
  const result = await runSearch({
    prompt: request.prompt ?? "",
    filters: request.filters ?? {},
    previousMode: request.mode ?? "cheap",
    modeOverride: request.modeOverride ?? null,
    env: process.env,
    fetchImpl: globalThis.fetch,
  });
  process.stdout.write(JSON.stringify(result));
} catch {
  process.stderr.write("search failed\n");
  process.exit(1);
}
