import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom'
import { useState, useEffect, createContext, useContext } from 'react'
import Auth from './pages/Auth'
import Chat from './pages/Chat'

// Create auth context
export const AuthContext = createContext(null)

export const useAuth = () => useContext(AuthContext)

function App() {
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(true)
  const [theme, setTheme] = useState(() => localStorage.getItem('theme') || 'dark')

  useEffect(() => {
    const restoreSession = () => {
      const token = localStorage.getItem('token')
      const userData = localStorage.getItem('user')

      if (!token || !userData) {
        return
      }

      try {
        const parsedUser = JSON.parse(userData)
        if (parsedUser && parsedUser._id) {
          setUser(parsedUser)
          return
        }
      } catch (error) {
        console.error('Failed to restore saved session:', error)
      }

      localStorage.removeItem('token')
      localStorage.removeItem('user')
    }

    restoreSession()
    setLoading(false)
  }, [])

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
    localStorage.setItem('theme', theme)
  }, [theme])

  const login = (token, userData) => {
    localStorage.setItem('token', token)
    localStorage.setItem('user', JSON.stringify(userData))
    setUser(userData)
  }

  const logout = () => {
    localStorage.removeItem('token')
    localStorage.removeItem('user')
    setUser(null)
  }

  const updateUser = (userData) => {
    localStorage.setItem('user', JSON.stringify(userData))
    setUser(userData)
  }

  const toggleTheme = () => {
    setTheme(prev => (prev === 'dark' ? 'light' : 'dark'))
  }

  if (loading) {
    return (
      <div className="loading-container">
        <div className="loading-spinner"></div>
      </div>
    )
  }

  return (
    <AuthContext.Provider value={{ user, login, logout, updateUser, theme, toggleTheme }}>
      <Router>
        <Routes>
          <Route path="/auth" element={!user ? <Auth /> : <Navigate to="/" />} />
          <Route path="/" element={user ? <Chat /> : <Navigate to="/auth" />} />
        </Routes>
      </Router>
    </AuthContext.Provider>
  )
}

export default App
