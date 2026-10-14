// Stateless GitHub data layer. Branch tips resolve once per load, then every
// fetch is keyed by immutable commit sha: raw.githubusercontent.com when
// tokenless (public repos), the Git Blobs API when a token is present —
// the Contents API caps files at 1MB, blobs go to 100MB.
import config from '/js/config.js';
import diff from '/js/diff.js';

const API = 'https://api.github.com';
const store = { trees: new Map(), blobs: new Map(), urls: new Map() };
let seq = 0;
let diffChain = Promise.resolve();

// { token, refresh, expires } — GitHub App user tokens expire after 8 hours
// (expires_in), the refresh token mints the next one. A non-expiring token
// carries neither.
const session = () => JSON.parse(localStorage.getItem('overlens-session')) ?? {};
const token = () => session().token || '';
export const signedIn = () => !!token();

const exchange = async (grant) => {
  const res = await fetch('/api/exchange', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(grant),
  });
  const data = await res.json().catch(() => ({}));
  if (!data.access_token) throw new Error(data.error || `token exchange failed (${res.status})`);
  localStorage.setItem(
    'overlens-session',
    JSON.stringify({
      token: data.access_token,
      refresh: data.refresh_token,
      expires: data.expires_in && Date.now() + data.expires_in * 1000,
    }),
  );
};

// An expired token answers 401, which reads as "no access" — so swap it
// before the first API call rather than after GitHub rejects it. A refresh
// token GitHub no longer honours (6 months, or revoked) ends the session.
const renew = () => {
  const { refresh, expires } = session();
  if (!expires || expires - 60_000 > Date.now()) return;
  return exchange({ refresh_token: refresh }).catch(() => signOut(false));
};

const gh = async (path) => {
  const res = await fetch(`${API}${path}`, {
    headers: {
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      ...(token() && { Authorization: `Bearer ${token()}` }),
    },
  });
  if (!res.ok) throw Object.assign(new Error(`GitHub ${res.status} on ${path}`), { status: res.status });
  return res.json();
};

const tryRef = (owner, repo, branch) =>
  gh(`/repos/${owner}/${repo}/git/ref/heads/${branch}`).then(
    (r) => ({ sha: r.object.sha }),
    (e) => ({ status: e.status ?? 0 }),
  );

const tree = (owner, repo, sha) => {
  if (!store.trees.has(sha))
    store.trees.set(
      sha,
      gh(`/repos/${owner}/${repo}/git/trees/${sha}?recursive=1`)
        .then((t) => new Map(t.tree.filter((e) => e.type === 'blob').map((e) => [e.path, e.sha])))
        .catch((e) => {
          store.trees.delete(sha);
          throw e;
        }),
    );
  return store.trees.get(sha);
};

const fileBlob = (owner, repo, sha, path) => {
  const key = `${sha}:${path}`;
  if (!store.blobs.has(key))
    store.blobs.set(
      key,
      (async () => {
        if (token()) {
          const blobSha = (await tree(owner, repo, sha)).get(path);
          if (!blobSha) throw Object.assign(new Error(`${path} not in tree ${sha}`), { status: 404 });
          const blob = await gh(`/repos/${owner}/${repo}/git/blobs/${blobSha}`);
          const bin = atob(blob.content.replaceAll('\n', ''));
          return new Blob([Uint8Array.from(bin, (c) => c.charCodeAt(0))], { type: 'image/png' });
        }
        const res = await fetch(`https://raw.githubusercontent.com/${owner}/${repo}/${sha}/${path}`);
        if (!res.ok) throw Object.assign(new Error(`raw ${res.status} on ${path}`), { status: res.status });
        return res.blob();
      })().catch((e) => {
        store.blobs.delete(key);
        throw e;
      }),
    );
  return store.blobs.get(key);
};

const fileUrl = (owner, repo, sha, path) => {
  const key = `${sha}:${path}`;
  if (!store.urls.has(key))
    store.urls.set(
      key,
      fileBlob(owner, repo, sha, path)
        .then((b) => URL.createObjectURL(b))
        .catch((e) => {
          store.urls.delete(key);
          throw e;
        }),
    );
  return store.urls.get(key);
};

// PNG dimensions straight from the IHDR chunk — no decode needed.
const pngDims = async (blob) => {
  const b = new Uint8Array(await blob.slice(16, 24).arrayBuffer());
  return { w: ((b[0] << 24) | (b[1] << 16) | (b[2] << 8) | b[3]) >>> 0, h: ((b[4] << 24) | (b[5] << 16) | (b[6] << 8) | b[7]) >>> 0 };
};

// `settings_personal-info` → `settings / personal-info` (`__` is a literal
// underscore in the crawler's file naming, `_` is a path separator).
const prettyName = (name) =>
  name.replace(/__|_/g, (m) => (m === '__' ? '\u0000' : ' / ')).replaceAll('\u0000', '_');

const groupPages = (entries) => {
  const byName = new Map();
  for (const e of entries ?? []) {
    const [, variant, name] = e.file.match(/^([^/]+)\/(.+)\.png$/) ?? [];
    if (!variant) continue;
    if (!byName.has(name)) byName.set(name, { name, pretty: prettyName(name), variants: {}, cur: null });
    byName.get(name).variants[variant] = {
      status: e.status,
      diffPercent: e.diffPercent ?? 0,
      baseUrl: '',
      headUrl: '',
      diffUrl: '',
      baseW: 0,
      baseH: 0,
      headW: 0,
      headH: 0,
      error: '',
    };
  }
  return [...byName.values()];
};

const side = async (p, variant, which) => {
  const ins = $.inspector;
  const sha = which === 'base' ? ins.baseSha : ins.headSha;
  if (!sha) return;
  const path = `${variant}/${p.name}.png`;
  try {
    const [url, dims] = await Promise.all([
      fileUrl(ins.owner, ins.repo, sha, path),
      fileBlob(ins.owner, ins.repo, sha, path).then(pngDims),
    ]);
    const patch = { [`${which}Url`]: url, [`${which}W`]: dims.w, [`${which}H`]: dims.h };
    Object.assign(p.variants[variant], patch);
    if (p.cur?.key === variant) Object.assign(p.cur, patch);
  } catch (e) {
    p.variants[variant].error = `${which} screenshot failed to load (${e.status ?? 'network error'})`;
    if (p.cur?.key === variant) p.cur.error = p.variants[variant].error;
  }
};

// A page with no entry for the requested variant renders nothing — just a
// pointer to the devices that do differ (p.cur.fallback in the template).
export const loadVariant = (variant) => {
  for (const p of $.inspector.pages) {
    const v = p.variants[variant];
    p.cur = v ? { key: variant, fallback: false, ...v } : { key: variant, fallback: true };
    if (!v) continue;
    if (v.status !== 'added' && !v.baseUrl) side(p, variant, 'base');
    if (v.status !== 'removed' && !v.headUrl) side(p, variant, 'head');
  }
  if ($.view.mode === 'difference') ensureDiffs();
};

const queueDiff = (p, variant) => {
  const v = p.variants[variant];
  if (!v || v.diffUrl || v.status !== 'changed') return;
  diffChain = diffChain.then(async () => {
    if ($.view.mode !== 'difference' || v.diffUrl) return;
    const ins = $.inspector;
    const path = `${variant}/${p.name}.png`;
    try {
      const [base, head] = await Promise.all([
        fileBlob(ins.owner, ins.repo, ins.baseSha, path),
        fileBlob(ins.owner, ins.repo, ins.headSha, path),
      ]);
      v.diffUrl = await diff(base, head);
      if (p.cur?.key === variant) p.cur.diffUrl = v.diffUrl;
    } catch {
      v.error = 'difference computation failed';
      if (p.cur?.key === variant) p.cur.error = v.error;
    }
  });
};

export const ensureDiffs = () => {
  for (const p of $.inspector.pages) if (p.cur) queueDiff(p, p.cur.key);
};

export const loadInspector = async ({ owner, repo, n }) => {
  const run = ++seq;
  const ins = $.inspector;
  Object.assign(ins, {
    phase: 'loading',
    error: '',
    owner,
    repo,
    pr: +n,
    headSha: '',
    baseSha: '',
    drift: false,
    report: null,
    pages: [],
    passes: [],
    viewports: [],
    themes: [],
  });
  document.title = `${owner}/${repo} #${n} · Overlens`;

  await renew();
  if (run !== seq) return;
  const [head, base] = await Promise.all([
    tryRef(owner, repo, `overlens/pr-${n}`),
    tryRef(owner, repo, 'overlens/dev'),
  ]);
  if (run !== seq) return;

  if (!head.sha) {
    if (head.status === 404) {
      // Unauthenticated GitHub hides private repos behind 404 — only a
      // visible repo with a missing branch truly means "no Overlens data".
      const visible = await gh(`/repos/${owner}/${repo}`).then(() => true, () => false);
      if (run !== seq) return;
      ins.phase = visible ? 'no-data' : 'gate';
    } else if ([401, 403].includes(head.status)) {
      if (head.status === 401) signOut(false);
      ins.phase = 'gate';
    } else {
      ins.phase = 'error';
      ins.error = `GitHub returned ${head.status || 'a network error'} resolving overlens/pr-${n}`;
    }
    return;
  }
  ins.headSha = head.sha;
  ins.baseSha = base.sha || '';

  let report;
  try {
    report = JSON.parse(await (await fileBlob(owner, repo, head.sha, 'report.json')).text());
  } catch (e) {
    if (run !== seq) return;
    ins.phase = e.status === 404 ? 'no-report' : 'error';
    if (e.status !== 404) ins.error = e.message;
    return;
  }
  if (run !== seq) return;

  ins.report = { baseSha: report.baseSha, sourcePr: report.sourcePr, sourceSha: report.sourceSha };
  ins.drift = !!(report.baseSha && base.sha && report.baseSha !== base.sha);
  ins.pages = groupPages(report.pages);
  // The config's ordered pass list — its first entry is the landing variant,
  // and only its viewports/themes are offered. Reports from before the field
  // existed fall back to the variants the pages themselves carry.
  const passes = report.passes?.length
    ? report.passes
    : [...new Set((report.pages ?? []).map((e) => e.file.split('/')[0]))];
  ins.passes = passes;
  ins.viewports = [...new Set(passes.map((p) => p.split('-')[0]))];
  ins.themes = [...new Set(passes.map((p) => p.split('-')[1]))];
  ins.phase = ins.pages.length ? 'ready' : 'clean';
  const variant = passes.includes($.view.variant) ? $.view.variant : passes[0];
  if (variant) $.jumpVariant(variant);
};

export const signIn = () => {
  if (!config.clientId) return;
  location.href = `https://github.com/login/oauth/authorize?client_id=${config.clientId}&state=${encodeURIComponent(location.pathname)}`;
};

export const signOut = (reload = true) => {
  localStorage.removeItem('overlens-session');
  $.auth.authed = false;
  if (reload) location.reload();
};

// The GitHub App redirects to the site root with ?code — the landing page
// exchanges it, stores the session and returns to the inspector URL in ?state.
export const handleCallback = async () => {
  const q = new URLSearchParams(location.search);
  const code = q.get('code');
  if (!code) return;
  try {
    await exchange({ code });
    location.replace(q.get('state') || '/');
  } catch (e) {
    history.replaceState(null, '', '/');
    $.auth.error = e.message;
  }
};

// Both sides of a comparison render at one shared scale: the area maps its
// width to the wider image, never upscaling past 1:1 (100cqw of the nearest
// container). GitHub's swipe scales sides independently — this is the fix.
// Fit mode caps the union box by the area's height too, so a whole page is
// visible without scrolling; 2-up splits the width budget over its columns.
window.imgWidth = (cur, which, fit, cols = 1) => {
  const w = Math.max(cur.baseW, cur.headW, 1);
  const h = Math.max(cur.baseH, cur.headH, 1);
  const nat = which === 'diff' ? w : cur[`${which}W`];
  const caps = [cols === 2 ? '(100cqw - var(--unit) * 3) / 2' : '100cqw', `${w}px`];
  if (fit) caps.push(`100cqh * ${(w / h).toFixed(6)}`);
  return `calc(min(${caps.join(', ')}) * ${(nat / w).toFixed(6)})`;
};
