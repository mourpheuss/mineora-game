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
    // 0. TELEGRAM & OANDA XAUUSD SCALP PARAMETRELERİ (EMA 60 + MENZİL ÖNGÖRÜSÜ)
    // =========================================================================
    const TG_BOT_TOKEN = "8682225307:AAHaa-hieKBBluU6uZ2_-OgSPxGR7OwMssE";
    const TG_CHANNEL_ID = "-1004404988937";
    const TG_ADMIN_ID = "6457294906";
    const FIREBASE_BASE_URL = "https://mineora-web-default-rtdb.firebaseio.com";

    const TP_DOLLAR = 3.00;                     // SABİT +$3.00 GARANTİ SCALP HEDEFİ
    const SL_DOLLAR = 5.00;                     // SABİT -$5.00 STOP
    const EMA_MAX_DIST = 4.00;                  // EMA 60 ŞELALE / RALLİ KORUMA MESAFESİ ($4.00)
    const RECOMMENDED_LOT = "0.10";             // XM ÖNERİLEN LOT (0.10 Lot = +$28 TP / -$52 SL)
    const SIGNAL_COOLDOWN_MS = 10 * 60 * 1000;  // SİNYALLER ARASI 10 DK BEKLEME
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

    function predictExpectedMove(boxRange, wickPct, isTrendAligned, isNySession) {
      const baseMove = boxRange * 0.65;
      const wickMult = wickPct >= 60 ? 1.20 : 1.00;
      const trendMult = isTrendAligned ? 1.35 : 0.85;
      const sessionMult = isNySession ? 1.30 : 1.00;
      const expected = baseMove * wickMult * trendMult * sessionMult;
      return parseFloat(Math.max(TP_DOLLAR, expected).toFixed(2));
    }

    // 1. TÜRKİYE SAATİ (UTC+3) KONTROLÜ: SADECE 09:30 - 22:30 ARASI ÇALIŞIR
    const nowUtc3 = new Date(Date.now() + 3 * 3600 * 1000);
    const dayOfWeek = nowUtc3.getUTCDay(); // 0 = Pazar, 6 = Cumartesi
    const hourDec = nowUtc3.getUTCHours() + nowUtc3.getUTCMinutes() / 60;

    if (dayOfWeek === 0 || dayOfWeek === 6) {
      return res.status(200).json({ status: "WEEKEND_CLOSED", message: "Hafta sonu altın piyasası kapalı." });
    }

    if (hourDec < 9.5 || hourDec > 22.5) {
      return res.status(200).json({
        status: "OUT_OF_HOURS",
        message: "Gece modu aktif (09:30 - 22:30 dışında sinyal üretilmez)."
      });
    }

    const isNySession = hourDec >= 15.5 && hourDec <= 19.5;

    // 2. OANDA:XAUUSD CANLI FİYAT VE 100 ADET 1 DAKİKALIK MUM VERİSİ
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

    // 3. FIREBASE ÜZERİNDEN AÇIK SİNYALLERİ ÇEK
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
    // MODÜL 1: CANLI +$3.00 TP VE -$5.00 SL DENETLEYİCİSİ
    // =========================================================================
    async function evaluateOpenGoldSignals(livePrice) {
      let openCount = 0;

      for (const [sigKey, sig] of Object.entries(goldSignals)) {
        if (!sig || sig.status !== 'OPEN') continue;
        openCount++;

        const isBuy = sig.direction === 'BUY';
        const diffDollar = isBuy ? (livePrice - sig.entry) : (sig.entry - livePrice);

        // +$3.00 TP VURULDU!
        if (diffDollar >= TP_DOLLAR) {
          sig.status = 'TP_HIT';
          sig.exitPrice = livePrice;
          sig.closedAt = Date.now();
          sig.realizedDollar = parseFloat(diffDollar.toFixed(2));

          const tpMsg = `🎯 <b>XM GOLD (OANDA:XAUUSD) | +$3.00 TP GELDİ!</b>\n` +
                        `━━━━━━━━━━━━━━━━━━━━\n` +
                        `🧭 <b>İşlem Yönü:</b> ${isBuy ? '🟢 BUY' : '🔴 SELL'}\n` +
                        `💵 <b>Giriş Fiyatı:</b> <code>$${sig.entry.toFixed(2)}</code>\n` +
                        `🏁 <b>Kapanış (TP):</b> <code>$${livePrice.toFixed(2)}</code>\n` +
                        `💰 <b>Net Hareket:</b> <b>+$${diffDollar.toFixed(2)}</b> (${RECOMMENDED_LOT} Lot ≈ +$28 Net)\n` +
                        `🚀 <b>Uzama Hedefi:</b> <code>$${(sig.projectedTp || sig.tp).toFixed(2)}</code> (+$${(sig.projectedMove || TP_DOLLAR).toFixed(2)})\n` +
                        `✨ <i>İlk +$3.00 hedef tamamlandı; dilerseniz maliyete stop çekip uzama hedefini takip edebilirsiniz.</i>`;

          await sendTelegramAlert(tpMsg);

          await fetch(`${FIREBASE_BASE_URL}/gold_signals/${sigKey}.json`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(sig)
          });
          openCount--;
          continue;
        }

        // -$5.00 SL VURULDU!
        if (diffDollar <= -SL_DOLLAR) {
          sig.status = 'SL_HIT';
          sig.exitPrice = livePrice;
          sig.closedAt = Date.now();
          sig.realizedDollar = parseFloat(diffDollar.toFixed(2));

          const slMsg = `🛑 <b>XM GOLD (OANDA:XAUUSD) | STOP-LOSS (-$5.00)</b>\n` +
                        `━━━━━━━━━━━━━━━━━━━━\n` +
                        `🧭 <b>İşlem Yönü:</b> ${isBuy ? '🟢 BUY' : '🔴 SELL'}\n` +
                        `💵 <b>Giriş Fiyatı:</b> <code>$${sig.entry.toFixed(2)}</code>\n` +
                        `📉 <b>Stop Fiyatı:</b> <code>$${livePrice.toFixed(2)}</code>\n` +
                        `🛡️ <i>-$5.00 stop seviyesi çalıştı; yeni kurulum bekleniyor.</i>`;

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
    // NÖBETÇİ MODU: AKTİF SİNYAL VARSA 50 SANİYE BOYUNCA 2.5 SN'DE BİR TP KONTROLÜ YAP
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
          status: "TRACKING_TP",
          livePrice: goldData.currentPrice,
          message: "Açık altın sinyali +$3.00 TP / -$5.00 SL için canlı takip ediliyor."
        });
      }
    }

    // =========================================================================
    // MODÜL 2: OANDA:XAUUSD M1 LİKİDİTE SÜPÜRME + EMA 60 + MENZİL ÖNGÖRÜSÜ
    // =========================================================================
    if (Date.now() - lastSignalTimestamp < SIGNAL_COOLDOWN_MS) {
      return res.status(200).json({
        status: "COOLDOWN",
        livePrice: goldData.currentPrice,
        message: "Son sinyal sonrası 10 dakikalık soğuma süresi bekleniyor."
      });
    }

    const candles = goldData.candles;
    const ema60 = calculateEMA(candles, 60);
    const sweepCandle = candles[candles.length - 2];
    const currentCandle = candles[candles.length - 1];
    const pool13m = candles.slice(candles.length - 15, candles.length - 2);

    const microHigh = Math.max(...pool13m.map(c => c.high));
    const microLow = Math.min(...pool13m.map(c => c.low));
    const boxRange = microHigh - microLow;

    if (boxRange < 2.80) {
      return res.status(200).json({
        status: "SCANNING_RANGE",
        livePrice: goldData.currentPrice,
        ema60: parseFloat(ema60.toFixed(2)),
        boxRange: boxRange.toFixed(2)
      });
    }

    const candleSpan = sweepCandle.high - sweepCandle.low;
    if (candleSpan <= 0) {
      return res.status(200).json({ status: "FLAT_CANDLE" });
    }

    const lowerWick = Math.min(sweepCandle.open, sweepCandle.close) - sweepCandle.low;
    const upperWick = sweepCandle.high - Math.max(sweepCandle.open, sweepCandle.close);

    let newSignal = null;

    // BUY TETİĞİ: Likidite süpürmesi + Fiyat EMA 60'ın $4.00 altında şelale düşüşünde olmamalı
    const isBuySafeFromWaterfall = goldData.currentPrice >= (ema60 - EMA_MAX_DIST);
    const isBuySweep =
      isBuySafeFromWaterfall &&
      (sweepCandle.low <= microLow - 0.32) &&
      (sweepCandle.close > microLow) &&
      ((lowerWick / candleSpan) >= 0.46) &&
      (currentCandle.close >= sweepCandle.close);

    if (isBuySweep) {
      const entry = goldData.currentPrice;
      const wickPct = Math.round((lowerWick / candleSpan) * 100);
      const isTrendAligned = entry >= ema60;
      const projectedMove = predictExpectedMove(boxRange, wickPct, isTrendAligned, isNySession);

      newSignal = {
        id: `gold_${Date.now()}`,
        symbol: "XAUUSD",
        source: goldData.source,
        direction: "BUY",
        entry: parseFloat(entry.toFixed(2)),
        tp: parseFloat((entry + TP_DOLLAR).toFixed(2)),
        sl: parseFloat((entry - SL_DOLLAR).toFixed(2)),
        projectedMove,
        projectedTp: parseFloat((entry + projectedMove).toFixed(2)),
        isTrendAligned,
        ema60: parseFloat(ema60.toFixed(2)),
        level: parseFloat(microLow.toFixed(2)),
        wick: parseFloat(sweepCandle.low.toFixed(2)),
        wickPct,
        status: "OPEN",
        createdAt: Date.now()
      };
    }

    // SELL TETİĞİ: Likidite süpürmesi + Fiyat EMA 60'ın $4.00 üstünde ralli kırılımında olmamalı
    const isSellSafeFromRally = goldData.currentPrice <= (ema60 + EMA_MAX_DIST);
    const isSellSweep =
      !newSignal &&
      isSellSafeFromRally &&
      (sweepCandle.high >= microHigh + 0.32) &&
      (sweepCandle.close < microHigh) &&
      ((upperWick / candleSpan) >= 0.46) &&
      (currentCandle.close <= sweepCandle.close);

    if (isSellSweep) {
      const entry = goldData.currentPrice;
      const wickPct = Math.round((upperWick / candleSpan) * 100);
      const isTrendAligned = entry <= ema60;
      const projectedMove = predictExpectedMove(boxRange, wickPct, isTrendAligned, isNySession);

      newSignal = {
        id: `gold_${Date.now()}`,
        symbol: "XAUUSD",
        source: goldData.source,
        direction: "SELL",
        entry: parseFloat(entry.toFixed(2)),
        tp: parseFloat((entry - TP_DOLLAR).toFixed(2)),
        sl: parseFloat((entry + SL_DOLLAR).toFixed(2)),
        projectedMove,
        projectedTp: parseFloat((entry - projectedMove).toFixed(2)),
        isTrendAligned,
        ema60: parseFloat(ema60.toFixed(2)),
        level: parseFloat(microHigh.toFixed(2)),
        wick: parseFloat(sweepCandle.high.toFixed(2)),
        wickPct,
        status: "OPEN",
        createdAt: Date.now()
      };
    }

    if (!newSignal) {
      return res.status(200).json({
        status: "SCANNING_OANDA_GOLD",
        livePrice: goldData.currentPrice,
        ema60: parseFloat(ema60.toFixed(2)),
        microHigh,
        microLow
      });
    }

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
    const trendLabel = newSignal.isTrendAligned ? "EMA 60 Trend Yönü (Güçlü)" : "EMA 60 Düzeltme Tepkisi";

    const entryMsg = `🏆 <b>XM GOLD (OANDA:XAUUSD) | $3.00 SCALP SİNYALİ</b>\n` +
                     `━━━━━━━━━━━━━━━━━━━━\n` +
                     `🧭 <b>Yön:</b> ${isBuy ? '🟢 BUY (LONG)' : '🔴 SELL (SHORT)'}\n` +
                     `🧱 <b>Avlanan Seviye:</b> <code>$${newSignal.level.toFixed(2)}</code> (İğne: $${newSignal.wick.toFixed(2)} | %${newSignal.wickPct} Fitil)\n` +
                     `📊 <b>EMA 60 Durumu:</b> <code>$${newSignal.ema60.toFixed(2)}</code> (${trendLabel})\n` +
                     `━━━━━━━━━━━━━━━━━━━━\n` +
                     `💵 <b>Giriş Fiyatı:</b> <code>$${newSignal.entry.toFixed(2)}</code>\n` +
                     `🎯 <b>İlk Scalp TP (+$3.00):</b> <code>$${newSignal.tp.toFixed(2)}</code>\n` +
                     `🚀 <b>Tahmini Menzil (+$${newSignal.projectedMove.toFixed(2)}):</b> <code>$${newSignal.projectedTp.toFixed(2)}</code>\n` +
                     `🛑 <b>Stop-Loss (-$5.00):</b> <code>$${newSignal.sl.toFixed(2)}</code>\n` +
                     `⚖️ <b>Önerilen Lot:</b> <code>${RECOMMENDED_LOT} Lot</code> (TP Net: ~$28)\n` +
                     `━━━━━━━━━━━━━━━━━━━━\n` +
                     `⏱️ <i>Geç kalınırsa tahmini menzile kadar kalan mesafe değerlendirilebilir. +$3.00 ulaşınca bildirim gelir.</i>`;

    await sendTelegramAlert(entryMsg);

    return res.status(200).json({
      success: true,
      signal: newSignal
    });

  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}
