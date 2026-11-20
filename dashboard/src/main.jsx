import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
// Fonts are bundled locally (no CDN) so the app works offline.
import './fonts.css'
import './index.css'
import App from './App.jsx'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
