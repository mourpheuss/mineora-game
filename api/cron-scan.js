export default async function handler(req, res) {
  try {
    const browserHeaders = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
      'Accept': 'application/json'
    };

    const TG_BOT_TOKEN = "8682225307:AAHaa-hieKBBluU6uZ2_-OgSPxGR7OwMssE";
    const TG_CHANNEL_ID = "-1004404988937";
    const TG_ADMIN_ID = "6457294906";
    const FIREBASE_BASE_URL = "https://mineora-web-default-rtdb.firebaseio.com";
    
    const LOCK_WINDOW_MS = 45 * 60 * 1000;
    const SAME_COIN_LOCK_MS = 90 * 60 * 1000;
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

    // =========================================================================
    // MODÜL 1: CANLI İŞLEM TAKİP MOTORU (TP1 / TP2 / STOP)
    // =========================================================================
    let tradeUpdates = [];
    for (const [tradeKey, trade] of Object.entries(activeTrades)) {
      if (!trade || trade.status !== 'OPEN') continue;

      const curPrice = priceMap[trade.symbol];
      if (!curPrice || curPrice <= 0) continue;

      const isLong = trade.direction === 'LONG';
      const curPriceStr = curPrice < 1 ? curPrice.toFixed(6) : curPrice.toFixed(4);
      const entryPriceStr = trade.entryPrice < 1 ? trade.entryPrice.toFixed(6) : trade.entryPrice.toFixed(4);

      // TP 2 KONTROLÜ
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
                       `🏁 <b>Kapanış:</b> <code>$${curPriceStr}</code>\n` +
                       `🏆 <b>Net Kâr:</b> <b>+%2.00</b> <i>(10x: +%20 | 20x: +%40)</i>\n` +
                       `━━━━━━━━━━━━━━━━━━━━\n` +
                       `✨ <i>Ön-patlama hareketi hedefe ulaştı.</i>\n` +
                       `📢 <i>Kanal: <a href="https://t.me/mineorabalina">t.me/mineorabalina</a></i>`;

        await fetch(`https://api.telegram.org/bot${TG_BOT_TOKEN}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ chat_id: TG_CHANNEL_ID, text: tp2Msg, parse_mode: 'HTML' })
        }).catch(() => {});
        continue;
      }

      // TP 1 KONTROLÜ
      const isTp1Hit = isLong ? (curPrice >= trade.tp1) : (curPrice <= trade.tp1);
      if (isTp1Hit && !trade.tp1Hit) {
        trade.tp1Hit = true;
        trade.sl = trade.entryPrice;
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
                       `🛡️ <b>Risk Yönetimi:</b> Stop-Loss giriş seviyesine çekildi. Kalan kısım sıfır risk!\n` +
                       `━━━━━━━━━━━━━━━━━━━━\n` +
                       `📢 <i>Kanal: <a href="https://t.me/mineorabalina">t.me/mineorabalina</a></i>`;

        await fetch(`https://api.telegram.org/bot${TG_BOT_TOKEN}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ chat_id: TG_CHANNEL_ID, text: tp1Msg, parse_mode: 'HTML' })
        }).catch(() => {});
        continue;
      }

      // STOP KONTROLÜ
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
                        `🛡️ <i>Sermaye korundu. Yeni kurumsal dengesizlik taranıyor.</i>`;

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
    // MODÜL 2: 1-3 DAKİKA ÖNCEDEN "PATLAMA ÖNCESİ DENGESİZLİK" TESPİT MOTORU
    // =========================================================================
    const openTradesCount = Object.values(activeTrades).filter(t => {
      if (!t || t.status !== 'OPEN') return false;
      const tTime = t.createdAt || 0;
      return (now - tTime) <= LOCK_WINDOW_MS;
    }).length;

    if (openTradesCount >= 2) {
      return res.status(200).json({ status: "IDLE", message: "Takipte aktif operasyonlar var; yeni sinyal beklemede." });
    }

    // KESİN SAF KRİPTO KORUMASI (HİSSE, ETF, EMTİA VE SAHTE TÜREVLERİ ELER)
    const TRADFI_BLACKLIST = [
      "OPENAI", "ANTHROPIC", "KORU", "XAU", "XAG", "SPX", "NDX", "DJI",
      "NVDA", "TSLA", "AAPL", "AMZN", "MSFT", "GOOG", "META", "COIN",
      "BGBUSDT", "USDCUSDT", "EURUSDT", "GBPUSDT", "TUSDT", "CLUSDT"
    ];

    const pool = tickersJson.data.filter(c => {
      if (!c.symbol.endsWith("USDT")) return false;
      const vol = parseFloat(c.usdtVolume || c.quoteVolume || 0);
      if (vol < 800000) return false;

      for (const b of TRADFI_BLACKLIST) {
        if (c.symbol.startsWith(b)) return false;
      }
      return true;
    }).sort((a, b) => parseFloat(b.usdtVolume || 0) - parseFloat(a.usdtVolume || 0));

    let candidateTrade = null;

    for (const item of pool.slice(0, 40)) {
      const lastSentTime = lastSignals[item.symbol] || 0;
      if (now - lastSentTime < SAME_COIN_LOCK_MS) continue;

      // 1. ADIM: SON 15 MUM (1m Periyot - Mikro 180 Saniyelik Dinamik)
      const candlesRes = await fetch(`https://api.bitget.com/api/v2/mix/market/candles?symbol=${item.symbol}&productType=USDT-FUTURES&granularity=1m&limit=15`, { headers: browserHeaders })
        .then(r => r.json()).catch(() => ({}));

      if (candlesRes.code !== '00000' || !Array.isArray(candlesRes.data) || candlesRes.data.length < 10) continue;

      const candles = candlesRes.data.map(c => ({
        time: Math.floor(Number(c[0]) / 1000),
        open: Number(c[1]),
        high: Number(c[2]),
        low: Number(c[3]),
        close: Number(c[4]),
        volume: Number(c[5])
      })).sort((a, b) => a.time - b.time);

      const current = candles[candles.length - 1];
      const c3mBack = candles[candles.length - 3]; // 3 dakika önceki mum

      // ŞART 1: FİYAT TAMAMEN KİLİTLİ OLMALI (Son 3 dakikalık değişim <= %0.25)
      // Fiyat fırlamamış olacak, kuluçkada bekleyecek!
      const priceChange3m = Math.abs(((current.close - c3mBack.close) / c3mBack.close) * 100);
      if (priceChange3m > 0.25) continue;

      // ŞART 2: DERİNLİK TAHTASI ASİMETRİSİ (Satış duvarı çekilmiş mi?)
      const depthRes = await fetch(`https://api.bitget.com/api/v2/mix/market/merge-depth?symbol=${item.symbol}&productType=usdt-futures&limit=15`, { headers: browserHeaders })
        .then(r => r.json()).catch(() => ({}));

      const bids = depthRes.data?.bids || [];
      const asks = depthRes.data?.asks || [];
      if (!bids.length || !asks.length) continue;

      let top5BidVol = 0;
      let top5AskVol = 0;
      for (let i = 0; i < Math.min(5, bids.length); i++) top5BidVol += parseFloat(bids[i][1] || 0);
      for (let i = 0; i < Math.min(5, asks.length); i++) top5AskVol += parseFloat(asks[i][1] || 0);

      // İlk 5 kademede önü tıkalı mı? Satıcı duvarı, alıcı desteğinin en fazla %60'ı kadar olmalı (Önü açık)
      if (top5AskVol > top5BidVol * 0.60) continue;

      // ŞART 3: SON TAPE AKIŞINDA GİZLİ SÜPÜRME (Absorption / Taker Surge)
      const fillsRes = await fetch(`https://api.bitget.com/api/v2/mix/market/fills?symbol=${item.symbol}&productType=usdt-futures&limit=60`, { headers: browserHeaders })
        .then(r => r.json()).catch(() => ({}));

      const fills = fillsRes.data?.fillList || fillsRes.data || [];
      if (!Array.isArray(fills) || fills.length < 20) continue;

      let recentBuyVol = 0;
      let recentSellVol = 0;
      let activeTradeCount = 0;

      fills.forEach(f => {
        const val = parseFloat(f.price || 0) * parseFloat(f.size || 0);
        if (val >= 250) { // Mikro bot gürültüsünü filtrele
          activeTradeCount++;
          if (f.side === 'buy') recentBuyVol += val;
          else recentSellVol += val;
        }
      });

      const totalRecentVol = recentBuyVol + recentSellVol;
      if (totalRecentVol <= 0) continue;

      const takerBuyRatio = (recentBuyVol / totalRecentVol) * 100;
      const fundingRate = parseFloat(item.fundingRate || 0);

      // ŞART 4: BÜYÜK PATLAMA ÖNCESİ TETİĞİ (Taker Alış Oranı >= %75 & Fiyat Kilitli)
      // Fiyat son 3 dakikada %0.25 dahi oynamadı ama piyasa alımları %75+ güçle tahtayı emiyor!
      if (takerBuyRatio >= 75 && activeTradeCount >= 12 && fundingRate <= 0.005) {
        candidateTrade = {
          symbol: item.symbol,
          direction: 'LONG',
          price: current.close,
          takerBuyRatio: Math.round(takerBuyRatio),
          priceChange3m: priceChange3m.toFixed(2),
          fundingRate: (fundingRate * 100).toFixed(4),
          reason: `Son 3 dk fiyat değişimi sadece %${priceChange3m.toFixed(2)} (Kilitli Taban). Tahtada satış duvarı çekildi ve son akışta %${Math.round(takerBuyRatio)} agresif piyasa alımıyla kurumsal emilim (absorption) başladı.`
        };
        break;
      }
    }

    if (!candidateTrade) {
      return res.status(200).json({ status: "SCANNING", message: "Kilitli taban ve 1-3 dk öncesi kurumsal emilim aranıyor..." });
    }

    // 4. HEDEF VE STOP MATEMATİĞİ
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
      score: candidateTrade.takerBuyRatio,
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

    const tgMsg = `⚡ <b>MINEORA SENTINEL | 1-3 DK ÖNCESİ PATLAMA ALARMI</b>\n` +
                  `━━━━━━━━━━━━━━━━━━━━\n` +
                  `💎 <b>Parite:</b> #${candidateTrade.symbol}\n` +
                  `🧭 <b>Yön:</b> 🟢 LONG (Kilitli Taban Emilimi)\n` +
                  `⚡ <b>Agresif Alıcı Gücü:</b> %${candidateTrade.takerBuyRatio}\n` +
                  `🔒 <b>3 Dakikalık Fiyat Oynaklığı:</b> %${candidateTrade.priceChange3m} (Hareket henüz başlamadı)\n` +
                  `💵 <b>Giriş:</b> <code>$${pStr}</code>\n` +
                  `━━━━━━━━━━━━━━━━━━━━\n` +
                  `🎯 <b>Hızlı TP 1:</b> <code>$${tp1Str}</code> (+%1.00)\n` +
                  `🚀 <b>Hızlı TP 2:</b> <code>$${tp2Str}</code> (+%2.00)\n` +
                  `🛑 <b>Güvenli Stop:</b> <code>$${slStr}</code> (-%1.20)\n` +
                  `━━━━━━━━━━━━━━━━━━━━\n` +
                  `📊 <i>İstihbarat: ${candidateTrade.reason}</i>\n` +
                  `💡 <i>Kural: TP1 alındığında stop girişe çekilir, kalan pozisyon sıfır riskle izlenir.</i>\n` +
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
