// Screenshot da tela de login da extensão (build real em dist/), pra conferir
// o botão "Criar conta". Serve o dist/, stuba as APIs chrome.* e renderiza.
// Uso: cd <raiz do repo> && node scripts/screenshot-extension-login.mjs
import { chromium } from "playwright";
import http from "node:http";
import path from "node:path";
import fs from "node:fs";

const DIST = path.join(process.cwd(), "apps/extension/dist");
const OUT  = path.join(process.cwd(), "scripts/__screenshots-extension");
fs.mkdirSync(OUT, { recursive: true });

const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".png": "image/png", ".json": "application/json", ".svg": "image/svg+xml" };

const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split("?")[0]);
  if (p === "/") p = "/sidepanel/index.html";
  const file = path.join(DIST, p);
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.statusCode = 404; return res.end("not found"); }
  res.setHeader("Content-Type", MIME[path.extname(file)] ?? "application/octet-stream");
  fs.createReadStream(file).pipe(res);
});

await new Promise((r) => server.listen(0, r));
const port = server.address().port;
const base = `http://localhost:${port}`;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 380, height: 720 }, deviceScaleFactor: 2 });

// Stub do chrome.* ANTES do bundle rodar. Sem auth → cai na LoginView.
await page.addInitScript(() => {
  const noopEvent = { addListener: () => {}, removeListener: () => {} };
  window.chrome = {
    runtime: {
      getURL: (p) => "/" + p,
      sendMessage: () => Promise.resolve(),
      onMessage: noopEvent,
    },
    storage: {
      local: {
        // suporta forma de callback (App linha 67) e de Promise (linha 50)
        get: (_keys, cb) => { if (cb) { cb({}); return; } return Promise.resolve({}); },
        set: () => Promise.resolve(),
      },
    },
    tabs: {
      query: () => Promise.resolve([{ url: "" }]), // sem perfil → syncToActiveTab sai cedo
      create: (opts) => console.log("[stub] chrome.tabs.create →", opts && opts.url),
      onUpdated: noopEvent,
      onActivated: noopEvent,
    },
    sidePanel: { setPanelBehavior: () => {}, open: () => {} },
  };
});

const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
await page.goto(`${base}/sidepanel/index.html`, { waitUntil: "networkidle" });
await page.waitForTimeout(600);

const out = path.join(OUT, "login-v0.3.1.png");
await page.screenshot({ path: out, fullPage: true });

const hasBtn = await page.getByText("Criar conta").count();
console.log("botão 'Criar conta' encontrado:", hasBtn > 0 ? "SIM" : "NAO");
if (errors.length) console.log("erros de página:", errors);
console.log("screenshot:", out);

await browser.close();
server.close();
