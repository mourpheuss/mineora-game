export default async function handler(req, res) {
  try {
    const TG_BOT_TOKEN = "8682225307:AAHaa-hieKBBluU6uZ2_-OgSPxGR7OwMssE";
    const TG_CHANNEL_ID = "-1004404988937";
    const FIREBASE_BASE_URL = "https://mineora-web-default-rtdb.firebaseio.com";

    // 1. Firebase'den Tüm İşlemleri Çek
    const tradesRes = await fetch(`${FIREBASE_BASE_URL}/active_trades.json`);
    const tradesData = (await tradesRes.json()) || {};

    const now = Date.now();

    // 2. Dinamik Saat Filtresi (Örn: ?hours=9 veya doğrudan Gece 00:00'dan İtibaren)
    const { hours } = req.query;
    let cutoffTime;
    let periodText;

    if (hours) {
      const h = parseFloat(hours);
      cutoffTime = now - (h * 60 * 60 * 1000);
      periodText = `Son ${h} Saat (Yeni Sistem)`;
    } else {
      // Varsayılan: Bugünün Gece Yarısı 00:00'dan (TSİ) İtibaren
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      cutoffTime = today.getTime();
      periodText = "Bugün (00:00'dan İtibaren)";
    }

    // Model Parametreleri: 20$ Marjin / 20x Kaldıraç
    const MARGIN = 20;
    const LEVERAGE = 20;

    let totalTrades = 0;
    let tp2Count = 0;
    let beCount = 0;
    let stopCount = 0;
    let openCount = 0;

    let totalProfitUsd = 0;
    let totalLossUsd = 0;

    for (const [key, trade] of Object.entries(tradesData)) {
      if (!trade || !trade.createdAt) continue;

      // Belirlenen saat filtresinden eski işlemleri atla
      if (trade.createdAt < cutoffTime) continue;

      totalTrades++;

      if (trade.status === 'TP2_HIT') {
        tp2Count++;
        totalProfitUsd += MARGIN * (0.012 * LEVERAGE); // +%24 kâr (+$4.80)
      } else if (trade.status === 'STOPPED') {
        if (trade.tp1Hit) {
          beCount++;
          // Başa baş: $0.00
        } else {
          stopCount++;
          totalLossUsd += MARGIN * (0.008 * LEVERAGE); // -%16 zarar (-$3.20)
        }
      } else if (trade.status === 'OPEN') {
        openCount++;
      }
    }

    const netPnl = totalProfitUsd - totalLossUsd;
    const closedTrades = tp2Count + beCount + stopCount;
    const winTrades = tp2Count + beCount;
    const winRate = closedTrades > 0 ? ((winTrades / closedTrades) * 100).toFixed(1) : "0.0";
    const pnlSign = netPnl >= 0 ? "+" : "";

    const reportMsg = `🏆 <b>MINEORA SNIPER | ÖZEL SEANS RAPORU</b>\n` +
                      `━━━━━━━━━━━━━━━━━━━━\n` +
                      `⏱️ <b>Filtre:</b> ${periodText}\n` +
                      `💼 <b>Hesaplanan Model:</b> $${MARGIN} Teminat | ${LEVERAGE}x Kaldıraç\n` +
                      `━━━━━━━━━━━━━━━━━━━━\n` +
                      `📊 <b>Toplam İşlem:</b> ${totalTrades}\n` +
                      `🚀 <b>TP 2 Tam Hedef:</b> ${tp2Count} Adet (+$${totalProfitUsd.toFixed(2)})\n` +
                      `🛡️ <b>Başa Baş Korunan:</b> ${beCount} Adet ($0.00 Risk SIFIR)\n` +
                      `🛑 <b>Disiplin Stopu:</b> ${stopCount} Adet (-$${totalLossUsd.toFixed(2)})\n` +
                      `⏳ <b>Aktif İzlenen:</b> ${openCount} Adet\n` +
                      `━━━━━━━━━━━━━━━━━━━━\n` +
                      `🎯 <b>Kayıpsız Tamamlama Oranı:</b> <b>%${winRate}</b>\n` +
                      `💰 <b>KASAYA NET NAKİT GİRİŞİ:</b> <b>${pnlSign}$${netPnl.toFixed(2)}</b>\n` +
                      `━━━━━━━━━━━━━━━━━━━━\n` +
                      `✨ <i>Gece güncellemesi sonrası net performans dökümüdür.</i>\n` +
                      `⚡ <i>Terminal: <a href="https://mineoragame.com">mineoragame.com</a></i>\n` +
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
      period: periodText,
      stats: { totalTrades, tp2Count, beCount, stopCount, netPnl }
    });

  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}
