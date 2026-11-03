// Screenshots do site de marketing em viewports diferentes.
// Uso: cd <raiz do repo> && node scripts/screenshot-site.mjs
import { chromium } from "playwright";
import path from "node:path";
import fs from "node:fs";

const URL = process.env.SITE_URL ?? "http://localhost:4000";
const OUT_DIR = path.join(process.cwd(), "scripts/__screenshots-site");
fs.mkdirSync(OUT_DIR, { recursive: true });

const viewports = [
  { name: "mobile-375",  width: 375,  height: 812  }, // iPhone X
  { name: "mobile-414",  width: 414,  height: 896  }, // iPhone 11 Pro Max
  { name: "tablet-768",  width: 768,  height: 1024 }, // iPad
  { name: "desktop-1280",width: 1280, height: 800  },
];

const routes = [
  { name: "home",     path: "/"          },
  { name: "signup",   path: "/cadastro"  },
];

const browser = await chromium.launch();

for (const vp of viewports) {
  const ctx  = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();

  for (const route of routes) {
    const url = `${URL}${route.path}`;
    await page.goto(url, { waitUntil: "networkidle", timeout: 30_000 });
    await page.waitForTimeout(800); // wait for fonts/CSS settle
    const file = path.join(OUT_DIR, `${route.name}-${vp.name}.png`);
    await page.screenshot({ path: file, fullPage: true });
    console.log(`✓ ${file}`);
  }
  await ctx.close();
}

await browser.close();
console.log(`\nScreenshots em: ${OUT_DIR}`);
