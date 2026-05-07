require('dotenv').config()
const express = require('express')
const cors = require('cors')
const rateLimit = require('express-rate-limit')

const profilesRouter = require('./routes/profiles')
const reviewsRouter = require('./routes/reviews')

const app = express()
const PORT = process.env.PORT || 3000

// ─── CORS ────────────────────────────────────────────────────────────────────
app.use(cors({
  origin: [
    process.env.FRONTEND_URL,
    'https://web.telegram.org',
    // Allow localhost in development
    ...(process.env.NODE_ENV === 'development'
      ? ['http://localhost:5173', 'http://localhost:3001']
      : [])
  ],
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  allowedHeaders: ['Content-Type', 'x-telegram-init-data']
}))

// ─── Body parsers ────────────────────────────────────────────────────────────
app.use(express.json({ limit: '1mb' }))
app.use(express.urlencoded({ extended: true }))

// ─── Rate limiting ───────────────────────────────────────────────────────────
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100,                  // 100 requests per window
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please try again later.' }
})

const createLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 10,                   // 10 new profiles/reviews per hour per IP
  message: { error: 'Creation limit reached. Please wait before adding more.' }
})

app.use('/api/', apiLimiter)
app.use('/api/profiles', createLimiter)
app.use('/api/reviews', createLimiter)

// ─── Routes ──────────────────────────────────────────────────────────────────
app.use('/api/profiles', profilesRouter)
app.use('/api/reviews', reviewsRouter)

// ─── Health check (Railway uses this) ────────────────────────────────────────
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() })
})

// ─── 404 handler ─────────────────────────────────────────────────────────────
app.use((req, res) => {
  res.status(404).json({ error: 'Route not found' })
})

// ─── Global error handler ─────────────────────────────────────────────────────
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err)
  res.status(500).json({ error: 'Internal server error' })
})

// ─── Start ───────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`✅ Server running on port ${PORT}`)
  console.log(`🌍 Environment: ${process.env.NODE_ENV}`)
})
