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
    const SAME_COIN_LOCK_MS = 40 * 60 * 1000;
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
                       `✨ <i>Seviye tepki operasyonu başarıyla tamamlandı.</i>\n` +
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
                       `🛡️ <b>Risk Yönetimi:</b> Stop-Loss başabaş seviyesine çekildi. Risk sıfırlandı!\n` +
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
                        `📉 <b>Zarar-Kes:</b> ${trade.tp1Hit ? '0.00% (Başa Baş Korundu)' : 'Seviye İhlali Koruma Çıkışı'}\n` +
                        `━━━━━━━━━━━━━━━━━━━━\n` +
                        `🛡️ <i>Sermaye korundu. Yeni majör seviye taranıyor.</i>`;

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
    // MODÜL 2: TÜM HAVUZ (600K+ HACİM) 15M DESTEK/DİRENÇ + PARABOLİK KALKAN
    // =========================================================================
    const openTradesCount = Object.values(activeTrades).filter(t => {
      if (!t || t.status !== 'OPEN') return false;
      const tTime = t.createdAt || 0;
      return (now - tTime) <= LOCK_WINDOW_MS;
    }).length;

    if (openTradesCount >= 4) {
      return res.status(200).json({ status: "IDLE", message: "Takipte 4 aktif operasyon var; yeni sinyal beklemede." });
    }

    // TradFi, Hisse, ETF ve Emtia Filtresi
    const TRADFI_BLACKLIST = [
      "OPENAI", "ANTHROPIC", "KORU", "XAU", "XAG", "SPX", "NDX", "DJI",
      "NVDA", "TSLA", "AAPL", "AMZN", "MSFT", "GOOG", "META", "COIN",
      "BGBUSDT", "USDCUSDT", "EURUSDT", "GBPUSDT", "TUSDT", "CLUSDT"
    ];

    // 600.000$ ve üzeri hacimli tüm gerçek kriptolar
    const pool = tickersJson.data.filter(c => {
      if (!c.symbol.endsWith("USDT")) return false;
      const vol = parseFloat(c.usdtVolume || c.quoteVolume || 0);
      if (vol < 600000) return false;

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

    // TÜM HAVUZU TARA
    for (const item of pool) {
      const lastSentTime = lastSignals[item.symbol] || 0;
      if (now - lastSentTime < SAME_COIN_LOCK_MS) continue;

      // 24 SAATLİK DEĞİŞİM ORANI (PARABOLİK PUMP/DUMP KALKANI)
      const chg24h = parseFloat(item.change24h || 0) * 100;

      // 1. ADIM: 15 DAKİKALIK MUMLAR (DESTEK & DİRENÇ HARİTASI)
      const candles15mRes = await fetch(`https://api.bitget.com/api/v2/mix/market/candles?symbol=${item.symbol}&productType=USDT-FUTURES&granularity=15m&limit=35`, { headers: browserHeaders })
        .then(r => r.json()).catch(() => ({}));

      if (candles15mRes.code !== '00000' || !Array.isArray(candles15mRes.data) || candles15mRes.data.length < 20) continue;

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

      const pastLows = prev15mList.map(c => c.low);
      const pastHighs = prev15mList.map(c => c.high);
      const majorSupport15m = Math.min(...pastLows.slice(-18));
      const majorResistance15m = Math.max(...pastHighs.slice(-18));

      // Konum Testi: Destekte mi yoksa Dirençte mi?
      const isAtSupport = (cur15m.low <= majorSupport15m * 1.004) && (cur15m.close >= majorSupport15m * 0.997);
      const isAtResistance = (cur15m.high >= majorResistance15m * 0.996) && (cur15m.close <= majorResistance15m * 1.003);

      if (!isAtSupport && !isAtResistance) continue;

      // PARABOLİK TREND KORUMASI:
      // - 24 saatte %8'den fazla fırlamışsa ASLA SHORT açma (CAPUSDT hatası)
      // - 24 saatte %8'den fazla çökmüşse ASLA LONG açma (Düşen bıçak)
      if (isAtResistance && chg24h >= 8.0) continue;
      if (isAtSupport && chg24h <= -8.0) continue;

      // 2. ADIM: 1 DAKİKALIK MİKRO TAHTA & Z-SCORE
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

      const volZScore = calculateZScore(prev1m.map(c => c.volume), cur1m.volume);
      if (volZScore < 1.6) continue;

      // 3. ADIM: BALİNA VE TAPE AKIŞI
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

      // ================= SENARYO A: DESTEKTEN LONG (ICNT MODELİ) =================
      if (isAtSupport && takerBuyRatio >= 68 && fundingRate <= 0.006) {
        candidateTrade = {
          symbol: item.symbol,
          direction: 'LONG',
          price: cur1m.close,
          keyLevel: majorSupport15m,
          volZScore: parseFloat(volZScore.toFixed(2)),
          takerRatio: Math.round(takerBuyRatio),
          reason: `15m majör destek seviyesine ($${majorSupport15m < 1 ? majorSupport15m.toFixed(6) : majorSupport15m.toFixed(4)}) temas etti. Destekte ${volZScore.toFixed(1)}σ Z-Score hacim patlaması ve %${Math.round(takerBuyRatio)} kurumsal alıcı süpürmesi teyit edildi.`
        };
        break;
      }

      // ================= SENARYO B: DİRENÇTEN SHORT (DENGELİ DİRENÇ MODELİ) =================
      if (isAtResistance && takerBuyRatio <= 32 && fundingRate >= 0.002) {
        candidateTrade = {
          symbol: item.symbol,
          direction: 'SHORT',
          price: cur1m.close,
          keyLevel: majorResistance15m,
          volZScore: parseFloat(volZScore.toFixed(2)),
          takerRatio: Math.round(100 - takerBuyRatio),
          reason: `15m majör direnç seviyesine ($${majorResistance15m < 1 ? majorResistance15m.toFixed(6) : majorResistance15m.toFixed(4)}) temas etti. Dirençte kurumsal satış duvarı oluştu ve %${Math.round(100 - takerBuyRatio)} satıcı baskısıyla reddedilme başladı.`
        };
        break;
      }
    }

    if (!candidateTrade) {
      return res.status(200).json({ status: "SCANNING", message: "Tüm vadeli havuzda (600k+ hacim) 15m destek/direnç fırsatları taranıyor..." });
    }

    // 4. HEDEF VE STOP SEVİYELERİ
    const entryPrice = candidateTrade.price;
    const isLong = candidateTrade.direction === 'LONG';
    const tp1 = isLong ? entryPrice * 1.010 : entryPrice * 0.990;
    const tp2 = isLong ? entryPrice * 1.020 : entryPrice * 0.980;

    let sl = isLong ? candidateTrade.keyLevel * 0.996 : candidateTrade.keyLevel * 1.004;
    if (isLong && (sl >= entryPrice || sl < entryPrice * 0.985)) sl = entryPrice * 0.988;
    if (!isLong && (sl <= entryPrice || sl > entryPrice * 1.015)) sl = entryPrice * 1.012;

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
      score: candidateTrade.takerRatio,
      reason: candidateTrade.reason,
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
        fetch(`${FIREBASE_BASE_URL}/last_signals/${candidateTrade.symbol}.json`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(now)
        })
      ]);
    } catch (fbErr) {}

    // 6. Telegram Bildirimi
    const pStr = entryPrice < 1 ? entryPrice.toFixed(6) : entryPrice.toFixed(4);
    const tp1Str = tp1 < 1 ? tp1.toFixed(6) : tp1.toFixed(4);
    const tp2Str = tp2 < 1 ? tp2.toFixed(6) : tp2.toFixed(4);
    const slStr = sl < 1 ? sl.toFixed(6) : sl.toFixed(4);
    const lvlStr = candidateTrade.keyLevel < 1 ? candidateTrade.keyLevel.toFixed(6) : candidateTrade.keyLevel.toFixed(4);

    const tgMsg = `⚡ <b>MINEORA SENTINEL | ${isLong ? '15M DESTEK SIÇRAMA' : '15M DİRENÇ REDDİ'}</b>\n` +
                  `━━━━━━━━━━━━━━━━━━━━\n` +
                  `💎 <b>Parite:</b> #${candidateTrade.symbol}\n` +
                  `🧭 <b>Yön:</b> ${isLong ? '🟢 LONG (Majör Destek Sekmesi)' : '🔴 SHORT (Majör Direnç Dağıtımı)'}\n` +
                  `🧱 <b>Kritik 15M Seviye:</b> <code>$${lvlStr}</code>\n` +
                  `📊 <b>Hacim Anomalisi:</b> ${candidateTrade.volZScore}σ Z-Score\n` +
                  `⚡ <b>Kurumsal Güç:</b> %${candidateTrade.takerRatio}\n` +
                  `💵 <b>Giriş:</b> <code>$${pStr}</code>\n` +
                  `━━━━━━━━━━━━━━━━━━━━\n` +
                  `🎯 <b>Hızlı TP 1:</b> <code>$${tp1Str}</code> (+%1.00)\n` +
                  `🚀 <b>Hızlı TP 2:</b> <code>$${tp2Str}</code> (+%2.00)\n` +
                  `🛑 <b>Seviye Stopu:</b> <code>$${slStr}</code>\n` +
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
