import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './entry/App'
import './styles/fonts'
import './styles/app.css'

const root = document.getElementById('root')
if (!root) throw new Error('Research Garden could not find its mount point.')

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
