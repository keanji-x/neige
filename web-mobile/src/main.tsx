import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { ToastProvider } from '@neige/shared'
import { Theme } from '@radix-ui/themes'
import '@radix-ui/themes/styles.css'
import './api'
import './index.css'
import App from './App.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Theme appearance="dark" accentColor="green" grayColor="slate" radius="medium" scaling="100%">
      <ToastProvider>
        <App />
      </ToastProvider>
    </Theme>
  </StrictMode>,
)
