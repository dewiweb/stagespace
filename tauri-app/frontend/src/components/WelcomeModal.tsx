import React from 'react';
import Modal from './ui/Modal';
import { useGraphStore } from '../store/useGraphStore';
import { toast } from '../utils/toast-helpers';
import { safeGetItem, safeSetItem } from '../utils/safeStorage';
// Bundled at build time — the example show lives at the repo root and is
// also exercised by utils/__tests__/exampleShow.test.ts.
import rawExampleShow from '../../../../examples/full-feature-show.hfg?raw';

const WELCOMED_KEY = 'stagespace-welcomed';

/// First run = flag absent. The modal offers the bundled example show
/// (slots + cues + OSC config) over starting from the default Circle graph.
export function shouldShowWelcome(): boolean {
  return safeGetItem(WELCOMED_KEY) === null;
}

function markWelcomed(): void {
  safeSetItem(WELCOMED_KEY, '1');
}

export const WelcomeModal: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const loadShowEnvelope = useGraphStore((s) => s.loadShowEnvelope);

  const close = () => {
    markWelcomed();
    onClose();
  };

  const loadExample = async () => {
    try {
      await loadShowEnvelope(JSON.parse(rawExampleShow));
      toast.success('Example show loaded — press ▶ on a move to hear it');
    } catch (e) {
      console.error('Example show failed to apply:', e);
      toast.error(`Example show failed to load: ${e}`);
    }
    close();
  };

  return (
    <Modal title="Welcome to STAGESPACE" onClose={close} closeOnOverlay={false}>
      <div className="px-5 py-4 space-y-4">
        <p className="text-gray-300 text-xs leading-relaxed">
          The nodal generative trajectory engine for live spatial audio.
          Build trajectory graphs, launch moves on OSC tracks, perform cues.
        </p>
        {/* Mental model — the app pipeline, never explained elsewhere */}
        <div className="rounded bg-gray-800/50 border border-gray-700/50 px-3 py-2.5 space-y-1.5">
          <div className="text-gray-400 text-xs font-semibold uppercase tracking-wider">How it works</div>
          {[
            ['Template', 'a trajectory shape (Circle, Spiral, Physics…)'],
            ['Move', 'a template + assigned tracks + params'],
            ['Setlist', 'your ordered moves — GO advances through them'],
            ['Cue', 'a snapshot you recall live (Shift+Enter)'],
          ].map(([term, def]) => (
            <div key={term} className="flex gap-2 text-xs leading-snug">
              <span className="text-cyan-400 font-mono w-14 flex-shrink-0">{term}</span>
              <span className="text-gray-400">{def}</span>
            </div>
          ))}
        </div>
        <div className="flex gap-2">
          <button
            onClick={loadExample}
            className="flex-1 px-3 py-2 rounded bg-blue-700 hover:bg-blue-600 text-white text-xs font-semibold transition-colors"
          >
            Load the example show
          </button>
          <button
            onClick={close}
            className="flex-1 px-3 py-2 rounded bg-gray-800 hover:bg-gray-700 text-gray-300 text-xs font-medium transition-colors border border-gray-700"
          >
            Start empty
          </button>
        </div>
        <p className="text-gray-400 text-xs">
          Press <kbd className="px-1 rounded bg-gray-800 border border-gray-700 font-mono">?</kbd> anytime for
          keyboard shortcuts · set your OSC destination in the toolbar.
        </p>
      </div>
    </Modal>
  );
};

export default WelcomeModal;
