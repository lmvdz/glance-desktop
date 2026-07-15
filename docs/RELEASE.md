# Release runbook (Glance / lmvdz/glance-desktop)

This is the ops rider for cutting a signed, auto-updating Glance release. The
pipeline itself (`.github/workflows/release.yml`, `src-tauri/tauri.conf.json`
bundle config, the Tauri updater plugin) is complete and already repointed at
this fork's own repo (`lmvdz/glance-desktop`) as of the M04
release-recredential-rebrand concern. What's missing is credentials, which
only Lars can provision — this doc is the exact list and the exact commands.

## 1. Generate the fork's own updater signing keypair (do this first)

`tauri.conf.json`'s `plugins.updater.pubkey` currently still holds
**upstream's** (crynta/terax-ai's) minisign public key:

```
"pubkey": "dW50cnVzdGVkIGNvbW1lbnQ6IG1pbmlzaWduIHB1YmxpYyBrZXk6IDNCQUJGRDhBQjYwRTM0NjkKUldScE5BNjJpdjJyT3dIN0dqbUpHaDA4QW1GaDVmTTllRXdZVk96dFNTRUZ3Y2hiVGszYjFqRloK"
```

**This was deliberately left unchanged by M04.** It was not regenerated,
fabricated, or replaced — the pipeline was only repointed at the fork's
release *repo*, not re-keyed. Ship a release with this pubkey still in place
and the Tauri updater will refuse every future auto-update signature check
(the private half of that keypair belongs to upstream, not this fork, and is
not available to us). **This must be regenerated before the first real
Glance release ships.**

Steps (verified against the installed `@tauri-apps/cli@2.11.4` in this repo —
`node_modules/.bin/tauri signer generate --help`):

```bash
# 1. Generate a new minisign keypair, write the private key to disk (do NOT
#    commit this file — .gitignore it or keep it outside the repo entirely).
#    You'll be prompted for a password unless you pass -p.
node_modules/.bin/tauri signer generate -w ~/.glance/updater.key

# This prints a public key line to stdout, e.g.:
#   Your keypair was generated successfully
#   Private: ~/.glance/updater.key (Keep it secret!)
#   Public: dW50cnVzdGVkIGNvbW1lbnQ6...   <-- this is what you need
```

2. Paste the printed **public** key into `src-tauri/tauri.conf.json` →
   `plugins.updater.pubkey`, replacing the upstream value above. Commit that
   change (it's public by design — it's how clients verify update
   signatures, not a secret).
3. Set the **private** key and its password as GitHub secrets (never commit
   them — see the `gh secret set` commands below). The private key file
   content goes into `TAURI_SIGNING_PRIVATE_KEY` (the whole file, not just a
   path); the password you chose in step 1 goes into
   `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`.
4. Keep `~/.glance/updater.key` (or wherever you wrote it) somewhere durable
   and backed up outside the repo — if it's lost, every installed copy of
   Glance stops being able to verify future updates and users have to
   reinstall from scratch with a new pubkey baked in.

## 2. GitHub secrets `release.yml` and `signpath-test.yml` need

Derived by reading the actual `secrets.*` references in both workflow files
(not guessed). Set each with:

```bash
gh secret set <NAME> --repo lmvdz/glance-desktop
```

(`gh secret set NAME --repo lmvdz/glance-desktop --body "$VALUE"` for
non-interactive/scripted setting; omit `--body` to be prompted or pipe via
stdin, which is preferable for anything sensitive so it never lands in shell
history.)

### Tauri updater signing (from step 1 above)

| Secret | What it's for |
|---|---|
| `TAURI_SIGNING_PRIVATE_KEY` | The minisign private key (full file contents) used to sign every release artifact so the updater plugin can verify `latest.json` + installers came from us. |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | Password for the private key above, chosen when you ran `tauri signer generate`. |

Used in: `release.yml` (main matrix build + the AppImage re-sign step) and
`signpath-test.yml` (Windows-only Tauri build, unsigned-artifact staging).

### Apple (macOS signing + notarization)

| Secret | What it's for |
|---|---|
| `APPLE_CERTIFICATE` | Base64-encoded Developer ID Application `.p12` certificate used to codesign the macOS bundle. |
| `APPLE_CERTIFICATE_PASSWORD` | Password protecting the `.p12` above. |
| `APPLE_SIGNING_IDENTITY` | The codesign identity string (e.g. `Developer ID Application: Your Name (TEAMID)`) tauri-action passes to `codesign`. |
| `APPLE_TEAM_ID` | Apple Developer Team ID, used for notarization. |
| `APPLE_API_ISSUER` | App Store Connect API issuer UUID, for `notarytool`-based notarization. |
| `APPLE_API_KEY` | App Store Connect API Key ID (the short key ID string, not the key file itself). |
| `APPLE_API_KEY_PATH` | The **contents** of the `.p8` API key file (release.yml writes this to `$HOME/private_keys/AuthKey.p8` at build time — despite the name, this secret holds file content, not a path). |

Used in: `release.yml` only (the "Write Apple API key to disk" step +
`tauri-action`'s macOS signing/notarization env).

Note: `release.yml` does **not** reference an `APPLE_ID` secret (only the API
Key/Issuer trio above, which is the App Store Connect API key flow rather
than the older Apple-ID + app-specific-password flow) — don't provision one,
it won't be read.

### Windows (SignPath)

| Secret | What it's for |
|---|---|
| `SIGNPATH_API_TOKEN` | Auth token for `signpath/github-action-submit-signing-request`, used by `signpath-test.yml` to submit the unsigned Windows `.exe`/`.msi` to SignPath for Authenticode signing. |

`signpath-test.yml`'s job also hard-codes a SignPath `organization-id`
(`df665bf4-9b76-41ae-9596-1ba3a23010aa`) and `project-slug: 'terax-ai'` —
these identify a project inside **upstream's** SignPath account, not a
secret this repo can rotate via `gh secret set`. **M04 deliberately left
these values as-is** (guessing a replacement would be fabrication, not a
fix). Before this job can produce a real signed Windows binary for the fork,
Lars needs to either get added as a collaborator on that SignPath
project, or create a new SignPath project for `lmvdz/glance-desktop` and
update `organization-id`/`project-slug` in `signpath-test.yml` to match. The
job is otherwise correctly gated to only run on this repo
(`if: github.repository == 'lmvdz/glance-desktop'`, fixed by M04 — it
previously only ran on `crynta/terax-ai` and so never fired on the fork at
all).

`release.yml`'s main 4-target matrix (macOS aarch64/x86_64, ubuntu, windows)
does not itself call out to SignPath — `signpath-test.yml` is a separate,
manually-dispatched (`workflow_dispatch`) verification job. Windows binaries
built by `release.yml` today ship **unsigned** unless/until that pipeline is
wired into the release matrix too, which is out of scope here.

## 3. Cutting a release

Once the secrets above are set and the pubkey is regenerated (section 1):

```bash
git tag v0.9.0   # match src-tauri/tauri.conf.json's "version" field
git push origin v0.9.0
```

Pushing a `v*` tag triggers `release.yml`:

1. `publish-tauri` runs the 4-platform matrix (macOS aarch64/x86_64, Ubuntu,
   Windows), builds + signs + notarizes (macOS) each target via
   `tauri-action`, and creates a **draft** GitHub release
   (`releaseDraft: true`) named `Glance ${tag}` with all installers +
   `latest.json` attached.
2. The Ubuntu leg additionally re-signs the AppImage after stripping bundled
   Wayland libs (see the inline comment in `release.yml` for why) and
   re-uploads it.
3. `patch-appimage-updater` (needs `publish-tauri`) runs once all matrix legs
   finish, patches the re-signed AppImage's signature into the combined
   `latest.json` so the updater manifest is consistent across all platforms.
4. Review the draft release on GitHub, then publish it manually. Publishing
   fires `update-nix-sources.yml` (`on: release: types: [published]`), which
   downloads the fork's own `Glance_*` release assets, computes SRI hashes,
   and opens a PR updating `nix/sources.json`.

`workflow_dispatch` is also enabled on `release.yml` for a manual re-run
(e.g. re-triggering a failed matrix leg) without pushing a new tag.

## 4. Known issue: CI (`ci.yml`) fails immediately on every push/PR

**Root cause confirmed, not a code bug — no code fix applied here.** Every
recent `CI` run on `lmvdz/glance-desktop` fails in 2-4 seconds before any job
even starts, with this annotation on all four jobs:

> The job was not started because recent account payments have failed or
> your spending limit needs to be increased. Please check the 'Billing &
> plans' section in your settings.

(Verified live via `gh run view <run-id> --repo lmvdz/glance-desktop`, e.g.
run `29453381541` on 2026-07-15 — all of `rust`, `rust-test (macos-latest)`,
`rust-test (windows-latest)`, `frontend` show this exact annotation.)

This is a GitHub Actions billing/spending-limit problem on the `lmvdz`
account, unrelated to workflow content. **Do not attempt to fix this by
touching `ci.yml`.** Before landing M04, the originating concern doc
speculated the cause might be unresolvable/stale pinned action versions
(`actions/checkout@v7`, `actions/setup-node@v6`, etc.) — that theory was
checked and ruled out: every action version pinned across `ci.yml`,
`release.yml`, `signpath-test.yml`, and `update-nix-sources.yml`
(`actions/checkout@v7`, `actions/setup-node@v6`, `actions/upload-artifact@v7`,
`pnpm/action-setup@v6`, `swatinem/rust-cache@v2`, `taiki-e/install-action@v2`,
`dtolnay/rust-toolchain@stable`, `signpath/github-action-submit-signing-request@v2`,
`peter-evans/create-pull-request@v8`) resolves to a real, existing tag/branch
as of 2026-07-15 (checked against each action's GitHub tags/branches API).

**Fix**: check Settings → Billing & plans on the `lmvdz` GitHub account and
resolve the failed payment / raise the spending limit. No repo change is
needed. Once resolved, re-run the most recent failed `CI` run
(`gh run rerun <run-id> --repo lmvdz/glance-desktop`) to confirm the jobs
actually execute — this has not been verified live since it needs the
billing fix first.

## What M04 did NOT do (and why)

- **Did not regenerate the updater keypair or fabricate a pubkey.** Section 1
  above is the exact procedure; the pubkey in `tauri.conf.json` still reads
  upstream's key until someone runs it.
- **Did not provision, set, or view the contents of any secret** listed in
  section 2. `gh secret set` commands are given; running them with real
  values is Lars's action.
- **Did not touch the SignPath `organization-id`/`project-slug`** in
  `signpath-test.yml` — those identify an external SignPath account/project
  this repo doesn't control (see section 2).
- **Did not attempt a signed/notarized/auto-updating release end-to-end** —
  that requires the secrets above and cannot be exercised without them.
  `NOT RUN`, expected: unblocks once section 1 + 2 are done.
- **Did not touch `ci.yml`** — root cause is billing, confirmed live (section
  4), not a workflow content bug.
