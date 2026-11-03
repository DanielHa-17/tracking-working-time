import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import type { View } from '../../shared/types'
import { Dashboard } from './pages/Dashboard'
import { History } from './pages/History'
import { SettingsPage } from './pages/Settings'
import './styles.css'

const view = (window.location.hash.replace('#', '') || 'dashboard') as View
document.documentElement.dataset.view = view
document.title = view === 'settings' ? 'Settings' : view === 'history' ? 'History' : 'Tracking Working Time'

const pages: Record<View, () => React.JSX.Element | null> = { dashboard: Dashboard, settings: SettingsPage, history: History }
const Page = pages[view] ?? Dashboard

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Page />
  </StrictMode>
)
