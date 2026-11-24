export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Yalnızca POST istekleri kabul edilir.' });
  }

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;

    if (!body || body.secret !== 'MINEORA_TV_2026') {
      return res.status(401).json({ error: 'Yetkisiz Webhook isteği.' });
    }

    const TG_BOT_TOKEN = "8682225307:AAHaa-hieKBBluU6uZ2_-OgSPxGR7OwMssE";
    const TG_CHANNEL_ID = "-1004404988937";
    const TG_ADMIN_ID = "6457294906";
    const FIREBASE_BASE_URL = "https://mineora-web-default-rtdb.firebaseio.com";

    const direction = body.direction === 'BUY' ? 'BUY' : 'SELL';
    const isBuy = direction === 'BUY';
    const entry = parseFloat(body.entry);
    const tp = parseFloat(body.tp);
    const sl = parseFloat(body.sl);
    const ema60 = parseFloat(body.ema60 || entry);
    const level = parseFloat(body.level || entry);
    const wick = parseFloat(body.wick || entry);
    const lotSize = parseFloat(body.lotSize || 0.20);

    const signalId = `gold_${Date.now()}`;
    const newSignal = {
      id: signalId,
      symbol: "GOLD24-7",
      source: "TRADINGVIEW_OANDA",
      direction,
      lotSize,
      entry,
      tp,
      sl,
      ema60,
      level,
      wick,
      status: "OPEN",
      vpsExecuted: false,
      createdAt: Date.now()
    };

    await Promise.all([
      fetch(`${FIREBASE_BASE_URL}/gold_signals/${signalId}.json`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newSignal)
      }),
      fetch(`${FIREBASE_BASE_URL}/last_gold_signal_ts.json`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(Date.now())
      })
    ]);

    const entryMsg =
      `🏆 <b>XAUUSD (GOLD) | TRADINGVIEW SİNYALİ</b>\n` +
      `━━━━━━━━━━━━━━━━━━━━\n` +
      `🧭 <b>İşlem Yönü:</b> ${isBuy ? '🟢 BUY (LONG)' : '🔴 SELL (SHORT)'}\n` +
      `🧱 <b>Avlanan Seviye:</b> <code>$${level.toFixed(2)}</code> (İğne: $${wick.toFixed(2)})\n` +
      `📊 <b>EMA 60:</b> <code>$${ema60.toFixed(2)}</code>\n` +
      `━━━━━━━━━━━━━━━━━━━━\n` +
      `💵 <b>Giriş Fiyatı:</b> <code>$${entry.toFixed(2)}</code>\n` +
      `🎯 <b>Hedef TP (+$4.00):</b> <code>$${tp.toFixed(2)}</code>\n` +
      `🛑 <b>Stop-Loss (-$10.00):</b> <code>$${sl.toFixed(2)}</code>\n` +
      `⚖️ <b>Lot:</b> ${lotSize.toFixed(2)} Lot\n` +
      `━━━━━━━━━━━━━━━━━━━━\n` +
      `🤖 <i>Sinyal Firebase'e iletildi; TP/SL takibi ve PC MT5 köprüsü aktif.</i>`;

    for (const target of [TG_CHANNEL_ID, TG_ADMIN_ID]) {
      await fetch(`https://api.telegram.org/bot${TG_BOT_TOKEN}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: target, text: entryMsg, parse_mode: 'HTML' })
      }).catch(() => {});
    }

    return res.status(200).json({ success: true, signalId });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}
