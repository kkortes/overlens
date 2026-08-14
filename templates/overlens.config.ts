import type { Page } from "@playwright/test";

export type OverlensPass = {
  name: string;
  width: number;
  theme: "light" | "dark";
};

export type OverlensConfig = {
  firstPageToVisit: string;
  targetBranch: string;
  passes: OverlensPass[];
  theme: (page: Page, theme: OverlensPass["theme"]) => Promise<unknown>;
  blockRequests?: RegExp[];
  freezeClock?: boolean;
  shape?: (path: string) => string;
  mask?: string[];
  createPR?: boolean;
};

const config: OverlensConfig = {
  // The crawl entry point — every root-relative link is followed from here.
  // In CI the workflow sets PLAYWRIGHT_BASE_URL to the preview deploy URL.
  firstPageToVisit: `${process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3000"}/`,
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
};

export default config;
