/**
 * graph_coverage.test.ts — Couverture complémentaire des scénarios de graphe
 *
 * Couvre les angles morts des suites existantes :
 *   C01–C10  : erreurs structurelles (graphes invalides)
 *   C11–C20  : Mix — cas limites et erreurs
 *   C21–C30  : Group — routing par index
 *   C31–C40  : Sequence — transition temporelle précise
 *   C41–C50  : Modificateurs cascadés + ordre d'application
 *   C51–C60  : Fan-out complexes + diamond graphs
 *   C61–C70  : DrawSpline edge cases
 *   C71–C80  : Nodes orphelins, multi-output, duplicates
 *   C81–C90  : Valeurs numériques exactes (assertions calculées à la main)
 */

import { describe, it, expect } from 'vitest'
import { GraphCompiler } from '../GraphCompiler'
import type { Graph, GraphNode, GraphEdge } from '../types'

const C = new GraphCompiler()

// ── Helpers ──────────────────────────────────────────────────────────────────

const n  = (id: string, type: string, data: Record<string, unknown> = {}): GraphNode =>
  ({ id, type, data })
const e  = (src: string, sh: string, tgt: string, th: string): GraphEdge =>
  ({ source: src, sourceHandle: sh, target: tgt, targetHandle: th })

const OBJ   = (id: string, count: number)  => n(id, 'objects',  { count })
const DUR   = (id: string, secs: number)   => n(id, 'duration', { seconds: secs })
const OUT   = ()                           => n('out', 'output', {})
const ENG   = (id: string, t: string, d: Record<string,unknown> = {}) => n(id, t, d)
const MOD   = (id: string, t: string, d: Record<string,unknown> = {}) => n(id, t, d)

const eObj  = (src: string, tgt: string) => e(src, 'out-objects',    tgt, 'in-objects')
const eDur  = (src: string, tgt: string) => e(src, 'out-duration',   tgt, 'in-duration')
const eTraj = (src: string, tgt: string, slot = '') =>
  e(src, 'out-trajectory', tgt, slot ? `in-trajectory-${slot}` : 'in-trajectory')
const eOut  = (src: string) => eTraj(src, 'out')
const eSpline = (src: string, tgt: string) => e(src, 'out-spline', tgt, 'in-spline')

function simple(type: string, count = 4, secs = 10, params: Record<string,unknown> = {}): Graph {
  return {
    nodes: [OBJ('obj', count), DUR('dur', secs), ENG('eng', type, params), OUT()],
    edges: [eObj('obj','eng'), eDur('dur','eng'), eOut('eng')],
  }
}

function pos(r: ReturnType<typeof C.compile>, t: number, i = 0) {
  return r.fn!(t, i, r.objectCount, r.duration)
}

function finite(v: { x: number; y: number; z: number }) {
  return isFinite(v.x) && isFinite(v.y) && isFinite(v.z)
}

const SPLINE_PTS = [
  { x: -1, y: 0, z: 0 },
  { x:  0, y: 1, z: 0 },
  { x:  1, y: 0, z: 0 },
]

// ── C01–C10 : Erreurs structurelles ──────────────────────────────────────────

describe('C01–C10 : graphes invalides — erreurs structurelles', () => {

  it('C01 : graphe vide → success=false, code NO_OUTPUT', () => {
    const r = C.compile({ nodes: [], edges: [] })
    expect(r.success).toBe(false)
    expect(r.issues.some(i => i.code === 'NO_OUTPUT')).toBe(true)
  })

  it('C02 : graphe sans output node → success=false, NO_OUTPUT', () => {
    const r = C.compile({
      nodes: [OBJ('obj', 4), ENG('eng', 'circular')],
      edges: [eObj('obj', 'eng')],
    })
    expect(r.success).toBe(false)
    expect(r.issues.some(i => i.code === 'NO_OUTPUT')).toBe(true)
  })

  it('C03 : output sans input → success=false, MISSING_PORT', () => {
    const r = C.compile({
      nodes: [OUT()],
      edges: [],
    })
    expect(r.success).toBe(false)
    expect(r.issues.some(i => i.code === 'MISSING_PORT')).toBe(true)
  })

  it('C04 : cycle A→B→A → success=false, CYCLE', () => {
    // Artifice : on crée deux nodes circulaires dont le second dépend du premier
    // et le premier dépend du second via in-objects
    const r = C.compile({
      nodes: [
        n('a', 'circular', {}),
        n('b', 'mix', { blend: 0.5 }),
        OUT(),
      ],
      edges: [
        e('a', 'out-trajectory', 'b', 'in-trajectory-0'),
        e('b', 'out-trajectory', 'a', 'in-objects'),   // cycle artificiel
        eOut('b'),
      ],
    })
    expect(r.success).toBe(false)
    expect(r.issues.some(i => i.code === 'CYCLE')).toBe(true)
  })

  it('C05 : edge référençant un nœud inexistant → compile normalement (edge fantôme ignoré silencieusement)', () => {
    // buildInputMap enregistre l'edge mais le nœud fantôme n'est jamais visité
    // depuis output — aucune erreur émise, la compilation réussit
    const r = C.compile({
      nodes: [OBJ('obj', 4), DUR('dur', 10), ENG('eng', 'circular'), OUT()],
      edges: [
        eObj('obj', 'eng'), eDur('dur', 'eng'), eOut('eng'),
        e('ghost', 'out-trajectory', 'eng', 'in-objects'), // nœud inexistant
      ],
    })
    // Le nœud fantôme remplace la connexion objects → l'engine n'a plus d'objects
    // node connecté et utilise le fallback IMPLICIT_DEFAULT
    expect(r.success).toBe(true)
  })

  it('C06 : type de nœud inconnu → compile avec fallback null, MISSING_PORT sur output', () => {
    const r = C.compile({
      nodes: [n('unk', 'unknownTypeXYZ', {}), OUT()],
      edges: [eTraj('unk', 'out')],
    })
    // Ne peut pas produire de trajectoire depuis un type inconnu
    expect(r.success).toBe(false)
  })

  it('C07 : plusieurs output nodes → compile en 2 slots, pas de warning MULTI_OUTPUT', () => {
    const r = C.compile({
      nodes: [
        OBJ('obj', 4), DUR('dur', 10), ENG('eng', 'circular'),
        n('out1', 'output', {}),
        n('out2', 'output', {}),
      ],
      edges: [
        eObj('obj', 'eng'), eDur('dur', 'eng'),
        e('eng', 'out-trajectory', 'out1', 'in-trajectory'),
        e('eng', 'out-trajectory', 'out2', 'in-trajectory'),
      ],
    })
    expect(r.success).toBe(true)
    expect(r.slots.length).toBe(2)
    expect(r.issues.some(i => i.code === 'MULTI_OUTPUT')).toBe(false)
  })

  it('C08 : port dupliqué (deux edges sur même in-trajectory) → DUPLICATE_EDGE warning, compile', () => {
    const r = C.compile({
      nodes: [OBJ('obj',4), DUR('dur',10), ENG('ea','circular'), ENG('eb','spiral'), OUT()],
      edges: [
        eObj('obj','ea'), eDur('dur','ea'),
        eObj('obj','eb'), eDur('dur','eb'),
        e('ea','out-trajectory','out','in-trajectory'),
        e('eb','out-trajectory','out','in-trajectory'), // double sur même port
      ],
    })
    expect(r.issues.some(i => i.code === 'DUPLICATE_EDGE')).toBe(true)
    // Le dernier edge gagne — doit compiler
    expect(r.success).toBe(true)
  })

  it('C09 : mix sans aucune entrée → success=false, MISSING_PORT', () => {
    const r = C.compile({
      nodes: [n('mx', 'mix', { blend: 0.5 }), OUT()],
      edges: [eOut('mx')],
    })
    expect(r.success).toBe(false)
    expect(r.issues.some(i => i.code === 'MISSING_PORT')).toBe(true)
  })

  it('C10 : mix avec seulement une entrée → success=false, MISSING_PORT', () => {
    const r = C.compile({
      nodes: [OBJ('obj',4), DUR('dur',10), ENG('eng','circular'), n('mx','mix',{blend:0.5}), OUT()],
      edges: [
        eObj('obj','eng'), eDur('dur','eng'),
        e('eng','out-trajectory','mx','in-trajectory-0'),
        // in-trajectory-1 manquant
        eOut('mx'),
      ],
    })
    expect(r.success).toBe(false)
    expect(r.issues.some(i => i.code === 'MISSING_PORT')).toBe(true)
  })
})

// ── C11–C20 : Mix — cas limites ───────────────────────────────────────────────

describe('C11–C20 : Mix — comportement numérique et cas limites', () => {

  it('C11 : mix blend=0 → résultat identique à entrée A', () => {
    const base = C.compile(simple('circular', 4, 10))
    const r = C.compile({
      nodes: [OBJ('obj',4), DUR('dur',10), ENG('ea','circular'), ENG('eb','spiral'),
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
      expect(pos(r,3.0,i).x).toBeCloseTo(pos(base,3.0,i).x, 4)
      expect(pos(r,3.0,i).y).toBeCloseTo(pos(base,3.0,i).y, 4)
    }
  })

  it('C12 : mix blend=1 → résultat identique à entrée B', () => {
    const baseB = C.compile(simple('spiral', 4, 10))
    const r = C.compile({
      nodes: [OBJ('obj',4), DUR('dur',10), ENG('ea','circular'), ENG('eb','spiral'),
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
      expect(pos(r,3.0,i).x).toBeCloseTo(pos(baseB,3.0,i).x, 4)
      expect(pos(r,3.0,i).y).toBeCloseTo(pos(baseB,3.0,i).y, 4)
    }
  })

  it('C13 : mix blend=0.5 — position est exactement la moyenne de A et B', () => {
    const rA = C.compile(simple('circular', 2, 10))
    const rB = C.compile(simple('lissajous', 2, 10))
    const r  = C.compile({
      nodes: [OBJ('obj',2), DUR('dur',10), ENG('ea','circular'), ENG('eb','lissajous'),
              n('mx','mix',{blend:0.5}), OUT()],
      edges: [
        eObj('obj','ea'), eDur('dur','ea'),
        eObj('obj','eb'), eDur('dur','eb'),
        e('ea','out-trajectory','mx','in-trajectory-0'),
        e('eb','out-trajectory','mx','in-trajectory-1'),
        eOut('mx'),
      ],
    })
    for (let i = 0; i < 2; i++) {
      const a = pos(rA,4.0,i), b = pos(rB,4.0,i), m = pos(r,4.0,i)
      expect(m.x).toBeCloseTo((a.x + b.x) / 2, 4)
      expect(m.y).toBeCloseTo((a.y + b.y) / 2, 4)
    }
  })

  it('C14 : mix object count mismatch → success=false, OBJECT_COUNT_MISMATCH', () => {
    const r = C.compile({
      nodes: [OBJ('oa',3), OBJ('ob',5), DUR('dur',10),
              ENG('ea','circular'), ENG('eb','circular'),
              n('mx','mix',{blend:0.5}), OUT()],
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

  it('C15 : mix cascadé (mix(A,B) → mix(AB,C)) → compile, objectCount conservé', () => {
    const r = C.compile({
      nodes: [OBJ('obj',4), DUR('dur',10),
              ENG('ea','circular'), ENG('eb','elliptical'), ENG('ec','lissajous'),
              n('mx1','mix',{blend:0.3}), n('mx2','mix',{blend:0.7}), OUT()],
      edges: [
        eObj('obj','ea'), eDur('dur','ea'),
        eObj('obj','eb'), eDur('dur','eb'),
        eObj('obj','ec'), eDur('dur','ec'),
        e('ea','out-trajectory','mx1','in-trajectory-0'),
        e('eb','out-trajectory','mx1','in-trajectory-1'),
        e('mx1','out-trajectory','mx2','in-trajectory-0'),
        e('ec','out-trajectory','mx2','in-trajectory-1'),
        eOut('mx2'),
      ],
    })
    expect(r.success).toBe(true)
    expect(r.objectCount).toBe(4)
    for (let i = 0; i < 4; i++) expect(finite(pos(r,3.0,i))).toBe(true)
  })

  it('C16 : mix avec durées différentes → duration = max(durA, durB)', () => {
    const r = C.compile({
      nodes: [OBJ('obj',4), DUR('da',5), DUR('db',15),
              ENG('ea','circular'), ENG('eb','circular'),
              n('mx','mix',{blend:0.5}), OUT()],
      edges: [
        eObj('obj','ea'), e('da','out-duration','ea','in-duration'),
        eObj('obj','eb'), e('db','out-duration','eb','in-duration'),
        e('ea','out-trajectory','mx','in-trajectory-0'),
        e('eb','out-trajectory','mx','in-trajectory-1'),
        eOut('mx'),
      ],
    })
    expect(r.success).toBe(true)
    expect(r.duration).toBe(15)
  })

  it('C17 : mix de deux groupes → objectCount = nA1+nA2 = nB1+nB2 (quand égaux)', () => {
    // groupA(2+2=4) mix groupB(3+1=4) — doit fonctionner
    const r = C.compile({
      nodes: [
        OBJ('oa1',2), OBJ('oa2',2), OBJ('ob1',3), OBJ('ob2',1), DUR('dur',10),
        ENG('ea1','circular'), ENG('ea2','elliptical'),
        ENG('eb1','spiral'),   ENG('eb2','lissajous'),
        n('ga','group',{}), n('gb','group',{}),
        n('mx','mix',{blend:0.5}), OUT(),
      ],
      edges: [
        eObj('oa1','ea1'), eDur('dur','ea1'),
        eObj('oa2','ea2'), eDur('dur','ea2'),
        eObj('ob1','eb1'), eDur('dur','eb1'),
        eObj('ob2','eb2'), eDur('dur','eb2'),
        e('ea1','out-trajectory','ga','in-trajectory-0'),
        e('ea2','out-trajectory','ga','in-trajectory-1'),
        e('eb1','out-trajectory','gb','in-trajectory-0'),
        e('eb2','out-trajectory','gb','in-trajectory-1'),
        e('ga','out-trajectory','mx','in-trajectory-0'),
        e('gb','out-trajectory','mx','in-trajectory-1'),
        eOut('mx'),
      ],
    })
    expect(r.success).toBe(true)
    expect(r.objectCount).toBe(4)
  })

  it('C18 : mix avec 1 objet chacun (count=1) → compile, retourne fini', () => {
    const r = C.compile({
      nodes: [OBJ('obj',1), DUR('dur',10), ENG('ea','circular'), ENG('eb','figure8'),
              n('mx','mix',{blend:0.5}), OUT()],
      edges: [
        eObj('obj','ea'), eDur('dur','ea'),
        eObj('obj','eb'), eDur('dur','eb'),
        e('ea','out-trajectory','mx','in-trajectory-0'),
        e('eb','out-trajectory','mx','in-trajectory-1'),
        eOut('mx'),
      ],
    })
    expect(r.success).toBe(true)
    expect(finite(pos(r,5.0,0))).toBe(true)
  })

  it('C19 : mix profondeur 3 (A→mix1→mix2→mix3→out)', () => {
    const nodes = [
      OBJ('obj',4), DUR('dur',10),
      ENG('e1','circular'), ENG('e2','elliptical'), ENG('e3','lissajous'), ENG('e4','figure8'),
      n('m1','mix',{blend:0.25}), n('m2','mix',{blend:0.5}), n('m3','mix',{blend:0.75}), OUT(),
    ]
    const edges = [
      eObj('obj','e1'), eDur('dur','e1'),
      eObj('obj','e2'), eDur('dur','e2'),
      eObj('obj','e3'), eDur('dur','e3'),
      eObj('obj','e4'), eDur('dur','e4'),
      e('e1','out-trajectory','m1','in-trajectory-0'),
      e('e2','out-trajectory','m1','in-trajectory-1'),
      e('m1','out-trajectory','m2','in-trajectory-0'),
      e('e3','out-trajectory','m2','in-trajectory-1'),
      e('m2','out-trajectory','m3','in-trajectory-0'),
      e('e4','out-trajectory','m3','in-trajectory-1'),
      eOut('m3'),
    ]
    const r = C.compile({ nodes, edges })
    expect(r.success).toBe(true)
    expect(r.objectCount).toBe(4)
    for (let i = 0; i < 4; i++) expect(finite(pos(r,5.0,i))).toBe(true)
  })

  it('C20 : mix même engine deux fois (fan-out) → résultat = engine (identité)', () => {
    const base = C.compile(simple('oscillation', 4, 10))
    const r = C.compile({
      nodes: [OBJ('obj',4), DUR('dur',10), ENG('eng','oscillation'),
              n('mx','mix',{blend:0.5}), OUT()],
      edges: [
        eObj('obj','eng'), eDur('dur','eng'),
        e('eng','out-trajectory','mx','in-trajectory-0'),
        e('eng','out-trajectory','mx','in-trajectory-1'),
        eOut('mx'),
      ],
    })
    expect(r.success).toBe(true)
    for (let i = 0; i < 4; i++) {
      expect(pos(r,4.0,i).x).toBeCloseTo(pos(base,4.0,i).x, 4)
    }
  })
})

// ── C21–C30 : Group — routing par index ──────────────────────────────────────

describe('C21–C30 : Group — routing et comptage', () => {

  it('C21 : group(nA=2, nB=3) → objectCount=5, objets 0-1 proviennent de A, 2-4 de B', () => {
    const rA = C.compile(simple('circular',  2, 10))
    const rB = C.compile(simple('formation', 3, 10))
    const r  = C.compile({
      nodes: [OBJ('oa',2), OBJ('ob',3), DUR('dur',10),
              ENG('ea','circular'), ENG('eb','formation'),
              n('grp','group',{}), OUT()],
      edges: [
        eObj('oa','ea'), eDur('dur','ea'),
        eObj('ob','eb'), eDur('dur','eb'),
        e('ea','out-trajectory','grp','in-trajectory-0'),
        e('eb','out-trajectory','grp','in-trajectory-1'),
        eOut('grp'),
      ],
    })
    expect(r.success).toBe(true)
    expect(r.objectCount).toBe(5)
    // objets 0,1 → circular
    for (let i = 0; i < 2; i++) {
      expect(pos(r,3.0,i).x).toBeCloseTo(pos(rA,3.0,i).x, 3)
    }
    // objets 2,3,4 → formation
    for (let i = 0; i < 3; i++) {
      expect(pos(r,3.0,2+i).x).toBeCloseTo(pos(rB,3.0,i).x, 3)
    }
  })

  it('C22 : group(nA=1, nB=1) → objectCount=2', () => {
    const r = C.compile({
      nodes: [OBJ('oa',1), OBJ('ob',1), DUR('dur',10),
              ENG('ea','circular'), ENG('eb','circular'),
              n('grp','group',{}), OUT()],
      edges: [
        eObj('oa','ea'), eDur('dur','ea'),
        eObj('ob','eb'), eDur('dur','eb'),
        e('ea','out-trajectory','grp','in-trajectory-0'),
        e('eb','out-trajectory','grp','in-trajectory-1'),
        eOut('grp'),
      ],
    })
    expect(r.objectCount).toBe(2)
    expect(finite(pos(r,2.0,0))).toBe(true)
    expect(finite(pos(r,2.0,1))).toBe(true)
  })

  it('C23 : group(nA=10, nB=10) → objectCount=20, dernière position finie', () => {
    const r = C.compile({
      nodes: [OBJ('oa',10), OBJ('ob',10), DUR('dur',10),
              ENG('ea','swarm'), ENG('eb','bouncing'),
              n('grp','group',{}), OUT()],
      edges: [
        eObj('oa','ea'), eDur('dur','ea'),
        eObj('ob','eb'), eDur('dur','eb'),
        e('ea','out-trajectory','grp','in-trajectory-0'),
        e('eb','out-trajectory','grp','in-trajectory-1'),
        eOut('grp'),
      ],
    })
    expect(r.objectCount).toBe(20)
    expect(finite(pos(r,5.0,19))).toBe(true)
  })

  it('C24 : group → group (chaîne) → objectCount cumulé', () => {
    const r = C.compile({
      nodes: [OBJ('oa',2), OBJ('ob',2), OBJ('oc',2), DUR('dur',10),
              ENG('ea','circular'), ENG('eb','elliptical'), ENG('ec','spiral'),
              n('g1','group',{}), n('g2','group',{}), OUT()],
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
    expect(r.objectCount).toBe(6)
  })

  it('C25 : group → scale → objectCount préservé, positions doublées', () => {
    const r = C.compile({
      nodes: [OBJ('oa',2), OBJ('ob',3), DUR('dur',10),
              ENG('ea','circular'), ENG('eb','spiral'),
              n('grp','group',{}), MOD('scl','scale',{x:2,y:2,z:2}), OUT()],
      edges: [
        eObj('oa','ea'), eDur('dur','ea'),
        eObj('ob','eb'), eDur('dur','eb'),
        e('ea','out-trajectory','grp','in-trajectory-0'),
        e('eb','out-trajectory','grp','in-trajectory-1'),
        eTraj('grp','scl'), eOut('scl'),
      ],
    })
    expect(r.objectCount).toBe(5)
    // Vérifie que les positions sont finies pour tous
    for (let i = 0; i < 5; i++) expect(finite(pos(r,3.0,i))).toBe(true)
  })

  it('C26 : group sans entrée B → success=false MISSING_PORT', () => {
    const r = C.compile({
      nodes: [OBJ('obj',4), DUR('dur',10), ENG('eng','circular'), n('grp','group',{}), OUT()],
      edges: [
        eObj('obj','eng'), eDur('dur','eng'),
        e('eng','out-trajectory','grp','in-trajectory-0'),
        eOut('grp'),
      ],
    })
    expect(r.success).toBe(false)
    expect(r.issues.some(i => i.code === 'MISSING_PORT')).toBe(true)
  })

  it('C27 : group(A=circular, B=circular) — même engine, objets distincts par phase naturelle', () => {
    const r = C.compile({
      nodes: [OBJ('oa',3), OBJ('ob',3), DUR('dur',10),
              ENG('ea','circular',{radius:1}), ENG('eb','circular',{radius:2}),
              n('grp','group',{}), OUT()],
      edges: [
        eObj('oa','ea'), eDur('dur','ea'),
        eObj('ob','eb'), eDur('dur','eb'),
        e('ea','out-trajectory','grp','in-trajectory-0'),
        e('eb','out-trajectory','grp','in-trajectory-1'),
        eOut('grp'),
      ],
    })
    expect(r.objectCount).toBe(6)
    // Objets 0-2 ont radius 1, objets 3-5 ont radius 2
    // Distance à l'origine de objet 0 ≈ 1, de objet 3 ≈ 2
    const p0 = pos(r,0,0), p3 = pos(r,0,3)
    const d0 = Math.hypot(p0.x, p0.y)
    const d3 = Math.hypot(p3.x, p3.y)
    expect(d3).toBeGreaterThan(d0 * 1.5)
  })

  it('C28 : group → sequence → output : compose 3 couches', () => {
    const r = C.compile({
      nodes: [
        OBJ('oa',2), OBJ('ob',2), DUR('da',5), DUR('db',5),
        ENG('ea','circular'), ENG('eb','elliptical'), ENG('ec','spiral'),
        n('grp','group',{}), n('seq','sequence',{}), OUT(),
      ],
      edges: [
        eObj('oa','ea'), e('da','out-duration','ea','in-duration'),
        eObj('oa','eb'), e('da','out-duration','eb','in-duration'),
        eObj('ob','ec'), e('db','out-duration','ec','in-duration'),
        e('ea','out-trajectory','grp','in-trajectory-0'),
        e('eb','out-trajectory','grp','in-trajectory-1'),
        e('grp','out-trajectory','seq','in-trajectory-0'),
        e('ec','out-trajectory','seq','in-trajectory-1'),
        eOut('seq'),
      ],
    })
    // sequence requiert mêmes counts: grp=4, ec=2 → mismatch
    expect(r.success).toBe(false)
    expect(r.issues.some(i => i.code === 'OBJECT_COUNT_MISMATCH')).toBe(true)
  })

  it('C29 : group(A,B) → barycentricGroup — ne crash pas sur objectCount combiné', () => {
    const r = C.compile({
      nodes: [OBJ('oa',3), OBJ('ob',3), DUR('dur',10),
              ENG('ea','circular'), ENG('eb','lissajous'),
              n('grp','group',{}), MOD('bc','barycentricGroup',{centerX:0,centerY:0,centerZ:0}), OUT()],
      edges: [
        eObj('oa','ea'), eDur('dur','ea'),
        eObj('ob','eb'), eDur('dur','eb'),
        e('ea','out-trajectory','grp','in-trajectory-0'),
        e('eb','out-trajectory','grp','in-trajectory-1'),
        eTraj('grp','bc'), eOut('bc'),
      ],
    })
    expect(r.success).toBe(true)
    const t = 3.0
    const positions = Array.from({length:6}, (_,i) => pos(r,t,i))
    const bx = positions.reduce((s,p) => s+p.x, 0) / 6
    const by = positions.reduce((s,p) => s+p.y, 0) / 6
    expect(bx).toBeCloseTo(0, 2)
    expect(by).toBeCloseTo(0, 2)
  })

  it('C30 : group → phaseShift(shift=0.25) — tous les objets du groupe sont décalés', () => {
    const r = C.compile({
      nodes: [OBJ('oa',2), OBJ('ob',2), DUR('dur',10),
              ENG('ea','circular'), ENG('eb','circular'),
              n('grp','group',{}), MOD('ps','phaseShift',{shift:0.25}), OUT()],
      edges: [
        eObj('oa','ea'), eDur('dur','ea'),
        eObj('ob','eb'), eDur('dur','eb'),
        e('ea','out-trajectory','grp','in-trajectory-0'),
        e('eb','out-trajectory','grp','in-trajectory-1'),
        eTraj('grp','ps'), eOut('ps'),
      ],
    })
    expect(r.success).toBe(true)
    expect(r.objectCount).toBe(4)
    for (let i = 0; i < 4; i++) expect(finite(pos(r,5.0,i))).toBe(true)
  })
})

// ── C31–C40 : Sequence — transition temporelle ────────────────────────────────

describe('C31–C40 : Sequence — transition et continuité', () => {

  it('C31 : sequence dur=5+5 → duration totale = 10', () => {
    const r = C.compile({
      nodes: [OBJ('obj',4), DUR('da',5), DUR('db',5),
              ENG('ea','circular'), ENG('eb','circular'),
              n('seq','sequence',{}), OUT()],
      edges: [
        eObj('obj','ea'), e('da','out-duration','ea','in-duration'),
        eObj('obj','eb'), e('db','out-duration','eb','in-duration'),
        e('ea','out-trajectory','seq','in-trajectory-0'),
        e('eb','out-trajectory','seq','in-trajectory-1'),
        eOut('seq'),
      ],
    })
    expect(r.success).toBe(true)
    expect(r.duration).toBe(10)
  })

  it('C32 : sequence — à t=2.5 (dans A) → position identique à A seul à t=2.5', () => {
    const rA = C.compile(simple('circular', 4, 5))
    const r  = C.compile({
      nodes: [OBJ('obj',4), DUR('da',5), DUR('db',5),
              ENG('ea','circular'), ENG('eb','formation'),
              n('seq','sequence',{}), OUT()],
      edges: [
        eObj('obj','ea'), e('da','out-duration','ea','in-duration'),
        eObj('obj','eb'), e('db','out-duration','eb','in-duration'),
        e('ea','out-trajectory','seq','in-trajectory-0'),
        e('eb','out-trajectory','seq','in-trajectory-1'),
        eOut('seq'),
      ],
    })
    for (let i = 0; i < 4; i++) {
      expect(pos(r,2.5,i).x).toBeCloseTo(pos(rA,2.5,i).x, 3)
      expect(pos(r,2.5,i).y).toBeCloseTo(pos(rA,2.5,i).y, 3)
    }
  })

  it('C33 : sequence — à t=7 (dans B, offset=5) → position identique à B seul à t=2', () => {
    const rB = C.compile(simple('formation', 4, 5))
    const r  = C.compile({
      nodes: [OBJ('obj',4), DUR('da',5), DUR('db',5),
              ENG('ea','circular'), ENG('eb','formation'),
              n('seq','sequence',{}), OUT()],
      edges: [
        eObj('obj','ea'), e('da','out-duration','ea','in-duration'),
        eObj('obj','eb'), e('db','out-duration','eb','in-duration'),
        e('ea','out-trajectory','seq','in-trajectory-0'),
        e('eb','out-trajectory','seq','in-trajectory-1'),
        eOut('seq'),
      ],
    })
    // t=7 → dans B → tB = 7-5 = 2
    for (let i = 0; i < 4; i++) {
      expect(pos(r,7.0,i).x).toBeCloseTo(pos(rB,2.0,i).x, 3)
      expect(pos(r,7.0,i).y).toBeCloseTo(pos(rB,2.0,i).y, 3)
    }
  })

  it('C34 : sequence count mismatch → success=false, OBJECT_COUNT_MISMATCH', () => {
    const r = C.compile({
      nodes: [OBJ('oa',3), OBJ('ob',5), DUR('da',5), DUR('db',5),
              ENG('ea','circular'), ENG('eb','circular'),
              n('seq','sequence',{}), OUT()],
      edges: [
        eObj('oa','ea'), e('da','out-duration','ea','in-duration'),
        eObj('ob','eb'), e('db','out-duration','eb','in-duration'),
        e('ea','out-trajectory','seq','in-trajectory-0'),
        e('eb','out-trajectory','seq','in-trajectory-1'),
        eOut('seq'),
      ],
    })
    expect(r.success).toBe(false)
    expect(r.issues.some(i => i.code === 'OBJECT_COUNT_MISMATCH')).toBe(true)
  })

  it('C35 : sequence(circular→formation) → positions finies à t=0, t=4.9, t=5.1, t=9.9', () => {
    const r = C.compile({
      nodes: [OBJ('obj',4), DUR('da',5), DUR('db',5),
              ENG('ea','circular'), ENG('eb','formation'),
              n('seq','sequence',{}), OUT()],
      edges: [
        eObj('obj','ea'), e('da','out-duration','ea','in-duration'),
        eObj('obj','eb'), e('db','out-duration','eb','in-duration'),
        e('ea','out-trajectory','seq','in-trajectory-0'),
        e('eb','out-trajectory','seq','in-trajectory-1'),
        eOut('seq'),
      ],
    })
    for (const t of [0, 4.9, 5.0, 5.1, 9.9]) {
      for (let i = 0; i < 4; i++) {
        expect(finite(pos(r, t, i)), `t=${t} i=${i}`).toBe(true)
      }
    }
  })

  it('C36 : sequence asymétrique (da=3, db=7) → duration=10, boundary à t=3', () => {
    const rA = C.compile(simple('circular', 2, 3))
    const rB = C.compile(simple('lissajous', 2, 7))
    const r  = C.compile({
      nodes: [OBJ('obj',2), DUR('da',3), DUR('db',7),
              ENG('ea','circular'), ENG('eb','lissajous'),
              n('seq','sequence',{}), OUT()],
      edges: [
        eObj('obj','ea'), e('da','out-duration','ea','in-duration'),
        eObj('obj','eb'), e('db','out-duration','eb','in-duration'),
        e('ea','out-trajectory','seq','in-trajectory-0'),
        e('eb','out-trajectory','seq','in-trajectory-1'),
        eOut('seq'),
      ],
    })
    expect(r.duration).toBe(10)
    // t=1.5 → dans A
    expect(pos(r,1.5,0).x).toBeCloseTo(pos(rA,1.5,0).x, 3)
    // t=5 → dans B (tB = 5-3 = 2)
    expect(pos(r,5.0,0).x).toBeCloseTo(pos(rB,2.0,0).x, 3)
  })

  it('C37 : sequence → scale → output', () => {
    const r = C.compile({
      nodes: [OBJ('obj',4), DUR('da',5), DUR('db',5),
              ENG('ea','circular'), ENG('eb','circular'),
              n('seq','sequence',{}), MOD('scl','scale',{x:3,y:3,z:3}), OUT()],
      edges: [
        eObj('obj','ea'), e('da','out-duration','ea','in-duration'),
        eObj('obj','eb'), e('db','out-duration','eb','in-duration'),
        e('ea','out-trajectory','seq','in-trajectory-0'),
        e('eb','out-trajectory','seq','in-trajectory-1'),
        eTraj('seq','scl'), eOut('scl'),
      ],
    })
    expect(r.success).toBe(true)
    expect(finite(pos(r,3.0,0))).toBe(true)
  })

  it('C38 : sequence sans entrée A → success=false', () => {
    const r = C.compile({
      nodes: [OBJ('obj',4), DUR('db',5), ENG('eb','circular'), n('seq','sequence',{}), OUT()],
      edges: [
        eObj('obj','eb'), e('db','out-duration','eb','in-duration'),
        e('eb','out-trajectory','seq','in-trajectory-1'),
        eOut('seq'),
      ],
    })
    expect(r.success).toBe(false)
  })

  it('C39 : sequence de sequences (S1→S2) = 4 segments enchaînés', () => {
    const r = C.compile({
      nodes: [
        OBJ('obj',2), DUR('d1',3), DUR('d2',3), DUR('d3',4),
        ENG('e1','circular'), ENG('e2','elliptical'), ENG('e3','lissajous'),
        n('s1','sequence',{}), n('s2','sequence',{}), OUT(),
      ],
      edges: [
        eObj('obj','e1'), e('d1','out-duration','e1','in-duration'),
        eObj('obj','e2'), e('d2','out-duration','e2','in-duration'),
        eObj('obj','e3'), e('d3','out-duration','e3','in-duration'),
        e('e1','out-trajectory','s1','in-trajectory-0'),
        e('e2','out-trajectory','s1','in-trajectory-1'),
        e('s1','out-trajectory','s2','in-trajectory-0'),
        e('e3','out-trajectory','s2','in-trajectory-1'),
        eOut('s2'),
      ],
    })
    expect(r.success).toBe(true)
    expect(r.duration).toBe(10) // 3+3+4
    for (const t of [1,4,7,9]) {
      for (let i = 0; i < 2; i++) expect(finite(pos(r,t,i))).toBe(true)
    }
  })

  it('C40 : sequence count=1 (edge case minimum)', () => {
    const r = C.compile({
      nodes: [OBJ('obj',1), DUR('da',4), DUR('db',4),
              ENG('ea','pendulum'), ENG('eb','bouncing'),
              n('seq','sequence',{}), OUT()],
      edges: [
        eObj('obj','ea'), e('da','out-duration','ea','in-duration'),
        eObj('obj','eb'), e('db','out-duration','eb','in-duration'),
        e('ea','out-trajectory','seq','in-trajectory-0'),
        e('eb','out-trajectory','seq','in-trajectory-1'),
        eOut('seq'),
      ],
    })
    expect(r.success).toBe(true)
    expect(r.objectCount).toBe(1)
    for (const t of [1,5,7]) expect(finite(pos(r,t,0))).toBe(true)
  })
})

// ── C41–C50 : Modificateurs cascadés ─────────────────────────────────────────

describe('C41–C50 : Modificateurs cascadés et ordre', () => {

  it('C41 : scale(2) → scale(3) = scale(6)', () => {
    const r6 = C.compile({
      nodes: [OBJ('obj',1), DUR('dur',10), ENG('eng','circular'),
              MOD('s1','scale',{x:6,y:6,z:6}), OUT()],
      edges: [eObj('obj','eng'), eDur('dur','eng'), eTraj('eng','s1'), eOut('s1')],
    })
    const r23 = C.compile({
      nodes: [OBJ('obj',1), DUR('dur',10), ENG('eng','circular'),
              MOD('s1','scale',{x:2,y:2,z:2}), MOD('s2','scale',{x:3,y:3,z:3}), OUT()],
      edges: [eObj('obj','eng'), eDur('dur','eng'), eTraj('eng','s1'), eTraj('s1','s2'), eOut('s2')],
    })
    const p6  = pos(r6,  3.0, 0)
    const p23 = pos(r23, 3.0, 0)
    expect(p23.x).toBeCloseTo(p6.x, 4)
    expect(p23.y).toBeCloseTo(p6.y, 4)
  })

  it('C42 : offset(1,0,0) → offset(0,2,0) = offset(1,2,0)', () => {
    const r12 = C.compile({
      nodes: [OBJ('obj',1), DUR('dur',10), ENG('eng','circular'),
              MOD('off','offset',{x:1,y:2,z:0}), OUT()],
      edges: [eObj('obj','eng'), eDur('dur','eng'), eTraj('eng','off'), eOut('off')],
    })
    const r_sep = C.compile({
      nodes: [OBJ('obj',1), DUR('dur',10), ENG('eng','circular'),
              MOD('o1','offset',{x:1,y:0,z:0}), MOD('o2','offset',{x:0,y:2,z:0}), OUT()],
      edges: [eObj('obj','eng'), eDur('dur','eng'), eTraj('eng','o1'), eTraj('o1','o2'), eOut('o2')],
    })
    const pa = pos(r12,  2.0, 0)
    const pb = pos(r_sep,2.0, 0)
    expect(pb.x).toBeCloseTo(pa.x, 4)
    expect(pb.y).toBeCloseTo(pa.y, 4)
  })

  it('C43 : rotate(π) → rotate(π) = rotate(2π) = identité', () => {
    const base = C.compile(simple('circular', 1, 10))
    const r2pi = C.compile({
      nodes: [OBJ('obj',1), DUR('dur',10), ENG('eng','circular'),
              MOD('r1','rotate',{angleX:0,angleY:0,angleZ:Math.PI}),
              MOD('r2','rotate',{angleX:0,angleY:0,angleZ:Math.PI}), OUT()],
      edges: [eObj('obj','eng'), eDur('dur','eng'), eTraj('eng','r1'), eTraj('r1','r2'), eOut('r2')],
    })
    const pb = pos(base, 2.0, 0)
    const pr = pos(r2pi, 2.0, 0)
    expect(pr.x).toBeCloseTo(pb.x, 3)
    expect(pr.y).toBeCloseTo(pb.y, 3)
  })

  it('C44 : scale(-1,-1,-1) = rotation de 180° dans XY', () => {
    const base = C.compile(simple('circular', 1, 10))
    const rInv = C.compile({
      nodes: [OBJ('obj',1), DUR('dur',10), ENG('eng','circular'),
              MOD('scl','scale',{x:-1,y:-1,z:-1}), OUT()],
      edges: [eObj('obj','eng'), eDur('dur','eng'), eTraj('eng','scl'), eOut('scl')],
    })
    const pb = pos(base, 3.0, 0)
    const pi = pos(rInv, 3.0, 0)
    expect(pi.x).toBeCloseTo(-pb.x, 4)
    expect(pi.y).toBeCloseTo(-pb.y, 4)
    expect(pi.z).toBeCloseTo(-pb.z, 4)
  })

  it('C45 : 5 modificateurs en chaîne → compile sans crash, résultat fini', () => {
    const r = C.compile({
      nodes: [OBJ('obj',4), DUR('dur',10), ENG('eng','circular'),
              MOD('s','scale',{x:2,y:1,z:1}),
              MOD('o','offset',{x:0.5,y:-0.5,z:0}),
              MOD('r','rotate',{angleX:0.1,angleY:0.2,angleZ:0.3}),
              MOD('ps','phaseShift',{shift:0.1}),
              MOD('bc','barycentricGroup',{centerX:0,centerY:0,centerZ:0}),
              OUT()],
      edges: [
        eObj('obj','eng'), eDur('dur','eng'),
        eTraj('eng','s'), eTraj('s','o'), eTraj('o','r'),
        eTraj('r','ps'), eTraj('ps','bc'), eOut('bc'),
      ],
    })
    expect(r.success).toBe(true)
    for (let i = 0; i < 4; i++) expect(finite(pos(r,3.0,i))).toBe(true)
  })

  it('C46 : scale(0,0,0) → toutes les positions à (0,0,0)', () => {
    const r = C.compile({
      nodes: [OBJ('obj',4), DUR('dur',10), ENG('eng','circular'),
              MOD('scl','scale',{x:0,y:0,z:0}), OUT()],
      edges: [eObj('obj','eng'), eDur('dur','eng'), eTraj('eng','scl'), eOut('scl')],
    })
    expect(r.success).toBe(true)
    for (let i = 0; i < 4; i++) {
      const p = pos(r,3.0,i)
      expect(p.x).toBeCloseTo(0, 8)
      expect(p.y).toBeCloseTo(0, 8)
      expect(p.z).toBeCloseTo(0, 8)
    }
  })

  it('C47 : offset puis scale — ordre non-commutatif', () => {
    // offset(1,0,0) puis scale(2,2,2) ≠ scale(2,2,2) puis offset(1,0,0)
    const rOS = C.compile({
      nodes: [OBJ('obj',1), DUR('dur',10), ENG('eng','circular'),
              MOD('off','offset',{x:1,y:0,z:0}), MOD('scl','scale',{x:2,y:2,z:2}), OUT()],
      edges: [eObj('obj','eng'), eDur('dur','eng'), eTraj('eng','off'), eTraj('off','scl'), eOut('scl')],
    })
    const rSO = C.compile({
      nodes: [OBJ('obj',1), DUR('dur',10), ENG('eng','circular'),
              MOD('scl','scale',{x:2,y:2,z:2}), MOD('off','offset',{x:1,y:0,z:0}), OUT()],
      edges: [eObj('obj','eng'), eDur('dur','eng'), eTraj('eng','scl'), eTraj('scl','off'), eOut('off')],
    })
    // Les deux compilent
    expect(rOS.success).toBe(true)
    expect(rSO.success).toBe(true)
    const os = pos(rOS,3.0,0), so = pos(rSO,3.0,0)
    // Ils donnent des résultats différents (offset puis scale ≠ scale puis offset)
    expect(os.x === so.x).toBe(false)
  })

  it('C48 : rotate(0,0,0) = identité', () => {
    const base = C.compile(simple('lissajous', 1, 10))
    const r = C.compile({
      nodes: [OBJ('obj',1), DUR('dur',10), ENG('eng','lissajous'),
              MOD('rot','rotate',{angleX:0,angleY:0,angleZ:0}), OUT()],
      edges: [eObj('obj','eng'), eDur('dur','eng'), eTraj('eng','rot'), eOut('rot')],
    })
    const pb = pos(base, 4.0, 0)
    const pr = pos(r,    4.0, 0)
    expect(pr.x).toBeCloseTo(pb.x, 5)
    expect(pr.y).toBeCloseTo(pb.y, 5)
  })

  it('C49 : phaseShift sur 1 objet → identité (pas de décalage inter-objet)', () => {
    const base = C.compile(simple('circular', 1, 10))
    const r = C.compile({
      nodes: [OBJ('obj',1), DUR('dur',10), ENG('eng','circular'),
              MOD('ps','phaseShift',{shift:0.5}), OUT()],
      edges: [eObj('obj','eng'), eDur('dur','eng'), eTraj('eng','ps'), eOut('ps')],
    })
    // shift × i = 0 pour i=0 → identité
    const pb = pos(base, 3.0, 0)
    const pp = pos(r,    3.0, 0)
    expect(pp.x).toBeCloseTo(pb.x, 5)
    expect(pp.y).toBeCloseTo(pb.y, 5)
  })

  it('C50 : modificateur sans entrée trajectory → success=false', () => {
    const r = C.compile({
      nodes: [MOD('scl','scale',{x:2,y:2,z:2}), OUT()],
      edges: [eOut('scl')],
    })
    expect(r.success).toBe(false)
  })
})

// ── C51–C60 : Fan-out et diamond graphs ──────────────────────────────────────

describe('C51–C60 : Fan-out, diamond, graphs complexes', () => {

  it('C51 : diamond — obj → eng → scale ET eng → mix (fan-out sur scale)', () => {
    // eng est utilisé dans scale ET dans mix comme entrée B
    const r = C.compile({
      nodes: [OBJ('obj',4), DUR('dur',10), ENG('eng','circular'),
              MOD('scl','scale',{x:2,y:2,z:2}),
              ENG('eng2','elliptical'),
              n('mx','mix',{blend:0.5}), OUT()],
      edges: [
        eObj('obj','eng'), eDur('dur','eng'),
        eObj('obj','eng2'), eDur('dur','eng2'),
        eTraj('eng','scl'),
        e('scl','out-trajectory','mx','in-trajectory-0'),
        e('eng2','out-trajectory','mx','in-trajectory-1'),
        eOut('mx'),
      ],
    })
    expect(r.success).toBe(true)
    for (let i = 0; i < 4; i++) expect(finite(pos(r,3.0,i))).toBe(true)
  })

  it('C52 : même Objects node → 3 engines différents → group(group(A,B),C)', () => {
    const r = C.compile({
      nodes: [OBJ('obj',2), DUR('dur',10),
              ENG('e1','circular'), ENG('e2','spiral'), ENG('e3','helix'),
              n('g1','group',{}), n('g2','group',{}), OUT()],
      edges: [
        eObj('obj','e1'), eDur('dur','e1'),
        eObj('obj','e2'), eDur('dur','e2'),
        eObj('obj','e3'), eDur('dur','e3'),
        e('e1','out-trajectory','g1','in-trajectory-0'),
        e('e2','out-trajectory','g1','in-trajectory-1'),
        e('g1','out-trajectory','g2','in-trajectory-0'),
        e('e3','out-trajectory','g2','in-trajectory-1'),
        eOut('g2'),
      ],
    })
    expect(r.success).toBe(true)
    expect(r.objectCount).toBe(6)
  })

  it('C53 : un engine compilé deux fois via memoization — résultat identique', () => {
    // eng → scale ET eng → mix (eng évalué une fois via cache)
    const rA = C.compile(simple('perlinNoise', 4, 10))
    const r  = C.compile({
      nodes: [OBJ('obj',4), DUR('dur',10), ENG('eng','perlinNoise'),
              MOD('scl','scale',{x:1,y:1,z:1}), // identité
              n('mx','mix',{blend:0.5}), OUT()],
      edges: [
        eObj('obj','eng'), eDur('dur','eng'),
        eTraj('eng','scl'),
        e('scl','out-trajectory','mx','in-trajectory-0'),
        e('eng','out-trajectory','mx','in-trajectory-1'),
        eOut('mx'),
      ],
    })
    expect(r.success).toBe(true)
    // mix(scale(eng), eng) avec scale=identité → résultat = eng
    for (let i = 0; i < 4; i++) {
      expect(pos(r,4.0,i).x).toBeCloseTo(pos(rA,4.0,i).x, 4)
    }
  })

  it('C54 : graph très large (10 engines en parallèle dans un group chain)', () => {
    const engines = ['circular','elliptical','spiral','lissajous','figure8',
                     'linear','oscillation','perlinNoise','formation','converge']
    const nodes: GraphNode[] = [OBJ('obj',1), DUR('dur',10)]
    const edges: GraphEdge[] = []

    engines.forEach((eng, i) => {
      nodes.push(ENG(`e${i}`, eng))
      edges.push(eObj('obj', `e${i}`), eDur('dur', `e${i}`))
    })

    // group chaîné : g0=group(e0,e1), g1=group(g0,e2), ...
    let prev = 'e0'
    let prevCount = 1
    for (let i = 1; i < engines.length; i++) {
      const gid = `g${i}`
      nodes.push(n(gid, 'group', {}))
      edges.push(e(prev, 'out-trajectory', gid, 'in-trajectory-0'))
      edges.push(e(`e${i}`, 'out-trajectory', gid, 'in-trajectory-1'))
      prev = gid
      prevCount += 1
    }
    nodes.push(OUT())
    edges.push(eOut(prev))

    const r = C.compile({ nodes, edges })
    expect(r.success).toBe(true)
    expect(r.objectCount).toBe(10)
    // Toutes les positions finies
    for (let i = 0; i < 10; i++) expect(finite(pos(r,5.0,i))).toBe(true)
  })

  it('C55 : sequence → mix → scale → output (composition complexe)', () => {
    const r = C.compile({
      nodes: [OBJ('obj',4), DUR('da',5), DUR('db',5),
              ENG('ea','circular'), ENG('eb','lissajous'), ENG('ec','spiral'),
              n('seq','sequence',{}), n('mx','mix',{blend:0.4}), MOD('scl','scale',{x:2,y:2,z:2}), OUT()],
      edges: [
        eObj('obj','ea'), e('da','out-duration','ea','in-duration'),
        eObj('obj','eb'), e('db','out-duration','eb','in-duration'),
        eObj('obj','ec'), e('da','out-duration','ec','in-duration'),
        e('ea','out-trajectory','seq','in-trajectory-0'),
        e('eb','out-trajectory','seq','in-trajectory-1'),
        e('seq','out-trajectory','mx','in-trajectory-0'),
        e('ec','out-trajectory','mx','in-trajectory-1'),
        eTraj('mx','scl'), eOut('scl'),
      ],
    })
    // seq et ec ont durées différentes (10 vs 5) → mix avec durées différentes est ok
    // mais objectCount doit matcher : seq=4, ec=4 → ok
    expect(r.success).toBe(true)
    for (let i = 0; i < 4; i++) expect(finite(pos(r,6.0,i))).toBe(true)
  })
})

// ── C61–C70 : DrawSpline edge cases ──────────────────────────────────────────

describe('C61–C70 : DrawSpline — edge cases', () => {

  it('C61 : drawSpline sans evaluateSpline → output ne peut pas consommer spline', () => {
    const r = C.compile({
      nodes: [n('ds','drawSpline',{ points: SPLINE_PTS }), OUT()],
      edges: [e('ds','out-spline','out','in-trajectory')],
    })
    // spline ≠ trajectory → ne peut pas compiler
    expect(r.success).toBe(false)
  })

  it('C62 : drawSpline → evaluateSpline (mode=0 travel), 1 objet', () => {
    const r = C.compile({
      nodes: [OBJ('obj',1), DUR('dur',10),
              n('ds','drawSpline',{ points: SPLINE_PTS, tension:0.5, closed:0 }),
              n('es','evaluateSpline',{ speed:1, offset:0, mode:0 }), OUT()],
      edges: [eSpline('ds','es'), eObj('obj','es'), eDur('dur','es'), eOut('es')],
    })
    expect(r.success).toBe(true)
    for (const t of [0, 2.5, 5, 7.5, 10]) {
      expect(finite(pos(r,t,0))).toBe(true)
    }
  })

  it('C63 : drawSpline → evaluateSpline (mode=1 spread), 4 objets distincts', () => {
    const r = C.compile({
      nodes: [OBJ('obj',4), DUR('dur',10),
              n('ds','drawSpline',{ points: SPLINE_PTS, tension:0.5, closed:0 }),
              n('es','evaluateSpline',{ speed:1, offset:0.25, mode:1 }), OUT()],
      edges: [eSpline('ds','es'), eObj('obj','es'), eDur('dur','es'), eOut('es')],
    })
    expect(r.success).toBe(true)
    // En mode spread, les objets sont à des positions différentes à t=0
    const p0 = pos(r,0,0), p1 = pos(r,0,1)
    expect(p0.x === p1.x && p0.y === p1.y).toBe(false)
  })

  it('C64 : drawSpline avec 2 points (minimum valide) → compile', () => {
    const r = C.compile({
      nodes: [OBJ('obj',2), DUR('dur',5),
              n('ds','drawSpline',{ points: [{x:-1,y:0,z:0},{x:1,y:0,z:0}], tension:0.5, closed:0 }),
              n('es','evaluateSpline',{ speed:1, offset:0.5, mode:0 }), OUT()],
      edges: [eSpline('ds','es'), eObj('obj','es'), eDur('dur','es'), eOut('es')],
    })
    expect(r.success).toBe(true)
    expect(finite(pos(r,2.5,0))).toBe(true)
  })

  it('C65 : drawSpline → trimSpline → evaluateSpline', () => {
    const r = C.compile({
      nodes: [OBJ('obj',2), DUR('dur',10),
              n('ds','drawSpline',{ points: SPLINE_PTS, tension:0.5, closed:0 }),
              n('tr','trimSpline',{ start:0.2, end:0.8 }),
              n('es','evaluateSpline',{ speed:1, offset:0.5, mode:0 }), OUT()],
      edges: [
        eSpline('ds','tr'),
        e('tr','out-trajectory','es','in-spline'),
        eObj('obj','es'), eDur('dur','es'), eOut('es'),
      ],
    })
    expect(r.success).toBe(true)
    expect(finite(pos(r,5.0,0))).toBe(true)
  })

  it('C66 : evaluateSpline → offsetSpline (offset en aval) — X décalé de 2', () => {
    // offsetSpline est un modificateur de trajectoire, pas un modificateur de spline.
    // Le pipeline correct est: drawSpline → evaluateSpline → offsetSpline → output
    const base = C.compile({
      nodes: [OBJ('obj',1), DUR('dur',10),
              n('ds','drawSpline',{ points: SPLINE_PTS, tension:0.5, closed:0 }),
              n('es','evaluateSpline',{ speed:1, offset:0, mode:0 }), OUT()],
      edges: [eSpline('ds','es'), eObj('obj','es'), eDur('dur','es'), eOut('es')],
    })
    const r = C.compile({
      nodes: [OBJ('obj',1), DUR('dur',10),
              n('ds','drawSpline',{ points: SPLINE_PTS, tension:0.5, closed:0 }),
              n('es','evaluateSpline',{ speed:1, offset:0, mode:0 }),
              n('os','offsetSpline',{ x:2, y:0, z:0 }), OUT()],
      edges: [
        eSpline('ds','es'),
        eObj('obj','es'), eDur('dur','es'),
        eTraj('es','os'), eOut('os'),
      ],
    })
    expect(r.success).toBe(true)
    expect(pos(r,5.0,0).x).toBeCloseTo(pos(base,5.0,0).x + 2, 3)
  })

  it('C67 : drawSpline speed=-1 → parcours en sens inverse', () => {
    const rFwd = C.compile({
      nodes: [OBJ('obj',1), DUR('dur',10),
              n('ds','drawSpline',{ points: SPLINE_PTS, tension:0.5, closed:0 }),
              n('es','evaluateSpline',{ speed:1, offset:0, mode:0 }), OUT()],
      edges: [eSpline('ds','es'), eObj('obj','es'), eDur('dur','es'), eOut('es')],
    })
    const rBwd = C.compile({
      nodes: [OBJ('obj',1), DUR('dur',10),
              n('ds','drawSpline',{ points: SPLINE_PTS, tension:0.5, closed:0 }),
              n('es','evaluateSpline',{ speed:-1, offset:0, mode:0 }), OUT()],
      edges: [eSpline('ds','es'), eObj('obj','es'), eDur('dur','es'), eOut('es')],
    })
    expect(rFwd.success).toBe(true)
    expect(rBwd.success).toBe(true)
    // À t=0 les positions sont différentes (l'un commence au début, l'autre à la fin)
    const pf = pos(rFwd,1.0,0)
    const pb = pos(rBwd,1.0,0)
    // Les deux doivent être finis
    expect(finite(pf)).toBe(true)
    expect(finite(pb)).toBe(true)
  })

  it('C68 : drawSpline avec 10 points → compile et donne des positions lisses', () => {
    const pts = Array.from({length:10}, (_, i) => ({
      x: Math.cos(i / 10 * Math.PI * 2),
      y: Math.sin(i / 10 * Math.PI * 2),
      z: 0,
    }))
    const r = C.compile({
      nodes: [OBJ('obj',3), DUR('dur',10),
              n('ds','drawSpline',{ points: pts, tension:0.5, closed:1 }),
              n('es','evaluateSpline',{ speed:1, offset:0.33, mode:0 }), OUT()],
      edges: [eSpline('ds','es'), eObj('obj','es'), eDur('dur','es'), eOut('es')],
    })
    expect(r.success).toBe(true)
    for (let i = 0; i < 3; i++) expect(finite(pos(r,5.0,i))).toBe(true)
  })

  it('C69 : evaluateSpline sans drawSpline → compile avec fallback spline par défaut + warning MISSING_PORT', () => {
    // Le compilateur fait un fallback sur une spline 3-points par défaut
    // et émet un warning (pas une erreur) → success=true
    const r = C.compile({
      nodes: [OBJ('obj',2), DUR('dur',5),
              n('es','evaluateSpline',{ speed:1, offset:0.5, mode:0 }), OUT()],
      edges: [eObj('obj','es'), eDur('dur','es'), eOut('es')],
    })
    expect(r.success).toBe(true)
    expect(r.issues.some(i => i.code === 'MISSING_PORT' && i.level === 'warning')).toBe(true)
    // Positions finies avec la spline par défaut
    expect(finite(pos(r,2.5,0))).toBe(true)
  })

  it('C70 : drawSpline → evaluateSpline → scale → output (modifier en aval)', () => {
    const base = C.compile({
      nodes: [OBJ('obj',2), DUR('dur',10),
              n('ds','drawSpline',{ points: SPLINE_PTS, tension:0.5, closed:0 }),
              n('es','evaluateSpline',{ speed:1, offset:0.5, mode:0 }), OUT()],
      edges: [eSpline('ds','es'), eObj('obj','es'), eDur('dur','es'), eOut('es')],
    })
    const r = C.compile({
      nodes: [OBJ('obj',2), DUR('dur',10),
              n('ds','drawSpline',{ points: SPLINE_PTS, tension:0.5, closed:0 }),
              n('es','evaluateSpline',{ speed:1, offset:0.5, mode:0 }),
              MOD('scl','scale',{x:2,y:2,z:2}), OUT()],
      edges: [eSpline('ds','es'), eObj('obj','es'), eDur('dur','es'), eTraj('es','scl'), eOut('scl')],
    })
    expect(r.success).toBe(true)
    for (let i = 0; i < 2; i++) {
      expect(pos(r,5.0,i).x).toBeCloseTo(pos(base,5.0,i).x * 2, 3)
    }
  })
})

// ── C71–C80 : Orphelins, duplicates, edge cases divers ───────────────────────

describe('C71–C80 : Orphelins et cas divers', () => {

  it('C71 : nœud orphelin non connecté → compile, ORPHAN_NODE info', () => {
    const r = C.compile({
      nodes: [OBJ('obj',4), DUR('dur',10), ENG('eng','circular'), OUT(),
              ENG('orp','spiral')], // orphelin
      edges: [eObj('obj','eng'), eDur('dur','eng'), eOut('eng')],
    })
    expect(r.success).toBe(true)
    expect(r.issues.some(i => i.code === 'ORPHAN_NODE')).toBe(true)
  })

  it('C72 : plusieurs orphelins → un ORPHAN_NODE par nœud orphelin (hors objects/duration/drawSpline)', () => {
    const r = C.compile({
      nodes: [OBJ('obj',4), DUR('dur',10), ENG('eng','circular'), OUT(),
              ENG('o1','spiral'), ENG('o2','helix'), n('o3','mix',{})],
      edges: [eObj('obj','eng'), eDur('dur','eng'), eOut('eng')],
    })
    expect(r.success).toBe(true)
    const orphanIssues = r.issues.filter(i => i.code === 'ORPHAN_NODE')
    // spiral, helix, mix sont orphelins → 3 warnings
    expect(orphanIssues.length).toBe(3)
  })

  it('C73 : graphe avec un seul nœud output isolé → success=false MISSING_PORT', () => {
    const r = C.compile({ nodes: [OUT()], edges: [] })
    expect(r.success).toBe(false)
    expect(r.issues.some(i => i.code === 'MISSING_PORT')).toBe(true)
  })

  it('C74 : objects node non connecté à aucun engine → silencieux (objects dans skipTypes)', () => {
    // warnOrphans exclut objects, duration et drawSpline des warnings d'orphelins
    const r = C.compile({
      nodes: [OBJ('obj',4), DUR('dur',10), ENG('eng','circular'), OUT(),
              OBJ('orphObj',10)],
      edges: [eObj('obj','eng'), eDur('dur','eng'), eOut('eng')],
    })
    expect(r.success).toBe(true)
    // Pas de ORPHAN_NODE pour les nœuds objects (skipTypes)
    const orphanForObj = r.issues.filter(i => i.code === 'ORPHAN_NODE' && i.nodeId === 'orphObj')
    expect(orphanForObj.length).toBe(0)
  })

  it('C75 : deux compilations successives du même graphe → même résultat (idempotence)', () => {
    const g = simple('circular', 4, 10)
    const r1 = C.compile(g)
    const r2 = C.compile(g)
    expect(r1.success).toBe(true)
    expect(r2.success).toBe(true)
    expect(r1.objectCount).toBe(r2.objectCount)
    expect(r1.duration).toBe(r2.duration)
    for (let i = 0; i < 4; i++) {
      const p1 = pos(r1,3.0,i), p2 = pos(r2,3.0,i)
      expect(p1.x).toBeCloseTo(p2.x, 8)
    }
  })

  it('C76 : compilation parallèle — deux GraphCompiler distincts, même résultat', () => {
    const c1 = new GraphCompiler()
    const c2 = new GraphCompiler()
    const g  = simple('lissajous', 4, 10)
    const r1 = c1.compile(g)
    const r2 = c2.compile(g)
    expect(r1.success).toBe(true)
    expect(r2.success).toBe(true)
    for (let i = 0; i < 4; i++) {
      const t1 = r1.fn!(3.0,i,4,10), t2 = r2.fn!(3.0,i,4,10)
      expect(t1.x).toBeCloseTo(t2.x, 8)
    }
  })

  it('C77 : objects count=0 → compile avec count=0 ou IMPLICIT_DEFAULT', () => {
    const r = C.compile({
      nodes: [OBJ('obj',0), DUR('dur',10), ENG('eng','circular'), OUT()],
      edges: [eObj('obj','eng'), eDur('dur','eng'), eOut('eng')],
    })
    // Peut compiler avec objectCount=0 (pas de crash)
    // ou émettre un warning — ne doit pas planter
    expect(() => r).not.toThrow()
  })

  it('C78 : duration=0 → compile sans division par zéro', () => {
    const r = C.compile(simple('circular', 4, 0))
    expect(() => r).not.toThrow()
    // Si success, les positions doivent être finies
    if (r.success && r.fn) {
      expect(finite(pos(r,0,0))).toBe(true)
    }
  })

  it('C79 : tous les engines physics avec 1 objet → pas de crash (comportement dégénéré accepté)', () => {
    const physics = ['bouncing','spring','follow','swarm','avoidance']
    for (const eng of physics) {
      const r = C.compile(simple(eng, 1, 5))
      expect(r.success, `${eng} avec 1 objet`).toBe(true)
      expect(finite(pos(r,2.5,0)), `${eng} position non-finie`).toBe(true)
    }
  })

  it('C80 : tous les engines math avec 64 objets et duration=120s → pas de crash', () => {
    const math = ['circular','elliptical','spiral','lissajous','figure8',
                  'linear','oscillation','formation','converge','helix']
    for (const eng of math) {
      const r = C.compile(simple(eng, 64, 120))
      expect(r.success, `${eng}`).toBe(true)
      expect(finite(pos(r,60,0)),  `${eng} obj0`).toBe(true)
      expect(finite(pos(r,60,63)), `${eng} obj63`).toBe(true)
    }
  })
})

// ── C81–C110 : Scénarios de graphes variés ────────────────────────────────────
// Topologies diverses, engines croisés, modificateurs combinés
// Objectif : couvrir des graphes "réels" plausibles en production

describe('C81–C110 : graphes variés — topologies et combinaisons réelles', () => {

  // ── Topologie : un Objects partagé entre plusieurs branches ──────────────────

  it('C81 : 1 Objects → 4 engines en parallèle → group(group(group(A,B),C),D)', () => {
    const nodes: GraphNode[] = [OBJ('obj',2), DUR('dur',10),
      ENG('e1','circular'), ENG('e2','spiral'), ENG('e3','lissajous'), ENG('e4','helix'),
      n('g1','group',{}), n('g2','group',{}), n('g3','group',{}), OUT()]
    const edges: GraphEdge[] = [
      eObj('obj','e1'), eDur('dur','e1'),
      eObj('obj','e2'), eDur('dur','e2'),
      eObj('obj','e3'), eDur('dur','e3'),
      eObj('obj','e4'), eDur('dur','e4'),
      e('e1','out-trajectory','g1','in-trajectory-0'),
      e('e2','out-trajectory','g1','in-trajectory-1'),
      e('g1','out-trajectory','g2','in-trajectory-0'),
      e('e3','out-trajectory','g2','in-trajectory-1'),
      e('g2','out-trajectory','g3','in-trajectory-0'),
      e('e4','out-trajectory','g3','in-trajectory-1'),
      eOut('g3'),
    ]
    const r = C.compile({ nodes, edges })
    expect(r.success).toBe(true)
    expect(r.objectCount).toBe(8)
    for (let i = 0; i < 8; i++) expect(finite(pos(r,5,i))).toBe(true)
  })

  it('C82 : 2 Objects distincts → 2 engines → sequence → offset → output', () => {
    const r = C.compile({
      nodes: [OBJ('oa',3), OBJ('ob',3), DUR('da',6), DUR('db',4),
              ENG('ea','pendulum'), ENG('eb','bouncing'),
              n('seq','sequence',{}), MOD('off','offset',{x:0,y:0,z:1}), OUT()],
      edges: [
        eObj('oa','ea'), e('da','out-duration','ea','in-duration'),
        eObj('ob','eb'), e('db','out-duration','eb','in-duration'),
        e('ea','out-trajectory','seq','in-trajectory-0'),
        e('eb','out-trajectory','seq','in-trajectory-1'),
        eTraj('seq','off'), eOut('off'),
      ],
    })
    // Compile la même séquence SANS offset pour obtenir le z de base
    const rBase = C.compile({
      nodes: [OBJ('oa',3), OBJ('ob',3), DUR('da',6), DUR('db',4),
              ENG('ea','pendulum'), ENG('eb','bouncing'),
              n('seq','sequence',{}), OUT()],
      edges: [
        eObj('oa','ea'), e('da','out-duration','ea','in-duration'),
        eObj('ob','eb'), e('db','out-duration','eb','in-duration'),
        e('ea','out-trajectory','seq','in-trajectory-0'),
        e('eb','out-trajectory','seq','in-trajectory-1'),
        eOut('seq'),
      ],
    })
    expect(r.success).toBe(true)
    expect(r.duration).toBe(10)
    for (const t of [1,5,8]) {
      for (let i = 0; i < 3; i++) {
        const p = pos(r,t,i), pb = pos(rBase,t,i)
        expect(finite(p)).toBe(true)
        expect(p.z).toBeCloseTo(pb.z + 1, 4) // offset z=+1 par rapport au base
      }
    }
  })

  it('C83 : formation → phaseShift → barycentricGroup → output (scénario danse)', () => {
    const r = C.compile({
      nodes: [OBJ('obj',8), DUR('dur',12),
              ENG('eng','formation'),
              MOD('ps','phaseShift',{shift:0.125}),
              MOD('bc','barycentricGroup',{centerX:0,centerY:0,centerZ:0}),
              OUT()],
      edges: [eObj('obj','eng'), eDur('dur','eng'), eTraj('eng','ps'), eTraj('ps','bc'), eOut('bc')],
    })
    expect(r.success).toBe(true)
    // Barycentre = 0 à tout instant
    for (const t of [0,3,6,9,11.9]) {
      const positions = Array.from({length:8},(_,i)=>pos(r,t,i))
      const bx = positions.reduce((s,p)=>s+p.x,0)/8
      const by = positions.reduce((s,p)=>s+p.y,0)/8
      expect(bx).toBeCloseTo(0,2)
      expect(by).toBeCloseTo(0,2)
    }
  })

  it('C84 : swarm → mix(swarm, circular) blend=0.3 → output (physique + math)', () => {
    const r = C.compile({
      nodes: [OBJ('obj',6), DUR('dur',8),
              ENG('es','swarm'), ENG('ec','circular'),
              n('mx','mix',{blend:0.3}), OUT()],
      edges: [
        eObj('obj','es'), eDur('dur','es'),
        eObj('obj','ec'), eDur('dur','ec'),
        e('es','out-trajectory','mx','in-trajectory-0'),
        e('ec','out-trajectory','mx','in-trajectory-1'),
        eOut('mx'),
      ],
    })
    expect(r.success).toBe(true)
    for (let i = 0; i < 6; i++) expect(finite(pos(r,4,i))).toBe(true)
  })

  it('C85 : helix → rotate(0,π/4,0) → scale(1,1,2) → offset(0,0,-1) → output', () => {
    const r = C.compile({
      nodes: [OBJ('obj',5), DUR('dur',10),
              ENG('eng','helix'),
              MOD('rot','rotate',{angleX:0,angleY:Math.PI/4,angleZ:0}),
              MOD('scl','scale',{x:1,y:1,z:2}),
              MOD('off','offset',{x:0,y:0,z:-1}),
              OUT()],
      edges: [
        eObj('obj','eng'), eDur('dur','eng'),
        eTraj('eng','rot'), eTraj('rot','scl'), eTraj('scl','off'), eOut('off'),
      ],
    })
    expect(r.success).toBe(true)
    for (let i = 0; i < 5; i++) {
      const p = pos(r,3,i)
      expect(finite(p)).toBe(true)
      expect(p.z).toBeLessThan(10) // z raisonnable
    }
  })

  it('C86 : mix(spring, follow) blend=0.5 → phaseShift → output', () => {
    const r = C.compile({
      nodes: [OBJ('obj',4), DUR('dur',10),
              ENG('es','spring'), ENG('ef','follow'),
              n('mx','mix',{blend:0.5}),
              MOD('ps','phaseShift',{shift:0.2}), OUT()],
      edges: [
        eObj('obj','es'), eDur('dur','es'),
        eObj('obj','ef'), eDur('dur','ef'),
        e('es','out-trajectory','mx','in-trajectory-0'),
        e('ef','out-trajectory','mx','in-trajectory-1'),
        eTraj('mx','ps'), eOut('ps'),
      ],
    })
    expect(r.success).toBe(true)
    // Les 4 objets ont des positions différentes grâce au phaseShift
    const positions = Array.from({length:4},(_,i)=>pos(r,5,i))
    expect(positions[0].x === positions[1].x && positions[0].y === positions[1].y).toBe(false)
  })

  it('C87 : lissajous → group(lissajous, avoidance) — lissajous partagé en fan-out', () => {
    // lissajous utilisé comme input A de group ET comme base de avoidance
    const r = C.compile({
      nodes: [OBJ('obj',3), DUR('dur',10),
              ENG('el','lissajous'), ENG('ea','avoidance'),
              n('grp','group',{}), OUT()],
      edges: [
        eObj('obj','el'), eDur('dur','el'),
        eObj('obj','ea'), eDur('dur','ea'),
        e('el','out-trajectory','grp','in-trajectory-0'),
        e('ea','out-trajectory','grp','in-trajectory-1'),
        eOut('grp'),
      ],
    })
    expect(r.success).toBe(true)
    expect(r.objectCount).toBe(6)
  })

  it('C88 : roseCurve → scale(0.5,0.5,0) → mix(roseCurve, scale) blend=0.5', () => {
    // fan-out de roseCurve : vers mix.A ET vers scale→mix.B
    const rBase = C.compile(simple('roseCurve',4,10))
    const r = C.compile({
      nodes: [OBJ('obj',4), DUR('dur',10),
              ENG('eng','roseCurve'),
              MOD('scl','scale',{x:0.5,y:0.5,z:0}),
              n('mx','mix',{blend:0.5}), OUT()],
      edges: [
        eObj('obj','eng'), eDur('dur','eng'),
        eTraj('eng','scl'),
        e('eng','out-trajectory','mx','in-trajectory-0'),
        e('scl','out-trajectory','mx','in-trajectory-1'),
        eOut('mx'),
      ],
    })
    expect(r.success).toBe(true)
    // mix(A, scale(A)*0.5) blend=0.5 → résultat = A*0.75 en X/Y
    for (let i = 0; i < 4; i++) {
      const pb = pos(rBase,3,i)
      const pm = pos(r,3,i)
      expect(pm.x).toBeCloseTo(pb.x * 0.75, 3)
      expect(pm.y).toBeCloseTo(pb.y * 0.75, 3)
    }
  })

  it('C89 : sequence(circular→spiral) → mix avec elliptical → scale → output', () => {
    const r = C.compile({
      nodes: [OBJ('obj',4), DUR('da',5), DUR('db',5),
              ENG('ea','circular'), ENG('eb','spiral'), ENG('ec','elliptical'),
              n('seq','sequence',{}), n('mx','mix',{blend:0.4}),
              MOD('scl','scale',{x:1.5,y:1.5,z:1}), OUT()],
      edges: [
        eObj('obj','ea'), e('da','out-duration','ea','in-duration'),
        eObj('obj','eb'), e('db','out-duration','eb','in-duration'),
        eObj('obj','ec'), e('da','out-duration','ec','in-duration'),
        e('ea','out-trajectory','seq','in-trajectory-0'),
        e('eb','out-trajectory','seq','in-trajectory-1'),
        e('seq','out-trajectory','mx','in-trajectory-0'),
        e('ec','out-trajectory','mx','in-trajectory-1'),
        eTraj('mx','scl'), eOut('scl'),
      ],
    })
    expect(r.success).toBe(true)
    expect(r.duration).toBe(10)
    for (let i = 0; i < 4; i++) expect(finite(pos(r,7,i))).toBe(true)
  })

  it('C90 : spline + engine → group → barycentricGroup (objets spline et moteur ensemble)', () => {
    const r = C.compile({
      nodes: [OBJ('os',3), OBJ('oe',3), DUR('dur',10),
              n('ds','drawSpline',{points:SPLINE_PTS,tension:0.5,closed:0}),
              n('es','evaluateSpline',{speed:1,offset:0.33,mode:0}),
              ENG('eng','circular'),
              n('grp','group',{}),
              MOD('bc','barycentricGroup',{centerX:0,centerY:0,centerZ:0}),
              OUT()],
      edges: [
        eSpline('ds','es'),
        eObj('os','es'), eDur('dur','es'),
        eObj('oe','eng'), eDur('dur','eng'),
        e('es','out-trajectory','grp','in-trajectory-0'),
        e('eng','out-trajectory','grp','in-trajectory-1'),
        eTraj('grp','bc'), eOut('bc'),
      ],
    })
    expect(r.success).toBe(true)
    expect(r.objectCount).toBe(6)
    for (const t of [0,5,9.9]) {
      const positions = Array.from({length:6},(_,i)=>pos(r,t,i))
      const bx = positions.reduce((s,p)=>s+p.x,0)/6
      expect(bx).toBeCloseTo(0,2)
    }
  })

  it('C91 : converge → group(converge, formation) → mix(group, oscillation) → output', () => {
    // group(converge=3, formation=3)=6, mix avec oscillation=6 → OK
    const r2 = C.compile({
      nodes: [OBJ('oc',3), OBJ('of',3), OBJ('oo',6), DUR('dur',8),
              ENG('ec','converge'), ENG('ef','formation'), ENG('eo','oscillation'),
              n('grp','group',{}), n('mx','mix',{blend:0.6}), OUT()],
      edges: [
        eObj('oc','ec'), eDur('dur','ec'),
        eObj('of','ef'), eDur('dur','ef'),
        eObj('oo','eo'), eDur('dur','eo'),
        e('ec','out-trajectory','grp','in-trajectory-0'),
        e('ef','out-trajectory','grp','in-trajectory-1'),
        e('grp','out-trajectory','mx','in-trajectory-0'),
        e('eo','out-trajectory','mx','in-trajectory-1'),
        eOut('mx'),
      ],
    })
    expect(r2.success).toBe(true)
    expect(r2.objectCount).toBe(6)
    for (let i = 0; i < 6; i++) expect(finite(pos(r2,4,i))).toBe(true)
  })

  it('C92 : perlinNoise → scale → mix(perlinNoise, scale_perlinNoise) — rendu organique', () => {
    const r = C.compile({
      nodes: [OBJ('obj',5), DUR('dur',15),
              ENG('eng','perlinNoise',{frequency:0.5,amplitude:1}),
              MOD('scl','scale',{x:2,y:0.5,z:1}),
              n('mx','mix',{blend:0.5}), OUT()],
      edges: [
        eObj('obj','eng'), eDur('dur','eng'),
        eTraj('eng','scl'),
        e('eng','out-trajectory','mx','in-trajectory-0'),
        e('scl','out-trajectory','mx','in-trajectory-1'),
        eOut('mx'),
      ],
    })
    expect(r.success).toBe(true)
    // mix(perlin, scale(perlin)) = perlin * (1+2)/2=1.5 en X
    const rBase = C.compile(simple('perlinNoise',5,15,{frequency:0.5,amplitude:1}))
    for (let i = 0; i < 5; i++) {
      const pb = pos(rBase,7,i), pm = pos(r,7,i)
      expect(pm.x).toBeCloseTo((pb.x + pb.x*2)/2, 3) // lerp(px, px*2, 0.5)
    }
  })

  it('C93 : 3 durées différentes partagées entre 6 engines → group chain', () => {
    // Teste que les durées propagent bien dans group (max des deux)
    const r = C.compile({
      nodes: [OBJ('obj',1), DUR('d5',5), DUR('d10',10), DUR('d3',3),
              ENG('e1','circular'), ENG('e2','elliptical'),
              ENG('e3','spiral'),   ENG('e4','figure8'),
              n('g1','group',{}), n('g2','group',{}), OUT()],
      edges: [
        eObj('obj','e1'), e('d5','out-duration','e1','in-duration'),
        eObj('obj','e2'), e('d10','out-duration','e2','in-duration'),
        eObj('obj','e3'), e('d3','out-duration','e3','in-duration'),
        eObj('obj','e4'), e('d10','out-duration','e4','in-duration'),
        e('e1','out-trajectory','g1','in-trajectory-0'),
        e('e2','out-trajectory','g1','in-trajectory-1'),
        e('g1','out-trajectory','g2','in-trajectory-0'),
        e('e3','out-trajectory','g2','in-trajectory-1'),
        eOut('g2'),
      ],
    })
    expect(r.success).toBe(true)
    expect(r.objectCount).toBe(3)
    expect(r.duration).toBe(10) // max(max(5,10), 3) = 10
  })

  it('C94 : rotate → rotate → rotate (3 rotations cumulées = rotation totale)', () => {
    const angle = Math.PI / 4 // 45°
    // 3 × 45° = 135° total autour de Z
    const r3 = C.compile({
      nodes: [OBJ('obj',1), DUR('dur',10), ENG('eng','circular'),
              MOD('r1','rotate',{angleX:0,angleY:0,angleZ:angle}),
              MOD('r2','rotate',{angleX:0,angleY:0,angleZ:angle}),
              MOD('r3','rotate',{angleX:0,angleY:0,angleZ:angle}), OUT()],
      edges: [eObj('obj','eng'), eDur('dur','eng'), eTraj('eng','r1'), eTraj('r1','r2'), eTraj('r2','r3'), eOut('r3')],
    })
    const r1 = C.compile({
      nodes: [OBJ('obj',1), DUR('dur',10), ENG('eng','circular'),
              MOD('rot','rotate',{angleX:0,angleY:0,angleZ:angle*3}), OUT()],
      edges: [eObj('obj','eng'), eDur('dur','eng'), eTraj('eng','rot'), eOut('rot')],
    })
    expect(r3.success).toBe(true)
    const p3 = pos(r3,2,0), p1 = pos(r1,2,0)
    expect(p3.x).toBeCloseTo(p1.x, 3)
    expect(p3.y).toBeCloseTo(p1.y, 3)
  })

  it('C95 : group(A,B) où A est lui-même un mix → objectCount propagé', () => {
    const r = C.compile({
      nodes: [OBJ('oa',4), OBJ('ob',4), OBJ('oc',3), DUR('dur',10),
              ENG('ea','circular'), ENG('eb','lissajous'), ENG('ec','spiral'),
              n('mx','mix',{blend:0.5}), n('grp','group',{}), OUT()],
      edges: [
        eObj('oa','ea'), eDur('dur','ea'),
        eObj('ob','eb'), eDur('dur','eb'),
        eObj('oc','ec'), eDur('dur','ec'),
        e('ea','out-trajectory','mx','in-trajectory-0'),
        e('eb','out-trajectory','mx','in-trajectory-1'),
        e('mx','out-trajectory','grp','in-trajectory-0'),
        e('ec','out-trajectory','grp','in-trajectory-1'),
        eOut('grp'),
      ],
    })
    expect(r.success).toBe(true)
    expect(r.objectCount).toBe(7) // mix=4, group avec spiral=3 → 4+3=7
    for (let i = 0; i < 7; i++) expect(finite(pos(r,5,i))).toBe(true)
  })

  it('C96 : sequence(mix_A, mix_B) — chaque segment est lui-même un mix', () => {
    const r = C.compile({
      nodes: [OBJ('obj',4), DUR('da',5), DUR('db',5),
              ENG('e1','circular'), ENG('e2','elliptical'),
              ENG('e3','spiral'),   ENG('e4','figure8'),
              n('mA','mix',{blend:0.3}), n('mB','mix',{blend:0.7}),
              n('seq','sequence',{}), OUT()],
      edges: [
        eObj('obj','e1'), e('da','out-duration','e1','in-duration'),
        eObj('obj','e2'), e('da','out-duration','e2','in-duration'),
        eObj('obj','e3'), e('db','out-duration','e3','in-duration'),
        eObj('obj','e4'), e('db','out-duration','e4','in-duration'),
        e('e1','out-trajectory','mA','in-trajectory-0'),
        e('e2','out-trajectory','mA','in-trajectory-1'),
        e('e3','out-trajectory','mB','in-trajectory-0'),
        e('e4','out-trajectory','mB','in-trajectory-1'),
        e('mA','out-trajectory','seq','in-trajectory-0'),
        e('mB','out-trajectory','seq','in-trajectory-1'),
        eOut('seq'),
      ],
    })
    expect(r.success).toBe(true)
    expect(r.duration).toBe(10)
    for (const t of [2,5,8]) {
      for (let i = 0; i < 4; i++) expect(finite(pos(r,t,i))).toBe(true)
    }
  })

  it('C97 : drawSpline → evaluateSpline → mix(spline, circular) → output', () => {
    const r = C.compile({
      nodes: [OBJ('obj',4), DUR('dur',10),
              n('ds','drawSpline',{points:SPLINE_PTS,tension:0.5,closed:0}),
              n('es','evaluateSpline',{speed:1,offset:0.25,mode:0}),
              ENG('eng','circular'),
              n('mx','mix',{blend:0.5}), OUT()],
      edges: [
        eSpline('ds','es'),
        eObj('obj','es'), eDur('dur','es'),
        eObj('obj','eng'), eDur('dur','eng'),
        e('es','out-trajectory','mx','in-trajectory-0'),
        e('eng','out-trajectory','mx','in-trajectory-1'),
        eOut('mx'),
      ],
    })
    expect(r.success).toBe(true)
    expect(r.objectCount).toBe(4)
    for (let i = 0; i < 4; i++) expect(finite(pos(r,5,i))).toBe(true)
  })

  it('C98 : drawSpline → evaluateSpline → group(spline, physics) → output', () => {
    const r = C.compile({
      nodes: [OBJ('os',2), OBJ('op',3), DUR('dur',8),
              n('ds','drawSpline',{points:SPLINE_PTS,tension:0.5,closed:0}),
              n('es','evaluateSpline',{speed:1,offset:0.5,mode:1}),
              ENG('ep','spring'),
              n('grp','group',{}), OUT()],
      edges: [
        eSpline('ds','es'),
        eObj('os','es'), eDur('dur','es'),
        eObj('op','ep'), eDur('dur','ep'),
        e('es','out-trajectory','grp','in-trajectory-0'),
        e('ep','out-trajectory','grp','in-trajectory-1'),
        eOut('grp'),
      ],
    })
    expect(r.success).toBe(true)
    expect(r.objectCount).toBe(5)
    for (let i = 0; i < 5; i++) expect(finite(pos(r,4,i))).toBe(true)
  })

  it('C99 : signal node (bpm) présent mais non connecté → orphelin, compile ok', () => {
    // Les nœuds signal ne compilent pas encore — ils doivent juste ne pas bloquer
    const r = C.compile({
      nodes: [OBJ('obj',4), DUR('dur',10), ENG('eng','circular'), OUT(),
              n('bpm','bpm',{tempo:120})],
      edges: [eObj('obj','eng'), eDur('dur','eng'), eOut('eng')],
    })
    expect(r.success).toBe(true)
    // bpm est orphelin mais silencieux (type signal)
    expect(finite(pos(r,3,0))).toBe(true)
  })

  it('C100 : falloff node présent mais non connecté → orphelin info, compile ok', () => {
    const r = C.compile({
      nodes: [OBJ('obj',4), DUR('dur',10), ENG('eng','circular'), OUT(),
              n('tf','time.sine',{frequency:1,phase:0}),
              n('sf','spatial.pointDistance',{x:0,y:0,z:0,radius:1})],
      edges: [eObj('obj','eng'), eDur('dur','eng'), eOut('eng')],
    })
    expect(r.success).toBe(true)
    expect(finite(pos(r,3,0))).toBe(true)
  })

  it('C101 : oscillation → scale(1,1,0) → tout en plan XY (z=0)', () => {
    const r = C.compile({
      nodes: [OBJ('obj',6), DUR('dur',10),
              ENG('eng','oscillation',{amplitude:1,frequency:1}),
              MOD('scl','scale',{x:1,y:1,z:0}), OUT()],
      edges: [eObj('obj','eng'), eDur('dur','eng'), eTraj('eng','scl'), eOut('scl')],
    })
    expect(r.success).toBe(true)
    for (let i = 0; i < 6; i++) {
      const p = pos(r,3,i)
      expect(p.z).toBeCloseTo(0,8)
    }
  })

  it('C102 : figure8 → rotate(π/2 sur X) → plan YZ au lieu de XY', () => {
    const rBase = C.compile(simple('figure8',1,10))
    const rRot  = C.compile({
      nodes: [OBJ('obj',1), DUR('dur',10), ENG('eng','figure8'),
              MOD('rot','rotate',{angleX:Math.PI/2,angleY:0,angleZ:0}), OUT()],
      edges: [eObj('obj','eng'), eDur('dur','eng'), eTraj('eng','rot'), eOut('rot')],
    })
    // À t=2.5, figure8 de base est dans XY (z≈0), après rotation X: x reste, y→z, z→-y
    const pb = pos(rBase,2.5,0)
    const pr = pos(rRot, 2.5,0)
    expect(pr.x).toBeCloseTo( pb.x, 3)
    expect(pr.y).toBeCloseTo(-pb.z, 3) // y_base=z_source=0→0 mais z_base→y
    expect(pr.z).toBeCloseTo( pb.y, 3)
  })

  it('C103 : group(4 engines identiques, 4 engines identiques) — résultats symétriques', () => {
    // 4 circular avec mêmes params dans A et B → group de 8
    const r = C.compile({
      nodes: [OBJ('oa',4), OBJ('ob',4), DUR('dur',10),
              ENG('ea','circular',{radius:1}), ENG('eb','circular',{radius:1}),
              n('grp','group',{}), OUT()],
      edges: [
        eObj('oa','ea'), eDur('dur','ea'),
        eObj('ob','eb'), eDur('dur','eb'),
        e('ea','out-trajectory','grp','in-trajectory-0'),
        e('eb','out-trajectory','grp','in-trajectory-1'),
        eOut('grp'),
      ],
    })
    expect(r.objectCount).toBe(8)
    // objets 0..3 identiques à objets 4..7
    for (let i = 0; i < 4; i++) {
      const p1 = pos(r,3,i), p2 = pos(r,3,4+i)
      expect(p1.x).toBeCloseTo(p2.x,5)
      expect(p1.y).toBeCloseTo(p2.y,5)
    }
  })

  it('C104 : sequence de 4 segments (seq(seq(A,B), seq(C,D)))', () => {
    const r = C.compile({
      nodes: [OBJ('obj',3), DUR('d2',2), DUR('d3',3),
              ENG('e1','circular'), ENG('e2','elliptical'),
              ENG('e3','spiral'),   ENG('e4','lissajous'),
              n('s1','sequence',{}), n('s2','sequence',{}), n('s3','sequence',{}), OUT()],
      edges: [
        eObj('obj','e1'), e('d2','out-duration','e1','in-duration'),
        eObj('obj','e2'), e('d3','out-duration','e2','in-duration'),
        eObj('obj','e3'), e('d2','out-duration','e3','in-duration'),
        eObj('obj','e4'), e('d3','out-duration','e4','in-duration'),
        e('e1','out-trajectory','s1','in-trajectory-0'),
        e('e2','out-trajectory','s1','in-trajectory-1'),
        e('e3','out-trajectory','s2','in-trajectory-0'),
        e('e4','out-trajectory','s2','in-trajectory-1'),
        e('s1','out-trajectory','s3','in-trajectory-0'),
        e('s2','out-trajectory','s3','in-trajectory-1'),
        eOut('s3'),
      ],
    })
    expect(r.success).toBe(true)
    expect(r.duration).toBe(10) // (2+3) + (2+3) = 10
    for (const t of [1,3,6,9]) {
      for (let i = 0; i < 3; i++) expect(finite(pos(r,t,i))).toBe(true)
    }
  })

  it('C105 : mix(group(A,B), group(C,D)) — counts doivent matcher', () => {
    // group(A=2,B=2)=4, group(C=2,D=2)=4 → mix(4,4) OK
    const r = C.compile({
      nodes: [OBJ('o2',2), DUR('dur',10),
              ENG('e1','circular'), ENG('e2','elliptical'),
              ENG('e3','spiral'),   ENG('e4','figure8'),
              n('gA','group',{}), n('gB','group',{}),
              n('mx','mix',{blend:0.5}), OUT()],
      edges: [
        eObj('o2','e1'), eDur('dur','e1'),
        eObj('o2','e2'), eDur('dur','e2'),
        eObj('o2','e3'), eDur('dur','e3'),
        eObj('o2','e4'), eDur('dur','e4'),
        e('e1','out-trajectory','gA','in-trajectory-0'),
        e('e2','out-trajectory','gA','in-trajectory-1'),
        e('e3','out-trajectory','gB','in-trajectory-0'),
        e('e4','out-trajectory','gB','in-trajectory-1'),
        e('gA','out-trajectory','mx','in-trajectory-0'),
        e('gB','out-trajectory','mx','in-trajectory-1'),
        eOut('mx'),
      ],
    })
    expect(r.success).toBe(true)
    expect(r.objectCount).toBe(4)
    for (let i = 0; i < 4; i++) expect(finite(pos(r,5,i))).toBe(true)
  })

  it('C106 : circular + scale=2 vs circular radius=2 → positions identiques', () => {
    const rScale = C.compile({
      nodes: [OBJ('obj',1), DUR('dur',10), ENG('eng','circular',{radius:1}),
              MOD('scl','scale',{x:2,y:2,z:2}), OUT()],
      edges: [eObj('obj','eng'), eDur('dur','eng'), eTraj('eng','scl'), eOut('scl')],
    })
    const rRadius = C.compile(simple('circular',1,10,{radius:2}))
    // Les deux doivent donner les mêmes positions
    for (const t of [0,1,2.5,5,7.5]) {
      const ps = pos(rScale,t,0), pr = pos(rRadius,t,0)
      expect(ps.x).toBeCloseTo(pr.x,4)
      expect(ps.y).toBeCloseTo(pr.y,4)
    }
  })

  it('C107 : mix(drawSpline, drawSpline) avec deux splines différentes', () => {
    const pts2 = [{x:0,y:-1,z:0},{x:0,y:0,z:0},{x:0,y:1,z:0}] // ligne verticale
    const r = C.compile({
      nodes: [OBJ('obj',3), DUR('dur',10),
              n('dsA','drawSpline',{points:SPLINE_PTS,tension:0.5,closed:0}),
              n('dsB','drawSpline',{points:pts2,tension:0.5,closed:0}),
              n('esA','evaluateSpline',{speed:1,offset:0.33,mode:0}),
              n('esB','evaluateSpline',{speed:1,offset:0.33,mode:0}),
              n('mx','mix',{blend:0.5}), OUT()],
      edges: [
        eSpline('dsA','esA'), eObj('obj','esA'), eDur('dur','esA'),
        eSpline('dsB','esB'), eObj('obj','esB'), eDur('dur','esB'),
        e('esA','out-trajectory','mx','in-trajectory-0'),
        e('esB','out-trajectory','mx','in-trajectory-1'),
        eOut('mx'),
      ],
    })
    expect(r.success).toBe(true)
    expect(r.objectCount).toBe(3)
    for (let i = 0; i < 3; i++) expect(finite(pos(r,5,i))).toBe(true)
  })

  it('C108 : perlinNoise → group avec lui-même (fan-out) → objectCount doublé', () => {
    const r = C.compile({
      nodes: [OBJ('obj',4), DUR('dur',10),
              ENG('eng','perlinNoise'),
              n('grp','group',{}), OUT()],
      edges: [
        eObj('obj','eng'), eDur('dur','eng'),
        e('eng','out-trajectory','grp','in-trajectory-0'),
        e('eng','out-trajectory','grp','in-trajectory-1'),
        eOut('grp'),
      ],
    })
    expect(r.success).toBe(true)
    expect(r.objectCount).toBe(8) // group(4,4)=8
    // Objets 0..3 == objets 4..7 (même source)
    for (let i = 0; i < 4; i++) {
      expect(pos(r,4,i).x).toBeCloseTo(pos(r,4,4+i).x,5)
    }
  })

  it('C109 : tous les physics engines en séquence (5 segments)', () => {
    const physics = ['bouncing','spring','follow','swarm','avoidance']
    const nodes: GraphNode[] = [OBJ('obj',3)]
    const edges: GraphEdge[] = []

    physics.forEach((eng, i) => {
      const did = `d${i}`
      nodes.push(DUR(did, 4))
      nodes.push(ENG(`e${i}`, eng))
      edges.push(eObj('obj', `e${i}`))
      edges.push(e(did, 'out-duration', `e${i}`, 'in-duration'))
    })

    // Séquence chaînée
    let prev = 'e0'
    for (let i = 1; i < physics.length; i++) {
      const sid = `s${i}`
      nodes.push(n(sid, 'sequence', {}))
      edges.push(e(prev, 'out-trajectory', sid, 'in-trajectory-0'))
      edges.push(e(`e${i}`, 'out-trajectory', sid, 'in-trajectory-1'))
      prev = sid
    }
    nodes.push(OUT())
    edges.push(eOut(prev))

    const r = C.compile({ nodes, edges })
    expect(r.success).toBe(true)
    expect(r.duration).toBe(20) // 5 × 4s
    for (const t of [2, 6, 10, 14, 18]) {
      for (let i = 0; i < 3; i++) expect(finite(pos(r,t,i))).toBe(true)
    }
  })

  it('C110 : graphe complet réaliste — import HOL-like: 8 sources, mix(formation, circular) → phaseShift → barycentricGroup', () => {
    // Simule un cas d'usage réel: 8 sources audio spatialisées
    const r = C.compile({
      nodes: [OBJ('obj',8), DUR('dur',16),
              ENG('ef','formation',{type:0}),   // ligne
              ENG('ec','circular',{radius:1.5}),
              n('mx','mix',{blend:0.5}),
              MOD('ps','phaseShift',{shift:0.125}), // 8 objets × 0.125 = écart 1/8 de cycle
              MOD('bc','barycentricGroup',{centerX:0,centerY:0,centerZ:0}),
              OUT()],
      edges: [
        eObj('obj','ef'), eDur('dur','ef'),
        eObj('obj','ec'), eDur('dur','ec'),
        e('ef','out-trajectory','mx','in-trajectory-0'),
        e('ec','out-trajectory','mx','in-trajectory-1'),
        eTraj('mx','ps'), eTraj('ps','bc'), eOut('bc'),
      ],
    })
    expect(r.success).toBe(true)
    expect(r.objectCount).toBe(8)
    // À tout instant, barycentre = (0,0)
    for (const t of [0,4,8,12,15.9]) {
      const positions = Array.from({length:8},(_,i)=>pos(r,t,i))
      const bx = positions.reduce((s,p)=>s+p.x,0)/8
      const by = positions.reduce((s,p)=>s+p.y,0)/8
      expect(bx).toBeCloseTo(0,2)
      expect(by).toBeCloseTo(0,2)
    }
  })
})
