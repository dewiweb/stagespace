import React from 'react';

interface Tab {
  id: string;
  label: string;
  content: React.ReactNode;
}

interface TabPanelProps {
  tabs: Tab[];
  defaultTab?: string;
  /// Notifie le parent du tab actif — permet de conditionner du contenu
  /// externe (ex: Templates visible seulement sur le tab Moves).
  onTabChange?: (id: string) => void;
}

/// Conteneur d'onglets — tous les contenus restent montés (hidden quand
/// inactif) : l'état local des panels (armedCueId, timers, scroll) survit
/// au switch, et rien ne se re-synchronise à chaque changement d'onglet.
export default function TabPanel({ tabs, defaultTab, onTabChange }: TabPanelProps) {
  const [activeTab, setActiveTabState] = React.useState(defaultTab || tabs[0]?.id || '');
  const setActiveTab = (id: string) => { setActiveTabState(id); onTabChange?.(id); };

  const move = (dir: number) => {
    const idx = tabs.findIndex((t) => t.id === activeTab);
    const next = tabs[(idx + dir + tabs.length) % tabs.length];
    if (next) setActiveTab(next.id);
  };

  return (
    <div className="flex flex-col h-full">
      <div
        role="tablist"
        aria-label="Sections"
        className="flex border-b border-stagespace-border bg-stagespace-panel flex-shrink-0"
        onKeyDown={(e) => {
          if (e.key === 'ArrowRight') move(1);
          else if (e.key === 'ArrowLeft') move(-1);
        }}
      >
        {tabs.map((tab) => (
          <button
            key={tab.id}
            role="tab"
            aria-selected={activeTab === tab.id}
            tabIndex={activeTab === tab.id ? 0 : -1}
            onClick={() => setActiveTab(tab.id)}
            className={`flex-1 px-3 py-2.5 text-xs font-medium transition-all relative ${
              activeTab === tab.id
                ? 'text-white'
                : 'text-gray-500 hover:text-gray-300'
            }`}
          >
            {tab.label}
            {activeTab === tab.id && (
              <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-stagespace-accent" />
            )}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto">
        {tabs.map((tab) => (
          <div
            key={tab.id}
            role="tabpanel"
            hidden={tab.id !== activeTab}
            className={tab.id === activeTab ? 'animate-fade-in h-full' : 'h-full'}
          >
            {tab.content}
          </div>
        ))}
      </div>
    </div>
  );
}
