// Compiled-SPA dev loop, no bundler: `vibe compile --watch` keeps compiled/
// fresh (package.json's vibe-compiler config has "spa": true), and this
// server serves it with the one rewrite every SPA deployment needs anyway —
// extension-less paths fall back to /index.html (the shell), so deep links
// and reloads resolve on any route. Refresh after a save; compiled output
// re-hydrates from scratch by design.
import { spawn } from 'bun';

const compiler = spawn(
  ['bun', 'node_modules/@ape-egg/vibe-compiler/bin/vibe-compile.js', '--watch'],
  { stdout: 'inherit', stderr: 'inherit' },
);
process.on('exit', () => compiler.kill());

const port = Number(process.env.PORT) || 4173;

Bun.serve({
  port,
  async fetch(request) {
    const { pathname } = new URL(request.url);
    if (pathname.includes('..')) return new Response('nope', { status: 400 });

    const file = Bun.file(`compiled${decodeURIComponent(pathname)}`);
    if (await file.exists()) return new Response(file);

    // The compiler mirrors only web assets — the deploy's build command
    // copies /templates/ into the output, and dev serves it from source.
    if (pathname.startsWith('/templates/')) {
      const raw = Bun.file(`.${decodeURIComponent(pathname)}`);
      if (await raw.exists()) return new Response(raw);
    }

    if (!pathname.includes('.')) {
      const shell = Bun.file('compiled/index.html');
      if (await shell.exists()) return new Response(shell);
      return new Response('compiling — refresh in a second', { status: 503 });
    }

    return new Response('not found', { status: 404 });
  },
});

console.info(`overlens → http://localhost:${port}`);
