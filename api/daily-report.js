export default async function handler(req, res) {
  try {
    const TG_BOT_TOKEN = "8682225307:AAHaa-hieKBBluU6uZ2_-OgSPxGR7OwMssE";
    const TG_CHANNEL_ID = "-1004404988937";
    const FIREBASE_BASE_URL = "https://mineora-web-default-rtdb.firebaseio.com";

    // Canlı Kasa ve İşlemleri Eşzamanlı Çek
    const [tradesRes, eqRes] = await Promise.all([
      fetch(`${FIREBASE_BASE_URL}/active_trades.json`),
      fetch(`${FIREBASE_BASE_URL}/last_known_equity.json`)
    ]);

    const tradesData = (await tradesRes.json()) || {};
    const liveEquity = parseFloat(await eqRes.json()) || 397; // Canlı borsa kasası

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

    const LEVERAGE = 20;
    const MARGIN_RATIO = 0.10; // Kasanın %10'u
    const CURRENT_MARGIN = parseFloat((liveEquity * MARGIN_RATIO).toFixed(2));

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

      // İşlemin açıldığı andaki gerçek teminatı kullan (yoksa güncel teminatı al)
      const tradeMargin = parseFloat(trade.marginUsed || CURRENT_MARGIN);

      if (trade.status === 'TP2_HIT') {
        tp2Count++;
        // +%1.20 x 20x = +%24 kâr
        totalProfitUsd += tradeMargin * (0.012 * LEVERAGE);
      } else if (trade.status === 'STOPPED') {
        if (trade.tp1Hit) {
          beCount++;
          // TP1 sonrası başabaş: Pozisyonun %50'si nakde geçmişti
          totalProfitUsd += (tradeMargin * 0.5) * (0.006 * LEVERAGE);
        } else {
          stopCount++;
          // Doğrudan Stop: Ortalama -%0.80 x 20x = -%16
          totalLossUsd += tradeMargin * (0.008 * LEVERAGE);
        }
      } else if (trade.status === 'OPEN') {
        if (trade.tp1Hit) {
          tp1OpenCount++;
          totalProfitUsd += tradeMargin * (0.006 * LEVERAGE);
        } else {
          waitingOpenCount++;
        }
      }
    }

    const netPnl = totalProfitUsd - totalLossUsd;
    const evaluatedTrades = tp2Count + beCount + tp1OpenCount + stopCount;
    const successfulTrades = tp2Count + beCount + tp1OpenCount;
    const winRate = evaluatedTrades > 0 ? ((successfulTrades / evaluatedTrades) * 100).toFixed(1) : "0.0";
    const pnlSign = netPnl >= 0 ? "+" : "";

    // Kasa büyümesini mevcut canlı kasaya oranla
    const walletGrowthPct = liveEquity > 0 ? ((netPnl / liveEquity) * 100).toFixed(2) : "0.00";
    const growthSign = netPnl >= 0 ? "+" : "";

    const reportMsg = `🏆 <b>MINEORA SNIPER | ÖZEL SEANS RAPORU</b>\n` +
                      `━━━━━━━━━━━━━━━━━━━━\n` +
                      `⏱️ <b>Filtre:</b> ${periodText}\n` +
                      `💼 <b>Model:</b> Kasanın %10'u ($${CURRENT_MARGIN} / Kasa: $${liveEquity.toFixed(1)}) | ${LEVERAGE}x Kaldıraç\n` +
                      `━━━━━━━━━━━━━━━━━━━━\n` +
                      `📊 <b>Toplam İşlem:</b> ${totalTrades}\n` +
                      `🚀 <b>TP 2 Tam Hedef:</b> ${tp2Count} Adet (+$${totalProfitUsd.toFixed(2)})\n` +
                      `🎯 <b>TP 1 Alınmış (Kârda/Açık):</b> ${tp1OpenCount} Adet\n` +
                      `🛡️ <b>Başa Baş Kapanan:</b> ${beCount} Adet (Risk Sıfırlandı)\n` +
                      `🛑 <b>Disiplin Stopu:</b> ${stopCount} Adet (-$${totalLossUsd.toFixed(2)})\n` +
                      `⏳ <b>Yeni Açılan (İzlenen):</b> ${waitingOpenCount} Adet\n` +
                      `━━━━━━━━━━━━━━━━━━━━\n` +
                      `🎯 <b>Gerçek Başarı (Win Rate):</b> <b>%${winRate}</b> <i>(${successfulTrades}/${evaluatedTrades} Sonuçlanan)</i>\n` +
                      `📈 <b>Kasa Büyümesi:</b> <b>${growthSign}%${walletGrowthPct}</b>\n` +
                      `💰 <b>KASAYA NET NAKİT GİRİŞİ:</b> <b>${pnlSign}$${netPnl.toFixed(2)}</b>\n` +
                      `━━━━━━━━━━━━━━━━━━━━\n` +
                      `✨ <i>İşlem başına kasanın %10'u ($${CURRENT_MARGIN}) canlı bakiye disiplini ile hesaplanmıştır.</i>\n` +
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
      liveEquity,
      marginUsed: CURRENT_MARGIN,
      stats: {
        totalTrades,
        evaluatedTrades,
        successfulTrades,
        winRate: `${winRate}%`,
        walletGrowth: `${growthSign}%${walletGrowthPct}`,
        tp2Count,
        tp1OpenCount,
        beCount,
        stopCount,
        waitingOpenCount,
        netPnl: `${pnlSign}$${netPnl.toFixed(2)}`
      }
    });

  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}
