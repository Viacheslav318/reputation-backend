const crypto = require('crypto')

/**
 * Verifies Telegram WebApp initData signature
 * https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app
 */
function verifyTelegramData(initData, botToken) {
  const urlParams = new URLSearchParams(initData)
  const hash = urlParams.get('hash')

  if (!hash) return null

  // Remove hash from params before checking
  urlParams.delete('hash')

  // Sort params alphabetically and join with \n
  const dataCheckString = Array.from(urlParams.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`)
    .join('\n')

  // Create HMAC-SHA256 key from "WebAppData" + bot token
  const secretKey = crypto
    .createHmac('sha256', 'WebAppData')
    .update(botToken)
    .digest()

  // Create HMAC-SHA256 of data check string using secret key
  const calculatedHash = crypto
    .createHmac('sha256', secretKey)
    .update(dataCheckString)
    .digest('hex')

  if (calculatedHash !== hash) return null

  // Check that data is not older than 24 hours
  const authDate = parseInt(urlParams.get('auth_date'), 10)
  const now = Math.floor(Date.now() / 1000)
  if (now - authDate > 86400) return null

  // Parse user data
  const userRaw = urlParams.get('user')
  if (!userRaw) return null

  try {
    return JSON.parse(userRaw)
  } catch {
    return null
  }
}

/**
 * Express middleware — validates TG auth and attaches user to req
 */
function telegramAuth(req, res, next) {
  // Allow skipping auth in development
  if (process.env.NODE_ENV === 'development' && process.env.SKIP_AUTH === 'true') {
    req.tgUser = { id: 12345678, username: 'dev_user', first_name: 'Dev' }
    return next()
  }

  const initData = req.headers['x-telegram-init-data']

  if (!initData) {
    return res.status(401).json({ error: 'Missing Telegram auth data' })
  }

  const user = verifyTelegramData(initData, process.env.BOT_TOKEN)

  if (!user) {
    return res.status(401).json({ error: 'Invalid or expired Telegram auth data' })
  }

  req.tgUser = user
  next()
}

module.exports = telegramAuth
