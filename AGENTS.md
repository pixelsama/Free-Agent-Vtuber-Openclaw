# Repository Guidelines

## Project Structure & Modules
- `desktop/electron/` — Electron main/preload, IPC handlers, tray/window mode, chat/voice adapters.
  - `main.js` — app bootstrap, BrowserWindow security config, IPC registration, voice/chat bridge hookup.
  - `ipc/chatStream.js` — OpenClaw stream IPC (`chat:stream:start`, `chat:stream:abort`).
  - `ipc/voiceSession.js` — voice session lifecycle/audio commit/TTS flow-control IPC (`voice:*`).
  - `ipc/voiceModels.js` — voice model library IPC (`voice-models:*`).
  - `services/live2dModelLibrary.js` — Live2D ZIP import, model discovery, and custom protocol path resolution.
  - `services/voice/voiceModelCatalog.js` — built-in voice model catalog (sherpa bundle + Python runtime bundle).
  - `services/voice/voiceModelLibrary.js` — model/runtime download, extraction, selection, runtime env mapping.
  - `services/voice/asrService.js`, `ttsService.js` — provider resolution with worker-first execution.
  - `services/voice/asrWorkerClient.js`, `asrWorkerProcess.js` — ASR worker process isolation (Python path).
  - `services/voice/ttsWorkerClient.js`, `ttsWorkerProcess.js` — TTS worker process and chunk ACK backpressure.
  - `services/voice/providers/python/` — Python bridge/bootstrap/resident worker scripts.
  - `ipc/live2dModels.js` — model library IPC (`live2d-models:list`, `live2d-models:import-zip`).
- `front_end/` — React + Vite renderer (`src/`, `tests/`, `package.json`).
  - `src/components/config/VoiceSettingsPanel.jsx` — voice session controls + model catalog install/select UI.
  - `src/hooks/voice/` — VAD, capture, session bridge, and TTS playback handling.
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

## Voice Runtime Notes (Current State)
- Providers currently supported in main process:
  - ASR: `mock`, `sherpa-onnx`, `python`
  - TTS: `mock`, `sherpa-onnx`, `python`
- Worker strategy:
  - ASR Python path prefers `asrWorkerClient` + child process; on worker-level failures, `asrService` falls back to direct provider.
  - TTS non-mock providers run through `ttsWorkerClient` + chunk ACK protocol to avoid uncontrolled buffering.
- Built-in catalog includes:
  - `builtin-zh-int8-zipformer-kokoro-v1`
  - `builtin-python-funasr-qwen3tts-v1` (embedded Python runtime + model bootstrap)
- Runtime env is resolved by `VoiceModelLibrary#getRuntimeEnv(...)` and injected into voice session via `registerVoiceSessionIpc({ resolveVoiceEnv })`.
- Keep event contracts stable for renderer integration:
  - `voice:event` (`state`, `asr-partial`, `asr-final`, `tts-chunk`, `done`, `error`)
  - `voice:flow-control` (`pause` / `resume`)

## Coding Style & Naming
- JavaScript/React: prefer clear module boundaries and descriptive names.
- Keep security-sensitive logic in Electron main process, not renderer.
- Keep preload API minimal and explicit.

## UI Framework Policy
- Current direction: **progressive de-MUI migration**. Treat MUI as legacy dependency in this project.
- Do **not** introduce new MUI components for new UI work unless explicitly required by the user.
- For new UI, prefer local reusable primitives/components with project-owned styles (CSS/CSS variables), optimized for desktop widget/pet-mode visuals.
- When touching existing MUI-heavy areas, migrate incrementally by replacing highest-friction components first (for example: `TextField`, `Button`, `Tabs`, `Drawer`).
- Do not do one-shot full rewrites. Keep behavior parity and reduce regression risk through staged replacement.
- Preserve UX/security constraints during migration: pet-mode interaction affordance, streaming composer behavior, and Electron security boundaries.

## Testing Guidelines
- Frameworks:
  - Desktop: Node built-in `node:test`
  - Frontend: `vitest`
- Focus regression tests on:
  - IPC stream event mapping (`text-delta/done/error`)
  - stream abort behavior
  - voice session state transitions and commit serialization
  - TTS chunk ACK backpressure pause/resume and timeout handling
  - ASR worker warmup/fallback behavior
  - voice-to-chat bridge on `asr-final`
  - settings persistence and token handling
  - SSE parsing robustness
  - voice model catalog install + runtime env mapping (sherpa/python)
  - Live2D custom protocol URL resolution compatibility:
    - `openclaw-model:///folder/file`
    - `openclaw-model://folder/file`
  - path traversal rejection for custom protocol resolution
- When changing voice model, provider, worker, or protocol logic, run `npm run test:desktop`.
- When changing `VoiceSettingsPanel` or voice renderer hooks, run:
  - `npm run test:frontend`
  - `cd front_end && npm run lint`

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
- For `openclaw-model://` asset serving, keep strict root-directory confinement and reject traversal attempts.
- Do not let renderer directly execute Python, shell, or model bootstrap commands; keep these operations in trusted main-process services.
- Keep voice worker IPC payloads schema-safe and minimal (audio/text/status only).
