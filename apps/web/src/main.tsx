import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { RegistryProvider } from '@effect/atom-react'
import { App } from './App.tsx'
import './styles.css'
import { startTheme } from './theme/theme.ts'

startTheme()

if ('serviceWorker' in navigator) {
  addEventListener('load', () => void navigator.serviceWorker.register('/sw.js'))
}

createRoot(document.getElementById('root')!).render(<StrictMode><RegistryProvider><App /></RegistryProvider></StrictMode>)
