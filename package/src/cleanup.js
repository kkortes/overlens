import { $ } from 'bun';

import { lines, openPullOf, repo } from './github.js';

// Every successful deploy retires the snapshot branch and draft PR of each
// PR closed since, so the workflow needs no pull_request trigger.
export default async () => {
  const refs = lines(await $`gh api repos/${repo}/git/matching-refs/heads/overlens/pr- -q ${'.[].ref'}`.text());
  for (const ref of refs) {
    const n = ref.split('/overlens/pr-').pop();
    const { state } = await $`gh pr view ${n} -R ${repo} --json state`.json();
    if (state === 'OPEN') continue;
    const draft = await openPullOf(`overlens/pr-${n}`, 'number');
    if (draft) await $`gh pr close -R ${repo} ${draft}`;
    // A concurrent run may have deleted it first.
    await $`gh api -X DELETE repos/${repo}/git/refs/heads/overlens/pr-${n}`.nothrow();
  }
};
