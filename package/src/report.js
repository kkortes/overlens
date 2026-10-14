import { $ } from 'bun';
import { createHash } from 'crypto';
import { tmpdir } from 'os';

import { openPullOf, repo, short } from './github.js';

const inspector = process.env.INSPECTOR || 'https://overlens.korte.kim';
const start = '<!-- overlens:summary -->';
const end = '<!-- /overlens:summary -->';

const unique = (list) => [...new Set(list)].sort();
const split = (text, by) => (text ? text.split(by) : []);
const share = (part, total) => `${(part * 100 / total).toFixed(1).replace(/\.0$/, '')}%`;

// The file base a page's snapshots are named by: /customers/[id]~edit → customers_[id]~edit
const base = (page) => {
  const [path, ...states] = page.split('~');
  const name = path === '/' ? 'home' : path.slice(1).replaceAll('_', '__').replaceAll('/', '_');
  return [name, ...states].join('~');
};
const baseOf = (file) => file.replace(/^[^/]+\//, '').replace(/\.png$/, '');

const sitemap = (pages, changed) => {
  const ids = new Map();
  const id = (path) => ids.get(path) ?? ids.set(path, `n${ids.size + 1}`).get(path);
  const label = (segment) => segment.replaceAll('[', '(').replaceAll(']', ')');
  const known = new Set();
  const edges = [];
  const link = (parent, path, arrow, text) => {
    if (known.has(path)) return;
    known.add(path);
    edges.push(`${id(parent)} ${arrow} ${id(path)}["${label(text)}"]`);
  };
  pages.forEach((page) => {
    const [route, ...states] = page.split('~');
    const path = split(route.slice(1), '/').reduce((parent, segment) => {
      const path = `${parent === '/' ? '' : parent}/${segment}`;
      link(parent, path, '-->', segment);
      return path;
    }, '/');
    states.reduce((parent, state) => {
      const path = `${parent}~${state}`;
      link(parent, path, '-.->', `~${state}`);
      return path;
    }, path);
  });
  return [
    '```mermaid',
    'graph TD',
    `  ${id('/')}["/"]`,
    ...edges.map((edge) => `  ${edge}`),
    '  classDef changed fill:#fecaca,stroke:#dc2626,color:#7f1d1d',
    '  classDef same fill:#dcfce7,stroke:#16a34a,color:#14532d',
    ...pages.map((page) => `  class ${id(page)} ${changed.includes(base(page)) ? 'changed' : 'same'}`),
    '```',
  ].join('\n');
};

const bodyFile = async (name, text) => {
  const file = `${tmpdir()}/overlens-${name}.md`;
  await Bun.write(file, text);
  return file;
};

export default async ({ staged, stats, baselinePages, devExists, moved, late, output, slug, pr, createPR, targetBranch }) => {
  const changed = unique(staged.map(([, file]) => baseOf(file)));
  const removed = unique(staged.filter(([status]) => status === 'D').map(([, file]) => baseOf(file)));
  const current = await Bun.file(`${output}/pages.txt`).text();
  const pages = unique([...split(baselinePages, '\n').filter((page) => removed.includes(base(page))), ...split(current, '\n')]).filter(Boolean);
  const total = pages.length;
  const lens = `${inspector}/${repo}/pull/${pr}`;
  const { title } = await $`gh pr view ${pr} -R ${repo} --json title`.json();
  const notes = [
    moved && `ℹ️ ${targetBranch} has moved on since this branch did; merge it in to compare against the latest snapshot.`,
    late && `ℹ️ ${targetBranch}'s snapshot of ${short(late)} hadn't landed yet, so this compares against an older one; re-run Overlens on this PR once it has.`,
  ].filter(Boolean);

  const files = staged.map(([status, file]) => {
    const label = { A: 'new', D: 'removed' }[status[0]] ?? stats.get(file) ?? 'changed';
    const anchor = createHash('sha256').update(file).digest('hex');
    return `[${file}](https://github.com/${repo}/compare/overlens/dev...overlens/${slug}#diff-${anchor}) (${label})`;
  });
  const body = [
    `This PR was programmatically created by Overlens. Triggered by PR: #${pr}`,
    '',
    `This diff can be viewed on the [Overlens website](${lens}).`,
    '',
    `✅ ${total - changed.length}/${total} (${share(total - changed.length, total)}) pages identical`,
    `⚠️ ${changed.length}/${total} (${share(changed.length, total)}) pages differentiate`,
    '',
    ...notes.flatMap((note) => [note, '']),
    ...files,
    '',
    sitemap(pages, changed),
    '',
  ].join('\n');

  const virtualTitle = `🎭 Overlens (${changed.length ? share(changed.length, total) : '✅ Clean'}) [${title}]`;
  let virtual = await openPullOf(`overlens/${slug}`, 'url');
  if (virtual) await $`gh pr edit ${virtual.split('/').pop()} -R ${repo} --title ${virtualTitle} --body-file ${await bodyFile('body', body)}`;
  else if (changed.length && createPR && devExists) {
    // A draft GitHub refuses (no commits between the branches) leaves the summary without a link.
    const created = await $`gh pr create -R ${repo} --draft --base overlens/dev --head ${`overlens/${slug}`} --title ${virtualTitle} --body-file ${await bodyFile('body', body)}`.nothrow();
    virtual = created.exitCode ? '' : created.text().trim();
  }

  const scanned = changed.length
    ? `🎭 Visual differences detected — ${share(changed.length, total)} of all pages have diffs. ${virtual ? `[PR was filed](${virtual}) · ` : ''}[View on Overlens](${lens})`
    : `✅ No visual differences. [View on Overlens](${lens})`;
  const summary = `## This PR was visually scanned through [Overlens](https://overlens.korte.kim)\n\n${[scanned, ...notes].join('\n\n')}\n`;

  const { body: source } = await $`gh pr view ${pr} -R ${repo} --json body`.json();
  let skip = false;
  const kept = split(source, '\n').filter((line) => {
    if (line.includes(start)) skip = true;
    const keep = !skip;
    if (line.includes(end)) skip = false;
    return keep;
  }).join('\n').replace(/\s+$/, '');
  await $`gh pr edit ${pr} -R ${repo} --body-file ${await bodyFile('source', `${kept ? `${kept}\n\n` : ''}${start}\n${summary}${end}\n`)}`;
};
