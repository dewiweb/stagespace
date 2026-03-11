// ── .hol file parser ─────────────────────────────────────────────────────────
// A .hol file is a JSON file with two possible root keys:
//
//   "hol" : object — keys are OSC paths, values are arrays of arguments
//           Contains: /mixerSoundElementOrder, /preset/name, /station/version
//           and /track/N/view3D/... (3D model info only in recent versions)
//
//   "ae"  : array of strings — each string is a raw OSC command with inline args
//           e.g. '/track/1/name "Violin"', '/track/1/color 0.5 0.8 0.2 1.0'
//           Contains the rich metadata (name, color, position) in all versions.
//
// Strategy:
//   1. Parse "ae" array first → primary source for name, color, azim/elev/dist
//   2. Fall back to "hol" /mixerSoundElementOrder for track ID list
//   3. Fall back to "hol" /track/N/name etc. for old-format files without "ae"

export interface HolTrack {
  id: number
  name: string
  color: [number, number, number, number]  // RGBA 0–1
  visible: boolean
  azim?: number
  elev?: number
  dist?: number
}

export interface HolProject {
  presetName: string
  version: string
  tracks: HolTrack[]
  rawEntries: Record<string, unknown>
}

export interface HolParseResult {
  success: boolean
  project?: HolProject
  error?: string
}

// ── Main entry point ─────────────────────────────────────────────────────────

export function parseHolFile(content: string): HolParseResult {
  let root: unknown
  try {
    root = JSON.parse(content)
  } catch (e) {
    return { success: false, error: `JSON parse error: ${e}` }
  }

  if (typeof root !== 'object' || root === null || !('hol' in root)) {
    return { success: false, error: 'Missing "hol" root key' }
  }

  const hol = (root as Record<string, unknown>).hol
  if (typeof hol !== 'object' || hol === null) {
    return { success: false, error: '"hol" is not an object' }
  }

  const entries = hol as Record<string, unknown>
  const ae = Array.isArray((root as Record<string, unknown>).ae)
    ? ((root as Record<string, unknown>).ae as unknown[])
    : []

  // ── Step 1: parse "ae" OSC string array ───────────────────────────────────
  const aeData = parseAeArray(ae)

  // ── Step 2: get track ID list ─────────────────────────────────────────────
  // Primary: /mixerSoundElementOrder — filter entries matching "trackN"
  const mixerOrder = entries['/mixerSoundElementOrder']
  const trackIds = new Set<number>()

  if (Array.isArray(mixerOrder)) {
    for (const item of mixerOrder as unknown[]) {
      const m = typeof item === 'string' ? item.match(/^track(\d+)$/) : null
      if (m) trackIds.add(parseInt(m[1], 10))
    }
  }

  // Also add any track IDs found in ae data
  for (const id of aeData.keys()) trackIds.add(id)

  // Also add any /track/N/ keys from hol (very old format without ae/mixerOrder)
  for (const key of Object.keys(entries)) {
    const m = key.match(/^\/track\/(\d+)\//)
    if (m) trackIds.add(parseInt(m[1], 10))
  }

  // ── Step 3: build track objects ───────────────────────────────────────────
  const tracks: HolTrack[] = []
  for (const id of trackIds) {
    const ae = aeData.get(id) ?? {}

    // Fallback to hol entries if ae has no data for this track
    const holName  = getHolStr(entries, `/track/${id}/name`)
    const holColor = getHolColor(entries, `/track/${id}/color`)
    const holVis   = getHolBool(entries, `/track/${id}/visible`)

    const name = ae.name ?? holName ?? `track${id}`
    const color: [number, number, number, number] = ae.color ?? holColor ?? [0.5, 0.5, 0.5, 1]
    const visible = ae.visible ?? holVis ?? true

    tracks.push({
      id,
      name,
      color,
      visible,
      azim: ae.azim,
      elev: ae.elev,
      dist: ae.dist,
    })
  }

  tracks.sort((a, b) => a.id - b.id)

  // ── Preset name + version ─────────────────────────────────────────────────
  const presetName = getHolStr(entries, '/preset/name') ?? 'Unknown'
  const version    = getHolStr(entries, '/station/version') ?? ''

  return {
    success: true,
    project: { presetName, version, tracks, rawEntries: entries },
  }
}

// ── Parse "ae" OSC string array ───────────────────────────────────────────────
// Each string: '/track/N/field arg1 arg2 ...'

interface AeTrack {
  name?: string
  color?: [number, number, number, number]
  visible?: boolean
  azim?: number
  elev?: number
  dist?: number
}

function parseAeArray(ae: unknown[]): Map<number, AeTrack> {
  const map = new Map<number, AeTrack>()

  for (const line of ae) {
    if (typeof line !== 'string') continue
    // Match: /track/N/field args...
    const m = line.match(/^\/track\/(\d+)\/(name|color|visible|azim|elev|dist)\s+(.+)$/)
    if (!m) continue
    const id    = parseInt(m[1], 10)
    const field = m[2]
    const args  = m[3].trim()

    if (!map.has(id)) map.set(id, {})
    const t = map.get(id)!

    switch (field) {
      case 'name': {
        // args may be: "My Name" or My Name (quoted or unquoted)
        t.name = args.replace(/^"|"$/g, '')
        break
      }
      case 'color': {
        const parts = args.split(/\s+/).map(Number)
        if (parts.length >= 3) {
          t.color = [parts[0], parts[1], parts[2], parts[3] ?? 1]
        }
        break
      }
      case 'visible':
        t.visible = args !== '0' && args !== 'false'
        break
      case 'azim':
        t.azim = parseFloat(args)
        break
      case 'elev':
        t.elev = parseFloat(args)
        break
      case 'dist':
        t.dist = parseFloat(args)
        break
    }
  }
  return map
}

// ── Helpers: extract from hol entries (array-wrapped values) ─────────────────

function getHolStr(entries: Record<string, unknown>, key: string): string | undefined {
  const v = entries[key]
  if (Array.isArray(v) && typeof v[0] === 'string') return v[0]
  return undefined
}

function getHolColor(
  entries: Record<string, unknown>,
  key: string,
): [number, number, number, number] | undefined {
  const v = entries[key]
  if (Array.isArray(v) && v.length >= 3 && typeof v[0] === 'number') {
    return [v[0], v[1] as number, v[2] as number, (v[3] as number | undefined) ?? 1]
  }
  return undefined
}

function getHolBool(entries: Record<string, unknown>, key: string): boolean | undefined {
  const v = entries[key]
  if (!Array.isArray(v)) return undefined
  const val = v[0]
  if (typeof val === 'boolean') return val
  if (val === 1 || val === 0) return val !== 0
  return undefined
}

// ── File reader helper (browser FileAPI) ─────────────────────────────────────

export function readHolFileFromInput(file: File): Promise<HolParseResult> {
  return new Promise((resolve) => {
    const reader = new FileReader()
    reader.onload = (e) => {
      const content = e.target?.result
      if (typeof content !== 'string') {
        resolve({ success: false, error: 'Could not read file' })
        return
      }
      resolve(parseHolFile(content))
    }
    reader.onerror = () => resolve({ success: false, error: 'FileReader error' })
    reader.readAsText(file)
  })
}
