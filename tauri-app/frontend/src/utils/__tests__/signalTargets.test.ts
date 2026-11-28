import { describe, it, expect } from 'vitest';
import {
  signalTargetOptions,
  modulatedParamKeys,
  clearTargetsForRemovedNodes,
  MACRO_TARGETS,
} from '../signalTargets';
import type { GraphNode } from '../../components/nodeParamSchema';

const moveNode = (id: string, type: string): GraphNode => ({
  id,
  type: 'custom',
  position: { x: 0, y: 0 },
  data: { label: type, type: type as any, params: {} },
});

const sigOut = (id: string, target: string): GraphNode => ({
  id,
  type: 'custom',
  position: { x: 0, y: 0 },
  data: { label: 'SignalOut', type: 'SignalOut', params: { target } },
});

describe('signalTargetOptions', () => {
  it('macros toujours proposées', () => {
    const opts = signalTargetOptions([]);
    for (const m of MACRO_TARGETS) {
      expect(opts.some((o) => o.value === m)).toBe(true);
    }
  });

  it('une option par param modulable, ids frontend comme cibles', () => {
    const opts = signalTargetOptions([moveNode('scale-1', 'Scale')]);
    expect(opts).toContainEqual({ value: 'param:scale-1:x', label: 'Scale · Scale X (#1)' });
    expect(opts).toContainEqual({ value: 'param:scale-1:y', label: 'Scale · Scale Y (#1)' });
    // Pas d'option type-wide pour une seule instance.
    expect(opts.some((o) => o.value === 'param:Scale:x')).toBe(false);
    // Les params non modulables ne sont pas proposés.
    const objOpts = signalTargetOptions([moveNode('obj-1', 'Objects')]);
    expect(objOpts.some((o) => o.value === 'param:obj-1:n_objects')).toBe(false);
  });

  it('type-wide proposé quand 2+ instances du type', () => {
    const opts = signalTargetOptions([moveNode('s1', 'Scale'), moveNode('s2', 'Scale')]);
    expect(opts.some((o) => o.value === 'param:Scale:x')).toBe(true);
  });
});

describe('modulatedParamKeys', () => {
  it('détecte cible id-specific et type-wide', () => {
    const sig = [sigOut('o1', 'param:s1:x'), sigOut('o2', 'param:Scale:y')];
    expect(modulatedParamKeys(moveNode('s1', 'Scale'), sig)).toEqual(new Set(['x', 'y']));
    expect(modulatedParamKeys(moveNode('s2', 'Scale'), sig)).toEqual(new Set(['y']));
    expect(modulatedParamKeys(moveNode('r1', 'Rotate'), sig)).toEqual(new Set());
  });
});

describe('clearTargetsForRemovedNodes', () => {
  it('efface les cibles référençant un node supprimé, garde les autres', () => {
    const sig = [
      sigOut('o1', 'param:s1:x'),
      sigOut('o2', 'param:Scale:x'),
      sigOut('o3', 'yaw'),
    ];
    const { nodes, cleared } = clearTargetsForRemovedNodes(sig, new Set(['s1']));
    expect(cleared).toBe(1);
    expect(nodes[0].data.params?.target).toBe('');
    expect(nodes[1].data.params?.target).toBe('param:Scale:x');
    expect(nodes[2].data.params?.target).toBe('yaw');
  });
});

describe('signalTargetLabel — fallback friendly (A2.9)', () => {
  it('macro connue → Macro · name', async () => {
    const { signalTargetLabel } = await import('../signalTargets');
    expect(signalTargetLabel('yaw', [])).toBe('Macro · yaw');
  });

  it('cible type-wide → All Type · Label même sans instance', async () => {
    const { signalTargetLabel } = await import('../signalTargets');
    // la valeur injectée/rechargée `param:Circular:radius` doit rendre un
    // label friendly, pas la brute — même sans node dans le graphe courant
    expect(signalTargetLabel('param:Circular:radius', [])).toBe('All Circular · Radius');
  });

  it('cible instance → Type · Label (shortId)', async () => {
    const { signalTargetLabel } = await import('../signalTargets');
    const node = {
      id: 'circular-1719-3', type: 'custom', position: { x: 0, y: 0 },
      data: { label: 'Circular', type: 'Circular', params: {} },
    } as any;
    expect(signalTargetLabel('param:circular-1719-3:radius', [node])).toBe('Circular · Radius (#3)');
  });

  it('cible inconnue → valeur brute (honnête)', async () => {
    const { signalTargetLabel } = await import('../signalTargets');
    expect(signalTargetLabel('param:Ghost:nowhere', [])).toBe('param:Ghost:nowhere');
  });
});
