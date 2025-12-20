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
        manualChunks: (id) => {
          // Split node_modules into separate chunks
          if (id.includes('node_modules')) {
            // Three.js in its own chunk (very large, ~500-800KB)
            if (id.includes('three')) {
              return 'three-vendor';
            }
            // react-globe.gl in its own chunk (depends on three, ~200-400KB)
            if (id.includes('react-globe.gl')) {
              return 'globe-vendor';
            }
            // PDF libraries (jsPDF) in separate chunk
            if (id.includes('jspdf')) {
              return 'pdf-vendor';
            }
            // React core libraries
            if (id.includes('react') || id.includes('react-dom') || id.includes('react-router')) {
              return 'react-vendor';
            }
            // Heavy parsing libraries
            if (id.includes('tesseract.js')) {
              return 'parser-vendor';
            }
            // Chart libraries
            if (id.includes('recharts')) {
              return 'charts-vendor';
            }
            // State management
            if (id.includes('zustand')) {
              return 'store-vendor';
            }
            // Other vendor libraries
            return 'vendor';
          }
        },
        // Optimize chunk file names for better caching
        chunkFileNames: 'assets/js/[name]-[hash].js',
        entryFileNames: 'assets/js/[name]-[hash].js',
        assetFileNames: 'assets/[ext]/[name]-[hash].[ext]',
      },
    },
    // Use esbuild for minification (faster than terser, default in Vite)
    minify: 'esbuild',
    // Reduce source map size in production (set to true if you need debugging)
    sourcemap: false,
    chunkSizeWarningLimit: 1000, // Keep warning at 1MB to track large chunks
    // Ensure proper handling of CommonJS modules
    commonjsOptions: {
      include: [/node_modules/],
      transformMixedEsModules: true,
    },
  },
})
