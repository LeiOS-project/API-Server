---
description: Typecheck and run relevant tests
agent: build
---
Verify the current work in this repository.

1. Run `bun run typecheck` first.
2. Then run the smallest relevant `bun test <file>` command if a focused test target is obvious from the current changes.
3. If no focused target is obvious, run `bun test`.

Do not stop at the first failure. Summarize what passed, what failed, and the next fix to make.
