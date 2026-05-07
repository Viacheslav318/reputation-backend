const express = require('express')
const router = express.Router()
const supabase = require('../config/supabase')
const telegramAuth = require('../middleware/telegramAuth')

// GET /api/profiles/search?q=searchTerm
// Search profiles by name, phone, or TG username
router.get('/search', telegramAuth, async (req, res) => {
  const { q } = req.query

  if (!q || q.trim().length < 2) {
    return res.status(400).json({ error: 'Search query must be at least 2 characters' })
  }

  const searchTerm = q.trim().toLowerCase()

  const { data, error } = await supabase
    .from('profiles')
    .select(`
      id, full_name, phone, tg_username,
      rating_positive, rating_negative, created_at
    `)
    .or(
      `full_name.ilike.%${searchTerm}%,` +
      `phone.ilike.%${searchTerm}%,` +
      `tg_username.ilike.%${searchTerm}%`
    )
    .order('created_at', { ascending: false })
    .limit(20)

  if (error) {
    console.error('Search error:', error)
    return res.status(500).json({ error: 'Search failed' })
  }

  res.json({ profiles: data })
})

// GET /api/profiles/:id
// Get single profile with all reviews
router.get('/:id', telegramAuth, async (req, res) => {
  const { id } = req.params

  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', id)
    .single()

  if (profileError || !profile) {
    return res.status(404).json({ error: 'Profile not found' })
  }

  const { data: reviews, error: reviewsError } = await supabase
    .from('reviews')
    .select(`
      id, type, text, photo_urls, created_at,
      users(tg_id, username, first_name)
    `)
    .eq('profile_id', id)
    .order('created_at', { ascending: false })

  if (reviewsError) {
    console.error('Reviews fetch error:', reviewsError)
    return res.status(500).json({ error: 'Failed to fetch reviews' })
  }

  res.json({ profile, reviews: reviews || [] })
})

// POST /api/profiles
// Create a new person profile
router.post('/', telegramAuth, async (req, res) => {
  const { full_name, phone, tg_username } = req.body

  if (!full_name || full_name.trim().length < 2) {
    return res.status(400).json({ error: 'Full name is required (min 2 characters)' })
  }

  // Check if profile with same phone or TG already exists
  if (phone || tg_username) {
    const checks = []
    if (phone) checks.push(`phone.eq.${phone}`)
    if (tg_username) checks.push(`tg_username.eq.${tg_username.replace('@', '')}`)

    const { data: existing } = await supabase
      .from('profiles')
      .select('id, full_name')
      .or(checks.join(','))
      .limit(1)

    if (existing && existing.length > 0) {
      return res.status(409).json({
        error: 'Profile with this phone or Telegram already exists',
        existing_id: existing[0].id
      })
    }
  }

  // Upsert the user who is creating the profile
  await supabase.from('users').upsert({
    tg_id: req.tgUser.id,
    username: req.tgUser.username || null,
    first_name: req.tgUser.first_name || null
  }, { onConflict: 'tg_id' })

  const { data: profile, error } = await supabase
    .from('profiles')
    .insert({
      full_name: full_name.trim(),
      phone: phone ? phone.trim() : null,
      tg_username: tg_username ? tg_username.replace('@', '').trim() : null,
      rating_positive: 0,
      rating_negative: 0,
      created_by: req.tgUser.id
    })
    .select()
    .single()

  if (error) {
    console.error('Create profile error:', error)
    return res.status(500).json({ error: 'Failed to create profile' })
  }

  res.status(201).json({ profile })
})

module.exports = router
