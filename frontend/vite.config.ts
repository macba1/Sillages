import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // Vite refuses requests whose Host header it does not recognise. The
    // Shopify CLI serves the admin through an ephemeral tunnel, so every
    // request arriving that way was answered with 403 "This host is not
    // allowed" — which is what a merchant would have seen instead of the app.
    // A leading dot matches any subdomain, so a new tunnel name needs no change.
    allowedHosts: [
      '.trycloudflare.com',
      '.ngrok.io',
      '.ngrok-free.app',
      '.ngrok.app',
      '.shopifypreview.com',
      'localhost',
      '127.0.0.1',
    ],
    proxy: {
      // The backend port is fixed at 3001 for a plain `npm run dev`, but the
      // Shopify CLI assigns a random one and passes it as BACKEND_PORT. Hard
      // coding it meant every API call through the CLI's tunnel died.
      '/api': {
        target: `http://localhost:${process.env.BACKEND_PORT ?? 3001}`,
        changeOrigin: true,
      },
    },
  },
});
