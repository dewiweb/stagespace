/// Log opérationnel — qui a GO quand, quel NACK, quelle commande OSC.
/// Toutes les entrées (le slice en garde 50), scrollables. Partagé par
/// l'atelier (tab Log) — la conduite a sa propre vue du même showLog.
import React from 'react';
import { useGraphStore } from '../store/useGraphStore';
import EmptyState from './ui/EmptyState';

export const ShowLogPanel: React.FC = () => {
  const showLog = useGraphStore((s) => s.showLog);

  return (
    <div className="flex flex-col h-full">
      <div className="px-3 py-2 border-b border-stagespace-border flex items-center gap-2">
        <span className="text-gray-300 text-xs font-semibold">Log</span>
        <span className="text-gray-500 text-xs">{showLog.length}</span>
      </div>
      <div className="flex-1 overflow-y-auto px-3 py-1.5 font-mono">
        {showLog.length === 0 ? (
          <EmptyState size="sm" title="No events yet" hint="GO, recalls, NACKs and show-control commands land here." />
        ) : (
          showLog.slice().reverse().map((l, i) => (
            <div key={l.ts + '-' + i} className="text-[10px] text-gray-500 truncate leading-4">
              {new Date(l.ts).toLocaleTimeString('fr-FR', { hour12: false })} · {l.label}
            </div>
          ))
        )}
      </div>
    </div>
  );
};

export default ShowLogPanel;
