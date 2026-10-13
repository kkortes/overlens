import { $ } from 'bun';
import { cpSync, rmSync } from 'fs';
import { fileURLToPath } from 'url';

const crawler = fileURLToPath(new URL('../crawler', import.meta.url));
const { dependencies } = await Bun.file(`${crawler}/package.json`).json();

// The crawl runs in the Playwright image matching the crawler's exact pin, so
// every snapshot rasterises text on one font stack whatever the runner is.
const image = `mcr.microsoft.com/playwright:v${dependencies['@playwright/test']}-noble`;

export default async (url) => {
  const workspace = process.cwd();
  const dir = `${workspace}/.overlens/crawler`;
  rmSync(dir, { recursive: true, force: true });
  cpSync(crawler, dir, { recursive: true });
  await $`docker run --rm --ipc=host --user ${`${process.getuid()}:${process.getgid()}`} -e HOME=/tmp -e CI=true -e OVERLENS=1 -e PLAYWRIGHT_BASE_URL=${url} -v ${`${workspace}:${workspace}`} -w ${dir} ${image} sh -c ${'npm install --no-audit --no-fund && npx playwright test overlens.spec'}`;
  return `${dir}/overlens-output`;
};
