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
    
    // HIZLI SCALP ZAMAN AYARLARI
    const LOCK_WINDOW_MS = 20 * 60 * 1000;       // 20 dakika işlem kilidi
    const SAME_COIN_LOCK_MS = 45 * 60 * 1000;   // Aynı pariteye 45 dakika kilit
    const now = Date.now();

    // 1. Bitget Vadeli Ticker Verilerini Çek
    const tickersRes = await fetch("https://api.bitget.com/api/v2/mix/market/tickers?productType=USDT-FUTURES", { headers: browserHeaders });
    const tickersJson = await tickersRes.json();

    if (tickersJson.code !== '00000' || !Array.isArray(tickersJson.data)) {
      return res.status(500).json({ error: "Bitget piyasa verisi alınamadı." });
    }

    const EXCLUDED = ["BTCUSDT", "ETHUSDT", "SOLUSDT", "BNBUSDT", "XRPUSDT", "DOGEUSDT", "USDCUSDT"];
    // Canlı Likidite Havuzu: 600.000 USDT üzeri tüm hareketli pariteler
    const pool = tickersJson.data.filter(t => 
      t.symbol.endsWith("USDT") && 
      !EXCLUDED.includes(t.symbol) && 
      parseFloat(t.usdtVolume || 0) >= 600000
    );

    // 2. Firebase Aktif İşlemleri ve Geçmiş Sinyalleri Oku
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

    // SPAM KİLİDİ: Masada aynı anda en fazla 2 hızlı operasyona izin ver
    const openTradesCount = Object.values(activeTrades).filter(t => {
      if (!t || t.status !== 'OPEN') return false;
      const tTime = t.createdAt || (t.timestamp ? new Date(t.timestamp).getTime() : 0);
      return (now - tTime) <= LOCK_WINDOW_MS;
    }).length;

    if (openTradesCount >= 2) {
      return res.status(200).json({ status: "IDLE", message: "Masada 2 aktif scalp işlem var, bekleniyor." });
    }

    // 3. MİKRO ATEŞLEME & TAPE SIKIŞMA MOTORU
    let candidate = null;
    let direction = null;
    let confidenceScore = 0;
    let oiSnapshot = 0;
    let intelligenceReason = "";

    for (const item of pool) {
      const lastSentTime = lastSignals[item.symbol] || 0;
      if (now - lastSentTime < SAME_COIN_LOCK_MS) continue;

      const price = parseFloat(item.lastPr || 0);
      const high24 = parseFloat(item.high24h || 0);
      const low24 = parseFloat(item.low24h || 0);
      const fundingRate = parseFloat(item.fundingRate || 0);
      if (price <= 0 || high24 <= low24) continue;

      const rangePosition = (price - low24) / (high24 - low24);

      // Son 40 Mikro Emir Akışı (Anlık Taker Agresifliği)
      const fillsRes = await fetch(`https://api.bitget.com/api/v2/mix/market/fills?symbol=${item.symbol}&productType=usdt-futures&limit=40`, { headers: browserHeaders })
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

      // Açık Pozisyon (OI)
      const oiRes = await fetch(`https://api.bitget.com/api/v2/mix/market/open-interest?symbol=${item.symbol}&productType=usdt-futures`, { headers: browserHeaders })
        .then(r => r.json()).catch(() => ({}));

      const currentOI = parseFloat(oiRes.data?.openInterestList?.[0]?.size || oiRes.data?.[0]?.size || 0);

      // ================= 3-5 DK HIZLI PUMP SCALP KRİTERİ =================
      // Taker alış gücü %58 üstünde ve tahta aşırı tepeye çıkmamış (range <= 0.58)
      const isFastPump = (rangePosition <= 0.58) && (buyPct >= 58) && (fundingRate <= 0.010);

      // ================= 3-5 DK HIZLI DUMP SCALP KRİTERİ =================
      // Taker satış baskısı %58 üstünde ve fiyat dipten kopmuş (range >= 0.45)
      const isFastDump = (rangePosition >= 0.45) && (buyPct <= 42) && (fundingRate >= 0.005);

      if (isFastPump) {
        candidate = item;
        direction = 'LONG';
        confidenceScore = Math.round(buyPct);
        oiSnapshot = currentOI;
        intelligenceReason = `Anlık taker hacim patlaması (%${confidenceScore} Alıcı Baskısı). Tahta kademeleri süpürülüyor, 3-5 dk içinde likidite sıçraması bekleniyor.`;
        break;
      }

      if (isFastDump) {
        candidate = item;
        direction = 'SHORT';
        confidenceScore = Math.round(100 - buyPct);
        oiSnapshot = currentOI;
        intelligenceReason = `Anlık kurumsal blok satış baskısı (%${confidenceScore}). Destek kademeleri eriyor, ani tasfiye iğnesi bekleniyor.`;
        break;
      }
    }

    if (!candidate) {
      return res.status(200).json({ status: "SCANNING", message: "Hızlı scalp fırsatları taranıyor..." });
    }

    // 4. HIZLI HEDEFLER (VUR-KAÇ SCALP SEVİYELERİ)
    const entryPrice = parseFloat(candidate.lastPr);
    const isLong = direction === 'LONG';
    
    // HIZLI TP ORANLARI: TP1 +%0.8, TP2 +%1.6, SL -%0.7
    const tp1 = isLong ? entryPrice * 1.008 : entryPrice * 0.992;
    const tp2 = isLong ? entryPrice * 1.016 : entryPrice * 0.984;
    const sl = isLong ? entryPrice * 0.993 : entryPrice * 1.007;

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
      reason: intelligenceReason,
      oi: oiSnapshot,
      createdAt: now,
      timestamp: new Date().toISOString()
    };

    // 5. Firebase Kaydı
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
      console.warn("Firebase log:", fbErr);
    }

    // 6. TELEGRAM BİLDİRİMİ (HIZLI SCALP ŞABLONU)
    const pStr = entryPrice < 1 ? entryPrice.toFixed(6) : entryPrice.toFixed(4);
    const tp1Str = tp1 < 1 ? tp1.toFixed(6) : tp1.toFixed(4);
    const tp2Str = tp2 < 1 ? tp2.toFixed(6) : tp2.toFixed(4);
    const slStr = sl < 1 ? sl.toFixed(6) : sl.toFixed(4);

    const tgMsg = `⚡ <b>MINEORA FLASH SCALP | ANLIK HIZLI OPERASYON</b>\n` +
                  `━━━━━━━━━━━━━━━━━━━━\n` +
                  `💎 <b>Parite:</b> #${candidate.symbol}\n` +
                  `🧭 <b>Yön:</b> ${direction === 'LONG' ? '🟢 LONG (Hızlı Patlama)' : '🔴 SHORT (Hızlı Dökülme)'}\n` +
                  `⚡ <b>Süpürme Gücü:</b> %${confidenceScore}\n` +
                  `💵 <b>Giriş:</b> <code>$${pStr}</code>\n` +
                  `━━━━━━━━━━━━━━━━━━━━\n` +
                  `🎯 <b>Hızlı TP 1:</b> <code>$${tp1Str}</code> (+%0.80)\n` +
                  `🚀 <b>Hızlı TP 2:</b> <code>$${tp2Str}</code> (+%1.60)\n` +
                  `🛑 <b>Sıkı Stop:</b> <code>$${slStr}</code> (-%0.70)\n` +
                  `━━━━━━━━━━━━━━━━━━━━\n` +
                  `⏱ <i>Beklenen Hareket: 3 - 5 Dakika İçi</i>\n` +
                  `📊 <i>İstihbarat: ${intelligenceReason}</i>\n` +
                  `━━━━━━━━━━━━━━━━━━━━\n` +
                  `⚡ <i>Canlı Terminal: <a href="https://mineoragame.com">mineoragame.com</a></i>\n` +
                  `📢 <i>Ücretsiz Kanal: <a href="https://t.me/mineorabalina">t.me/mineorabalina</a></i>`;

    const channelRes = await fetch(`https://api.telegram.org/bot${TG_BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: TG_CHANNEL_ID, text: tgMsg, parse_mode: 'HTML' })
    });
    const channelData = await channelRes.json();

    await fetch(`https://api.telegram.org/bot${TG_BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: TG_ADMIN_ID, text: tgMsg, parse_mode: 'HTML' })
    }).catch(() => {});

    return res.status(200).json({
      success: true,
      trade: newTrade,
      channel_sent: channelData.ok
    });

  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}
