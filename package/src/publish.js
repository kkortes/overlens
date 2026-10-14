import { $ } from 'bun';
import { cpSync, existsSync, rmSync } from 'fs';
import { tmpdir } from 'os';

import { lines, remote, repo, sha, short } from './github.js';

// diffPercent counts mismatches within the area both images share; `pad` is
// what only the larger one covers, so a height-only change reads 0 here.
const diff = async (dir, file, baseline) => {
  const sizes = (await $`identify -format ${'%w %h '} ${baseline} ${file}`.cwd(dir).nothrow().quiet().text()).trim().split(' ').map(Number);
  const [w1, h1, w2, h2] = sizes;
  const overlap = sizes.length === 4 ? `${Math.min(w1, w2)}x${Math.min(h1, h2)}` : 'x';
  const area = sizes.length === 4 ? Math.min(w1, w2) * Math.min(h1, h2) : 0;
  const pad = sizes.length === 4 ? Math.max(w1, w2) * Math.max(h1, h2) - area : 0;
  const { stdout, stderr } = await $`compare -fuzz 5% -metric AE ${`${baseline}[${overlap}+0+0]`} ${`${file}[${overlap}+0+0]`} null:`.cwd(dir).nothrow().quiet();
  const ae = `${stderr}${stdout}`.match(/^[0-9.eE+-]+/m)?.[0] ?? '';
  const mismatches = ae && !/e/i.test(ae) && parseInt(ae) <= 32 ? '0' : ae;
  return { mismatches, area, pad };
};

const percent = (mismatches, area) =>
  Number(mismatches) > 0 && area > 0 ? `${(Number(mismatches) * 100 / area).toFixed(2).replace(/\.?0+$/, '')}%` : '';

const imagemagick = async () => {
  if (Bun.which('compare')) return;
  await $`sudo apt-get -o Acquire::Retries=3 update`;
  await $`sudo apt-get install -y --no-install-recommends -o Acquire::Retries=3 imagemagick`;
};

// overlens/dev's history newest first, each commit with the targetBranch
// commit it snapshots, read off its `<branch> @ <sha>` message.
const snapshotsOf = async (git) =>
  lines(await git`git log --format=${'%H %s'} origin/overlens/dev`.text()).map((line) => {
    const [commit, ...subject] = line.split(' ');
    return { commit, source: subject.at(-1) };
  });

const tipOf = async (branch) => (await $`gh api repos/${repo}/commits/${branch} -q .sha`.text()).trim();

// targetBranch's own crawl of the merge base may still be running when the
// PR's finishes. While the merge base is still the tip, its snapshot is due:
// every finished targetBranch crawl commits, changed or not.
const wait = { every: 30_000, tries: 20 };

// A PR compares against the snapshot of the commit it branched from — the
// merge base with targetBranch — or that commit's nearest snapshotted
// ancestor, so what merged into targetBranch since never reads as its change.
const baselineOf = async (git, targetBranch) => {
  let { mergeBase, moved } = await $`gh api repos/${repo}/compare/${sha}...${targetBranch} -q ${'{ mergeBase: .merge_base_commit.sha, moved: (.ahead_by > 0) }'}`.json();
  let snapshots = await snapshotsOf(git);
  for (let n = 0; !moved && !snapshots.some(({ source }) => source === short(mergeBase)) && n < wait.tries; n++) {
    console.info(`Waiting for ${targetBranch}'s snapshot of ${short(mergeBase)}`);
    await Bun.sleep(wait.every);
    await git`git fetch -q origin`;
    snapshots = await snapshotsOf(git);
    moved = (await tipOf(targetBranch)) !== mergeBase;
  }
  // Every snapshot is of a commit targetBranch reached, so one it reached
  // after the merge base is the only kind that isn't an ancestor of it.
  const after = new Set(moved ? lines(await $`gh api --paginate repos/${repo}/compare/${mergeBase}...${targetBranch} -q ${'.commits[].sha'}`.text()).map(short) : []);
  const baseline = snapshots.find(({ source }) => !after.has(source)) ?? snapshots.at(-1);
  return { commit: baseline.commit, moved, late: !moved && baseline.source !== short(mergeBase) && mergeBase };
};

export default async ({ output, branch, slug, pr, targetBranch }) => {
  await imagemagick();
  const dir = `${tmpdir()}/overlens-publish`;
  const baseline = `${tmpdir()}/overlens-baseline.png`;
  rmSync(dir, { recursive: true, force: true });
  const devExists = Boolean((await $`git ls-remote ${remote} refs/heads/overlens/dev`.text()).trim());
  if (devExists) await $`git clone -q --filter=blob:none --branch overlens/dev ${remote} ${dir}`;
  else await $`git init -q -b ${`overlens/${slug}`} ${dir}`;

  const git = (strings, ...values) => $(strings, ...values).cwd(dir);
  const { commit, moved, late } = devExists && slug !== 'dev' ? await baselineOf(git, targetBranch) : {};
  if (commit) await git`git checkout -q ${commit}`;
  await git`git config user.name ${'github-actions[bot]'}`;
  await git`git config user.email ${'41898282+github-actions[bot]@users.noreply.github.com'}`;
  const baseSha = (await git`git rev-parse -q --verify HEAD`.nothrow().text()).trim();
  cpSync(output, dir, { recursive: true });
  await Bun.write(`${dir}/vercel.json`, '{ "git": { "deploymentEnabled": false } }\n');

  const stats = new Map();
  if (baseSha) {
    for (const file of lines(await git`git ls-files ${'*.png'}`.text()))
      if (!existsSync(`${output}/${file}`)) await git`git rm -q ${file}`;
    for (const file of lines(await git`git diff --name-only -- ${'*.png'}`.text())) {
      await Bun.write(baseline, await git`git show ${`HEAD:${file}`}`.blob());
      const { mismatches, area, pad } = await diff(dir, file, baseline);
      const share = percent(mismatches, area);
      if (mismatches === '0' && (slug !== 'dev' || pad === 0)) await git`git checkout -q -- ${file}`;
      else if (share) stats.set(file, share);
    }
  }
  const baselinePages = baseSha ? await git`git show HEAD:pages.txt`.nothrow().quiet().text() : '';

  await git`git add -A`;
  const staged = lines(await git`git diff --cached --no-renames --name-status -- ${'*.png'}`.text()).map((line) => line.split('\t'));

  if (slug !== 'dev') {
    const pages = staged.map(([status, file]) => ({
      file,
      status: { A: 'added', D: 'removed' }[status[0]] ?? 'changed',
      ...(stats.has(file) && { diffPercent: parseFloat(stats.get(file)) }),
    }));
    await Bun.write(`${dir}/report.json`, `${JSON.stringify({ baseSha: baseSha || null, sourcePr: pr, sourceSha: sha, pages }, null, 2)}\n`);
    await git`git add report.json`;
  }

  // targetBranch commits every crawl, changed or not, so a PR waiting on the
  // snapshot of its merge base can tell "not crawled yet" from "unchanged".
  if (slug === 'dev' || (await git`git diff --cached --quiet`.nothrow()).exitCode) {
    await git`git commit -q --allow-empty -m ${`${branch} @ ${short(sha)}`}`;
    await git`git push -qf ${remote} ${`HEAD:refs/heads/overlens/${slug}`}`;
  }

  return { staged, stats, baselinePages, devExists, moved, late };
};
