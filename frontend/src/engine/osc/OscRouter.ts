import type { OscMessage, OscHandler, OscBinding, OscValue } from './types'

// ── Pattern matching ──────────────────────────────────────────────────────────
// Supports OSC wildcard: * matches a single path segment, ** matches any depth

function patternToRegex(pattern: string): RegExp {
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')  // escape regex special chars
    .replace(/\*\*/g, '§DOUBLE§')            // protect ** temporarily
    .replace(/\*/g, '[^/]+')                 // * → single segment
    .replace(/§DOUBLE§/g, '.+')              // ** → any depth
  return new RegExp(`^${escaped}$`)
}

function matchPattern(pattern: string, address: string): boolean {
  return patternToRegex(pattern).test(address)
}

// ── OscRouter ─────────────────────────────────────────────────────────────────

export class OscRouter {
  private handlers   = new Map<string, OscHandler[]>()   // pattern → handlers
  private bindings   = new Map<string, OscBinding>()     // id → binding
  private applyFn:  ((binding: OscBinding, args: OscValue[]) => void) | null = null

  // ── Handler registration ──────────────────────────────────────────────────

  on(pattern: string, handler: OscHandler): () => void {
    if (!this.handlers.has(pattern)) this.handlers.set(pattern, [])
    this.handlers.get(pattern)!.push(handler)
    return () => this.off(pattern, handler)
  }

  off(pattern: string, handler: OscHandler): void {
    const hs = this.handlers.get(pattern)
    if (!hs) return
    const idx = hs.indexOf(handler)
    if (idx !== -1) hs.splice(idx, 1)
  }

  // ── Binding management ────────────────────────────────────────────────────

  setApplyFn(fn: (binding: OscBinding, args: OscValue[]) => void): void {
    this.applyFn = fn
  }

  addBinding(binding: OscBinding): void {
    this.bindings.set(binding.id, binding)
  }

  removeBinding(id: string): void {
    this.bindings.delete(id)
  }

  getBindings(): OscBinding[] {
    return Array.from(this.bindings.values())
  }

  // ── Message dispatch ──────────────────────────────────────────────────────

  dispatch(msg: OscMessage): void {
    // Dispatch to handlers
    for (const [pattern, hs] of this.handlers) {
      if (matchPattern(pattern, msg.address)) {
        for (const h of hs) h(msg)
      }
    }

    // Apply bindings
    if (this.applyFn) {
      for (const binding of this.bindings.values()) {
        if (matchPattern(binding.pattern, msg.address)) {
          this.applyFn(binding, msg.args)
        }
      }
    }
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  clear(): void {
    this.handlers.clear()
    this.bindings.clear()
  }

  /** Convert a first numeric arg to a 0-1 range using binding min/max */
  static normalize(args: OscValue[], binding: OscBinding): number {
    const raw = typeof args[0] === 'number' ? args[0] : 0
    const min = binding.min ?? 0
    const max = binding.max ?? 1
    if (max === min) return 0
    return Math.max(0, Math.min(1, (raw - min) / (max - min)))
  }
}
