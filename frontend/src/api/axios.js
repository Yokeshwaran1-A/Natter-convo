import axios from 'axios'

// Create axios instance with base URL pointing to backend
const baseURL = import.meta.env.VITE_API_URL || 'https://natter-convo.onrender.com'
const api = axios.create({
  baseURL,
  timeout: 15000,
  headers: {
    'Content-Type': 'application/json'
  }
})

// Add token to requests if available
api.interceptors.request.use(
  (config) => {
    const token = localStorage.getItem('token')
    if (token) {
      config.headers.Authorization = `Bearer ${token}`
    }
    return config
  },
  (error) => {
    return Promise.reject(error)
  }
)

// Handle response errors
api.interceptors.response.use(
  (response) => response,
  (error) => {
    const requestUrl = error.config?.url || ''
    const isAuthRequest =
      requestUrl.includes('/api/auth/login') || requestUrl.includes('/api/auth/register')

    if (error.response?.status === 401 && !isAuthRequest) {
      localStorage.removeItem('token')
      localStorage.removeItem('user')
      window.location.href = '/auth'
    }
    return Promise.reject(error)
  }
)

export default api
