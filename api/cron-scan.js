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
    // 0. TELEGRAM, METAAPI (XM MT5) & OANDA XAUUSD SCALP PARAMETRELERİ
    // =========================================================================
    const TG_BOT_TOKEN = "8682225307:AAHaa-hieKBBluU6uZ2_-OgSPxGR7OwMssE";
    const TG_CHANNEL_ID = "-1004404988937";
    const TG_ADMIN_ID = "6457294906";
    const FIREBASE_BASE_URL = "https://mineora-web-default-rtdb.firebaseio.com";

    // METAAPI CLOUD MT5 BAĞLANTI BİLGİLERİ (XMGlobal-MT5 17 - GÜNCEL HESAP ID)
    const METAAPI_ACCOUNT_ID = "4c7903fe-bcf9-49e7-a8fd-6f5fe4e4d8dc";
    const METAAPI_TOKEN = "eyJhbGciOiJSUzUxMiIsInR5cCI6IkpXVCJ9.eyJfaWQiOiIyMjY4NDRhOGJiMjEwMGI5YTE5Mzk0MzQ2ZWJkZjk1MSIsImFjY2Vzc1J1bGVzIjpbeyJpZCI6InRyYWRpbmctYWNjb3VudC1tYW5hZ2VtZW50LWFwaSIsIm1ldGhvZHMiOlsidHJhZGluZy1hY2NvdW50LW1hbmFnZW1lbnQtYXBpOnJlc3Q6cHVibGljOio6KiJdLCJyb2xlcyI6WyJyZWFkZXIiLCJ3cml0ZXIiXSwicmVzb3VyY2VzIjpbIio6JFVTRVJfSUQkOioiXX0seyJpZCI6Im1ldGFhcGktcmVzdC1hcGkiLCJtZXRob2RzIjpbIm1ldGFhcGktYXBpOnJlc3Q6cHVibGljOio6KiJdLCJyb2xlcyI6WyJyZWFkZXIiLCJ3cml0ZXIiXSwicmVzb3VyY2VzIjpbIio6JFVTRVJfSUQkOioiXX0seyJpZCI6Im1ldGFhcGktcnBjLWFwaSIsIm1ldGhvZHMiOlsibWV0YWFwaS1hcGk6d3M6cHVibGljOio6KiJdLCJyb2xlcyI6WyJyZWFkZXIiLCJ3cml0ZXIiXSwicmVzb3VyY2VzIjpbIio6JFVTRVJfSUQkOioiXX0seyJpZCI6Im1ldGFhcGktcmVhbC10aW1lLXN0cmVhbWluZy1hcGkiLCJtZXRob2RzIjpbIm1ldGFhcGktYXBpOndzOnB1YmxpYzoqOioiXSwicm9sZXMiOlsicmVhZGVyIiwid3JpdGVyIl0sInJlc291cmNlcyI6WyIqOiRVU0VSX0lEJDoqIl19LHsiaWQiOiJtZXRhc3RhdHMtYXBpIiwibWV0aG9kcyI6WyJtZXRhc3RhdHMtYXBpOnJlc3Q6cHVibGljOio6KiJdLCJyb2xlcyI6WyJyZWFkZXIiLCJ3cml0ZXIiXSwicmVzb3VyY2VzIjpbIio6JFVTRVJfSUQkOioiXX0seyJpZCI6InJpc2stbWFuYWdlbWVudC1hcGkiLCJtZXRob2RzIjpbInJpc2stbWFuYWdlbWVudC1hcGk6cmVzdDpwdWJsaWM6KjoqIl0sInJvbGVzIjpbInJlYWRlciIsIndyaXRlciJdLCJyZXNvdXJjZXMiOlsiKjokVVNFUl9JRCQ6KiJdfSx7ImlkIjoiY29weWZhY3RvcnktYXBpIiwibWV0aG9kcyI6WyJjb3B5ZmFjdG9yeS1hcGk6cmVzdDpwdWJsaWM6KjoqIl0sInJvbGVzIjpbInJlYWRlciIsIndyaXRlciJdLCJyZXNvdXJjZXMiOlsiKjokVVNFUl9JRCQ6KiJdfSx7ImlkIjoibXQtbWFuYWdlci1hcGkiLCJtZXRob2RzIjpbIm10LW1hbmFnZXItYXBpOnJlc3Q6ZGVhbGluZzoqOioiLCJtdC1tYW5hZ2VyLWFwaTpyZXN0OnB1YmxpYzoqOioiXSwicm9sZXMiOlsicmVhZGVyIiwid3JpdGVyIl0sInJlc291cmNlcyI6WyIqOiRVU0VSX0lEJDoqIl19LHsiaWQiOiJiaWxsaW5nLWFwaSIsIm1ldGhvZHMiOlsiYmlsbGluZy1hcGk6cmVzdDpwdWJsaWM6KjoqIl0sInJvbGVzIjpbInJlYWRlciJdLCJyZXNvdXJjZXMiOlsiKjokVVNFUl9JRCQ6KiJdfV0sImlnbm9yZVJhdGVMaW1pdHMiOmZhbHNlLCJ0b2tlbklkIjoiMjAyMTAyMTMiLCJpbXBlcnNvbmF0ZWQiOmZhbHNlLCJyZWFsVXNlcklkIjoiMjI2ODQ0YThiYjIxMDBiOWExOTM5NDM0NmViZGY5NTEiLCJpYXQiOjE3OTU1MjkwNjgsImV4cCI6MTgwMzMwNTA2OH0.QGK9lSxYYjJMU4vwePvzpcy0DJufMbvfiF2YtzZEJa-w7A3vH7zgX1hRniwk4lNCPARSbQoug1w-uYY82Zlbr79rVdr2oQ1f3grby2uwOWg7FPjwdgbRvEXF3wF2vJvw2QIhclhvpKD5YLQM71O9bz1H_N0ZcpVooX-lRnhL0dNuxqQW5eJmu0WXYIQekrjgBxyxbT40agNEaACNOdq3bQ1qpmVA79Mt19zsrmsfnSKweqjcXu5I3IMfKmLmchZfKAiGkobVxySiXYeN1DQzj19GkJFFJQb3nv8lSDN8AWmG2dHnQy9rUFXShXQux3VJxJiz2hFy9ZQJv9uq2P6kAjB92kFUwj67BS8pErRAJyZt5MmHTd1m9LshVtTI5J76RblW_-5Q616OpkiQFdbTnaKiJy9QBGhVwaKkDI4LVjia0XbxbdzgnzSylyOIJuHyh0Ru9O0Ov13mbVwkNQsw2RAQyqL9UNzcKysi5JAo4-OWlOTurHhDFeErR6nC9Y-OP7U7b7crnkEh839uBnmHh1l6d4pnEDNo52TBc0w2pehJRmFb1X2qMmmvGsEw0saNcUAVKXHOT0RH3oEVV1a5mQ9y6UdH6b6SzaYZISV17v-9zUAHtNoSIVosRQR0afNREl1TGmGLH5HO5bSUiEiPHGKgDVDtxQMms-1HWVT8JrQ";
    const MT5_SYMBOL = "GOLD";                  // XM MT5 SEMBOL ADI

    const LOT_SIZE = 0.20;                      // SABİT İŞLEM LOTU (0.20 LOT)
    const TP_DOLLAR = 4.00;                     // SABİT +$4.00 GÖMÜLÜ TAKE-PROFIT
    const SL_DOLLAR = 5.00;                     // SABİT -$5.00 GÖMÜLÜ STOP-LOSS
    const EMA_MAX_DIST = 4.00;                  // EMA 60 ŞELALE / RALLİ KORUMA MESAFESİ ($4.00)
    const SIGNAL_COOLDOWN_MS = 10 * 60 * 1000;  // SİNYALLER ARASI 10 DK BEKLEME
    const startTime = Date.now();

    const METAAPI_REGIONS = [
      "https://mt-client-api-v1.london.agiliumtrade.ai",
      "https://mt-client-api-v1.new-york.agiliumtrade.ai",
      "https://mt-client-api-v1.agiliumtrade.ag"
    ];

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

    // CANLI METAAPI BAĞLANTI VE OTOMATİK EMİR DURUMU KONTROLÜ
    async function checkMetaApiStatus() {
      try {
        const res = await fetch(
          `https://mt-provisioning-api-v1.agiliumtrade.ag/users/current/accounts/${METAAPI_ACCOUNT_ID}`,
          {
            method: "GET",
            headers: { "auth-token": METAAPI_TOKEN, "Accept": "application/json" }
          }
        );
        if (!res.ok) return { connected: false, state: "API_AUTH_ERROR" };
        const acc = await res.json();
        const isReady = acc.state === "DEPLOYED" && acc.connectionStatus === "CONNECTED";
        return {
          connected: isReady,
          state: acc.state || "UNKNOWN",
          connectionStatus: acc.connectionStatus || "DISCONNECTED"
        };
      } catch (e) {
        return { connected: false, state: "CHECK_FAILED" };
      }
    }

    // METAAPI CLOUD ÜZERİNDEN XM MT5 HESABINA OTOMATİK EMİR GÖNDERİMİ
    async function executeMetaApiTrade(direction, volume, slPrice, tpPrice) {
      const payload = {
        actionType: direction === "BUY" ? "ORDER_TYPE_BUY" : "ORDER_TYPE_SELL",
        symbol: MT5_SYMBOL,
        volume: Number(volume),
        stopLoss: Number(slPrice.toFixed(2)),
        takeProfit: Number(tpPrice.toFixed(2)),
        comment: "MineoraGoldScalp"
      };

      let lastErr = "MetaApi bağlantı hatası";

      for (const baseUrl of METAAPI_REGIONS) {
        try {
          const response = await fetch(
            `${baseUrl}/users/current/accounts/${METAAPI_ACCOUNT_ID}/trade`,
            {
              method: "POST",
              headers: {
                "auth-token": METAAPI_TOKEN,
                "Content-Type": "application/json",
                "Accept": "application/json"
              },
              body: JSON.stringify(payload)
            }
          );
          const result = await response.json();
          if (response.ok && (result.stringCode === "TRADE_RETCODE_DONE" || result.orderId || result.positionId)) {
            return { success: true, data: result };
          }
          lastErr = result.message || result.stringCode || JSON.stringify(result);
          if (result.error === "NotFoundException") continue;
          return { success: false, error: lastErr };
        } catch (err) {
          lastErr = err.message;
        }
      }
      return { success: false, error: lastErr };
    }

    // 1. TÜRKİYE SAATİ (UTC+3) KONTROLÜ: SADECE 08:30 - 23:00 ARASI ÇALIŞIR
    const nowUtc3 = new Date(Date.now() + 3 * 3600 * 1000);
    const dayOfWeek = nowUtc3.getUTCDay(); // 0 = Pazar, 6 = Cumartesi
    const hourDec = nowUtc3.getUTCHours() + nowUtc3.getUTCMinutes() / 60;

    if (dayOfWeek === 0 || dayOfWeek === 6) {
      return res.status(200).json({ status: "WEEKEND_CLOSED", message: "Hafta sonu altın piyasası kapalı." });
    }

    if (hourDec < 8.5 || hourDec > 23.0) {
      return res.status(200).json({
        status: "OUT_OF_HOURS",
        message: "Gece modu aktif (08:30 - 23:00 dışında sinyal üretilmez)."
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

    const [goldData, mt5Health] = await Promise.all([
      fetchOandaGoldData(),
      checkMetaApiStatus()
    ]);

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
    // MODÜL 1: CANLI +$4.00 TP VE -$5.00 SL DENETLEYİCİSİ
    // =========================================================================
    async function evaluateOpenGoldSignals(livePrice) {
      let openCount = 0;

      for (const [sigKey, sig] of Object.entries(goldSignals)) {
        if (!sig || sig.status !== 'OPEN') continue;
        openCount++;

        const isBuy = sig.direction === 'BUY';
        const diffDollar = isBuy ? (livePrice - sig.entry) : (sig.entry - livePrice);

        // +$4.00 TP VURULDU!
        if (diffDollar >= TP_DOLLAR) {
          sig.status = 'TP_HIT';
          sig.exitPrice = livePrice;
          sig.closedAt = Date.now();
          sig.realizedDollar = parseFloat(diffDollar.toFixed(2));

          const usedLot = sig.lotSize || LOT_SIZE;
          const estNetUsd = (diffDollar * usedLot * 100 - usedLot * 20).toFixed(2);

          const tpMsg = `🎯 <b>XM MT5 (GOLD) | +$4.00 TP VURULDU!</b>\n` +
                        `━━━━━━━━━━━━━━━━━━━━\n` +
                        `🧭 <b>İşlem Yönü:</b> ${isBuy ? '🟢 BUY' : '🔴 SELL'} (${usedLot.toFixed(2)} Lot)\n` +
                        `💵 <b>Giriş Fiyatı:</b> <code>$${sig.entry.toFixed(2)}</code>\n` +
                        `🏁 <b>Kapanış (TP):</b> <code>$${livePrice.toFixed(2)}</code>\n` +
                        `💰 <b>Net Hareket:</b> <b>+$${diffDollar.toFixed(2)}</b> (~+$${estNetUsd} Net Kâr)\n` +
                        `✨ <i>MT5 üzerindeki gömülü TP başarıyla tetiklendi.</i>`;

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

          const slMsg = `🛑 <b>XM MT5 (GOLD) | STOP-LOSS (-$5.00)</b>\n` +
                        `━━━━━━━━━━━━━━━━━━━━\n` +
                        `🧭 <b>İşlem Yönü:</b> ${isBuy ? '🟢 BUY' : '🔴 SELL'}\n` +
                        `💵 <b>Giriş Fiyatı:</b> <code>$${sig.entry.toFixed(2)}</code>\n` +
                        `📉 <b>Stop Fiyatı:</b> <code>$${livePrice.toFixed(2)}</code>\n` +
                        `🛡️ <i>MT5 üzerindeki -$5.00 gömülü stop çalıştı; yeni kurulum bekleniyor.</i>`;

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
          lotSize: LOT_SIZE,
          mt5_auto_trade: mt5Health,
          message: "Açık XM MT5 GOLD pozisyonu +$4.00 TP / -$5.00 SL için canlı izleniyor."
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
        lotSize: LOT_SIZE,
        mt5_auto_trade: mt5Health,
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
        boxRange: boxRange.toFixed(2),
        lotSize: LOT_SIZE,
        mt5_auto_trade: mt5Health
      });
    }

    const candleSpan = sweepCandle.high - sweepCandle.low;
    if (candleSpan <= 0) {
      return res.status(200).json({ status: "FLAT_CANDLE", mt5_auto_trade: mt5Health });
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
        symbol: MT5_SYMBOL,
        source: goldData.source,
        direction: "BUY",
        lotSize: LOT_SIZE,
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
        symbol: MT5_SYMBOL,
        source: goldData.source,
        direction: "SELL",
        lotSize: LOT_SIZE,
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
        microLow,
        lotSize: LOT_SIZE,
        mt5_auto_trade: mt5Health
      });
    }

    // =========================================================================
    // MODÜL 3: XM MT5 HESABINA OTOMATİK EMİR GÖNDER (0.20 LOT | +$4.00 TP / -$5.00 SL)
    // =========================================================================
    const mt5Exec = await executeMetaApiTrade(
      newSignal.direction,
      newSignal.lotSize,
      newSignal.sl,
      newSignal.tp
    );

    newSignal.mt5Status = mt5Exec.success ? "EXECUTED" : "FAILED";
    newSignal.mt5Response = mt5Exec.success ? mt5Exec.data : mt5Exec.error;

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
    const mt5StatusLine = mt5Exec.success
      ? `✅ <b>XM MT5 Emri Açıldı</b> (${newSignal.lotSize.toFixed(2)} Lot | TP/SL Gömülü)`
      : `⚠️ <b>MT5 Emir Hatası:</b> <code>${mt5Exec.error}</code>`;

    const entryMsg = `🏆 <b>XM GOLD (OANDA:XAUUSD) | OTO MT5 İŞLEMİ</b>\n` +
                     `━━━━━━━━━━━━━━━━━━━━\n` +
                     `🧭 <b>Yön:</b> ${isBuy ? '🟢 BUY (LONG)' : '🔴 SELL (SHORT)'}\n` +
                     `🏦 <b>Borsa Durumu:</b> ${mt5StatusLine}\n` +
                     `🧱 <b>Avlanan Seviye:</b> <code>$${newSignal.level.toFixed(2)}</code> (İğne: $${newSignal.wick.toFixed(2)} | %${newSignal.wickPct} Fitil)\n` +
                     `📊 <b>EMA 60 Durumu:</b> <code>$${newSignal.ema60.toFixed(2)}</code> (${trendLabel})\n` +
                     `━━━━━━━━━━━━━━━━━━━━\n` +
                     `💵 <b>Giriş Fiyatı:</b> <code>$${newSignal.entry.toFixed(2)}</code>\n` +
                     `🎯 <b>Gömülü TP (+$4.00):</b> <code>$${newSignal.tp.toFixed(2)}</code>\n` +
                     `🚀 <b>Tahmini Menzil (+$${newSignal.projectedMove.toFixed(2)}):</b> <code>$${newSignal.projectedTp.toFixed(2)}</code>\n` +
                     `🛑 <b>Gömülü SL (-$5.00):</b> <code>$${newSignal.sl.toFixed(2)}</code>\n` +
                     `━━━━━━━━━━━━━━━━━━━━\n` +
                     `⏱️ <i>XMGlobal-MT5 17 hesabına 0.20 Lot ile +$4.00 TP ve -$5.00 SL doğrudan işlendi.</i>`;

    await sendTelegramAlert(entryMsg);

    return res.status(200).json({
      success: true,
      mt5_auto_trade: mt5Health,
      mt5_executed: mt5Exec.success,
      mt5_detail: newSignal.mt5Response,
      signal: newSignal
    });

  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}
