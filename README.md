# Overlens

The inspector at [overlens.korte.kim](https://overlens.korte.kim) and the npm package [`@ape-egg/overlens`](package/) that feeds it.

- `bun dev` — the site at `https://overlens.localhost`.
- `bun run compile` — the site to `compiled/`.
- `bun publish:check` — lists what `package/` would ship, with `npm pack --dry-run`.
- Pushing a `v<version>` tag publishes `package/` to npm with provenance, from [.github/workflows/publish.yml](.github/workflows/publish.yml).
