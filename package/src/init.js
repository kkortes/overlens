import { copyFileSync, existsSync, mkdirSync } from 'fs';
import { dirname } from 'path';

const files = {
  'overlens.config.ts': 'overlens.config.ts',
  '.github/workflows/overlens.yml': 'overlens.yml',
};

export default () => {
  Object.entries(files).forEach(([target, template]) => {
    if (existsSync(target)) return console.info(`kept     ${target}`);
    mkdirSync(dirname(target), { recursive: true });
    copyFileSync(new URL(`../templates/${template}`, import.meta.url), target);
    console.info(`created  ${target}`);
  });
  console.info(`
Next:
  1. Set targetBranch, the passes and how your app switches theme in overlens.config.ts
  2. Commit both files to targetBranch and deploy it once: that run is the baseline
  3. Open a PR: its next preview deploy lands at https://overlens.korte.kim/{owner}/{repo}/pull/{n}`);
};
