import { writeFileSync } from "fs";

import { expect, test, type Page } from "@playwright/test";

import overlens from "../overlens.config";

test.skip(!process.env.OVERLENS, "overlens crawl runs in CI only");
test.describe.configure({ retries: 0 });

const shape =
  overlens.shape ??
  ((path: string) => path.replace(/\/(?=[^/]*\d)[^/]{8,}/g, "/[id]"));
const mask = overlens.mask ?? ["[data-apply-playwright-mask]"];

const clock = (page: Page, timestamp: number) =>
  page.addInitScript(`{
  Date = class extends Date {
    constructor(...args) {
      if (args.length === 0) {
        super(${timestamp});
      } else {
        super(...args);
      }
    }
  }
  const __DateNowOffset = ${timestamp} - Date.now();
  const __DateNow = Date.now;
  Date.now = () => __DateNow() + __DateNowOffset;
}`);

const tokens = [
  ...new Set([
    new URL(overlens.firstPageToVisit).host,
    new URL(process.env.PLAYWRIGHT_BASE_URL ?? overlens.firstPageToVisit).host,
  ]),
]
  .sort((a, b) => b.length - a.length)
  .map((host): [string, string] => [host, "overlens.app"]);

const fileBase = (shaped: string) =>
  shaped === "/"
    ? "home"
    : shaped.slice(1).replaceAll("_", "__").replaceAll("/", "_");

const normalize = (page: Page) =>
  page.evaluate((pairs) => {
    const swap = (text: string) =>
      pairs.reduce((t, [host, token]) => t.replaceAll(host, token), text);
    const walker = document.createTreeWalker(
      document.body,
      NodeFilter.SHOW_TEXT,
    );
    for (let node = walker.nextNode(); node; node = walker.nextNode())
      if (pairs.some(([host]) => node!.nodeValue?.includes(host)))
        node.nodeValue = swap(node.nodeValue!);
    document
      .querySelectorAll<HTMLInputElement>("input, textarea")
      .forEach((el) => {
        if (pairs.some(([host]) => el.value.includes(host)))
          el.value = swap(el.value);
      });
  }, tokens);

const settled = (page: Page) =>
  page.waitForFunction(
    () =>
      new Promise<boolean>((resolve) => {
        const height = document.documentElement.scrollHeight;
        requestAnimationFrame(() =>
          requestAnimationFrame(() =>
            resolve(document.documentElement.scrollHeight === height),
          ),
        );
      }),
  );

test("overlens crawl", async ({ page }) => {
  test.setTimeout(15 * 60 * 1000);

  await page.emulateMedia({ reducedMotion: "reduce" });
  if (overlens.freezeClock ?? true)
    await clock(page, Date.UTC(2026, 7, 11, 12));
  for (const pattern of overlens.blockRequests ?? [])
    await page.route(pattern, (route) => route.abort());

  const first = new URL(overlens.firstPageToVisit);
  const firstPath = first.pathname.replace(/\/$/, "") || "/";
  const seen = new Set<string>();
  const shapes = new Set<string>();
  const queue = [firstPath];
  const pages: string[] = [];

  while (queue.length) {
    const path = queue.shift()!.replace(/\/$/, "") || "/";
    if (seen.has(path)) continue;
    seen.add(path);
    const pathShape = shape(path);
    const started = Date.now();

    try {
      await page.goto(
        path === firstPath ? first.href : `${first.origin}${path}`,
        {
          waitUntil: "networkidle",
          timeout: 30000,
        },
      );
    } catch {
      console.info(`${pathShape} skipped (did not settle within 30s)`);
      continue;
    }

    if (!shapes.has(pathShape)) {
      shapes.add(pathShape);
      await page.evaluate(() => document.fonts.ready);
      await page.addStyleTag({
        content:
          "*, *::before, *::after { transition: none !important; animation: none !important; caret-color: transparent !important; }",
      });

      for (const { name, width, theme } of overlens.passes) {
        await page.setViewportSize({ width, height: 720 });
        await overlens.theme(page, theme);
        await normalize(page);
        await settled(page);
        await page.evaluate(() =>
          Promise.all(
            [...document.images].map((img) => img.decode().catch(() => {})),
          ),
        );
        await page.screenshot({
          path: `overlens-output/${name}/${fileBase(pathShape)}.png`,
          fullPage: true,
          mask: mask.map((selector) => page.locator(selector)),
        });
      }
      pages.push(pathShape);
    }

    const hrefs = await page
      .locator("a[href^='/']:not([href^='//'])")
      .evaluateAll((as) => as.map((a) => a.getAttribute("href")!));
    queue.push(...hrefs.map((href) => href.split(/[?#]/)[0]));
    console.info(
      `${pathShape} ${Date.now() - started}ms (visited ${seen.size}, queued ${queue.length})`,
    );
  }

  expect(pages.length, "the crawl captured no pages at all").toBeGreaterThan(0);
  writeFileSync("overlens-output/pages.txt", pages.sort().join("\n") + "\n");
});
