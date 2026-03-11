// ── Cue system minimal ────────────────────────────────────────────────────────
// A cue stores a snapshot of the graph nodes state (data fields only).
// Triggering a cue restores that snapshot and recompiles.

export interface CueSnapshot {
  nodeId: string
  data: Record<string, unknown>
}

export interface Cue {
  id: string
  name: string
  color: string           // hex color for UI
  snapshots: CueSnapshot[]
  createdAt: number
}

export type CueCallback = (cue: Cue) => void

export class CueSystem {
  private cues  = new Map<string, Cue>()
  private onGoFn: CueCallback | null = null
  private counter = 0

  // ── Registration ─────────────────────────────────────────────────────────

  setOnGo(fn: CueCallback): void {
    this.onGoFn = fn
  }

  // ── CRUD ─────────────────────────────────────────────────────────────────

  record(snapshots: CueSnapshot[], name?: string): Cue {
    this.counter++
    const id  = `cue-${this.counter}`
    const cue: Cue = {
      id,
      name: name ?? `Cue ${this.counter}`,
      color: CUE_COLORS[this.counter % CUE_COLORS.length],
      snapshots,
      createdAt: Date.now(),
    }
    this.cues.set(id, cue)
    return cue
  }

  update(id: string, patch: Partial<Pick<Cue, 'name' | 'color' | 'snapshots'>>): boolean {
    const cue = this.cues.get(id)
    if (!cue) return false
    Object.assign(cue, patch)
    return true
  }

  delete(id: string): boolean {
    return this.cues.delete(id)
  }

  get(id: string): Cue | undefined {
    return this.cues.get(id)
  }

  getAll(): Cue[] {
    return Array.from(this.cues.values()).sort((a, b) => a.createdAt - b.createdAt)
  }

  clear(): void {
    this.cues.clear()
    this.counter = 0
  }

  // ── Trigger ───────────────────────────────────────────────────────────────

  go(id: string): boolean {
    const cue = this.cues.get(id)
    if (!cue) return false
    this.onGoFn?.(cue)
    return true
  }

  goByIndex(index: number): boolean {
    const all = this.getAll()
    if (index < 0 || index >= all.length) return false
    return this.go(all[index].id)
  }

  // ── Serialization ─────────────────────────────────────────────────────────

  toJSON(): string {
    return JSON.stringify(this.getAll(), null, 2)
  }

  fromJSON(json: string): void {
    const parsed: Cue[] = JSON.parse(json)
    this.cues.clear()
    for (const cue of parsed) {
      this.cues.set(cue.id, cue)
      const n = parseInt(cue.id.replace('cue-', ''), 10)
      if (!isNaN(n) && n > this.counter) this.counter = n
    }
  }
}

// ── Constants ─────────────────────────────────────────────────────────────────

const CUE_COLORS = [
  '#4b7fbf', '#22c55e', '#f59e0b', '#ef4444',
  '#8b5cf6', '#06b6d4', '#ec4899', '#84cc16',
]
