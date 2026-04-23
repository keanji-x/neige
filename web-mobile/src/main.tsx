import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { ToastProvider } from '@neige/shared'
import { Theme } from '@radix-ui/themes'
import '@radix-ui/themes/styles.css'
import './api'
import './index.css'
import App from './App.tsx'

// `<Theme>` renders a wrapping `<div class="radix-themes dark">` with
// `height: auto` by default. Our App.tsx uses `height: 100%` which needs a
// fixed-height parent to resolve — so we have to force the Theme div to
// fill #root (which is 100% of body) or the whole mobile layout collapses
// to content height and the viewport goes black below it.
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Theme
      appearance="dark"
      accentColor="green"
      grayColor="slate"
      radius="medium"
      scaling="100%"
      style={{ height: '100%' }}
    >
      <ToastProvider>
        <App />
      </ToastProvider>
    </Theme>
  </StrictMode>,
)
