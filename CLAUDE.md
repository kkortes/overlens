# CLAUDE.md

Stateless inspector for Overlens visual-regression snapshots. GitHub is the
database: `/{owner}/{repo}/pull/{n}` reads the tips of that repo's
`overlens/pr-{n}` (head) and `overlens/dev` (base) branches and renders the
comparison. No accounts, no server state — one Vercel function exchanges the
GitHub OAuth code, everything else runs in the browser.

## Commands

- `bun dev` — `vibe compile --watch` + Bun static server with SPA fallback
  ([dev.js](dev.js)), wrapped by `../dev.sh` (Caddy proxy at
  `https://overlens.test`, honors `$PORT`)
- `bun run compile` — one-off build to `compiled/` (what Vercel runs)

## Architecture

- **vibe compiled SPA** (npm `@ape-egg/vibe` + `@ape-egg/vibe-compiler`): the
  `pages/` tree becomes fragments + route table + shell. Routes:
  `/` (landing), `/$owner/$repo/pull/$n` (inspector), `$$rest` catch-all
  (landing + URL-format hint).
- **[js/github.js](js/github.js)** — the data layer. Branch tips resolve once
  per load, then everything is fetched by immutable commit sha and cached in
  memory. Tokenless: `raw.githubusercontent.com` (public repos). With a token
  (`localStorage.overlens-token`): the Git Blobs API — base64 JSON, up to
  100MB, because the Contents API caps files at 1MB. Status mapping: 404 on
  the pr ref with a visible repo = `no-data`; invisible repo or 401/403 =
  `gate`; missing report.json = `no-report`; empty `pages` = `clean`.
- **[js/diff.js](js/diff.js)** — the Difference mode: canvas pixel diff over
  the union of both images (~2% per-channel fuzz, like the workflow), red over
  a dimmed base, computed lazily and cached per (page, variant). Area only one
  image covers (height deltas) renders dimmed, never red — matching the
  workflow's diffPercent, which only counts the shared area.
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

## Data contract

Produced by each consumer repo's Overlens workflow (see `sesamyab/account2`,
PR #143 added the report):

```
<viewport>-<theme>/<page>.png   desktop|mobile × light|dark, slugified paths
report.json                     overlens/pr-* branches only, at the root
```

`report.json`: `{ baseSha, sourcePr, sourceSha, pages: [{ file, status,
diffPercent? }] }` — status `added` | `changed` | `removed`, `diffPercent`
counting mismatches within the area both images share. A page differing only
in height is not a change and never reaches the report. A missing
report.json is a hard stop ("re-run Overlens"), not a fallback render. The
inspector warns with a `base drift` badge when `baseSha` no longer matches the
`overlens/dev` tip.

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

## Pending upstream

vibe's `fetchable-src-parking` branch (local repo) stops the browser from
fetching literal `@[...]` src bindings on template mount — verified here.
Until it ships as `@ape-egg/vibe` 3.0.5 and the dependency is bumped, dev
consoles show harmless 404s for `@[p.cur.*Url]` requests (npm 3.0.4 lacks
the fix; `bun run compile` reinstalls it into `compiled/`).
