export const config = {
  maxDuration: 60
};

export default async function handler(req, res) {
  try {
    // =========================================================================
    // 0. TELEGRAM, FIREBASE & DOĞRUDAN XM GLOBAL MT5 PARAMETRELERİ (V8.1 FINAL)
    // =========================================================================
    const TG_BOT_TOKEN = "8682225307:AAHaa-hieKBBluU6uZ2_-OgSPxGR7OwMssE";
    const TG_CHANNEL_ID = "-1004404988937";
    const TG_ADMIN_ID = "6457294906";
    const FIREBASE_BASE_URL = "https://mineora-web-default-rtdb.firebaseio.com";

    const MT5_SYMBOL = "GOLD";                  // XM GLOBAL MT5 SEMBOL ADI
    const LOT_SIZE = 0.30;                      // SABİT İŞLEM LOTU (0.30 LOT)
    const TP_DOLLAR = 4.00;                     // HIZLI TAKE-PROFIT (+$4.00 = $120)
    const SL_DOLLAR = 10.00;                    // STOP-LOSS (-$10.00 = -$300)
    const MAX_ALLOWED_SPREAD = 0.85;            // MAKS. İZİN VERİLEN SPREAD ($0.85)
    const MIN_WICK_RATIO = 0.38;                // YÖNLÜ MUMDA EN AZ %38 FİTİL
    const PINBAR_WICK_RATIO = 0.55;             // TERS GÖVDELİ PİNBARDA EN AZ %55 FİTİL
    const MAX_ENTRY_CHASE = 1.85;               // DİP/TEPE SEVİYESİNDEN MAKS. $1.85 UZAKLIK
    const MIN_ROOM_TO_WALL = 3.20;              // TP YÖNÜNDE EN AZ $3.20 BOŞ ALAN ŞARTI
    const SIGNAL_COOLDOWN_MS = 3 * 60 * 1000;   // SİNYALLER ARASI 3 DK SOĞUMA SÜRESİ
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

    function calculateAvgCandleSize(candles, count = 30) {
      const slice = candles.slice(-count);
      if (slice.length === 0) return 1.0;
      const sum = slice.reduce((acc, c) => acc + (c.high - c.low), 0);
      return sum / slice.length;
    }

    function aggregateToM5(m1Candles) {
      const buckets = new Map();
      for (const c of m1Candles) {
        const bucketTime = Math.floor(c.time / (5 * 60 * 1000)) * (5 * 60 * 1000);
        if (!buckets.has(bucketTime)) {
          buckets.set(bucketTime, {
            time: bucketTime,
            open: c.open,
            high: c.high,
            low: c.low,
            close: c.close
          });
        } else {
          const b = buckets.get(bucketTime);
          b.high = Math.max(b.high, c.high);
          b.low = Math.min(b.low, c.low);
          b.close = c.close;
        }
      }
      return Array.from(buckets.values()).sort((a, b) => a.time - b.time);
    }

    function predictExpectedMove(boxRange, wickPct, isNySession) {
      const baseMove = Math.max(boxRange, 2.2) * 0.75;
      const wickMult = wickPct >= 55 ? 1.25 : 1.05;
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
    // 3. DOĞRUDAN XM GLOBAL MT5 CANLI FİYAT VE 300 ADET M1 MUMU ÇEKME
    // =========================================================================
    async function fetchXmMt5GoldData() {
      try {
        const feedRes = await fetch(`${FIREBASE_BASE_URL}/mt5_live_feed.json`);
        const feed = await feedRes.json();

        if (!feed || !Array.isArray(feed.candles) || feed.candles.length < 120) {
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
            `🛡️ <i>XM Global MT5 stop tetiklendi; 7/24 tarama devam ediyor.</i>`;

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
          mode: "24H_XM_NATIVE_V8_1",
          message: `XM Global MT5 açık pozisyonu +$${TP_DOLLAR.toFixed(2)} TP / -$${SL_DOLLAR.toFixed(2)} SL için canlı izleniyor.`
        });
      }
    }

    // =========================================================================
    // MODÜL 2: M1+M5 EMA YÖN BİRLİĞİ & LİKİDİTE SÜPÜRME SNIPER (V8.1 FINAL)
    // =========================================================================
    if (isFridayCloseLock) {
      return res.status(200).json({
        status: "FRIDAY_CLOSE_LOCK",
        livePrice: goldData.currentPrice,
        mode: "24H_XM_NATIVE_V8_1",
        message: "Cuma 22:30 sonrası hafta sonu gap koruması nedeniyle yeni işlem açılmıyor."
      });
    }

    if (Date.now() - lastSignalTimestamp < SIGNAL_COOLDOWN_MS) {
      return res.status(200).json({
        status: "COOLDOWN",
        livePrice: goldData.currentPrice,
        mode: "24H_XM_NATIVE_V8_1",
        message: "Son sinyal sonrası 3 dakikalık soğuma süresi bekleniyor."
      });
    }

    if (goldData.spread > MAX_ALLOWED_SPREAD) {
      return res.status(200).json({
        status: "HIGH_SPREAD_FILTERED",
        spread: goldData.spread,
        maxAllowed: MAX_ALLOWED_SPREAD,
        mode: "24H_XM_NATIVE_V8_1"
      });
    }

    const candles = goldData.candles;
    const closedCandles = candles.slice(0, candles.length - 1);
    const m5ClosedCandles = aggregateToM5(closedCandles);

    const ema60M1 = calculateEMA(closedCandles, 60);
    const ema60M1Prev = calculateEMA(closedCandles.slice(0, Math.max(1, closedCandles.length - 6)), 60);
    const ema60M5 = calculateEMA(m5ClosedCandles, 60);
    const ema60M5Prev = calculateEMA(m5ClosedCandles.slice(0, Math.max(1, m5ClosedCandles.length - 4)), 60);
    const ema60M5Prev2 = calculateEMA(m5ClosedCandles.slice(0, Math.max(1, m5ClosedCandles.length - 8)), 60);

    const m1Slope = parseFloat((ema60M1 - ema60M1Prev).toFixed(2));
    const m5Slope = parseFloat((ema60M5 - ema60M5Prev).toFixed(2));
    const m5PrevSlope = parseFloat((ema60M5Prev - ema60M5Prev2).toFixed(2));
    const distFromM5Ema = parseFloat((goldData.currentPrice - ema60M5).toFixed(2));

    const avgCandleSize = calculateAvgCandleSize(closedCandles, 30);
    const dynamicOverextended = Math.max(12.00, parseFloat((avgCandleSize * 11).toFixed(2)));

    const sweepCandle = candles[candles.length - 2];
    const currentCandle = candles[candles.length - 1];

    // 12 dakikalık likidite kutusu (basamak tepe/dip seviyeleri)
    const pool12m = candles.slice(candles.length - 14, candles.length - 2);
    // 45 dakikalık ana kanal
    const pool45m = candles.slice(candles.length - 47, candles.length - 2);

    const stepHigh = Math.max(...pool12m.map(c => c.high));
    const stepLow = Math.min(...pool12m.map(c => c.low));
    const boxRange = stepHigh - stepLow;

    const rangeHigh45 = Math.max(...pool45m.map(c => c.high));
    const rangeLow45 = Math.min(...pool45m.map(c => c.low));
    const rangeSpan45 = rangeHigh45 - rangeLow45;

    const pricePositionPct = rangeSpan45 > 0
      ? Math.round(((goldData.currentPrice - rangeLow45) / rangeSpan45) * 100)
      : 50;

    if (rangeSpan45 < 2.80) {
      return res.status(200).json({
        status: "DEAD_RANGE_FILTERED",
        livePrice: goldData.currentPrice,
        rangeSpan45: rangeSpan45.toFixed(2),
        mode: "24H_XM_NATIVE_V8_1"
      });
    }

    const candleSpan = sweepCandle.high - sweepCandle.low;
    if (candleSpan <= 0) {
      return res.status(200).json({ status: "FLAT_CANDLE", mode: "24H_XM_NATIVE_V8_1" });
    }

    const lowerWick = Math.min(sweepCandle.open, sweepCandle.close) - sweepCandle.low;
    const upperWick = sweepCandle.high - Math.max(sweepCandle.open, sweepCandle.close);
    const lowerWickRatio = lowerWick / candleSpan;
    const upperWickRatio = upperWick / candleSpan;

    const isBuyCandleConfirmed =
      (sweepCandle.close > sweepCandle.open && lowerWickRatio >= MIN_WICK_RATIO) ||
      (lowerWickRatio >= PINBAR_WICK_RATIO && currentCandle.close > sweepCandle.open);

    const isSellCandleConfirmed =
      (sweepCandle.close < sweepCandle.open && upperWickRatio >= MIN_WICK_RATIO) ||
      (upperWickRatio >= PINBAR_WICK_RATIO && currentCandle.close < sweepCandle.open);

    // YÖN BİRLİĞİ KONTROLÜ:
    // Fiyat hem M1 hem M5 EMA 60 üzerindeyse -> YALNIZCA BUY (Ters SELL yasak)
    // Fiyat hem M1 hem M5 EMA 60 altındaysa  -> YALNIZCA SELL (Ters BUY yasak)
    const isBullishRegime = (goldData.ask > ema60M1) && (goldData.ask > ema60M5) && (m1Slope >= -0.05);
    const isBearishRegime = (goldData.bid < ema60M1) && (goldData.bid < ema60M5) && (m1Slope <= 0.05);

    let newSignal = null;

    // -------------------------------------------------------------------------
    // 1. DİPTEN LONG (BUY) KURULUMU
    // -------------------------------------------------------------------------
    const isDownSlowing = m5Slope > m5PrevSlope || m1Slope >= 0.05;
    const isNotWaterfallCrash = Math.abs(m5Slope) < 1.80;
    const roomToTopWall = rangeHigh45 - goldData.ask;

    // Senaryo A: Yükseliş rejiminde 12m basamak dibine dokunuş/süpürme + yeşil dönüş
    const buyTrendStep = isBullishRegime && (sweepCandle.low <= stepLow + 0.10) && (sweepCandle.close >= stepLow) && (pricePositionPct <= 75);

    // Senaryo B: Yükseliş trendinde M1 veya M5 EMA 60 desteğinden sekme (dinamik referans)
    const hitM5Support = (m5Slope >= 0.15) && (sweepCandle.low <= ema60M5 + 1.00) && (sweepCandle.low >= ema60M5 - 2.50) && (sweepCandle.close >= ema60M5);
    const hitM1Support = (m5Slope >= 0.15) && (sweepCandle.low <= ema60M1 + 0.60) && (sweepCandle.low >= ema60M1 - 1.80) && (sweepCandle.close >= ema60M1);
    const buyEmaBounce = hitM5Support || hitM1Support;

    // Senaryo C: Aşırı satım kanal dibinde (%24 ve altı) yavaşlamış şelale V-dönüş pinbarı
    const buyDeepReversal = isNotWaterfallCrash &&
      ((pricePositionPct <= 24) || (distFromM5Ema <= -dynamicOverextended && isDownSlowing)) &&
      (sweepCandle.low <= stepLow + 0.05) &&
      (sweepCandle.close > stepLow) &&
      (lowerWickRatio >= 0.48);

    const buyTriggered = buyTrendStep || buyEmaBounce || buyDeepReversal;
    const buyRefLevel = hitM5Support
      ? parseFloat(ema60M5.toFixed(2))
      : (hitM1Support ? parseFloat(ema60M1.toFixed(2)) : stepLow);
    const buyChaseDist = Math.abs(goldData.ask - buyRefLevel);

    if (
      isBuyCandleConfirmed &&
      buyTriggered &&
      currentCandle.close >= sweepCandle.close &&
      buyChaseDist <= MAX_ENTRY_CHASE &&
      (roomToTopWall >= MIN_ROOM_TO_WALL || distFromM5Ema <= -dynamicOverextended)
    ) {
      const entry = goldData.ask;
      const wickPct = Math.round(lowerWickRatio * 100);
      const projectedMove = predictExpectedMove(boxRange, wickPct, isNySession);
      const setupTag = hitM5Support
        ? "M5 EMA 60 Ana Destek Sekmesi"
        : (hitM1Support ? "M1 EMA 60 Trend Destek Sekmesi" : (buyDeepReversal ? "Aşırı Satım Dip Dönüşü" : "Yükseliş Basamak Dibi"));

      newSignal = {
        id: `gold_${Date.now()}`,
        symbol: MT5_SYMBOL,
        source: goldData.source,
        direction: "BUY",
        setupType: setupTag,
        lotSize: LOT_SIZE,
        entry: parseFloat(entry.toFixed(2)),
        tp: parseFloat((entry + TP_DOLLAR).toFixed(2)),
        sl: parseFloat((entry - SL_DOLLAR).toFixed(2)),
        projectedMove,
        projectedTp: parseFloat((entry + projectedMove).toFixed(2)),
        isTrendAligned: true,
        ema60: parseFloat(ema60M5.toFixed(2)),
        ema60M1: parseFloat(ema60M1.toFixed(2)),
        pricePositionPct,
        level: parseFloat(buyRefLevel.toFixed(2)),
        wick: parseFloat(sweepCandle.low.toFixed(2)),
        wickPct,
        status: "OPEN",
        vpsExecuted: false,
        createdAt: Date.now()
      };
    }

    // -------------------------------------------------------------------------
    // 2. TEPEDEN SHORT (SELL) KURULUMU
    // -------------------------------------------------------------------------
    const isUpSlowing = m5Slope <= m5PrevSlope || m1Slope <= -0.05;
    const isNotRocketSpike = Math.abs(m5Slope) < 1.80;
    const roomToBottomWall = goldData.bid - rangeLow45;

    // Senaryo A: Düşüş rejiminde 12m basamak tepesine dokunuş/süpürme + kırmızı dönüş
    const sellTrendStep = isBearishRegime && (sweepCandle.high >= stepHigh - 0.10) && (sweepCandle.close <= stepHigh) && (pricePositionPct >= 25);

    // Senaryo B: Düşüş trendinde M1 veya M5 EMA 60 direncinden ret (dinamik referans)
    const hitM5Resist = (m5Slope <= -0.15) && (sweepCandle.high >= ema60M5 - 1.00) && (sweepCandle.high <= ema60M5 + 2.50) && (sweepCandle.close <= ema60M5);
    const hitM1Resist = (m5Slope <= -0.15) && (sweepCandle.high >= ema60M1 - 0.60) && (sweepCandle.high <= ema60M1 + 1.80) && (sweepCandle.close <= ema60M1);
    const sellEmaReject = hitM5Resist || hitM1Resist;

    // Senaryo C: Aşırı şişmiş kanal tepesinde (%76 ve üzeri) yavaşlamış zirve avı
    const sellOverextendedTop = isNotRocketSpike &&
      ((pricePositionPct >= 76) || (distFromM5Ema >= dynamicOverextended)) &&
      isUpSlowing &&
      (sweepCandle.high >= stepHigh - 0.05) &&
      (sweepCandle.close < stepHigh) &&
      (upperWickRatio >= 0.48);

    const sellTriggered = sellTrendStep || sellEmaReject || sellOverextendedTop;
    const sellRefLevel = hitM5Resist
      ? parseFloat(ema60M5.toFixed(2))
      : (hitM1Resist ? parseFloat(ema60M1.toFixed(2)) : stepHigh);
    const sellChaseDist = Math.abs(sellRefLevel - goldData.bid);

    if (
      !newSignal &&
      isSellCandleConfirmed &&
      sellTriggered &&
      currentCandle.close <= sweepCandle.close &&
      sellChaseDist <= MAX_ENTRY_CHASE &&
      (roomToBottomWall >= MIN_ROOM_TO_WALL || distFromM5Ema >= dynamicOverextended)
    ) {
      const entry = goldData.bid;
      const wickPct = Math.round(upperWickRatio * 100);
      const projectedMove = predictExpectedMove(boxRange, wickPct, isNySession);
      const setupTag = hitM5Resist
        ? "M5 EMA 60 Ana Direnç Reddi"
        : (hitM1Resist ? "M1 EMA 60 Trend Direnç Reddi" : (sellOverextendedTop ? "Aşırı Şişmiş Zirve Avı" : "Düşüş Basamak Tepesi"));

      newSignal = {
        id: `gold_${Date.now()}`,
        symbol: MT5_SYMBOL,
        source: goldData.source,
        direction: "SELL",
        setupType: setupTag,
        lotSize: LOT_SIZE,
        entry: parseFloat(entry.toFixed(2)),
        tp: parseFloat((entry - TP_DOLLAR).toFixed(2)),
        sl: parseFloat((entry + SL_DOLLAR).toFixed(2)),
        projectedMove,
        projectedTp: parseFloat((entry - projectedMove).toFixed(2)),
        isTrendAligned: true,
        ema60: parseFloat(ema60M5.toFixed(2)),
        ema60M1: parseFloat(ema60M1.toFixed(2)),
        pricePositionPct,
        level: parseFloat(sellRefLevel.toFixed(2)),
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
        regime: isBullishRegime ? "BULLISH" : (isBearishRegime ? "BEARISH" : "NEUTRAL_ZONE"),
        ema60M5: parseFloat(ema60M5.toFixed(2)),
        ema60M1: parseFloat(ema60M1.toFixed(2)),
        m1Slope,
        m5Slope,
        pricePositionPct,
        stepHigh,
        stepLow,
        mode: "24H_XM_NATIVE_V8_1"
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
      `🏆 <b>XAUUSD (GOLD) | DOĞRUDAN XM MT5 SNIPER (V8.1)</b>\n` +
      `━━━━━━━━━━━━━━━━━━━━\n` +
      `🧭 <b>İşlem Yönü:</b> ${isBuy ? '🟢 BUY (DİPTEN LONG)' : '🔴 SELL (TEPEDEN SHORT)'}\n` +
      `⚡ <b>Kurulum Tipi:</b> ${newSignal.setupType}\n` +
      `🧱 <b>Dip/Tepe Seviyesi:</b> <code>$${newSignal.level.toFixed(2)}</code> (İğne: $${newSignal.wick.toFixed(2)} | %${newSignal.wickPct} Fitil)\n` +
      `📊 <b>M5 / M1 EMA 60:</b> <code>$${newSignal.ema60.toFixed(2)} / $${newSignal.ema60M1.toFixed(2)}</code> (Kanal: %${newSignal.pricePositionPct})\n` +
      `━━━━━━━━━━━━━━━━━━━━\n` +
      `💵 <b>XM Giriş Fiyatı:</b> <code>$${newSignal.entry.toFixed(2)}</code>\n` +
      `🎯 <b>Hızlı TP (+$${TP_DOLLAR.toFixed(2)}):</b> <code>$${newSignal.tp.toFixed(2)}</code>\n` +
      `🚀 <b>Tahmini Menzil (+$${newSignal.projectedMove.toFixed(2)}):</b> <code>$${newSignal.projectedTp.toFixed(2)}</code>\n` +
      `🛑 <b>Stop-Loss (-$${SL_DOLLAR.toFixed(2)}):</b> <code>$${newSignal.sl.toFixed(2)}</code>\n` +
      `━━━━━━━━━━━━━━━━━━━━\n` +
      `🤖 <i>XM Global MT5 köprüsü ${LOT_SIZE.toFixed(2)} Lot işledi; 7/24 takip aktiftir.</i>`;

    await sendTelegramAlert(entryMsg);

    return res.status(200).json({
      success: true,
      mode: "24H_XM_NATIVE_V8_1",
      signal: newSignal
    });

  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}
