import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    // Оболочка приложения кешируется, чтобы ТСД открывал SkladNO без связи; API в кеш не попадает.
    VitePWA({
      registerType: 'autoUpdate',
      workbox: {
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/api\//],
        globPatterns: ['**/*.{js,css,html,svg}'],
      },
      manifest: {
        name: 'SkladNO',
        short_name: 'SkladNO',
        description: 'Учёт и размещение оборудования майнинг-фермы',
        lang: 'ru',
        display: 'standalone',
        start_url: '/',
        theme_color: '#12140f',
        background_color: '#efeee8',
        icons: [{ src: '/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' }],
      },
    }),
  ],
  server: {
    port: 5174,
    proxy: { '/api': 'http://127.0.0.1:8090' },
  },
});
