import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import api from '../api/axios'
import { useAuth } from '../App'

export default function Auth() {
  const [isLogin, setIsLogin] = useState(true)
  const [formData, setFormData] = useState({
    username: '',
    email: '',
    password: ''
  })
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const { login } = useAuth()
  const navigate = useNavigate()

  const handleChange = (e) => {
    setFormData({ ...formData, [e.target.name]: e.target.value })
    setError('')
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (loading) {
      return
    }

    setLoading(true)
    setError('')

    try {
      const endpoint = isLogin ? '/api/auth/login' : '/api/auth/register'
      const payload = isLogin 
        ? { email: formData.email, password: formData.password }
        : formData

      const response = await api.post(endpoint, payload)

      if (isLogin) {
        if (!response.data?.token || !response.data?._id) {
          throw new Error('Login response is missing required session data')
        }

        login(response.data.token, response.data)
        navigate('/')
      } else {
        setIsLogin(true)
        setError('Account created! Please login.')
      }
    } catch (err) {
      console.error('Authentication request failed:', err)

      if (err.code === 'ECONNABORTED') {
        setError('The server took too long to respond. Please check that the backend is running and try again.')
      } else if (!err.response) {
        setError('Cannot connect to the server. Please check that the backend URL is correct and online.')
      } else {
        setError(err.response?.data?.message || err.message || 'Something went wrong')
      }
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="auth-container">
      <motion.div 
        className="auth-card"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
      >
        <div className="auth-header">
          <motion.div 
            className="auth-logo"
            whileHover={{ scale: 1.05, rotate: 5 }}
            transition={{ type: 'spring', stiffness: 300 }}
          >
            💬
          </motion.div>
          <h1 className="auth-title">Chat Clone</h1>
          <p className="auth-subtitle">
            {isLogin ? 'Welcome back! Sign in to continue' : 'Create an account to get started'}
          </p>
        </div>

        <AnimatePresence mode="wait">
          <motion.form 
            key={isLogin ? 'login' : 'register'}
            className="auth-form"
            onSubmit={handleSubmit}
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 20 }}
            transition={{ duration: 0.3 }}
          >
            {!isLogin && (
              <motion.div 
                className="form-group"
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
              >
                <label className="form-label">
                  <i className="fas fa-user"></i>
                  Username
                </label>
                <input
                  type="text"
                  name="username"
                  className="form-input"
                  placeholder="Enter your username"
                  value={formData.username}
                  onChange={handleChange}
                  required={!isLogin}
                  minLength={3}
                />
              </motion.div>
            )}

            <div className="form-group">
              <label className="form-label">
                <i className="fas fa-envelope"></i>
                Email
              </label>
              <input
                type="email"
                name="email"
                className="form-input"
                placeholder="Enter your email"
                value={formData.email}
                onChange={handleChange}
                required
              />
            </div>

            <div className="form-group">
              <label className="form-label">
                <i className="fas fa-lock"></i>
                Password
              </label>
              <input
                type="password"
                name="password"
                className="form-input"
                placeholder="Enter your password"
                value={formData.password}
                onChange={handleChange}
                required
                minLength={6}
              />
            </div>

            {error && (
              <motion.div 
                className="error-message"
                initial={{ opacity: 0, y: -10 }}
                animate={{ opacity: 1, y: 0 }}
                style={{ 
                  color: '#ef4444', 
                  fontSize: '0.875rem', 
                  textAlign: 'center',
                  padding: '0.5rem',
                  background: 'rgba(239, 68, 68, 0.1)',
                  borderRadius: '8px'
                }}
              >
                {error}
              </motion.div>
            )}

            <motion.button
              type="submit"
              className="btn btn-primary"
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              disabled={loading}
            >
              {loading ? (
                <span className="loading-spinner" style={{ width: 20, height: 20 }}></span>
              ) : (
                <>
                  <i className={`fas fa-${isLogin ? 'sign-in-alt' : 'user-plus'}`}></i>
                  {isLogin ? 'Sign In' : 'Create Account'}
                </>
              )}
            </motion.button>
          </motion.form>
        </AnimatePresence>

        <div className="auth-footer">
          <p>
            {isLogin ? "Don't have an account? " : 'Already have an account? '}
            <motion.a
              href="#"
              onClick={(e) => {
                e.preventDefault()
                setIsLogin(!isLogin)
                setError('')
              }}
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
            >
              {isLogin ? 'Sign Up' : 'Sign In'}
            </motion.a>
          </p>
        </div>
      </motion.div>
    </div>
  )
}
