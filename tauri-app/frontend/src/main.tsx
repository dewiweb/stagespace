import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

// DEV : ?score-demo — pré-remplit la surface score pour revue visuelle
// sans backend (dead-code éliminé en build prod).
if (import.meta.env.DEV && new URLSearchParams(location.search).has('score-demo')) {
  void import('./dev/scoreDemoSeed').then((m) => m.seedScoreDemo())
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
