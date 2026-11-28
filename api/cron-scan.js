export const config = {
  maxDuration: 60
};

export default async function handler(req, res) {
  try {
    // =========================================================================
    // 0. TELEGRAM, FIREBASE & DOĞRUDAN XM GLOBAL MT5 PARAMETRELERİ (93-XM V3.2)
    // =========================================================================
    const TG_BOT_TOKEN = "8682225307:AAHaa-hieKBBluU6uZ2_-OgSPxGR7OwMssE";
    const TG_CHANNEL_ID = "-1004404988937";
    const TG_ADMIN_ID = "6457294906";
    const FIREBASE_BASE_URL = "https://mineora-web-default-rtdb.firebaseio.com";

    const MT5_SYMBOL = "GOLD";                  // XM GLOBAL MT5 SEMBOL ADI
    const LOT_SIZE = 0.25;                      // KASA KORUMALI LOT (0.25 LOT -> +$60 TP / -$250 SL)
    const TP_DOLLAR = 4.00;                     // HIZLI TAKE-PROFIT (+$4.00)
    const SL_DOLLAR = 10.00;                    // STOP-LOSS (-$10.00)
    const MAX_ALLOWED_SPREAD = 0.80;            // MAKS. İZİN VERİLEN CANLI XM SPREAD ($0.80)
    const MIN_WICK_RATIO = 0.42;                // EN AZ %42 LİKİDİTE FİTİLİ (93 MATEMATİĞİ)
    const MIN_BOX_RANGE = 1.60;                 // EN AZ $1.60 KUTU GENİŞLİĞİ (93 MATEMATİĞİ)
    const MAX_ENTRY_CHASE = 1.25;               // AVLANAN SEVİYEDEN MAKS. $1.25 UZAKLIK (GEÇ GİRİŞ ENGELİ)
    const MIN_EMA_SLOPE = 0.35;                 // 8 BARDA EN AZ $0.35 NET EMA 60 EĞİMİ (YATAY KİLİT)
    const MIN_EMA_BUFFER = 1.20;                // FİYAT İLE EMA 60 ARASI EN AZ $1.20 TEMİZ MESAFE
    const SIGNAL_COOLDOWN_MS = 5 * 60 * 1000;   // SİNYALLER ARASI 5 DK SOĞUMA SÜRESİ
    const MAX_FEED_STALE_MS = 35 * 1000;        // XM VERİSİ 35 SN'DEN ESKİYSE BEKLE
    const startTime = Date.now();

    async function sendTelegramAlert(text) {
      const targets = [TG_CHANNEL_ID, TG_ADMIN_ID];
      for (const target of targets) {
        try {
          await fetch(`https://api.telegram.org/bot${TG_BOT_TOKEN}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ chat_id: target, text, parse_mode: 'HTML' })
          });
        } catch (e) {}
      }
    }

    function calculateEMA(data, period = 60) {
      if (!data || data.length === 0) return 0;
      const k = 2 / (period + 1);
      let ema = data[0].close;
      for (let i = 1; i < data.length; i++) {
        ema = data[i].close * k + ema * (1 - k);
      }
      return ema;
    }

    function predictExpectedMove(boxRange, wickPct, isNySession) {
      const baseMove = boxRange * 0.75;
      const wickMult = wickPct >= 65 ? 1.25 : 1.05;
      const trendMult = 1.35;
      const sessionMult = isNySession ? 1.30 : 1.00;
      const expected = baseMove * wickMult * trendMult * sessionMult;
      return parseFloat(Math.max(TP_DOLLAR, expected).toFixed(2));
    }

    function getTurkeyDateObj(ts = Date.now()) {
      return new Date(ts + 3 * 3600 * 1000);
    }

    function formatTrDateKey(dateObj) {
      const y = dateObj.getUTCFullYear();
      const m = String(dateObj.getUTCMonth() + 1).padStart(2, '0');
      const d = String(dateObj.getUTCDate()).padStart(2, '0');
      return `${y}-${m}-${d}`;
    }

    const nowUtc3 = getTurkeyDateObj();
    const dayOfWeek = nowUtc3.getUTCDay();
    const hourUtc3 = nowUtc3.getUTCHours();
    const minUtc3 = nowUtc3.getUTCMinutes();
    const hourDec = hourUtc3 + minUtc3 / 60;

    // =========================================================================
    // 1. GECE 00:00 GÜNLÜK ÖZET RAPORU (TEK SEFERLİK KİLİT MEKANİZMALI)
    // =========================================================================
    if (hourUtc3 === 0 && minUtc3 <= 5) {
      const yesterdayUtc3 = getTurkeyDateObj(Date.now() - 12 * 3600 * 1000);
      const reportDateKey = formatTrDateKey(yesterdayUtc3);

      const lastReportRes = await fetch(`${FIREBASE_BASE_URL}/last_daily_summary_date.json`);
      const lastSentDate = await lastReportRes.json();

      if (lastSentDate !== reportDateKey) {
        await fetch(`${FIREBASE_BASE_URL}/last_daily_summary_date.json`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(reportDateKey)
        });

        const gsRes = await fetch(`${FIREBASE_BASE_URL}/gold_signals.json`);
        const allSignals = (await gsRes.json()) || {};
        const daySignals = Object.values(allSignals).filter(s => {
          if (!s || !s.createdAt) return false;
          return formatTrDateKey(getTurkeyDateObj(s.createdAt)) === reportDateKey;
        });

        let tpCount = 0;
        let slCount = 0;
        let openCount = 0;
        let totalDollarMove = 0;
        let totalNetUsd = 0;

        for (const s of daySignals) {
          const sigLot = s.lotSize || LOT_SIZE;
          if (s.status === 'TP_HIT') {
            tpCount++;
            const move = s.realizedDollar || TP_DOLLAR;
            totalDollarMove += move;
            totalNetUsd += move * sigLot * 100;
          } else if (s.status === 'SL_HIT') {
            slCount++;
            const move = s.realizedDollar || -SL_DOLLAR;
            totalDollarMove += move;
            totalNetUsd += move * sigLot * 100;
          } else if (s.status === 'OPEN') {
            openCount++;
          }
        }

        const totalClosed = tpCount + slCount;
        const winRate = totalClosed > 0 ? Math.round((tpCount / totalClosed) * 100) : 0;
        const signPrefix = totalDollarMove >= 0 ? "+" : "";

        const summaryMsg =
          `📊 <b>GÜNLÜK XAUUSD SİNYAL ÖZETİ (${reportDateKey})</b>\n` +
          `━━━━━━━━━━━━━━━━━━━━\n` +
          `📌 <b>Toplam Üretilen Sinyal:</b> ${daySignals.length} Adet\n` +
          `🎯 <b>Başarılı (TP):</b> ${tpCount} Adet\n` +
          `🛑 <b>Stop-Loss (SL):</b> ${slCount} Adet\n` +
          `⏳ <b>Açık Kalan:</b> ${openCount} Adet\n` +
          `📈 <b>Başarı Oranı:</b> %${winRate}\n` +
          `━━━━━━━━━━━━━━━━━━━━\n` +
          `💰 <b>Net Ons Hareketi:</b> <b>${signPrefix}$${totalDollarMove.toFixed(2)}</b>\n` +
          `💵 <b>Net Lot Karşılığı (${LOT_SIZE.toFixed(2)} Lot):</b> <b>${totalNetUsd >= 0 ? '+' : ''}$${totalNetUsd.toFixed(2)}</b>\n` +
          `⚡ <i>Sistem 24 saat kesintisiz taramaya devam etmektedir.</i>`;

        await sendTelegramAlert(summaryMsg);
      }
    }

    // =========================================================================
    // 2. HAFTA SONU PİYASA KAPALI KONTROLÜ
    // =========================================================================
    if (dayOfWeek === 0 || dayOfWeek === 6) {
      return res.status(200).json({ status: "WEEKEND_CLOSED", message: "Hafta sonu altın piyasası kapalı." });
    }

    const isNySession = hourDec >= 15.5 && hourDec <= 19.5;
    const isFridayCloseLock = (dayOfWeek === 5 && hourDec >= 22.5);

    // =========================================================================
    // 3. DOĞRUDAN XM GLOBAL MT5 CANLI FİYAT VE M1 MUM VERİSİ (VPS BRIDGE)
    // =========================================================================
    async function fetchXmMt5GoldData() {
      try {
        const feedRes = await fetch(`${FIREBASE_BASE_URL}/mt5_live_feed.json`);
        const feed = await feedRes.json();

        if (!feed || !Array.isArray(feed.candles) || feed.candles.length < 75) {
          return null;
        }

        const ageMs = Date.now() - (feed.updatedAt || 0);
        if (ageMs > MAX_FEED_STALE_MS) {
          return { stale: true, ageSec: Math.round(ageMs / 1000) };
        }

        const candles = feed.candles.map(c => ({
          time: Number(c.time),
          open: Number(c.open),
          high: Number(c.high),
          low: Number(c.low),
          close: Number(c.close)
        })).sort((a, b) => a.time - b.time);

        const bid = Number(feed.bid) || candles[candles.length - 1].close;
        const ask = Number(feed.ask) || candles[candles.length - 1].close;
        const currentPrice = Number(feed.mid) || candles[candles.length - 1].close;
        const spread = parseFloat((ask - bid).toFixed(2));

        return {
          stale: false,
          currentPrice,
          bid,
          ask,
          spread,
          candles,
          source: `XM_MT5:${feed.server || "XMGlobal"}`
        };
      } catch (e) {
        return null;
      }
    }

    const goldData = await fetchXmMt5GoldData();

    if (!goldData) {
      return res.status(200).json({
        status: "WAITING_XM_MT5_FEED",
        message: "VPS mt5_bridge.py üzerinden XM Global MT5 mum verisi bekleniyor."
      });
    }

    if (goldData.stale) {
      return res.status(200).json({
        status: "STALE_XM_MT5_FEED",
        ageSec: goldData.ageSec,
        message: `XM MT5 verisi ${goldData.ageSec} saniyedir güncellenmedi; VPS mt5_bridge.py kontrol edilmeli.`
      });
    }

    // =========================================================================
    // 4. FIREBASE ÜZERİNDEN AÇIK SİNYALLERİ ÇEK
    // =========================================================================
    let goldSignals = {};
    let lastSignalTimestamp = 0;

    try {
      const [gsRes, lsRes] = await Promise.all([
        fetch(`${FIREBASE_BASE_URL}/gold_signals.json`),
        fetch(`${FIREBASE_BASE_URL}/last_gold_signal_ts.json`)
      ]);
      goldSignals = (await gsRes.json()) || {};
      lastSignalTimestamp = (await lsRes.json()) || 0;
    } catch (e) {
      goldSignals = {};
      lastSignalTimestamp = 0;
    }

    // =========================================================================
    // MODÜL 1: XM GLOBAL MT5 GERÇEK TP VE SL DENETLEYİCİSİ
    // =========================================================================
    async function evaluateOpenGoldSignals(xmData) {
      let openCount = 0;

      for (const [sigKey, sig] of Object.entries(goldSignals)) {
        if (!sig || sig.status !== 'OPEN') continue;
        openCount++;

        const isBuy = sig.direction === 'BUY';
        const entryRef = Number(sig.mt5EntryPrice || sig.entry);
        const closeCheckPrice = isBuy ? xmData.bid : xmData.ask;
        const diffDollar = isBuy ? (closeCheckPrice - entryRef) : (entryRef - closeCheckPrice);

        const targetTp = sig.tp ? Math.abs(sig.tp - sig.entry) : TP_DOLLAR;
        const targetSl = sig.sl ? Math.abs(sig.sl - sig.entry) : SL_DOLLAR;

        const isClosedOnMt5 = sig.mt5Closed === true;
        const realizedMove = isClosedOnMt5 && sig.mt5RealizedDollar !== undefined
          ? Number(sig.mt5RealizedDollar)
          : diffDollar;
        const finalExitPrice = isClosedOnMt5 && sig.mt5ClosePrice
          ? Number(sig.mt5ClosePrice)
          : closeCheckPrice;

        if ((isClosedOnMt5 && realizedMove > 0) || diffDollar >= targetTp) {
          sig.status = 'TP_HIT';
          sig.exitPrice = finalExitPrice;
          sig.closedAt = Date.now();
          sig.realizedDollar = parseFloat(realizedMove.toFixed(2));

          const usedLot = sig.lotSize || LOT_SIZE;
          const estNetUsd = sig.mt5ProfitUsd !== undefined
            ? Number(sig.mt5ProfitUsd).toFixed(2)
            : (realizedMove * usedLot * 100).toFixed(2);

          const tpMsg =
            `🎯 <b>XAUUSD (GOLD) | TP GELDİ (+$${targetTp.toFixed(2)})</b>\n` +
            `━━━━━━━━━━━━━━━━━━━━\n` +
            `🧭 <b>İşlem Yönü:</b> ${isBuy ? '🟢 BUY (LONG)' : '🔴 SELL (SHORT)'}\n` +
            `💵 <b>XM Giriş Fiyatı:</b> <code>$${entryRef.toFixed(2)}</code>\n` +
            `🏁 <b>XM TP Kapanış:</b> <code>$${finalExitPrice.toFixed(2)}</code>\n` +
            `💰 <b>Kazanç:</b> <b>+$${Math.abs(realizedMove).toFixed(2)} Ons</b> (${usedLot.toFixed(2)} Lot: <b>+$${estNetUsd}</b>)\n` +
            `✅ <i>XM Global MT5 üzerinde hızlı hedef tamamlandı!</i>`;

          await sendTelegramAlert(tpMsg);

          await fetch(`${FIREBASE_BASE_URL}/gold_signals/${sigKey}.json`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(sig)
          });
          openCount--;
          continue;
        }

        if ((isClosedOnMt5 && realizedMove <= 0) || diffDollar <= -targetSl) {
          sig.status = 'SL_HIT';
          sig.exitPrice = finalExitPrice;
          sig.closedAt = Date.now();
          sig.realizedDollar = parseFloat(realizedMove.toFixed(2));

          const usedLot = sig.lotSize || LOT_SIZE;
          const estLossUsd = sig.mt5ProfitUsd !== undefined
            ? Math.abs(Number(sig.mt5ProfitUsd)).toFixed(2)
            : Math.abs(realizedMove * usedLot * 100).toFixed(2);

          const slMsg =
            `🛑 <b>XAUUSD (GOLD) | SL GELDİ (-$${targetSl.toFixed(2)})</b>\n` +
            `━━━━━━━━━━━━━━━━━━━━\n` +
            `🧭 <b>İşlem Yönü:</b> ${isBuy ? '🟢 BUY (LONG)' : '🔴 SELL (SHORT)'}\n` +
            `💵 <b>XM Giriş Fiyatı:</b> <code>$${entryRef.toFixed(2)}</code>\n` +
            `📉 <b>XM SL Kapanış:</b> <code>$${finalExitPrice.toFixed(2)}</code>\n` +
            `💸 <b>Zarar:</b> <b>-$${Math.abs(realizedMove).toFixed(2)} Ons</b> (${usedLot.toFixed(2)} Lot: <b>-$${estLossUsd}</b>)\n` +
            `🛡️ <i>XM Global MT5 stop tetiklendi; yeni kurulum taranıyor.</i>`;

          await sendTelegramAlert(slMsg);

          await fetch(`${FIREBASE_BASE_URL}/gold_signals/${sigKey}.json`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(sig)
          });
          openCount--;
        }
      }

      return openCount;
    }

    let activeCount = await evaluateOpenGoldSignals(goldData);

    // =========================================================================
    // NÖBETÇİ MODU: AKTİF SİNYAL VARSA 50 SANİYE BOYUNCA 2.5 SN'DE BİR XM KONTROLÜ
    // =========================================================================
    if (activeCount > 0) {
      while ((Date.now() - startTime) < 50000) {
        await new Promise(r => setTimeout(r, 2500));
        const freshData = await fetchXmMt5GoldData();
        if (!freshData || freshData.stale) continue;

        activeCount = await evaluateOpenGoldSignals(freshData);
        if (activeCount === 0) break;
      }

      if (activeCount > 0) {
        return res.status(200).json({
          status: "TRACKING_XM_MT5_POSITION",
          bid: goldData.bid,
          ask: goldData.ask,
          mode: "24H_XM_FAST_SCALP_93_V3_2",
          message: `XM Global MT5 açık pozisyonu +$${TP_DOLLAR.toFixed(2)} TP / -$${SL_DOLLAR.toFixed(2)} SL için canlı izleniyor.`
        });
      }
    }

    // =========================================================================
    // MODÜL 2: 93 MATEMATİĞİ (13M LİKİDİTE SÜPÜRME + NET EMA 60 EĞİM + YAPIŞMA KALKANI)
    // =========================================================================
    if (isFridayCloseLock) {
      return res.status(200).json({
        status: "FRIDAY_CLOSE_LOCK",
        livePrice: goldData.currentPrice,
        mode: "24H_XM_FAST_SCALP_93_V3_2",
        message: "Cuma 22:30 sonrası hafta sonu gap koruması nedeniyle yeni işlem açılmıyor."
      });
    }

    if (Date.now() - lastSignalTimestamp < SIGNAL_COOLDOWN_MS) {
      return res.status(200).json({
        status: "COOLDOWN",
        livePrice: goldData.currentPrice,
        mode: "24H_XM_FAST_SCALP_93_V3_2",
        message: "Son sinyal sonrası 5 dakikalık soğuma süresi bekleniyor."
      });
    }

    if (goldData.spread > MAX_ALLOWED_SPREAD) {
      return res.status(200).json({
        status: "HIGH_SPREAD_FILTERED",
        spread: goldData.spread,
        maxAllowed: MAX_ALLOWED_SPREAD,
        mode: "24H_XM_FAST_SCALP_93_V3_2"
      });
    }

    const candles = goldData.candles;
    const closedCandles = candles.slice(0, candles.length - 1);
    const ema60 = calculateEMA(closedCandles, 60);
    const ema60Prev = calculateEMA(closedCandles.slice(0, closedCandles.length - 8), 60);
    const emaSlope = parseFloat((ema60 - ema60Prev).toFixed(2));

    const sweepCandle = candles[candles.length - 2];
    const currentCandle = candles[candles.length - 1];
    const pool13m = candles.slice(candles.length - 15, candles.length - 2);

    const microHigh = Math.max(...pool13m.map(c => c.high));
    const microLow = Math.min(...pool13m.map(c => c.low));
    const boxRange = microHigh - microLow;

    if (boxRange < MIN_BOX_RANGE) {
      return res.status(200).json({
        status: "SCANNING_RANGE",
        bid: goldData.bid,
        ask: goldData.ask,
        ema60: parseFloat(ema60.toFixed(2)),
        emaSlope,
        boxRange: boxRange.toFixed(2),
        mode: "24H_XM_FAST_SCALP_93_V3_2"
      });
    }

    const candleSpan = sweepCandle.high - sweepCandle.low;
    if (candleSpan <= 0) {
      return res.status(200).json({ status: "FLAT_CANDLE", mode: "24H_XM_FAST_SCALP_93_V3_2" });
    }

    const lowerWick = Math.min(sweepCandle.open, sweepCandle.close) - sweepCandle.low;
    const upperWick = sweepCandle.high - Math.max(sweepCandle.open, sweepCandle.close);

    let newSignal = null;

    // BUY TETİĞİ — NET YUKARI EĞİM (>= +$0.35) + EMA 60 TEMİZ MESAFE (>= $1.20) + FİTİL SÜPÜRME
    const isBuyTrend =
      (goldData.bid >= ema60 + MIN_EMA_BUFFER) &&
      (sweepCandle.close > ema60) &&
      (emaSlope >= MIN_EMA_SLOPE);

    const buyEntryDistance = goldData.ask - microLow;
    const isBuySweep =
      isBuyTrend &&
      (sweepCandle.low <= microLow - 0.20) &&
      (sweepCandle.close > microLow) &&
      ((lowerWick / candleSpan) >= MIN_WICK_RATIO) &&
      (currentCandle.close >= sweepCandle.close) &&
      (buyEntryDistance > 0 && buyEntryDistance <= MAX_ENTRY_CHASE);

    if (isBuySweep) {
      const entry = goldData.ask;
      const wickPct = Math.round((lowerWick / candleSpan) * 100);
      const projectedMove = predictExpectedMove(boxRange, wickPct, isNySession);

      newSignal = {
        id: `gold_${Date.now()}`,
        symbol: MT5_SYMBOL,
        source: goldData.source,
        direction: "BUY",
        lotSize: LOT_SIZE,
        entry: parseFloat(entry.toFixed(2)),
        tp: parseFloat((entry + TP_DOLLAR).toFixed(2)),
        sl: parseFloat((entry - SL_DOLLAR).toFixed(2)),
        projectedMove,
        projectedTp: parseFloat((entry + projectedMove).toFixed(2)),
        isTrendAligned: true,
        ema60: parseFloat(ema60.toFixed(2)),
        emaSlope,
        level: parseFloat(microLow.toFixed(2)),
        wick: parseFloat(sweepCandle.low.toFixed(2)),
        wickPct,
        status: "OPEN",
        vpsExecuted: false,
        createdAt: Date.now()
      };
    }

    // SELL TETİĞİ — NET AŞAĞI EĞİM (<= -$0.35) + EMA 60 TEMİZ MESAFE (>= $1.20) + FİTİL SÜPÜRME
    const isSellTrend =
      (goldData.ask <= ema60 - MIN_EMA_BUFFER) &&
      (sweepCandle.close < ema60) &&
      (emaSlope <= -MIN_EMA_SLOPE);

    const sellEntryDistance = microHigh - goldData.bid;
    const isSellSweep =
      !newSignal &&
      isSellTrend &&
      (sweepCandle.high >= microHigh + 0.20) &&
      (sweepCandle.close < microHigh) &&
      ((upperWick / candleSpan) >= MIN_WICK_RATIO) &&
      (currentCandle.close <= sweepCandle.close) &&
      (sellEntryDistance > 0 && sellEntryDistance <= MAX_ENTRY_CHASE);

    if (isSellSweep) {
      const entry = goldData.bid;
      const wickPct = Math.round((upperWick / candleSpan) * 100);
      const projectedMove = predictExpectedMove(boxRange, wickPct, isNySession);

      newSignal = {
        id: `gold_${Date.now()}`,
        symbol: MT5_SYMBOL,
        source: goldData.source,
        direction: "SELL",
        lotSize: LOT_SIZE,
        entry: parseFloat(entry.toFixed(2)),
        tp: parseFloat((entry - TP_DOLLAR).toFixed(2)),
        sl: parseFloat((entry + SL_DOLLAR).toFixed(2)),
        projectedMove,
        projectedTp: parseFloat((entry - projectedMove).toFixed(2)),
        isTrendAligned: true,
        ema60: parseFloat(ema60.toFixed(2)),
        emaSlope,
        level: parseFloat(microHigh.toFixed(2)),
        wick: parseFloat(sweepCandle.high.toFixed(2)),
        wickPct,
        status: "OPEN",
        vpsExecuted: false,
        createdAt: Date.now()
      };
    }

    if (!newSignal) {
      return res.status(200).json({
        status: "SCANNING_XM_MT5_GOLD",
        bid: goldData.bid,
        ask: goldData.ask,
        spread: goldData.spread,
        ema60: parseFloat(ema60.toFixed(2)),
        emaSlope,
        activeTrend: emaSlope >= MIN_EMA_SLOPE ? "BUY_READY" : (emaSlope <= -MIN_EMA_SLOPE ? "SELL_READY" : "FLAT_LOCKED"),
        microHigh,
        microLow,
        mode: "24H_XM_FAST_SCALP_93_V3_2"
      });
    }

    // =========================================================================
    // MODÜL 3: SİNYALİ FIREBASE'E YAZ (XM GLOBAL MT5 KÖPRÜSÜ + TELEGRAM)
    // =========================================================================
    await Promise.all([
      fetch(`${FIREBASE_BASE_URL}/gold_signals/${newSignal.id}.json`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newSignal)
      }),
      fetch(`${FIREBASE_BASE_URL}/last_gold_signal_ts.json`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(Date.now())
      })
    ]);

    const isBuy = newSignal.direction === "BUY";

    const entryMsg =
      `🏆 <b>XAUUSD (GOLD) | DOĞRUDAN XM HIZLI SCALP (V3.2)</b>\n` +
      `━━━━━━━━━━━━━━━━━━━━\n` +
      `🧭 <b>İşlem Yönü:</b> ${isBuy ? '🟢 BUY (LONG)' : '🔴 SELL (SHORT)'}\n` +
      `🧱 <b>Avlanan Seviye:</b> <code>$${newSignal.level.toFixed(2)}</code> (İğne: $${newSignal.wick.toFixed(2)} | %${newSignal.wickPct} Fitil)\n` +
      `📊 <b>EMA 60 Durumu:</b> <code>$${newSignal.ema60.toFixed(2)}</code> (Eğim: ${newSignal.emaSlope >= 0 ? '+' : ''}$${newSignal.emaSlope.toFixed(2)})\n` +
      `━━━━━━━━━━━━━━━━━━━━\n` +
      `💵 <b>XM Giriş Fiyatı:</b> <code>$${newSignal.entry.toFixed(2)}</code>\n` +
      `🎯 <b>Hızlı TP (+$${TP_DOLLAR.toFixed(2)}):</b> <code>$${newSignal.tp.toFixed(2)}</code>\n` +
      `🚀 <b>Tahmini Menzil (+$${newSignal.projectedMove.toFixed(2)}):</b> <code>$${newSignal.projectedTp.toFixed(2)}</code>\n` +
      `🛑 <b>Stop-Loss (-$${SL_DOLLAR.toFixed(2)}):</b> <code>$${newSignal.sl.toFixed(2)}</code>\n` +
      `━━━━━━━━━━━━━━━━━━━━\n` +
      `🤖 <i>XM Global MT5 köprüsü ${LOT_SIZE.toFixed(2)} Lot hızlı scalp işledi; TP/SL bildirimleri aktiftir.</i>`;

    await sendTelegramAlert(entryMsg);

    return res.status(200).json({
      success: true,
      mode: "24H_XM_FAST_SCALP_93_V3_2",
      signal: newSignal
    });

  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}
