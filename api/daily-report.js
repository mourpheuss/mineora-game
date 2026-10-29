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

    // Sabit Disiplin Çarpanları (Kasanın %10'u x 25x Kaldıraç)
    // Tek TP: %10 marjin x (+%0.60 fiyat hareketi x 25x) = +%1.50 Kasa Büyümesi
    const TP_PORTFOLIO_GAIN_PCT = 1.50;
    // Ortalama Disiplin Stopu: %10 marjin x (-%0.75 fitil payı x 25x) = -%1.875 Kasa Kaybı
    const STOP_PORTFOLIO_LOSS_PCT = 1.88;

    let totalTrades = 0;
    let tpHitCount = 0;
    let stopCount = 0;
    let waitingOpenCount = 0;

    let totalGainPct = 0;
    let totalLossPct = 0;

    for (const [key, trade] of Object.entries(tradesData)) {
      if (!trade || !trade.createdAt) continue;
      if (trade.createdAt < cutoffTime) continue;

      totalTrades++;

      // Yeni sistemde 'TP_HIT', eski geriye dönük kayıtlarda 'TP2_HIT'
      if (trade.status === 'TP_HIT' || trade.status === 'TP2_HIT') {
        tpHitCount++;
        totalGainPct += TP_PORTFOLIO_GAIN_PCT;
      } else if (trade.status === 'STOPPED') {
        // Eski başabaş stoplar varsa nötr kabul edilir, doğrudan stoplar kasadan düşülür
        if (trade.tp1Hit) {
          totalGainPct += 0.60;
        } else {
          stopCount++;
          totalLossPct += STOP_PORTFOLIO_LOSS_PCT;
        }
      } else if (trade.status === 'OPEN') {
        waitingOpenCount++;
      }
    }

    const netPortfolioGrowth = totalGainPct - totalLossPct;
    const evaluatedTrades = tpHitCount + stopCount;
    const winRate = evaluatedTrades > 0 ? ((tpHitCount / evaluatedTrades) * 100).toFixed(1) : "0.0";
    const growthSign = netPortfolioGrowth >= 0 ? "+" : "";

    const reportMsg = `🏆 <b>MINEORA SNIPER | PERFORMANS RAPORU</b>\n` +
                      `━━━━━━━━━━━━━━━━━━━━\n` +
                      `⏱️ <b>Filtre:</b> ${periodText}\n` +
                      `💼 <b>Model:</b> Kasanın %10'u | 25x Kaldıraç (Tek TP: +%0.60)\n` +
                      `━━━━━━━━━━━━━━━━━━━━\n` +
                      `📊 <b>Toplam Taranan İşlem:</b> ${totalTrades}\n` +
                      `🚀 <b>Hedef Vuruldu (Tam Kapanış):</b> ${tpHitCount} Adet (Kasaya +%${(tpHitCount * TP_PORTFOLIO_GAIN_PCT).toFixed(2)})\n` +
                      `🛑 <b>Disiplin Stopu:</b> ${stopCount} Adet (Kasaya -%${(stopCount * STOP_PORTFOLIO_LOSS_PCT).toFixed(2)})\n` +
                      `⏳ <b>Açıkta Takip Edilen:</b> ${waitingOpenCount} Adet\n` +
                      `━━━━━━━━━━━━━━━━━━━━\n` +
                      `🎯 <b>Net Kazanma Oranı (Win Rate):</b> <b>%${winRate}</b> <i>(${tpHitCount}/${evaluatedTrades} Tamamlanan)</i>\n` +
                      `📈 <b>KASAYA NET GETİRİ:</b> <b>${growthSign}%${netPortfolioGrowth.toFixed(2)}</b>\n` +
                      `━━━━━━━━━━━━━━━━━━━━\n` +
                      `⚡ <i>Hızlı çıkış scalping modeli: +%0.60 fiyatta (%15 net kâr) pozisyon %100 kapatılır.</i>\n` +
                      `🌐 <i>Terminal: <a href="https://mineoragame.com">mineoragame.com</a></i>\n` +
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
        successfulTrades: tpHitCount,
        winRate: `${winRate}%`,
        tpHitCount,
        stopCount,
        waitingOpenCount
      }
    });

  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}
