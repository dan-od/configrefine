import React from 'react'
import ReactDOM from 'react-dom/client'
import { ThemeProvider } from './theme'
import { ErrorBoundary } from './components/ErrorBoundary'
import App from './App.jsx'

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ErrorBoundary>
      <ThemeProvider>
        <App />
      </ThemeProvider>
    </ErrorBoundary>
  </React.StrictMode>
)
