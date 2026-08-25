import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";
import { fileURLToPath, URL } from "node:url";

const root = new URL("../", import.meta.url);
const packageJson = JSON.parse(
  readFileSync(new URL("package.json", root), "utf8"),
);
assert.equal(packageJson.dependencies, undefined);
const esm = await import(new URL("dist/index.js", root));
const require = createRequire(import.meta.url);
const cjs = require(fileURLToPath(new URL("dist/index.cjs", root)));
for (const api of [esm, cjs]) {
  const result = api.auditTranscript([
    {
      role: "assistant",
      parts: [{ type: "tool-call", id: "x", name: "go", input: {} }],
    },
    {
      role: "tool",
      parts: [{ type: "tool-result", toolCallId: "x", output: "ok" }],
    },
  ]);
  assert.equal(result.replayable, true);
}

const directory = mkdtempSync(join(tmpdir(), "agent-transcript-"));
const fixture = join(directory, "history.json");
writeFileSync(
  fixture,
  JSON.stringify([
    {
      role: "assistant",
      parts: [{ type: "tool-call", id: "x", name: "go", input: {} }],
    },
    {
      role: "tool",
      parts: [{ type: "tool-result", toolCallId: "x", output: "ok" }],
    },
  ]),
);
const cli = fileURLToPath(new URL("dist/cli.js", root));
assert.match(
  execFileSync(process.execPath, [cli, "--help"], { encoding: "utf8" }),
  /^agent-transcript audit/u,
);
assert.equal(
  execFileSync(process.execPath, [cli, "--version"], {
    encoding: "utf8",
  }).trim(),
  packageJson.version,
);
assert.match(
  execFileSync(process.execPath, [cli, "audit", fixture], { encoding: "utf8" }),
  /^replayable/u,
);

let sizeGuard = false;
try {
  execFileSync(process.execPath, [cli, "audit", fixture, "--max-bytes", "1"], {
    stdio: "pipe",
  });
} catch (error) {
  sizeGuard = error.status === 2 && error.stderr.toString().includes("exceeds");
}
assert.equal(
  sizeGuard,
  true,
  "CLI must reject oversized inputs before parsing",
);

process.stdout.write(
  "ESM, CommonJS, canonical audit, CLI, and metadata verification passed.\n",
);
