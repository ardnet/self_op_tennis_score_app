import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import LiveScoreboard from './live/LiveScoreboard'
import './styles.css'
import { initAnalytics } from './analytics'

const isScoreboardRoute = window.location.pathname.startsWith('/scoreboard/')

initAnalytics()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {isScoreboardRoute ? <LiveScoreboard /> : <App />}
  </StrictMode>,
)
