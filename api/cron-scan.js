import crypto from 'crypto';

export const config = {
  maxDuration: 60
};

export default async function handler(req, res) {
  try {
    const browserHeaders = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
      'Accept': 'application/json'
    };

    // =========================================================================
    // 0. MEXC CONTRACT (FUTURES) API BİLGİLERİ & TELEGRAM / FIREBASE AYARLARI
    // =========================================================================
    const MEXC_API_KEY = "mx0vglNXBWTIRyzxaq";
    const MEXC_SECRET_KEY = "6d6fb3d9c6644ec2bad68178f76705ee";
    const MEXC_BASE_URL = 'https://contract.mexc.com';

    const TG_BOT_TOKEN = "8682225307:AAHaa-hieKBBluU6uZ2_-OgSPxGR7OwMssE";
    const TG_CHANNEL_ID = "-1004404988937";
    const TG_ADMIN_ID = "6457294906";
    const FIREBASE_BASE_URL = "https://mineora-web-default-rtdb.firebaseio.com";

    // ROTASYON VE RİSK PARAMETRELERİ
    const LOCK_WINDOW_MS = 25 * 60 * 1000;
    const SAME_COIN_LOCK_MS = 12 * 60 * 1000;
    const POST_STOP_COOLDOWN_MS = 20 * 60 * 1000;
    const LEVERAGE = 25;                            // 25x KALDIRAÇ
    const MARGIN_RATIO = 0.10;                      // KASANIN %10'U
    const now = Date.now();

    async function sendTelegramAlert(text) {
      const targets = [TG_CHANNEL_ID, TG_ADMIN_ID];
      for (const target of targets) {
        try {
          await fetch(`https://api.telegram.org/bot${TG_BOT_TOKEN}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ chat_id: target, text: text, parse_mode: 'HTML' })
          });
        } catch (e) {}
      }
    }

    // MEXC CONTRACT API V1 İMZA VE İSTEK MOTORU
    async function mexcPrivateRequest(endpoint, method = 'POST', params = {}) {
      const timestamp = Date.now().toString();
      
      let signStr = '';
      if (method === 'GET') {
        const queryParams = { ...params, req_time: timestamp };
        const sortedKeys = Object.keys(queryParams).sort();
        signStr = sortedKeys.map(k => `${k}=${encodeURIComponent(queryParams[k])}`).join('&');
      } else {
        signStr = JSON.stringify(params);
      }

      const hmacSource = `${MEXC_API_KEY}${timestamp}${signStr}`;
      const signature = crypto.createHmac('sha256', MEXC_SECRET_KEY).update(hmacSource).digest('hex');

      const headers = {
        'ApiKey': MEXC_API_KEY,
        'Request-Time': timestamp,
        'Signature': signature,
        'Content-Type': 'application/json'
      };

      const options = { method, headers };
      let fullUrl = `${MEXC_BASE_URL}${endpoint}`;

      if (method === 'GET') {
        fullUrl += (endpoint.includes('?') ? '&' : '?') + `req_time=${timestamp}`;
        if (Object.keys(params).length > 0) {
          const qs = Object.keys(params).map(k => `${k}=${encodeURIComponent(params[k])}`).join('&');
          fullUrl += `&${qs}`;
        }
      } else {
        options.body = signStr;
      }

      try {
        const response = await fetch(fullUrl, options);
        return await response.json();
      } catch (err) {
        return { success: false, code: -1, message: err.message };
      }
    }

    // =========================================================================
    // 1. MEXC DETAYLARI, TICKER VE SÖZLEŞME KURALLARINI ÇEK
    // =========================================================================
    const [tickersRes, contractsRes] = await Promise.all([
      fetch(`${MEXC_BASE_URL}/api/v1/contract/ticker`, { headers: browserHeaders }),
      fetch(`${MEXC_BASE_URL}/api/v1/contract/detail`, { headers: browserHeaders })
    ]);

    const tickersJson = await tickersRes.json();
    const contractsJson = await contractsRes.json();

    if (!tickersJson.success || !Array.isArray(tickersJson.data)) {
      return res.status(500).json({ error: "MEXC piyasa verisi alınamadı." });
    }

    // Her paritenin minimum fiyat adımı (tick size) ve kontrat birim haritası
    const contractDetailsMap = {};
    if (contractsJson.success && Array.isArray(contractsJson.data)) {
      contractsJson.data.forEach(c => {
        if (c.symbol) {
          const priceUnit = parseFloat(c.priceUnit || 0.0001);
          let prec = 4;
          if (priceUnit.toString().includes('.')) {
            prec = priceUnit.toString().split('.')[1].length;
          } else if (priceUnit >= 1) {
            prec = 0;
          }
          contractDetailsMap[c.symbol] = {
            priceUnit: priceUnit,
            precision: prec,
            contractSize: parseFloat(c.contractSize || 1),
            minVol: parseFloat(c.minVol || 1),
            maxLeverage: parseInt(c.maxLeverage || 100, 10)
          };
        }
      });
    }

    function getPrecision(price, rawPriceStr = null, symbol = null) {
      if (symbol && contractDetailsMap[symbol]) {
        return contractDetailsMap[symbol].precision;
      }
      if (!price || isNaN(price) || price <= 0) return 2;
      if (price >= 100) return 2;
      if (price >= 10) return 3;
      if (price >= 1) return 4;
      if (price >= 0.01) return 4;
      if (price >= 0.0001) return 6;
      return 8;
    }

    const priceMap = {};
    const rawPriceMap = {};
    tickersJson.data.forEach(t => {
      priceMap[t.symbol] = parseFloat(t.lastPrice || 0);
      rawPriceMap[t.symbol] = t.lastPrice ? t.lastPrice.toString() : "";
    });

    // =========================================================================
    // DİNAMİK KASA BAKİYESİ VE KALDIRAÇ AYARI
    // =========================================================================
    async function getMexcFuturesEquity() {
      try {
        const accRes = await mexcPrivateRequest('/api/v1/private/account/assets', 'GET');
        if (accRes && accRes.success && Array.isArray(accRes.data)) {
          const usdtItem = accRes.data.find(a => a.currency === 'USDT');
          if (usdtItem) {
            const eq = parseFloat(usdtItem.equity || usdtItem.availableBalance || 0);
            if (eq > 5) return eq;
          }
        }
      } catch (e) {}

      try {
        const lastEqRes = await fetch(`${FIREBASE_BASE_URL}/last_known_equity.json`);
        const savedEq = parseFloat(await lastEqRes.json());
        if (savedEq > 5) return savedEq;
      } catch (e) {}

      return 100;
    }

    // POZİSYON KAPAMA (PIYASA REDUCE-ONLY VE PLAN EMİRLERİ TEMİZLEME)
    async function closeMexcPosition(symbol, isLong) {
      try {
        // Açık plan emirlerini (SL/TP) temizle
        await mexcPrivateRequest('/api/v1/private/planorder/cancel_all', 'POST', { symbol }).catch(() => {});

        // Açık pozisyonu sorgula
        const posRes = await mexcPrivateRequest('/api/v1/private/position/open_positions', 'GET', { symbol });
        if (posRes.success && Array.isArray(posRes.data) && posRes.data.length > 0) {
          const pos = posRes.data.find(p => p.symbol === symbol);
          if (pos && parseFloat(pos.holdVol || 0) > 0) {
            const holdVol = parseInt(pos.holdVol, 10);
            const closeSide = isLong ? 4 : 2; // MEXC: 2 = Close Long, 4 = Close Short
            return await mexcPrivateRequest('/api/v1/private/order/create', 'POST', {
              symbol: symbol,
              side: closeSide,
              type: 5, // Piyasa emri (Market)
              vol: holdVol,
              openType: 2 // Çapraz marjin
            });
          }
        }
      } catch (e) {}
      return { success: true, message: 'Pozisyon zaten kapalı.' };
    }

    // =========================================================================
    // FIREBASE SENKRONİZASYONU
    // =========================================================================
    let activeTrades = {};
    let lastSignals = {};
    let lastStoppedCoins = {};
    try {
      const [atRes, lsRes, lscRes] = await Promise.all([
        fetch(`${FIREBASE_BASE_URL}/active_trades.json`),
        fetch(`${FIREBASE_BASE_URL}/last_signals.json`),
        fetch(`${FIREBASE_BASE_URL}/last_stopped_coins.json`)
      ]);
      activeTrades = (await atRes.json()) || {};
      lastSignals = (await lsRes.json()) || {};
      lastStoppedCoins = (await lscRes.json()) || {};
    } catch (e) {
      activeTrades = {};
      lastSignals = {};
      lastStoppedCoins = {};
    }

    // =========================================================================
    // MODÜL 1: CANLI POZİSYON İZLEME & TP / SL KONTROLÜ
    // =========================================================================
    for (const [tradeKey, trade] of Object.entries(activeTrades)) {
      if (!trade || trade.status !== 'OPEN') continue;

      const curPrice = priceMap[trade.symbol];
      if (!curPrice || curPrice <= 0) continue;

      const isLong = trade.direction === 'LONG';
      const isTpHit = isLong ? (curPrice >= trade.tp) : (curPrice <= trade.tp);
      const isStopHit = isLong ? (curPrice <= trade.sl) : (curPrice >= trade.sl);

      const prec = getPrecision(trade.entryPrice, rawPriceMap[trade.symbol], trade.symbol);
      const pCurStr = curPrice.toFixed(prec);
      const pEntryStr = trade.entryPrice.toFixed(prec);
      const dynamicTpPctStr = (trade.tpTargetPct || 0.85).toFixed(2);

      if (isTpHit) {
        trade.status = 'TP_HIT';
        trade.closedAt = now;
        await closeMexcPosition(trade.symbol, isLong);

        const tgTpMsg = `🚀 <b>MINEORA SNIPER | HEDEF VURULDU (TAM KAPANIŞ)!</b>\n` +
                        `━━━━━━━━━━━━━━━━━━━━\n` +
                        `💎 <b>Borsa:</b> MEXC CONTRACT\n` +
                        `💎 <b>Parite:</b> #${trade.symbol}\n` +
                        `🧭 <b>Yön:</b> ${trade.direction}\n` +
                        `💵 <b>Giriş:</b> <code>$${pEntryStr}</code>\n` +
                        `🎯 <b>Kapanış:</b> <code>$${pCurStr}</code>\n` +
                        `💰 <b>Dinamik Kâr:</b> +%${dynamicTpPctStr} (${LEVERAGE}x Kaldıraç)\n` +
                        `✅ <i>Pozisyon %100 nakde çevrildi, kâr kasaya eklendi.</i>`;

        await sendTelegramAlert(tgTpMsg);

        await fetch(`${FIREBASE_BASE_URL}/active_trades/${tradeKey}.json`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(trade)
        });
        continue;
      }

      if (isStopHit) {
        trade.status = 'STOPPED';
        trade.closedAt = now;
        await closeMexcPosition(trade.symbol, isLong);

        await fetch(`${FIREBASE_BASE_URL}/last_stopped_coins/${trade.symbol}.json`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(now)
        }).catch(() => {});

        const tgStopMsg = `🛑 <b>MINEORA SNIPER | STOP LOSS ÇALIŞTI</b>\n` +
                          `━━━━━━━━━━━━━━━━━━━━\n` +
                          `💎 <b>Borsa:</b> MEXC CONTRACT\n` +
                          `💎 <b>Parite:</b> #${trade.symbol}\n` +
                          `💵 <b>Kapanış:</b> <code>$${pCurStr}</code>\n` +
                          `⚠️ <i>Trend bozulması nedeniyle dinamik stop çalıştı. Parite 20 dk soğumada.</i>`;

        await sendTelegramAlert(tgStopMsg);

        await fetch(`${FIREBASE_BASE_URL}/active_trades/${tradeKey}.json`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(trade)
        });
        continue;
      }
    }

    // =========================================================================
    // MODÜL 2: TREND PULLBACK RADARI (MEXC USDT SÖZLEŞMELERİ)
    // =========================================================================
    const openTradesCount = Object.values(activeTrades).filter(t => {
      if (!t || t.status !== 'OPEN') return false;
      const tTime = t.createdAt || 0;
      return (now - tTime) <= LOCK_WINDOW_MS;
    }).length;

    if (openTradesCount >= 4) {
      return res.status(200).json({ status: "IDLE", message: "Takipte 4 aktif operasyon var." });
    }

    const pool = tickersJson.data.filter(c => {
      if (!c.symbol || !c.symbol.endsWith("_USDT")) return false;
      const vol = parseFloat(c.amount24 || c.volume24 || 0);
      const p = parseFloat(c.lastPrice || 0);
      return vol >= 1000000 && p >= 0.005;
    }).sort((a, b) => parseFloat(b.amount24 || 0) - parseFloat(a.amount24 || 0));

    function calculateZScore(series, currentVal) {
      if (!series || series.length < 5) return 0;
      const n = series.length;
      const mean = series.reduce((a, b) => a + b, 0) / n;
      const variance = series.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / n;
      const stdDev = Math.sqrt(variance);
      return stdDev === 0 ? 0 : (currentVal - mean) / stdDev;
    }

    function calculateEMA(prices, period) {
      if (prices.length < period) return prices[prices.length - 1];
      const k = 2 / (period + 1);
      let ema = prices.slice(0, period).reduce((a, b) => a + b, 0) / period;
      for (let i = period; i < prices.length; i++) {
        ema = prices[i] * k + ema * (1 - k);
      }
      return ema;
    }

    let candidateTrade = null;

    for (const item of pool) {
      const lastSentTime = lastSignals[item.symbol] || 0;
      if (now - lastSentTime < SAME_COIN_LOCK_MS) continue;

      const lastStopTime = lastStoppedCoins[item.symbol] || 0;
      if (now - lastStopTime < POST_STOP_COOLDOWN_MS) continue;

      // 1 Dakikalık Mum Verisi Çek
      const klineRes = await fetch(`${MEXC_BASE_URL}/api/v1/contract/kline/${item.symbol}?interval=Min1`, { headers: browserHeaders })
        .then(r => r.json()).catch(() => ({}));

      if (!klineRes.success || !klineRes.data || !Array.isArray(klineRes.data.time) || klineRes.data.time.length < 50) continue;

      const times = klineRes.data.time;
      const opens = klineRes.data.open;
      const highs = klineRes.data.high;
      const lows = klineRes.data.low;
      const closes = klineRes.data.close;
      const vols = klineRes.data.vol;

      const candles1m = times.map((t, idx) => ({
        time: t,
        open: parseFloat(opens[idx]),
        high: parseFloat(highs[idx]),
        low: parseFloat(lows[idx]),
        close: parseFloat(closes[idx]),
        volume: parseFloat(vols[idx])
      }));

      const closeSeries = candles1m.map(c => c.close);
      const ema20 = calculateEMA(closeSeries, 20);
      const ema50 = calculateEMA(closeSeries, 50);

      const cur1m = candles1m[candles1m.length - 1];
      const sweep1m = candles1m[candles1m.length - 2];
      const pastList = candles1m.slice(-22, -2);

      const h1High = Math.max(...candles1m.map(c => c.high));
      const h1Low  = Math.min(...candles1m.map(c => c.low));
      const h1Range = h1High - h1Low;
      if (h1Range <= 0) continue;
      const h1Pos = (cur1m.close - h1Low) / h1Range;
      const h1RangePct = (h1Range / cur1m.close) * 100; // 1 saatlik oynaklık yüzdesi

      // Trend Şartları
      const isBullishTrend = (ema20 >= ema50) && (h1Pos >= 0.40 && h1Pos <= 0.85);
      const isBearishTrend = (ema20 <= ema50) && (h1Pos >= 0.15 && h1Pos <= 0.60);
      if (!isBullishTrend && !isBearishTrend) continue;

      const sweepRange = sweep1m.high - sweep1m.low;
      if (sweepRange <= 0) continue;

      const sweepLowerWick = Math.min(sweep1m.open, sweep1m.close) - sweep1m.low;
      const sweepUpperWick = sweep1m.high - Math.max(sweep1m.open, sweep1m.close);
      const sweepMidpoint = (sweep1m.open + sweep1m.close) / 2;

      const isBullishPullback = isBullishTrend && 
        ((sweepLowerWick / sweepRange) >= 0.42) && 
        (cur1m.close > cur1m.open) && 
        (cur1m.close >= sweepMidpoint) && 
        (cur1m.close >= ema20 * 0.998);

      const isBearishPullback = isBearishTrend && 
        ((sweepUpperWick / sweepRange) >= 0.42) && 
        (cur1m.close < cur1m.open) && 
        (cur1m.close <= sweepMidpoint) && 
        (cur1m.close <= ema20 * 1.002);

      if (!isBullishPullback && !isBearishPullback) continue;

      // Hacim Z-Score
      const volZScore = calculateZScore(pastList.map(c => c.volume), sweep1m.volume);
      if (volZScore < 1.8 || volZScore > 6.0) continue;

      // =========================================================================
      // DİNAMİK TP VE SL HESAPLAMA MOTORU (VOLATİLİTE VE KANAL UYUMLU)
      // =========================================================================
      // Oynaklık düşükse hedef %0.65, yüksekse %1.20 bandına kadar açılır:
      let dynamicTpPct = Math.min(1.20, Math.max(0.65, h1RangePct * 0.35));
      // Stop mesafesi nefes alanına göre %0.45 ile %0.75 arasında belirlenir:
      let dynamicSlPct = Math.min(0.75, Math.max(0.45, h1RangePct * 0.22));

      if (isBullishPullback) {
        candidateTrade = {
          symbol: item.symbol,
          direction: 'LONG',
          price: cur1m.close,
          rawPriceStr: item.lastPrice ? item.lastPrice.toString() : "",
          wickPoint: sweep1m.low,
          volZScore: parseFloat(volZScore.toFixed(2)),
          dynamicTpPct: parseFloat(dynamicTpPct.toFixed(2)),
          dynamicSlPct: parseFloat(dynamicSlPct.toFixed(2)),
          h1RangePct: parseFloat(h1RangePct.toFixed(2)),
          reason: `Yükseliş trendinde pullback tamamlandı. %${Math.round((sweepLowerWick / sweepRange) * 100)} alt fitil tepkisi, ${volZScore.toFixed(1)}σ Z-Score hacim (Oynaklık: %${h1RangePct.toFixed(1)}).`
        };
        break;
      }

      if (isBearishPullback) {
        candidateTrade = {
          symbol: item.symbol,
          direction: 'SHORT',
          price: cur1m.close,
          rawPriceStr: item.lastPrice ? item.lastPrice.toString() : "",
          wickPoint: sweep1m.high,
          volZScore: parseFloat(volZScore.toFixed(2)),
          dynamicTpPct: parseFloat(dynamicTpPct.toFixed(2)),
          dynamicSlPct: parseFloat(dynamicSlPct.toFixed(2)),
          h1RangePct: parseFloat(h1RangePct.toFixed(2)),
          reason: `Düşüş trendinde tepki yükselişi tıkandı. %${Math.round((sweepUpperWick / sweepRange) * 100)} üst fitil satışı, ${volZScore.toFixed(1)}σ Z-Score hacim (Oynaklık: %${h1RangePct.toFixed(1)}).`
        };
        break;
      }
    }

    if (!candidateTrade) {
      return res.status(200).json({ status: "SCANNING", message: "MEXC üzerinde trend pullback fırsatları taranıyor..." });
    }

    // =========================================================================
    // MODÜL 3: CANLI BORSA EMRİ & PLAN EMİRLERİ (MEXC CONTRACT)
    // =========================================================================
    const currentEquity = await getMexcFuturesEquity();
    
    await fetch(`${FIREBASE_BASE_URL}/last_known_equity.json`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(currentEquity)
    }).catch(() => {});

    const dynamicMargin = parseFloat((currentEquity * MARGIN_RATIO).toFixed(2));
    const isLong = candidateTrade.direction === 'LONG';
    const entryPrice = candidateTrade.price;
    const cDetail = contractDetailsMap[candidateTrade.symbol] || { contractSize: 1, minVol: 1, precision: 2 };

    // Kaldıraç Ayarla
    await mexcPrivateRequest('/api/v1/private/position/change_leverage', 'POST', {
      symbol: candidateTrade.symbol,
      leverage: LEVERAGE,
      openType: 2 // Çapraz (Cross) marjin
    }).catch(() => {});

    // Kontrat adedi hesaplama (MEXC vol = kontrat sayısı)
    const positionNotional = dynamicMargin * LEVERAGE;
    const contractValueInUsdt = entryPrice * cDetail.contractSize;
    let orderVol = Math.round(positionNotional / contractValueInUsdt);
    if (orderVol < cDetail.minVol) orderVol = cDetail.minVol;

    // DİNAMİK TP VE SL FİYATLARININ HESAPLANMASI
    const tpRatio = 1 + (candidateTrade.dynamicTpPct / 100);
    const slRatio = candidateTrade.dynamicSlPct / 100;

    const tp = isLong ? entryPrice * tpRatio : entryPrice * (2 - tpRatio);

    // Fitil arkası tamponu dinamik tavan ile koru
    let sl = isLong 
      ? Math.max(candidateTrade.wickPoint * 0.9975, entryPrice * (1 - slRatio))
      : Math.min(candidateTrade.wickPoint * 1.0025, entryPrice * (1 + slRatio));

    const precision = getPrecision(entryPrice, candidateTrade.rawPriceStr, candidateTrade.symbol);
    const tpFormatted = parseFloat(tp.toFixed(precision));
    const slFormatted = parseFloat(sl.toFixed(precision));

    // MEXC Açılış Yönü: 1 = Open Long, 3 = Open Short
    const openSide = isLong ? 1 : 3;

    // 1. Ana Piyasa Pozisyon Emrini Gönder
    const orderPayload = {
      symbol: candidateTrade.symbol,
      side: openSide,
      type: 5, // Piyasa emri (Market)
      vol: orderVol,
      openType: 2
    };

    const placeOrderRes = await mexcPrivateRequest('/api/v1/private/order/create', 'POST', orderPayload);

    // =========================================================================
    // HAYALET İŞLEM KİLİDİ: Yalnızca borsa onayladıysa devam et!
    // =========================================================================
    if (!placeOrderRes.success || !placeOrderRes.data) {
      const errMsg = placeOrderRes.message || JSON.stringify(placeOrderRes);
      await sendTelegramAlert(
        `⚠️ <b>MINEORA SNIPER | MEXC EMİR REDDİ</b>\n` +
        `━━━━━━━━━━━━━━━━━━━━\n` +
        `💎 <b>Parite:</b> #${candidateTrade.symbol}\n` +
        `🛑 <b>Sebep:</b> <code>${errMsg}</code>\n` +
        `🛡️ <i>İşlem iptal edildi; hayalet kayıt engellendi.</i>`
      );
      return res.status(200).json({ status: "ORDER_REJECTED", error: errMsg });
    }

    // 2. MEXC Borsasına TP ve SL Plan Emirlerini Doğrudan Mühürle
    const closeSide = isLong ? 4 : 2; // MEXC: 2 = Close Long, 4 = Close Short
    let tpPlanRes = null;
    let slPlanRes = null;

    try {
      // Take Profit Plan Emri (Borsaya mühürlü)
      tpPlanRes = await mexcPrivateRequest('/api/v1/private/planorder/place', 'POST', {
        symbol: candidateTrade.symbol,
        side: closeSide,
        triggerType: 1, // Son fiyat ile tetikleme
        triggerPrice: tpFormatted,
        executeCycle: 1,
        orderType: 5, // Tetiklendiğinde Market emir
        vol: orderVol,
        trend: isLong ? 1 : 2 // 1: Yukarı kırılımda tetikle (Long TP), 2: Aşağı kırılımda tetikle (Short TP)
      });

      // Stop Loss Plan Emri (Borsaya mühürlü)
      slPlanRes = await mexcPrivateRequest('/api/v1/private/planorder/place', 'POST', {
        symbol: candidateTrade.symbol,
        side: closeSide,
        triggerType: 1,
        triggerPrice: slFormatted,
        executeCycle: 1,
        orderType: 5,
        vol: orderVol,
        trend: isLong ? 2 : 1 // 2: Aşağı kırılımda tetikle (Long SL), 1: Yukarı kırılımda tetikle (Short SL)
      });
    } catch (e) {}

    const tradeId = `trade_${Date.now()}`;
    const newTrade = {
      id: tradeId,
      symbol: candidateTrade.symbol,
      direction: candidateTrade.direction,
      entryPrice,
      tp,
      sl,
      tpTargetPct: candidateTrade.dynamicTpPct,
      slTargetPct: candidateTrade.dynamicSlPct,
      status: 'OPEN',
      reason: candidateTrade.reason,
      createdAt: now,
      timestamp: new Date().toISOString(),
      walletEquityAtEntry: currentEquity,
      marginUsed: dynamicMargin,
      orderVol: orderVol,
      mexcOrderId: placeOrderRes.data,
      tpPlanResult: tpPlanRes?.success ? 'MÜHÜRLENDİ' : 'MANUEL_TAKİP',
      slPlanResult: slPlanRes?.success ? 'MÜHÜRLENDİ' : 'MANUEL_TAKİP'
    };

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

    const pStr = entryPrice.toFixed(precision);
    const tpStr = tp.toFixed(precision);
    const slStr = sl.toFixed(precision);

    const tgMsg = `🎯 <b>MINEORA SNIPER | MEXC DİNAMİK PULLBACK SCALP</b>\n` +
                  `━━━━━━━━━━━━━━━━━━━━\n` +
                  `💎 <b>Borsa:</b> MEXC CONTRACT\n` +
                  `💎 <b>Parite:</b> #${candidateTrade.symbol}\n` +
                  `🧭 <b>Yön:</b> ${isLong ? '🟢 LONG' : '🔴 SHORT'}\n` +
                  `💵 <b>Giriş:</b> <code>$${pStr}</code>\n` +
                  `💼 <b>Model:</b> Kasanın %10'u | ${LEVERAGE}x Kaldıraç\n` +
                  `📊 <b>Oynaklık (1h Range):</b> %${candidateTrade.h1RangePct}\n` +
                  `🏦 <b>Borsa Emri:</b> ✅ Pozisyon Açıldı\n` +
                  `🛑 <b>Dinamik Stop (-%${candidateTrade.dynamicSlPct}):</b> <code>$${slStr}</code> (${newTrade.slPlanResult === 'MÜHÜRLENDİ' ? '✅ Borsaya Mühürlendi' : '⚠️ Manuel Koruma'})\n` +
                  `🚀 <b>Dinamik Hedef (+%${candidateTrade.dynamicTpPct}):</b> <code>$${tpStr}</code> (${newTrade.tpPlanResult === 'MÜHÜRLENDİ' ? '✅ Borsaya Mühürlendi' : '⚠️ Manuel Koruma'})\n` +
                  `━━━━━━━━━━━━━━━━━━━━\n` +
                  `🛡️ <i>%0.02 düşük komisyonla sermaye koruması aktif.</i>`;

    await sendTelegramAlert(tgMsg);

    return res.status(200).json({
      success: true,
      trade: newTrade,
      mexc_order: placeOrderRes,
      tp_plan: tpPlanRes,
      sl_plan: slPlanRes,
      wallet_equity: currentEquity,
      margin_used: dynamicMargin
    });

  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}
