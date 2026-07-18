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

## t3face skin substrate (plans/t3-face 01/02)

The app is skinned in t3code's (pingdotgg/t3code, MIT) visual system: derived-alpha
palette, DM Sans Variable, duty-cycled status animations, surface grain, composer
glass, overlay scrollbars, and the `.chat-markdown` typography system. Almost all of
it lives in the new, fully additive `src/styles/t3face.css` (MIT header inside the
file). Three upstream files could not stay untouched — Tailwind v4's `@theme` and
`--alpha()` are only processed in the CSS graph reachable from the file containing
`@import "tailwindcss"`, and font utilities bake a literal family at compile time —
so token/font *registration* had to land in `globals.css`'s existing `@theme inline`
block (kept minimal and commented; see the block itself for the "why here, not in
t3face.css" note). The theme engine (`src/modules/theme/{types,applyTheme,
validateTheme}.ts`) also carries the `warning`/`info`/`success`/`pending` (+
`-foreground`) status keys so non-default themes can override any subset — this
makes `applyTheme.ts` and `validateTheme.ts` **permanent conflict files** going
forward (they were pristine vs. upstream before this); `types.ts` was already
fork-diverged. Both are tracked in `scripts/upstream-drift.sh`'s `REG_POINTS`.

### Diverged-set additions

- `src/styles/globals.css` — `@theme inline` gained the font-sans swap + 8 status
  color registrations + 3 animation names (already fork-diverged; this widens the
  existing conflict surface, doesn't create a new one).
- `components.json` — `tailwind.css` now points at the real Tailwind root
  (`src/styles/globals.css`); it previously referenced a nonexistent `src/App.css`.
- `src/main.tsx` / `src/settings/main.tsx` — one new import each
  (`./styles/t3face.css`, immediately after `globals.css`).
- `src/modules/theme/applyTheme.ts`, `src/modules/theme/validateTheme.ts` — newly
  diverged (see above); `src/modules/theme/types.ts` — widened.

### Skin-coverage manifest

Upstream surfaces t3face intentionally re-skins (screenshot-diff these, both
light and dark, after every rebase — see the runbook step below):

- **Editor chrome** — CodeMirror gutters/panels, the diff pane, tab strip icons.
- **Terminal** — xterm.js chrome (background/foreground/cursor/selection derive
  from the palette; ANSI colors are untouched).
- **Settings window** — a second real webview entrypoint (`src/settings/main.tsx`);
  easy to skin half of the app and miss this one.
- **Spaces / tab bar** — the space switcher and tab strip surfaces.
- **Dialogs / popovers / menus** — anything using `.surface-grain` (floats above
  the body, needs the grain opted in explicitly) plus the composer glass shell.
- **Scrollbars** — the global 6px overlay treatment and the `.chat-markdown`/
  tooltip thin-scrollbar variants; verify upstream's `.no-scrollbar(-deep)` and
  xterm/CodeMirror scrollbar opt-outs still win (they're selector-scoped at a
  higher specificity than the generic override on purpose).

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
5. **Screenshot-diff the skin-coverage manifest** (t3face, both light and dark
   mode): editor chrome, terminal, settings window, spaces/tab bar, dialogs.
   Upstream additions in these surfaces land unstyled (raw upstream colors)
   until t3face's selectors are extended to cover them — a rebase is the
   moment new unstyled surfaces are most likely to slip in unnoticed.
6. Fast-forward `main` via PR.

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
