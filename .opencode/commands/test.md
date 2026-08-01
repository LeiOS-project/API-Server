---
description: Run the Bun test suite
agent: build
---
Run the most appropriate test command for this repository.

If the current task points to a specific test file, prefer `bun test <file>`.
Otherwise run `bun test`.

Keep in mind this repo's tests are integration-heavy: `bunfig.toml` preloads `tests/helpers/preload.ts`, starts the Hono API on port `12151` and Aptly on a random free dynamic port, and may need host tools like `dpkg` and `unzip`.
Summarize any failures with the exact command that was run.
