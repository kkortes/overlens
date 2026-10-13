#!/usr/bin/env bun
import init from '../src/init.js';
import snapshot from '../src/snapshot.js';

const [command] = process.argv.slice(2);
const commands = { init };
const ci = { deployment_status: snapshot };

await (commands[command] ?? ci[process.env.GITHUB_EVENT_NAME] ?? (() => {
  throw new Error(`overlens: run \`overlens init\` in a repo, or from the Overlens workflow (got "${command ?? process.env.GITHUB_EVENT_NAME ?? ''}")`);
}))();
