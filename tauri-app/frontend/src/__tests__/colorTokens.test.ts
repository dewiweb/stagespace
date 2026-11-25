import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

/**
 * Garde chantier harmonisation couleur (docs/color-harmonization.md).
 *
 * Doctrine : la couleur code la FONCTION via les tokens
 * `stagespace-*` (live/conduite/osc/warning/danger/tracking/dim/
 * info/target/derived/modulation/accent). Les classes palette
 * chromatiques brutes (bg-red-500, text-amber-300…) sont bannies
 * hors des modules qui DÉFINISSENT les systèmes de couleur.
 *
 * Allowlist = fichiers sources des systèmes catégoriels assumés :
 *  - uiColors.ts        : UI_HEX/VIZ/CLIP_FAMILY_HEX/CHIP_SOLID
 *  - sourceColors.ts    : SOURCE_* (park/hold/freeze = stase pink,
 *                         hold cyan — identités source-de-contrôle)
 *  - connectionRules.ts : PORT_COLORS (types de ports graphe)
 *  - scoreUtils.ts      : CLIP_COLORS + CLIP_HOVER (familles de clips)
 *
 * Exempts : tests (peuvent asserter des classes), fichiers .d.ts.
 * Ne PAS ajouter de fichier à l'allowlist sans justification
 * doctrinale — la règle est un ratchet : la dette ne fait que
 * diminuer.
 */

const SRC = join(__dirname, '..');

const ALLOWLIST = new Set([
  'utils/uiColors.ts',
  'utils/sourceColors.ts',
  'utils/connectionRules.ts',
  'components/score/scoreUtils.ts',
]);

/// Classes palette chromatiques Tailwind — tout utilitaire de couleur
/// (y compris variantes hover:/focus:… et modifieur !) suivi d'une
/// nuance numérique. Les neutres (gray/slate/zinc/neutral/stone)
/// sont la rampe UI légitime, hors scope.
const CHROMATIC =
  '(?:red|amber|yellow|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose|orange|lime)';
const CLASS_RE = new RegExp(
  `(?:^|[\\s'"\`{])(?:[a-zA-Z-]+:)*!?(?:text|bg|border(?:-[tblrxy])?|ring(?:-[a-z]+)?|from|to|via|fill|stroke|outline|divide(?:-[xy])?|placeholder(?:-[a-z]+)?|caret(?:-[a-z]+)?|accent(?:-[a-z]+)?|shadow(?:-[a-z]+)?|decoration(?:-[a-z]+)?)-${CHROMATIC}-\\d{2,3}\\b`,
);

function* walk(dir: string): Generator<string> {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) {
      if (e === 'node_modules' || e.startsWith('.')) continue;
      yield* walk(p);
    } else if (/\.(ts|tsx)$/.test(e) && !e.endsWith('.d.ts')) {
      yield p;
    }
  }
}

describe('color tokens — aucune classe palette chromatique hors modules', () => {
  it('src/ ne contient pas de classes chromatiques brutes hors allowlist', () => {
    const violations: string[] = [];
    for (const file of walk(SRC)) {
      const rel = relative(SRC, file).split('\\').join('/');
      if (ALLOWLIST.has(rel)) continue;
      if (rel.includes('__tests__') || rel.endsWith('.test.ts') || rel.endsWith('.test.tsx')) continue;
      const lines = readFileSync(file, 'utf8').split('\n');
      lines.forEach((line, i) => {
        // Les lignes de commentaire ne comptent pas.
        const code = line.replace(/\/\/.*$/, '');
        if (CLASS_RE.test(code)) {
          violations.push(`${rel}:${i + 1}  ${line.trim().slice(0, 110)}`);
        }
      });
    }
    expect(
      violations,
      `Classes palette chromatiques hors tokens — migrer vers stagespace-* ` +
        `ou sourcer depuis uiColors/sourceColors/connectionRules/scoreUtils :\n` +
        violations.join('\n'),
    ).toEqual([]);
  });
});
