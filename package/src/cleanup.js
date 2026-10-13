import { $ } from 'bun';

import { openPullOf, repo } from './github.js';

export default async (n) => {
  const pr = await openPullOf(`overlens/pr-${n}`, 'number');
  if (pr) await $`gh pr close -R ${repo} ${pr}`;
  // A PR that never got a snapshot has no branch to delete.
  await $`gh api -X DELETE repos/${repo}/git/refs/heads/overlens/pr-${n}`.nothrow();
};
