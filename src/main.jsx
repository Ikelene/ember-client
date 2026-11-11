import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './styles.css'
import Chat from './pages/Chat.jsx'
import { shortLinkHash } from './chat/shortLinks.js'
import { onEmberHost } from './chat/hosts.js'

// a short share link (ember.nookara.cc/invite/..., /server/...): becomes Ember's own #/ route before anything reads the address
if (onEmberHost()) { const h = shortLinkHash(location.pathname); if (h) history.replaceState(null, '', '/' + h) }

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <Chat />
  </StrictMode>,
)

