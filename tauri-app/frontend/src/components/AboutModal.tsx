import React from 'react';
import { getVersion } from '@tauri-apps/api/app';
import { Modal } from './ui/Modal';

/// About — la convention desktop qui manquait (Help > About). Version
/// lue depuis tauri.conf.json via l'API Tauri (jamais hardcodée), avec
/// fallback offline si l'IPC n'est pas dispo (dev webview pure).
export const AboutModal: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const [version, setVersion] = React.useState<string>('…');
  React.useEffect(() => {
    getVersion()
      .then(setVersion)
      .catch(() => setVersion('dev'));
  }, []);

  return (
    <Modal title="About STAGESPACE" onClose={onClose} widthClass="max-w-sm">
      <div className="p-5 flex flex-col items-center text-center gap-3">
        <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center shadow-lg">
          <span className="text-white font-bold text-xl">S</span>
        </div>
        <div>
          <div className="text-white font-bold text-base tracking-tight">STAGESPACE</div>
          <div className="text-gray-400 text-xs italic">Play the space</div>
        </div>
        <div className="text-gray-500 font-mono text-xs">v{version}</div>
        <p className="text-gray-400 text-xs leading-relaxed">
          Real-time spatial trajectory engine for OSC-controlled audio
          sources — deterministic node graphs, cue conduite, live busking.
        </p>
        <div className="text-gray-600 text-[10px]">
          Rust engines · Tauri · React — MIT
        </div>
      </div>
    </Modal>
  );
};

export default AboutModal;
