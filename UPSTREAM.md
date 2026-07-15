# Upstream: crynta/terax-ai

This repo is a private fork of [crynta/terax-ai](https://github.com/crynta/terax-ai) — the cockpit of the glance fleet-first IDE (meta-plan: `plans/fleet-first-ide/` in the glance repo).

## Provenance

- **Bootstrapped**: 2026-07-14 from `upstream/main` @ `a2c8329662ade6fef8c1e11f7353a7231256937d` ("feat(bundle): open multiple files via 'Open With', add launch-parse tests", 2026-07-13)
- **Remotes**: `origin` = lmvdz/glance-desktop (private), `upstream` = crynta/terax-ai
- **License**: Apache-2.0 (upstream's license is retained; see LICENSE)

## Rebrand (C02, rebrand-lite — 2026-07-14)

Presents as **Glance** without the deep rename (deferred to Epic M):
- `tauri.conf.json`: productName `Glance`, identifier `app.crynta.terax` → **`app.glance.desktop`**, window title `Glance`.
- `package.json` name → `glance-desktop`; app icons regenerated from the glance mark (`webapp/src/assets/logo-mark.png`, ember `#F0A35A`) via `tauri icon`.
- Load-bearing name surfaces: `useWindowTitle.ts` `APP_NAME` (the dynamic title bar) and `AboutSection` (displayed name + identifier).
- **Deliberately NOT renamed** (deep rename, Epic M): the Rust crate (`Cargo.toml` still `terax`), the in-app AI-assistant name ("Ask Terax", agent labels), theme ids, and internal store filenames (`terax-spaces.json`). These are internal or feature-scoped, not the app shell.
- **Identifier re-home**: changing the identifier moves the tauri-plugin-store data dir, so a user's existing terax Spaces/settings do NOT carry over — intended (clean separation from a real terax install).

## Discipline: additive-only

Until the fleet module is the primary surface (meta-plan Epic M decides hard divergence), every change here must be additive:

- New code lives in `src/modules/fleet/` (+ its tests).
- Upstream files may be touched ONLY for: module/tab/palette registration points, rebrand-lite (`tauri.conf.json` productName/identifier/title, `package.json` name, icons), and nothing else.
- Every PR attaches `git diff --stat upstream/main` so the touch surface stays auditable.
- No public CI, no visibility change — both are Lars's calls.

## Rebase runbook

**Never rebase blind — read the forecast first.** `scripts/upstream-drift.sh` (it fetches `upstream` itself) prints how far behind we are and the CONFLICT FORECAST: the exact files a rebase will make you resolve by hand (the set both we and upstream changed since the common base). It also flags when upstream touched a fleet-module **registration point** (`App.tsx`, `WorkspaceSurface.tsx`, `command-palette/commands.ts`, `spaces/serialize.ts`, `tabs/{index,lib/useTabs,lib/tabLabel}`, `settings/*`) — the additive seams most likely to collide. Exit 0 = clean; exit 1 = conflicts likely. A weekly Action (`.github/workflows/upstream-drift.yml`) runs it and keeps one living **"Upstream drift tracker"** issue current; run it on demand from the Actions tab (`workflow_dispatch`).

Reading the forecast:
- **0 conflict files** → a rebase is mechanical; just do it.
- **conflicts only in registration points** → expected; each is a small additive insertion (a tab-kind, a palette item, a serialize case) that upstream reordered around. Re-apply ours below theirs.
- **conflicts in `src/modules/fleet/` neighbors or many files** → the additive discipline slipped, or upstream refactored a seam. Slow down.

Steps:
1. `scripts/upstream-drift.sh` — read the forecast. If it says UP TO DATE, stop.
2. `git checkout -b rebase/YYYY-MM-DD && git rebase upstream/main` — on a branch, **never directly on `main`**.
3. Resolve conflicts (should be confined to the registration points if the discipline held). `git rebase --continue`.
4. Run the full gate (below): `pnpm lint && pnpm check-types && pnpm vitest run && pnpm build && (cd src-tauri && cargo check)`.
5. Fast-forward `main` via PR.

Escape hatch:
- If a rebase costs **more than a day**, record why in a dated line here. **Two** such events → bring the hard-divergence decision to Lars (per the meta-plan: once the fleet module is the primary surface, hard divergence is acceptable).

## Inherited upstream workflows (not yet triaged — Lars's call)

The clone brought terax's `.github/workflows/`: `ci.yml` (runs on push/PR — currently GREEN on our branches, a useful independent gate), plus `release.yml`, `signpath-test.yml`, `update-nix-sources.yml` (release/code-signing/nix — terax-specific, trigger on tags/releases we don't cut). They are dormant until we tag a release. Pruning or adapting them is a deliberate cleanup, not part of C03.

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

**cargo gate status = GREEN** (2026-07-14, `Finished dev profile in 54s`). Two machine-specific facts to keep:

- System deps: upstream CI's list (`libwebkit2gtk-4.1-dev libgtk-3-dev librsvg2-dev libssl-dev`) PLUS `libdbus-1-dev` (GitHub runners preinstall it; bare WSL2 doesn't — `libdbus-sys` panics without it). All installed 2026-07-14.
- **linuxbrew shadows pkg-config**: `/home/linuxbrew/.linuxbrew/bin/pkg-config` precedes `/usr/bin` on PATH and its default search path is brew-only, so system libs look missing even when installed. Every cargo invocation on this machine needs:

```
export PKG_CONFIG_PATH=/usr/lib/x86_64-linux-gnu/pkgconfig:/usr/share/pkgconfig
```

**GUI launch proof: PASSED** (2026-07-14) — `pnpm tauri dev` under WSLg mapped a real X11 window: `0x600003 "Tauri App": ("terax" "Terax") 800x600` (captured via `xwininfo -root -tree`). Window class still says Terax — C02 rebrand-lite owns that.
