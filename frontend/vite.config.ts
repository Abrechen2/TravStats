import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 3000,
    host: true,
    proxy: {
      '/api': {
        target: process.env.VITE_API_URL || 'http://localhost:8000',
        changeOrigin: true,
      },
    },
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          // Vendor chunks
          'react-vendor': ['react', 'react-dom', 'react-router-dom'],
          // Heavy libraries
          'globe-vendor': ['react-globe.gl', 'three'],
          'parser-vendor': ['tesseract.js'],
          'charts-vendor': ['recharts'],
          // Zustand stores
          'store-vendor': ['zustand'],
        },
      },
    },
    chunkSizeWarningLimit: 1000, // Increase limit to 1MB
  },
})
