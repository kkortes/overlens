import { $ } from 'bun';
import { existsSync } from 'fs';

import crawl from './crawl.js';
import publish from './publish.js';
import report from './report.js';
import { event, openPullOf, sha } from './github.js';

const environments = process.env.ENVIRONMENTS || 'Preview|Production';

const slugOf = async (targetBranch) => {
  const name = (await $`git name-rev --name-only --exclude ${'tags/*'} ${sha}`.text()).trim();
  const branch = name.replace(/^remotes\/origin\//, '').replace(/[~^].*$/, '');
  const tip = (await $`git rev-parse -q --verify ${`origin/${branch}`}`.nothrow().text()).trim();
  if (tip !== sha) {
    console.info(`${sha} is no longer the tip of ${branch} — superseded deploy, skipping`);
    return {};
  }
  if (branch === targetBranch) return { branch, slug: 'dev' };
  const pr = await openPullOf(branch, 'number');
  return pr ? { branch, slug: `pr-${pr}`, pr: Number(pr) } : {};
};

export default async () => {
  const { state, target_url: url, environment } = event.deployment_status;
  if (state !== 'success' || !url) return console.info(`Deployment is ${state}${url ? '' : ' without a URL'} — nothing to crawl.`);
  if (!new RegExp(environments).test(environment)) return console.info(`"${environment}" doesn't match /${environments}/ — not a deployment Overlens crawls`);
  if (!['overlens.config.ts', 'overlens.config.js'].some(existsSync)) return console.info('No overlens.config at this commit — nothing to crawl.');

  process.env.PLAYWRIGHT_BASE_URL = url;
  const { targetBranch, createPR = true } = (await import(`${process.cwd()}/overlens.config`)).default;
  if (!targetBranch) throw new Error('overlens.config must set targetBranch');

  const output = await crawl(url);
  const { branch, slug, pr } = await slugOf(targetBranch);
  if (!slug) return;
  const published = await publish({ output, branch, slug, pr });
  if (pr) await report({ ...published, output, slug, pr, createPR });
};
