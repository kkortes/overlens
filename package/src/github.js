import { $ } from 'bun';

export const repo = process.env.GITHUB_REPOSITORY;
export const sha = process.env.GITHUB_SHA;
export const event = process.env.GITHUB_EVENT_PATH ? await Bun.file(process.env.GITHUB_EVENT_PATH).json() : {};
export const remote = `https://x-access-token:${process.env.GH_TOKEN}@github.com/${repo}.git`;

export const short = (commit) => commit.slice(0, 7);

export const lines = (text) => text.split('\n').filter(Boolean);

export const openPullOf = async (head, field) =>
  (await $`gh pr list -R ${repo} --head ${head} --state open --json ${field} -q ${`.[0].${field}`}`.text()).trim();
