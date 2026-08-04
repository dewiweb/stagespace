/**
 * Test frontend : mock Tauri IPC et vérifie que launchAnimation fonctionne.
 * Lance l'app dans un browser headless et simule les appels backend.
 */
const puppeteer = require('puppeteer');

(async () => {
  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  const page = await browser.newPage();

  // Collecter les console.log
  const logs = [];
  page.on('console', (msg) => logs.push(`[${msg.type()}] ${msg.text()}`));
  page.on('pageerror', (err) => logs.push(`[ERROR] ${err.message}`));

  // Intercepter les appels Tauri invoke
  await page.evaluateOnNewDocument(() => {
    // Mock __TAURI_INTERNALS__
    window.__TAURI_INTERNALS__ = {
      invoke: async (cmd, args) => {
        console.log(`[MOCK INVOKE] ${cmd} args=${JSON.stringify(Object.keys(args || {}))}`);

        if (cmd === 'launch_animation') {
          console.log(`[MOCK] launch_animation called!`);
          console.log(`[MOCK] animation.shape=${args.animation?.shape}`);
          console.log(`[MOCK] animation.duration=${args.animation?.duration}`);
          console.log(`[MOCK] oscIds=${JSON.stringify(args.oscIds)}`);
          console.log(`[MOCK] isPreview=${args.isPreview}`);
          console.log(`[MOCK] oscAddress=${args.oscAddress}`);
          console.log(`[MOCK] origin=${JSON.stringify(args.origin)}`);
          return `mock-movement-${Date.now()}`;
        }
        if (cmd === 'list_movements') return [];
        if (cmd === 'update_animation_state') return null;
        if (cmd === 'stop_all_movements') return 'ok';
        if (cmd === 'get_audio_state') return { bpm: null, amplitude: null, spectrum: null };
        return null;
      },
      convertFileSrc: (path) => path,
    };

    // Mock Tauri event listen
    window.__TAURI_EVENT__ = {
      listen: async () => () => {},
    };
  });

  console.log('Navigating to http://localhost:5174...');
  await page.goto('http://localhost:5174', { waitUntil: 'networkidle0', timeout: 10000 });

  // Attendre que l'app rende
  await new Promise((r) => setTimeout(r, 2000));

  // Screenshot
  await page.screenshot({ path: '/tmp/stagespace-test.png', width: 1280, height: 800 });
  console.log('Screenshot saved to /tmp/stagespace-test.png');

  // Vérifier que l'Inspector est rendu
  const hasInspector = await page.evaluate(() => {
    const els = document.querySelectorAll('*');
    for (const el of els) {
      if (el.textContent?.includes('Perform')) return true;
      if (el.textContent?.includes('Shape')) return true;
    }
    return false;
  });
  console.log(`Inspector rendu: ${hasInspector}`);

  // Vérifier que les boutons Preview/Launch existent
  const hasLaunchButton = await page.evaluate(() => {
    const buttons = document.querySelectorAll('button');
    for (const btn of buttons) {
      if (btn.textContent?.includes('Launch Live')) return true;
    }
    return false;
  });
  console.log(`Bouton "Launch Live" présent: ${hasLaunchButton}`);

  // Cliquer sur "Launch Live"
  if (hasLaunchButton) {
    console.log('\nClic sur "Launch Live"...');
    const clicked = await page.evaluate(() => {
      const buttons = document.querySelectorAll('button');
      for (const btn of buttons) {
        if (btn.textContent?.includes('Launch Live')) {
          btn.click();
          return true;
        }
      }
      return false;
    });
    console.log(`Bouton cliqué: ${clicked}`);

    // Attendre que l'invoke soit appelé
    await new Promise((r) => setTimeout(r, 1000));
  }

  // Vérifier les logs
  console.log('\n=== Console logs ===');
  for (const log of logs) {
    console.log(log);
  }

  // Vérifier si launch_animation a été appelé
  const launchCalled = logs.some((l) => l.includes('launch_animation'));
  console.log(`\nlaunch_animation appelé: ${launchCalled}`);

  if (launchCalled) {
    console.log('✅ SUCCÈS — Le frontend appelle bien launch_animation');
  } else {
    console.log('❌ PROBLÈME — launch_animation n\'a pas été appelé');
    // Vérifier s'il y a des erreurs
    const errors = logs.filter((l) => l.includes('[ERROR]') || l.includes('error'));
    if (errors.length > 0) {
      console.log('\nErreurs détectées:');
      errors.forEach((e) => console.log('  ' + e));
    }
  }

  await browser.close();
})().catch((e) => {
  console.error('Test failed:', e);
  process.exit(1);
});
