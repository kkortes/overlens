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
- **[js/diff.js](js/diff.js)** — the Difference toggle: canvas pixel diff over
  the union of both images (~2% per-channel fuzz, like the workflow), red over
  a dimmed base, computed lazily and cached per (page, variant).
- **[components/Inspector.html](components/Inspector.html)** — stylecheat
  fullpage vertical carousel, one slide per page. One mode group: Difference
  (default), Split (clip-path + drag handle, PR left / base right), Onion
  (opacity slider), 2-up (shared-scale columns). Viewport/theme toggles pick
  the `<viewport>-<theme>/` variant in place; a slide whose page has no diff
  in the current variant renders no comparison — just a centered "Visual
  regression in" note with device buttons that jump there.
  Both sides always render at the
  same scale, top-aligned, never upscaled past 1:1 — height drift below a
  reflow point is honest by design.
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
normalized by the union area of both images (height deltas count). A missing
report.json is a hard stop ("re-run Overlens"), not a fallback render. The
inspector warns with a `base drift` badge when `baseSha` no longer matches the
`overlens/dev` tip.

`kkortes/overlens-fixture` (public) holds synthetic branches covering every
state: pr-1 (changes incl. reflow + variant-specific), pr-2 (clean),
pr-3 (no report). Regenerate with the scripts noted in that repo's history.

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
