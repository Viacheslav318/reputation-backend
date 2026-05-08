const express = require('express')
const router = express.Router()
const multer = require('multer')
const supabase = require('../config/supabase')
const telegramAuth = require('../middleware/telegramAuth')

const REVIEW_LIMIT = 2 // Max reviews per profile

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024, files: 5 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) cb(null, true)
    else cb(new Error('Only image files are allowed'))
  }
})

async function uploadPhotos(files, reviewId) {
  const uploadedUrls = []
  for (const file of files) {
    const ext = file.mimetype.split('/')[1]
    const fileName = `reviews/${reviewId}/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`

    const { error } = await supabase.storage
      .from('review-photos')
      .upload(fileName, file.buffer, { contentType: file.mimetype, upsert: false })

    if (error) { console.error('Photo upload error:', error); continue }

    const { data: { publicUrl } } = supabase.storage
      .from('review-photos')
      .getPublicUrl(fileName)

    uploadedUrls.push(publicUrl)
  }
  return uploadedUrls
}

// POST /api/reviews
router.post('/', telegramAuth, upload.array('photos', 5), async (req, res) => {
  const { profile_id, type, text } = req.body

  if (!profile_id) {
    return res.status(400).json({ error: 'profile_id is required' })
  }
  if (!['positive', 'negative'].includes(type)) {
    return res.status(400).json({ error: 'type must be "positive" or "negative"' })
  }
  if (!text || text.trim().length < 10) {
    return res.status(400).json({ error: 'Review text must be at least 10 characters' })
  }

  // Check profile exists
  const { data: profile } = await supabase
    .from('profiles')
    .select('id')
    .eq('id', profile_id)
    .single()

  if (!profile) {
    return res.status(404).json({ error: 'Profile not found' })
  }

  // Check total review count for this profile (limit = 2)
  const { count } = await supabase
    .from('reviews')
    .select('id', { count: 'exact', head: true })
    .eq('profile_id', profile_id)

  if (count >= REVIEW_LIMIT) {
    return res.status(409).json({
      error: `Достигнут лимит отзывов (максимум ${REVIEW_LIMIT} на одного человека)`
    })
  }

  // Check if this user already reviewed this profile
  const { data: existing } = await supabase
    .from('reviews')
    .select('id')
    .eq('profile_id', profile_id)
    .eq('author_tg_id', req.tgUser.id)
    .single()

  if (existing) {
    return res.status(409).json({ error: 'Вы уже оставляли отзыв об этом человеке' })
  }

  // Upsert author
  await supabase.from('users').upsert({
    tg_id: req.tgUser.id,
    username: req.tgUser.username || null,
    first_name: req.tgUser.first_name || null
  }, { onConflict: 'tg_id' })

  // Create review
  const { data: review, error: reviewError } = await supabase
    .from('reviews')
    .insert({
      profile_id,
      author_tg_id: req.tgUser.id,
      type,
      text: text.trim(),
      photo_urls: []
    })
    .select()
    .single()

  if (reviewError) {
    console.error('Create review error:', reviewError)
    return res.status(500).json({ error: 'Failed to create review' })
  }

  // Upload photos
  let photoUrls = []
  if (req.files && req.files.length > 0) {
    photoUrls = await uploadPhotos(req.files, review.id)
    if (photoUrls.length > 0) {
      await supabase.from('reviews').update({ photo_urls: photoUrls }).eq('id', review.id)
    }
  }

  // Update rating counter
  const ratingField = type === 'positive' ? 'rating_positive' : 'rating_negative'
  await supabase.rpc('increment_rating', {
    profile_id_arg: profile_id,
    field_name: ratingField
  })

  res.status(201).json({ review: { ...review, photo_urls: photoUrls } })
})

router.use((err, req, res, next) => {
  if (err.code === 'LIMIT_FILE_SIZE') return res.status(400).json({ error: 'File too large. Max 10MB.' })
  if (err.code === 'LIMIT_FILE_COUNT') return res.status(400).json({ error: 'Too many files. Max 5.' })
  res.status(400).json({ error: err.message })
})

module.exports = router
