import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { componentTagger } from "lovable-tagger";
import { VitePWA } from "vite-plugin-pwa";
import { visualizer } from "rollup-plugin-visualizer";

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  server: {
    host: "0.0.0.0",
    port: 9100,
    hmr: {
      overlay: false,
    },
  },
  plugins: [
    react(),
    mode === "development" && componentTagger(),
    VitePWA({
      // Hito 4.2.5 — Cambiamos a 'prompt' para que el usuario decida cuando
      // refrescar tras una nueva version (mejor UX que un reload silencioso
      // que tira la sesion en mitad de un envio).
      registerType: "prompt",
      injectRegister: "auto",
      manifest: {
        name: "City2Cruise - Shop&Drop Port Hub",
        short_name: "City2Cruise",
        description: "Plataforma de logistica de ultima milla para cruceristas",
        start_url: "/",
        display: "standalone",
        background_color: "#ffffff",
        theme_color: "#0EA5E9",
        icons: [
          { src: "/favicon.ico", sizes: "64x64", type: "image/x-icon" },
        ],
      },
      workbox: {
        importScripts: ['/sw-push.js'],
        cleanupOutdatedCaches: true,
        clientsClaim: true,
        skipWaiting: false,
        navigationPreload: true,
        runtimeCaching: [
          // 1. API REST → NetworkFirst con timeout (offline fallback al cache)
          {
            urlPattern: ({ url, request }) =>
              request.method === 'GET' && url.pathname.startsWith('/api/'),
            handler: "NetworkFirst",
            options: {
              cacheName: "api-cache",
              networkTimeoutSeconds: 5,
              expiration: { maxEntries: 100, maxAgeSeconds: 300 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          // 2. Assets estaticos hashados → CacheFirst (cache larga, 30 dias)
          {
            urlPattern: /\.(?:js|css|woff2?|ttf|eot)$/i,
            handler: "CacheFirst",
            options: {
              cacheName: "assets-cache",
              expiration: { maxEntries: 200, maxAgeSeconds: 60 * 60 * 24 * 30 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          // 3. Tiles OSM → CacheFirst de larga duracion (mapa offline parcial)
          // IMPORTANTE: va antes que images-cache para que los .png de OSM
          // no caigan en la regla genérica de imágenes (que cachea opaque
          // responses cross-origin causando ERR_FAILED en posteriores cargas).
          {
            urlPattern: /^https:\/\/[a-c]\.tile\.openstreetmap\.org\/.*/,
            handler: "CacheFirst",
            options: {
              cacheName: "osm-tiles",
              expiration: { maxEntries: 500, maxAgeSeconds: 60 * 60 * 24 * 30 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          // 4. Imagenes locales → CacheFirst con LRU (excluye OSM tiles)
          {
            urlPattern: ({ url }) =>
              /\.(?:png|jpg|jpeg|gif|svg|webp|avif|ico)$/i.test(url.pathname) &&
              !url.hostname.endsWith('.tile.openstreetmap.org'),
            handler: "CacheFirst",
            options: {
              cacheName: "images-cache",
              expiration: { maxEntries: 100, maxAgeSeconds: 60 * 60 * 24 * 7 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          // 5. HTML / navegacion → StaleWhileRevalidate
          {
            urlPattern: ({ request }) => request.mode === 'navigate',
            handler: "StaleWhileRevalidate",
            options: {
              cacheName: "pages-cache",
              expiration: { maxEntries: 20, maxAgeSeconds: 60 * 60 * 24 },
            },
          },
        ],
      },
    }),
    process.env.ANALYZE === '1' && visualizer({
      filename: 'dist/bundle-stats.html',
      template: 'treemap',
      gzipSize: true,
      brotliSize: true,
      open: false,
    }),
  ].filter(Boolean),
  build: {
    rollupOptions: {
      output: {
        manualChunks: (id) => {
          if (id.includes('node_modules')) {
            if (id.includes('leaflet') || id.includes('react-leaflet')) return 'leaflet';
            if (id.includes('recharts')) return 'recharts';
            if (id.includes('@radix-ui')) return 'radix';
            if (id.includes('@stripe')) return 'stripe';
            if (id.includes('react-day-picker') || id.includes('date-fns')) return 'date';
            if (id.includes('react-router')) return 'router';
            if (id.includes('@tanstack')) return 'query';
            if (id.includes('i18next') || id.includes('react-i18next')) return 'i18n';
            return 'vendor';
          }
        },
      },
    },
    chunkSizeWarningLimit: 500,
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      // Hito H-3.4 — contratos API single-source-of-truth.
      // Frontend consume z.infer<>/DTOs desde backend/src/schemas/index.ts.
      "@city2cruise/api-types": path.resolve(__dirname, "../backend/src/schemas"),
    },
  },
  test: {
    // Hito 6 QA — vitest config: excluir tests E2E de Playwright
    exclude: [
      "**/node_modules/**",
      "**/dist/**",
      "**/e2e/**",
    ],
    coverage: {
      provider: "v8",
      reporter: ["text-summary", "json-summary", "html"],
      reportsDirectory: "./coverage",
      exclude: [
        "**/node_modules/**",
        "**/dist/**",
        "**/e2e/**",
        "**/__tests__/**",
        "**/*.config.*",
        "src/main.tsx",
        "src/i18n/**",
      ],
    },
    environment: "jsdom",
    setupFiles: ["src/setupTests.ts"],
  },
}));
