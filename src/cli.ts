#!/usr/bin/env node
import { Buffer } from "node:buffer";
import { readFile } from "node:fs/promises";
import process from "node:process";
import {
  fromAISDKModelMessages,
  fromAnthropicMessages,
  fromGeminiContents,
  fromOpenAIChatMessages,
} from "./adapters.js";
import { auditTranscript } from "./audit.js";
import type { TranscriptAdapterResult, TranscriptTarget } from "./types.js";

const HELP = `agent-transcript audit <file|-> [options]

Audit a replayable AI conversation history.

Options:
  --format canonical|openai|anthropic|gemini|ai-sdk
  --target generic|openai-chat|openai-responses|anthropic|gemini|gemini-thinking|vertex-gemini
  --repair safe    Apply only deterministic repairs
  --max-bytes N    Limit input size (default: 67108864)
  --json           Print the full result
  --help           Show this help
  --version        Show the installed version
`;

async function readInput(path: string, maxBytes: number): Promise<string> {
  if (path !== "-") {
    const value = await readFile(path);
    if (value.byteLength > maxBytes) {
      throw new Error(`Input exceeds the ${String(maxBytes)}-byte limit`);
    }
    return value.toString("utf8");
  }
  process.stdin.setEncoding("utf8");
  let result = "";
  let bytes = 0;
  for await (const chunk of process.stdin) {
    const text = String(chunk);
    bytes += Buffer.byteLength(text);
    if (bytes > maxBytes) {
      throw new Error(`Input exceeds the ${String(maxBytes)}-byte limit`);
    }
    result += text;
  }
  return result;
}

function option(args: readonly string[], name: string): string | undefined {
  const index = args.indexOf(name);
  return index === -1 ? undefined : args[index + 1];
}

function adapt(format: string, value: unknown): TranscriptAdapterResult {
  if (format === "openai") return fromOpenAIChatMessages(value);
  if (format === "anthropic") return fromAnthropicMessages(value);
  if (format === "gemini") return fromGeminiContents(value);
  if (format === "ai-sdk") return fromAISDKModelMessages(value);
  if (format === "canonical")
    return { messages: value as never, diagnostics: [] };
  throw new Error(`Unsupported --format ${JSON.stringify(format)}`);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.length === 0 || args.includes("--help")) {
    process.stdout.write(HELP);
    return;
  }
  if (args.includes("--version")) {
    const packageJson = JSON.parse(
      await readFile(new URL("../package.json", import.meta.url), "utf8"),
    ) as { version: string };
    process.stdout.write(`${packageJson.version}\n`);
    return;
  }
  if (args[0] !== "audit" || args[1] === undefined) {
    throw new Error("Expected: agent-transcript audit <file|->");
  }
  const format = option(args, "--format") ?? "canonical";
  const target = (option(args, "--target") ?? "generic") as TranscriptTarget;
  const repair = option(args, "--repair");
  if (repair !== undefined && repair !== "safe") {
    throw new Error("--repair only accepts safe");
  }
  const maxBytes = Number(option(args, "--max-bytes") ?? "67108864");
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) {
    throw new Error("--max-bytes must be a positive safe integer");
  }
  const adapted = adapt(
    format,
    JSON.parse(await readInput(args[1], maxBytes)) as unknown,
  );
  const audited = auditTranscript(adapted.messages, {
    target,
    ...(repair === "safe" ? { repair: "safe" } : {}),
  });
  const result = {
    ...audited,
    diagnostics: [...adapted.diagnostics, ...audited.diagnostics],
  };
  if (args.includes("--json")) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } else {
    process.stdout.write(
      `${result.replayable ? "replayable" : "not replayable"}: ${String(result.diagnostics.length)} diagnostics\n`,
    );
    for (const item of result.diagnostics) {
      process.stdout.write(
        `${item.severity.toUpperCase()} ${item.code} ${item.path}: ${item.message}${item.repaired ? " [repaired]" : ""}\n`,
      );
    }
  }
  process.exitCode = result.replayable ? 0 : 1;
}

main().catch((error: unknown) => {
  process.stderr.write(
    `${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exitCode = 2;
});
