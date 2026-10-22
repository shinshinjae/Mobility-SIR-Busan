// 웹 화면 캡처 (Chrome DevTools Protocol, 의존성 없음).  Node 22+ 필요.
// 1) 로컬 서버:  python3 -m http.server 8765 --directory docs
// 2) 실행:      node scripts/screenshots.mjs        → image/*.png
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const CHROME = process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const BASE = process.env.BASE || "http://localhost:8765";
const OUT = join(dirname(fileURLToPath(import.meta.url)), "..", "image");
const PORT = 9333;

const SHOTS = [
  ["01_home", "#home", 1440],
  ["02_dashboard", "#dashboard", 1440],
  ["03_dashboard_season", "#dashboard?ds=real:2017-18", 1440],
  ["04_decompose", "#decompose", 1440],
  ["05_scenario", "#scenario?ds=real:2017-18", 1440],
  ["06_research", "#research", 1440],
  ["07_method", "#method", 1440],
  ["08_briefing", "#briefing", 1440],
  ["09_data", "#data", 1440],
  ["10_mobile_dashboard", "#dashboard", 390, true],
  ["11_synthetic_check", "#dashboard?ds=synthetic&asof=2026-08-31", 1440],
];

mkdirSync(OUT, { recursive: true });
const chrome = spawn(CHROME, ["--headless=new", `--remote-debugging-port=${PORT}`, "--hide-scrollbars",
  `--user-data-dir=${mkdtempSync(join(tmpdir(), "msir-"))}`, "about:blank"], { stdio: "ignore" });
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function cdpTarget() {
  for (let i = 0; i < 50; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      const page = list.find(t => t.type === "page");
      if (page) return page.webSocketDebuggerUrl;
    } catch { /* 아직 기동 중 */ }
    await sleep(200);
  }
  throw new Error("Chrome 에 연결하지 못했습니다");
}

const ws = new WebSocket(await cdpTarget());
await new Promise(r => ws.addEventListener("open", r, { once: true }));
let id = 0;
const pending = new Map();
ws.addEventListener("message", ev => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
});
const send = (method, params = {}) => new Promise(res => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
const evalJs = async expr => (await send("Runtime.evaluate", { expression: expr, returnByValue: true })).result?.result?.value;

for (const [name, hash, width, mobile] of SHOTS) {
  await send("Emulation.setDeviceMetricsOverride", { width, height: mobile ? 844 : 900, deviceScaleFactor: mobile ? 2 : 1, mobile: !!mobile });
  await send("Page.navigate", { url: `${BASE}/?shot=${name}${hash}` });
  for (let i = 0; i < 100 && !(await evalJs("document.body && document.body.dataset.ready === '1'")); i++) await sleep(150);
  await sleep(1500);   // 글꼴·차트·수식 렌더링 대기
  const h = await evalJs("Math.ceil(document.documentElement.scrollHeight)");
  await send("Emulation.setDeviceMetricsOverride", { width, height: h, deviceScaleFactor: mobile ? 2 : 1, mobile: !!mobile });
  await sleep(700);
  const shot = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: true });
  writeFileSync(join(OUT, `${name}.png`), Buffer.from(shot.result.data, "base64"));
  console.log(`${name}.png  ${width}x${h}`);
}
ws.close();
chrome.kill();
