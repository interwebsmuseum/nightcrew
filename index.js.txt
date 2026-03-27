import { Telegraf } from 'telegraf'
import dotenv from 'dotenv'

dotenv.config()

const bot = new Telegraf(process.env.BOT_TOKEN)

const CA = process.env.CA || "PASTE_CA_HERE"
const X_LINK = process.env.X_LINK || "PASTE_X_LINK_HERE"

bot.start((ctx) => {
  ctx.reply('Welcome to the Interwebs Museum.\n\nType "CA" or "X" to begin.')
})

bot.hears(/ca|contract/i, (ctx) => {
  ctx.reply(`Contract Address:\n${CA}`)
})

bot.hears(/x|twitter/i, (ctx) => {
  ctx.reply(`Follow updates:\n${X_LINK}`)
})

bot.hears(/artifact|drop/i, (ctx) => {
  ctx.reply('Latest Artifact:\nARCHIVE #001 — The First Count\n\nObserve the origin.')
})

bot.launch()

process.once('SIGINT', () => bot.stop('SIGINT'))
process.once('SIGTERM', () => bot.stop('SIGTERM'))
