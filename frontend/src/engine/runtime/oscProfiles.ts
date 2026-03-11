import type { OSCProfile } from './types'

export const PROFILES: Record<string, OSCProfile> = {
  holophonix: {
    name: 'Holophonix',
    // Holophonix accepts both bundled /xyz and individual axes
    xyzAddress: (id) => `/track/${id}/xyz`,
    aedAddress: (id) => `/track/${id}/aed`,
    xyzMessages: (id, x, y, z) => [{ address: `/track/${id}/xyz`, args: [x, y, z] }],
    aedMessages: (id, a, e, d) => [{ address: `/track/${id}/aed`, args: [a, e, d] }],
  },

  holophonix_split: {
    name: 'Holophonix (axes séparés)',
    // Some Holophonix firmware versions require separate messages per axis
    xyzAddress: (id) => `/track/${id}/x`,
    aedAddress: (id) => `/track/${id}/azim`,
    xyzMessages: (id, x, y, z) => [
      { address: `/track/${id}/x`, args: [x] },
      { address: `/track/${id}/y`, args: [y] },
      { address: `/track/${id}/z`, args: [z] },
    ],
    aedMessages: (id, a, e, d) => [
      { address: `/track/${id}/azim`, args: [a] },
      { address: `/track/${id}/elev`, args: [e] },
      { address: `/track/${id}/dist`, args: [d] },
    ],
  },

  spat: {
    name: 'SPAT Revolution',
    xyzAddress: (id) => `/spat/source/${id}/xyz`,
    aedAddress: (id) => `/spat/source/${id}/aed`,
    xyzMessages: (id, x, y, z) => [{ address: `/spat/source/${id}/xyz`, args: [x, y, z] }],
    aedMessages: (id, a, e, d) => [{ address: `/spat/source/${id}/aed`, args: [a, e, d] }],
  },

  iem: {
    name: 'IEM MultiEncoder',
    // IEM expects separate messages per axis (0-indexed source id)
    xyzAddress: (id) => `/MultiEncoder/source${id - 1}/x`,
    aedAddress: (id) => `/MultiEncoder/source${id - 1}/azimuth`,
    xyzMessages: (id, x, y, z) => {
      const i = id - 1  // IEM is 0-indexed
      return [
        { address: `/MultiEncoder/source${i}/x`, args: [x] },
        { address: `/MultiEncoder/source${i}/y`, args: [y] },
        { address: `/MultiEncoder/source${i}/z`, args: [z] },
      ]
    },
    aedMessages: (id, a, e, d) => {
      const i = id - 1
      return [
        { address: `/MultiEncoder/source${i}/azimuth`,   args: [a] },
        { address: `/MultiEncoder/source${i}/elevation`, args: [e] },
        { address: `/MultiEncoder/source${i}/distance`,  args: [d] },
      ]
    },
  },

  generic: {
    name: 'Generic OSC',
    xyzAddress: (id) => `/source/${id}/xyz`,
    aedAddress: (id) => `/source/${id}/aed`,
    xyzMessages: (id, x, y, z) => [{ address: `/source/${id}/xyz`, args: [x, y, z] }],
    aedMessages: (id, a, e, d) => [{ address: `/source/${id}/aed`, args: [a, e, d] }],
  },
}

export function getProfile(name: string): OSCProfile {
  return PROFILES[name] ?? PROFILES.holophonix
}
