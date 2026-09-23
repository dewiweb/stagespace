/// <reference types="vitest/globals" />

import { describe, it, expect, beforeEach } from 'vitest';
import { useGraphStore, resetStore } from './testHelpers';
import { setInvokeResponse, clearInvokeCalls, getInvokeCalls } from '../../test/setup';
import { pluginParamDefs, pluginDefaultParams, pluginNodeSchema } from '../../components/nodeParamSchema';
import type { PluginManifest } from '../../types/generated/PluginManifest';

const lemniscateManifest: PluginManifest = {
  id: 'lemniscate',
  name: 'Lemniscate',
  version: '1.0.0',
  author: 'STAGESPACE',
  abi_version: 1,
  kind: 'engine',
  category: 'Plugins',
  description: 'Figure-∞',
  params: [
    { key: 'scale', type: 'number', default: 1.0, min: 0.1, max: 10, step: 0.1, label: 'Scale', options: null, live: true },
    { key: 'speed', type: 'number', default: 1.0, min: -5, max: 5, step: 0.05, label: null, options: null, live: true },
  ],
  capabilities: [],
};

const report = {
  manifests: [lemniscateManifest],
  errors: [] as string[],
  plugins_dir: '/home/user/.local/share/com.stagespace.studio/plugins',
};

beforeEach(() => {
  resetStore();
  clearInvokeCalls();
});

describe('fetchPlugins', () => {
  it('populates manifests/errors/dir from list_plugins', async () => {
    setInvokeResponse('list_plugins', report);
    await useGraphStore.getState().fetchPlugins();
    const s = useGraphStore.getState();
    expect(s.plugins).toHaveLength(1);
    expect(s.plugins[0].id).toBe('lemniscate');
    expect(s.pluginsDir).toContain('plugins');
    expect(s.pluginsLoaded).toBe(true);
    expect(getInvokeCalls().some((c) => c.cmd === 'list_plugins')).toBe(true);
  });

  it('survives a backend failure without throwing', async () => {
    setInvokeResponse('list_plugins', new Error('wasmtime init failed'));
    await useGraphStore.getState().fetchPlugins();
    const s = useGraphStore.getState();
    expect(s.plugins).toEqual([]);
    expect(s.pluginsLoaded).toBe(true);
  });
});

describe('reloadPlugins', () => {
  it('invokes reload_plugins and refreshes state incl. errors', async () => {
    setInvokeResponse('reload_plugins', {
      ...report,
      errors: ['/x/bad.ssx: invalid manifest'],
      manifests: [],
    });
    await useGraphStore.getState().reloadPlugins();
    const s = useGraphStore.getState();
    expect(s.pluginErrors).toHaveLength(1);
    expect(s.plugins).toEqual([]);
    expect(getInvokeCalls().some((c) => c.cmd === 'reload_plugins')).toBe(true);
  });
});

describe('pluginParamDefs / pluginDefaultParams / pluginNodeSchema', () => {
  it('maps manifest params to ParamDef with fallbacks', () => {
    const defs = pluginParamDefs(lemniscateManifest);
    expect(defs).toHaveLength(2);
    expect(defs[0]).toMatchObject({ key: 'scale', type: 'number', min: 0.1, max: 10, label: 'Scale' });
    // label absent → key en fallback
    expect(defs[1].label).toBe('speed');
  });

  it('builds default params with plugin_id + manifest defaults', () => {
    const p = pluginDefaultParams(lemniscateManifest);
    expect(p.plugin_id).toBe('lemniscate');
    expect(p.scale).toBe(1.0);
    expect(p.speed).toBe(1.0);
  });

  it('pluginNodeSchema returns plugin_id only when manifest unknown', () => {
    const schema = pluginNodeSchema({ plugin_id: 'missing' }, [lemniscateManifest]);
    expect(schema).toEqual([{ key: 'plugin_id', label: 'Plugin ID', type: 'text' }]);
  });

  it('pluginNodeSchema merges manifest params after plugin_id', () => {
    const schema = pluginNodeSchema({ plugin_id: 'lemniscate' }, [lemniscateManifest]);
    expect(schema.map((d) => d.key)).toEqual(['plugin_id', 'scale', 'speed']);
  });
});
