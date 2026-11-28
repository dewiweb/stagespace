#!/usr/bin/env node
/// Capture les screenshots de la doc via le dev-bridge + puppeteer.
/// Usage: node scripts/capture-screenshots.mjs [filtre-regex]
/// Prérequis: dev-bridge lancé sur localhost:4173 — le script est auto-
/// suffisant : il charge examples/full-feature-show.hfg et capture 3 poses.
/// Sortie: docs/screenshots/*.png en 1200×800.
import { createRequire } from 'node:module';
import dgram from 'node:dgram';
const require = createRequire(new URL('../tauri-app/frontend/package.json', import.meta.url));
const puppeteer = require('puppeteer');

const BRIDGE = 'http://localhost:4173';
const OUT = new URL('../docs/screenshots/', import.meta.url).pathname;
const W = 1200, H = 800;
const filter = process.argv[2] ? new RegExp(process.argv[2]) : null;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const want = (name) => !filter || filter.test(name);

// ─── OSC minimal (show/load + positions pour les poses) ───
const oscStr = (s) => {
  const b = Buffer.concat([Buffer.from(s, 'utf8'), Buffer.from([0])]);
  return Buffer.concat([b, Buffer.alloc((4 - (b.length % 4)) % 4)]);
};
const oscSend = (buf) => {
  const s = dgram.createSocket('udp4');
  s.send(buf, 8001, '127.0.0.1', () => s.close());
};
const oscShowLoad = (path) =>
  oscSend(Buffer.concat([oscStr('/stagespace/show/load'), oscStr(',s'), oscStr(path)]));
const oscPos = (obj, x, y, z) => {
  const m = Buffer.concat([oscStr('/stagespace/position'), oscStr(',ifff')]);
  const tail = Buffer.alloc(16);
  tail.writeInt32BE(obj, 0);
  tail.writeFloatBE(x, 4); tail.writeFloatBE(y, 8); tail.writeFloatBE(z, 12);
  oscSend(Buffer.concat([m, tail]));
};
const oscClearAll = () => oscSend(Buffer.concat([oscStr('/stagespace/position/clearall'), oscStr(',')]));

async function main() {
  const browser = await puppeteer.launch({
    headless: true,
    executablePath: process.env.CHROME_BIN || '/home/dewi/.cache/puppeteer/chrome/linux-131.0.6778.204/chrome-linux64/chrome',
    args: ['--no-sandbox', '--force-device-scale-factor=1'],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: W, height: H, deviceScaleFactor: 1 });
  await page.evaluateOnNewDocument(() => {
    try { localStorage.setItem('stagespace-welcomed', '1'); } catch {}
  });

  const go = async (url) => {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 });
    await sleep(3500);
  };
  const shot = async (name) => {
    await page.screenshot({ path: `${OUT}${name}.png` });
    console.log('✓', name);
  };
  const invoke = (cmd, args = {}) =>
    page.evaluate(async (c, a) => {
      const r = await fetch('/invoke', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cmd: c, args: a }),
      });
      return r.json();
    }, cmd, args);
  const clickAt = async (re, minX = 0, tag = 'button') => {
    const ok = await page.evaluate((src, mx, tg) => {
      const rx = new RegExp(src, 'i');
      const els = [...document.querySelectorAll(tg)].filter((x) => {
        const r = x.getBoundingClientRect();
        return rx.test(x.textContent.trim()) && r.x >= mx && r.width > 0;
      });
      if (els[0]) { els[0].click(); return true; }
      return false;
    }, re.source, minX, tag);
    if (!ok) console.error('  ✗ clickAt not found:', re.source, 'minX', minX);
    await sleep(400);
    return ok;
  };
  const nav = async (surface) => clickAt(new RegExp('^' + surface + '$'), 0);

  // ═══ PROLOGUE — état déterministe ═══
  await go(BRIDGE);
  console.log('— chargement du show exemple…');
  oscShowLoad('/home/dewi/newhome/Github/stagespace/examples/full-feature-show.hfg');
  // attendre que les slots apparaissent (enveloppe appliquée)
  for (let i = 0; i < 20; i++) {
    await sleep(700);
    const n = await page.evaluate(() => document.body.innerText.match(/SETLIST ▶\s*\d+\/(\d+)/)?.[1] || '0');
    if (parseInt(n) >= 10) break;
  }
  console.log('— capture de 3 poses…');
  oscClearAll();
  await sleep(200);
  const formations = [
    ['frontline', [[0,-6,3,1],[1,-2,4,1],[2,2,4,1],[3,6,3,1]]],
    ['arc scene', [[0,-5,2,1],[1,-3,5,1.5],[2,3,5,1.5],[3,5,2,1],[4,0,6,2]]],
    ['immersif', [[0,4,0,1],[1,2,3.46,1],[2,-2,3.46,1],[3,-4,0,1],[4,-2,-3.46,1],[5,2,-3.46,1]]],
  ];
  for (const [name, pts] of formations) {
    for (const [o, x, y, z] of pts) { oscPos(o, x, y, z); await sleep(40); }
    await sleep(250);
    await invoke('pose_capture', { name });
    oscClearAll();
    await sleep(200);
  }
  console.log('poses:', JSON.stringify(await invoke('pose_list')).slice(0, 120));

  await nav('Jeu');
  await sleep(600);

  // ════ JEU — IDLE ════
  if (want('12-jeu')) await shot('12-jeu');
  if (want('19-pose-pads')) {
    await clickAt(/^poses$/i, 320);
    await shot('19-pose-pads');
    await clickAt(/^pads$/i, 320);
  }
  if (want('20-poses-left-tab')) {
    await clickAt(/^poses \d/i, 0);
    await shot('20-poses-left-tab');
    await clickAt(/^cues/i, 0);
  }
  if (want('21-pose-capture')) {
    await clickAt(/^poses$/i, 320);
    await sleep(300);
    if (await clickAt(/^\+ capture/i, 0)) {
      await sleep(500);
      await shot('21-pose-capture');
      await clickAt(/^cancel/i, 0);
    }
    await clickAt(/^pads$/i, 320);
  }

  // ════ JEU — LIVE ════
  if (want('14-jeu|16-gesture|17-attention|18-dryrun')) {
    // vrai clic souris CDP (isTrusted) en haut du corps du premier pad —
    // la strip de nom en bas = sélection, le corps = transport.
    const padBox = await page.evaluate(() => {
      const pads = document.querySelectorAll('[class*="grid"] > div');
      for (const p of pads) {
        const r = p.getBoundingClientRect();
        if (r.width > 100 && r.height > 80 && r.top > 200 && r.top < 700 && r.left < 900) {
          return { x: r.x + r.width / 2, y: r.y + 18 };
        }
      }
      return null;
    });
    if (padBox) {
      await page.mouse.click(padBox.x, padBox.y);
    } else console.error('  ✗ aucun pad trouvé');
    await sleep(1500);
  }
  if (want('14-jeu-live-radar')) await shot('14-jeu-live-radar');
  if (want('16-gesture-explode')) {
    await clickAt(/explode/i, 0);
    await sleep(1300);
    await shot('16-gesture-explode');
    await sleep(2500);
  }
  if (want('17-attention')) {
    await clickAt(/attn/i, 0);
    await sleep(600);
    await shot('17-attention');
    await clickAt(/attn/i, 0);
    await sleep(400);
  }
  if (want('18-dryrun')) {
    await clickAt(/^live$/i, 0);
    await sleep(500);
    await shot('18-dryrun');
    await clickAt(/^console|^dry/i, 0);
    await sleep(400);
  }
  // stop le move avant la suite
  await invoke('deactivate_all_moves', {}).catch(() => {});

  // ════ CONDUITE ════
  if (want('11-conduite|15-conduite')) {
    await nav('Conduite');
    await sleep(900);
  }
  if (want('11-conduite')) await shot('11-conduite');
  if (want('15-conduite-armed')) {
    // clic sur une ligne de cue = déplace le marqueur arm (console model)
    await page.evaluate(() => {
      const rows = [...document.querySelectorAll('div')].filter((d) => {
        const r = d.getBoundingClientRect();
        return r.x < 330 && r.y > 150 && r.y < 500 && r.height > 20 && r.height < 60 && /\d/.test(d.textContent) && d.textContent.length < 60;
      });
      if (rows[1]) rows[1].click();
      return rows.length;
    });
    await sleep(500);
    await shot('15-conduite-armed');
  }

  // ════ ATELIER ════
  if (want('02-atelier|12-atelier|03-edit|05-node|11-spatial')) {
    await nav('Atelier');
    await sleep(1000);
  }
  if (want('02-atelier-example')) await shot('02-atelier-example');
  if (want('11-spatial-fx')) {
    await clickAt(/^fx$/i, 0);
    await sleep(500);
    await shot('11-spatial-fx');
    await clickAt(/^moves$/i, 0);
    await sleep(400);
  }

  // ════ ATELIER — édition d'un move (node editor) ════
  if (want('05-node-editor|03-edit')) {
    // clic sur la row du premier move = selectSlotForEditing
    await page.evaluate(() => {
      const cells = [...document.querySelectorAll('td, div')].filter((d) =>
        /Orbit Ensemble/.test(d.textContent) && d.textContent.trim().length < 30,
      );
      const row = cells[0]?.closest('tr') || cells[0];
      row?.click?.();
      return !!row;
    });
    // fallback : le nom du move est cliquable dans la table
    await clickAt(/Orbit Ensemble/i, 0, 'td').catch(() => {});
    await sleep(1200);
    // 03-edit = l'édition en mode standard (params + canvas)
    if (want('03-edit')) await shot('03-edit');
    // 05-node-editor = le graphe nodal — visible en mode Expert
    await clickAt(/^expert$/i, 0);
    await sleep(1200);
    if (want('05-node-editor')) await shot('05-node-editor');
  }

  // ════ ATELIER — LIVE ════
  if (want('12-atelier-live')) {
    // retour jeu, play, puis atelier — le move continue
    await clickAt(/^simple$/i, 0).catch(() => {});
    await nav('Jeu');
    await sleep(500);
    const padBox2 = await page.evaluate(() => {
      const pads = document.querySelectorAll('[class*="grid"] > div');
      for (const p of pads) {
        const r = p.getBoundingClientRect();
        if (r.width > 100 && r.height > 80 && r.top > 200 && r.top < 700 && r.left < 900) {
          return { x: r.x + r.width / 2, y: r.y + 18 };
        }
      }
      return null;
    });
    if (padBox2) await page.mouse.click(padBox2.x, padBox2.y);
    await sleep(1200);
    await nav('Atelier');
    await sleep(1000);
    await shot('12-atelier-live');
    await invoke('deactivate_all_moves', {}).catch(() => {});
  }

  // ════ MODALES / TOASTS ════
  if (want('09-confirm-delete')) {
    // Delete de cue — bouton title="Delete" présent en atelier (le jeu
    // est readonly). Ouvre la modale de confirmation, annulée après.
    await nav('Atelier');
    await sleep(800);
    await clickAt(/^cues$/i, 0);
    await sleep(600);
    const delBox = await page.evaluate(() => {
      const btns = [...document.querySelectorAll('button[title="Delete"]')];
      if (!btns[0]) return null;
      const r = btns[0].getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    });
    if (delBox) {
      await page.mouse.click(delBox.x, delBox.y);
      await sleep(700);
      await shot('09-confirm-delete');
      await clickAt(/cancel|annuler/i, 0);
    } else console.error('  ✗ delete cue introuvable');
  }
  if (want('13-atelier-orbe')) {
    // Toast d'erreur authentique : move joué sans renderer OSC à
    // l'écoute → "OSC destination unreachable". Pad click éprouvé,
    // capture sur place — le toast persiste quelques secondes.
    await nav('Jeu');
    await sleep(500);
    await clickAt(/^pads$/i, 0).catch(() => {});
    await sleep(400);
    const padBox4 = await page.evaluate(() => {
      const pads = document.querySelectorAll('[class*="grid"] > div');
      for (const p of pads) {
        const r = p.getBoundingClientRect();
        if (r.width > 100 && r.height > 80 && r.top > 200 && r.top < 700 && r.left < 900) {
          return { x: r.x + r.width / 2, y: r.y + 18 };
        }
      }
      return null;
    });
    if (padBox4) await page.mouse.click(padBox4.x, padBox4.y);
    await sleep(3000);
    await shot('13-atelier-orbe');
    await invoke('deactivate_all_moves', {}).catch(() => {});
  }
  if (want('10-conduite-detached')) {
    await nav('Conduite');
    await sleep(800);
    const p2 = await browser.newPage();
    await p2.setViewport({ width: W, height: H, deviceScaleFactor: 1 });
    await p2.evaluateOnNewDocument(() => {
      try { localStorage.setItem('stagespace-welcomed', '1'); } catch {}
    });
    await p2.goto(BRIDGE + '/?view=conduite', { waitUntil: 'domcontentloaded', timeout: 20000 });
    await sleep(6000);
    await p2.screenshot({ path: `${OUT}10-conduite-detached.png` });
    console.log('✓ 10-conduite-detached');
    await p2.close();
  }

  if (want('01-welcome')) {
    const ctx = await browser.createBrowserContext();
    const pw = await ctx.newPage();
    await pw.setViewport({ width: W, height: H, deviceScaleFactor: 1 });
    // contexte isolé — localStorage vierge, la modale welcome s'ouvre
    await pw.goto(BRIDGE, { waitUntil: 'domcontentloaded', timeout: 20000 });
    await sleep(4000);
    await pw.screenshot({ path: `${OUT}01-welcome.png` });
    console.log('✓ 01-welcome');
    await pw.close();
    await ctx.close();
  }

  if (want('22-score')) {
    await nav('Score');
    await sleep(1200);
    await shot('22-score');
  }

  await browser.close();
  console.log('done');
}
main().catch((e) => { console.error(e); process.exit(1); });
