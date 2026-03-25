# Lancor Search OS

Executive recruiting workflow tool for Lancor Partners LLC. Local Node.js + vanilla browser SPA.

## Quick Start

```bash
npm install
npm start        # starts Express server on port 3000
```

Requires a `.env` file in the project root with API keys (not committed to git).

## Architecture

- **Server:** Express.js (`server/server.js`) on port 3000
- **Client:** Vanilla HTML/CSS/JS SPA (`client/`)
- **Data:** JSON flat files in `data/` (the canonical data store — no database)
- **Routes:** `server/routes/` — one file per domain (candidates, companies, playbooks, searches, templates)
- **Scripts:** `scripts/` — one-off import/seed utilities

## Key Conventions

- All data is persisted as JSON files in `data/`. Read/write them via `fs` in route handlers.
- `data_files/` contains reference copies or staging files; `data/` is the live data directory.
- The `DATA_PATH` env var (defaults to `./data`) controls where the server reads/writes JSON.
- No build step — client files are served as static assets.
- No test framework currently in use.
- Uses the Anthropic SDK (`@anthropic-ai/sdk`) for AI-powered features.

## Working with the Codebase

- When editing routes, follow the existing pattern in `server/routes/`.
- When editing the frontend, the main app logic is in `client/js/app.js`.
- Data schema defaults are defined inline in `server/server.js` (the startup seed block).
- Do not restructure the folder layout without discussion — the user is not a software engineer and maintains this via Claude Code.

## Branch Strategy

- `main` — stable branch
- `v1.5` — current working branch
