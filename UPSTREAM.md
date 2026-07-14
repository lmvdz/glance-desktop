# Upstream: crynta/terax-ai

This repo is a private fork of [crynta/terax-ai](https://github.com/crynta/terax-ai) — the cockpit of the glance fleet-first IDE (meta-plan: `plans/fleet-first-ide/` in the glance repo).

## Provenance

- **Bootstrapped**: 2026-07-14 from `upstream/main` @ `a2c8329662ade6fef8c1e11f7353a7231256937d` ("feat(bundle): open multiple files via 'Open With', add launch-parse tests", 2026-07-13)
- **Remotes**: `origin` = lmvdz/glance-desktop (private), `upstream` = crynta/terax-ai
- **License**: Apache-2.0 (upstream's license is retained; see LICENSE)

## Discipline: additive-only

Until the fleet module is the primary surface (meta-plan Epic M decides hard divergence), every change here must be additive:

- New code lives in `src/modules/fleet/` (+ its tests).
- Upstream files may be touched ONLY for: module/tab/palette registration points, rebrand-lite (`tauri.conf.json` productName/identifier/title, `package.json` name, icons), and nothing else.
- Every PR attaches `git diff --stat upstream/main` so the touch surface stays auditable.
- No public CI, no visibility change — both are Lars's calls.

## Rebase runbook

1. `git fetch upstream && scripts/upstream-drift.sh` (C03 adds this) — read the conflict forecast before rebasing.
2. `git rebase upstream/main` on a branch, never directly on main; fix conflicts (should be confined to registration points if the discipline held).
3. Run the full gate (below), then fast-forward main via PR.
4. If a rebase costs more than a day: record why here. Two such events → bring the hard-divergence decision to Lars.

## Build on this machine (WSL2 Ubuntu)

Toolchain present: pnpm 11.9 (via packageManager pin), node (volta), cargo 1.94.0.

Gate (matches upstream `.github/workflows/ci.yml`):

```
pnpm install
pnpm lint          # biome — green @ bootstrap (103 warnings, 0 errors)
pnpm check-types   # tsc --noEmit — green @ bootstrap
pnpm vitest run    # 351/351 green @ bootstrap
pnpm build         # vite — green @ bootstrap
cd src-tauri && cargo check
```

**cargo check is NOT green yet on this machine**: system libraries missing. Upstream CI installs `libwebkit2gtk-4.1-dev libgtk-3-dev librsvg2-dev libssl-dev`; WSL2 additionally needs `libdbus-1-dev` (first observed failure: `libdbus-sys-0.2.7/build.rs:25:9: explicit panic` — dbus headers absent; GitHub runners have them preinstalled). One-time setup owed:

```
sudo apt-get install -y libwebkit2gtk-4.1-dev libgtk-3-dev librsvg2-dev libssl-dev libdbus-1-dev
```

Re-run `cargo check` after installing and update this line: cargo gate status = **PENDING system deps**.

GUI launch proof (`pnpm tauri dev` under WSLg) also owed after the deps land.
