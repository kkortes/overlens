# Overlens — implementation spec

A stateless website that renders visual-regression diffs by reading GitHub
directly. No accounts, no database — GitHub is the database. The URL is the
query.

## URL model

| URL | Renders |
| --- | --- |
| `/` | Landing page: what Overlens is, one screenshot, GitHub link |
| `/{owner}/{repo}/pull/{n}` | The inspector for source PR `n` of that repo |
| anything else | Landing, with a hint about the URL format |

`/{owner}/{repo}/pull/{n}` reads two branches of `{owner}/{repo}`:

- **head**: `overlens/pr-{n}` (tip)
- **base**: `overlens/dev` (tip)

Tips are compared deliberately (shows "what would merge mean today"). The
inspector shows a drift warning when `report.json`'s `baseSha` is no longer
the tip of `overlens/dev`.

## Data contract

Snapshot branches are produced by each consumer repo's Overlens workflow
(see `sesamyab/account2`: `overlens.yml`, `tests/overlens.spec.ts`,
`overlens.config.ts`, `overlens.md`). Layout:

```
<viewport>-<theme>/<page>.png     e.g. desktop-light/home.png
report.json                       at branch root, overlens/pr-* only
```

Viewports: `desktop`, `mobile`. Themes: `light`, `dark`. Page names are
slugified paths (`settings_personal-info.png`, `subscriptions_[id].png`).

`report.json` is a **hard requirement** — no fallback rendering. Schema:

```json
{
  "baseSha": "<sha of overlens/dev the run compared against>",
  "sourcePr": 120,
  "sourceSha": "<sha of the source repo commit that was crawled>",
  "pages": [
    { "file": "desktop-light/home.png", "status": "changed", "diffPercent": 4.2 }
  ]
}
```

`status`: `added` (no base image) | `changed` | `removed` (no head image).
`diffPercent` is normalized by the union area of both images (height deltas
count as difference).

> Upstream status: generating `report.json` in account2's `overlens.yml` is
> part of this effort and must land before the inspector can render anything.
> A branch missing `report.json` renders an explicit "this branch predates
> report.json — re-run Overlens" state.

## Reading from GitHub

- **Public repos, no auth**: images from
  `raw.githubusercontent.com/{owner}/{repo}/{branch}/{path}`; one API call
  (`GET /repos/{o}/{r}/contents/report.json?ref=...`) for the manifest.
- **Private repos**: everything through `api.github.com` with the user's
  token (GitHub's API supports CORS from browsers). Files > 1MB fail the
  Contents API — use the Git Blobs API (base64 JSON, up to 100MB) and
  object-URL the decoded bytes. Screenshots regularly exceed 1MB; always use
  the blobs path when authenticated.
- Cache aggressively: everything is keyed by commit SHA and immutable.
  Resolve branch → SHA once per load, then fetch by SHA.

## Auth

- **GitHub App** (not OAuth App): Contents read-only, per-repo installation.
  The pitch is "read-only lens, revoke anytime" — scopes must match it.
- One serverless function (Vercel) exchanges the OAuth code for a user
  access token. Token goes in `localStorage`; every GitHub call happens from
  the browser. No sessions, no server state.
- Unauthorized private repo → the inspector route renders a gate: "Sign in
  with GitHub / Install the Overlens app on this repo", then retries.
- Distinguish states: 404 on `overlens/pr-{n}` ref = "no Overlens data for
  this PR" (not an auth problem); 401/403 = gate.

## The inspector

One vertically scrolling list of **all pages** (not pages × 4 variants) using
stylecheat's fullpage vertical carousel:

```html
<carousel>
  <slides y>
    <section><!-- one page per slide --></section>
    ...
  </slides>
</carousel>
```

Each slide fills the viewport and shows one page's comparison, with:

- **Title + metadata**: page name (derive from filename: `settings_personal-info`
  → `settings / personal-info`), `diffPercent`, `status` badge
  (added/changed/removed).
- **Top-right corner: the controls.**
  - Mode filter: **Split** (default) | Onion | 2-up.
    - *Split*: base and head stacked top-aligned at 1:1 scale; a draggable
      vertical handle reveals head-left / base-right (clip-path driven by
      the handle position).
    - *Onion*: opacity slider blending the two, top-aligned 1:1.
    - *2-up*: side by side. This is the mode that stays honest below a
      reflow point — a changed element's height shifts everything after it,
      so overlays drift there by design.
  - **Desktop / Smartphone** toggle — default Desktop.
  - **Light / Dark** toggle — default Light.
  - **Difference** toggle ("red dot"): client-side canvas pixel diff of the
    current pair, rendered as red highlights. While active, Split/Onion/2-up
    are disabled (the mode group is inert until Difference is toggled off).
- The viewport/theme toggles select which variant (`<viewport>-<theme>/`)
  of every page is displayed; switching them swaps images in place, keeping
  scroll position and mode.
- A page can be `added`/`removed` in one variant and `changed` in another;
  a slide with no image for the current variant says so instead of
  rendering stale pixels.
- Images render top-aligned at natural width scaled to fit the slide, both
  sides at the **same scale** (this is the whole point — GitHub's swipe
  scales sides independently when heights differ).

## Stack

- **vibe** (runtime-first reactive framework) + **stylecheat** — scaffold by
  copying `~/Projects/webdev/vibe-spa-project` (pages/, components/, css/,
  dev.js, compiled/) and stripping demo content. Follow its routing and
  build conventions; consume stylecheat the same way sibling vibe apps do.
- Keep it as small as possible: no state library, no build additions.
  Client-side route parsing; Vercel `rewrites` catch-all to `index.html`.
- Canvas diff for the Difference toggle: decode both images to
  `OffscreenCanvas`, compare pixels (fuzz tolerance ~2% like the workflow),
  paint mismatches red over a dimmed base. Compute lazily per slide, cache
  the result per (page, variant).

## Deploy

- Repo: `github.com/kkortes/overlens` (private).
- Vercel free tier; `overlens.vercel.app` until `overlens.com` is bought.
- Env vars for the exchange function: GitHub App client id + secret.

## Manual steps (owner only)

1. Register the GitHub App: Contents read-only, callback = Vercel domain,
   generate client id/secret → Vercel env.
2. Create/link the Vercel project to `kkortes/overlens`.
3. Check `overlens.com` availability.

## Execution order

1. `report.json` generation in account2's `overlens.yml` → PR to `dev`
   (unblocks everything; next run makes account2 PRs viewable).
2. Scaffold from `vibe-spa-project`; landing + route parsing.
3. Data layer against a public repo (tokenless raw path) — testable without
   the GitHub App existing.
4. Inspector: carousel, Split, toggles, metadata; then Onion, 2-up,
   Difference.
5. Auth gate + token exchange once the GitHub App is registered.
