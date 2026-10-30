import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './styles.css'
import Chat from './pages/Chat.jsx'
import { loadOfficialClients } from './chat/officialClients.js'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <Chat />
  </StrictMode>,
)

// Velora's official clients list (names + verified badges on a message's "sent from" chip): once at startup, cached
setTimeout(() => { loadOfficialClients().catch(() => {}) }, 1500)
