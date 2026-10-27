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

    // Sabit Model: Kasanın %10'u = 200$ Teminat / 20x Kaldıraç ($4.000 Pozisyon Hacmi)
    const TOTAL_WALLET = 2000;
    const MARGIN = 200;
    const LEVERAGE = 20;

    let totalTrades = 0;
    let tp2Count = 0;
    let tp1OpenCount = 0;     // TP1 vurulmuş, TP2 bekleyen risksiz açık işlemler
    let beCount = 0;           // TP1 sonrası başabaş kapananlar
    let stopCount = 0;         // Doğrudan stop olanlar
    let waitingOpenCount = 0;  // Henüz TP1 almamış yeni açık işlemler

    let totalProfitUsd = 0;
    let totalLossUsd = 0;

    for (const [key, trade] of Object.entries(tradesData)) {
      if (!trade || !trade.createdAt) continue;
      if (trade.createdAt < cutoffTime) continue;

      totalTrades++;

      if (trade.status === 'TP2_HIT') {
        tp2Count++;
        // +%1.20 fiyat hareketi x 20x = +%24 kâr -> $200 * 0.24 = +$48.00
        totalProfitUsd += MARGIN * (0.012 * LEVERAGE);
      } else if (trade.status === 'STOPPED') {
        if (trade.tp1Hit) {
          beCount++;
          // TP1'de pozisyonun yarısı kapatıldıysa: $100 * (0.006 * 20) = +$12.00 cepte
          totalProfitUsd += (MARGIN * 0.5) * (0.006 * LEVERAGE);
        } else {
          stopCount++;
          // Doğrudan Stop: -%0.80 x 20x = -%16 -> $200 * 0.16 = -$32.00
          totalLossUsd += MARGIN * (0.008 * LEVERAGE);
        }
      } else if (trade.status === 'OPEN') {
        if (trade.tp1Hit) {
          tp1OpenCount++;
          // TP1 vuruldu, stop girişte: +%0.60 x 20x = +%12 -> $200 * 0.12 = +$24.00 ara kâr
          totalProfitUsd += MARGIN * (0.006 * LEVERAGE);
        } else {
          waitingOpenCount++;
        }
      }
    }

    const netPnl = totalProfitUsd - totalLossUsd;

    // Gerçek Win Rate: Henüz tetiği çekilmemiş açıklar hariç tutulur
    const evaluatedTrades = tp2Count + beCount + tp1OpenCount + stopCount;
    const successfulTrades = tp2Count + beCount + tp1OpenCount;
    const winRate = evaluatedTrades > 0 ? ((successfulTrades / evaluatedTrades) * 100).toFixed(1) : "0.0";
    const pnlSign = netPnl >= 0 ? "+" : "";

    // Kasaya net yüzde büyüme oranı
    const walletGrowthPct = ((netPnl / TOTAL_WALLET) * 100).toFixed(2);
    const growthSign = netPnl >= 0 ? "+" : "";

    const reportMsg = `🏆 <b>MINEORA SNIPER | ÖZEL SEANS RAPORU</b>\n` +
                      `━━━━━━━━━━━━━━━━━━━━\n` +
                      `⏱️ <b>Filtre:</b> ${periodText}\n` +
                      `💼 <b>Model:</b> Kasanın %10'u ($${MARGIN}) | ${LEVERAGE}x Kaldıraç\n` +
                      `━━━━━━━━━━━━━━━━━━━━\n` +
                      `📊 <b>Toplam İşlem:</b> ${totalTrades}\n` +
                      `🚀 <b>TP 2 Tam Hedef:</b> ${tp2Count} Adet (+$${(tp2Count * MARGIN * 0.012 * LEVERAGE).toFixed(2)})\n` +
                      `🎯 <b>TP 1 Alınmış (Kârda/Açık):</b> ${tp1OpenCount} Adet (+$${(tp1OpenCount * MARGIN * 0.006 * LEVERAGE).toFixed(2)})\n` +
                      `🛡️ <b>Başa Baş Kapanan:</b> ${beCount} Adet (Risk Sıfırlandı)\n` +
                      `🛑 <b>Disiplin Stopu:</b> ${stopCount} Adet (-$${totalLossUsd.toFixed(2)})\n` +
                      `⏳ <b>Yeni Açılan (İzlenen):</b> ${waitingOpenCount} Adet\n` +
                      `━━━━━━━━━━━━━━━━━━━━\n` +
                      `🎯 <b>Gerçek Başarı (Win Rate):</b> <b>%${winRate}</b> <i>(${successfulTrades}/${evaluatedTrades} Sonuçlanan)</i>\n` +
                      `📈 <b>Kasa Büyümesi:</b> <b>${growthSign}%${walletGrowthPct}</b>\n` +
                      `💰 <b>KASAYA NET NAKİT GİRİŞİ:</b> <b>${pnlSign}$${netPnl.toFixed(2)}</b>\n` +
                      `━━━━━━━━━━━━━━━━━━━━\n` +
                      `✨ <i>İşlem başına kasanın %10'u ($200) risk disiplini ile modellenmiştir.</i>\n` +
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
      marginUsed: MARGIN,
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
