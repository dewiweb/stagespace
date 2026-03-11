import type { OSCProfile } from './types'

export const PROFILES: Record<string, OSCProfile> = {
  holophonix: {
    name: 'Holophonix',
    xyzAddress: (id) => `/track/${id}/xyz`,
    aedAddress: (id) => `/track/${id}/aed`,
  },
  spat: {
    name: 'SPAT Revolution',
    xyzAddress: (id) => `/spat/source/${id}/xyz`,
    aedAddress: (id) => `/spat/source/${id}/aed`,
  },
  iem: {
    name: 'IEM MultiEncoder',
    xyzAddress: (id) => `/MultiEncoder/source${id}/x`,
    aedAddress: (id) => `/MultiEncoder/source${id}/azimuth`,
  },
  generic: {
    name: 'Generic OSC',
    xyzAddress: (id) => `/source/${id}/xyz`,
    aedAddress: (id) => `/source/${id}/aed`,
  },
}

export function getProfile(name: string): OSCProfile {
  return PROFILES[name] ?? PROFILES.holophonix
}
