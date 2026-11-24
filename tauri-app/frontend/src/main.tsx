import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

// DEV : ?score-demo — pré-remplit la surface score pour revue visuelle
// sans backend (dead-code éliminé en build prod).
if (import.meta.env.DEV && new URLSearchParams(location.search).has('score-demo')) {
  void import('./dev/scoreDemoSeed').then((m) => m.seedScoreDemo())
}

// DEV : hooks e2e — expose les vraies instances des stores sur
// window.__live (voir src/dev/e2eHooks.ts). Dead-code éliminé en prod.
if (import.meta.env.DEV) {
  void import('./dev/e2eHooks').then((m) => m.installE2eHooks());
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
