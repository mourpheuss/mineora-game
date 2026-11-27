export const config = {
  maxDuration: 60
};

export default async function handler(req, res) {
  try {
    // =========================================================================
    // 0. TELEGRAM, FIREBASE & DOĞRUDAN XM GLOBAL MT5 PARAMETRELERİ (V9.0 ÇİFT MOTOR)
    // =========================================================================
    const TG_BOT_TOKEN = "8682225307:AAHaa-hieKBBluU6uZ2_-OgSPxGR7OwMssE";
    const TG_CHANNEL_ID = "-1004404988937";
    const TG_ADMIN_ID = "6457294906";
    const FIREBASE_BASE_URL = "https://mineora-web-default-rtdb.firebaseio.com";

    const MT5_SYMBOL = "GOLD";                  // XM GLOBAL MT5 SEMBOL ADI
    const LOT_SIZE = 0.30;                      // SABİT İŞLEM LOTU (0.30 LOT -> $4 TP = +$120)
    const TP_DOLLAR = 4.00;                     // HIZLI TAKE-PROFIT (+$4.00)
    const SL_DOLLAR = 10.00;                    // STOP-LOSS (-$10.00)
    const MAX_ALLOWED_SPREAD = 0.80;            // MAKS. İZİN VERİLEN CANLI XM SPREAD ($0.80)
    const SIGNAL_COOLDOWN_MS = 15 * 60 * 1000;  // SİNYALLER ARASI 15 DK (15 BAR) SOĞUMA
    const MAX_FEED_STALE_MS = 35 * 1000;        // XM VERİSİ 35 SN'DEN ESKİYSE BEKLE

    // ÇİFT MOTOR PARAMETRELERİ (V3)
    const EMA_TREND_LEN = 200;                  // ANA YÖN KİLİDİ (EMA 200)
    const MIN_EMA_DIST = 2.00;                  // EMA 200'E EN AZ $2.00 MESAFE (YAPIŞIK YATAY KORUMA)
    const MAX_EMA_DIST = 8.50;                  // EMA 200'DEN EN FAZLA $8.50 UZAKLIK (AŞIRI ŞİŞME KORUMA)
    const MIN_SLOPE_MOT_A = 0.25;               // MOTOR A MİN. 30 DK EMA 200 EĞİMİ ($)
    const MIN_SLOPE_MOT_B = 0.30;               // MOTOR B MİN. 30 DK EMA 200 EĞİMİ ($)
    const MIN_ATR_MOT_A = 1.20;                 // MOTOR A MİN. ATR(14) VOLATİLİTESİ ($)
    const CCI_THRESH = 100.0;                   // CCI(20) AŞIRI BÖLGE EŞİĞİ (±100)
    const MIN_MACD_HIST_DEPTH = 0.30;           // MİN. MACD HİSTOGRAM ÇEKİLME DERİNLİĞİ ($)
    const LR_WINDOW = 60;                       // 60-BAR LİNEER REGRESYON KANALI PENCERESİ
    const LR_MULT = 2.0;                        // KANAL STANDART SAPMA ÇARPANI
    const MIN_WICK_RATIO = 0.45;                // MOTOR B MİN. REDDEDİLME FİTİL ORANI (%45)
    const MIN_VOL_MULT = 1.20;                  // MOTOR B MİN. TİK HACİM ÇARPANI (1.20x)

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

    // =========================================================================
    // TEKNİK HESAPLAMA FONKSİYONLARI (M1 KAPALI MUMLAR ÜZERİNDEN)
    // =========================================================================
    function calculateEMASeries(closes, period) {
      const n = closes.length;
      const out = new Array(n).fill(0);
      if (n === 0) return out;
      const k = 2 / (period + 1);
      if (n >= period) {
        let sum = 0;
        for (let i = 0; i < period; i++) sum += closes[i];
        out[period - 1] = sum / period;
        for (let i = 0; i < period - 1; i++) out[i] = out[period - 1];
        for (let i = period; i < n; i++) {
          out[i] = closes[i] * k + out[i - 1] * (1 - k);
        }
      } else {
        out[0] = closes[0];
        for (let i = 1; i < n; i++) {
          out[i] = closes[i] * k + out[i - 1] * (1 - k);
        }
      }
      return out;
    }

    function calculateATRSeries(candles, period = 14) {
      const n = candles.length;
      const tr = new Array(n).fill(0);
      for (let i = 0; i < n; i++) {
        if (i === 0) {
          tr[i] = candles[i].high - candles[i].low;
        } else {
          const prevC = candles[i - 1].close;
          tr[i] = Math.max(
            candles[i].high - candles[i].low,
            Math.abs(candles[i].high - prevC),
            Math.abs(candles[i].low - prevC)
          );
        }
      }
      return calculateEMASeries(tr, period);
    }

    function calculateCCISeries(candles, period = 20) {
      const n = candles.length;
      const tp = candles.map(c => (c.high + c.low + c.close) / 3);
      const out = new Array(n).fill(0);
      for (let i = period - 1; i < n; i++) {
        let sum = 0;
        for (let j = i - period + 1; j <= i; j++) sum += tp[j];
        const mean = sum / period;
        let devSum = 0;
        for (let j = i - period + 1; j <= i; j++) devSum += Math.abs(tp[j] - mean);
        const mad = devSum / period;
        out[i] = mad === 0 ? 0 : (tp[i] - mean) / (0.015 * mad);
      }
      return out;
    }

    function calculateMACDHistSeries(closes, fast = 12, slow = 26, sig = 9) {
      const emaFast = calculateEMASeries(closes, fast);
      const emaSlow = calculateEMASeries(closes, slow);
      const macdLine = closes.map((_, i) => emaFast[i] - emaSlow[i]);
      const sigLine = calculateEMASeries(macdLine, sig);
      return macdLine.map((v, i) => v - sigLine[i]);
    }

    function calculateLinRegChannel(closes, win = 60, mult = 2.0) {
      const n = closes.length;
      if (n < win) return null;
      const slice = closes.slice(n - win);
      const xMean = (win - 1) / 2;
      let xVar = 0;
      for (let i = 0; i < win; i++) xVar += (i - xMean) * (i - xMean);

      let ySum = 0;
      for (let i = 0; i < win; i++) ySum += slice[i];
      const yMean = ySum / win;

      let cov = 0;
      for (let i = 0; i < win; i++) cov += (i - xMean) * (slice[i] - yMean);
      const m = cov / xVar;
      const b = yMean - m * xMean;

      let sqErr = 0;
      for (let i = 0; i < win; i++) {
        const fitted = m * i + b;
        const diff = slice[i] - fitted;
        sqErr += diff * diff;
      }
      const std = Math.sqrt(sqErr / win);
      const mid = m * (win - 1) + b;
      return {
        mid,
        upper: mid + mult * std,
        lower: mid - mult * std,
        slope: m * win
      };
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

    const isFridayCloseLock = (dayOfWeek === 5 && hourDec >= 22.5);

    // =========================================================================
    // 3. DOĞRUDAN XM GLOBAL MT5 CANLI FİYAT VE 300 ADET M1 MUMU ÇEKME
    // =========================================================================
    async function fetchXmMt5GoldData() {
      try {
        const feedRes = await fetch(`${FIREBASE_BASE_URL}/mt5_live_feed.json`);
        const feed = await feedRes.json();

        if (!feed || !Array.isArray(feed.candles) || feed.candles.length < 210) {
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
          close: Number(c.close),
          volume: Number(c.tick_volume ?? c.volume ?? 0)
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
        message: "VPS mt5_bridge.py üzerinden XM Global MT5 mum verisi (en az 210 M1 bar) bekleniyor."
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
            `⚙️ <b>Tetikleyen Motor:</b> ${sig.setupType || "Çift Motor"}\n` +
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
            `⚙️ <b>Tetikleyen Motor:</b> ${sig.setupType || "Çift Motor"}\n` +
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
          mode: "24H_XM_DUAL_ENGINE_V9",
          message: `XM Global MT5 açık pozisyonu +$${TP_DOLLAR.toFixed(2)} TP / -$${SL_DOLLAR.toFixed(2)} SL için canlı izleniyor.`
        });
      }
    }

    // =========================================================================
    // MODÜL 2: ÇİFT MOTOR SCALPER V3 (CCI/MACD + 60M REGRESYON KANALI + EMA 200)
    // =========================================================================
    if (isFridayCloseLock) {
      return res.status(200).json({
        status: "FRIDAY_CLOSE_LOCK",
        livePrice: goldData.currentPrice,
        mode: "24H_XM_DUAL_ENGINE_V9",
        message: "Cuma 22:30 sonrası hafta sonu gap koruması nedeniyle yeni işlem açılmıyor."
      });
    }

    if (Date.now() - lastSignalTimestamp < SIGNAL_COOLDOWN_MS) {
      return res.status(200).json({
        status: "COOLDOWN",
        livePrice: goldData.currentPrice,
        mode: "24H_XM_DUAL_ENGINE_V9",
        message: "Son sinyal sonrası 15 dakikalık çift işlem soğuma süresi bekleniyor."
      });
    }

    if (goldData.spread > MAX_ALLOWED_SPREAD) {
      return res.status(200).json({
        status: "HIGH_SPREAD_FILTERED",
        spread: goldData.spread,
        maxAllowed: MAX_ALLOWED_SPREAD,
        mode: "24H_XM_DUAL_ENGINE_V9"
      });
    }

    // Son kapanmış M1 barları üzerinden göstergeleri hesapla (son bar açık/oluşmakta olan bar)
    const candles = goldData.candles;
    const closedCandles = candles.slice(0, candles.length - 1);
    const n = closedCandles.length;
    if (n < 205) {
      return res.status(200).json({ status: "INSUFFICIENT_CLOSED_CANDLES", count: n });
    }

    const closes = closedCandles.map(c => c.close);
    const e200Series = calculateEMASeries(closes, EMA_TREND_LEN);
    const atr14Series = calculateATRSeries(closedCandles, 14);
    const cci20Series = calculateCCISeries(closedCandles, 20);
    const macdHistSeries = calculateMACDHistSeries(closes, 12, 26, 9);
    const lr60 = calculateLinRegChannel(closes, LR_WINDOW, LR_MULT);

    const lastBar = closedCandles[n - 1];
    const e200Now = e200Series[n - 1];
    const e200Prev30 = e200Series[n - 1 - 30];
    const slope30 = parseFloat((e200Now - e200Prev30).toFixed(2));
    const atr14Now = parseFloat(atr14Series[n - 1].toFixed(2));
    const distFromEma200 = parseFloat((lastBar.close - e200Now).toFixed(2));
    const absEmaDist = Math.abs(distFromEma200);

    // 1. KESİN EMA 200 YÖN & MESAFE KİLİDİ ($2.00 <= |Fiyat - EMA 200| <= $8.50)
    const emaDistOk = (absEmaDist >= MIN_EMA_DIST) && (absEmaDist <= MAX_EMA_DIST);
    const allowLong = emaDistOk && (lastBar.close > e200Now) && (goldData.bid > e200Now);
    const allowShort = emaDistOk && (lastBar.close < e200Now) && (goldData.bid < e200Now);

    // 2. MOTOR A: CCI(20) + MACD ÇEKİLME >= $0.30 + ATR(14) >= $1.20 + EMA EĞİMİ
    const recentLowCci = Math.min(...cci20Series.slice(n - 4, n));
    const recentHighCci = Math.max(...cci20Series.slice(n - 4, n));
    const recentMinHist = Math.min(...macdHistSeries.slice(n - 6, n - 1));
    const recentMaxHist = Math.max(...macdHistSeries.slice(n - 6, n - 1));
    const histPrev = macdHistSeries[n - 2];
    const histCurr = macdHistSeries[n - 1];

    const motABuy = allowLong &&
      (slope30 >= MIN_SLOPE_MOT_A) &&
      (atr14Now >= MIN_ATR_MOT_A) &&
      (recentLowCci < -CCI_THRESH) &&
      (histPrev <= 0) &&
      (histCurr > 0) &&
      (recentMinHist <= -MIN_MACD_HIST_DEPTH) &&
      (lastBar.close > lastBar.open);

    const motASell = allowShort &&
      (slope30 <= -MIN_SLOPE_MOT_A) &&
      (atr14Now >= MIN_ATR_MOT_A) &&
      (recentHighCci > CCI_THRESH) &&
      (histPrev >= 0) &&
      (histCurr < 0) &&
      (recentMaxHist >= MIN_MACD_HIST_DEPTH) &&
      (lastBar.close < lastBar.open);

    // 3. MOTOR B: 60M REGRESYON KANALI + >= %45 FİTİL + TİK HACMİ >= 1.2X
    const candleSpan = lastBar.high - lastBar.low;
    const lowerWick = Math.min(lastBar.open, lastBar.close) - lastBar.low;
    const upperWick = lastBar.high - Math.max(lastBar.open, lastBar.close);
    const lwRatio = candleSpan > 0 ? lowerWick / candleSpan : 0;
    const uwRatio = candleSpan > 0 ? upperWick / candleSpan : 0;

    const volSlice = closedCandles.slice(n - 21, n - 1).map(c => c.volume);
    const avgVol = volSlice.reduce((a, b) => a + b, 0) / Math.max(1, volSlice.length);
    const volOk = avgVol > 0 ? (lastBar.volume >= MIN_VOL_MULT * avgVol) : true;

    const motBBuy = Boolean(lr60) && allowLong &&
      (slope30 >= MIN_SLOPE_MOT_B) &&
      volOk &&
      (lastBar.low <= lr60.lower) &&
      (lastBar.close > lr60.lower) &&
      (lastBar.close > lastBar.open) &&
      (lwRatio >= MIN_WICK_RATIO);

    const motBSell = Boolean(lr60) && allowShort &&
      (slope30 <= -MIN_SLOPE_MOT_B) &&
      volOk &&
      (lastBar.high >= lr60.upper) &&
      (lastBar.close < lr60.upper) &&
      (lastBar.close < lastBar.open) &&
      (uwRatio >= MIN_WICK_RATIO);

    let newSignal = null;

    if (motABuy || motBBuy) {
      const entry = goldData.ask;
      const engineName = (motABuy && motBBuy) ? "CCI+MACD & KANAL60" : (motABuy ? "CCI+MACD" : "KANAL60");
      const wickPct = Math.round(lwRatio * 100);

      newSignal = {
        id: `gold_${Date.now()}`,
        symbol: MT5_SYMBOL,
        source: goldData.source,
        direction: "BUY",
        setupType: engineName,
        lotSize: LOT_SIZE,
        entry: parseFloat(entry.toFixed(2)),
        tp: parseFloat((entry + TP_DOLLAR).toFixed(2)),
        sl: parseFloat((entry - SL_DOLLAR).toFixed(2)),
        ema200: parseFloat(e200Now.toFixed(2)),
        emaSlope30: slope30,
        emaDistance: distFromEma200,
        atr14: atr14Now,
        cci20: parseFloat(cci20Series[n - 1].toFixed(1)),
        macdHist: parseFloat(histCurr.toFixed(3)),
        channelUpper: lr60 ? parseFloat(lr60.upper.toFixed(2)) : null,
        channelLower: lr60 ? parseFloat(lr60.lower.toFixed(2)) : null,
        wickPct,
        status: "OPEN",
        vpsExecuted: false,
        createdAt: Date.now()
      };
    } else if (motASell || motBSell) {
      const entry = goldData.bid;
      const engineName = (motASell && motBSell) ? "CCI+MACD & KANAL60" : (motASell ? "CCI+MACD" : "KANAL60");
      const wickPct = Math.round(uwRatio * 100);

      newSignal = {
        id: `gold_${Date.now()}`,
        symbol: MT5_SYMBOL,
        source: goldData.source,
        direction: "SELL",
        setupType: engineName,
        lotSize: LOT_SIZE,
        entry: parseFloat(entry.toFixed(2)),
        tp: parseFloat((entry - TP_DOLLAR).toFixed(2)),
        sl: parseFloat((entry + SL_DOLLAR).toFixed(2)),
        ema200: parseFloat(e200Now.toFixed(2)),
        emaSlope30: slope30,
        emaDistance: distFromEma200,
        atr14: atr14Now,
        cci20: parseFloat(cci20Series[n - 1].toFixed(1)),
        macdHist: parseFloat(histCurr.toFixed(3)),
        channelUpper: lr60 ? parseFloat(lr60.upper.toFixed(2)) : null,
        channelLower: lr60 ? parseFloat(lr60.lower.toFixed(2)) : null,
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
        ema200: parseFloat(e200Now.toFixed(2)),
        emaSlope30: slope30,
        emaDistance: distFromEma200,
        atr14: atr14Now,
        cci20: parseFloat(cci20Series[n - 1].toFixed(1)),
        macdHist: parseFloat(histCurr.toFixed(3)),
        channelUpper: lr60 ? parseFloat(lr60.upper.toFixed(2)) : null,
        channelLower: lr60 ? parseFloat(lr60.lower.toFixed(2)) : null,
        mode: "24H_XM_DUAL_ENGINE_V9"
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
      `🏆 <b>XAUUSD (GOLD) | ÇİFT MOTOR SCALPER (V9.0)</b>\n` +
      `━━━━━━━━━━━━━━━━━━━━\n` +
      `🧭 <b>İşlem Yönü:</b> ${isBuy ? '🟢 BUY (LONG)' : '🔴 SELL (SHORT)'}\n` +
      `⚙️ <b>Tetikleyen Motor:</b> ${newSignal.setupType}\n` +
      `📊 <b>EMA 200 & Eğim:</b> <code>$${newSignal.ema200.toFixed(2)}</code> (Eğim: ${newSignal.emaSlope30 >= 0 ? '+' : ''}$${newSignal.emaSlope30.toFixed(2)} | Mesafe: $${Math.abs(newSignal.emaDistance).toFixed(2)})\n` +
      `📈 <b>ATR(14) / CCI(20):</b> <code>$${newSignal.atr14.toFixed(2)}</code> / <code>${newSignal.cci20}</code>\n` +
      `━━━━━━━━━━━━━━━━━━━━\n` +
      `💵 <b>XM Giriş Fiyatı:</b> <code>$${newSignal.entry.toFixed(2)}</code>\n` +
      `🎯 <b>Take-Profit (+$${TP_DOLLAR.toFixed(2)}):</b> <code>$${newSignal.tp.toFixed(2)}</code>\n` +
      `🛑 <b>Stop-Loss (-$${SL_DOLLAR.toFixed(2)}):</b> <code>$${newSignal.sl.toFixed(2)}</code>\n` +
      `━━━━━━━━━━━━━━━━━━━━\n` +
      `🤖 <i>XM Global MT5 köprüsü ${LOT_SIZE.toFixed(2)} Lot işledi; 7/24 takip aktiftir.</i>`;

    await sendTelegramAlert(entryMsg);

    return res.status(200).json({
      success: true,
      mode: "24H_XM_DUAL_ENGINE_V9",
      signal: newSignal
    });

  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}
