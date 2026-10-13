import { $ } from 'bun';
import { existsSync } from 'fs';

import cleanup from './cleanup.js';
import crawl from './crawl.js';
import publish from './publish.js';
import report from './report.js';
import { event, lines, openPullOf, remote, repo, sha } from './github.js';

const environments = process.env.ENVIRONMENTS || 'Preview|Production';

// The workflow checks nothing out: the deployed commit alone, with no history,
// is all the crawl reads.
const checkout = async () => {
  await $`git init -q`;
  await $`git fetch -q --depth 1 ${remote} ${sha}`;
  await $`git checkout -q FETCH_HEAD`;
};

const slugOf = async (targetBranch) => {
  const heads = lines(await $`gh api repos/${repo}/commits/${sha}/branches-where-head -q ${'.[].name'}`.text());
  if (!heads.length) {
    console.info(`${sha} is no longer the tip of a branch — superseded deploy, skipping`);
    return {};
  }
  if (heads.includes(targetBranch)) return { branch: targetBranch, slug: 'dev' };
  for (const branch of heads) {
    const pr = await openPullOf(branch, 'number');
    if (pr) return { branch, slug: `pr-${pr}`, pr: Number(pr) };
  }
  console.info(`${heads.join(', ')} has no open PR — nothing to compare`);
  return {};
};

export default async () => {
  const { state, target_url: url, environment } = event.deployment_status;
  if (state !== 'success' || !url) return console.info(`Deployment is ${state}${url ? '' : ' without a URL'} — nothing to crawl.`);
  await cleanup();
  if (!new RegExp(environments).test(environment)) return console.info(`"${environment}" doesn't match /${environments}/ — not a deployment Overlens crawls`);
  await checkout();
  if (!['overlens.config.ts', 'overlens.config.js'].some(existsSync)) return console.info('No overlens.config at this commit — nothing to crawl.');

  process.env.PLAYWRIGHT_BASE_URL = url;
  const { targetBranch, createPR = true } = (await import(`${process.cwd()}/overlens.config`)).default;
  if (!targetBranch) throw new Error('overlens.config must set targetBranch');

  const { branch, slug, pr } = await slugOf(targetBranch);
  if (!slug) return;
  const output = await crawl(url);
  // A newer deploy of the branch, or a closed PR, settles it while this one crawled.
  if ((await slugOf(targetBranch)).slug !== slug) return;
  const published = await publish({ output, branch, slug, pr });
  if (pr) await report({ ...published, output, slug, pr, createPR });
};
