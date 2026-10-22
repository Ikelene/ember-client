import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './styles.css'
import Chat from './pages/Chat.jsx'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <Chat />
  </StrictMode>,
)
