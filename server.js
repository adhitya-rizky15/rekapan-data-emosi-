const express = require('express');
const http = require('http');
const mongoose = require('mongoose');
const socketIo = require('socket.io');
const path = require('path');
const TelegramBot = require('node-telegram-bot-api');
const cron = require('node-cron');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

// === Telegram Bot ===
const BOT_TOKEN = '7500034469:AAGAwCtPQtG8UP6QUp-Y37MPVIzl5eLfTMk';
const bot = new TelegramBot(BOT_TOKEN, { polling: true });
const CHAT_ID = '6219560452';

// === MongoDB ===
mongoose.connect('mongodb://localhost/iot_emosi', {
  useNewUrlParser: true,
  useUnifiedTopology: true
}).then(() => console.log("✅ MongoDB terhubung"))
  .catch(err => console.error("❌ MongoDB error:", err));

const EmosiSchema = new mongoose.Schema({
  emosi: String,
  gesture: Number,
  waktu: { type: Date, default: Date.now }
});
const Emosi = mongoose.model('Emosi', EmosiSchema);

// === Public Folder ===
app.use(express.static(path.join(__dirname, 'public')));

// === API ===
app.get('/data-emosi', async (req, res) => {
  try {
    const { tanggal_awal, tanggal_akhir, jam_awal, jam_akhir } = req.query;
    let filter = {};

    if (tanggal_awal && tanggal_akhir) {
      const start = new Date(`${tanggal_awal}T${jam_awal || '00:00'}:00`);
      const end = new Date(`${tanggal_akhir}T${jam_akhir || '23:59'}:59`);
      filter.waktu = { $gte: start, $lte: end };
    }

    const data = await Emosi.find(filter).sort({ waktu: -1 });
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: 'Gagal mengambil data' });
  }
});

// === Socket.IO ===
let latestGesture = null;

io.on('connection', (socket) => {
  console.log('👤 Client terhubung');

  socket.on('deteksiGesture', (gesture) => {
    latestGesture = gesture;
    console.log('🖐️ Gesture:', gesture);
  });

  socket.on('deteksiEmosi', async (emosi) => {
    const data = new Emosi({ emosi, gesture: latestGesture });
    await data.save();
    console.log(`💾 Disimpan: ${emosi} (gesture: ${latestGesture})`);
  });

  socket.on('disconnect', () => {
    console.log('❌ Client terputus');
  });
});

// === CRON: Rekap Emosi Setiap 10 Menit ===
cron.schedule('*/10 * * * *', async () => {
  const now = new Date();
  const sepuluhMenitLalu = new Date(now.getTime() - 10 * 60 * 1000);

  const data = await Emosi.find({
    waktu: { $gte: sepuluhMenitLalu, $lte: now }
  });

  if (data.length === 0) return;

  const rekap = {};
  data.forEach(d => {
    rekap[d.emosi] = (rekap[d.emosi] || 0) + 1;
  });

  const pesan = `🕒 Rekap Emosi (10 Menit Terakhir)\n${sepuluhMenitLalu.toLocaleTimeString('id-ID')} - ${now.toLocaleTimeString('id-ID')}\n\n` +
    Object.entries(rekap).map(([e, count]) => `• ${e}: ${count}`).join('\n');

  bot.sendMessage(CHAT_ID, pesan);
  console.log('📤 Rekap 10 menit dikirim ke Telegram');
});

// === Perintah Bot Telegram ===
bot.on('message', async (msg) => {
  const chatId = msg.chat.id;
  const text = msg.text.toLowerCase();

  if (text.includes('halo') || text.includes('hai') || text === '/start') {
    bot.sendMessage(chatId, "👋 Hai! Ketik *help* untuk melihat semua perintah yang tersedia.", { parse_mode: 'Markdown' });
  } else if (text === 'help') {
    bot.sendMessage(chatId, `📌 Perintah Tersedia:\n• *info* – Data terakhir yang terekam\n• *total* – Total seluruh data tersimpan\n• *grafik* – Ringkasan emosi 1 jam terakhir\n• *cari [emosi]* – Contoh: cari marah\n• *rekap hari ini* – Ringkasan emosi hari ini\n• *terbanyak* – Emosi yang paling sering muncul hari ini\n• *histori terakhir [jumlah]* – Contoh: histori terakhir 5\n• *tanggal [YYYY-MM-DD]* – Tampilkan emosi hari tertentu`, { parse_mode: 'Markdown' });
  } else if (text === 'total') {
    const total = await Emosi.countDocuments();
    bot.sendMessage(chatId, `📊 Total data emosi tersimpan: *${total}*`, { parse_mode: 'Markdown' });
  } else if (text === 'info') {
    const latest = await Emosi.findOne().sort({ waktu: -1 });
    if (latest) {
      bot.sendMessage(chatId, `🧠 Emosi terakhir:\n• Emosi: ${latest.emosi}\n• Gesture: ${latest.gesture ?? '-'}\n• Waktu: ${latest.waktu.toLocaleString('id-ID')}`);
    } else {
      bot.sendMessage(chatId, "⚠️ Belum ada data emosi tersimpan.");
    }
  } else if (text === 'rekap hari ini') {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const now = new Date();
    const data = await Emosi.find({ waktu: { $gte: today, $lte: now } });
    if (data.length === 0) return bot.sendMessage(chatId, '📭 Tidak ada data hari ini');
    const count = {};
    data.forEach(d => { count[d.emosi] = (count[d.emosi] || 0) + 1 });
    const pesan = '📊 Rekap Emosi Hari Ini:\n' + Object.entries(count).map(([e, c]) => `• ${e}: ${c}`).join('\n');
    bot.sendMessage(chatId, pesan);
  } else if (text.startsWith('cari ')) {
    const kata = text.replace('cari ', '').trim();
    const total = await Emosi.countDocuments({ emosi: kata });
    bot.sendMessage(chatId, `🔍 Emosi *${kata}* ditemukan sebanyak *${total}* kali.`, { parse_mode: 'Markdown' });
  } else if (text === 'terbanyak') {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const now = new Date();
    const data = await Emosi.find({ waktu: { $gte: today, $lte: now } });
    const count = {};
    data.forEach(d => { count[d.emosi] = (count[d.emosi] || 0) + 1 });
    const sorted = Object.entries(count).sort((a, b) => b[1] - a[1]);
    if (sorted.length > 0) {
      bot.sendMessage(chatId, `🏆 Emosi terbanyak hari ini adalah *${sorted[0][0]}* sebanyak *${sorted[0][1]}* kali.`, { parse_mode: 'Markdown' });
    } else {
      bot.sendMessage(chatId, '📭 Tidak ada data hari ini.');
    }
  } else if (text.startsWith('histori terakhir')) {
    const jumlah = parseInt(text.replace('histori terakhir', '').trim()) || 5;
    const data = await Emosi.find().sort({ waktu: -1 }).limit(jumlah);
    if (data.length === 0) return bot.sendMessage(chatId, '📭 Tidak ada data.');
    let msg = `📄 ${jumlah} Data Emosi Terakhir:\n`;
    data.forEach((d, i) => {
      msg += `${i + 1}. ${d.emosi} (🖐️ ${d.gesture ?? '-'}) - ${d.waktu.toLocaleTimeString('id-ID')}\n`;
    });
    bot.sendMessage(chatId, msg);
  } else if (text.startsWith('tanggal ')) {
    const tgl = text.replace('tanggal ', '').trim();
    const awal = new Date(tgl);
    const akhir = new Date(tgl);
    akhir.setHours(23, 59, 59, 999);
    const data = await Emosi.find({ waktu: { $gte: awal, $lte: akhir } });
    if (data.length === 0) return bot.sendMessage(chatId, '📭 Tidak ada data pada tanggal tersebut.');
    const count = {};
    data.forEach(d => { count[d.emosi] = (count[d.emosi] || 0) + 1 });
    const pesan = `📅 Rekap Emosi Tanggal ${tgl}:\n` + Object.entries(count).map(([e, c]) => `• ${e}: ${c}`).join('\n');
    bot.sendMessage(chatId, pesan);
  }
});

// === Jalankan Server ===
server.listen(3000, () => {
  console.log('🚀 Server berjalan di http://localhost:3000');
});
