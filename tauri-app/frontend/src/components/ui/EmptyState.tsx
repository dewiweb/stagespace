import React from 'react';

/// EmptyState partagé — remplace les ~8 implémentations locales
/// ("No zones", "No cue", "Empty graph", "No saved graph"…).
///
/// Un bon empty state fait 3 choses :
///  1. nomme ce qui manque (title)
///  2. dit comment le créer (hint)
///  3. propose l'action directement (actionLabel + onAction)
interface EmptyStateProps {
  /// Ce qui manque — ex: "No zones", "No move configured"
  title: string;
  /// Comment s'en sortir — une ligne max, ex: "add one above to shape
  /// spatial channels inside a region"
  hint?: string;
  /// Label du bouton d'action directe — ex: "+ Create the first move"
  actionLabel?: string;
  onAction?: () => void;
  /// Icône optionnelle au-dessus du titre (lucide ReactNode)
  icon?: React.ReactNode;
  /// Compacité — 'sm' pour les listes imbriquées dans des panels
  size?: 'sm' | 'md';
}

export default function EmptyState({
  title,
  hint,
  actionLabel,
  onAction,
  icon,
  size = 'md',
}: EmptyStateProps) {
  return (
    <div
      className={`text-center bg-gray-800/30 rounded border border-gray-700/30 ${
        size === 'sm' ? 'px-3 py-3' : 'px-4 py-8'
      }`}
    >
      {icon && <div className="flex justify-center mb-2 text-gray-500">{icon}</div>}
      <div className="text-gray-400 text-sm">{title}</div>
      {hint && <div className="text-gray-500 text-xs mt-1">{hint}</div>}
      {actionLabel && onAction && (
        <button
          onClick={onAction}
          className="mt-3 px-3 py-1.5 bg-indigo-900/50 hover:bg-indigo-800/60 text-indigo-300 text-xs rounded font-medium transition-colors border border-indigo-800/40"
        >
          {actionLabel}
        </button>
      )}
    </div>
  );
}
