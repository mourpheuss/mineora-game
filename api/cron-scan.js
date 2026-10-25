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
    
    const LOCK_WINDOW_MS = 45 * 60 * 1000;       // 45 dk aktif takip
    const SAME_COIN_LOCK_MS = 90 * 60 * 1000;   // Aynı coine 90 dk kilit
    const now = Date.now();

    // 1. Bitget Vadeli Ticker Verilerini Çek
    const tickersRes = await fetch("https://api.bitget.com/api/v2/mix/market/tickers?productType=USDT-FUTURES", { headers: browserHeaders });
    const tickersJson = await tickersRes.json();

    if (tickersJson.code !== '00000' || !Array.isArray(tickersJson.data)) {
      return res.status(500).json({ error: "Bitget piyasa verisi alınamadı." });
    }

    const priceMap = {};
    tickersJson.data.forEach(t => {
      priceMap[t.symbol] = parseFloat(t.lastPr || 0);
    });

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

    // =========================================================================
    // MODÜL 1: CANLI İŞLEM TAKİP MOTORU (TP1 / TP2 / STOP DENETİMİ)
    // =========================================================================
    let tradeUpdates = [];
    for (const [tradeKey, trade] of Object.entries(activeTrades)) {
      if (!trade || trade.status !== 'OPEN') continue;

      const curPrice = priceMap[trade.symbol];
      if (!curPrice || curPrice <= 0) continue;

      const isLong = trade.direction === 'LONG';
      const curPriceStr = curPrice < 1 ? curPrice.toFixed(6) : curPrice.toFixed(4);
      const entryPriceStr = trade.entryPrice < 1 ? trade.entryPrice.toFixed(6) : trade.entryPrice.toFixed(4);

      // A) TP 2 KONTROLÜ (TAM HEDEF BAŞARISI)
      const isTp2Hit = isLong ? (curPrice >= trade.tp2) : (curPrice <= trade.tp2);
      if (isTp2Hit) {
        trade.status = 'TP2_HIT';
        trade.closedAt = now;
        tradeUpdates.push(
          fetch(`${FIREBASE_BASE_URL}/active_trades/${tradeKey}.json`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(trade)
          })
        );

        const tp2Msg = `🚀 <b>MINEORA SENTINEL | TP 2 TAM HEDEF VURULDU!</b>\n` +
                       `━━━━━━━━━━━━━━━━━━━━\n` +
                       `💎 <b>Parite:</b> #${trade.symbol}\n` +
                       `🧭 <b>Pozisyon:</b> ${isLong ? '🟢 LONG' : '🔴 SHORT'}\n` +
                       `💵 <b>Giriş:</b> <code>$${entryPriceStr}</code>\n` +
                       `🏁 <b>Kapanış Fiyatı:</b> <code>$${curPriceStr}</code>\n` +
                       `🏆 <b>Net Kâr:</b> <b>+%2.00</b> <i>(10x: +%20 | 20x: +%40)</i>\n` +
                       `━━━━━━━━━━━━━━━━━━━━\n` +
                       `✨ <i>Balina akış hedefi başarıyla tamamlandı.</i>\n` +
                       `📢 <i>Kanal: <a href="https://t.me/mineorabalina">t.me/mineorabalina</a></i>`;

        await fetch(`https://api.telegram.org/bot${TG_BOT_TOKEN}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ chat_id: TG_CHANNEL_ID, text: tp2Msg, parse_mode: 'HTML' })
        }).catch(() => {});
        continue;
      }

      // B) TP 1 KONTROLÜ (İLK KÂR ALINDI & STOP GİRİŞE ÇEKİLDİ)
      const isTp1Hit = isLong ? (curPrice >= trade.tp1) : (curPrice <= trade.tp1);
      if (isTp1Hit && !trade.tp1Hit) {
        trade.tp1Hit = true;
        trade.sl = trade.entryPrice; // Stop girişe (Break-even) çekildi
        tradeUpdates.push(
          fetch(`${FIREBASE_BASE_URL}/active_trades/${tradeKey}.json`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(trade)
          })
        );

        const tp1Msg = `🎯 <b>MINEORA SENTINEL | HEDEF 1 (TP1) ALINDI!</b>\n` +
                       `━━━━━━━━━━━━━━━━━━━━\n` +
                       `💎 <b>Parite:</b> #${trade.symbol}\n` +
                       `🧭 <b>Pozisyon:</b> ${isLong ? '🟢 LONG' : '🔴 SHORT'}\n` +
                       `💵 <b>Giriş:</b> <code>$${entryPriceStr}</code>\n` +
                       `⚡ <b>Anlık Fiyat:</b> <code>$${curPriceStr}</code>\n` +
                       `💰 <b>Kâr:</b> <b>+%1.00</b> <i>(Pozisyonun %50'si kârla kapatılabilir)</i>\n` +
                       `🛡️ <b>Risk Yönetimi:</b> Stop-Loss giriş seviyesine çekildi. Kalan kısım sıfır riskle taşınıyor!\n` +
                       `━━━━━━━━━━━━━━━━━━━━\n` +
                       `📢 <i>Kanal: <a href="https://t.me/mineorabalina">t.me/mineorabalina</a></i>`;

        await fetch(`https://api.telegram.org/bot${TG_BOT_TOKEN}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ chat_id: TG_CHANNEL_ID, text: tp1Msg, parse_mode: 'HTML' })
        }).catch(() => {});
        continue;
      }

      // C) STOP-LOSS KONTROLÜ
      const isStopHit = isLong ? (curPrice <= trade.sl) : (curPrice >= trade.sl);
      if (isStopHit) {
        trade.status = 'STOPPED';
        trade.closedAt = now;
        tradeUpdates.push(
          fetch(`${FIREBASE_BASE_URL}/active_trades/${tradeKey}.json`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(trade)
          })
        );

        const stopMsg = `🛑 <b>MINEORA SENTINEL | STOP SEVİYESİ TETİKLENDİ</b>\n` +
                        `━━━━━━━━━━━━━━━━━━━━\n` +
                        `💎 <b>Parite:</b> #${trade.symbol}\n` +
                        `🧭 <b>Pozisyon:</b> ${isLong ? '🟢 LONG' : '🔴 SHORT'}\n` +
                        `💵 <b>Giriş:</b> <code>$${entryPriceStr}</code>\n` +
                        `🛑 <b>Çıkış:</b> <code>$${curPriceStr}</code>\n` +
                        `📉 <b>Zarar-Kes:</b> ${trade.tp1Hit ? '0.00% (Başa Baş Korundu)' : '-%1.20'}\n` +
                        `━━━━━━━━━━━━━━━━━━━━\n` +
                        `🛡️ <i>Sermaye korundu. Yeni kurumsal birikim taranıyor.</i>`;

        await fetch(`https://api.telegram.org/bot${TG_BOT_TOKEN}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ chat_id: TG_CHANNEL_ID, text: stopMsg, parse_mode: 'HTML' })
        }).catch(() => {});
        continue;
      }
    }

    if (tradeUpdates.length > 0) {
      await Promise.all(tradeUpdates);
    }

    // =========================================================================
    // MODÜL 2: KURUMSAL Z-SCORE + SIKIŞMA + FONLAMA + BALİNA AKIŞ MOTORU
    // =========================================================================
    const openTradesCount = Object.values(activeTrades).filter(t => {
      if (!t || t.status !== 'OPEN') return false;
      const tTime = t.createdAt || 0;
      return (now - tTime) <= LOCK_WINDOW_MS;
    }).length;

    if (openTradesCount >= 2) {
      return res.status(200).json({ status: "IDLE", message: "Takipte aktif operasyonlar var; yeni sinyal beklemede." });
    }

    // TradFi, Emtialar ve Düşük Likidite Hariç
    const EXCLUDED = [
      "BTCUSDT", "ETHUSDT", "SOLUSDT", "BNBUSDT", "XRPUSDT", "DOGEUSDT", "USDCUSDT",
      "CLUSDT", "XAUUSDT", "XAGUSDT", "SPXUSDT", "NDXUSDT", "DJIUSDT", "BGBUSDT"
    ];

    // Minimum 1.500.000 USDT hacimli, gerçek akıcı altcoin havuzu
    const pool = tickersJson.data
      .filter(c => Number(c.usdtVolume || c.quoteVolume || 0) >= 1500000 && c.symbol.endsWith('USDT') && !EXCLUDED.includes(c.symbol))
      .sort((a, b) => Number(b.usdtVolume || 0) - Number(a.usdtVolume || 0));

    // Z-Score Matematiksel Fonksiyonu
    function calculateZScore(series, currentVal) {
      if (!series || series.length < 5) return 0;
      const n = series.length;
      const mean = series.reduce((a, b) => a + b, 0) / n;
      const variance = series.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / n;
      const stdDev = Math.sqrt(variance);
      return stdDev === 0 ? 0 : (currentVal - mean) / stdDev;
    }

    let candidateTrade = null;

    for (const item of pool.slice(0, 35)) {
      const lastSentTime = lastSignals[item.symbol] || 0;
      if (now - lastSentTime < SAME_COIN_LOCK_MS) continue;

      // 1. ADIM: SON 25 MUMU ÇEK (1m Mumlar - Mikro Dinamik)
      const candlesRes = await fetch(`https://api.bitget.com/api/v2/mix/market/candles?symbol=${item.symbol}&productType=USDT-FUTURES&granularity=1m&limit=25`, { headers: browserHeaders })
        .then(r => r.json()).catch(() => ({}));

      if (candlesRes.code !== '00000' || !Array.isArray(candlesRes.data) || candlesRes.data.length < 20) continue;

      const candles = candlesRes.data.map(c => ({
        time: Math.floor(Number(c[0]) / 1000),
        open: Number(c[1]),
        high: Number(c[2]),
        low: Number(c[3]),
        close: Number(c[4]),
        volume: Number(c[5])
      })).sort((a, b) => a.time - b.time);

      const current = candles[candles.length - 1];
      const previous = candles.slice(0, candles.length - 1);

      // A) Z-Score Hacim Sapması
      const pastVolumes = previous.map(c => c.volume);
      const volZScore = calculateZScore(pastVolumes, current.volume);

      // B) Volatilite Sıkışması (Squeeze Kontrolü - Fiyat Henüz Patlamamış Olmalı)
      const recentRanges = previous.slice(-5).map(c => (c.high - c.low) / (c.close || 1));
      const avgRange = recentRanges.reduce((a, b) => a + b, 0) / recentRanges.length;
      const currentRange = (current.high - current.low) / (current.close || 1);
      const isSqueezed = currentRange < (avgRange * 0.90);

      // C) Son 5 Mumdaki Fiyat Değişimi (Zirveye atlamama garantisi)
      const price5mAgo = previous[previous.length - 5].close;
      const priceChange5m = ((current.close - price5mAgo) / price5mAgo) * 100;
      if (Math.abs(priceChange5m) > 0.65) continue; // Fiyat zaten %0.65'ten fazla uçtuysa ASLA girme!

      // 2. ADIM: FONLAMA ORANI (FUNDING RATE) ANALİZİ
      const fundingRate = parseFloat(item.fundingRate || 0);

      // 3. ADIM: BALİNA BLOK İŞLEMLERİNİ SÜZME (1.000$ ve Üzeri Kurumsal Emirler)
      const fillsRes = await fetch(`https://api.bitget.com/api/v2/mix/market/fills?symbol=${item.symbol}&productType=usdt-futures&limit=60`, { headers: browserHeaders })
        .then(r => r.json()).catch(() => ({}));

      const fills = fillsRes.data?.fillList || fillsRes.data || [];
      let whaleBuyUsd = 0;
      let whaleSellUsd = 0;

      if (Array.isArray(fills)) {
        fills.forEach(f => {
          const val = parseFloat(f.price || 0) * parseFloat(f.size || 0);
          if (val >= 1000) { // 1.000 USDT üzerindeki gerçek balina blok emirleri
            if (f.side === 'buy') whaleBuyUsd += val;
            else whaleSellUsd += val;
          }
        });
      }

      const totalWhaleFlow = whaleBuyUsd + whaleSellUsd;
      const whaleBuyPct = totalWhaleFlow > 0 ? (whaleBuyUsd / totalWhaleFlow) * 100 : 50;

      // ================= LONG TEYİT KURALI (PRE-PUMP KURUMSAL PATLAMA ÖNCESİ) =================
      // 1. Hacim Anormalliği var (Z-Score >= 2.0)
      // 2. Fiyat henüz patlamamış, sıkışmış (isSqueezed veya priceChange5m < %0.4)
      // 3. Balina emirleri %65+ Alıcı yönünde (Whale Buy Flow)
      // 4. Fonlama şişmemiş (FR <= 0.005, Short sıkışmasına uygun)
      const isPrePumpLong = (volZScore >= 2.0) && 
                            (isSqueezed || Math.abs(priceChange5m) < 0.40) && 
                            (whaleBuyPct >= 65) && 
                            (fundingRate <= 0.005);

      // ================= SHORT TEYİT KURALI (PRE-DUMP KURUMSAL BOŞALTMA ÖNCESİ) =================
      // 1. Hacim Anormalliği var (Z-Score >= 2.0)
      // 2. Fiyat sıkışmış ancak balina satışı var
      // 3. Balina emirleri %65+ Satıcı yönünde (Whale Buy <= %35)
      // 4. Longçular şişkin fonlama ödüyor (FR >= 0.015)
      const isPreDumpShort = (volZScore >= 2.0) && 
                             (isSqueezed || Math.abs(priceChange5m) < 0.40) && 
                             (whaleBuyPct <= 35) && 
                             (fundingRate >= 0.015);

      if (isPrePumpLong) {
        candidateTrade = {
          symbol: item.symbol,
          direction: 'LONG',
          price: current.close,
          volZScore: parseFloat(volZScore.toFixed(2)),
          whaleBuyPct: Math.round(whaleBuyPct),
          fundingRate: (fundingRate * 100).toFixed(4),
          reason: `Volatilite sıkıştı (Son 5 dk: %${priceChange5m.toFixed(2)}). Hacim anomalisi (Z-Score: ${volZScore.toFixed(1)}σ) ve 1.000$+ kurumsal emirlerde %${Math.round(whaleBuyPct)} alıcı süpürmesi başladı.`
        };
        break;
      }

      if (isPreDumpShort) {
        candidateTrade = {
          symbol: item.symbol,
          direction: 'SHORT',
          price: current.close,
          volZScore: parseFloat(volZScore.toFixed(2)),
          whaleBuyPct: Math.round(100 - whaleBuyPct),
          fundingRate: (fundingRate * 100).toFixed(4),
          reason: `Şişkin fonlamada (${(fundingRate * 100).toFixed(3)}%) kurumsal dağıtım başladı. Hacim anomalisi (Z-Score: ${volZScore.toFixed(1)}σ) ve %${Math.round(100 - whaleBuyPct)} balina satış blokları tespit edildi.`
        };
        break;
      }
    }

    if (!candidateTrade) {
      return res.status(200).json({ status: "SCANNING", message: "Z-Score, Sıkışma ve Balina Blok akışları taranıyor; patlama öncesi bekleniyor." });
    }

    // 4. HEDEF VE STOP MATEMATİĞİ (GÜVENLİ VE GERÇEKÇİ MARJLAR)
    const entryPrice = candidateTrade.price;
    const isLong = candidateTrade.direction === 'LONG';
    const tp1 = isLong ? entryPrice * 1.010 : entryPrice * 0.990; // +%1.00 Net
    const tp2 = isLong ? entryPrice * 1.020 : entryPrice * 0.980; // +%2.00 Net
    const sl = isLong ? entryPrice * 0.988 : entryPrice * 1.012;  // -%1.20 Güvenli Stop

    const tradeId = `trade_${Date.now()}`;
    const newTrade = {
      id: tradeId,
      symbol: candidateTrade.symbol,
      direction: candidateTrade.direction,
      entryPrice,
      tp1,
      tp2,
      sl,
      status: 'OPEN',
      tp1Hit: false,
      score: candidateTrade.whaleBuyPct,
      reason: candidateTrade.reason,
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
        fetch(`${FIREBASE_BASE_URL}/last_signals/${candidateTrade.symbol}.json`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(now)
        })
      ]);
    } catch (fbErr) {}

    // 6. TELEGRAM BİLDİRİMİNİ GÖNDER
    const pStr = entryPrice < 1 ? entryPrice.toFixed(6) : entryPrice.toFixed(4);
    const tp1Str = tp1 < 1 ? tp1.toFixed(6) : tp1.toFixed(4);
    const tp2Str = tp2 < 1 ? tp2.toFixed(6) : tp2.toFixed(4);
    const slStr = sl < 1 ? sl.toFixed(6) : sl.toFixed(4);

    const tgMsg = `⚡ <b>MINEORA SENTINEL | PATLAMA ÖNCESİ (PRE-PUMP) SİNYALİ</b>\n` +
                  `━━━━━━━━━━━━━━━━━━━━\n` +
                  `💎 <b>Parite:</b> #${candidateTrade.symbol}\n` +
                  `🧭 <b>Yön:</b> ${isLong ? '🟢 LONG (Sıkışma & Balina Birikimi)' : '🔴 SHORT (Şişkin Fonlama Dağıtımı)'}\n` +
                  `⚡ <b>Balina Gücü:</b> %${candidateTrade.whaleBuyPct}\n` +
                  `📊 <b>Hacim Anomalisi:</b> ${candidateTrade.volZScore}σ Z-Score\n` +
                  `💵 <b>Giriş:</b> <code>$${pStr}</code>\n` +
                  `━━━━━━━━━━━━━━━━━━━━\n` +
                  `🎯 <b>Hızlı TP 1:</b> <code>$${tp1Str}</code> (+%1.00)\n` +
                  `🚀 <b>Hızlı TP 2:</b> <code>$${tp2Str}</code> (+%2.00)\n` +
                  `🛑 <b>Güvenli Stop:</b> <code>$${slStr}</code> (-%1.20)\n` +
                  `━━━━━━━━━━━━━━━━━━━━\n` +
                  `📊 <i>İstihbarat: ${candidateTrade.reason}</i>\n` +
                  `💡 <i>Strateji: TP1 alındığında stop girişe çekilir, kalan kısım sıfır riskle izlenir.</i>\n` +
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
