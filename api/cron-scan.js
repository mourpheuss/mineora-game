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
    
    const LOCK_WINDOW_MS = 30 * 60 * 1000;       // 30 dk aktif takip
    const SAME_COIN_LOCK_MS = 60 * 60 * 1000;   // Aynı coine 1 saat kilit
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
                       `🏆 <b>Net Kâr:</b> <b>+%1.60</b> <i>(10x: +%16 | 20x: +%32)</i>\n` +
                       `━━━━━━━━━━━━━━━━━━━━\n` +
                       `✨ <i>Tüm hedeflere ulaşıldı, operasyon başarıyla tamamlandı.</i>\n` +
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
                       `💰 <b>Kâr:</b> <b>+%0.80</b> <i>(Kâr realize edilebilir)</i>\n` +
                       `🛡️ <b>Risk Yönetimi:</b> Stop-Loss giriş seviyesine (<code>$${entryPriceStr}</code>) çekildi. İşlem risksiz izleniyor!\n` +
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
                        `📉 <b>Zarar-Kes:</b> ${trade.tp1Hit ? '0.00% (Başa Baş Korundu)' : '-%0.70'}\n` +
                        `━━━━━━━━━━━━━━━━━━━━\n` +
                        `🛡️ <i>Sermaye korundu. Yeni kurumsal fırsat taranıyor.</i>`;

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
    // MODÜL 2: KURUMSAL LEVEL-2 TAHTA & BALİNA AKIŞ MOTORU
    // =========================================================================
    const openTradesCount = Object.values(activeTrades).filter(t => {
      if (!t || t.status !== 'OPEN') return false;
      const tTime = t.createdAt || 0;
      return (now - tTime) <= LOCK_WINDOW_MS;
    }).length;

    if (openTradesCount >= 2) {
      return res.status(200).json({ status: "IDLE", message: "Takipte aktif operasyonlar var; yeni sinyal beklemede." });
    }

    const EXCLUDED = ["BTCUSDT", "ETHUSDT", "SOLUSDT", "BNBUSDT", "XRPUSDT", "DOGEUSDT", "USDCUSDT"];
    const pool = tickersJson.data.filter(t => 
      t.symbol.endsWith("USDT") && 
      !EXCLUDED.includes(t.symbol) && 
      parseFloat(t.usdtVolume || 0) >= 600000
    );

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

      // KURAL 1: Kesinlikle sadece dip çeyrek (<= 0.30) veya tepe çeyrek (>= 0.72)
      const isDipZone = rangePosition <= 0.30;
      const isTopZone = rangePosition >= 0.72;
      if (!isDipZone && !isTopZone) continue;

      // 1. ADIM: LEVEL-2 DERİNLİK TAHTASI OKUMA (DUVAR KONTROLÜ)
      const depthRes = await fetch(`https://api.bitget.com/api/v2/mix/market/merge-depth?symbol=${item.symbol}&productType=usdt-futures&limit=15`, { headers: browserHeaders })
        .then(r => r.json()).catch(() => ({}));

      const bids = depthRes.data?.bids || [];
      const asks = depthRes.data?.asks || [];

      let totalBidVolume = 0;
      let totalAskVolume = 0;
      let maxAskWall = 0;
      let maxBidWall = 0;

      bids.forEach(b => {
        const sz = parseFloat(b[1] || 0);
        totalBidVolume += sz;
        if (sz > maxBidWall) maxBidWall = sz;
      });

      asks.forEach(a => {
        const sz = parseFloat(a[1] || 0);
        totalAskVolume += sz;
        if (sz > maxAskWall) maxAskWall = sz;
      });

      const totalDepth = totalBidVolume + totalAskVolume;
      if (totalDepth <= 0) continue;

      const bidDepthPct = (totalBidVolume / totalDepth) * 100;

      // 2. ADIM: SON TAPE AKIŞINDA BALİNA İŞLEMLERİNİ SÜZME
      const fillsRes = await fetch(`https://api.bitget.com/api/v2/mix/market/fills?symbol=${item.symbol}&productType=usdt-futures&limit=50`, { headers: browserHeaders })
        .then(r => r.json()).catch(() => ({}));

      const fills = fillsRes.data?.fillList || fillsRes.data || [];
      let whaleBuyUsd = 0;
      let whaleSellUsd = 0;

      if (Array.isArray(fills)) {
        fills.forEach(f => {
          const val = parseFloat(f.price || 0) * parseFloat(f.size || 0);
          // 250 USDT üzerindeki gerçek piyasa emirleri (bot süpürmelerini ve balinaları ayıklar)
          if (val >= 250) {
            if (f.side === 'buy') whaleBuyUsd += val;
            else whaleSellUsd += val;
          }
        });
      }

      const totalWhaleFlow = whaleBuyUsd + whaleSellUsd;
      const whaleBuyPct = totalWhaleFlow > 0 ? (whaleBuyUsd / totalWhaleFlow) * 100 : 50;

      // Açık Pozisyon (OI)
      const oiRes = await fetch(`https://api.bitget.com/api/v2/mix/market/open-interest?symbol=${item.symbol}&productType=usdt-futures`, { headers: browserHeaders })
        .then(r => r.json()).catch(() => ({}));
      const currentOI = parseFloat(oiRes.data?.openInterestList?.[0]?.size || oiRes.data?.[0]?.size || 0);

      // ================= SAĞLAM DIP LONG KRİTERİ =================
      // 1. Fiyat taban çeyreğinde (range <= 0.30)
      // 2. Alış derinliği tahtada üstün (bidDepthPct >= 55)
      // 3. Önünde engel devasa bir Ask Duvarı YOK (maxAskWall < totalBidVolume * 0.75)
      // 4. Balina emir akışı %60+ alıcı yönünde
      // 5. Fonlama pozitif değil (şişkinlik yok, <= 0.006)
      const isInstitutionalDipLong = isDipZone && 
                                     (bidDepthPct >= 55) && 
                                     (maxAskWall < totalBidVolume * 0.75) && 
                                     (whaleBuyPct >= 60) && 
                                     (fundingRate <= 0.006);

      // ================= SAĞLAM TEPE SHORT KRİTERİ =================
      // 1. Fiyat tepe çeyreğinde (range >= 0.72)
      // 2. Satış derinliği üstün (bidDepthPct <= 44)
      // 3. Altında destek duvarı zayıf
      // 4. Balina emir akışı %60+ satıcı yönünde
      // 5. Fonlama şişkin (>= 0.010)
      const isInstitutionalTopShort = isTopZone && 
                                      (bidDepthPct <= 44) && 
                                      (whaleBuyPct <= 38) && 
                                      (fundingRate >= 0.010);

      if (isInstitutionalDipLong) {
        candidate = item;
        direction = 'LONG';
        confidenceScore = Math.round(whaleBuyPct);
        oiSnapshot = currentOI;
        intelligenceReason = `Tahtanın ilk 15 kademesinde %${Math.round(bidDepthPct)} alış desteği kuruldu, önünde direnç duvarı yok. Balina emirleri %${confidenceScore} güçle dipte birikiyor.`;
        break;
      }

      if (isInstitutionalTopShort) {
        candidate = item;
        direction = 'SHORT';
        confidenceScore = Math.round(100 - whaleBuyPct);
        oiSnapshot = currentOI;
        intelligenceReason = `Tepe bölgede satış blokları tahtayı kilitledi. Alıcı derinliği %${Math.round(bidDepthPct)} seviyesine geriledi, kurumsal kâr satışı başladı.`;
        break;
      }
    }

    if (!candidate) {
      return res.status(200).json({ status: "SCANNING", message: "Tahta derinlikleri taranıyor; kurumsal taban bekleniyor." });
    }

    // 4. HEDEF VE STOP MATEMATİĞİ
    const entryPrice = parseFloat(candidate.lastPr);
    const isLong = direction === 'LONG';
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
      tp1Hit: false,
      score: confidenceScore,
      reason: intelligenceReason,
      oi: oiSnapshot,
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
      console.warn("Firebase log:", fbErr);
    }

    // 6. TELEGRAM BİLDİRİMİNİ GÖNDER
    const pStr = entryPrice < 1 ? entryPrice.toFixed(6) : entryPrice.toFixed(4);
    const tp1Str = tp1 < 1 ? tp1.toFixed(6) : tp1.toFixed(4);
    const tp2Str = tp2 < 1 ? tp2.toFixed(6) : tp2.toFixed(4);
    const slStr = sl < 1 ? sl.toFixed(6) : sl.toFixed(4);

    const tgMsg = `⚡ <b>MINEORA FLASH SCALP | DERİNLİK DOĞRULANMIŞ SİNYAL</b>\n` +
                  `━━━━━━━━━━━━━━━━━━━━\n` +
                  `💎 <b>Parite:</b> #${candidate.symbol}\n` +
                  `🧭 <b>Yön:</b> ${direction === 'LONG' ? '🟢 LONG (Taban Kurumsal Birikim)' : '🔴 SHORT (Tepe Dağıtım Reddi)'}\n` +
                  `⚡ <b>Balina Gücü:</b> %${confidenceScore}\n` +
                  `💵 <b>Giriş:</b> <code>$${pStr}</code>\n` +
                  `━━━━━━━━━━━━━━━━━━━━\n` +
                  `🎯 <b>Hızlı TP 1:</b> <code>$${tp1Str}</code> (+%0.80)\n` +
                  `🚀 <b>Hızlı TP 2:</b> <code>$${tp2Str}</code> (+%1.60)\n` +
                  `🛑 <b>Sıkı Stop:</b> <code>$${slStr}</code> (-%0.70)\n` +
                  `━━━━━━━━━━━━━━━━━━━━\n` +
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
