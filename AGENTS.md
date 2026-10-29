# CLAUDE.md

Stateless inspector for Overlens visual-regression snapshots. GitHub is the
database: `/{owner}/{repo}/pull/{n}` reads the tip of that repo's `overlens/pr-{n}`
branch (head) and the `overlens/dev` snapshot its `report.json` names as
`baseSha` (base) and renders the comparison. No accounts, no server state — one Vercel function exchanges the
GitHub OAuth code, everything else runs in the browser. The npm package
`@ape-egg/overlens` in [package/](package/) is what writes those branches.

## Commands

- `bun dev` — `vibe compile --watch` + Bun static server with SPA fallback
  ([dev.js](dev.js)), wrapped by `../dev.sh` (Caddy proxy at
  `https://overlens.localhost`, honors `$PORT`)
- `bun run compile` — one-off build to `compiled/` (what Vercel runs, then
  it copies `package/templates` to `compiled/templates`)
- `bun publish:check` — `npm pack --dry-run` of `package/`, what would ship.

## Contributing and versioning

- Every branch made for overlens includes a version bump. It is a patch bump
  (`1.0.0` → `1.0.1`) unless the developer names a minor or a major, and then
  it is that one.
- The version lives in `package/package.json`. The root `package.json` is the
  private site and keeps its own.
- Publishing is done by the developer once the branch is merged to `main`, by
  pushing a version tag. An agent never publishes and never pushes a version
  tag.
- The developer tags the merged release `git tag -a v<version>` and pushes it
  with `git push --follow-tags`. A `v*.*.*` tag push runs
  [.github/workflows/publish.yml](.github/workflows/publish.yml): it fails
  unless the tag is `v` plus the version in `package/package.json`, then
  publishes `package/` as public with `npm publish --provenance`, authenticated
  by npm trusted publishing, so no npm token is kept anywhere. Pushes to `main`
  and moving the floating `v1` tag publish nothing.

## Architecture

- **vibe compiled SPA** (npm `@ape-egg/vibe` + `@ape-egg/vibe-compiler`): the
  `pages/` tree becomes fragments + route table + shell. Routes:
  `/` (landing), `/$owner/$repo/pull/$n` (inspector), `$$rest` catch-all
  (landing + URL-format hint).
- **[js/github.js](js/github.js)** — the data layer. Branch tips resolve once
  per load, then everything is fetched by immutable commit sha and cached in
  memory. Tokenless: `raw.githubusercontent.com` (public repos). With a token
  (`localStorage.overlens-session`): the Git Blobs API — base64 JSON, up to
  100MB, because the Contents API caps files at 1MB. The GitHub App's user
  tokens expire after 8 hours: the session keeps the refresh token and
  `loadInspector` swaps an expired token through
  [api/exchange.js](api/exchange.js) before its first API call — otherwise
  the 401 lands a signed-in visitor on the gate. Status mapping: 404 on
  the pr ref with a visible repo = `no-data`; invisible repo or 401/403 =
  `gate`; missing report.json = `no-report`; empty `pages` = `clean`.
- **[js/diff.js](js/diff.js)** — the Difference mode: canvas pixel diff over
  the union of both images (~5% per-channel fuzz, like the package), red over
  a dimmed base, computed lazily and cached per (page, variant). Area only one
  image covers (height deltas) renders dimmed, never red — matching the
  package's diffPercent, which only counts the shared area.
- **[components/Inspector.html](components/Inspector.html)** — stylecheat
  fullpage vertical carousel, one slide per page. One mode group: Difference
  (default), Split (clip-path + drag handle, base left / PR right), Onion
  (opacity), 2-up (shared-scale columns). Every mode but 2-up shares one
  slider, in a bar stuck to the bottom of the card: `view.blend` runs 0 =
  base to 100 = PR and resets to 50 on every mode switch — except in Split,
  where the value is the divider's position (base shows left of it, PR
  right). Split's drag handle writes the same value, so either one moves
  both. Difference layers
  the diff PNG over whichever design the slider leans to — base below 50, PR
  above — at an opacity peaking at 50 and reaching 0 at both ends, so the red
  thins and colour returns as you slide toward either side.
  Viewport/theme toggles pick
  the `<viewport>-<theme>/` variant in place; a slide whose page has no diff
  in the current variant renders no comparison — just a centered "Visual
  regression in" note with device buttons that jump there.
  Both sides always render at the
  same scale, top-aligned, never upscaled past 1:1 — height drift below a
  reflow point is honest by design. The slide header's toggle (left of the
  status badge, `localStorage.overlens-fit`, fit by default) switches
  `compare-area` between fit and scroll: fit is `container-type: size`, so
  [imgWidth](js/github.js) can cap the shared scale by the area's height as
  well as its width and the whole page lands on screen; scroll is
  `inline-size` + `overflow: auto` and renders at 1:1. Either way the
  comparison centres in the area (`safe center` — an overflowing page still
  starts at the top). 2-up splits the width budget over its two columns and
  hugs the gutter: base right-aligned, PR left-aligned. At ≤768px the two floating bars unfix:
  `overlens-inspector` becomes a grid and `top-left`/`top-right` go
  `display: contents`, so their children place themselves — logo and Sign in
  share row 1, repo meta and the controls get a row each, the carousel takes
  the rest. Those rules are scoped to `overlens-inspector`; the landing
  reuses the same element names with its own fixed header.
- **css/stylecheat.css** — vendored hybrid build (`<body stylecheat dark>`).
- **[js/guide.js](js/guide.js)** highlights every `<template codie>`; one
  with `data-src` loads that file from `/templates/` — the package's own
  templates ([dev.js](dev.js) serves them from `package/templates`), so the
  guide shows exactly what `overlens init` writes.

## Package

`@ape-egg/overlens` runs as `bunx @ape-egg/overlens@1` from the shared
workflow [.github/workflows/run.yml](.github/workflows/run.yml) (`on:
workflow_call`, tagged `v1` — move the tag when it changes, which is why this
repo is public). Each consumer's 8-line file
([templates/overlens.yml](package/templates/overlens.yml)) keeps only
`name: Overlens` (without it the Actions list shows the file path: run.yml's
own name never stands in), `on: deployment_status`, the token's two write
permissions (a called workflow can't widen the caller's token) and the `uses:` job with id
`Overlens`, so the check reads `Overlens / Crawl and compare` (run.yml's job
name); run.yml does setup-bun and the bunx step with `GH_TOKEN: ${{ github.token }}`. Everything else lives
in the package, so keep both files that small: no checkout, no concurrency, no
job `if`, no `pull_request` trigger. [bin/overlens.js](package/bin/overlens.js)
runs on `deployment_status` (or `init` by name). The consumer passes optional
`with:` inputs — `environments` (regex a deployment's environment must match,
default `Preview|Production`), `inspector` (report link origin) and `runs-on`
(runner label, default `ubuntu-26.04`) — which run.yml hands the package as
`ENVIRONMENTS` and `INSPECTOR`. Every example writes `permissions:` and `with:`
as expanded blocks, never inline braces.

- [snapshot.js](package/src/snapshot.js) — a successful deploy with a URL
  and a matching environment is fetched (`git fetch --depth 1` of the
  deployed sha into the empty workspace). With an `overlens.config` there,
  the branch resolves through `branches-where-head`: `dev` (`targetBranch`),
  `pr-N` (an open PR) or nothing (superseded deploy, no PR). It resolves
  again after the crawl and publishes only when the answer still holds —
  that stands in for the old workflow's `cancel-in-progress` concurrency.
- [crawl.js](package/src/crawl.js) — copies [crawler/](package/crawler/) to
  `.overlens/crawler` in the checkout, so the spec's `../../overlens.config`
  import resolves, and runs it with `docker run` in
  `mcr.microsoft.com/playwright:v<pin>-noble`, the tag read from the
  crawler's exact `@playwright/test` pin — the image and the pin move
  together, consumers install nothing. Only `OVERLENS`, `CI` and
  `PLAYWRIGHT_BASE_URL` reach the container, not the token. The consumer's
  `overlens.config` is imported by bun and by Playwright with no install, so
  it must stay dependency-free (type-only imports are erased and fine).
- [publish.js](package/src/publish.js) — clones `overlens/dev`
  (`--filter=blob:none`, full history), lays the output over the baseline,
  diffs each changed PNG with ImageMagick (`compare -fuzz 5% -metric AE` over
  the shared area, ≤32 pixels is noise), writes `report.json` on PR branches
  and force-pushes `overlens/<slug>`. A `targetBranch` run builds on the tip
  and always commits (`--allow-empty`), so every finished crawl leaves a
  `<branch> @ <sha7>` commit. A PR run builds on the snapshot of its merge
  base instead: GitHub's compare API (`<sha>...<targetBranch>`) gives the
  merge base and whether the target moved on; the snapshot whose message
  names the merge base wins, else the newest one whose commit isn't among
  those the target reached after it (the nearest snapshotted ancestor),
  else the oldest. So a PR never shows what merged into the target since,
  and merging the target in moves it forward. When the merge base is still
  the target's tip but has no snapshot, the target's own crawl is still
  running: the run polls for it (30s × 20) and, if it never lands, compares
  against the nearest older snapshot and flags it as `late`.
- [report.js](package/src/report.js) — the draft PR into `overlens/dev`
  (file list and mermaid sitemap) and the source PR's summary between
  `<!-- overlens:summary -->` markers, headed "This PR was visually scanned
  through Overlens" linked to the site. GitHub diffs the draft from the
  point `overlens/pr-N` branched off `overlens/dev` — the pinned baseline —
  so it shows only the PR's changes. Both carry a line when the target has
  moved on (merge it in to compare against the latest snapshot) or the
  merge base's snapshot came in late.
- [cleanup.js](package/src/cleanup.js) — every successful deploy first
  sweeps the `overlens/pr-*` branches: a PR no longer open gets its draft PR
  closed and its branch deleted. That replaces the `pull_request: closed`
  trigger.

## Data contract

Produced by each consumer repo's Overlens workflow (see `sesamyab/account2`,
PR #143 added the report):

```
<viewport>-<theme>/<page>.png                    desktop|mobile × light|dark, slugified paths
<viewport>-<theme>/<page>~<state>[~<nested>].png pressed states (engine v3+)
report.json                                      overlens/pr-* branches only, at the root
```

Pressed states come from elements marked with a bare `data-overlens-press`
(empty or `"true"`, React's bare JSX data-* attribute, count too; any other
value isn't a press). After a page's own shots each pass presses every one on
screen, waits out animations and the page settling, and names the state after
the press's own `aria-label` or text — the crawl never looks at what opened;
a name repeated on a page gets the press's place appended. Marks inside the
state are pressed next, chained with `~`. Presses sharing tag-and-class
ancestry are one group, and only the first of a group is pressed; states are
per page. Each state is its own entry in `report.json`, so the inspector
gives it its own slide with no special handling — the slide label reads
`customers / [id]~edit`. The install guide documents the attribute; the
package README holds the full rules.

Masks come from elements carrying `data-overlens-mask`, bare, empty or
`"true"` — any other value, `"false"` included, is unmasked. Every shot,
pressed states too, covers them with a solid box. `config.mask` adds CSS
selectors on top and never replaces the attribute. It replaces portal's
`data-apply-playwright-mask`, the engine's old default selector, which is no
longer masked unless a config lists it.

`report.json`: `{ baseSha, sourcePr, sourceSha, pages: [{ file, status,
diffPercent? }] }` — status `added` | `changed` | `removed`, `diffPercent`
counting mismatches within the area both images share. A page differing only
in height is not a change and never reaches the report. A missing
report.json is a hard stop ("re-run Overlens"), not a fallback render.
`baseSha` is the `overlens/dev` commit `overlens/pr-N` sits on, the pinned
baseline, and the inspector renders it as the base — never the
`overlens/dev` tip, which may be newer.

`kkortes/overlens-fixture` (public) holds synthetic branches covering every
state: pr-1 (changes incl. reflow + variant-specific), pr-2 (clean),
pr-3 (no report). Regenerate with the scripts noted in that repo's history.
It also carries PRs #1–#3, opened from those branches onto `overlens/dev`, so
the public demo's GitHub link resolves instead of bouncing to `/issues/n` —
keep branch names and PR numbers in step if you add cases.

## Deploy

Vercel project on `kkortes/overlens`: [vercel.json](vercel.json) sets
`buildCommand`, `outputDirectory: compiled` and the catch-all rewrite.
[api/exchange.js](api/exchange.js) needs `GITHUB_CLIENT_ID` +
`GITHUB_CLIENT_SECRET` env vars.

## Manual steps (owner)

1. Register the GitHub App: Contents read-only, callback = deployed origin
   `/`, note the slug. Fill client id into [js/config.js](js/config.js) (and
   the install link in Inspector.html if the slug isn't `overlens`); client
   id + secret into Vercel env.
2. Link the Vercel project to `kkortes/overlens` — live at
   `https://overlens.korte.kim`.
