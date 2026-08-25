# Conformance corpus

The regression corpus is derived from public provider and framework failures, then reduced to synthetic payloads with no user data. Links document the behavioral evidence; the project does not copy private transcripts or provider fixtures.

| Failure class                           | Public evidence                                                                 | Invariant                                                                                                             |
| --------------------------------------- | ------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| Cross-surface thought signatures        | [Vercel AI #14196](https://github.com/vercel/ai/issues/14196)                   | Signed reasoning metadata retains provider-surface provenance and is rejected before unsafe failover replay.          |
| Malformed replayed tool input           | [Vercel AI #19274](https://github.com/vercel/ai/issues/19274)                   | Non-object tool arguments are diagnosed; safe repair emits an object rather than double-encoded malformed JSON.       |
| Orphaned nested caller                  | [Vercel AI #12504](https://github.com/vercel/ai/issues/12504)                   | Pruning cannot retain a child tool call while removing the provider tool referenced by its caller metadata.           |
| Reasoning lost across tool steps        | [Vercel AI #11602](https://github.com/vercel/ai/issues/11602)                   | Replay-critical reasoning blocks remain attached to the turn that produced them.                                      |
| Parallel Gemini calls split into turns  | [Google GenAI #1275](https://github.com/googleapis/js-genai/issues/1275)        | Parallel calls from one model response remain in one model content; only the first call may carry the step signature. |
| Poisoned/recent Gemini signatures       | [Google GenAI #1769](https://github.com/googleapis/js-genai/issues/1769)        | Signatures are treated as replay-sensitive metadata rather than inert strings.                                        |
| Reasoning dropped from provider history | [LangChain.js #10883](https://github.com/langchain-ai/langchainjs/issues/10883) | Required reasoning content cannot disappear between an assistant call and the next provider request.                  |
| Malformed thinking blocks on replay     | [LangChain.js #10744](https://github.com/langchain-ai/langchainjs/issues/10744) | Thinking blocks are structurally audited before multi-turn replay.                                                    |
| Tool-only assistant turn dropped        | [LangChain.js #10502](https://github.com/langchain-ai/langchainjs/issues/10502) | An assistant turn containing calls but no text remains substantive.                                                   |

Every new failure class should add a minimal test that proves both the bad graph and the expected diagnostic or deterministic repair.
