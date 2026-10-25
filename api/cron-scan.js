export default async function handler(req, res) {
  try {
    const browserHeaders = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
      'Accept': 'application/json'
    };

    const TG_BOT_TOKEN = "8682225307:AAHaa-hieKBBluU6uZ2_-OgSPxGR7OwMssE";
    const TG_CHANNEL_ID = "-1004404988937"; // Mineora Balina Sinyal VIP Kanalı
    const TG_ADMIN_ID = "6457294906";     // Mourpheus Özel
    const FIREBASE_BASE_URL = "https://mineora-web-default-rtdb.firebaseio.com";
    const THREE_HOURS_MS = 3 * 60 * 60 * 1000;
    const now = Date.now();

    // 1. Bitget Vadeli Ticker Verilerini Çek
    const tickersRes = await fetch("https://api.bitget.com/api/v2/mix/market/tickers?productType=USDT-FUTURES", { headers: browserHeaders });
    const tickersJson = await tickersRes.json();

    if (tickersJson.code !== '00000' || !Array.isArray(tickersJson.data)) {
      return res.status(500).json({ error: "Bitget piyasa verisi alınamadı." });
    }

    // Ana coinleri hariç tut, kurumsal hacim filtresi (1.5M+ USDT)
    const EXCLUDED = ["BTCUSDT", "ETHUSDT", "SOLUSDT", "BNBUSDT", "XRPUSDT", "DOGEUSDT", "USDCUSDT"];
    const pool = tickersJson.data.filter(t => 
      t.symbol.endsWith("USDT") && 
      !EXCLUDED.includes(t.symbol) && 
      parseFloat(t.usdtVolume || 0) >= 1500000
    );

    // 2. Firebase Aktif İşlemleri Oku
    let activeTrades = {};
    let lastSignals = {};
    try {
      const [atRes, lsRes] = await Promise.all([
        fetch(`${FIREBASE_BASE_URL}/active_trades.json`),
        fetch(`${FIREBASE_BASE_URL}/last_signals.json`)
      ]);
      activeTrades = (await atRes.json()) || {};
      lastSignals = (await lsRes.json()) || {};
    } catch (e) {
      activeTrades = {};
      lastSignals = {};
    }

    // Takipte açık işlem varsa bekle (Spam ve risk engeli)
    const hasOpenTrade = Object.values(activeTrades).some(t => {
      if (!t || t.status !== 'OPEN') return false;
      const tTime = t.createdAt || (t.timestamp ? new Date(t.timestamp).getTime() : 0);
      return (now - tTime) <= THREE_HOURS_MS;
    });

    if (hasOpenTrade) {
      return res.status(200).json({ status: "IDLE", message: "Takip edilen açık operasyon mevcut, yeni sinyal açılmadı." });
    }

    // 3. GERÇEK PUMP / DUMP VE BALİNA HAREKETİ MOTORU
    let candidate = null;
    let direction = null;
    let confidenceScore = 0;
    let triggerReason = "";

    for (const item of pool) {
      const lastSentTime = lastSignals[item.symbol] || 0;
      if (now - lastSentTime < THREE_HOURS_MS) continue;

      const price = parseFloat(item.lastPr || 0);
      const high24 = parseFloat(item.high24h || 0);
      const low24 = parseFloat(item.low24h || 0);
      if (price <= 0 || high24 <= low24) continue;

      const rangePosition = (price - low24) / (high24 - low24);

      // Son 50 işlemin emir defteri akışı (Tape Reading)
      const fillsRes = await fetch(`https://api.bitget.com/api/v2/mix/market/fills?symbol=${item.symbol}&productType=usdt-futures&limit=50`, { headers: browserHeaders })
        .then(r => r.json()).catch(() => ({}));

      const fills = fillsRes.data?.fillList || fillsRes.data || [];
      let buyVol = 0;
      let sellVol = 0;

      if (Array.isArray(fills)) {
        fills.forEach(f => {
          const val = parseFloat(f.price || 0) * parseFloat(f.size || 0);
          if (f.side === 'buy') buyVol += val;
          else sellVol += val;
        });
      }

      const totalFlow = buyVol + sellVol;
      const buyPct = totalFlow > 0 ? (buyVol / totalFlow) * 100 : 50;

      // PUMP YAKALAMA (Dip Konsolidasyon + Anlık Alıcı Baskısı %62+)
      if (rangePosition <= 0.38 && buyPct >= 62) {
        candidate = item;
        direction = 'LONG';
        confidenceScore = Math.round(buyPct);
        triggerReason = `Dip bölgede (%${Math.round(rangePosition * 100)} seviyesi) kurumsal alıcı akını ve %${confidenceScore} agresif market alımı tespit edildi.`;
        break;
      }

      // DUMP YAKALAMA (Tepe Dağıtımı + Blok Satış Baskısı %65+)
      if (rangePosition >= 0.72 && buyPct <= 35) {
        candidate = item;
        direction = 'SHORT';
        confidenceScore = Math.round(100 - buyPct);
        triggerReason = `Tepe likidite bölgesinde dağıtım başladı; satış baskısı %${confidenceScore} seviyesinde, long likidasyon avı bekleniyor.`;
        break;
      }
    }

    // Gerçek kriteri karşılamayan hiçbir pariteye zoraki sinyal üretilmez
    if (!candidate) {
      return res.status(200).json({ status: "SCANNING", message: "Yüksek hacimli tahtalar taranıyor. Şartları sağlayan net pump/dump adayı bekleniyor." });
    }

    // 4. Hedef ve Stop Seviyeleri
    const entryPrice = parseFloat(candidate.lastPr);
    const isLong = direction === 'LONG';
    const tp1 = isLong ? entryPrice * 1.018 : entryPrice * 0.982;
    const tp2 = isLong ? entryPrice * 1.038 : entryPrice * 0.962;
    const sl = isLong ? entryPrice * 0.988 : entryPrice * 1.012;

    const tradeId = `trade_${Date.now()}`;
    const newTrade = {
      id: tradeId,
      symbol: candidate.symbol,
      direction: direction,
      entryPrice,
      tp1,
      tp2,
      sl,
      status: 'OPEN',
      score: confidenceScore,
      reason: triggerReason,
      createdAt: now,
      timestamp: new Date().toISOString()
    };

    // 5. Firebase'e Kaydet
    try {
      await Promise.all([
        fetch(`${FIREBASE_BASE_URL}/active_trades/${tradeId}.json`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(newTrade)
        }),
        fetch(`${FIREBASE_BASE_URL}/last_signals/${candidate.symbol}.json`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(now)
        })
      ]);
    } catch (fbErr) {
      console.warn("Firebase kayıt uyarısı:", fbErr);
    }

    // 6. TELEGRAM BİLDİRİMİNİ GÖNDER
    const pStr = entryPrice < 1 ? entryPrice.toFixed(6) : entryPrice.toFixed(4);
    const tp1Str = tp1 < 1 ? tp1.toFixed(6) : tp1.toFixed(4);
    const tp2Str = tp2 < 1 ? tp2.toFixed(6) : tp2.toFixed(4);
    const slStr = sl < 1 ? sl.toFixed(6) : sl.toFixed(4);

    const tgMsg = `🎯 <b>MINEORA SENTINEL | KURUMSAL DOĞRULANMIŞ SİNYAL</b>\n` +
                  `━━━━━━━━━━━━━━━━━━━━\n` +
                  `💎 <b>Parite:</b> #${candidate.symbol}\n` +
                  `🧭 <b>Yön:</b> ${direction === 'LONG' ? '🟢 LONG (Dip Likidite Patlaması)' : '🔴 SHORT (Tepe Dağıtımı)'}\n` +
                  `⚡ <b>Teyit Gücü:</b> %${confidenceScore}\n` +
                  `💵 <b>Giriş Fiyatı:</b> <code>$${pStr}</code>\n` +
                  `━━━━━━━━━━━━━━━━━━━━\n` +
                  `🎯 <b>Hedef 1:</b> <code>$${tp1Str}</code> (+%1.8)\n` +
                  `🚀 <b>Hedef 2:</b> <code>$${tp2Str}</code> (+%3.8)\n` +
                  `🛑 <b>Stop-Loss:</b> <code>$${slStr}</code> (-%1.2)\n` +
                  `━━━━━━━━━━━━━━━━━━━━\n` +
                  `📊 <i>İstihbarat Notu: ${triggerReason}</i>\n` +
                  `⚡ <i>Canlı Operasyon Masası: mineoragame.com</i>`;

    // DOĞRUDAN KANALA GÖNDER
    const channelRes = await fetch(`https://api.telegram.org/bot${TG_BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: TG_CHANNEL_ID, text: tgMsg, parse_mode: 'HTML' })
    });
    const channelData = await channelRes.json();

    // YÖNETİCİYE YEDEK BİLGİ GÖNDER
    await fetch(`https://api.telegram.org/bot${TG_BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: TG_ADMIN_ID, text: tgMsg, parse_mode: 'HTML' })
    }).catch(() => {});

    return res.status(200).json({
      success: true,
      trade: newTrade,
      channel_sent: channelData.ok,
      telegram_response: channelData
    });

  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}
