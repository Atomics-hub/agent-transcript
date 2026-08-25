# Contributing

Every conformance change must include a sanitized provider fixture or a minimal canonical graph. Remove keys, prompts, personal data, and proprietary content.

Repairs must be deterministic and semantics-preserving. If evidence is ambiguous, emit a diagnostic instead of guessing.

```bash
npm ci
npm run verify
```
