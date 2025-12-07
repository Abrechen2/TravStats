import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.tsx'
import './index.css'

// Initialize theme before React renders to prevent flash
// This ensures the theme is applied immediately when the page loads
if (typeof window !== 'undefined') {
  try {
    const stored = localStorage.getItem('theme-storage');
    let isDark = false;

    if (stored) {
      const parsed = JSON.parse(stored);
      if (parsed?.state && typeof parsed.state.isDarkMode === 'boolean') {
        isDark = parsed.state.isDarkMode;
      }
    } else if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
      isDark = true;
    }

    // Apply theme immediately to document
    if (isDark) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  } catch (e) {
    // Silently fail - theme store will handle it
    console.warn('Error initializing theme in main.tsx:', e);
  }
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
