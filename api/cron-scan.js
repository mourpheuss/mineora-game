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
    // 0. TELEGRAM, FIREBASE & OANDA XAUUSD SCALP PARAMETRELERİ (HIZLI SCALP V3)
    // =========================================================================
    const TG_BOT_TOKEN = "8682225307:AAHaa-hieKBBluU6uZ2_-OgSPxGR7OwMssE";
    const TG_CHANNEL_ID = "-1004404988937";
    const TG_ADMIN_ID = "6457294906";
    const FIREBASE_BASE_URL = "https://mineora-web-default-rtdb.firebaseio.com";

    const MT5_SYMBOL = "GOLD";                  // XM MT5 SEMBOL ADI
    const LOT_SIZE = 0.30;                      // SABİT İŞLEM LOTU (0.30 LOT)
    const TP_DOLLAR = 4.00;                     // HIZLI TAKE-PROFIT (+$4.00 = $120)
    const SL_DOLLAR = 10.00;                    // STOP-LOSS (-$10.00 = -$300)
    const MIN_WICK_RATIO = 0.42;                // EN AZ %42 LİKİDİTE FİTİLİ
    const MIN_BOX_RANGE = 1.60;                 // EN AZ $1.60 KUTU GENİŞLİĞİ (DAHA FAZLA SİNYAL)
    const MAX_ENTRY_CHASE = 1.50;               // AVLANAN SEVİYEDEN MAKS. $1.50 UZAKLIK (GEÇ GİRİŞ ENGELİ)
    const SIGNAL_COOLDOWN_MS = 3 * 60 * 1000;   // SİNYALLER ARASI 3 DK BEKLEME
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

    // =========================================================================
    // 3. OANDA:XAUUSD CANLI FİYAT VE 100 ADET 1 DAKİKALIK MUM VERİSİ
    // =========================================================================
    async function fetchOandaGoldData() {
      let oandaLivePrice = 0;

      try {
        const tvRes = await fetch("https://scanner.tradingview.com/cfd/scan", {
          method: "POST",
          headers: browserHeaders,
          body: JSON.stringify({
            symbols: { tickers: ["OANDA:XAUUSD"], query: { types: [] } },
            columns: ["close", "high", "low", "open", "change", "change_abs"]
          })
        });
        const tvJson = await tvRes.json();
        if (tvJson?.data?.[0]?.d?.[0]) {
          oandaLivePrice = parseFloat(tvJson.data[0].d[0]);
        }
      } catch (e) {}

      const candleRes = await fetch(
        "https://api.bitget.com/api/v2/mix/market/candles?symbol=XAUUSDT&productType=USDT-FUTURES&granularity=1m&limit=100",
        { headers: browserHeaders }
      );
      const candleJson = await candleRes.json();
      if (candleJson.code !== '00000' || !Array.isArray(candleJson.data) || candleJson.data.length < 65) {
        return null;
      }

      const rawCandles = candleJson.data.map(c => ({
        time: Number(c[0]),
        open: Number(c[1]),
        high: Number(c[2]),
        low: Number(c[3]),
        close: Number(c[4])
      })).sort((a, b) => a.time - b.time);

      const lastRawClose = rawCandles[rawCandles.length - 1].close;
      const spreadOffset = (oandaLivePrice > 0 && Math.abs(oandaLivePrice - lastRawClose) < 25)
        ? (oandaLivePrice - lastRawClose)
        : 0;

      const candles = rawCandles.map(c => ({
        time: c.time,
        open: parseFloat((c.open + spreadOffset).toFixed(2)),
        high: parseFloat((c.high + spreadOffset).toFixed(2)),
        low: parseFloat((c.low + spreadOffset).toFixed(2)),
        close: parseFloat((c.close + spreadOffset).toFixed(2))
      }));

      const currentPrice = oandaLivePrice > 0 ? oandaLivePrice : candles[candles.length - 1].close;
      return { currentPrice, candles, source: oandaLivePrice > 0 ? "OANDA:XAUUSD" : "XAUUSD_FEED" };
    }

    const goldData = await fetchOandaGoldData();

    if (!goldData) {
      return res.status(500).json({ error: "OANDA XAUUSD piyasa verisi alınamadı." });
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
            `✅ <i>Hızlı hedef başarıyla tamamlandı!</i>`;

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
            `🛡️ <i>Stop seviyesi tetiklendi; yeni kurulum taranıyor.</i>`;

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
        const freshData = await fetchOandaGoldData();
        if (!freshData) continue;

        activeCount = await evaluateOpenGoldSignals(freshData.currentPrice);
        if (activeCount === 0) break;
      }

      if (activeCount > 0) {
        return res.status(200).json({
          status: "TRACKING_TP_SL",
          livePrice: goldData.currentPrice,
          mode: "24H_FAST_SCALP_MT5",
          message: `Açık sinyal +$${TP_DOLLAR.toFixed(2)} TP / -$${SL_DOLLAR.toFixed(2)} SL için canlı izleniyor.`
        });
      }
    }

    // =========================================================================
    // MODÜL 2: SAĞLAM TREND + EMA 60 EĞİM + YAKIN GİRİŞ KALKANI
    // =========================================================================
    if (Date.now() - lastSignalTimestamp < SIGNAL_COOLDOWN_MS) {
      return res.status(200).json({
        status: "COOLDOWN",
        livePrice: goldData.currentPrice,
        mode: "24H_FAST_SCALP_MT5",
        message: "Son sinyal sonrası 3 dakikalık soğuma süresi bekleniyor."
      });
    }

    const candles = goldData.candles;
    const ema60 = calculateEMA(candles, 60);
    const ema60Prev = calculateEMA(candles.slice(0, candles.length - 8), 60); // 8 mum önceki EMA 60

    const sweepCandle = candles[candles.length - 2];
    const currentCandle = candles[candles.length - 1];
    const pool13m = candles.slice(candles.length - 15, candles.length - 2);

    const microHigh = Math.max(...pool13m.map(c => c.high));
    const microLow = Math.min(...pool13m.map(c => c.low));
    const boxRange = microHigh - microLow;

    if (boxRange < MIN_BOX_RANGE) {
      return res.status(200).json({
        status: "SCANNING_RANGE",
        livePrice: goldData.currentPrice,
        ema60: parseFloat(ema60.toFixed(2)),
        boxRange: boxRange.toFixed(2),
        mode: "24H_FAST_SCALP_MT5"
      });
    }

    const candleSpan = sweepCandle.high - sweepCandle.low;
    if (candleSpan <= 0) {
      return res.status(200).json({ status: "FLAT_CANDLE", mode: "24H_FAST_SCALP_MT5" });
    }

    const lowerWick = Math.min(sweepCandle.open, sweepCandle.close) - sweepCandle.low;
    const upperWick = sweepCandle.high - Math.max(sweepCandle.open, sweepCandle.close);

    let newSignal = null;

    // BUY TETİĞİ — EMA 60 YUKARI EĞİMLİ + YAKIN GİRİŞ ($1.50 MAX) + FİTİL SÜPÜRME
    const isBuyTrend = goldData.currentPrice > ema60 && sweepCandle.close > ema60 && ema60 >= ema60Prev;
    const buyEntryDistance = goldData.currentPrice - microLow;
    const isBuySweep =
      isBuyTrend &&
      (sweepCandle.low <= microLow - 0.20) &&
      (sweepCandle.close > microLow) &&
      ((lowerWick / candleSpan) >= MIN_WICK_RATIO) &&
      (currentCandle.close >= sweepCandle.close) &&
      (buyEntryDistance > 0 && buyEntryDistance <= MAX_ENTRY_CHASE);

    if (isBuySweep) {
      const entry = goldData.currentPrice;
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
        level: parseFloat(microLow.toFixed(2)),
        wick: parseFloat(sweepCandle.low.toFixed(2)),
        wickPct,
        status: "OPEN",
        vpsExecuted: false,
        createdAt: Date.now()
      };
    }

    // SELL TETİĞİ — EMA 60 AŞAĞI EĞİMLİ + YAKIN GİRİŞ ($1.50 MAX) + FİTİL SÜPÜRME
    const isSellTrend = goldData.currentPrice < ema60 && sweepCandle.close < ema60 && ema60 <= ema60Prev;
    const sellEntryDistance = microHigh - goldData.currentPrice;
    const isSellSweep =
      !newSignal &&
      isSellTrend &&
      (sweepCandle.high >= microHigh + 0.20) &&
      (sweepCandle.close < microHigh) &&
      ((upperWick / candleSpan) >= MIN_WICK_RATIO) &&
      (currentCandle.close <= sweepCandle.close) &&
      (sellEntryDistance > 0 && sellEntryDistance <= MAX_ENTRY_CHASE);

    if (isSellSweep) {
      const entry = goldData.currentPrice;
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
        status: "SCANNING_OANDA_GOLD",
        livePrice: goldData.currentPrice,
        ema60: parseFloat(ema60.toFixed(2)),
        emaSlope: ema60 >= ema60Prev ? "UP" : "DOWN",
        activeTrend: goldData.currentPrice > ema60 ? "BUY_ONLY" : "SELL_ONLY",
        microHigh,
        microLow,
        mode: "24H_FAST_SCALP_MT5"
      });
    }

    // =========================================================================
    // MODÜL 3: SİNYALİ FIREBASE'E YAZ (VPS MT5 KÖPRÜSÜ + TELEGRAM BİLDİRİMİ)
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
      `🏆 <b>XAUUSD (GOLD) | HIZLI TREND SCALP (7/24)</b>\n` +
      `━━━━━━━━━━━━━━━━━━━━\n` +
      `🧭 <b>İşlem Yönü:</b> ${isBuy ? '🟢 BUY (LONG)' : '🔴 SELL (SHORT)'}\n` +
      `🧱 <b>Avlanan Seviye:</b> <code>$${newSignal.level.toFixed(2)}</code> (İğne: $${newSignal.wick.toFixed(2)} | %${newSignal.wickPct} Fitil)\n` +
      `📊 <b>EMA 60 Durumu:</b> <code>$${newSignal.ema60.toFixed(2)}</code> (Eğim Onaylı — Güçlü)\n` +
      `━━━━━━━━━━━━━━━━━━━━\n` +
      `💵 <b>Giriş Fiyatı:</b> <code>$${newSignal.entry.toFixed(2)}</code>\n` +
      `🎯 <b>Hızlı TP (+$${TP_DOLLAR.toFixed(2)}):</b> <code>$${newSignal.tp.toFixed(2)}</code>\n` +
      `🚀 <b>Tahmini Menzil (+$${newSignal.projectedMove.toFixed(2)}):</b> <code>$${newSignal.projectedTp.toFixed(2)}</code>\n` +
      `🛑 <b>Stop-Loss (-$${SL_DOLLAR.toFixed(2)}):</b> <code>$${newSignal.sl.toFixed(2)}</code>\n` +
      `━━━━━━━━━━━━━━━━━━━━\n` +
      `🤖 <i>VPS MT5 köprüsü ${LOT_SIZE.toFixed(2)} Lot hızlı scalp işledi; TP/SL bildirimleri aktiftir.</i>`;

    await sendTelegramAlert(entryMsg);

    return res.status(200).json({
      success: true,
      mode: "24H_FAST_SCALP_MT5",
      signal: newSignal
    });

  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}
