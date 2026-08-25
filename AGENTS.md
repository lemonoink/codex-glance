# Repository Guidelines

## Project Structure & Module Organization

This repository is currently being bootstrapped. Keep the desktop bridge and device firmware separate:

- `bridge/src/`: TypeScript session watcher, state reducer, privacy filter, and USB transport.
- `bridge/test/`: unit and integration tests; reusable event samples belong in `bridge/test/fixtures/`.
- `firmware/codex_glance/`: ESP32-S3 Arduino firmware for the Waveshare 1.69-inch display.
- `docs/`: protocol, architecture, wiring, and development notes.
- `assets/`: screenshots and other documentation images.

Do not commit generated builds, local Codex session files, serial logs, or Arduino library copies.

## Architecture Overview

Codex Desktop events are normalized by the Mac bridge into a small, versioned state snapshot. The bridge sends NDJSON over USB CDC; the ESP32-S3 only parses snapshots and renders the UI. Keep Codex-specific event parsing out of firmware. Messages must remain under 512 bytes and must not contain prompts, reasoning, source code, or command output.

## Build, Test, and Development Commands

No build configuration exists yet. When bootstrapping, expose these stable entry points rather than requiring ad hoc commands:

- `npm --prefix bridge run dev`: run the bridge against local sessions.
- `npm --prefix bridge test`: run bridge tests.
- `npm --prefix bridge run lint`: check formatting and TypeScript rules.
- `npm --prefix bridge run build`: produce the bridge distribution.
- `make firmware-compile`: compile firmware using the pinned board profile.

Update `README.md` whenever a command, dependency, or required board setting changes.

## Coding Style & Naming Conventions

Use two spaces in TypeScript and four spaces in C/C++. Prefer `camelCase` for variables and functions, `PascalCase` for types, and `kebab-case` for TypeScript filenames. Use `UPPER_SNAKE_CASE` for firmware constants. Format TypeScript with Prettier and lint with ESLint once configured. Keep protocol types explicit and reject malformed or oversized input.

## Testing Guidelines

Name TypeScript tests `*.test.ts`. Cover event normalization, state transitions, privacy filtering, reconnect behavior, and unknown events. Firmware changes require a successful compile plus a short hardware check covering boot, USB reconnect, heartbeat timeout, and screen refresh without flicker.

## Commit & Pull Request Guidelines

There is no existing commit history. Use Conventional Commits, for example `feat(bridge): add session watcher` or `fix(firmware): recover USB CDC after reset`. Pull requests should explain behavior changes, list verification commands, link relevant issues, and include a photo or screenshot for visible UI changes. Keep bridge, protocol, and firmware changes in separate commits when practical.
