import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { MantineProvider } from '@mantine/core'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import '@mantine/core/styles.css'
import 'notyf/notyf.min.css'
import './index.css'
import App from './App'
import { installNotificationBridge } from './components/ui/UiNotify'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: 1,
    },
  },
})

function installWailsRuntimeConsoleFilter() {
  if (typeof window === 'undefined') return

  const originalConsoleError = console.error.bind(console)

  console.error = (...args: unknown[]) => {
    const message = args
      .map((arg) => {
        if (typeof arg === 'string') return arg
        if (arg instanceof Error) return arg.message
        try {
          return JSON.stringify(arg)
        } catch {
          return String(arg)
        }
      })
      .join(' ')

    if (message.includes('/wails/runtime') && message.includes('422')) {
      return
    }

    originalConsoleError(...args)
  }
}

document.documentElement.classList.add('dark')
installNotificationBridge()
installWailsRuntimeConsoleFilter()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <MantineProvider
        defaultColorScheme="dark"
        theme={{
          fontFamily: 'Space Grotesk, system-ui, sans-serif',
          fontFamilyMonospace: 'Space Grotesk, ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
          headings: { fontFamily: 'Space Grotesk, system-ui, sans-serif' },
        }}
      >
        <App />
      </MantineProvider>
    </QueryClientProvider>
  </StrictMode>,
)