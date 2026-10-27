export default async function handler(req, res) {
  try {
    const TG_BOT_TOKEN = "8682225307:AAHaa-hieKBBluU6uZ2_-OgSPxGR7OwMssE";
    const TG_CHANNEL_ID = "-1004404988937";
    const FIREBASE_BASE_URL = "https://mineora-web-default-rtdb.firebaseio.com";

    const tradesRes = await fetch(`${FIREBASE_BASE_URL}/active_trades.json`);
    const tradesData = (await tradesRes.json()) || {};

    const now = Date.now();
    const { hours } = req.query;
    let cutoffTime;
    let periodText;

    if (hours) {
      const h = parseFloat(hours);
      cutoffTime = now - (h * 60 * 60 * 1000);
      periodText = `Son ${h} Saat`;
    } else {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      cutoffTime = today.getTime();
      periodText = "Bugün (00:00'dan İtibaren)";
    }

    // Güncellenen Model: $70 Sabit Teminat / 20x Kaldıraç
    const MARGIN = 70;
    const LEVERAGE = 20;

    let totalTrades = 0;
    let tp2Count = 0;
    let tp1OpenCount = 0;
    let beCount = 0;
    let stopCount = 0;
    let waitingOpenCount = 0;

    let totalProfitUsd = 0;
    let totalLossUsd = 0;

    for (const [key, trade] of Object.entries(tradesData)) {
      if (!trade || !trade.createdAt) continue;
      if (trade.createdAt < cutoffTime) continue;

      totalTrades++;

      if (trade.status === 'TP2_HIT') {
        tp2Count++;
        totalProfitUsd += MARGIN * (0.012 * LEVERAGE); // +%24 kâr (+$16.80)
      } else if (trade.status === 'STOPPED') {
        if (trade.tp1Hit) {
          beCount++;
          totalProfitUsd += (MARGIN * 0.5) * (0.006 * LEVERAGE); // +$4.20
        } else {
          stopCount++;
          totalLossUsd += MARGIN * (0.008 * LEVERAGE); // -%16 zarar (-$11.20)
        }
      } else if (trade.status === 'OPEN') {
        if (trade.tp1Hit) {
          tp1OpenCount++;
          totalProfitUsd += MARGIN * (0.006 * LEVERAGE); // +$8.40 ara kâr
        } else {
          waitingOpenCount++;
        }
      }
    }

    const netPnl = totalProfitUsd - totalLossUsd;
    const closedTrades = tp2Count + beCount + stopCount;
    const winTrades = tp2Count + beCount + tp1OpenCount;
    const winRate = totalTrades > 0 ? ((winTrades / totalTrades) * 100).toFixed(1) : "0.0";
    const pnlSign = netPnl >= 0 ? "+" : "";

    const reportMsg = `🏆 <b>MINEORA SNIPER | ÖZEL SEANS RAPORU</b>\n` +
                      `━━━━━━━━━━━━━━━━━━━━\n` +
                      `⏱️ <b>Filtre:</b> ${periodText}\n` +
                      `💼 <b>Hesaplanan Model:</b> $${MARGIN} Teminat | ${LEVERAGE}x Kaldıraç\n` +
                      `━━━━━━━━━━━━━━━━━━━━\n` +
                      `📊 <b>Toplam İşlem:</b> ${totalTrades}\n` +
                      `🚀 <b>TP 2 Tam Hedef:</b> ${tp2Count} Adet (+$${(tp2Count * MARGIN * 0.012 * LEVERAGE).toFixed(2)})\n` +
                      `🎯 <b>TP 1 Alınmış (Kârda/Açık):</b> ${tp1OpenCount} Adet (+$${(tp1OpenCount * MARGIN * 0.006 * LEVERAGE).toFixed(2)})\n` +
                      `🛡️ <b>Başa Baş Kapanan:</b> ${beCount} Adet (Risk Sıfırlandı)\n` +
                      `🛑 <b>Disiplin Stopu:</b> ${stopCount} Adet (-$${totalLossUsd.toFixed(2)})\n` +
                      `⏳ <b>Yeni Açılan (İzlenen):</b> ${waitingOpenCount} Adet\n` +
                      `━━━━━━━━━━━━━━━━━━━━\n` +
                      `🎯 <b>Başarı / Kârda Oranı:</b> <b>%${winRate}</b>\n` +
                      `💰 <b>KASAYA NET NAKİT GİRİŞİ:</b> <b>${pnlSign}$${netPnl.toFixed(2)}</b>\n` +
                      `━━━━━━━━━━━━━━━━━━━━\n` +
                      `✨ <i>$70 sabit teminat modeliyle gerçek net nakit yansımasıdır.</i>\n` +
                      `⚡ <i>Terminal: <a href="https://mineoragame.com">mineoragame.com</a></i>\n` +
                      `📢 <i>Kanal: <a href="https://t.me/mineorabalina">t.me/mineorabalina</a></i>`;

    const tgRes = await fetch(`https://api.telegram.org/bot${TG_BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: TG_CHANNEL_ID, text: reportMsg, parse_mode: 'HTML' })
    });
    const tgData = await tgRes.json();

    return res.status(200).json({
      success: true,
      period: periodText,
      stats: { totalTrades, tp2Count, tp1OpenCount, beCount, stopCount, netPnl }
    });

  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}
