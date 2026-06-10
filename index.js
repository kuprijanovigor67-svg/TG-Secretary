import 'dotenv/config'
import { Telegraf, Markup } from 'telegraf'
import { readFileSync, existsSync } from 'node:fs'
import { tavily } from '@tavily/core'
const CHAD_API_URL = 'https://ask.chadgpt.ru/api/public/gpt-4o-mini'
const CHAD_API_KEY = process.env.CHAD_API_KEY
const TAVILY_API_KEY = process.env.TAVILY_API_KEY
const GENAPI_API_KEY = process.env.GENAPI_API_KEY
const GROK_API_KEY = process.env.api_key
const GEMINI_TTS_API_KEY = process.env.GEMINI_TTS_API_KEY
const CRYPTO_PAY_TOKEN = process.env.CRYPTO_PAY_TOKEN
const BOT_TOKEN = process.env.BOT_TOKEN
const DB_PATH = './db.json'
const MAX_HISTORY = 15

if (!CHAD_API_KEY) {
  console.error('Ошибка: CHAD_API_KEY не указан в .env')
  process.exit(1)
}

if (!BOT_TOKEN) {
  console.error('Ошибка: BOT_TOKEN не указан в .env')
  process.exit(1)
}

if (!TAVILY_API_KEY) {
  console.error('Ошибка: TAVILY_API_KEY не указан в .env')
  process.exit(1)
}

if (!GENAPI_API_KEY || GENAPI_API_KEY === 'your_genapi_api_key_from_gen-api.ru') {
  console.error('Ошибка: GENAPI_API_KEY не указан в .env')
  console.error('Зарегистрируйся и получи ключ: https://gen-api.ru')
  process.exit(1)
}

if (!CRYPTO_PAY_TOKEN) {
  console.error('Ошибка: CRYPTO_PAY_TOKEN не указан в .env')
  console.error('Получи токен в @CryptoBot → Crypto Pay → Create App')
  process.exit(1)
}

const bot = new Telegraf(BOT_TOKEN)

function loadDB() {
  if (!existsSync(DB_PATH)) return {}
  return JSON.parse(readFileSync(DB_PATH, 'utf-8'))
}

function saveDB(data) {
  writeFileSync(DB_PATH, JSON.stringify(data, null, 2))
}

function getHistory(chatId) {
  const db = loadDB()
  return db[chatId] || []
}

function appendHistory(chatId, entry) {
  const db = loadDB()
  if (!db[chatId]) db[chatId] = []
  db[chatId].push(entry)
  if (db[chatId].length > MAX_HISTORY) {
    db[chatId] = db[chatId].slice(-MAX_HISTORY)
  }
  saveDB(db)
}

async function askChad(message, history) {
  const res = await fetch(CHAD_API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message,
      api_key: CHAD_API_KEY,
      temperature: 0.7,
      history: history.length > 0 ? history : undefined,
    }),
  })

  const data = await res.json()

  if (!data.is_success) {
    throw new Error(data.error_message || 'Ошибка Chad API')
  }

  return data.response
}

const tvly = tavily({ apiKey: TAVILY_API_KEY })

async function webSearch(query) {
  const result = await tvly.search(query, {
    searchDepth: 'advanced',
    includeAnswer: true,
    maxResults: 5,
  })

  return result
}


const GEMINI_TTS_URL = 'https://api.gen-api.ru/api/v1/networks/gemini-3-1-tts'
const GENAPI_URL = 'https://api.gen-api.ru/api/v1/networks/grok-imagine-image'

async function generateImage(prompt) {
  const res = await fetch(GENAPI_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${GENAPI_API_KEY}`,
    },
    body: JSON.stringify({
      prompt,
      api_key: GROK_API_KEY,
      is_sync: true,
      num_images: 1,
      aspect_ratio: '16:9',
      output_format: 'png',
    }),
  })

  const data = await res.json()

  if (!res.ok) {
    console.error('API ответ:', JSON.stringify(data, null, 2))
    throw new Error(data.error || data.message || 'Ошибка генерации изображения')
  }

  const imageUrl = data.images?.[0] || data.result?.[0] || data.url
  if (!imageUrl) {
    console.error('Неожиданный ответ API:', JSON.stringify(data, null, 2))
    throw new Error('Не удалось получить URL изображения')
  }

  return imageUrl
}

const WHISPER_URL = 'https://api.gen-api.ru/api/v1/networks/whisper'

async function speechToText(audioUrl) {
  const res = await fetch(WHISPER_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${GENAPI_API_KEY}`,
    },
    body: JSON.stringify({
      audio_url: audioUrl,
      task: 'transcribe',
      language: 'ru',
      is_sync: true,
    }),
  })

  const data = await res.json()

  if (!res.ok) {
    console.error('Whisper API ответ:', JSON.stringify(data, null, 2))
    throw new Error(data.error || data.message || 'Ошибка распознавания речи')
  }

  const text = Array.isArray(data.result) ? data.result.join(' ') : (data.text || data.result || '')
  return text.trim()
}

const GENAPI_GET_URL = 'https://api.gen-api.ru/api/v1/request/get'

async function textToSpeech(text) {
  const res = await fetch(GEMINI_TTS_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${GENAPI_API_KEY}`,
    },
    body: JSON.stringify({
      prompt: text,
      voice: 'Kore',
      language_code: 'Russian (Russia)',
      output_format: 'mp3',
    }),
  })

  const data = await res.json()

  if (!res.ok) {
    console.error('Gemini TTS ответ:', JSON.stringify(data, null, 2))
    throw new Error(data.error || 'Ошибка синтеза речи')
  }

  const requestId = data.request_id
  if (!requestId) {
    console.error('Gemini TTS: нет request_id', JSON.stringify(data, null, 2))
    throw new Error('Нет request_id в ответе')
  }

  for (let i = 0; i < 30; i++) {
    const poll = await fetch(`${GENAPI_GET_URL}/${requestId}`, {
      headers: { Authorization: `Bearer ${GENAPI_API_KEY}` },
    })
    const result = await poll.json()

    if (result.status === 'success') {
      return result.result?.[0] || result.url || result.audio_url || ''
    }

    if (result.status === 'error') {
      throw new Error(result.error || 'Ошибка генерации TTS')
    }

    await new Promise(r => setTimeout(r, 2000))
  }

  throw new Error('Таймаут ожидания генерации TTS')
}

const CRYPTO_PAY_URL = 'https://pay.crypt.bot/api'

async function createCryptoInvoice(amount) {
  const res = await fetch(`${CRYPTO_PAY_URL}/createInvoice`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Crypto-Pay-API-Token': CRYPTO_PAY_TOKEN,
    },
    body: JSON.stringify({
      currency_type: 'fiat',
      fiat: 'USD',
      amount: String(amount),
      description: `Донат TG Secretary — $${amount}`,
      expires_in: 3600,
    }),
  })

  const data = await res.json()

  if (!data.ok) {
    console.error('Crypto Pay ответ:', JSON.stringify(data, null, 2))
    throw new Error(data.error || 'Ошибка создания счета')
  }

  return data.result
}

bot.command('donate', async (ctx) => {
  await ctx.reply(
    '🤝 Поддержи разработку бота\n\nВыбери сумму для доната:',
    Markup.inlineKeyboard([
      Markup.button.callback('💰 $10', 'donate_10'),
      Markup.button.callback('💰 $100', 'donate_100'),
    ])
  )
})

bot.action(/donate_(.+)/, async (ctx) => {
  const amount = ctx.match[1]
  await ctx.answerCbQuery('🔄 Создаю счёт...')

  try {
    const invoice = await createCryptoInvoice(amount)
    await ctx.reply(
      `✅ Счёт создан!\n\n💵 Сумма: *$${amount}*\n🔗 [Оплатить](${invoice.bot_invoice_url})\n\n⏳ Счёт действителен 1 час`,
      { parse_mode: 'Markdown', disable_web_page_preview: true }
    )
  } catch (err) {
    console.error('Ошибка создания счёта:', err)
    await ctx.reply('😵 Не удалось создать счёт. Попробуй позже')
  }
})

bot.start((ctx) => ctx.reply(
  '👋 *Привет! Я твой AI-секретарь*\n\n' +
  'Просто напиши мне что угодно — я отвечу с умом и поиском в интернете.\n\n' +
  '📱 *Команды:*\n' +
  '/search `запрос` — поиск в интернете\n' +
  '/imagine `описание` — генерация картинки\n' +
  '/say `текст` — озвучивание текста\n' +
  '/donate — поддержать разработку\n\n' +
  '🎤 *Голосовые сообщения* — я распознаю речь, найду информацию и отвечу голосом.\n\n' +
  '⚡ Просто пиши — я помогу!',
  { parse_mode: 'Markdown' }
))

bot.command('search', async (ctx) => {
  const query = ctx.message.text.replace(/^\/search\s*/i, '').trim()
  if (!query) {
    return ctx.reply('❓ Нужно указать запрос после /search\n\nПример: `/search последние новости AI`', { parse_mode: 'Markdown' })
  }

  await ctx.reply('🔍 Ищу в интернете... секунду')

  try {
    const search = await webSearch(query)
    let context = ''

    if (search.results?.length) {
      context = 'Вот актуальная информация из интернета. Ответь на русском языке, кратко и по существу:\n\n'
      context += search.results.slice(0, 5).map((r, i) =>
        `${i + 1}. ${r.title}\n${r.content.slice(0, 300)}`
      ).join('\n\n')
      context += '\n\n---\n\n'
    }

    const reply = await askChad(context + query, [])
    await ctx.reply(reply)
  } catch (err) {
    console.error('Ошибка поиска:', err)
    await ctx.reply('😕 Не смог ничего найти. Попробуй переформулировать запрос или повтори позже')
  }
})

bot.command('imagine', async (ctx) => {
  const prompt = ctx.message.text.replace(/^\/imagine\s*/i, '').trim()
  if (!prompt) {
    return ctx.reply('🤔 Напиши, что нарисовать после /imagine\n\nПример: `/imagine кот в космосе в стиле киберпанк`', { parse_mode: 'Markdown' })
  }

  await ctx.reply('🎨 Рисую... это займёт несколько секунд')

  try {
    const imageUrl = await generateImage(prompt)
    await ctx.replyWithPhoto(imageUrl)
  } catch (err) {
    console.error('Ошибка генерации:', err)
    await ctx.reply('😵 Не вышло сгенерировать картинку. Попробуй другой промпт или повтори позже')
  }
})

bot.command('say', async (ctx) => {
  const text = ctx.message.text.replace(/^\/say\s*/i, '').trim()
  if (!text) {
    return ctx.reply('📝 Напиши текст после /say\n\nПример: `/say Привет, как дела?`', { parse_mode: 'Markdown' })
  }

  await ctx.reply('🔊 Синтезирую речь...')

  try {
    const audioUrl = await textToSpeech(text)
    await ctx.replyWithVoice(audioUrl)
  } catch (err) {
    console.error('Ошибка TTS:', err)
    await ctx.reply('🙈 Не удалось синтезировать речь. Попробуй позже')
  }
})

bot.on('voice', async (ctx) => {
  try {
    await ctx.reply('🎧 Распознаю речь...')

    const fileLink = await ctx.telegram.getFileLink(ctx.message.voice.file_id)
    const recognized = await speechToText(fileLink.toString())

    if (!recognized) {
      return ctx.reply('🤷 Не удалось разобрать речь')
    }

    await ctx.reply(`🗣 *Распознано:* ${recognized}\n\n⏳ Думаю...`, { parse_mode: 'Markdown' })

    const chatId = String(ctx.chat.id)
    let context = ''

    try {
      const search = await webSearch(recognized)
      if (search.results?.length) {
        context = 'Вот актуальная информация из интернета. Ответь на русском языке, кратко и по существу, без лишних ссылок:\n\n'
        context += search.results.slice(0, 3).map((r, i) =>
          `${i + 1}. ${r.title}\n${r.content.slice(0, 300)}`
        ).join('\n\n')
        context += '\n\n---\n\n'
      }
    } catch {}

    const history = getHistory(chatId)
    appendHistory(chatId, { role: 'user', content: recognized })

    const reply = await askChad(context + recognized, history)
    appendHistory(chatId, { role: 'assistant', content: reply })

    try {
      const audioUrl = await textToSpeech(reply)
      await ctx.replyWithVoice(audioUrl)
      await ctx.reply(reply)
    } catch {
      await ctx.reply(reply)
    }
  } catch (err) {
    console.error('Ошибка голосового сообщения:', err)
    await ctx.reply('🙈 Не удалось обработать голосовое сообщение')
  }
})

function escapeHtml(text) {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

bot.on('text', async (ctx) => {
  try {
    const chatId = String(ctx.chat.id)
    const query = ctx.message.text

    await ctx.reply('🤔 Думаю...')
    let context = ''

    try {
      const search = await webSearch(query)
      if (search.results?.length) {
        context = 'Вот актуальная информация из интернета. Ответь на русском языке, кратко и по существу, без лишних ссылок:\n\n'
        context += search.results.slice(0, 3).map((r, i) =>
          `${i + 1}. ${r.title}\n${r.content.slice(0, 300)}`
        ).join('\n\n')
        context += '\n\n---\n\n'
      }
    } catch {}

    const history = getHistory(chatId)
    appendHistory(chatId, { role: 'user', content: query })
    const reply = await askChad(context + query, history)
    appendHistory(chatId, { role: 'assistant', content: reply })
    await ctx.reply(reply)
  } catch (err) {
    console.error('Ошибка:', err)
    await ctx.reply('🙈 Что-то пошло не так. Напиши ещё раз, пожалуйста')
  }
})

bot.launch()
  .then(() => console.log('Бот запущен'))
  .catch((err) => console.error('Ошибка запуска:', err))

process.once('SIGINT', () => bot.stop('SIGINT'))
process.once('SIGTERM', () => bot.stop('SIGTERM'))
