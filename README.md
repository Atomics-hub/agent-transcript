# agent-transcript

Audit and safely repair replayable AI agent conversation histories.

```bash
npm install agent-transcript
```

Agent histories are dependency graphs disguised as message arrays. Tool results depend on calls, nested calls depend on their caller, Gemini parallel calls must remain grouped, and signed reasoning metadata may be valid only for the provider surface that created it. Pruning or translating one block incorrectly can permanently brick every continuation.

`agent-transcript` catches those failures before the next provider request.

## Canonical audit

```ts
import { auditTranscript } from "agent-transcript";

const result = auditTranscript(messages, {
  target: "anthropic",
  repair: "safe",
});

if (!result.replayable) {
  console.error(result.diagnostics);
}
```

Canonical messages use a compact provider-neutral graph:

```ts
const messages = [
  {
    role: "assistant",
    parts: [
      {
        type: "tool-call",
        id: "call_weather",
        name: "weather",
        input: { city: "Paris" },
      },
    ],
  },
  {
    role: "tool",
    parts: [
      {
        type: "tool-result",
        toolCallId: "call_weather",
        output: { temperature: 20 },
      },
    ],
  },
];
```

## Provider adapters

Adapters accept `unknown`, structurally inspect provider values, and import no SDK types:

```ts
import { auditTranscript } from "agent-transcript";
import { fromGeminiContents } from "agent-transcript/adapters";

const adapted = fromGeminiContents(contents);
const result = auditTranscript(adapted.messages, {
  target: "gemini-thinking",
});
```

Included adapters:

- OpenAI Chat Completions messages
- Anthropic Messages content blocks
- Gemini `contents`
- Vercel AI SDK `ModelMessage` histories

## What it detects

- Missing, duplicate, and orphaned tool results
- Duplicate tool-call IDs
- Tool name mismatches
- Nested caller references orphaned by pruning
- Malformed non-object tool inputs
- Gemini parallel calls split into separate model turns
- Missing Gemini thought signatures
- Google/Vertex signature provenance mismatches during failover
- Anthropic tool-result block ordering
- Tool results under invalid roles
- Empty assistant messages and content blocks

Diagnostics include a stable code, exact path, severity, related path, and whether a repair was applied.

## Safe repair

`repair: "safe"` performs only deterministic changes:

- Remove empty text blocks
- Normalize malformed/non-object tool inputs to `{}`
- Fill a missing tool-result name from its matching call

It does not invent IDs, signatures, results, caller relationships, or provider metadata. Ambiguous damage remains an error.

## Provider targets

Targets currently include `generic`, `openai-chat`, `openai-responses`, `anthropic`, `gemini`, `gemini-thinking`, and `vertex-gemini`.

Use `gemini-thinking` when thought signatures are required for the selected model. `gemini` preserves and checks signature provenance without requiring a signature for models that do not use them.

## CLI

```bash
npx agent-transcript audit history.json --format ai-sdk --target anthropic
npx agent-transcript audit history.json --format gemini --target gemini-thinking --json
npx agent-transcript audit history.json --repair safe --json
```

Exit code `0` means replayable, `1` means conformance errors remain, and `2` means the invocation or input was invalid.

## Security and limits

This package never executes tools, evaluates content, or contacts a provider. Inputs remain untrusted; consumers must validate tool arguments and authorize tool names before execution. Audits default to 10,000 messages and 100,000 parts; customize `maxMessages` and `maxParts` deliberately. The CLI rejects inputs larger than 64 MiB by default and supports `--max-bytes N`.

## Runtime support

Node.js 18+, browsers, Workers, Bun, and Deno through npm compatibility. ESM and CommonJS. Zero runtime dependencies.

## License

MIT
