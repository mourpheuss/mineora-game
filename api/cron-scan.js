export const config = {
  maxDuration: 60
};

export default async function handler(req, res) {
  try {
    const browserHeaders = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
      'Accept': 'application/json',
      'Content-Type': 'application/json'
    };

    // =========================================================================
    // 0. TELEGRAM, FIREBASE & SAF SPOT XAUUSD PARAMETRELERİ (V6 PRO SNIPER)
    // =========================================================================
    const TG_BOT_TOKEN = "8682225307:AAHaa-hieKBBluU6uZ2_-OgSPxGR7OwMssE";
    const TG_CHANNEL_ID = "-1004404988937";
    const TG_ADMIN_ID = "6457294906";
    const FIREBASE_BASE_URL = "https://mineora-web-default-rtdb.firebaseio.com";

    const MT5_SYMBOL = "GOLD";                  // XM GLOBAL MT5 SEMBOL ADI
    const LOT_SIZE = 0.30;                      // SABİT İŞLEM LOTU (0.30 LOT)
    const TP_DOLLAR = 4.00;                     // HIZLI TAKE-PROFIT (+$4.00 = $120)
    const SL_DOLLAR = 10.00;                    // STOP-LOSS (-$10.00 = -$300)
    const MIN_WICK_RATIO = 0.42;                // EN AZ %42 REDDEDİŞ FİTİLİ
    const MAX_ENTRY_CHASE = 1.40;               // DİP/TEPE SEVİYESİNDEN MAKS. $1.40 UZAKLIK
    const MIN_ROOM_TO_WALL = 3.50;              // TP YÖNÜNDE EN AZ $3.50 BOŞ ALAN ŞARTI
    const SIGNAL_COOLDOWN_MS = 3 * 60 * 1000;   // SİNYALLER ARASI 3 DK SOĞUMA SÜRESİ
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

    // Ortalama Mum Boyu (ATR benzeri dinamik volatilite ölçümü)
    function calculateAvgCandleSize(candles, count = 30) {
      const slice = candles.slice(-count);
      if (slice.length === 0) return 1.0;
      const sum = slice.reduce((acc, c) => acc + (c.high - c.low), 0);
      return sum / slice.length;
    }

    // M1 mumlarından gerçek 5 dakikalık (M5) mum serisi üretir
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
      const wickMult = wickPct >= 60 ? 1.25 : 1.05;
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

    // =========================================================================
    // 3. SAF SPOT ALTIN (OANDA:XAUUSD & FX_IDC:XAUUSD) CANLI VERİ VE MUM MOTORU
    // =========================================================================
    async function fetchSpotGoldData() {
      let spotLivePrice = 0;

      // 1. Öncelik: TradingView OANDA:XAUUSD ve FX_IDC:XAUUSD Spot Fiyatı
      try {
        const tvRes = await fetch("https://scanner.tradingview.com/cfd/scan", {
          method: "POST",
          headers: browserHeaders,
          body: JSON.stringify({
            symbols: { tickers: ["OANDA:XAUUSD", "FX_IDC:XAUUSD"], query: { types: [] } },
            columns: ["close", "high", "low", "open"]
          })
        });
        const tvJson = await tvRes.json();
        const oandaRow = tvJson?.data?.find(r => r.s === "OANDA:XAUUSD");
        const fxRow = tvJson?.data?.find(r => r.s === "FX_IDC:XAUUSD");
        if (oandaRow?.d?.[0]) {
          spotLivePrice = parseFloat(oandaRow.d[0]);
        } else if (fxRow?.d?.[0]) {
          spotLivePrice = parseFloat(fxRow.d[0]);
        }
      } catch (e) {}

      // 2. Spot Altın (PAXG/XAU Spot Endeks) 1 Dakikalık Tarihsel Mum Serisi (Bitget Futures Kaldırıldı)
      const candleRes = await fetch(
        "https://api.binance.com/api/v3/klines?symbol=PAXGUSDT&interval=1m&limit=300",
        { headers: browserHeaders }
      );
      const candleJson = await candleRes.json();
      if (!Array.isArray(candleJson) || candleJson.length < 120) {
        return null;
      }

      const rawCandles = candleJson.map(c => ({
        time: Number(c[0]),
        open: Number(c[1]),
        high: Number(c[2]),
        low: Number(c[3]),
        close: Number(c[4])
      })).sort((a, b) => a.time - b.time);

      const lastRawClose = rawCandles[rawCandles.length - 1].close;
      // Spot altın ile ons endeksi arasındaki baz farkını hizala
      const spotOffset = (spotLivePrice > 0 && Math.abs(spotLivePrice - lastRawClose) < 35)
        ? (spotLivePrice - lastRawClose)
        : 0;

      const candles = rawCandles.map(c => ({
        time: c.time,
        open: parseFloat((c.open + spotOffset).toFixed(2)),
        high: parseFloat((c.high + spotOffset).toFixed(2)),
        low: parseFloat((c.low + spotOffset).toFixed(2)),
        close: parseFloat((c.close + spotOffset).toFixed(2))
      }));

      const currentPrice = spotLivePrice > 0 ? spotLivePrice : candles[candles.length - 1].close;

      // Güvenlik: Anlık spot fiyatı ile son mum kapanışı arasında $2.50'den fazla makas varsa veri senkronunu bekle
      if (Math.abs(currentPrice - candles[candles.length - 1].close) > 2.50) {
        return null;
      }

      return { currentPrice, candles, source: "OANDA:XAUUSD_SPOT" };
    }

    const goldData = await fetchSpotGoldData();

    if (!goldData) {
      return res.status(200).json({ status: "SYNCING_SPOT_FEED", message: "Spot altın verisi senkronize ediliyor." });
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
    // MODÜL 1: CANLI +$4.00 TP VE -$10.00 SL DENETLEYİCİSİ
    // =========================================================================
    async function evaluateOpenGoldSignals(livePrice) {
      let openCount = 0;

      for (const [sigKey, sig] of Object.entries(goldSignals)) {
        if (!sig || sig.status !== 'OPEN') continue;
        openCount++;

        const isBuy = sig.direction === 'BUY';
        const diffDollar = isBuy ? (livePrice - sig.entry) : (sig.entry - livePrice);
        const targetTp = sig.tp ? Math.abs(sig.tp - sig.entry) : TP_DOLLAR;
        const targetSl = sig.sl ? Math.abs(sig.sl - sig.entry) : SL_DOLLAR;

        if (diffDollar >= targetTp - 0.05) {
          sig.status = 'TP_HIT';
          sig.exitPrice = livePrice;
          sig.closedAt = Date.now();
          sig.realizedDollar = parseFloat(diffDollar.toFixed(2));

          const usedLot = sig.lotSize || LOT_SIZE;
          const estNetUsd = (diffDollar * usedLot * 100).toFixed(2);

          const tpMsg =
            `🎯 <b>XAUUSD (GOLD) | TP GELDİ (+$${targetTp.toFixed(2)})</b>\n` +
            `━━━━━━━━━━━━━━━━━━━━\n` +
            `🧭 <b>İşlem Yönü:</b> ${isBuy ? '🟢 BUY (LONG)' : '🔴 SELL (SHORT)'}\n` +
            `💵 <b>Giriş Fiyatı:</b> <code>$${sig.entry.toFixed(2)}</code>\n` +
            `🏁 <b>TP Kapanış:</b> <code>$${livePrice.toFixed(2)}</code>\n` +
            `💰 <b>Kazanç:</b> <b>+$${diffDollar.toFixed(2)} Ons</b> (${usedLot.toFixed(2)} Lot: <b>+$${estNetUsd}</b>)\n` +
            `✅ <i>Dipten/tepeden hızlı hedef başarıyla tamamlandı!</i>`;

          await sendTelegramAlert(tpMsg);

          await fetch(`${FIREBASE_BASE_URL}/gold_signals/${sigKey}.json`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(sig)
          });
          openCount--;
          continue;
        }

        if (diffDollar <= -(targetSl - 0.05)) {
          sig.status = 'SL_HIT';
          sig.exitPrice = livePrice;
          sig.closedAt = Date.now();
          sig.realizedDollar = parseFloat(diffDollar.toFixed(2));

          const usedLot = sig.lotSize || LOT_SIZE;
          const estLossUsd = Math.abs(diffDollar * usedLot * 100).toFixed(2);

          const slMsg =
            `🛑 <b>XAUUSD (GOLD) | SL GELDİ (-$${targetSl.toFixed(2)})</b>\n` +
            `━━━━━━━━━━━━━━━━━━━━\n` +
            `🧭 <b>İşlem Yönü:</b> ${isBuy ? '🟢 BUY (LONG)' : '🔴 SELL (SHORT)'}\n` +
            `💵 <b>Giriş Fiyatı:</b> <code>$${sig.entry.toFixed(2)}</code>\n` +
            `📉 <b>SL Kapanış:</b> <code>$${livePrice.toFixed(2)}</code>\n` +
            `💸 <b>Zarar:</b> <b>-$${Math.abs(diffDollar).toFixed(2)} Ons</b> (${usedLot.toFixed(2)} Lot: <b>-$${estLossUsd}</b>)\n` +
            `🛡️ <i>Stop seviyesi tetiklendi; 7/24 tarama devam ediyor.</i>`;

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

    let activeCount = await evaluateOpenGoldSignals(goldData.currentPrice);

    // =========================================================================
    // NÖBETÇİ MODU: AKTİF SİNYAL VARSA 50 SANİYE BOYUNCA 2.5 SN'DE BİR TP/SL KONTROLÜ
    // =========================================================================
    if (activeCount > 0) {
      while ((Date.now() - startTime) < 50000) {
        await new Promise(r => setTimeout(r, 2500));
        const freshData = await fetchSpotGoldData();
        if (!freshData) continue;

        activeCount = await evaluateOpenGoldSignals(freshData.currentPrice);
        if (activeCount === 0) break;
      }

      if (activeCount > 0) {
        return res.status(200).json({
          status: "TRACKING_TP_SL",
          livePrice: goldData.currentPrice,
          mode: "24H_SPOT_SNIPER_V6",
          message: `Açık sinyal +$${TP_DOLLAR.toFixed(2)} TP / -$${SL_DOLLAR.toFixed(2)} SL için canlı izleniyor.`
        });
      }
    }

    // =========================================================================
    // MODÜL 2: SAF SPOT M5+M1 DİPTEN LONG / TEPEDEN SHORT SNIPER MOTORU (V6)
    // =========================================================================
    if (Date.now() - lastSignalTimestamp < SIGNAL_COOLDOWN_MS) {
      return res.status(200).json({
        status: "COOLDOWN",
        livePrice: goldData.currentPrice,
        mode: "24H_SPOT_SNIPER_V6",
        message: "Son sinyal sonrası 3 dakikalık soğuma süresi bekleniyor."
      });
    }

    const candles = goldData.candles;
    const m5Candles = aggregateToM5(candles);

    const ema60M1 = calculateEMA(candles, 60);
    const ema60M5 = calculateEMA(m5Candles, 60);
    const ema60M5Prev = calculateEMA(m5Candles.slice(0, Math.max(1, m5Candles.length - 4)), 60);
    const ema60M5Prev2 = calculateEMA(m5Candles.slice(0, Math.max(1, m5Candles.length - 8)), 60);

    const m5Slope = parseFloat((ema60M5 - ema60M5Prev).toFixed(2));
    const m5PrevSlope = parseFloat((ema60M5Prev - ema60M5Prev2).toFixed(2));
    const distFromM5Ema = parseFloat((goldData.currentPrice - ema60M5).toFixed(2));

    // Dinamik Volatilite (ATR) Hesabı: Aşırı uzama eşiği piyasa hızına göre otomatik ayarlanır
    const avgCandleSize = calculateAvgCandleSize(candles, 30);
    const dynamicOverextended = Math.max(13.00, parseFloat((avgCandleSize * 12).toFixed(2)));

    const sweepCandle = candles[candles.length - 2];
    const currentCandle = candles[candles.length - 1];

    // Kısa basamak dibi/tepesi (son 6 mum)
    const pool6m = candles.slice(candles.length - 8, candles.length - 2);
    // Geniş 45 dakikalık kanal (ucuzluk / pahalılık ve duvar mesafesi ölçümü)
    const pool45m = candles.slice(candles.length - 47, candles.length - 2);

    const stepHigh = Math.max(...pool6m.map(c => c.high));
    const stepLow = Math.min(...pool6m.map(c => c.low));
    const boxRange = stepHigh - stepLow;

    const rangeHigh45 = Math.max(...pool45m.map(c => c.high));
    const rangeLow45 = Math.min(...pool45m.map(c => c.low));
    const rangeSpan45 = rangeHigh45 - rangeLow45;

    // 45 dakikalık kanalda fiyatın yüzdelik konumu (%0 = En Dip, %100 = En Tepe)
    const pricePositionPct = rangeSpan45 > 0
      ? Math.round(((goldData.currentPrice - rangeLow45) / rangeSpan45) * 100)
      : 50;

    // Testere / ölü piyasa kilidi: 45 dakikalık toplam hareket $3.20'den dar ise işlem açma
    if (rangeSpan45 < 3.20) {
      return res.status(200).json({
        status: "DEAD_RANGE_FILTERED",
        livePrice: goldData.currentPrice,
        rangeSpan45: rangeSpan45.toFixed(2),
        mode: "24H_SPOT_SNIPER_V6"
      });
    }

    const candleSpan = sweepCandle.high - sweepCandle.low;
    if (candleSpan <= 0) {
      return res.status(200).json({ status: "FLAT_CANDLE", mode: "24H_SPOT_SNIPER_V6" });
    }

    // MUM RENGİ KONTROLÜ: Kırmızı mumda BUY, yeşil mumda SELL kesinlikle yasak!
    const isSweepGreen = sweepCandle.close > sweepCandle.open;
    const isSweepRed = sweepCandle.close < sweepCandle.open;

    const lowerWick = Math.min(sweepCandle.open, sweepCandle.close) - sweepCandle.low;
    const upperWick = sweepCandle.high - Math.max(sweepCandle.open, sweepCandle.close);
    const lowerWickRatio = lowerWick / candleSpan;
    const upperWickRatio = upperWick / candleSpan;

    let newSignal = null;

    // -------------------------------------------------------------------------
    // 1. DİPTEN LONG (BUY) KURULUMU — YEŞİL DÖNÜŞ MUMU + BOŞ ALAN KALKANI
    // -------------------------------------------------------------------------
    const isM5UpTrend = m5Slope >= 0.45 && goldData.currentPrice >= ema60M5 - 1.50;
    const isDownSlowing = m5Slope > m5PrevSlope || m5Slope >= -0.35;
    const roomToTopWall = rangeHigh45 - goldData.currentPrice; // Üstteki zirveye kalan mesafe

    // Senaryo A: M5 Yükseliş Trendinde Kısa Basamak Dibi Süpürme
    const buyStepSweep = isM5UpTrend && (sweepCandle.low <= stepLow - 0.25) && (sweepCandle.close > stepLow) && (pricePositionPct <= 68);
    // Senaryo B: M5 EMA 60 Ana Desteğine Dokunup Yeşil Mumla Sekme
    const buyM5SupportBounce = (m5Slope >= 0.25) && (sweepCandle.low <= ema60M5 + 1.00) && (sweepCandle.low >= ema60M5 - 2.50) && (sweepCandle.close > ema60M5 - 0.50);
    // Senaryo C: Aşırı Satım Dip Dönüşü (Kanal en alt %25'te veya dinamik aşırı satımda)
    const buyDeepDiscount = ((pricePositionPct <= 25) || (distFromM5Ema <= -dynamicOverextended && isDownSlowing)) &&
      (sweepCandle.low <= stepLow - 0.25) && (sweepCandle.close > stepLow) && (lowerWickRatio >= 0.48);

    const buyTriggered = buyStepSweep || buyM5SupportBounce || buyDeepDiscount;
    const buyRefLevel = buyM5SupportBounce ? parseFloat(ema60M5.toFixed(2)) : stepLow;
    const buyChaseDist = Math.abs(goldData.currentPrice - buyRefLevel);

    if (
      isSweepGreen && // SADECE YEŞİL DÖNÜŞ MUMUNDA LONG!
      buyTriggered &&
      lowerWickRatio >= MIN_WICK_RATIO &&
      currentCandle.close >= sweepCandle.close &&
      buyChaseDist <= MAX_ENTRY_CHASE &&
      (roomToTopWall >= MIN_ROOM_TO_WALL || distFromM5Ema <= -dynamicOverextended)
    ) {
      const entry = goldData.currentPrice;
      const wickPct = Math.round(lowerWickRatio * 100);
      const projectedMove = predictExpectedMove(boxRange, wickPct, isNySession);
      const setupTag = buyM5SupportBounce
        ? "M5 EMA 60 Ana Destek Dibi"
        : (buyDeepDiscount ? "Aşırı Satım Dip Dönüşü" : "M5 Trend Basamak Dibi");

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
    // 2. TEPEDEN SHORT (SELL) KURULUMU — KIRMIZI DÖNÜŞ MUMU + BOŞ ALAN KALKANI
    // -------------------------------------------------------------------------
    const isM5DownTrend = m5Slope <= -0.45 && goldData.currentPrice <= ema60M5 + 1.50;
    const isUpSlowing = m5Slope <= m5PrevSlope || m5Slope <= 0.85;
    const roomToBottomWall = goldData.currentPrice - rangeLow45; // Alttaki dibe kalan mesafe

    // Senaryo A: M5 Düşüş Trendinde Kısa Basamak Tepesi Süpürme
    const sellStepSweep = isM5DownTrend && (sweepCandle.high >= stepHigh + 0.25) && (sweepCandle.close < stepHigh) && (pricePositionPct >= 32);
    // Senaryo B: M5 EMA 60 Ana Direncine Dokunup Kırmızı Mumla Reddedilme
    const sellM5ResistReject = (m5Slope <= -0.25) && (sweepCandle.high >= ema60M5 - 1.00) && (sweepCandle.high <= ema60M5 + 2.50) && (sweepCandle.close < ema60M5 + 0.50);
    // Senaryo C: Aşırı Şişmiş Zirve Dönüşü (Kanal en üst %25'te veya dinamik aşırı alımda + eğim yavaşlamış)
    const sellOverextendedTop = ((pricePositionPct >= 75) || (distFromM5Ema >= dynamicOverextended)) &&
      isUpSlowing &&
      (sweepCandle.high >= stepHigh + 0.25) &&
      (sweepCandle.close < stepHigh) &&
      (upperWickRatio >= 0.50);

    const sellTriggered = sellStepSweep || sellM5ResistReject || sellOverextendedTop;
    const sellRefLevel = sellM5ResistReject ? parseFloat(ema60M5.toFixed(2)) : stepHigh;
    const sellChaseDist = Math.abs(sellRefLevel - goldData.currentPrice);

    if (
      !newSignal &&
      isSweepRed && // SADECE KIRMIZI DÖNÜŞ MUMUNDA SHORT!
      sellTriggered &&
      upperWickRatio >= MIN_WICK_RATIO &&
      currentCandle.close <= sweepCandle.close &&
      sellChaseDist <= MAX_ENTRY_CHASE &&
      (roomToBottomWall >= MIN_ROOM_TO_WALL || distFromM5Ema >= dynamicOverextended)
    ) {
      const entry = goldData.currentPrice;
      const wickPct = Math.round(upperWickRatio * 100);
      const projectedMove = predictExpectedMove(boxRange, wickPct, isNySession);
      const setupTag = sellM5ResistReject
        ? "M5 EMA 60 Ana Direnç Tepesi"
        : (sellOverextendedTop ? "Aşırı Şişmiş Zirve Avı" : "M5 Trend Basamak Tepesi");

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
        status: "SCANNING_SPOT_GOLD",
        livePrice: goldData.currentPrice,
        ema60M5: parseFloat(ema60M5.toFixed(2)),
        ema60M1: parseFloat(ema60M1.toFixed(2)),
        m5Slope,
        pricePositionPct,
        dynamicOverextended,
        stepHigh,
        stepLow,
        mode: "24H_SPOT_SNIPER_V6"
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
      `🏆 <b>XAUUSD (GOLD) | SPOT M5+M1 SNIPER (V6)</b>\n` +
      `━━━━━━━━━━━━━━━━━━━━\n` +
      `🧭 <b>İşlem Yönü:</b> ${isBuy ? '🟢 BUY (DİPTEN LONG)' : '🔴 SELL (TEPEDEN SHORT)'}\n` +
      `⚡ <b>Kurulum Tipi:</b> ${newSignal.setupType}\n` +
      `🧱 <b>Dip/Tepe Seviyesi:</b> <code>$${newSignal.level.toFixed(2)}</code> (İğne: $${newSignal.wick.toFixed(2)} | %${newSignal.wickPct} Fitil)\n` +
      `📊 <b>M5 EMA 60 / Kanal:</b> <code>$${newSignal.ema60.toFixed(2)}</code> (Kanal Konumu: %${newSignal.pricePositionPct})\n` +
      `━━━━━━━━━━━━━━━━━━━━\n` +
      `💵 <b>Giriş Fiyatı:</b> <code>$${newSignal.entry.toFixed(2)}</code>\n` +
      `🎯 <b>Hızlı TP (+$${TP_DOLLAR.toFixed(2)}):</b> <code>$${newSignal.tp.toFixed(2)}</code>\n` +
      `🚀 <b>Tahmini Menzil (+$${newSignal.projectedMove.toFixed(2)}):</b> <code>$${newSignal.projectedTp.toFixed(2)}</code>\n` +
      `🛑 <b>Stop-Loss (-$${SL_DOLLAR.toFixed(2)}):</b> <code>$${newSignal.sl.toFixed(2)}</code>\n` +
      `━━━━━━━━━━━━━━━━━━━━\n` +
      `🤖 <i>XM Global MT5 köprüsü ${LOT_SIZE.toFixed(2)} Lot işledi; 7/24 takip aktiftir.</i>`;

    await sendTelegramAlert(entryMsg);

    return res.status(200).json({
      success: true,
      mode: "24H_SPOT_SNIPER_V6",
      signal: newSignal
    });

  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}
