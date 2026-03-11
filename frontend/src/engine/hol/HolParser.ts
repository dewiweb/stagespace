// ── .hol file parser ─────────────────────────────────────────────────────────
// A .hol file is a JSON file with a single "hol" key.
// The value is an object where:
//   - string keys are OSC paths → values are arrays (the OSC arguments)
//   - there may also be a top-level array of OSC command strings
//
// We extract:
//   - track list  (from /layer/sources/ids)
//   - per-track metadata (name, color, initial xyz/aed if present)
//   - project preset name

export interface HolTrack {
  id: number         // numeric index extracted from "trackN"
  name: string
  color: [number, number, number, number]  // RGBA 0-1
  visible: boolean
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

  // ── Track IDs ──────────────────────────────────────────────────────────────
  // /layer/sources/ids → ["track1", "track2", ...]
  const sourceIds = entries['/layer/sources/ids']
  const trackNames: string[] = Array.isArray(sourceIds)
    ? (sourceIds as unknown[]).filter((v): v is string => typeof v === 'string')
    : []

  // Also collect tracks from other layers
  const allTrackNames = new Set<string>(trackNames)
  for (const [key, val] of Object.entries(entries)) {
    if (key.startsWith('/layer/') && key.endsWith('/ids') && Array.isArray(val)) {
      for (const id of val as unknown[]) {
        if (typeof id === 'string' && id.startsWith('track')) allTrackNames.add(id)
      }
    }
  }

  // ── Per-track metadata ─────────────────────────────────────────────────────
  // Keys: /track/N/name, /track/N/color, /track/N/visible
  const tracks: HolTrack[] = []
  for (const trackName of allTrackNames) {
    const num = extractTrackNumber(trackName)
    if (num === null) continue

    const nameVal  = entries[`/track/${num}/name`]
    const colorVal = entries[`/track/${num}/color`]
    const visVal   = entries[`/track/${num}/visible`]

    const name = Array.isArray(nameVal) && typeof nameVal[0] === 'string'
      ? nameVal[0]
      : trackName

    const color: [number, number, number, number] = [0.5, 0.5, 0.5, 1]
    if (Array.isArray(colorVal) && colorVal.length >= 3) {
      color[0] = typeof colorVal[0] === 'number' ? colorVal[0] : 0.5
      color[1] = typeof colorVal[1] === 'number' ? colorVal[1] : 0.5
      color[2] = typeof colorVal[2] === 'number' ? colorVal[2] : 0.5
      color[3] = typeof colorVal[3] === 'number' ? colorVal[3] : 1
    }

    const visible = Array.isArray(visVal) ? visVal[0] !== 0 && visVal[0] !== false : true

    tracks.push({ id: num, name, color, visible })
  }

  // Sort by track id
  tracks.sort((a, b) => a.id - b.id)

  // ── Preset name ───────────────────────────────────────────────────────────
  const presetArr = entries['/preset/name']
  const presetName = Array.isArray(presetArr) && typeof presetArr[0] === 'string'
    ? presetArr[0]
    : 'Unknown'

  const versionArr = entries['/station/version']
  const version = Array.isArray(versionArr) && typeof versionArr[0] === 'string'
    ? versionArr[0]
    : ''

  return {
    success: true,
    project: {
      presetName,
      version,
      tracks,
      rawEntries: entries,
    },
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function extractTrackNumber(name: string): number | null {
  const m = name.match(/^track(\d+)$/)
  if (!m) return null
  return parseInt(m[1], 10)
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
