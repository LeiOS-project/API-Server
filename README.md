# API Server

## Development

Install dependencies:

```bash
bun install
```

Run the development server:

```bash
bun run dev
```

Start the server with auto-migrations enabled:

```bash
bun run start
```

Typecheck the project:

```bash
bun run typecheck
```

Run tests:

```bash
bun test
```

## OpenCode

This repo includes project-level OpenCode config in `opencode.json` plus repo-specific commands in `.opencode/commands/`.

Useful commands inside OpenCode:

- `/typecheck` runs `bun run typecheck`
- `/test` runs the most appropriate Bun test command
- `/verify` runs typecheck first, then focused or full tests

Project-specific OpenCode guidance lives in `AGENTS.md`.
