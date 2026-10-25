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
                       `✨ <i>Destek sıçrama dalgası tam hedefe ulaştı.</i>\n` +
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
                       `🛡️ <b>Risk Yönetimi:</b> Stop-Loss başabaş seviyesine çekildi. Kalan miktar risksiz!\n` +
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
                        `📉 <b>Zarar-Kes:</b> ${trade.tp1Hit ? '0.00% (Başa Baş Korundu)' : 'Destek Altı Disiplin Çıkışı'}\n` +
                        `━━━━━━━━━━━━━━━━━━━━\n` +
                        `🛡️ <i>Sermaye korundu. Yeni ana destek seviyesi taranıyor.</i>`;

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
    // MODÜL 2: 15M DESTEK/DİRENÇ + 1M Z-SCORE VE BALİNA AKIŞ MOTORU
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

      // 1. ADIM: 15 DAKİKALIK MUMLARI ÇEK (GRAFİK DESTEK / DİRENÇ HARİTASI)
      const candles15mRes = await fetch(`https://api.bitget.com/api/v2/mix/market/candles?symbol=${item.symbol}&productType=USDT-FUTURES&granularity=15m&limit=40`, { headers: browserHeaders })
        .then(r => r.json()).catch(() => ({}));

      if (candles15mRes.code !== '00000' || !Array.isArray(candles15mRes.data) || candles15mRes.data.length < 25) continue;

      const candles15m = candles15mRes.data.map(c => ({
        time: Math.floor(Number(c[0]) / 1000),
        open: Number(c[1]),
        high: Number(c[2]),
        low: Number(c[3]),
        close: Number(c[4]),
        volume: Number(c[5])
      })).sort((a, b) => a.time - b.time);

      const cur15m = candles15m[candles15m.length - 1];
      const prev15mList = candles15m.slice(0, -1);

      // 15m Grafik Destek ve Direnç Seviyeleri (Son 30 mumun tepeleri ve dipleri)
      const pastLows = prev15mList.map(c => c.low);
      const pastHighs = prev15mList.map(c => c.high);
      const majorSupport15m = Math.min(...pastLows.slice(-20)); // 15m Majör Destek
      const majorResistance15m = Math.max(...pastHighs.slice(-20)); // 15m Majör Direnç

      // ŞART 1: FİYAT BOŞLUKTA OLAMAZ! 15m Majör Desteğe Temas Etmiş veya Taban Yapmış Olmalı
      // Fiyat desteğe %0.35 kadar yakın veya temas edip tepki vermiş mi?
      const isAtSupport = (cur15m.low <= majorSupport15m * 1.0035) && (cur15m.close >= majorSupport15m * 0.998);
      if (!isAtSupport) continue; // Destekte değilse düşen bıçağı tutma, doğrudan atla!

      // 2. ADIM: 1 DAKİKALIK MİKRO TAHTA VE Z-SCORE TETİKLEYİCİSİ (PUSULA)
      const candles1mRes = await fetch(`https://api.bitget.com/api/v2/mix/market/candles?symbol=${item.symbol}&productType=USDT-FUTURES&granularity=1m&limit=20`, { headers: browserHeaders })
        .then(r => r.json()).catch(() => ({}));

      if (candles1mRes.code !== '00000' || !Array.isArray(candles1mRes.data) || candles1mRes.data.length < 15) continue;

      const candles1m = candles1mRes.data.map(c => ({
        time: Math.floor(Number(c[0]) / 1000),
        open: Number(c[1]),
        high: Number(c[2]),
        low: Number(c[3]),
        close: Number(c[4]),
        volume: Number(c[5])
      })).sort((a, b) => a.time - b.time);

      const cur1m = candles1m[candles1m.length - 1];
      const prev1m = candles1m.slice(0, -1);

      // Mikro Z-Score Hacim Sapması (Destekte hacim patladı mı?)
      const volZScore = calculateZScore(prev1m.map(c => c.volume), cur1m.volume);
      if (volZScore < 1.8) continue; // Destekte anormal hacim alışı yoksa girme!

      // 3. ADIM: TAPE READING & BALİNA AKIŞI (KURUMSAL ALICI TEYİDİ)
      const fillsRes = await fetch(`https://api.bitget.com/api/v2/mix/market/fills?symbol=${item.symbol}&productType=usdt-futures&limit=60`, { headers: browserHeaders })
        .then(r => r.json()).catch(() => ({}));

      const fills = fillsRes.data?.fillList || fillsRes.data || [];
      let buyUsd = 0;
      let sellUsd = 0;

      if (Array.isArray(fills)) {
        fills.forEach(f => {
          const val = parseFloat(f.price || 0) * parseFloat(f.size || 0);
          if (val >= 250) {
            if (f.side === 'buy') buyUsd += val;
            else sellUsd += val;
          }
        });
      }

      const totalFlow = buyUsd + sellUsd;
      const takerBuyRatio = totalFlow > 0 ? (buyUsd / totalFlow) * 100 : 50;
      const fundingRate = parseFloat(item.fundingRate || 0);

      // KESİN KURUMSAL DESTEK SIÇRAMA KURALI
      // 1. Fiyat 15 dakikalık ana destekte
      // 2. Destekte 1.8σ+ Z-Score hacim patlaması var
      // 3. Destek seviyesinde kurumsal işlemlerin en az %70'i alıcı yönünde
      // 4. Fonlama şişmemiş (FR <= 0.005)
      if (takerBuyRatio >= 70 && fundingRate <= 0.005) {
        candidateTrade = {
          symbol: item.symbol,
          direction: 'LONG',
          price: cur1m.close,
          supportLevel: majorSupport15m,
          volZScore: parseFloat(volZScore.toFixed(2)),
          takerBuyRatio: Math.round(takerBuyRatio),
          fundingRate: (fundingRate * 100).toFixed(4),
          reason: `15m grafiğindeki ana destek seviyesine ($${majorSupport15m < 1 ? majorSupport15m.toFixed(6) : majorSupport15m.toFixed(4)}) temas gerçekleşti. Destekte ${volZScore.toFixed(1)}σ Z-Score hacim anomalisi ve %${Math.round(takerBuyRatio)} balina alıcı süpürmesiyle taban sıçraması teyit edildi.`
        };
        break;
      }
    }

    if (!candidateTrade) {
      return res.status(200).json({ status: "SCANNING", message: "15m majör destek temasları ve hacim anomalileri taranıyor..." });
    }

    // 4. HEDEF VE STOP MATEMATİĞİ (DESTEK ALTI AKILLI STOP)
    const entryPrice = candidateTrade.price;
    const isLong = candidateTrade.direction === 'LONG';
    const tp1 = isLong ? entryPrice * 1.010 : entryPrice * 0.990; // +%1.00 Net
    const tp2 = isLong ? entryPrice * 1.020 : entryPrice * 0.980; // +%2.00 Net

    // Akıllı Destek Stopu: 15m Desteğinin %0.4 altı veya standart -%1.20 (Hangisi daha güvenliyse)
    const supportBasedSl = candidateTrade.supportLevel * 0.996;
    const sl = (supportBasedSl < entryPrice && supportBasedSl > entryPrice * 0.980) 
      ? supportBasedSl 
      : entryPrice * 0.988;

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
    const supStr = candidateTrade.supportLevel < 1 ? candidateTrade.supportLevel.toFixed(6) : candidateTrade.supportLevel.toFixed(4);

    const tgMsg = `⚡ <b>MINEORA SENTINEL | 15M DESTEK SIÇRAMA SİNYALİ</b>\n` +
                  `━━━━━━━━━━━━━━━━━━━━\n` +
                  `💎 <b>Parite:</b> #${candidateTrade.symbol}\n` +
                  `🧭 <b>Yön:</b> 🟢 LONG (Majör Destek Teması & Tepki)\n` +
                  `🧱 <b>15M Destek Seviyesi:</b> <code>$${supStr}</code>\n` +
                  `📊 <b>Hacim Anomalisi:</b> ${candidateTrade.volZScore}σ Z-Score\n` +
                  `⚡ <b>Balina Alıcı Gücü:</b> %${candidateTrade.takerBuyRatio}\n` +
                  `💵 <b>Giriş:</b> <code>$${pStr}</code>\n` +
                  `━━━━━━━━━━━━━━━━━━━━\n` +
                  `🎯 <b>Hızlı TP 1:</b> <code>$${tp1Str}</code> (+%1.00)\n` +
                  `🚀 <b>Hızlı TP 2:</b> <code>$${tp2Str}</code> (+%2.00)\n` +
                  `🛑 <b>Destek Altı Stop:</b> <code>$${slStr}</code>\n` +
                  `━━━━━━━━━━━━━━━━━━━━\n` +
                  `📊 <i>İstihbarat: ${candidateTrade.reason}</i>\n` +
                  `💡 <i>Strateji: Destekten sekme anında TP1 alındığında stop girişe çekilir, kalan kısım sıfır riskle izlenir.</i>\n` +
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
