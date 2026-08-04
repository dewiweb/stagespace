/**
 * Test E2E : ouvre l'app STAGESPACE dans Chromium, mock Tauri IPC,
 * et teste le flow complet : sélectionner une animation → cliquer Launch → vérifier invoke.
 */
const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });

  const logs = [];
  const invokeCalls = [];

  page.on('console', (msg) => logs.push(`[${msg.type()}] ${msg.text()}`));
  page.on('pageerror', (err) => logs.push(`[PAGEERROR] ${err.message}`));

  // Mock Tauri IPC avant que la page se charge
  await page.addInitScript(() => {
    const mockInvoke = async (cmd, args) => {
      console.log(`[INVOKE] ${cmd} keys=${JSON.stringify(Object.keys(args || {}))}`);
      if (cmd === 'launch_animation') {
        console.log(`[INVOKE] launch_animation: shape=${args.animation?.shape} oscIds=${JSON.stringify(args.oscIds)} isPreview=${args.isPreview}`);
        return `mock-movement-${Date.now()}`;
      }
      if (cmd === 'list_movements') return [];
      if (cmd === 'update_animation_state') return null;
      if (cmd === 'stop_all_movements') return 'ok';
      if (cmd === 'get_audio_state') return { bpm: null, amplitude: null, spectrum: null };
      if (cmd === 'start_audio') return null;
      if (cmd === 'stop_audio') return null;
      if (cmd === 'get_audio_input_devices') return [];
      // Cuelist / setlist
      if (cmd === 'cuelist_list') return []; // empty cuelist
      if (cmd === 'get_setlist') return { id: 'default', name: 'Default', cue_ids: [] };
      if (cmd === 'cuelist_get') return { id: 'default', name: 'Default', cues: [] };
      if (cmd === 'cuelist_save') return null;
      if (cmd === 'save_setlist') return null;
      // Presets
      if (cmd === 'list_presets') return [];
      // Patch
      if (cmd === 'get_patch') return { objects: [], groups: [] };
      if (cmd === 'save_patch') return null;
      // OSC
      if (cmd === 'get_osc_status') return { receiving: false, sending: false };
      // Config
      if (cmd === 'get_config') return { osc: { address: '127.0.0.1', port: 7788, profile: 'holophonix' } };
      if (cmd === 'save_config') return null;
      // Movements
      if (cmd === 'stop_movement') return null;
      if (cmd === 'stop_movement_with_fade') return null;
      if (cmd === 'set_macro') return null;
      if (cmd === 'set_movement_macro') return null;
      if (cmd === 'play_movement') return null;
      if (cmd === 'play_graph') return null;
      if (cmd === 'compile_graph') return 'ok';
      if (cmd === 'import_hol_project') return null;
      if (cmd === 'export_hol_project') return null;
      return null;
    };

    // transformCallback — requis par Tauri v2 pour les callbacks
    let callbackId = 0;
    const callbacks = new Map();

    window.__TAURI_INTERNALS__ = {
      invoke: mockInvoke,
      convertFileSrc: (p) => p,
      transformCallback: (callback) => {
        const id = ++callbackId;
        callbacks.set(id, callback);
        return id;
      },
      metadata: {
        currentWindow: { label: 'main' },
        currentWebview: { label: 'main', windowLabel: 'main' },
      },
    };

    // Mock @tauri-apps/api/event
    window.__TAURI_EVENT__ = { listen: async () => () => {} };
  });

  const APP_URL = 'http://localhost:5174';
  console.log(`Navigating to ${APP_URL}...`);
  await page.goto(APP_URL, { waitUntil: 'networkidle', timeout: 15000 });

  // Attendre que l'app rende
  await page.waitForTimeout(2000);

  // Screenshot
  await page.screenshot({ path: '/tmp/stagespace-1-initial.png' });
  console.log('Screenshot 1 saved (initial)');

  // 1. Vérifier que l'Inspector est rendu
  const inspectorVisible = await page.locator('text=Perform').first().isVisible().catch(() => false);
  console.log(`1. Inspector "Perform" visible: ${inspectorVisible}`);

  // 2. Vérifier que les presets sont chargés
  const presetVisible = await page.locator('text=Cercle').first().isVisible().catch(() => false);
  console.log(`2. Preset "Cercle" visible: ${presetVisible}`);

  // 3. Cliquer sur un preset
  if (presetVisible) {
    await page.locator('text=Cercle').first().click();
    await page.waitForTimeout(500);
    console.log('3. Clic sur preset "Cercle"');
  }

  // 4. Vérifier que le bouton "Launch Live" de l'Inspector est présent
  //    Le bouton de l'Inspector a la classe "font-bold" (pas celui de la Toolbar)
  const launchBtn = page.locator('button.font-bold:has-text("Launch Live")').first();
  const launchVisible = await launchBtn.isVisible().catch(() => false);
  console.log(`4. Bouton "Launch Live" (Inspector) visible: ${launchVisible}`);

  // 5. Cliquer sur "Launch Live" via JavaScript (force click)
  if (launchVisible) {
    await page.evaluate(() => {
      const buttons = document.querySelectorAll('button.font-bold');
      for (const btn of buttons) {
        if (btn.textContent?.includes('Launch Live')) {
          btn.click();
          return true;
        }
      }
      return false;
    });
    await page.waitForTimeout(1000);
    console.log('5. Clic sur "Launch Live" (Inspector)');
  }

  // 6. Vérifier que launch_animation a été appelé
  const launchLogs = logs.filter((l) => l.includes('launch_animation'));
  console.log(`\n6. launch_animation appelé: ${launchLogs.length > 0 ? '✅ OUI' : '❌ NON'}`);
  if (launchLogs.length > 0) {
    launchLogs.forEach((l) => console.log(`   ${l}`));
  }

  // 7. Cliquer sur "Preview" (de l'Inspector via JS)
  const previewClicked = await page.evaluate(() => {
    const buttons = document.querySelectorAll('button.font-bold');
    for (const btn of buttons) {
      if (btn.textContent?.includes('Preview')) {
        btn.click();
        return true;
      }
    }
    return false;
  }).catch(() => false);
  if (previewClicked) {
    await page.waitForTimeout(500);
    console.log('7. Clic sur "Preview" (Inspector)');
  }

  // 8. Vérifier les erreurs
  const errors = logs.filter((l) => l.includes('[PAGEERROR]') || l.includes('error') || l.includes('Error'));
  console.log(`\n8. Erreurs détectées: ${errors.length}`);
  if (errors.length > 0) {
    errors.forEach((e) => console.log(`   ${e}`));
  }

  // Screenshot final
  await page.screenshot({ path: '/tmp/stagespace-2-after-launch.png' });
  console.log('\nScreenshot 2 saved (after launch)');

  // Afficher tous les logs
  console.log('\n=== Tous les logs console ===');
  logs.forEach((l) => console.log(l));

  await browser.close();

  // Résultat final
  console.log('\n=== RÉSULTAT ===');
  if (launchLogs.length > 0) {
    console.log('✅ SUCCÈS — Le frontend appelle bien launch_animation');
    process.exit(0);
  } else {
    console.log('❌ ÉCHEC — launch_animation n\'a pas été appelé');
    process.exit(1);
  }
})();
