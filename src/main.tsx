import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import LiveScoreboard from './live/LiveScoreboard'
import './styles.css'

const isScoreboardRoute = window.location.pathname.startsWith('/scoreboard/')

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {isScoreboardRoute ? <LiveScoreboard /> : <App />}
  </StrictMode>,
)
