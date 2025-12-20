import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.tsx'
import './index.css'
// Import i18n config - this initializes i18n synchronously with initImmediate: false
import './i18n/config'
import { I18nextProvider } from 'react-i18next'
import i18n from './i18n/config'

// #region agent log
// Debug logging helper - works in Docker/Unraid by also logging to console and localStorage
const debugLog = (location: string, message: string, data: any = {}, hypothesisId?: string) => {
  const logEntry = {
    location,
    message,
    data,
    timestamp: Date.now(),
    sessionId: 'debug-session',
    runId: 'run1',
    hypothesisId,
  };
  
  // Try to send to debug server (works if running locally)
  fetch('http://127.0.0.1:7243/ingest/0704fdb1-689b-416e-9f08-7a10e884bebd', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(logEntry),
  }).catch(() => {});
  
  // Also log to console for immediate visibility
  console.log(`[DEBUG ${hypothesisId || '?'}] ${location}: ${message}`, data);
  
  // Store in localStorage for later retrieval (max 100 entries)
  try {
    const stored = localStorage.getItem('debug-logs') || '[]';
    const logs = JSON.parse(stored);
    logs.push(logEntry);
    if (logs.length > 100) logs.shift(); // Keep last 100 entries
    localStorage.setItem('debug-logs', JSON.stringify(logs));
  } catch (e) {
    // Ignore localStorage errors
  }
};
// #endregion

// #region agent log
// Global error handler for uncaught errors
window.addEventListener('error', (event) => {
  debugLog('main.tsx:global-error', 'Uncaught error detected', {
    message: event.message,
    filename: event.filename,
    lineno: event.lineno,
    colno: event.colno,
    error: event.error?.toString(),
    stack: event.error?.stack,
  }, 'A');
});
// #endregion

// #region agent log
// Global unhandled promise rejection handler
window.addEventListener('unhandledrejection', (event) => {
  debugLog('main.tsx:unhandled-rejection', 'Unhandled promise rejection', {
    reason: event.reason?.toString(),
    stack: event.reason?.stack,
  }, 'A');
});
// #endregion

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
    <I18nextProvider i18n={i18n}>
      <App />
    </I18nextProvider>
  </React.StrictMode>,
)
