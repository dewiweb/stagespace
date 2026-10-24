import puppeteer from 'puppeteer-core';
const CHROME = '/home/dewi/.cache/puppeteer/chrome-headless-shell/linux-131.0.6778.204/chrome-headless-shell-linux64/chrome-headless-shell';
const b = await puppeteer.launch({ executablePath: CHROME, args: ['--no-sandbox'] });
const p = await b.newPage();
await p.setViewport({ width: 1600, height: 900 });
await p.goto('http://localhost:5173', { waitUntil: 'networkidle0', timeout: 30000 });
await new Promise(r => setTimeout(r, 1200));
const click = async (t) => p.evaluate((t) => {
  const el = [...document.querySelectorAll('button')].find(b => (b.textContent||'').trim().includes(t));
  if (el) { el.click(); return true; } return false;
}, t);
await click('example'); await new Promise(r => setTimeout(r, 1500));
// Le bouton Assign dans la scène + le toggle Atelier
await click('Assign'); await new Promise(r => setTimeout(r, 600));
await p.screenshot({ path: '/tmp/ux-assign.png' });
await click('Assign'); // désarme
await click('FX'); await new Promise(r => setTimeout(r, 500));
await p.screenshot({ path: '/tmp/ux-fx-place.png' });
await b.close();
console.log('done');
