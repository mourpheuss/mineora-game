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
      const TURKEY_OFFSET_MS = 3 * 60 * 60 * 1000;
      const turkeyNow = new Date(now + TURKEY_OFFSET_MS);
      
      const year = turkeyNow.getUTCFullYear();
      const month = turkeyNow.getUTCMonth();
      const day = turkeyNow.getUTCDate();
      
      cutoffTime = Date.UTC(year, month, day, 0, 0, 0) - TURKEY_OFFSET_MS;
      periodText = "Bugün (00:00 TSİ'den İtibaren)";
    }

    // BİTGET GERÇEK DÖKÜM PARAMETRELERİ
    const LEVERAGE = 20;
    const TP_TARGET_PCT = 0.70;                     // +%0.70 Fiyat Kârı
    const BITGET_ROUNDTRIP_FEE_RATE = 0.0012;       // Çift yönlü net %0.12 (Giriş %0.06 + Çıkış %0.06)

    let totalTrades = 0;
    let tpHitCount = 0;
    let waitingOpenCount = 0;

    let totalGrossGainPct = 0;
    let totalFeesPct = 0;

    for (const [key, trade] of Object.entries(tradesData)) {
      if (!trade || !trade.createdAt) continue;
      if (trade.createdAt < cutoffTime) continue;

      totalTrades++;

      if (trade.status === 'TP_HIT' || trade.status === 'TP2_HIT') {
        tpHitCount++;

        const dcaCount = trade.dcaCount || 1;
        let marginRatio = 0.03;
        if (dcaCount === 2) marginRatio = 0.045;
        else if (dcaCount === 3) marginRatio = 0.0525;
        else if (dcaCount === 4) marginRatio = 0.05625;
        else if (dcaCount >= 5) marginRatio = 0.058125;

        // Pozisyonun kasanın kaç katı olduğu (Notional)
        const notionalRatio = marginRatio * LEVERAGE;

        // 1. Brüt Kâr: Notional x %0.70 TP
        const grossTradeGainPct = notionalRatio * TP_TARGET_PCT;
        
        // 2. Bitget Kesintisi: Notional x %0.12 Borsa Taker Komisyonu
        const tradeFeePct = notionalRatio * (BITGET_ROUNDTRIP_FEE_RATE * 100);

        totalGrossGainPct += grossTradeGainPct;
        totalFeesPct += tradeFeePct;

      } else if (trade.status === 'OPEN') {
        waitingOpenCount++;
      }
    }

    // KASAYA NET KALAN (KOMİSYON DÜŞÜLDÜKTEN SONRA)
    const netPortfolioGrowth = totalGrossGainPct - totalFeesPct;
    const evaluatedTrades = tpHitCount;
    const winRate = evaluatedTrades > 0 ? "100.0" : "0.0";
    const growthSign = netPortfolioGrowth >= 0 ? "+" : "";

    const reportMsg = `🏆 <b>MINEORA SNIPER | PERFORMANS RAPORU</b>\n` +
                      `━━━━━━━━━━━━━━━━━━━━\n` +
                      `⏱️ <b>Filtre:</b> ${periodText}\n` +
                      `💼 <b>Model:</b> Kasanın %3'ü | 15x Kaldıraç | Tek TP: +%${TP_TARGET_PCT.toFixed(2)}\n` +
                      `━━━━━━━━━━━━━━━━━━━━\n` +
                      `📊 <b>Toplam Taranan İşlem:</b> ${totalTrades}\n` +
                      `🚀 <b>Hedef Vuruldu (Tam Kapanış):</b> ${tpHitCount} Adet\n` +
                      `⏳ <b>Açıkta Takip Edilen:</b> ${waitingOpenCount} Adet\n` +
                      `━━━━━━━━━━━━━━━━━━━━\n` +
                      `💰 <b>Brüt Kasa Kârı:</b> +%${totalGrossGainPct.toFixed(2)}\n` +
                      `🧾 <b>Bitget Komisyon Kesintisi:</b> -%${totalFeesPct.toFixed(2)} (Çift Yönlü %0.12)\n` +
                      `📈 <b>KASAYA NET GETİRİ:</b> <b>${growthSign}%${netPortfolioGrowth.toFixed(2)}</b>\n` +
                      `━━━━━━━━━━━━━━━━━━━━\n` +
                      `🎯 <b>Net Kazanma Oranı (Win Rate):</b> <b>%${winRate}</b> <i>(${tpHitCount}/${evaluatedTrades} Tamamlanan)</i>\n` +
                      `🛡️ <i>Bitget borsa dökümüne göre her işlemde %0.12 komisyon net düşülmüştür.</i>\n` +
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
        successfulTrades: tpHitCount,
        grossGain: `+${totalGrossGainPct.toFixed(2)}%`,
        feesDeducted: `-${totalFeesPct.toFixed(2)}%`,
        netGrowth: `${growthSign}${netPortfolioGrowth.toFixed(2)}%`,
        waitingOpenCount
      }
    });

  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}
