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
  optimizeDeps: {
    // Force Three.js to be pre-bundled together
    include: ['three', 'react-globe.gl'],
    // Exclude from optimization to prevent splitting
    exclude: [],
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
            // CRITICAL: react-globe.gl must be with React, not with Three.js
            // because it depends on React/PropTypes which must load first
            const isReactGlobe = id.includes('react-globe.gl');
            
            // React core libraries (including react-globe.gl which depends on React)
            if (id.includes('react') || id.includes('react-dom') || id.includes('react-router') || isReactGlobe) {
              return 'react-vendor';
            }
            
            // Three.js in its own chunk (but react-globe.gl is with React)
            // Use more specific matching to catch all Three.js modules
            const isThree = /node_modules[\\/]three([\\/]|$)/.test(id) ||
                           id.includes('node_modules/three/') ||
                           id.includes('node_modules\\three\\');
            
            if (isThree) {
              return 'three-vendor';
            }
            // PDF libraries (jsPDF) in separate chunk
            if (id.includes('jspdf')) {
              return 'pdf-vendor';
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
        // Explicitly disable source map generation
        sourcemapIgnoreList: () => true,
      },
      // Preserve module structure to prevent initialization issues
      preserveEntrySignatures: false,
      // Ensure proper external handling - don't externalize Three.js
      external: [],
    },
    // TEMPORARILY disable minification to test if it causes the constructor issue
    // If this fixes it, we know minification is the problem
    minify: false,
    // Explicitly disable source maps to prevent browser from trying to load them
    sourcemap: false,
    chunkSizeWarningLimit: 1000, // Keep warning at 1MB to track large chunks
    // Ensure proper handling of CommonJS modules
    commonjsOptions: {
      include: [/node_modules/],
      transformMixedEsModules: true,
      // Ensure proper handling of Three.js CommonJS exports
      strictRequires: false,
      // Preserve require statements for better compatibility
      requireReturnsDefault: 'auto',
      // Don't transform dynamic requires
      dynamicRequireTargets: [],
      // Preserve module structure to prevent initialization issues
      defaultIsModuleExports: 'auto',
    },
    // Improve module resolution for better compatibility
    target: 'es2020',
    // Ensure proper module format
    modulePreload: {
      polyfill: false,
    },
  },
})
