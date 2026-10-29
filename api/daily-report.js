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

    // Sabit Disiplin Çarpanları (Kasada kaç dolar olursa olsun değişmez)
    // Kasanın %10'u x 20x Kaldıraç
    const TP2_PORTFOLIO_GAIN_PCT = 2.40; // %10 marjin x (%1.20 x 20x) = +%2.40 kasa büyümesi
    const BE_PORTFOLIO_GAIN_PCT = 0.60;  // Yarısı TP1 (+%0.60) ile kapandı = +%0.60 kasa büyümesi
    const STOP_PORTFOLIO_LOSS_PCT = 1.60; // %10 marjin x (%0.80 x 20x) = -%1.60 kasa kaybı

    let totalTrades = 0;
    let tp2Count = 0;
    let tp1OpenCount = 0;
    let beCount = 0;
    let stopCount = 0;
    let waitingOpenCount = 0;

    let totalGainPct = 0;
    let totalLossPct = 0;

    for (const [key, trade] of Object.entries(tradesData)) {
      if (!trade || !trade.createdAt) continue;
      if (trade.createdAt < cutoffTime) continue;

      totalTrades++;

      if (trade.status === 'TP2_HIT') {
        tp2Count++;
        totalGainPct += TP2_PORTFOLIO_GAIN_PCT;
      } else if (trade.status === 'STOPPED') {
        if (trade.tp1Hit) {
          beCount++;
          totalGainPct += BE_PORTFOLIO_GAIN_PCT;
        } else {
          stopCount++;
          totalLossPct += STOP_PORTFOLIO_LOSS_PCT;
        }
      } else if (trade.status === 'OPEN') {
        if (trade.tp1Hit) {
          tp1OpenCount++;
          totalGainPct += BE_PORTFOLIO_GAIN_PCT;
        } else {
          waitingOpenCount++;
        }
      }
    }

    const netPortfolioGrowth = totalGainPct - totalLossPct;
    const evaluatedTrades = tp2Count + beCount + tp1OpenCount + stopCount;
    const successfulTrades = tp2Count + beCount + tp1OpenCount;
    const winRate = evaluatedTrades > 0 ? ((successfulTrades / evaluatedTrades) * 100).toFixed(1) : "0.0";
    const growthSign = netPortfolioGrowth >= 0 ? "+" : "";

    const reportMsg = `🏆 <b>MINEORA SNIPER | ÖZEL SEANS RAPORU</b>\n` +
                      `━━━━━━━━━━━━━━━━━━━━\n` +
                      `⏱️ <b>Filtre:</b> ${periodText}\n` +
                      `💼 <b>Model:</b> Kasanın %10'u | 20x Kaldıraç\n` +
                      `━━━━━━━━━━━━━━━━━━━━\n` +
                      `📊 <b>Toplam İşlem:</b> ${totalTrades}\n` +
                      `🚀 <b>TP 2 Tam Hedef:</b> ${tp2Count} Adet (Kasaya +%${(tp2Count * TP2_PORTFOLIO_GAIN_PCT).toFixed(2)})\n` +
                      `🎯 <b>TP 1 Alınmış (Kârda/Açık):</b> ${tp1OpenCount} Adet\n` +
                      `🛡️ <b>Başa Baş Kapanan:</b> ${beCount} Adet (Risk Sıfırlandı | Kasaya +%${(beCount * BE_PORTFOLIO_GAIN_PCT).toFixed(2)})\n` +
                      `🛑 <b>Disiplin Stopu:</b> ${stopCount} Adet (Kasaya -%${(stopCount * STOP_PORTFOLIO_LOSS_PCT).toFixed(2)})\n` +
                      `⏳ <b>Yeni Açılan (İzlenen):</b> ${waitingOpenCount} Adet\n` +
                      `━━━━━━━━━━━━━━━━━━━━\n` +
                      `🎯 <b>Gerçek Başarı (Win Rate):</b> <b>%${winRate}</b> <i>(${successfulTrades}/${evaluatedTrades} Sonuçlanan)</i>\n` +
                      `📈 <b>KASAYA NET GETİRİ:</b> <b>${growthSign}%${netPortfolioGrowth.toFixed(2)}</b>\n` +
                      `━━━━━━━━━━━━━━━━━━━━\n` +
                      `✨ <i>İşlem başına kasanın %10'u sabit risk modeliyle hesaplanmıştır. Kasa bakiyesi gizlidir.</i>\n` +
                      `⚡ <i>Terminal: <a href="https://mineoragame.com">mineoragame.com</a></i>\n` +
                      `📢 <i>Kanal: <a href="https://t.me/mineorabalina">t.me/mineorabalina</a></i>`;

    await fetch(`https://api.telegram.org/bot${TG_BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: TG_CHANNEL_ID, text: reportMsg, parse_mode: 'HTML' })
    }).catch(() => {});

    return res.status(200).json({
      success: true,
      period: periodText,
      netPortfolioGrowth: `${growthSign}%${netPortfolioGrowth.toFixed(2)}`,
      stats: {
        totalTrades,
        evaluatedTrades,
        successfulTrades,
        winRate: `${winRate}%`,
        tp2Count,
        tp1OpenCount,
        beCount,
        stopCount,
        waitingOpenCount
      }
    });

  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}
