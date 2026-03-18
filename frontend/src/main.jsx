import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import './index.css'

class AppErrorBoundary extends React.Component {
  constructor(props) {
    super(props)
    this.state = { hasError: false, errorMessage: '' }
  }

  static getDerivedStateFromError(error) {
    return {
      hasError: true,
      errorMessage: error?.message || 'Unknown application error'
    }
  }

  componentDidCatch(error, errorInfo) {
    console.error('Application crashed:', error, errorInfo)
    try {
      sessionStorage.setItem('app_crash_message', error?.message || 'Unknown application error')
    } catch {
      // Ignore storage failures and continue showing fallback UI.
    }
  }

  handleReset = () => {
    localStorage.removeItem('token')
    localStorage.removeItem('user')
    sessionStorage.removeItem('app_crash_message')
    window.location.reload()
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="loading-container error-screen">
          <div className="error-card">
            <h1>Something went wrong</h1>
            <p>The app hit an unexpected error. Reset the saved session and reload to continue.</p>
            {this.state.errorMessage && (
              <code className="error-details">{this.state.errorMessage}</code>
            )}
            <button className="btn btn-primary" onClick={this.handleReset}>
              Reset and Reload
            </button>
          </div>
        </div>
      )
    }

    return this.props.children
  }
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <AppErrorBoundary>
      <App />
    </AppErrorBoundary>
  </React.StrictMode>,
)
