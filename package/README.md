# @ape-egg/overlens

Visual regression review, straight from GitHub, run from a workflow with `bunx`. Guide and inspector: [overlens.korte.kim](https://overlens.korte.kim).

On every successful deployment it crawls the deploy, screenshots every reachable page across viewport/theme passes, diffs against the baseline, pushes `overlens/dev` and `overlens/pr-{n}` snapshot branches and maintains a summary in the source PR — all inspectable at `overlens.korte.kim/{owner}/{repo}/pull/{n}`.

## Setup

```sh
bunx @ape-egg/overlens init      # writes the two files below
git add -A && git commit -m "add overlens" && git push
```

- `overlens.config.ts`: the entry pages, the viewport/theme passes, how your app switches theme and the `targetBranch` PRs are compared against.
- `.github/workflows/overlens.yml`: the trigger, the token's permissions and a call to the shared workflow, which runs `bunx @ape-egg/overlens@1` with the repo's own `GH_TOKEN`:

```yaml
name: Overlens
on: deployment_status
permissions: { contents: write, pull-requests: write }
jobs:
  Overlens:
    uses: kkortes/overlens/.github/workflows/run.yml@v1
```

Every other line a workflow usually carries is the package's job. It checks out the deployed commit itself, skips deployments that didn't succeed, skips a deploy that's no longer its branch's tip (before the crawl and again before pushing), and retires the snapshot branch and draft PR of every closed PR on the next successful deploy.

The crawl runs in the Playwright container image matching the crawler's own exact-pinned Playwright, so the runner needs Docker (every GitHub-hosted Linux runner has it). Your repo installs nothing, and your `overlens.config` is imported straight from source, so it must stay free of npm dependencies (type-only imports are erased and fine).

Land it on `targetBranch` first: until that branch has deployed once there is no `overlens/dev` to compare against, so a PR opened before then reports every page as new.

## Inputs

All optional — the defaults cover Vercel. Pass them under `with:` on the job, e.g. `with: { environments: Staging, runs-on: blacksmith-4vcpu-ubuntu-2404 }`.

| input | default | |
| --- | --- | --- |
| `environments` | `Preview\|Production` | regex a deployment's environment name must match |
| `inspector` | `https://overlens.korte.kim` | origin the report links point to |
| `runs-on` | `ubuntu-26.04` | runner label the crawl runs on |

The shared workflow hands them to the package as the `ENVIRONMENTS` and `INSPECTOR` env vars.

## Commands

The workflow runs `overlens` with no argument on `deployment_status`:

- A successful deployment with a URL, whose environment matches `ENVIRONMENTS`, at a commit carrying an `overlens.config`, is crawled. A deploy of `targetBranch` adds a snapshot commit to `overlens/dev`, changed or not; a deploy of a branch with an open PR lands on `overlens/pr-{n}` with a `report.json`, a draft PR into `overlens/dev` when pages changed (unless `createPR: false`), and a summary between `<!-- overlens:summary -->` markers in the source PR's description. A deploy that's no longer its branch's tip, or of a branch without an open PR, is skipped.
- A PR is compared against the snapshot of its merge base with `targetBranch` — the commit it branched from, or its nearest snapshotted ancestor — not the latest one, so what merged into `targetBranch` since never shows up as its change. Merging `targetBranch` in moves it to the latest snapshot, and the summary says when `targetBranch` has moved on. When the merge base is still `targetBranch`'s tip and its own crawl hasn't landed yet, the PR's run waits for it up to 10 minutes, then compares against the nearest older snapshot and says so.
- Every successful deployment first closes the draft snapshot PR and deletes `overlens/pr-{n}` of each PR closed since.

`overlens init` also runs by name.

## Pressed states

A drawer, menu or dialog is only on screen after a click. Mark the element that opens it with a bare `data-overlens-press` and the crawl shoots the opened state too — no config needed:

```html
<button data-overlens-press>Edit</button>
```

The attribute counts when it's bare, empty or `"true"` — React renders a bare JSX `<button data-overlens-press>` as `data-overlens-press="true"`. Any other value, `"false"` included, isn't a press.

After a page's own passes, each pass (viewport and theme) presses every marked element on screen, waits until running animations finish and the page settles, and shoots whatever the press produced — a drawer, a menu, a modal, revealed content, anything. The crawl never looks at what opened. The state is named after the pressed element's own label (`aria-label`, else its text) and shot as `<viewport>-<theme>/<page>~<name>.png`. Marked elements the pressed state shows are pressed next and shot as `<page>~<name>~<nested>.png`. When two presses on a page share a name, the later one gets its place among the page's presses appended, `<page>~<name>-<n>.png`.

- **One shot per group** — marked elements with the same tag-and-class ancestry are a group (the rows of a list). A state is identified by its page and the group of the press that produced it, so only the first of a group is pressed and shot; ten rows opening a drawer titled with their own record give one snapshot, named after the first row. The flip side: siblings that share ancestry but open different things (tabs, a toolbar of plain buttons) are one group too, so give each a class of its own when every one should be shot.
- **Per page** — the same drawer reached from several pages is shot under each of them.
- **Pressed once** — each marked element is recorded by its place among the page's presses, so nothing is pressed twice within a page's crawl and a button still visible behind its own drawer isn't explored again.
- **No leaks** — every state starts from a fresh load of the page and replays its press chain. State the press persists (localStorage, the server) does carry over, so only mark presses that open things.
- **Time** — each press is a full page load, counted against `timeoutMinutes`; the rest of a group is never pressed, so it costs nothing.

## Masks

Content that changes on every render — a clock, an avatar, a live counter — is covered with a solid box in every screenshot when its element carries `data-overlens-mask`:

```html
<time data-overlens-mask>12:04</time>
```

The attribute counts when it's bare, empty or `"true"` — React renders a bare JSX `<time data-overlens-mask>` as `data-overlens-mask="true"`. Any other value, `"false"` included, leaves the element unmasked. The config's `mask` adds CSS selectors on top; it never replaces the attribute.
