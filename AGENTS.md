# Repository Guidelines

## Project Structure & Modules
- `desktop/electron/` — Electron main/preload, IPC handlers, OpenClaw stream adapter.
- `front_end/` — React + Vite renderer (`src/`, `tests/`, `package.json`).
- `docs/` — current plans and architecture notes (historical docs are in `docs/archive/`).
- Root `package.json` — desktop scripts and packaging (`electron-builder`).

## Build, Test, and Run
- Install deps:
  - Root: `npm install`
  - Frontend: `cd front_end && npm install`
- Desktop dev:
  - `npm run desktop:dev`
- Build desktop package:
  - `npm run desktop:build`
- Tests:
  - Desktop main-process tests: `npm run test:desktop`
  - Frontend tests: `npm run test:frontend`
  - Frontend lint: `cd front_end && npm run lint`

## Coding Style & Naming
- JavaScript/React: prefer clear module boundaries and descriptive names.
- Keep security-sensitive logic in Electron main process, not renderer.
- Keep preload API minimal and explicit.

## Testing Guidelines
- Frameworks:
  - Desktop: Node built-in `node:test`
  - Frontend: `vitest`
- Focus regression tests on:
  - IPC stream event mapping (`text-delta/done/error`)
  - stream abort behavior
  - settings persistence and token handling
  - SSE parsing robustness

## Commit & PR Guidelines
- Conventional commit style: `feat:`, `fix:`, `test:`, `chore:`.
- PR should include:
  - Scope and rationale
  - User-visible behavior changes
  - Tests run and results

## Security & Config
- OpenClaw token should be managed in Electron main process and stored via system keychain when available.
- Do not expose token to renderer over preload APIs.
- Keep `contextIsolation: true` and `sandbox: true` for BrowserWindow.
