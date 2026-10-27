export default async function handler(req, res) {
  try {
    const TG_BOT_TOKEN = "8682225307:AAHaa-hieKBBluU6uZ2_-OgSPxGR7OwMssE";
    const TG_CHANNEL_ID = "-1004404988937"; // Sinyal VIP Kanalı
    const FIREBASE_BASE_URL = "https://mineora-web-default-rtdb.firebaseio.com";

    // 1. Firebase'den Tüm İşlemleri Çek
    const tradesRes = await fetch(`${FIREBASE_BASE_URL}/active_trades.json`);
    const tradesData = (await tradesRes.json()) || {};

    const now = Date.now();
    const ONE_DAY_MS = 24 * 60 * 60 * 1000;

    // Model Parametreleri: 20$ Marjin / 20x Kaldıraç
    const MARGIN = 20;
    const LEVERAGE = 20;

    let totalTrades = 0;
    let tp2Count = 0;
    let beCount = 0; // Başa baş korunan
    let stopCount = 0;
    let openCount = 0;

    let totalProfitUsd = 0;
    let totalLossUsd = 0;

    for (const [key, trade] of Object.entries(tradesData)) {
      if (!trade || !trade.createdAt) continue;

      // Son 24 saat filtresi
      if (now - trade.createdAt > ONE_DAY_MS) continue;

      totalTrades++;

      if (trade.status === 'TP2_HIT') {
        tp2Count++;
        // +%1.20 fiyat hareketi x 20x kaldıraç = +%24 kâr (İşlem başına +$4.80)
        totalProfitUsd += MARGIN * (0.012 * LEVERAGE);
      } else if (trade.status === 'STOPPED') {
        if (trade.tp1Hit) {
          beCount++;
          // Başa baş korundu: $0.00
        } else {
          stopCount++;
          // Ortalama -%0.80 fiyat hareketi x 20x kaldıraç = -%16 zarar (İşlem başına -$3.20)
          totalLossUsd += MARGIN * (0.008 * LEVERAGE);
        }
      } else if (trade.status === 'OPEN') {
        openCount++;
      }
    }

    const netPnl = totalProfitUsd - totalLossUsd;
    const closedTrades = tp2Count + beCount + stopCount;
    const winTrades = tp2Count + beCount; // Kayıpsız tamamlananlar
    const winRate = closedTrades > 0 ? ((winTrades / closedTrades) * 100).toFixed(1) : "0.0";
    const pnlSign = netPnl >= 0 ? "+" : "";

    const reportMsg = `🏆 <b>MINEORA SNIPER | GÜNLÜK VIP PERFORMANS RAPORU</b>\n` +
                      `━━━━━━━━━━━━━━━━━━━━\n` +
                      `⏱️ <b>Dönem:</b> Son 24 Saatlik Seans\n` +
                      `💼 <b>Hesaplanan Model:</b> $${MARGIN} Sabit Teminat | ${LEVERAGE}x Kaldıraç\n` +
                      `━━━━━━━━━━━━━━━━━━━━\n` +
                      `📊 <b>Toplam Üretilen Sinyal:</b> ${totalTrades}\n` +
                      `🚀 <b>TP 2 Tam Hedef:</b> ${tp2Count} Adet (+$${totalProfitUsd.toFixed(2)})\n` +
                      `🛡️ <b>Başa Baş Korunan:</b> ${beCount} Adet ($0.00 Risk SIFIR)\n` +
                      `🛑 <b>Disiplin Stopu:</b> ${stopCount} Adet (-$${totalLossUsd.toFixed(2)})\n` +
                      `⏳ <b>Aktif İzlenen:</b> ${openCount} Adet\n` +
                      `━━━━━━━━━━━━━━━━━━━━\n` +
                      `🎯 <b>Kayıpsız Tamamlama (Win Rate):</b> <b>%${winRate}</b>\n` +
                      `💰 <b>KASAYA NET NAKİT GİRİŞİ:</b> <b>${pnlSign}$${netPnl.toFixed(2)}</b>\n` +
                      `━━━━━━━━━━━━━━━━━━━━\n` +
                      `✨ <i>Sniper Likidite algoritması ile sermaye korunur, kâr katlanır.</i>\n` +
                      `⚡ <i>Canlı Terminal: <a href="https://mineoragame.com">mineoragame.com</a></i>\n` +
                      `📢 <i>Kanal: <a href="https://t.me/mineorabalina">t.me/mineorabalina</a></i>`;

    // VIP Kanalına Mesaj Gönder
    const tgRes = await fetch(`https://api.telegram.org/bot${TG_BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: TG_CHANNEL_ID, text: reportMsg, parse_mode: 'HTML' })
    });
    const tgData = await tgRes.json();

    return res.status(200).json({
      success: true,
      channel_sent: tgData.ok,
      stats: { totalTrades, tp2Count, beCount, stopCount, netPnl }
    });

  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}
