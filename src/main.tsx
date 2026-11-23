import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './styles/global.css'
import './styles/dashboard.css'
import './styles/mobile-modal-sheet.css'
import App from './App.tsx'
import { AppProviders } from './providers/AppProvider.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AppProviders>
      <App />
    </AppProviders>
  </StrictMode>,
)
