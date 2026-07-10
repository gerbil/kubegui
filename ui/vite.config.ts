import react from '@vitejs/plugin-react'
import path from 'path'
import { defineConfig, type Plugin } from 'vite'

/**
 * Forwards browser console.error / unhandledrejection back to the Vite
 * terminal so you can see runtime errors in the IDE's built-in console.
 */
function browserErrorForwarder(): Plugin {
  const CHANNEL = 'browser-error-forwarder'
  return {
    name: CHANNEL,
    // Inject a tiny script into the HTML entry point
    transformIndexHtml() {
      return [
        {
          tag: 'script',
          attrs: { type: 'module' },
          children: `
(function () {
  if (typeof __vite_plugin_react_preamble_installed__ === 'undefined' &&
      typeof import.meta.hot === 'undefined') return;
  const send = (level, args) => {
    try {
      import.meta.hot && import.meta.hot.send('${CHANNEL}:log', {
        level,
        msg: args.map(a => {
          try { return a instanceof Error ? a.stack || a.message : typeof a === 'object' ? JSON.stringify(a, null, 2) : String(a) }
          catch { return String(a) }
        }).join(' '),
      });
    } catch {}
  };
  const _error = console.error.bind(console);
  console.error = (...a) => { _error(...a); send('error', a); };
  const _warn = console.warn.bind(console);
  console.warn  = (...a) => { _warn(...a);  send('warn',  a); };
  window.addEventListener('error', e => {
    send('error', [e.error || e.message]);
  });
  window.addEventListener('unhandledrejection', e => {
    send('error', [e.reason]);
  });
})();
`,
          injectTo: 'head-prepend',
        },
      ]
    },
    // Receive messages from the browser and print to terminal
    configureServer(server: import('vite').ViteDevServer) {
      server.hot.on(`${CHANNEL}:log`, (data: { level: string; msg: string }, client: import('vite').HotChannelClient) => {
        const prefix = data.level === 'error' ? '\x1b[31m[browser error]\x1b[0m'
          : '\x1b[33m[browser warn]\x1b[0m'
         
        console.log(`${prefix} ${data.msg}`)
        void client // suppress unused warning
      })
    },
  }
}

export default defineConfig({
  plugins: [react(), browserErrorForwarder()],
  resolve: { alias: { '@': path.resolve(__dirname, './src') } },
  server: {
    port: Number(process.env.WAILS_VITE_PORT) || 9245,
    strictPort: true,
  },
})