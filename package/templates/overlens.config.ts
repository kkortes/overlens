// Overlens imports this file straight from source, with no install:
// relative imports to your own files are fine, npm dependencies aren't.
// The Playwright type below is erased at runtime — add @playwright/test as a
// dev dependency for the editor if you don't have it; the crawl ships its own.
import type { Page } from "@playwright/test";

export type OverlensPass = {
  name: string;
  width: number;
  theme: "light" | "dark";
};

export type OverlensConfig = {
  pagesIncluded?: string[];
  pagesExcluded?: string[];
  targetBranch: string;
  passes: OverlensPass[];
  theme: (page: Page, theme: OverlensPass["theme"]) => Promise<unknown>;
  auth?: (page: Page) => Promise<unknown>;
  ready?: (page: Page) => Promise<unknown>;
  timeoutMinutes?: number;
  blockRequests?: RegExp[];
  freezeClock?: boolean;
  shape?: (path: string) => string;
  mask?: string[];
  createPR?: boolean;
};

const config: OverlensConfig = {
  // The entry pages the crawl starts from — every root-relative link is
  // followed. Paths resolve against the deploy URL (Overlens sets
  // PLAYWRIGHT_BASE_URL); absolute URLs work too, e.g. a vendor subdomain.
  // pagesIncluded: ["/"],
  // Subtrees the crawl must not enter.
  // pagesExcluded: ["/admin"],
  // The branch Overlens compares PRs against. Its snapshots become the
  // baseline, pushed to a branch always named overlens/dev — the name the
  // inspector reads — no matter what your branch is called.
  targetBranch: "main",
  passes: [
    { name: "mobile-light", width: 390, theme: "light" },
    { name: "mobile-dark", width: 390, theme: "dark" },
    { name: "desktop-light", width: 1280, theme: "light" },
    { name: "desktop-dark", width: 1280, theme: "dark" },
  ],
  // How your app switches theme — this example toggles a `dark` class on <html>.
  theme: (page, theme) =>
    page.evaluate(
      (dark) => document.documentElement.classList.toggle("dark", dark),
      theme === "dark",
    ),
  // Runs once before the crawl, in the context every page is then visited in.
  // Log in however a person would; the session carries through the whole crawl.
  // auth: async (page) => {
  //   await page.goto(`${base}/login`);
  //   await page.locator('input[name="email"]').fill(EMAIL);
  //   await page.locator('input[name="password"]').fill(PASSWORD);
  //   await page.locator('button[type="submit"]').click();
  // },
  // Runs after every navigation. `networkidle` says nothing about a websocket
  // or a client-side fetch, so an app that paints a spinner first needs to say
  // when it's actually done — otherwise that spinner is what gets screenshot.
  // ready: (page) => page.waitForFunction(() => window.appReady === true),
  // Content that changes on every render is covered with a solid box when
  // its element carries data-overlens-mask (bare, empty or "true"). These
  // CSS selectors are masked on top, for markup you can't annotate.
  // mask: [".chat-widget"],
  // The crawl's budget, 15 minutes by default. Raise it for a big site: full
  // page shots of tall pages add up, and a 2-vCPU runner is no workstation —
  // nor are pressed states, a page load each. Drawers, menus and dialogs need
  // no config: mark what opens them in your markup with a bare
  // data-overlens-press and each opened state is shot as <page>~<name>.png,
  // named after the pressed element's aria-label or text.
  // timeoutMinutes: 45,
};

export default config;
