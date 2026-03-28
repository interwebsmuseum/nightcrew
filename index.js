import dotenv from 'dotenv'
import express from 'express'
import axios from 'axios'
import { Telegraf } from 'telegraf'

dotenv.config()

const app = express()
app.use(express.json({ limit: '2mb' }))

const PORT = process.env.PORT || 3000
const BOT_TOKEN = process.env.BOT_TOKEN
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID
const HELIUS_API_KEY = process.env.HELIUS_API_KEY
const HELIUS_AUTH_TOKEN = process.env.HELIUS_AUTH_TOKEN
const CA = process.env.CA || '2DnBVgG1LX2Umh2LL4rpCc3fyKUr2JKhzMy7CQuppump'
const X_LINK = process.env.X_LINK || 'https://x.com/InterwebsMuseum'
const WATCHED_ADDRESSES = (process.env.WATCHED_ADDRESSES || '')
  .split(',')
  .map((m) => m.trim())
  .filter(Boolean)
const TOKEN_MINTS = (process.env.TOKEN_MINTS || '')
  .split(',')
  .map((m) => m.trim())
  .filter(Boolean)
const PUBLIC_URL = process.env.PUBLIC_URL
const webhookURL = `${PUBLIC_URL}/webhook/helius?auth=${encodeURIComponent(HELIUS_AUTH_TOKEN)}`

if (!WATCHED_ADDRESSES.length) throw new Error('Missing WATCHED_ADDRESSES')
if (!BOT_TOKEN) throw new Error('Missing BOT_TOKEN')
if (!TELEGRAM_CHAT_ID) throw new Error('Missing TELEGRAM_CHAT_ID')
if (!HELIUS_API_KEY) throw new Error('Missing HELIUS_API_KEY')
if (!HELIUS_AUTH_TOKEN) throw new Error('Missing HELIUS_AUTH_TOKEN')
if (!TOKEN_MINTS.length) throw new Error('Missing TOKEN_MINTS')

const bot = new Telegraf(BOT_TOKEN)

// ------------------------
// Telegram bot commands
// ------------------------
bot.start((ctx) => {
  ctx.reply(
    'Welcome to the Interwebs Museum.\n\nType "CA", "X", "artifact", or "buy".'
  )
})

bot.hears(/ca|contract/i, (ctx) => {
  ctx.reply(`Contract Address:\n\n${CA}`)
})

bot.hears(/x|twitter/i, (ctx) => {
  ctx.reply(`Follow the archive:\n\n${X_LINK}`)
})

bot.hears(/artifact|drop/i, (ctx) => {
  ctx.reply('Latest Artifact:\nARCHIVE #001 — First Count\n\nObserve the origin.')
})

bot.hears(/buy|how to buy/i, (ctx) => {
  ctx.reply(`Contract Address:\n\n${CA}\n\nAlways verify CA before buying.`)
})

bot.command('ca', (ctx) => {
  ctx.reply(`Contract Address:\n\n${CA}`)
})

bot.command('x', (ctx) => {
  ctx.reply(`Follow the archive:\n\n${X_LINK}`)
})

bot.command('artifact', (ctx) => {
  ctx.reply('ARCHIVE #001 — First Count')
})

// ------------------------
// Helpers
// ------------------------
function shortenAddress(address = '') {
  if (!address || address.length < 10) return address
  return `${address.slice(0, 4)}...${address.slice(-4)}`
}

function formatNumber(value, maxDigits = 4) {
  const num = Number(value)
  if (!Number.isFinite(num)) return String(value)
  return num.toLocaleString(undefined, { maximumFractionDigits: maxDigits })
}

function getTokenLabel(mint) {
  return TOKEN_LABELS[mint] || `Tracked Artifact (${shortenAddress(mint)})`
}

async function sendTelegramMessage(text) {
  const telegramUrl = `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`

  await axios.post(telegramUrl, {
    chat_id: TELEGRAM_CHAT_ID,
    text,
    disable_web_page_preview: true
  })
}

// ------------------------
// Extract buy alert from Helius event
// ------------------------
function extractBuyAlert(event) {
  if (!event || typeof event !== 'object') return null

  const signature =
    event.signature ||
    event.transactionSignature ||
    event.txSignature ||
    ''

  const feePayer =
    event.feePayer ||
    event.signer ||
    event.source ||
    ''

  const tokenTransfers = Array.isArray(event.tokenTransfers)
    ? event.tokenTransfers
    : []

  const nativeTransfers = Array.isArray(event.nativeTransfers)
    ? event.nativeTransfers
    : []

  const matchingTokenTransfer = tokenTransfers.find((t) => {
    const mint = t.mint || t.tokenMint
    const amount =
      t.tokenAmount ??
      t.amount ??
      t.rawTokenAmount?.tokenAmount ??
      t.rawTokenAmount?.uiAmount ??
      0

    return TOKEN_MINTS.includes(mint) && Number(amount) > 0
  })

  if (!matchingTokenTransfer) return null

  const mint = matchingTokenTransfer.mint || matchingTokenTransfer.tokenMint

  const buyer =
    matchingTokenTransfer.toUserAccount ||
    matchingTokenTransfer.toTokenAccount ||
    feePayer ||
    'unknown'

  const tokenAmount =
    matchingTokenTransfer.tokenAmount ??
    matchingTokenTransfer.amount ??
    matchingTokenTransfer.rawTokenAmount?.tokenAmount ??
    matchingTokenTransfer.rawTokenAmount?.uiAmount ??
    0

  const largestNative = nativeTransfers.reduce((best, curr) => {
    const amount = Number(curr.amount || 0)
    const bestAmount = Number(best?.amount || 0)
    return amount > bestAmount ? curr : best
  }, null)

  const solLamports = Number(largestNative?.amount || 0)
  const solAmount = solLamports > 0 ? solLamports / 1_000_000_000 : null

  return {
    mint,
    signature,
    buyer,
    tokenAmount,
    solAmount
  }
}

// ------------------------
// Health check
// ------------------------
app.get('/', (_req, res) => {
  res.status(200).send('Interwebs Museum bot is online.')
})

// ------------------------
// Secure Helius webhook endpoint
// ------------------------
app.post('/webhook/helius', async (req, res) => {
  console.log('Webhook headers:', JSON.stringify(req.headers, null, 2))
  console.log('Webhook body:', JSON.stringify(req.body, null, 2))

  try {
    const authHeader = req.headers.authorization || ''
    const bearer = authHeader.startsWith('Bearer ')
      ? authHeader.slice(7)
      : ''

    const queryToken = req.query.auth

    if (bearer !== HELIUS_AUTH_TOKEN && queryToken !== HELIUS_AUTH_TOKEN) {
      console.log('Unauthorized webhook attempt')
      return res.status(401).json({ ok: false, error: 'Unauthorized' })
    }

    const payload = req.body
    const events = Array.isArray(payload) ? payload : [payload]

    for (const event of events) {
      const buy = extractBuyAlert(event)
      if (!buy) continue

      const tokenLabel = getTokenLabel(buy.mint)

      const lines = []
      lines.push('🟢 New Buy Detected')
      lines.push('')
      lines.push(`Artifact: ${tokenLabel}`)
      lines.push(`Mint: ${shortenAddress(buy.mint)}`)
      lines.push(`Buyer: ${shortenAddress(buy.buyer)}`)
      lines.push(`Amount: ${formatNumber(buy.tokenAmount)} tokens`)

      if (buy.solAmount !== null) {
        lines.push(`Spent: ${formatNumber(buy.solAmount)} SOL`)
      }

      if (buy.signature) {
        lines.push('TX:')
        lines.push(`https://solscan.io/tx/${buy.signature}`)
      }

      console.log('Sending Telegram alert...')

      try {
        await sendTelegramMessage(lines.join('\n'))
        console.log('Telegram alert sent successfully')
      } catch (err) {
        console.error('Telegram send failed:', err?.response?.data || err.message || err)
      }
    }

    return res.status(200).json({ ok: true })
  } catch (error) {
    console.error('Webhook error:', error?.response?.data || error.message || error)
    return res.status(500).json({ ok: false, error: 'Internal server error' })
  }
})

// ------------------------
// Create Helius webhook
// ------------------------
app.post('/admin/create-helius-webhook', async (req, res) => {
  try {
    const authHeader = req.headers.authorization || ''
    const bearer = authHeader.startsWith('Bearer ')
      ? authHeader.slice(7)
      : ''

    if (bearer !== HELIUS_AUTH_TOKEN) {
      return res.status(401).json({ ok: false, error: 'Unauthorized' })
    }

    const baseUrl = `${req.protocol}://${req.get('host')}`
    const webhookURL = `${baseUrl}/webhook/helius?auth=${encodeURIComponent(HELIUS_AUTH_TOKEN)}`

const body = {
  webhookURL,
  transactionTypes: ['ANY'],
  accountAddresses: WATCHED_ADDRESSES,
  webhookType: 'enhanced',
  authHeader: `Bearer ${HELIUS_AUTH_TOKEN}`
}
    
console.log('Registering webhook URL:', webhookURL)
console.log('Registering accountAddresses:', TOKEN_MINTS)
console.log('Registering body:', JSON.stringify(body, null, 2))
    
    const response = await axios.post(
      `https://api.helius.xyz/v0/webhooks?api-key=${HELIUS_API_KEY}`,
      body,
      {
        headers: { 'Content-Type': 'application/json' }
      }
    )

    return res.status(200).json({
      ok: true,
      webhookURL,
      heliusResponse: response.data
    })
  } catch (error) {
    console.error('Create webhook error:', error?.response?.data || error.message || error)
    return res.status(500).json({
      ok: false,
      error: error?.response?.data || error.message || 'Failed to create webhook'
    })
  }
})

app.post('/admin/test-webhook', async (req, res) => {
  try {
    const authHeader = req.headers.authorization || ''
    const bearer = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : ''

    if (bearer !== HELIUS_AUTH_TOKEN) {
      return res.status(401).json({ ok: false, error: 'Unauthorized' })
    }

    const fakeEvent = {
      signature: 'testsignature123',
      tokenTransfers: [
        {
          mint: TOKEN_MINTS[0],
          tokenAmount: 123456,
          toUserAccount: 'TestBuyerWallet123456789'
        }
      ],
      nativeTransfers: [
        {
          amount: 500000000
        }
      ]
    }

    const buy = extractBuyAlert(fakeEvent)
    if (!buy) {
      return res.status(400).json({ ok: false, error: 'Buy parsing failed' })
    }

    const tokenLabel = getTokenLabel(buy.mint)

    const lines = []
    lines.push('🟢 New Buy Detected')
    lines.push('')
    lines.push(`Artifact: ${tokenLabel}`)
    lines.push(`Mint: ${shortenAddress(buy.mint)}`)
    lines.push(`Buyer: ${shortenAddress(buy.buyer)}`)
    lines.push(`Amount: ${formatNumber(buy.tokenAmount)} tokens`)
    lines.push(`Spent: ${formatNumber(buy.solAmount)} SOL`)
    lines.push('TX:')
    lines.push(`https://solscan.io/tx/${buy.signature}`)

    await sendTelegramMessage(lines.join('\n'))

    return res.status(200).json({ ok: true, message: 'Test webhook sent to Telegram' })
  } catch (error) {
    console.error('Test webhook error:', error?.response?.data || error.message || error)
    return res.status(500).json({
      ok: false,
      error: error?.response?.data || error.message || 'Failed'
    })
  }
})

// ------------------------
// Start server
// ------------------------
app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`)
})

bot.launch()

process.once('SIGINT', () => bot.stop('SIGINT'))
process.once('SIGTERM', () => bot.stop('SIGTERM'))
