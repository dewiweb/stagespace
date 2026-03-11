/**
 * Niveau 2 — Tests de scénarios croisés exhaustifs
 *
 * Pour chaque scénario : description du graphe, résultat attendu, assertion mesurable.
 * Organisation :
 *   S01–S10  : engines seuls + variants (objects/duration implicites/explicites)
 *   S11–S20  : modificateurs chaînés (scale, rotate, offset, phaseShift, barycentricGroup)
 *   S21–S30  : nœuds de contrôle (mix, group, sequence) + cas limites
 *   S31–S40  : splines (drawSpline → evaluateSpline, trimSpline, offsetSpline)
 *   S41–S50  : scénarios complexes croisés (mix après group, sequence après modify, etc.)
 *   S51–S60  : validations d'erreurs et warnings (nouveaux codes)
 *   S61–S70  : comportement numérique précis (valeurs attendues calculées à la main)
 */

import { describe, it, expect } from 'vitest'
import { GraphCompiler } from '../GraphCompiler'
import type { Graph, GraphNode, GraphEdge } from '../types'

const C = new GraphCompiler()

// Spline points used across multiple test suites
const THREE_POINTS = [
  { x: -1, y: 0, z: 0 },
  { x:  0, y: 1, z: 0 },
  { x:  1, y: 0, z: 0 },
]

// ── Helpers ───────────────────────────────────────────────────────────────────

function n(id: string, type: string, data: Record<string, unknown> = {}): GraphNode {
  return { id, type, data }
}

function e(
  source: string, sh: string,
  target: string, th: string,
): GraphEdge {
  return { source, sourceHandle: sh, target, targetHandle: th }
}

const OBJ  = (id: string, count: number)   => n(id, 'objects',  { count })
const DUR  = (id: string, secs: number)    => n(id, 'duration', { seconds: secs })
const OUT  = ()                            => n('out', 'output', {})
const ENG  = (id: string, type: string, data: Record<string,unknown> = {}) => n(id, type, data)
const MOD  = (id: string, type: string, data: Record<string,unknown> = {}) => n(id, type, data)
const eObj = (src: string, tgt: string)   => e(src, 'out-objects',    tgt, 'in-objects')
const eDur = (src: string, tgt: string)   => e(src, 'out-duration',   tgt, 'in-duration')
const eTraj = (src: string, tgt: string, slot = '') =>
  e(src, 'out-trajectory', tgt, slot ? `in-trajectory-${slot}` : 'in-trajectory')
const eOut = (src: string)               => eTraj(src, 'out')

/** Graphe minimal : obj + dur + engine + output */
function simple(type: string, count = 4, secs = 10, params: Record<string,unknown> = {}): Graph {
  return {
    nodes: [OBJ('obj', count), DUR('dur', secs), ENG('eng', type, params), OUT()],
    edges: [eObj('obj','eng'), eDur('dur','eng'), eOut('eng')],
  }
}

/** Appelle fn à t=tVal, objectIndex=i avec les vrais objectCount/duration du résultat */
function pos(r: ReturnType<typeof C.compile>, tVal: number, i = 0) {
  return r.fn!(tVal, i, r.objectCount, r.duration)
}

function finite(v: { x: number; y: number; z: number }) {
  return isFinite(v.x) && isFinite(v.y) && isFinite(v.z)
}

// ── S01–S10 : engines seuls ───────────────────────────────────────────────────

describe('S01–S10 : engines — ports objects/duration', () => {

  it('S01 : tous les engines math compilent et retournent des Vector3 finis', () => {
    const engines = ['circular','elliptical','spiral','lissajous','figure8',
                     'linear','oscillation','perlinNoise','formation','converge',
                     'pendulum','roseCurve','helix']
    for (const id of engines) {
      const r = C.compile(simple(id, 4, 10))
      expect(r.success, `${id} failed`).toBe(true)
      for (let i = 0; i < 4; i++) {
        const p = pos(r, 2.5, i)
        expect(finite(p), `${id} obj${i} non-fini`).toBe(true)
      }
    }
  })

  it('S02 : tous les engines physics compilent et retournent des Vector3 finis', () => {
    const engines = ['bouncing','spring','follow','swarm','avoidance']
    for (const id of engines) {
      const r = C.compile(simple(id, 4, 8))
      expect(r.success, `${id} failed`).toBe(true)
      for (let i = 0; i < 4; i++) {
        const p = pos(r, 4.0, i)
        expect(finite(p), `${id} obj${i} non-fini`).toBe(true)
      }
    }
  })

  it('S03 : engine sans objects/duration → compile avec IMPLICIT_DEFAULT, objectCount=4, duration=10', () => {
    const r = C.compile({
      nodes: [ENG('eng','circular'), OUT()],
      edges: [eOut('eng')],
    })
    expect(r.success).toBe(true)
    expect(r.objectCount).toBe(4)
    expect(r.duration).toBe(10)
    expect(r.issues.some(i => i.code === 'IMPLICIT_DEFAULT')).toBe(true)
  })

  it('S04 : engine avec objects seulement → compile, duration=10 par défaut', () => {
    const r = C.compile({
      nodes: [OBJ('obj', 8), ENG('eng','circular'), OUT()],
      edges: [eObj('obj','eng'), eOut('eng')],
    })
    expect(r.success).toBe(true)
    expect(r.objectCount).toBe(8)
    expect(r.duration).toBe(10)
  })

  it('S05 : engine avec duration seulement → compile, objectCount=4 par défaut', () => {
    const r = C.compile({
      nodes: [DUR('dur', 30), ENG('eng','circular'), OUT()],
      edges: [eDur('dur','eng'), eOut('eng')],
    })
    expect(r.success).toBe(true)
    expect(r.objectCount).toBe(4)
    expect(r.duration).toBe(30)
  })

  it('S06 : un nœud objects connecté à deux engines → les deux lisent le même count', () => {
    const r = C.compile({
      nodes: [
        OBJ('obj', 6), DUR('dur', 10),
        ENG('ea', 'circular'), ENG('eb', 'elliptical'),
        n('mix', 'mix', { blend: 0.5 }), OUT(),
      ],
      edges: [
        eObj('obj','ea'), eDur('dur','ea'),
        eObj('obj','eb'), eDur('dur','eb'),
        e('ea','out-trajectory','mix','in-trajectory-0'),
        e('eb','out-trajectory','mix','in-trajectory-1'),
        eOut('mix'),
      ],
    })
    expect(r.success).toBe(true)
    expect(r.objectCount).toBe(6)
  })

  it('S07 : objects count=1 → engine produit une position valide pour i=0', () => {
    const r = C.compile(simple('circular', 1, 10))
    expect(r.success).toBe(true)
    expect(r.objectCount).toBe(1)
    const p = pos(r, 5.0, 0)
    expect(finite(p)).toBe(true)
  })

  it('S08 : objects count=64 (max) → pas de crash', () => {
    const r = C.compile(simple('formation', 64, 10))
    expect(r.success).toBe(true)
    const p = pos(r, 1.0, 63)
    expect(finite(p)).toBe(true)
  })

  it('S09 : duration très courte (0.5s) → engine produit positions finies', () => {
    const r = C.compile(simple('circular', 4, 0.5))
    expect(r.success).toBe(true)
    expect(r.duration).toBe(0.5)
    expect(finite(pos(r, 0.25, 0))).toBe(true)
  })

  it('S10 : un nœud objects connecté à un engine ET à un deuxième engine via double fan-out → les deux obtiennent le bon count', () => {
    // fan-out : out-objects → ea ET eb
    const r = C.compile({
      nodes: [
        OBJ('obj', 3), DUR('dur', 5),
        ENG('ea', 'circular'), ENG('eb', 'lissajous'),
        n('grp', 'group', {}), OUT(),
      ],
      edges: [
        eObj('obj','ea'), eDur('dur','ea'),
        eObj('obj','eb'), eDur('dur','eb'),
        e('ea','out-trajectory','grp','in-trajectory-0'),
        e('eb','out-trajectory','grp','in-trajectory-1'),
        eOut('grp'),
      ],
    })
    expect(r.success).toBe(true)
    expect(r.objectCount).toBe(6)  // group: 3 + 3
  })
})

// ── S11–S20 : modificateurs chaînés ──────────────────────────────────────────

describe('S11–S20 : modificateurs', () => {

  it('S11 : scale(2,2,2) double toutes les coordonnées', () => {
    const base = C.compile(simple('circular', 1, 10))
    const scaled = C.compile({
      nodes: [OBJ('obj',1), DUR('dur',10), ENG('eng','circular'), MOD('scl','scale',{x:2,y:2,z:2}), OUT()],
      edges: [eObj('obj','eng'), eDur('dur','eng'), eTraj('eng','scl'), eOut('scl')],
    })
    const pb = pos(base, 3.0, 0)
    const ps = pos(scaled, 3.0, 0)
    expect(ps.x).toBeCloseTo(pb.x * 2, 4)
    expect(ps.y).toBeCloseTo(pb.y * 2, 4)
    expect(ps.z).toBeCloseTo(pb.z * 2, 4)
  })

  it('S12 : scale(1,1,1) est identité', () => {
    const base   = C.compile(simple('circular', 1, 10))
    const scaled = C.compile({
      nodes: [OBJ('obj',1), DUR('dur',10), ENG('eng','circular'), MOD('scl','scale',{x:1,y:1,z:1}), OUT()],
      edges: [eObj('obj','eng'), eDur('dur','eng'), eTraj('eng','scl'), eOut('scl')],
    })
    const pb = pos(base, 2.0, 0)
    const ps = pos(scaled, 2.0, 0)
    expect(ps.x).toBeCloseTo(pb.x, 5)
    expect(ps.y).toBeCloseTo(pb.y, 5)
  })

  it('S13 : offset(1,0,0) déplace uniquement X', () => {
    const base = C.compile(simple('circular', 1, 10))
    const off  = C.compile({
      nodes: [OBJ('obj',1), DUR('dur',10), ENG('eng','circular'), MOD('off','offset',{x:1,y:0,z:0}), OUT()],
      edges: [eObj('obj','eng'), eDur('dur','eng'), eTraj('eng','off'), eOut('off')],
    })
    const pb = pos(base, 1.5, 0)
    const po = pos(off,  1.5, 0)
    expect(po.x).toBeCloseTo(pb.x + 1, 5)
    expect(po.y).toBeCloseTo(pb.y,     5)
    expect(po.z).toBeCloseTo(pb.z,     5)
  })

  it('S14 : rotate(0,0,π/2) permute X et Y', () => {
    // rotate Z par π/2 : x→-y, y→x
    const base = C.compile(simple('circular', 1, 10))
    const rot  = C.compile({
      nodes: [OBJ('obj',1), DUR('dur',10), ENG('eng','circular'), MOD('rot','rotate',{angleX:0,angleY:0,angleZ:Math.PI/2}), OUT()],
      edges: [eObj('obj','eng'), eDur('dur','eng'), eTraj('eng','rot'), eOut('rot')],
    })
    const pb = pos(base, 1.0, 0)
    const pr = pos(rot,  1.0, 0)
    expect(pr.x).toBeCloseTo(-pb.y, 3)
    expect(pr.y).toBeCloseTo( pb.x, 3)
  })

  it('S15 : phaseShift — objet 0 et objet 1 ne sont pas à la même position à t donné', () => {
    const r = C.compile({
      nodes: [OBJ('obj',4), DUR('dur',10), ENG('eng','circular'), MOD('ps','phaseShift',{shift:0.25}), OUT()],
      edges: [eObj('obj','eng'), eDur('dur','eng'), eTraj('eng','ps'), eOut('ps')],
    })
    const p0 = pos(r, 5.0, 0)
    const p1 = pos(r, 5.0, 1)
    // Avec shift=0.25, d=10 → objet 1 est décalé de 0.25×10=2.5s
    expect(p0.x === p1.x && p0.y === p1.y).toBe(false)
  })

  it('S16 : phaseShift(shift=0) → objet 0 et objet 1 ont même position que sans phaseShift', () => {
    const base  = C.compile(simple('circular', 2, 10))
    const shift = C.compile({
      nodes: [OBJ('obj',2), DUR('dur',10), ENG('eng','circular'), MOD('ps','phaseShift',{shift:0}), OUT()],
      edges: [eObj('obj','eng'), eDur('dur','eng'), eTraj('eng','ps'), eOut('ps')],
    })
    // shift=0 → tShifted = (t + 0) % d = t : identité
    const pb0 = pos(base,  3.0, 0)
    const ps0 = pos(shift, 3.0, 0)
    expect(ps0.x).toBeCloseTo(pb0.x, 5)
    expect(ps0.y).toBeCloseTo(pb0.y, 5)
  })

  it('S17 : barycentricGroup — barycentre de toutes les positions = (cx,cy,cz)', () => {
    const r = C.compile({
      nodes: [OBJ('obj',4), DUR('dur',10), ENG('eng','circular'),
              MOD('bc','barycentricGroup',{centerX:0,centerY:0,centerZ:0}), OUT()],
      edges: [eObj('obj','eng'), eDur('dur','eng'), eTraj('eng','bc'), eOut('bc')],
    })
    expect(r.success).toBe(true)
    const t = 3.0
    const positions = Array.from({length: 4}, (_, i) => pos(r, t, i))
    const bx = positions.reduce((s,p) => s+p.x, 0) / 4
    const by = positions.reduce((s,p) => s+p.y, 0) / 4
    expect(bx).toBeCloseTo(0, 3)
    expect(by).toBeCloseTo(0, 3)
  })

  it('S18 : barycentricGroup avec cx=1,cy=1 → barycentre déplacé', () => {
    const r = C.compile({
      nodes: [OBJ('obj',4), DUR('dur',10), ENG('eng','circular'),
              MOD('bc','barycentricGroup',{centerX:1,centerY:1,centerZ:0}), OUT()],
      edges: [eObj('obj','eng'), eDur('dur','eng'), eTraj('eng','bc'), eOut('bc')],
    })
    const t = 3.0
    const positions = Array.from({length: 4}, (_, i) => pos(r, t, i))
    const bx = positions.reduce((s,p) => s+p.x, 0) / 4
    const by = positions.reduce((s,p) => s+p.y, 0) / 4
    expect(bx).toBeCloseTo(1, 3)
    expect(by).toBeCloseTo(1, 3)
  })

  it('S19 : chaîne scale → offset → output', () => {
    const r = C.compile({
      nodes: [OBJ('obj',1), DUR('dur',10), ENG('eng','circular'),
              MOD('scl','scale',{x:3,y:3,z:1}), MOD('off','offset',{x:10,y:0,z:0}), OUT()],
      edges: [
        eObj('obj','eng'), eDur('dur','eng'),
        eTraj('eng','scl'), eTraj('scl','off'), eOut('off'),
      ],
    })
    const base = C.compile(simple('circular', 1, 10))
    const pb = pos(base, 2.0, 0)
    const pr = pos(r,    2.0, 0)
    expect(pr.x).toBeCloseTo(pb.x * 3 + 10, 3)
    expect(pr.y).toBeCloseTo(pb.y * 3,       3)
  })

  it('S20 : trimSpline [0.5, 1.0] sur circular → t=0 donne même résultat que circular à t=duration/2', () => {
    const r = C.compile({
      nodes: [OBJ('obj',1), DUR('dur',10), ENG('eng','circular'),
              MOD('tr','trimSpline',{start:0.5,end:1.0}), OUT()],
      edges: [eObj('obj','eng'), eDur('dur','eng'), eTraj('eng','tr'), eOut('tr')],
    })
    const base = C.compile(simple('circular', 1, 10))
    // trimSpline start=0.5 → à t=0 : tLocal = 0.5 + (1.0-0.5)*(0%10)/10 = 0.5
    // upstream.fn(0.5*10, 0, 1, 10) = circular à t=5s
    const pb = pos(base, 5.0, 0)  // circular à t=5
    const pt = pos(r,    0.0, 0)  // trim à t=0 → mapped to t=5
    expect(pt.x).toBeCloseTo(pb.x, 3)
    expect(pt.y).toBeCloseTo(pb.y, 3)
  })
})

// ── S21–S30 : nœuds de contrôle ──────────────────────────────────────────────

describe('S21–S30 : nœuds de contrôle', () => {

  it('S21 : mix blend=0 → position = 100% A', () => {
    const rA = C.compile(simple('circular', 4, 10))
    const r  = C.compile({
      nodes: [OBJ('obj',4), DUR('dur',10),
              ENG('ea','circular'), ENG('eb','elliptical'),
              n('mx','mix',{blend:0}), OUT()],
      edges: [
        eObj('obj','ea'), eDur('dur','ea'),
        eObj('obj','eb'), eDur('dur','eb'),
        e('ea','out-trajectory','mx','in-trajectory-0'),
        e('eb','out-trajectory','mx','in-trajectory-1'),
        eOut('mx'),
      ],
    })
    for (let i = 0; i < 4; i++) {
      const pa = pos(rA, 3.0, i)
      const pm = pos(r,  3.0, i)
      expect(pm.x).toBeCloseTo(pa.x, 4)
      expect(pm.y).toBeCloseTo(pa.y, 4)
    }
  })

  it('S22 : mix blend=1 → position = 100% B', () => {
    const rB = C.compile(simple('elliptical', 4, 10))
    const r  = C.compile({
      nodes: [OBJ('obj',4), DUR('dur',10),
              ENG('ea','circular'), ENG('eb','elliptical'),
              n('mx','mix',{blend:1}), OUT()],
      edges: [
        eObj('obj','ea'), eDur('dur','ea'),
        eObj('obj','eb'), eDur('dur','eb'),
        e('ea','out-trajectory','mx','in-trajectory-0'),
        e('eb','out-trajectory','mx','in-trajectory-1'),
        eOut('mx'),
      ],
    })
    for (let i = 0; i < 4; i++) {
      const pb = pos(rB, 3.0, i)
      const pm = pos(r,  3.0, i)
      expect(pm.x).toBeCloseTo(pb.x, 4)
      expect(pm.y).toBeCloseTo(pb.y, 4)
    }
  })

  it('S23 : mix blend=0.5 → position est interpolée entre A et B', () => {
    const rA = C.compile(simple('circular',   4, 10))
    const rB = C.compile(simple('elliptical', 4, 10))
    const r  = C.compile({
      nodes: [OBJ('obj',4), DUR('dur',10),
              ENG('ea','circular'), ENG('eb','elliptical'),
              n('mx','mix',{blend:0.5}), OUT()],
      edges: [
        eObj('obj','ea'), eDur('dur','ea'),
        eObj('obj','eb'), eDur('dur','eb'),
        e('ea','out-trajectory','mx','in-trajectory-0'),
        e('eb','out-trajectory','mx','in-trajectory-1'),
        eOut('mx'),
      ],
    })
    const t = 3.0
    for (let i = 0; i < 4; i++) {
      const pa = pos(rA, t, i)
      const pb = pos(rB, t, i)
      const pm = pos(r,  t, i)
      expect(pm.x).toBeCloseTo((pa.x + pb.x) / 2, 4)
      expect(pm.y).toBeCloseTo((pa.y + pb.y) / 2, 4)
    }
  })

  it('S24 : group(A=3, B=5) → objectCount=8, objets 0-2 dans A, 3-7 dans B', () => {
    const rA = C.compile(simple('circular',   3, 10))
    const rB = C.compile(simple('elliptical', 5, 10))
    const r  = C.compile({
      nodes: [
        OBJ('oa',3), OBJ('ob',5), DUR('dur',10),
        ENG('ea','circular'), ENG('eb','elliptical'),
        n('grp','group',{}), OUT(),
      ],
      edges: [
        eObj('oa','ea'), eDur('dur','ea'),
        eObj('ob','eb'), eDur('dur','eb'),
        e('ea','out-trajectory','grp','in-trajectory-0'),
        e('eb','out-trajectory','grp','in-trajectory-1'),
        eOut('grp'),
      ],
    })
    expect(r.success).toBe(true)
    expect(r.objectCount).toBe(8)
    const t = 4.0
    // Objets 0-2 → circular avec n=3
    for (let i = 0; i < 3; i++) {
      const pg = pos(r,  t, i)
      const pa = pos(rA, t, i)
      expect(pg.x).toBeCloseTo(pa.x, 4)
    }
    // Objets 3-7 → elliptical avec n=5, index remappé
    for (let i = 0; i < 5; i++) {
      const pg = pos(r,  t, i + 3)
      const pb = pos(rB, t, i)
      expect(pg.x).toBeCloseTo(pb.x, 4)
    }
  })

  it('S25 : group donne duration = max(A.dur, B.dur)', () => {
    const r = C.compile({
      nodes: [
        OBJ('oa',2), OBJ('ob',3),
        DUR('da',4), DUR('db',7),
        ENG('ea','circular'), ENG('eb','spiral'),
        n('grp','group',{}), OUT(),
      ],
      edges: [
        eObj('oa','ea'), eDur('da','ea'),
        eObj('ob','eb'), eDur('db','eb'),
        e('ea','out-trajectory','grp','in-trajectory-0'),
        e('eb','out-trajectory','grp','in-trajectory-1'),
        eOut('grp'),
      ],
    })
    expect(r.duration).toBe(7)  // max(4,7)
  })

  it('S26 : sequence(A=4s, B=6s) → duration=10, t<4 joue A, t≥4 joue B', () => {
    const rA = C.compile(simple('circular',   4, 4))
    const rB = C.compile(simple('elliptical', 4, 6))
    const r  = C.compile({
      nodes: [
        OBJ('obj',4), DUR('da',4), DUR('db',6),
        ENG('ea','circular'), ENG('eb','elliptical'),
        n('seq','sequence',{}), OUT(),
      ],
      edges: [
        eObj('obj','ea'), eDur('da','ea'),
        eObj('obj','eb'), eDur('db','eb'),
        e('ea','out-trajectory','seq','in-trajectory-0'),
        e('eb','out-trajectory','seq','in-trajectory-1'),
        eOut('seq'),
      ],
    })
    expect(r.success).toBe(true)
    expect(r.duration).toBe(10)
    // t=2 → dans A (tWrapped=2, <4) → circular à t=2
    const pSeqA = pos(r, 2.0, 0)
    const pA    = pos(rA, 2.0, 0)
    expect(pSeqA.x).toBeCloseTo(pA.x, 4)
    // t=5 → dans B (tWrapped=5, ≥4) → elliptical à t=5-4=1
    const pSeqB = pos(r, 5.0, 0)
    const pB    = pos(rB, 1.0, 0)
    expect(pSeqB.x).toBeCloseTo(pB.x, 4)
  })

  it('S27 : sequence transition correcte a la frontiere A vers B', () => {
    const r = C.compile({
      nodes: [
        OBJ('obj',4), DUR('da',5), DUR('db',5),
        ENG('ea','circular'), ENG('eb','formation'),
        n('seq','sequence',{}), OUT(),
      ],
      edges: [
        eObj('obj','ea'), eDur('da','ea'),
        eObj('obj','eb'), eDur('db','eb'),
        e('ea','out-trajectory','seq','in-trajectory-0'),
        e('eb','out-trajectory','seq','in-trajectory-1'),
        eOut('seq'),
      ],
    })
    // t=4.99 → encore A, t=5.01 → déjà B
    const pBefore = pos(r, 4.99, 0)
    const pAfter  = pos(r, 5.01, 0)
    // Les positions doivent être finies des deux côtés
    expect(finite(pBefore)).toBe(true)
    expect(finite(pAfter)).toBe(true)
    // Et elles sont différentes (circular ≠ formation en général)
    expect(pBefore.x === pAfter.x && pBefore.y === pAfter.y).toBe(false)
  })

  it('S28 : sequence cycle wrap — t=10.5 joue comme t=0.5 (cycle de 10s)', () => {
    const r = C.compile({
      nodes: [
        OBJ('obj',4), DUR('da',5), DUR('db',5),
        ENG('ea','circular'), ENG('eb','circular'),
        n('seq','sequence',{}), OUT(),
      ],
      edges: [
        eObj('obj','ea'), eDur('da','ea'),
        eObj('obj','eb'), eDur('db','eb'),
        e('ea','out-trajectory','seq','in-trajectory-0'),
        e('eb','out-trajectory','seq','in-trajectory-1'),
        eOut('seq'),
      ],
    })
    const p1  = pos(r, 0.5,  0)
    const p2  = pos(r, 10.5, 0)
    // t%10=0.5 → dans A, même résultat
    expect(p1.x).toBeCloseTo(p2.x, 4)
  })

  it('S29 : mix avec counts différents → erreur OBJECT_COUNT_MISMATCH', () => {
    const r = C.compile({
      nodes: [
        OBJ('oa',3), OBJ('ob',5), DUR('dur',10),
        ENG('ea','circular'), ENG('eb','elliptical'),
        n('mx','mix',{blend:0.5}), OUT(),
      ],
      edges: [
        eObj('oa','ea'), eDur('dur','ea'),
        eObj('ob','eb'), eDur('dur','eb'),
        e('ea','out-trajectory','mx','in-trajectory-0'),
        e('eb','out-trajectory','mx','in-trajectory-1'),
        eOut('mx'),
      ],
    })
    expect(r.success).toBe(false)
    expect(r.issues.some(i => i.code === 'OBJECT_COUNT_MISMATCH')).toBe(true)
  })

  it('S30 : sequence avec counts différents → erreur OBJECT_COUNT_MISMATCH', () => {
    const r = C.compile({
      nodes: [
        OBJ('oa',3), OBJ('ob',5), DUR('da',5), DUR('db',5),
        ENG('ea','circular'), ENG('eb','elliptical'),
        n('seq','sequence',{}), OUT(),
      ],
      edges: [
        eObj('oa','ea'), eDur('da','ea'),
        eObj('ob','eb'), eDur('db','eb'),
        e('ea','out-trajectory','seq','in-trajectory-0'),
        e('eb','out-trajectory','seq','in-trajectory-1'),
        eOut('seq'),
      ],
    })
    expect(r.success).toBe(false)
    expect(r.issues.some(i => i.code === 'OBJECT_COUNT_MISMATCH')).toBe(true)
  })
})

// ── S31–S40 : splines ─────────────────────────────────────────────────────────

describe('S31–S40 : splines', () => {

  it('S31 : drawSpline seul → résultat null (pas une trajectoire)', () => {
    const r = C.compile({
      nodes: [n('ds','drawSpline',{ points: THREE_POINTS, tension:0.5, closed:0 }), OUT()],
      edges: [eOut('ds')],
    })
    expect(r.success).toBe(false)
    // drawSpline retourne null → EMPTY_RESULT
    expect(r.issues.some(i => i.code === 'EMPTY_RESULT')).toBe(true)
  })

  it('S32 : drawSpline → evaluateSpline → output compile avec succès', () => {
    const r = C.compile({
      nodes: [
        OBJ('obj',4), DUR('dur',10),
        n('ds','drawSpline',{ points: THREE_POINTS, tension:0.5, closed:0 }),
        n('es','evaluateSpline',{ speed:1, offset:0.25, mode:0 }),
        OUT(),
      ],
      edges: [
        e('ds','out-spline','es','in-spline'),
        eObj('obj','es'), eDur('dur','es'),
        eOut('es'),
      ],
    })
    expect(r.success).toBe(true)
    expect(r.objectCount).toBe(4)
    expect(r.duration).toBe(10)
  })

  it('S33 : evaluateSpline produit des positions finies sur la spline', () => {
    const r = C.compile({
      nodes: [
        OBJ('obj',4), DUR('dur',10),
        n('ds','drawSpline',{ points: THREE_POINTS, tension:0.5, closed:0 }),
        n('es','evaluateSpline',{ speed:1, offset:0.25, mode:0 }),
        OUT(),
      ],
      edges: [
        e('ds','out-spline','es','in-spline'),
        eObj('obj','es'), eDur('dur','es'),
        eOut('es'),
      ],
    })
    for (let i = 0; i < 4; i++) {
      const p = pos(r, 2.5, i)
      expect(finite(p)).toBe(true)
    }
  })

  it('S34 : evaluateSpline sans spline connectée → compile avec warning, utilise spline par défaut', () => {
    const r = C.compile({
      nodes: [
        OBJ('obj',4), DUR('dur',10),
        n('es','evaluateSpline',{ speed:1, offset:0.25, mode:0 }),
        OUT(),
      ],
      edges: [
        eObj('obj','es'), eDur('dur','es'),
        eOut('es'),
      ],
    })
    expect(r.success).toBe(true)
    expect(r.issues.some(i => i.code === 'MISSING_PORT')).toBe(true)
    // Positions finies quand même (fallback 3 pts)
    expect(finite(pos(r, 3.0, 0))).toBe(true)
  })

  it('S35 : evaluateSpline mode=1 (spread) → objets distribués, positions différentes à t fixé', () => {
    const r = C.compile({
      nodes: [
        OBJ('obj',4), DUR('dur',10),
        n('ds','drawSpline',{ points: THREE_POINTS, tension:0.5, closed:0 }),
        n('es','evaluateSpline',{ speed:0, offset:1, mode:1 }),  // mode spread
        OUT(),
      ],
      edges: [
        e('ds','out-spline','es','in-spline'),
        eObj('obj','es'), eDur('dur','es'),
        eOut('es'),
      ],
    })
    // mode=1, speed=0 → positions fixes à t=0, distribuées le long de la spline
    const p0 = pos(r, 0, 0)
    const p1 = pos(r, 0, 1)
    const p2 = pos(r, 0, 2)
    // Objets à positions différentes
    expect(p0.x === p1.x && p0.y === p1.y).toBe(false)
    expect(p1.x === p2.x && p1.y === p2.y).toBe(false)
  })

  it('S36 : drawSpline → evaluateSpline → trimSpline[0.25,0.75] → output', () => {
    const r = C.compile({
      nodes: [
        OBJ('obj',1), DUR('dur',10),
        n('ds','drawSpline',{ points: THREE_POINTS, tension:0.5, closed:0 }),
        n('es','evaluateSpline',{ speed:1, offset:0, mode:0 }),
        MOD('tr','trimSpline',{ start:0.25, end:0.75 }),
        OUT(),
      ],
      edges: [
        e('ds','out-spline','es','in-spline'),
        eObj('obj','es'), eDur('dur','es'),
        eTraj('es','tr'), eOut('tr'),
      ],
    })
    expect(r.success).toBe(true)
    expect(finite(pos(r, 5.0, 0))).toBe(true)
  })

  it('S37 : drawSpline → evaluateSpline → offsetSpline(1,0,0) → X décalé', () => {
    const base = C.compile({
      nodes: [
        OBJ('obj',1), DUR('dur',10),
        n('ds','drawSpline',{ points: THREE_POINTS, tension:0.5, closed:0 }),
        n('es','evaluateSpline',{ speed:1, offset:0, mode:0 }),
        OUT(),
      ],
      edges: [
        e('ds','out-spline','es','in-spline'),
        eObj('obj','es'), eDur('dur','es'), eOut('es'),
      ],
    })
    const offed = C.compile({
      nodes: [
        OBJ('obj',1), DUR('dur',10),
        n('ds','drawSpline',{ points: THREE_POINTS, tension:0.5, closed:0 }),
        n('es','evaluateSpline',{ speed:1, offset:0, mode:0 }),
        MOD('os','offsetSpline',{ x:1, y:0, z:0 }),
        OUT(),
      ],
      edges: [
        e('ds','out-spline','es','in-spline'),
        eObj('obj','es'), eDur('dur','es'),
        eTraj('es','os'), eOut('os'),
      ],
    })
    const pb = pos(base,  3.0, 0)
    const po = pos(offed, 3.0, 0)
    expect(po.x).toBeCloseTo(pb.x + 1, 4)
    expect(po.y).toBeCloseTo(pb.y,     4)
  })

  it('S38 : drawSpline avec points vides (<2) → fallback 3 pts, compile sans crash', () => {
    const r = C.compile({
      nodes: [
        OBJ('obj',2), DUR('dur',5),
        n('ds','drawSpline',{ points: [], tension:0.5, closed:0 }),
        n('es','evaluateSpline',{ speed:1, offset:0.25, mode:0 }),
        OUT(),
      ],
      edges: [
        e('ds','out-spline','es','in-spline'),
        eObj('obj','es'), eDur('dur','es'), eOut('es'),
      ],
    })
    expect(r.success).toBe(true)
    expect(finite(pos(r, 2.0, 0))).toBe(true)
  })

  it('S39 : trimSpline sur engine classique (non-spline) → fonctionne comme TimeSlice', () => {
    // trimSpline[0, 0.5] sur circular → l'objet ne parcourt que la première moitié du cercle
    const base = C.compile(simple('circular', 1, 10))
    const r    = C.compile({
      nodes: [OBJ('obj',1), DUR('dur',10), ENG('eng','circular'),
              MOD('tr','trimSpline',{start:0,end:0.5}), OUT()],
      edges: [eObj('obj','eng'), eDur('dur','eng'), eTraj('eng','tr'), eOut('tr')],
    })
    // À t=duration (=10), tLocal = 0 + 0.5*(10%10)/10 = 0 → position initiale
    // À t=5, tLocal = 0 + 0.5*(5%10)/10 = 0.25 → circular à 0.25*10=2.5s
    const pb = pos(base, 2.5, 0)
    const pt = pos(r,    5.0, 0)
    expect(pt.x).toBeCloseTo(pb.x, 3)
  })

  it('S40 : offsetSpline et offset sont sémantiquement identiques', () => {
    // offsetSpline(2,3,1) = offset(2,3,1)
    const rOff = C.compile({
      nodes: [OBJ('obj',1), DUR('dur',10), ENG('eng','circular'), MOD('off','offset',{x:2,y:3,z:1}), OUT()],
      edges: [eObj('obj','eng'), eDur('dur','eng'), eTraj('eng','off'), eOut('off')],
    })
    const rOS = C.compile({
      nodes: [OBJ('obj',1), DUR('dur',10), ENG('eng','circular'), MOD('os','offsetSpline',{x:2,y:3,z:1}), OUT()],
      edges: [eObj('obj','eng'), eDur('dur','eng'), eTraj('eng','os'), eOut('os')],
    })
    const p1 = pos(rOff, 4.0, 0)
    const p2 = pos(rOS,  4.0, 0)
    expect(p1.x).toBeCloseTo(p2.x, 5)
    expect(p1.y).toBeCloseTo(p2.y, 5)
    expect(p1.z).toBeCloseTo(p2.z, 5)
  })
})

// ── S41–S50 : scénarios complexes croisés ────────────────────────────────────

describe('S41–S50 : scénarios croisés complexes', () => {

  it('S41 : group → scale → output (modifier en aval dun group)', () => {
    const r = C.compile({
      nodes: [
        OBJ('oa',2), OBJ('ob',3), DUR('dur',10),
        ENG('ea','circular'), ENG('eb','elliptical'),
        n('grp','group',{}),
        MOD('scl','scale',{x:2,y:2,z:1}), OUT(),
      ],
      edges: [
        eObj('oa','ea'), eDur('dur','ea'),
        eObj('ob','eb'), eDur('dur','eb'),
        e('ea','out-trajectory','grp','in-trajectory-0'),
        e('eb','out-trajectory','grp','in-trajectory-1'),
        eTraj('grp','scl'), eOut('scl'),
      ],
    })
    expect(r.success).toBe(true)
    expect(r.objectCount).toBe(5)
    for (let i = 0; i < 5; i++) {
      expect(finite(pos(r, 3.0, i))).toBe(true)
    }
  })

  it('S42 : mix → phaseShift → output', () => {
    const r = C.compile({
      nodes: [
        OBJ('obj',4), DUR('dur',10),
        ENG('ea','circular'), ENG('eb','lissajous'),
        n('mx','mix',{blend:0.5}),
        MOD('ps','phaseShift',{shift:0.1}), OUT(),
      ],
      edges: [
        eObj('obj','ea'), eDur('dur','ea'),
        eObj('obj','eb'), eDur('dur','eb'),
        e('ea','out-trajectory','mx','in-trajectory-0'),
        e('eb','out-trajectory','mx','in-trajectory-1'),
        eTraj('mx','ps'), eOut('ps'),
      ],
    })
    expect(r.success).toBe(true)
    const p0 = pos(r, 5.0, 0)
    const p1 = pos(r, 5.0, 1)
    expect(finite(p0)).toBe(true)
    expect(p0.x === p1.x && p0.y === p1.y).toBe(false)
  })

  it('S43 : sequence(A=circular, B=formation) → barycentricGroup → output', () => {
    const r = C.compile({
      nodes: [
        OBJ('obj',4), DUR('da',5), DUR('db',5),
        ENG('ea','circular'), ENG('eb','formation'),
        n('seq','sequence',{}),
        MOD('bc','barycentricGroup',{centerX:0,centerY:0,centerZ:0}),
        OUT(),
      ],
      edges: [
        eObj('obj','ea'), eDur('da','ea'),
        eObj('obj','eb'), eDur('db','eb'),
        e('ea','out-trajectory','seq','in-trajectory-0'),
        e('eb','out-trajectory','seq','in-trajectory-1'),
        eTraj('seq','bc'), eOut('bc'),
      ],
    })
    expect(r.success).toBe(true)
    // Le barycentre doit être ≈ (0,0) à tout instant
    for (const t of [1.0, 3.0, 6.0, 9.0]) {
      const positions = Array.from({length:4}, (_, i) => pos(r, t, i))
      const bx = positions.reduce((s,p) => s+p.x, 0) / 4
      const by = positions.reduce((s,p) => s+p.y, 0) / 4
      expect(bx).toBeCloseTo(0, 2)
      expect(by).toBeCloseTo(0, 2)
    }
  })

  it('S44 : group(A, B) → mix(group, C) → impossible si counts différents', () => {
    // group(A=2, B=3)=5, C=5 → mix(5,5) doit marcher
    const r = C.compile({
      nodes: [
        OBJ('oa',2), OBJ('ob',3), OBJ('oc',5), DUR('dur',10),
        ENG('ea','circular'), ENG('eb','elliptical'), ENG('ec','spiral'),
        n('grp','group',{}), n('mx','mix',{blend:0.5}), OUT(),
      ],
      edges: [
        eObj('oa','ea'), eDur('dur','ea'),
        eObj('ob','eb'), eDur('dur','eb'),
        eObj('oc','ec'), eDur('dur','ec'),
        e('ea','out-trajectory','grp','in-trajectory-0'),
        e('eb','out-trajectory','grp','in-trajectory-1'),
        e('grp','out-trajectory','mx','in-trajectory-0'),
        e('ec','out-trajectory','mx','in-trajectory-1'),
        eOut('mx'),
      ],
    })
    expect(r.success).toBe(true)
    expect(r.objectCount).toBe(5)
  })

  it('S45 : même engine en fan-out dans mix — les deux branches sont identiques → résultat = input', () => {
    // circular → mix.A ET mix.B avec blend=0.5 → output = circular
    const base = C.compile(simple('circular', 4, 10))
    const r = C.compile({
      nodes: [
        OBJ('obj',4), DUR('dur',10),
        ENG('eng','circular'),
        n('mx','mix',{blend:0.5}), OUT(),
      ],
      edges: [
        eObj('obj','eng'), eDur('dur','eng'),
        e('eng','out-trajectory','mx','in-trajectory-0'),
        e('eng','out-trajectory','mx','in-trajectory-1'),
        eOut('mx'),
      ],
    })
    expect(r.success).toBe(true)
    for (let i = 0; i < 4; i++) {
      const pb = pos(base, 3.0, i)
      const pm = pos(r,    3.0, i)
      expect(pm.x).toBeCloseTo(pb.x, 4)
      expect(pm.y).toBeCloseTo(pb.y, 4)
    }
  })

  it('S46 : chaîne longue (engine→scale→rotate→offset→phaseShift→output)', () => {
    const r = C.compile({
      nodes: [
        OBJ('obj',4), DUR('dur',10), ENG('eng','circular'),
        MOD('scl','scale',{x:2,y:2,z:1}),
        MOD('rot','rotate',{angleX:0,angleY:0,angleZ:Math.PI/4}),
        MOD('off','offset',{x:1,y:0,z:0}),
        MOD('ps','phaseShift',{shift:0.1}),
        OUT(),
      ],
      edges: [
        eObj('obj','eng'), eDur('dur','eng'),
        eTraj('eng','scl'), eTraj('scl','rot'),
        eTraj('rot','off'), eTraj('off','ps'),
        eOut('ps'),
      ],
    })
    expect(r.success).toBe(true)
    for (let i = 0; i < 4; i++) {
      expect(finite(pos(r, 4.0, i))).toBe(true)
    }
  })

  it('S47 : group imbriqué : group(group(A,B), C) → objectCount = nA+nB+nC', () => {
    const r = C.compile({
      nodes: [
        OBJ('oa',2), OBJ('ob',3), OBJ('oc',4), DUR('dur',10),
        ENG('ea','circular'), ENG('eb','elliptical'), ENG('ec','spiral'),
        n('g1','group',{}), n('g2','group',{}), OUT(),
      ],
      edges: [
        eObj('oa','ea'), eDur('dur','ea'),
        eObj('ob','eb'), eDur('dur','eb'),
        eObj('oc','ec'), eDur('dur','ec'),
        e('ea','out-trajectory','g1','in-trajectory-0'),
        e('eb','out-trajectory','g1','in-trajectory-1'),
        e('g1','out-trajectory','g2','in-trajectory-0'),
        e('ec','out-trajectory','g2','in-trajectory-1'),
        eOut('g2'),
      ],
    })
    expect(r.success).toBe(true)
    expect(r.objectCount).toBe(9)  // 2+3+4
  })

  it('S48 : drawSpline → evaluateSpline → mix avec engine classique (même count)', () => {
    const r = C.compile({
      nodes: [
        OBJ('obj',4), DUR('dur',10),
        n('ds','drawSpline',{ points: THREE_POINTS, tension:0.5, closed:0 }),
        n('es','evaluateSpline',{ speed:1, offset:0.25, mode:0 }),
        ENG('ec','circular'),
        n('mx','mix',{blend:0.5}), OUT(),
      ],
      edges: [
        e('ds','out-spline','es','in-spline'),
        eObj('obj','es'), eDur('dur','es'),
        eObj('obj','ec'), eDur('dur','ec'),
        e('es','out-trajectory','mx','in-trajectory-0'),
        e('ec','out-trajectory','mx','in-trajectory-1'),
        eOut('mx'),
      ],
    })
    expect(r.success).toBe(true)
    expect(r.objectCount).toBe(4)
    for (let i = 0; i < 4; i++) {
      expect(finite(pos(r, 3.0, i))).toBe(true)
    }
  })

  it('S49 : sequence de deux engines physics (bouncing puis spring)', () => {
    const r = C.compile({
      nodes: [
        OBJ('obj',4), DUR('da',5), DUR('db',5),
        ENG('ea','bouncing',{container:2,shape:0,restitution:0.85,speed:2}),
        ENG('eb','spring',{stiffness:4,damping:0.8,targetX:0,targetY:0,targetZ:0}),
        n('seq','sequence',{}), OUT(),
      ],
      edges: [
        eObj('obj','ea'), eDur('da','ea'),
        eObj('obj','eb'), eDur('db','eb'),
        e('ea','out-trajectory','seq','in-trajectory-0'),
        e('eb','out-trajectory','seq','in-trajectory-1'),
        eOut('seq'),
      ],
    })
    expect(r.success).toBe(true)
    expect(r.duration).toBe(10)
    expect(finite(pos(r, 2.0, 0))).toBe(true)  // dans bouncing
    expect(finite(pos(r, 7.0, 0))).toBe(true)  // dans spring
  })

  it('S50 : group(evaluateSpline, circular) → scale → output', () => {
    const r = C.compile({
      nodes: [
        OBJ('os',3), OBJ('oc',3), DUR('dur',10),
        n('ds','drawSpline',{ points: THREE_POINTS, tension:0.5, closed:0 }),
        n('es','evaluateSpline',{ speed:1, offset:0.25, mode:0 }),
        ENG('ec','circular'),
        n('grp','group',{}), MOD('scl','scale',{x:2,y:2,z:1}), OUT(),
      ],
      edges: [
        e('ds','out-spline','es','in-spline'),
        eObj('os','es'), eDur('dur','es'),
        eObj('oc','ec'), eDur('dur','ec'),
        e('es','out-trajectory','grp','in-trajectory-0'),
        e('ec','out-trajectory','grp','in-trajectory-1'),
        eTraj('grp','scl'), eOut('scl'),
      ],
    })
    expect(r.success).toBe(true)
    expect(r.objectCount).toBe(6)
  })
})

// ── S51–S60 : validations d'erreurs et warnings ───────────────────────────────

describe('S51–S60 : erreurs et warnings', () => {

  it('S51 : nœud orphelin → issue ORPHAN_NODE (info)', () => {
    const r = C.compile({
      nodes: [
        OBJ('obj',4), DUR('dur',10),
        ENG('eng','circular'),          // connecté à output
        ENG('orphan','elliptical'),     // pas connecté
        OUT(),
      ],
      edges: [eObj('obj','eng'), eDur('dur','eng'), eOut('eng')],
    })
    expect(r.success).toBe(true)
    expect(r.issues.some(i => i.code === 'ORPHAN_NODE')).toBe(true)
  })

  it('S52 : double arête sur même port → DUPLICATE_EDGE warning, dernière gagne', () => {
    // Deux arêtes sur 'in-trajectory' de output
    const r = C.compile({
      nodes: [
        OBJ('obj',4), DUR('dur',10),
        ENG('ea','circular'), ENG('eb','elliptical'), OUT(),
      ],
      edges: [
        eObj('obj','ea'), eDur('dur','ea'),
        eObj('obj','eb'), eDur('dur','eb'),
        eOut('ea'),  // première
        eOut('eb'),  // deuxième — gagne
      ],
    })
    expect(r.success).toBe(true)
    expect(r.issues.some(i => i.code === 'DUPLICATE_EDGE')).toBe(true)
    // La trajectoire compilée doit être eb (elliptical), pas ea
    const rB = C.compile(simple('elliptical', 4, 10))
    for (let i = 0; i < 4; i++) {
      const pd = pos(r,  3.0, i)
      const pb = pos(rB, 3.0, i)
      expect(pd.x).toBeCloseTo(pb.x, 4)
    }
  })

  it('S53 : edge vers nœud supprimé → MISSING_NODE warning', () => {
    const r = C.compile({
      nodes: [OUT()],
      edges: [
        { source: 'ghost', sourceHandle: 'out-trajectory', target: 'out', targetHandle: 'in-trajectory' },
      ],
    })
    expect(r.success).toBe(false)
    expect(r.issues.some(i => i.code === 'MISSING_NODE')).toBe(true)
  })

  it('S54 : nœud signal (bpm) connecté à output → SIGNAL_NODE_SKIPPED + EMPTY_RESULT', () => {
    const r = C.compile({
      nodes: [n('s','bpm',{ bpm:120, division:1, swing:0 }), OUT()],
      edges: [eOut('s')],
    })
    expect(r.success).toBe(false)
    expect(r.issues.some(i => i.code === 'SIGNAL_NODE_SKIPPED')).toBe(true)
  })

  it('S55 : falloff (time.sine) connecté à output → SIGNAL_NODE_SKIPPED + EMPTY_RESULT', () => {
    const r = C.compile({
      nodes: [n('f','time.sine',{ frequency:2, phase:0, invert:0 }), OUT()],
      edges: [eOut('f')],
    })
    expect(r.success).toBe(false)
    expect(r.issues.some(i => i.code === 'SIGNAL_NODE_SKIPPED')).toBe(true)
  })

  it('S56 : in-objects connecté à un nœud non-objects → WRONG_PORT_TYPE warning, count ignoré', () => {
    // Connecter la sortie out-trajectory de circular au in-objects d'elliptical
    // Normalement impossible en UI (types incompatibles), mais on teste le compiler
    const r = C.compile({
      nodes: [
        DUR('dur',10),
        ENG('ea','circular'), ENG('eb','elliptical'),
        OUT(),
      ],
      edges: [
        eDur('dur','ea'),
        eDur('dur','eb'),
        // Connexion anormale : trajectory → in-objects
        e('ea','out-trajectory','eb','in-objects'),
        eOut('eb'),
      ],
    })
    // Le compiler doit émettre WRONG_PORT_TYPE
    expect(r.issues.some(i => i.code === 'WRONG_PORT_TYPE')).toBe(true)
    // Mais compile quand même avec le count par défaut
    expect(r.success).toBe(true)
  })

  it('S57 : cycle direct A→B→A → CYCLE error', () => {
    const r = C.compile({
      nodes: [
        ENG('a','circular'), n('b','mix',{blend:0.5}), OUT(),
      ],
      edges: [
        e('a','out-trajectory','b','in-trajectory-0'),
        e('b','out-trajectory','a','in-objects'),
        e('b','out-trajectory','out','in-trajectory'),
      ],
    })
    expect(r.success).toBe(false)
    expect(r.issues.some(i => i.code === 'CYCLE')).toBe(true)
  })

  it('S58 : barycentricGroup avec n=20 → PERF_WARNING', () => {
    const r = C.compile({
      nodes: [
        OBJ('obj',20), DUR('dur',10), ENG('eng','circular'),
        MOD('bc','barycentricGroup',{centerX:0,centerY:0,centerZ:0}), OUT(),
      ],
      edges: [eObj('obj','eng'), eDur('dur','eng'), eTraj('eng','bc'), eOut('bc')],
    })
    expect(r.success).toBe(true)
    expect(r.issues.some(i => i.code === 'PERF_WARNING')).toBe(true)
  })

  it('S59 : barycentricGroup avec n=16 → pas de PERF_WARNING', () => {
    const r = C.compile({
      nodes: [
        OBJ('obj',16), DUR('dur',10), ENG('eng','circular'),
        MOD('bc','barycentricGroup',{centerX:0,centerY:0,centerZ:0}), OUT(),
      ],
      edges: [eObj('obj','eng'), eDur('dur','eng'), eTraj('eng','bc'), eOut('bc')],
    })
    expect(r.success).toBe(true)
    expect(r.issues.some(i => i.code === 'PERF_WARNING')).toBe(false)
  })

  it('S60 : evaluateSpline in-spline connecté à un nœud non-drawSpline → WRONG_PORT_TYPE', () => {
    // Connecter circular (out-trajectory) à in-spline de evaluateSpline
    const r = C.compile({
      nodes: [
        OBJ('obj',4), DUR('dur',10),
        ENG('eng','circular'),
        n('es','evaluateSpline',{ speed:1, offset:0.25, mode:0 }),
        OUT(),
      ],
      edges: [
        eObj('obj','eng'), eDur('dur','eng'),
        e('eng','out-trajectory','es','in-spline'),
        eObj('obj','es'), eDur('dur','es'),
        eOut('es'),
      ],
    })
    // Doit émettre un WRONG_PORT_TYPE et utiliser la spline par défaut
    expect(r.issues.some(i => i.code === 'WRONG_PORT_TYPE')).toBe(true)
    // Mais compile quand même avec fallback
    expect(r.success).toBe(true)
  })
})

// ── S61–S70 : comportement numérique précis ───────────────────────────────────

describe('S61–S70 : valeurs numériques précises', () => {

  it('S61 : circular(radius=1, speed=1, center=0) — à t=0, objet 0 est à (1,0,0)', () => {
    // phase=0 → angle = 0 + phaseOffset(i=0)=0 → x=cos(0)=1, y=sin(0)=0
    const r = C.compile(simple('circular', 1, 10, {radius:1, speed:1, centerX:0, centerY:0, centerZ:0, tiltX:0, tiltZ:0}))
    const p = pos(r, 0, 0)
    expect(p.x).toBeCloseTo(1, 4)
    expect(p.y).toBeCloseTo(0, 4)
    expect(p.z).toBeCloseTo(0, 4)
  })

  it('S62 : circular(radius=1) — à phase=0.25 (t=2.5, d=10), objet 0 est à (0,1,0)', () => {
    // phase=0.25 → angle = 0.25*2π = π/2 → x=cos(π/2)=0, y=sin(π/2)=1
    const r = C.compile(simple('circular', 1, 10, {radius:1, speed:1, centerX:0, centerY:0, centerZ:0, tiltX:0, tiltZ:0}))
    const p = pos(r, 2.5, 0)
    expect(p.x).toBeCloseTo(0, 3)
    expect(p.y).toBeCloseTo(1, 3)
  })

  it('S63 : circular(n=4) — les 4 objets sont séparés de π/2 (90°) à t=0', () => {
    const r = C.compile(simple('circular', 4, 10, {radius:1, speed:1, centerX:0, centerY:0, centerZ:0, tiltX:0, tiltZ:0}))
    // objectIndex/objectCount * 2π → offsets : 0, π/2, π, 3π/2
    const p0 = pos(r, 0, 0)  // angle=0 → (1,0)
    const p1 = pos(r, 0, 1)  // angle=π/2 → (0,1)
    const p2 = pos(r, 0, 2)  // angle=π → (-1,0)
    const p3 = pos(r, 0, 3)  // angle=3π/2 → (0,-1)
    expect(p0.x).toBeCloseTo( 1, 3)
    expect(p0.y).toBeCloseTo( 0, 3)
    expect(p1.x).toBeCloseTo( 0, 3)
    expect(p1.y).toBeCloseTo( 1, 3)
    expect(p2.x).toBeCloseTo(-1, 3)
    expect(p2.y).toBeCloseTo( 0, 3)
    expect(p3.x).toBeCloseTo( 0, 3)
    expect(p3.y).toBeCloseTo(-1, 3)
  })

  it('S64 : linear(x0=-1,y0=0,z0=0, x1=1,y1=0,z1=0, pingpong=0) — à phase=0.5, x=0', () => {
    // Phase=0.5 → lerp(-1,1,0.5) = 0
    const r = C.compile(simple('linear', 1, 10, {x0:-1,y0:0,z0:0, x1:1,y1:0,z1:0, pingpong:0}))
    const p = pos(r, 5.0, 0)  // t=5, phase=0.5
    expect(p.x).toBeCloseTo(0, 3)
    expect(p.y).toBeCloseTo(0, 3)
  })

  it('S65 : mix blend=0.5 interpolé → valeur exacte à mi-chemin', () => {
    // circular à t=0, obj=0 → (1,0,0)
    // elliptical(rX=2,rY=1) à t=0, obj=0 → (2,0,0)
    // mix(0.5) → (1.5, 0, 0)
    const r = C.compile({
      nodes: [
        OBJ('obj',1), DUR('dur',10),
        ENG('ea','circular',  {radius:1,  speed:1, centerX:0,centerY:0,centerZ:0,tiltX:0,tiltZ:0}),
        ENG('eb','elliptical',{radiusX:2, radiusY:0, radiusZ:0, speed:1, centerX:0,centerY:0,centerZ:0}),
        n('mx','mix',{blend:0.5}), OUT(),
      ],
      edges: [
        eObj('obj','ea'), eDur('dur','ea'),
        eObj('obj','eb'), eDur('dur','eb'),
        e('ea','out-trajectory','mx','in-trajectory-0'),
        e('eb','out-trajectory','mx','in-trajectory-1'),
        eOut('mx'),
      ],
    })
    const p = pos(r, 0, 0)
    expect(p.x).toBeCloseTo(1.5, 3)  // (1+2)/2
    expect(p.y).toBeCloseTo(0,   3)
  })

  it('S66 : scale(2,3,4) puis pos vérifiée composante par composante', () => {
    const base = C.compile(simple('circular', 1, 10, {radius:1,speed:1,centerX:0,centerY:0,centerZ:0,tiltX:0,tiltZ:0}))
    const r    = C.compile({
      nodes: [OBJ('obj',1), DUR('dur',10),
              ENG('eng','circular',{radius:1,speed:1,centerX:0,centerY:0,centerZ:0,tiltX:0,tiltZ:0}),
              MOD('scl','scale',{x:2,y:3,z:4}), OUT()],
      edges: [eObj('obj','eng'), eDur('dur','eng'), eTraj('eng','scl'), eOut('scl')],
    })
    const pb = pos(base, 2.5, 0)  // phase=0.25 → (0,1,0)
    const ps = pos(r,    2.5, 0)
    expect(ps.x).toBeCloseTo(pb.x * 2, 4)
    expect(ps.y).toBeCloseTo(pb.y * 3, 4)
    expect(ps.z).toBeCloseTo(pb.z * 4, 4)
  })

  it('S67 : rotate Z=π → position miroir (x→-x, y→-y)', () => {
    const r = C.compile({
      nodes: [OBJ('obj',1), DUR('dur',10),
              ENG('eng','circular',{radius:1,speed:1,centerX:0,centerY:0,centerZ:0,tiltX:0,tiltZ:0}),
              MOD('rot','rotate',{angleX:0,angleY:0,angleZ:Math.PI}), OUT()],
      edges: [eObj('obj','eng'), eDur('dur','eng'), eTraj('eng','rot'), eOut('rot')],
    })
    const base = C.compile(simple('circular', 1, 10, {radius:1,speed:1,centerX:0,centerY:0,centerZ:0,tiltX:0,tiltZ:0}))
    const pb = pos(base, 1.0, 0)
    const pr = pos(r,    1.0, 0)
    expect(pr.x).toBeCloseTo(-pb.x, 3)
    expect(pr.y).toBeCloseTo(-pb.y, 3)
  })

  it('S68 : group objectCount est bien nA + nB pour tous les cas', () => {
    for (const [na, nb] of [[1,1],[2,3],[5,5],[10,1],[4,8]]) {
      const r = C.compile({
        nodes: [
          OBJ('oa',na), OBJ('ob',nb), DUR('dur',10),
          ENG('ea','circular'), ENG('eb','elliptical'),
          n('grp','group',{}), OUT(),
        ],
        edges: [
          eObj('oa','ea'), eDur('dur','ea'),
          eObj('ob','eb'), eDur('dur','eb'),
          e('ea','out-trajectory','grp','in-trajectory-0'),
          e('eb','out-trajectory','grp','in-trajectory-1'),
          eOut('grp'),
        ],
      })
      expect(r.objectCount, `n=${na}+${nb}`).toBe(na + nb)
    }
  })

  it('S69 : phaseShift — calcul exact : shift=0.1, d=10 → obj1 est à (t+1)%10 de obj0', () => {
    const base  = C.compile(simple('circular', 2, 10, {radius:1,speed:1,centerX:0,centerY:0,centerZ:0,tiltX:0,tiltZ:0}))
    const shift = C.compile({
      nodes: [OBJ('obj',2), DUR('dur',10),
              ENG('eng','circular',{radius:1,speed:1,centerX:0,centerY:0,centerZ:0,tiltX:0,tiltZ:0}),
              MOD('ps','phaseShift',{shift:0.1}), OUT()],
      edges: [eObj('obj','eng'), eDur('dur','eng'), eTraj('eng','ps'), eOut('ps')],
    })
    // shift=0.1, d=10, i=1 → tShifted = (3 + 1*0.1*10) % 10 = (3+1)%10 = 4
    const p0Shifted = pos(shift, 3.0, 1)  // obj1 voit t=4
    const p0Base    = pos(base,  4.0, 1)  // obj1 circulaire à t=4
    expect(p0Shifted.x).toBeCloseTo(p0Base.x, 3)
    expect(p0Shifted.y).toBeCloseTo(p0Base.y, 3)
  })

  it('S70 : sequence — à t=totalDur (end of cycle), position = début A', () => {
    const rA = C.compile(simple('circular', 4, 5))
    const r  = C.compile({
      nodes: [
        OBJ('obj',4), DUR('da',5), DUR('db',5),
        ENG('ea','circular'), ENG('eb','elliptical'),
        n('seq','sequence',{}), OUT(),
      ],
      edges: [
        eObj('obj','ea'), eDur('da','ea'),
        eObj('obj','eb'), eDur('db','eb'),
        e('ea','out-trajectory','seq','in-trajectory-0'),
        e('eb','out-trajectory','seq','in-trajectory-1'),
        eOut('seq'),
      ],
    })
    // t=10 → tWrapped = 10 % 10 = 0 → dans A, à t=0
    const pSeq = pos(r,  10.0, 0)
    const pA   = pos(rA,  0.0, 0)
    expect(pSeq.x).toBeCloseTo(pA.x, 4)
    expect(pSeq.y).toBeCloseTo(pA.y, 4)
  })
})
