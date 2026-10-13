#!/usr/bin/env bun
import init from '../src/init.js';
import snapshot from '../src/snapshot.js';
import cleanup from '../src/cleanup.js';
import { event } from '../src/github.js';

const ci = {
  deployment_status: snapshot,
  pull_request: () => event.action === 'closed' && cleanup(event.pull_request.number),
};

const [command] = process.argv.slice(2);
const commands = { init };

await (commands[command] ?? ci[process.env.GITHUB_EVENT_NAME] ?? (() => {
  throw new Error(`overlens: run \`overlens init\` in a repo, or from the Overlens workflow (got "${command ?? process.env.GITHUB_EVENT_NAME ?? ''}")`);
}))();
