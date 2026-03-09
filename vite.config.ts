import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'path'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    watch: {
      // Ignore the server token cache so Vite doesn't reload when it's written during auto-login
      ignored: ['**/server/upstox_token.json', '**/server/nubra_device.json'],
    },
    proxy: {
      '/instruments-gz': {
        target: 'http://localhost:3001',
        changeOrigin: false,
      },
      '/api/public-candles': {
        target: 'http://localhost:3001',
        changeOrigin: false,
      },
      '/api/nubra-send-otp': {
        target: 'http://localhost:3001',
        changeOrigin: false,
      },
      '/api/nubra-setup-totp': {
        target: 'http://localhost:3001',
        changeOrigin: false,
      },
      '/api/nubra-login': {
        target: 'http://localhost:3001',
        changeOrigin: false,
      },
      '/api/nubra-timeseries': {
        target: 'http://localhost:3001',
        changeOrigin: false,
      },
      '/api/nubra-multistrike': {
        target: 'http://localhost:3001',
        changeOrigin: false,
      },
      '/api/market-quote': {
        target: 'http://localhost:3001',
        changeOrigin: false,
      },
      '/api/nubra-instruments': {
        target: 'http://localhost:3001',
        changeOrigin: false,
      },
      '/api/nubra-historical': {
        target: 'http://localhost:3001',
        changeOrigin: false,
      },
      '/api/nubra-optionchain': {
        target: 'http://localhost:3001',
        changeOrigin: false,
      },
      '/nubra-optionchains': {
        target: 'https://api.nubra.io',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/nubra-optionchains/, '/optionchains'),
      },
      '/api/dhan-instruments': {
        target: 'http://localhost:3001',
        changeOrigin: false,
      },
      '/api/dhan-opt-chart': {
        target: 'http://localhost:3001',
        changeOrigin: false,
      },
      '/api/upstox-login': {
        target: 'http://localhost:3001',
        changeOrigin: false,
        proxyTimeout: 120_000,
        timeout: 120_000,
      },
      '/api/upstox-login-stream': {
        target: 'http://localhost:3001',
        changeOrigin: false,
        proxyTimeout: 120_000,
        timeout: 120_000,
        // SSE — disable buffering so events stream through immediately
        configure: (proxy) => {
          proxy.on('proxyRes', (proxyRes) => {
            proxyRes.headers['x-accel-buffering'] = 'no';
          });
        },
      },
      '/api/upstox-token': {
        target: 'http://localhost:3001',
        changeOrigin: false,
      },
    },
  },
})
