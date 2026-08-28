import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './entry/App'
import { registerServiceWorker } from './entry/offline-shell/registerServiceWorker'
import './styles/fonts'
import './styles/app.css'

const root = document.getElementById('root')
if (!root) throw new Error('Research Garden could not find its mount point.')

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

// ADR 0072: after an initial load, the human interface keeps working offline.
registerServiceWorker()
