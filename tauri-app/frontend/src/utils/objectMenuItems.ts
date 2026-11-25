/// Items du menu contextuel objet (radar 2D + scène 3D) — les mêmes ops
/// que le clic-droit historique (release), Ctrl+C/V position et l'inspect
/// bar (park). Un seul endroit : les deux surfaces restent synchrones.
import type { ContextMenuItem } from '../components/ui/ContextMenu';
import { doClearPosition, doSetPosition, doPark, doUnpark, doAttention } from './liveActionsSpatial';
import {
  writePositionClipboard, readPositionClipboard,
  serializePositionClipboard, parsePositionClipboard,
} from './graphClipboard';
import { SOURCE_LABEL } from './sourceColors';

/// Release applicable selon la source de contrôle (miroir d'OVERRIDE_RELEASE
/// dans ObjectInspectBar — même table, même ordre d'idée).
const RELEASE_BY_SOURCE: Partial<Record<string, (obj: number) => void>> = {
  manual: doClearPosition,
  hold: doClearPosition,
  park: doUnpark,
  freeze: () => doAttention(null),
};

export function buildObjectMenuItems(
  obj: number,
  src: string,
  pos: [number, number, number] | undefined,
): ContextMenuItem[] {
  const release = RELEASE_BY_SOURCE[src];
  return [
    {
      label: `Release — obj ${obj + 1} (${SOURCE_LABEL[src] ?? src})`,
      disabled: !release,
      title: release ? undefined : 'Nothing to release — object is not overridden',
      onClick: () => release?.(obj),
    },
    {
      label: src === 'park' ? `Unpark — obj ${obj + 1}` : `Park — obj ${obj + 1}`,
      onClick: () => (src === 'park' ? doUnpark(obj) : doPark(obj)),
    },
    {
      // Attention = geste OBJET : fige tous les autres (change blindness),
      // celui-ci continue à bouger. Choisi en pointant l'objet (radar, 3D,
      // cellule track) — pas via un pad : les couvertures se recoupent.
      // Sur un objet parké, le park l'emporte → TOUT gelerait : refusé.
      label: `◎ Attention — only obj ${obj + 1} moves`,
      disabled: src === 'park',
      title:
        src === 'park'
          ? 'Park wins over attention — unpark first (parking this object would freeze it too)'
          : 'Freeze every other object (change blindness) — release via ATTN ✕ or /stagespace/attention/clear',
      onClick: () => doAttention(obj),
    },
    { separator: true },
    {
      label: `Copy position — obj ${obj + 1}`,
      disabled: !pos,
      title: pos ? undefined : 'No emitted position yet',
      onClick: () => {
        if (!pos) return;
        writePositionClipboard(pos);
        navigator.clipboard?.writeText(serializePositionClipboard(pos)).catch(() => {});
      },
    },
    {
      label: `Paste position — obj ${obj + 1}`,
      disabled: !readPositionClipboard(),
      title: 'Copy a position first (Ctrl+C or this menu)',
      onClick: () => {
        const apply = (p: [number, number, number]) => doSetPosition(obj, p[0], p[1], p[2]);
        const mem = readPositionClipboard();
        if (mem) { apply(mem); return; }
        navigator.clipboard?.readText().then((t) => {
          const parsed = parsePositionClipboard(t);
          if (parsed) apply(parsed);
        }).catch(() => {});
      },
    },
  ];
}
