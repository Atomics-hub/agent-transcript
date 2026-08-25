import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import process from "node:process";
import { URL } from "node:url";
import { gzipSync } from "node:zlib";

const core = readFileSync(new URL("../dist/index.js", import.meta.url), "utf8");
const adapters = readFileSync(
  new URL("../dist/adapters.js", import.meta.url),
  "utf8",
);
assert.doesNotMatch(core, /(?:node:|process\.|Buffer\b)/u);
assert.doesNotMatch(adapters, /(?:node:|process\.|Buffer\b)/u);
assert.ok(gzipSync(core).byteLength < 6_000);
assert.ok(gzipSync(adapters).byteLength < 5_000);

const api = await import(new URL("../dist/index.js", import.meta.url));
const ids = Array.from(
  { length: 1_000 },
  (_, index) => `call-${String(index)}`,
);
const result = api.auditTranscript([
  {
    role: "assistant",
    parts: ids.map((id) => ({ type: "tool-call", id, name: "go", input: {} })),
  },
  {
    role: "tool",
    parts: ids.map((id) => ({
      type: "tool-result",
      toolCallId: id,
      output: null,
    })),
  },
]);
assert.equal(result.replayable, true);
process.stdout.write(
  `Browser boundary, bundle budgets, and ${String(ids.length)}-call graph passed.\n`,
);
