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
    
    const LOCK_WINDOW_MS = 30 * 60 * 1000;      // Hızlı döngü (30 dk)
    const SAME_COIN_LOCK_MS = 25 * 60 * 1000;   // 25 dk parite kilidi
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
    // MODÜL 1: CANLI İŞLEM TAKİP MOTORU (HIZLI TP1 / TP2 / STOP)
    // =========================================================================
    let tradeUpdates = [];
    for (const [tradeKey, trade] of Object.entries(activeTrades)) {
      if (!trade || trade.status !== 'OPEN') continue;

      const curPrice = priceMap[trade.symbol];
      if (!curPrice || curPrice <= 0) continue;

      const isLong = trade.direction === 'LONG';
      const curPriceStr = curPrice < 1 ? curPrice.toFixed(6) : curPrice.toFixed(4);
      const entryPriceStr = trade.entryPrice < 1 ? trade.entryPrice.toFixed(6) : trade.entryPrice.toFixed(4);

      // TP 2 KONTROLÜ (+%1.50)
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

        const tp2Msg = `🚀 <b>MINEORA FLASH | TP 2 TAM HEDEF ALINDI!</b>\n` +
                       `━━━━━━━━━━━━━━━━━━━━\n` +
                       `💎 <b>Parite:</b> #${trade.symbol}\n` +
                       `🧭 <b>Pozisyon:</b> ${isLong ? '🟢 LONG' : '🔴 SHORT'}\n` +
                       `💵 <b>Giriş:</b> <code>$${entryPriceStr}</code>\n` +
                       `🏁 <b>Kapanış:</b> <code>$${curPriceStr}</code>\n` +
                       `🏆 <b>Net Kâr:</b> <b>+%1.50</b> <i>(10x: +%15 | 20x: +%30)</i>\n` +
                       `━━━━━━━━━━━━━━━━━━━━\n` +
                       `⚡ <i>Patlama dalgası zirvede nakde dönüştü. Vur ve kaç!</i>\n` +
                       `📢 <i>Kanal: <a href="https://t.me/mineorabalina">t.me/mineorabalina</a></i>`;

        await fetch(`https://api.telegram.org/bot${TG_BOT_TOKEN}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ chat_id: TG_CHANNEL_ID, text: tp2Msg, parse_mode: 'HTML' })
        }).catch(() => {});
        continue;
      }

      // TP 1 KONTROLÜ (+%0.80)
      const isTp1Hit = isLong ? (curPrice >= trade.tp1) : (curPrice <= trade.tp1);
      if (isTp1Hit && !trade.tp1Hit) {
        trade.tp1Hit = true;
        trade.sl = trade.entryPrice; // Stop doğrudan girişe çekilir
        tradeUpdates.push(
          fetch(`${FIREBASE_BASE_URL}/active_trades/${tradeKey}.json`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(trade)
          })
        );

        const tp1Msg = `🎯 <b>MINEORA FLASH | HEDEF 1 (TP1) VURULDU!</b>\n` +
                       `━━━━━━━━━━━━━━━━━━━━\n` +
                       `💎 <b>Parite:</b> #${trade.symbol}\n` +
                       `🧭 <b>Pozisyon:</b> ${isLong ? '🟢 LONG' : '🔴 SHORT'}\n` +
                       `💵 <b>Giriş:</b> <code>$${entryPriceStr}</code>\n` +
                       `⚡ <b>Anlık:</b> <code>$${curPriceStr}</code>\n` +
                       `💰 <b>Hızlı Kâr:</b> <b>+%0.80</b> <i>(Pozisyonun yarısı kapatılabilir)</i>\n` +
                       `🛡️ <b>Savunma:</b> Stop başa baş seviyesine çekildi. Risk sıfırlandı!\n` +
                       `━━━━━━━━━━━━━━━━━━━━\n` +
                       `📢 <i>Kanal: <a href="https://t.me/mineorabalina">t.me/mineorabalina</a></i>`;

        await fetch(`https://api.telegram.org/bot${TG_BOT_TOKEN}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ chat_id: TG_CHANNEL_ID, text: tp1Msg, parse_mode: 'HTML' })
        }).catch(() => {});
        continue;
      }

      // STOP KONTROLÜ (-%0.85)
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

        const stopMsg = `🛑 <b>MINEORA FLASH | HIZLI STOP ÇIKIŞI</b>\n` +
                        `━━━━━━━━━━━━━━━━━━━━\n` +
                        `💎 <b>Parite:</b> #${trade.symbol}\n` +
                        `🧭 <b>Pozisyon:</b> ${isLong ? '🟢 LONG' : '🔴 SHORT'}\n` +
                        `💵 <b>Giriş:</b> <code>$${entryPriceStr}</code>\n` +
                        `🛑 <b>Çıkış:</b> <code>$${curPriceStr}</code>\n` +
                        `📉 <b>Durum:</b> ${trade.tp1Hit ? '0.00% (Başa Baş Korundu)' : '-%0.85 Disiplin Çıkışı'}\n` +
                        `━━━━━━━━━━━━━━━━━━━━\n` +
                        `🛡️ <i>Beklenen ivme 3 dakikada gelmedi, sermaye korundu. Yeni patlama taranıyor.</i>`;

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
    // MODÜL 2: 3 DAKİKALIK PATLAMA RADARI (FLASH-SCALP DENGESİZLİK MOTORU)
    // =========================================================================
    const openTradesCount = Object.values(activeTrades).filter(t => {
      if (!t || t.status !== 'OPEN') return false;
      const tTime = t.createdAt || 0;
      return (now - tTime) <= LOCK_WINDOW_MS;
    }).length;

    if (openTradesCount >= 3) {
      return res.status(200).json({ status: "IDLE", message: "Takipte 3 aktif hızlı operasyon var." });
    }

    // TradFi, Hisse, ETF ve Emtia Filtresi
    const TRADFI_BLACKLIST = [
      "OPENAI", "ANTHROPIC", "KORU", "XAU", "XAG", "SPX", "NDX", "DJI",
      "NVDA", "TSLA", "AAPL", "AMZN", "MSFT", "GOOG", "META", "COIN",
      "BGBUSDT", "USDCUSDT", "EURUSDT", "GBPUSDT", "TUSDT", "CLUSDT"
    ];

    // 600.000$ ve üzeri hacimli gerçek kripto altcoinler
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

    for (const item of pool) {
      const lastSentTime = lastSignals[item.symbol] || 0;
      if (now - lastSentTime < SAME_COIN_LOCK_MS) continue;

      // 1. ADIM: SON 15 MUM (1m Periyot - Mikro 180 Saniyelik Dinamik)
      const candles1mRes = await fetch(`https://api.bitget.com/api/v2/mix/market/candles?symbol=${item.symbol}&productType=USDT-FUTURES&granularity=1m&limit=15`, { headers: browserHeaders })
        .then(r => r.json()).catch(() => ({}));

      if (candles1mRes.code !== '00000' || !Array.isArray(candles1mRes.data) || candles1mRes.data.length < 10) continue;

      const candles1m = candles1mRes.data.map(c => ({
        time: Math.floor(Number(c[0]) / 1000),
        open: Number(c[1]),
        high: Number(c[2]),
        low: Number(c[3]),
        close: Number(c[4]),
        volume: Number(c[5])
      })).sort((a, b) => a.time - b.time);

      const cur1m = candles1m[candles1m.length - 1];
      const c3mBack = candles1m[candles1m.length - 3]; // 3 dakika önceki mum
      const prev1m = candles1m.slice(0, -1);

      // ŞART 1: FİYAT TAM KİLİTLİ OLMALI (Son 3 dk dalgalanma <= %0.35)
      // Fiyat fırlamışsa trene binilmez; kuluçkada bekleyecek!
      const priceChange3m = Math.abs(((cur1m.close - c3mBack.close) / c3mBack.close) * 100);
      if (priceChange3m > 0.35) continue;

      // ŞART 2: HACİM PATLAMASI (1m Hacim Z-Score >= 2.0σ)
      const volZScore = calculateZScore(prev1m.map(c => c.volume), cur1m.volume);
      if (volZScore < 2.0) continue; // Fiyat kıpırdamazken hacim şoku yaşanmıyorsa atla

      // ŞART 3: SON TAPE AKIŞINDA GİZLİ SÜPÜRME (Absorption / Taker Surge)
      const fillsRes = await fetch(`https://api.bitget.com/api/v2/mix/market/fills?symbol=${item.symbol}&productType=usdt-futures&limit=60`, { headers: browserHeaders })
        .then(r => r.json()).catch(() => ({}));

      const fills = fillsRes.data?.fillList || fillsRes.data || [];
      if (!Array.isArray(fills) || fills.length < 15) continue;

      let buyUsd = 0;
      let sellUsd = 0;
      let tradeCount = 0;

      fills.forEach(f => {
        const val = parseFloat(f.price || 0) * parseFloat(f.size || 0);
        if (val >= 200) {
          tradeCount++;
          if (f.side === 'buy') buyUsd += val;
          else sellUsd += val;
        }
      });

      const totalFlow = buyUsd + sellUsd;
      if (totalFlow <= 0 || tradeCount < 10) continue;

      const takerBuyRatio = (buyUsd / totalFlow) * 100;
      const fundingRate = parseFloat(item.fundingRate || 0);

      // ================= TETİK A: 3 DK ÖNCESİ LONG PATLAMASI =================
      // Fiyat kilitli + Hacim 2.0σ+ patlamış + Alıcılar %72+ baskın + Fonlama şişmemiş
      if (takerBuyRatio >= 72 && fundingRate <= 0.005) {
        candidateTrade = {
          symbol: item.symbol,
          direction: 'LONG',
          price: cur1m.close,
          volZScore: parseFloat(volZScore.toFixed(2)),
          takerRatio: Math.round(takerBuyRatio),
          priceChange3m: priceChange3m.toFixed(2),
          reason: `Son 3 dk fiyat dalgalanması sadece %${priceChange3m.toFixed(2)} (Kilitli Taban). Tahtada ${volZScore.toFixed(1)}σ Z-Score hacim şoku ve %${Math.round(takerBuyRatio)} kurumsal piyasa alımıyla fitil başlangıcı teyit edildi.`
        };
        break;
      }

      // ================= TETİK B: 3 DK ÖNCESİ SHORT PATLAMASI =================
      // Fiyat kilitli + Hacim 2.0σ+ patlamış + Satıcılar %72+ baskın + Fonlama pozitif şişkin
      if (takerBuyRatio <= 28 && fundingRate >= 0.001) {
        candidateTrade = {
          symbol: item.symbol,
          direction: 'SHORT',
          price: cur1m.close,
          volZScore: parseFloat(volZScore.toFixed(2)),
          takerRatio: Math.round(100 - takerBuyRatio),
          priceChange3m: priceChange3m.toFixed(2),
          reason: `Son 3 dk fiyat dalgalanması sadece %${priceChange3m.toFixed(2)} (Kilitli Zirve). Tahtada ${volZScore.toFixed(1)}σ Z-Score hacim şoku ve %${Math.round(100 - takerBuyRatio)} kurumsal piyasa satışı ile long tasfiyesi tetiklendi.`
        };
        break;
      }
    }

    if (!candidateTrade) {
      return res.status(200).json({ status: "SCANNING", message: "3 dakikalık sıkışma ve hacim şokları taranıyor..." });
    }

    // 4. HEDEF VE STOP MATEMATİĞİ (VUR-KAÇ MATEMATİĞİ)
    const entryPrice = candidateTrade.price;
    const isLong = candidateTrade.direction === 'LONG';
    const tp1 = isLong ? entryPrice * 1.0080 : entryPrice * 0.9920; // +%0.80 Hızlı TP
    const tp2 = isLong ? entryPrice * 1.0150 : entryPrice * 0.9850; // +%1.50 Geniş TP
    const sl  = isLong ? entryPrice * 0.9915 : entryPrice * 1.0085; // -%0.85 Sıkı Stop

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

    const tgMsg = `⚡ <b>MINEORA FLASH | 3 DK VUR-KAÇ ALARMI</b>\n` +
                  `━━━━━━━━━━━━━━━━━━━━\n` +
                  `💎 <b>Parite:</b> #${candidateTrade.symbol}\n` +
                  `🧭 <b>Pozisyon:</b> ${isLong ? '🟢 LONG (Kilitli Taban Sıçraması)' : '🔴 SHORT (Kilitli Zirve Çöküşü)'}\n` +
                  `📊 <b>Hacim Şoku:</b> ${candidateTrade.volZScore}σ Z-Score\n` +
                  `⚡ <b>Kurumsal Akış:</b> %${candidateTrade.takerRatio}\n` +
                  `🔒 <b>3 Dk Sıkışma:</b> %${candidateTrade.priceChange3m} (Fitil Henüz Başlamadı)\n` +
                  `💵 <b>Giriş:</b> <code>$${pStr}</code>\n` +
                  `━━━━━━━━━━━━━━━━━━━━\n` +
                  `🎯 <b>Hızlı TP 1:</b> <code>$${tp1Str}</code> (+%0.80)\n` +
                  `🚀 <b>Hızlı TP 2:</b> <code>$${tp2Str}</code> (+%1.50)\n` +
                  `🛑 <b>Sıkı Savunma:</b> <code>$${slStr}</code> (-%0.85)\n` +
                  `━━━━━━━━━━━━━━━━━━━━\n` +
                  `📊 <i>İstihbarat: ${candidateTrade.reason}</i>\n` +
                  `💡 <i>Kural: TP1 alındığı an stop girişe çekilir. Hızlı vur ve kârı alıp çekil!</i>\n` +
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
