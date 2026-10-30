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
    // 0. BİTGET UNIFIED / UTA V3 BİLGİLERİ
    // =========================================================================
    const ADMIN_API_KEY = "bg_70a6d856aad55c998597f8888e27a61f";
    const ADMIN_SECRET = "07562c9e62461b950ac8eec37fc9c9cb821bee34a57fc14fca54352bb5423804";
    const ADMIN_PASSPHRASE = "Ers4834754";
    const BITGET_BASE_URL = 'https://api.bitget.com';

    const TG_BOT_TOKEN = "8682225307:AAHaa-hieKBBluU6uZ2_-OgSPxGR7OwMssE";
    const TG_CHANNEL_ID = "-1004404988937";
    const TG_ADMIN_ID = "6457294906";
    const FIREBASE_BASE_URL = "https://mineora-web-default-rtdb.firebaseio.com";
    
    // ROTASYON VE PARAMETRELER
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

    async function bitgetPrivateRequest(endpoint, method = 'POST', bodyObj = {}, customCreds = null) {
      const apiKey = customCreds ? customCreds.key : ADMIN_API_KEY;
      const secret = customCreds ? customCreds.secret : ADMIN_SECRET;
      const pass = customCreds ? customCreds.passphrase : ADMIN_PASSPHRASE;

      const timestamp = Date.now().toString();
      const bodyStr = method === 'GET' ? '' : JSON.stringify(bodyObj);
      const message = timestamp + method + endpoint + bodyStr;
      const signature = crypto.createHmac('sha256', secret).update(message).digest('base64');

      const headers = {
        'ACCESS-KEY': apiKey,
        'ACCESS-SIGN': signature,
        'ACCESS-TIMESTAMP': timestamp,
        'ACCESS-PASSPHRASE': pass,
        'Content-Type': 'application/json',
        'locale': 'en-US'
      };

      const options = { method, headers };
      if (method !== 'GET') options.body = bodyStr;

      try {
        const response = await fetch(`${BITGET_BASE_URL}${endpoint}`, options);
        return await response.json();
      } catch (err) {
        return { code: '-1', msg: err.message };
      }
    }

    async function closeBitgetPosition(symbol, isLong) {
      const closeSide = isLong ? 'sell' : 'buy';
      let qty = "0";

      try {
        const posRes = await bitgetPrivateRequest(`/api/v3/position/current-position?category=USDT-FUTURES&symbol=${symbol}`, 'GET');
        if (posRes.code === '00000' && Array.isArray(posRes.data) && posRes.data.length > 0) {
          const actualQty = parseFloat(posRes.data[0].total || posRes.data[0].available || 0);
          if (actualQty > 0) qty = actualQty.toString();
        }
      } catch (e) {}

      if (qty === "0") {
        return { code: '00000', msg: 'Pozisyon borsada zaten kapanmış.' };
      }

      await bitgetPrivateRequest('/api/v3/trade/cancel-symbol-order', 'POST', {
        category: 'USDT-FUTURES',
        symbol: symbol
      }).catch(() => {});

      return await bitgetPrivateRequest('/api/v3/trade/place-order', 'POST', {
        category: 'USDT-FUTURES',
        symbol: symbol,
        side: closeSide,
        orderType: 'market',
        qty: qty,
        reduceOnly: 'yes'
      });
    }

    async function getFuturesEquity() {
      try {
        const accResV3 = await bitgetPrivateRequest('/api/v3/account/assets', 'GET');
        if (accResV3 && accResV3.code === '00000') {
          const list = Array.isArray(accResV3.data) ? accResV3.data : (accResV3.data?.assets || []);
          const usdtItem = list.find(a => (a.coin === 'USDT' || a.coinName === 'USDT' || a.assetCoin === 'USDT'));
          if (usdtItem) {
            const eq = parseFloat(usdtItem.equity || usdtItem.available || usdtItem.usdtEquity || usdtItem.balance || 0);
            if (eq > 5) return eq;
          }
          if (accResV3.data?.accountEquity) {
            const totalEq = parseFloat(accResV3.data.accountEquity);
            if (totalEq > 5) return totalEq;
          }
        }
      } catch (e) {}

      try {
        const accResV2 = await bitgetPrivateRequest('/api/v2/mix/account/accounts?productType=usdt-futures', 'GET');
        if (accResV2 && accResV2.code === '00000' && Array.isArray(accResV2.data)) {
          const usdtAcc = accResV2.data.find(a => (a.marginCoin === 'USDT' || a.coin === 'USDT'));
          if (usdtAcc) {
            const eq = parseFloat(usdtAcc.usdtEquity || usdtAcc.equity || usdtAcc.available || usdtAcc.crossMaxAvailable || 0);
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

    function calculateOrderQuantity(entryPrice, notional) {
      const rawQty = notional / entryPrice;
      if (entryPrice >= 1000) {
        return parseFloat(rawQty.toFixed(3));
      } else if (entryPrice >= 50) {
        return parseFloat(rawQty.toFixed(2));
      } else if (entryPrice >= 1) {
        return parseFloat(rawQty.toFixed(1));
      } else {
        return Math.max(1, Math.round(rawQty));
      }
    }

    // 1. Bitget Vadeli Ticker, Spot ve Kontrat Bilgilerini Çek
    const [tickersRes, spotSymbolsRes, contractsRes] = await Promise.all([
      fetch("https://api.bitget.com/api/v2/mix/market/tickers?productType=USDT-FUTURES", { headers: browserHeaders }),
      fetch("https://api.bitget.com/api/v2/spot/public/symbols", { headers: browserHeaders }).catch(() => null),
      fetch("https://api.bitget.com/api/v2/mix/market/contracts?productType=USDT-FUTURES", { headers: browserHeaders }).catch(() => null)
    ]);

    const tickersJson = await tickersRes.json();
    if (tickersJson.code !== '00000' || !Array.isArray(tickersJson.data)) {
      return res.status(500).json({ error: "Bitget piyasa verisi alınamadı." });
    }

    // Kontrat resmi basamak kuralları
    const symbolPrecisionMap = {};
    if (contractsRes && contractsRes.ok) {
      try {
        const contractsJson = await contractsRes.json();
        if (contractsJson.code === '00000' && Array.isArray(contractsJson.data)) {
          contractsJson.data.forEach(c => {
            if (c.symbol && c.pricePlace !== undefined) {
              symbolPrecisionMap[c.symbol] = parseInt(c.pricePlace, 10);
            }
          });
        }
      } catch (e) {}
    }

    function getPrecision(price, rawPriceStr = null, symbol = null) {
      if (symbol && symbolPrecisionMap[symbol] !== undefined) {
        return symbolPrecisionMap[symbol];
      }
      if (!price || isNaN(price) || price <= 0) return 2;
      if (price >= 100) return 2;          // BCH, BTC, ETH vb. 0.01 katı
      if (price >= 10) return 3;           // SOL vb.
      if (rawPriceStr && typeof rawPriceStr === 'string' && rawPriceStr.includes('.')) {
        const decCount = rawPriceStr.split('.')[1].length;
        if (decCount > 0) return Math.min(6, decCount);
      }
      if (price >= 0.1) return 4;
      if (price >= 0.001) return 5;
      if (price >= 0.0001) return 6;
      return 8;
    }

    const genuineSpotCryptoSet = new Set();
    if (spotSymbolsRes && spotSymbolsRes.ok) {
      try {
        const spotJson = await spotSymbolsRes.json();
        if (spotJson.code === '00000' && Array.isArray(spotJson.data)) {
          spotJson.data.forEach(s => {
            if (s.symbol && s.symbol.endsWith("USDT") && s.status === 'online') {
              genuineSpotCryptoSet.add(s.symbol);
            }
          });
        }
      } catch (e) {}
    }

    const priceMap = {};
    const rawPriceMap = {};
    tickersJson.data.forEach(t => {
      priceMap[t.symbol] = parseFloat(t.lastPr || 0);
      rawPriceMap[t.symbol] = t.lastPr || "";
    });

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
    // MODÜL 1: CANLI İŞLEM TAKİBİ
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
      const targetPctStr = (trade.tpTargetPct || 0.85).toFixed(2);

      if (isTpHit) {
        trade.status = 'TP_HIT';
        trade.closedAt = now;
        await closeBitgetPosition(trade.symbol, isLong);

        const tgTpMsg = `🚀 <b>MINEORA SNIPER | DİNAMİK HEDEF VURULDU!</b>\n` +
                        `━━━━━━━━━━━━━━━━━━━━\n` +
                        `💎 <b>Parite:</b> #${trade.symbol}\n` +
                        `🧭 <b>Yön:</b> ${trade.direction}\n` +
                        `💵 <b>Giriş:</b> <code>$${pEntryStr}</code>\n` +
                        `🎯 <b>Kapanış:</b> <code>$${pCurStr}</code>\n` +
                        `💰 <b>Kâr:</b> +%${targetPctStr} (${LEVERAGE}x Kaldıraç)\n` +
                        `✅ <i>Pozisyon nakde çevrildi, kâr kasaya eklendi.</i>`;

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
        await closeBitgetPosition(trade.symbol, isLong);

        await fetch(`${FIREBASE_BASE_URL}/last_stopped_coins/${trade.symbol}.json`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(now)
        }).catch(() => {});

        const tgStopMsg = `🛑 <b>MINEORA SNIPER | STOP LOSS ÇALIŞTI</b>\n` +
                          `━━━━━━━━━━━━━━━━━━━━\n` +
                          `💎 <b>Parite:</b> #${trade.symbol}\n` +
                          `💵 <b>Kapanış:</b> <code>$${pCurStr}</code>\n` +
                          `⚠️ <i>Dinamik stop çalıştı. Parite 20 dk soğumada.</i>`;

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
    // MODÜL 2: TREND PULLBACK RADARI
    // =========================================================================
    const openTradesCount = Object.values(activeTrades).filter(t => {
      if (!t || t.status !== 'OPEN') return false;
      const tTime = t.createdAt || 0;
      return (now - tTime) <= LOCK_WINDOW_MS;
    }).length;

    if (openTradesCount >= 4) {
      return res.status(200).json({ status: "IDLE", message: "Takipte 4 aktif operasyon var." });
    }

    const FOREX_AND_FIAT = [
      "USDBRL", "EURUSD", "GBPUSD", "USDJPY", "AUDUSD", "USDTRY", "USDCAD",
      "USDCHF", "USDCNH", "EURGBP", "EURJPY", "GBPJPY", "XAU", "XAG", "SPX",
      "NDX", "DJI", "CLUSDT", "BGBUSDT", "USDCUSDT", "EURUSDT", "GBPUSDT", "TUSDT"
    ];

    const STOCKS_BLACKLIST = [
      "IREN", "LITE", "GLW", "SNXX", "SPCX", "INTC", "ARM", "AMD", "MRVL", "EWZ", "TQQQ", "CSOP",
      "HYUNDAI", "DXYZ", "MP", "BZ", "UVXY", "MSTR", "BE", "SOXL", "ASML",
      "HOOD", "MU", "MELI", "QQQ", "SPY", "SQQQ", "SKHYNIX", "SOFTBANK",
      "OPENAI", "ANTHROPIC", "KORU", "NVDA", "TSLA", "AAPL", "AMZN", "MSFT", "GOOG", "META", "COIN",
      "INTW", "PLTR", "BABA", "NIO", "MARA", "RIOT", "CLSK", "CORZ", "SNDK"
    ];

    const LOW_LEVERAGE_OR_MICRO_BLACKLIST = ["QUSDT", "SOPHUSDT"];

    const pool = tickersJson.data.filter(c => {
      if (!c.symbol || !c.symbol.endsWith("USDT")) return false;
      if (c.symbol.includes("_") || c.symbol.includes(".") || c.symbol.includes("-")) return false;

      const symUpper = c.symbol.toUpperCase();
      for (const fx of FOREX_AND_FIAT) if (symUpper.includes(fx)) return false;
      for (const st of STOCKS_BLACKLIST) if (symUpper.includes(st)) return false;
      for (const low of LOW_LEVERAGE_OR_MICRO_BLACKLIST) if (symUpper === low) return false;
      if (genuineSpotCryptoSet.size > 0 && !genuineSpotCryptoSet.has(c.symbol)) return false;

      const p = parseFloat(c.lastPr || 0);
      if (p > 0 && p < 0.005) return false;

      const vol = parseFloat(c.usdtVolume || c.quoteVolume || 0);
      return vol >= 1500000;
    }).sort((a, b) => parseFloat(b.usdtVolume || 0) - parseFloat(a.usdtVolume || 0));

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

      const candles1mRes = await fetch(`https://api.bitget.com/api/v2/mix/market/candles?symbol=${item.symbol}&productType=USDT-FUTURES&granularity=1m&limit=60`, { headers: browserHeaders })
        .then(r => r.json()).catch(() => ({}));

      if (candles1mRes.code !== '00000' || !Array.isArray(candles1mRes.data) || candles1mRes.data.length < 50) continue;

      const candles1m = candles1mRes.data.map(c => ({
        time: Number(c[0]),
        open: Number(c[1]),
        high: Number(c[2]),
        low: Number(c[3]),
        close: Number(c[4]),
        volume: Number(c[5])
      })).sort((a, b) => a.time - b.time);

      const closes = candles1m.map(c => c.close);
      const ema20 = calculateEMA(closes, 20);
      const ema50 = calculateEMA(closes, 50);

      const cur1m = candles1m[candles1m.length - 1];
      const sweep1m = candles1m[candles1m.length - 2];
      const pastList = candles1m.slice(-22, -2);

      const h1High = Math.max(...candles1m.map(c => c.high));
      const h1Low  = Math.min(...candles1m.map(c => c.low));
      const h1Range = h1High - h1Low;
      if (h1Range <= 0) continue;
      const h1Pos = (cur1m.close - h1Low) / h1Range;
      const h1RangePct = (h1Range / cur1m.close) * 100; // 1 saatlik oynaklık yüzdesi

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

      // Hacim ve akış filtresi
      const volZScore = calculateZScore(pastList.map(c => c.volume), sweep1m.volume);
      if (volZScore < 1.8 || volZScore > 6.0) continue;

      const fillsRes = await fetch(`https://api.bitget.com/api/v2/mix/market/fills?symbol=${item.symbol}&productType=usdt-futures&limit=60`, { headers: browserHeaders })
        .then(r => r.json()).catch(() => ({}));

      const fills = fillsRes.data?.fillList || fillsRes.data || [];
      let buyUsd = 0;
      let sellUsd = 0;
      if (Array.isArray(fills)) {
        fills.forEach(f => {
          const val = parseFloat(f.price || 0) * parseFloat(f.size || 0);
          if (val >= 250) {
            if (f.side === 'buy') buyUsd += val;
            else sellUsd += val;
          }
        });
      }
      const totalFlow = buyUsd + sellUsd;
      const takerBuyRatio = totalFlow > 0 ? (buyUsd / totalFlow) * 100 : 50;

      // DİNAMİK TP VE SL (Oynaklığa göre %0.75 - %1.25 TP, %0.50 - %0.75 SL)
      let dynamicTpPct = Math.min(1.25, Math.max(0.75, h1RangePct * 0.35));
      let dynamicSlPct = Math.min(0.75, Math.max(0.50, h1RangePct * 0.20));

      if (isBullishPullback && takerBuyRatio >= 65) {
        candidateTrade = {
          symbol: item.symbol,
          direction: 'LONG',
          price: cur1m.close,
          rawPriceStr: item.lastPr,
          wickPoint: sweep1m.low,
          volZScore: parseFloat(volZScore.toFixed(2)),
          takerRatio: Math.round(takerBuyRatio),
          dynamicTpPct: parseFloat(dynamicTpPct.toFixed(2)),
          dynamicSlPct: parseFloat(dynamicSlPct.toFixed(2)),
          h1RangePct: parseFloat(h1RangePct.toFixed(2)),
          reason: `Yükseliş pullback. %${Math.round((sweepLowerWick / sweepRange) * 100)} alt fitil, ${volZScore.toFixed(1)}σ Z-Score, %${Math.round(takerBuyRatio)} alıcı akışı.`
        };
        break;
      }

      if (isBearishPullback && takerBuyRatio <= 35) {
        candidateTrade = {
          symbol: item.symbol,
          direction: 'SHORT',
          price: cur1m.close,
          rawPriceStr: item.lastPr,
          wickPoint: sweep1m.high,
          volZScore: parseFloat(volZScore.toFixed(2)),
          takerRatio: Math.round(100 - takerBuyRatio),
          dynamicTpPct: parseFloat(dynamicTpPct.toFixed(2)),
          dynamicSlPct: parseFloat(dynamicSlPct.toFixed(2)),
          h1RangePct: parseFloat(h1RangePct.toFixed(2)),
          reason: `Düşüş tepkisi tıkandı. %${Math.round((sweepUpperWick / sweepRange) * 100)} üst fitil, ${volZScore.toFixed(1)}σ Z-Score, %${Math.round(100 - takerBuyRatio)} satıcı akışı.`
        };
        break;
      }
    }

    if (!candidateTrade) {
      return res.status(200).json({ status: "SCANNING", message: "Bitget trend pullback fırsatları taranıyor..." });
    }

    // =========================================================================
    // MODÜL 3: CANLI BORSA EMRİ & DİNAMİK MÜHÜRLEME
    // =========================================================================
    const currentEquity = await getFuturesEquity();
    
    await fetch(`${FIREBASE_BASE_URL}/last_known_equity.json`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(currentEquity)
    }).catch(() => {});

    const dynamicMargin = parseFloat((currentEquity * MARGIN_RATIO).toFixed(2));
    
    try {
      await bitgetPrivateRequest('/api/v3/account/set-leverage', 'POST', {
        category: 'USDT-FUTURES',
        symbol: candidateTrade.symbol,
        marginCoin: 'USDT',
        leverage: LEVERAGE.toString()
      });
    } catch (e) {}

    const positionNotional = dynamicMargin * LEVERAGE;
    const entryPrice = candidateTrade.price;
    const isLong = candidateTrade.direction === 'LONG';
    const orderSize = calculateOrderQuantity(entryPrice, positionNotional);

    // Dinamik Hedef ve Stop Fiyatları
    const tpRatio = candidateTrade.dynamicTpPct / 100;
    const slRatio = candidateTrade.dynamicSlPct / 100;

    const tp = isLong ? entryPrice * (1 + tpRatio) : entryPrice * (1 - tpRatio);
    let sl = isLong 
      ? Math.max(candidateTrade.wickPoint * 0.9975, entryPrice * (1 - slRatio))
      : Math.min(candidateTrade.wickPoint * 1.0025, entryPrice * (1 + slRatio));

    const precision = getPrecision(entryPrice, candidateTrade.rawPriceStr, candidateTrade.symbol);
    const tpFormatted = tp.toFixed(precision);
    const slFormatted = sl.toFixed(precision);

    const orderPayload = {
      category: 'USDT-FUTURES',
      symbol: candidateTrade.symbol,
      side: isLong ? 'buy' : 'sell',
      orderType: 'market',
      qty: orderSize.toString(),
      presetTakeProfitPrice: tpFormatted,
      takeProfit: tpFormatted,
      tpOrderType: 'market',
      tpTriggerBy: 'mark',
      presetStopLossPrice: slFormatted,
      stopLoss: slFormatted,
      slOrderType: 'market',
      slTriggerBy: 'mark'
    };

    const placeOrderRes = await bitgetPrivateRequest('/api/v3/trade/place-order', 'POST', orderPayload);

    // Hayalet işlem kilidi
    if (placeOrderRes.code !== '00000') {
      await sendTelegramAlert(
        `⚠️ <b>MINEORA SNIPER | BİTGET EMİR REDDİ</b>\n` +
        `━━━━━━━━━━━━━━━━━━━━\n` +
        `💎 <b>Parite:</b> #${candidateTrade.symbol}\n` +
        `🛑 <b>Sebep:</b> <code>${placeOrderRes.msg || 'Bilinmeyen hata'}</code>\n` +
        `🛡️ <i>İşlem iptal edildi; bakiye korundu.</i>`
      );
      return res.status(200).json({ status: "ORDER_REJECTED", error: placeOrderRes.msg });
    }

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
      score: candidateTrade.takerRatio,
      reason: candidateTrade.reason,
      createdAt: now,
      timestamp: new Date().toISOString(),
      walletEquityAtEntry: currentEquity,
      marginUsed: dynamicMargin,
      openSize: orderSize,
      bitgetOrderResult: 'SUCCESS',
      stopResult: 'SUCCESS (BORSAYA MÜHÜRLENDİ)',
      tpResult: 'SUCCESS (BORSAYA MÜHÜRLENDİ)'
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

    const tgMsg = `🎯 <b>MINEORA SNIPER | BİTGET DİNAMİK PULLBACK SCALP</b>\n` +
                  `━━━━━━━━━━━━━━━━━━━━\n` +
                  `💎 <b>Parite:</b> #${candidateTrade.symbol}\n` +
                  `🧭 <b>Yön:</b> ${isLong ? '🟢 LONG' : '🔴 SHORT'}\n` +
                  `💵 <b>Giriş:</b> <code>$${pStr}</code>\n` +
                  `💼 <b>Model:</b> Kasanın %10'u | ${LEVERAGE}x Kaldıraç\n` +
                  `📊 <b>Oynaklık (1h Range):</b> %${candidateTrade.h1RangePct}\n` +
                  `🏦 <b>Borsa Emri:</b> ✅ Pozisyon Açıldı\n` +
                  `🛑 <b>Dinamik Stop (-%${candidateTrade.dynamicSlPct}):</b> <code>$${slStr}</code> (Borsaya Mühürlendi)\n` +
                  `🚀 <b>Dinamik Hedef (+%${candidateTrade.dynamicTpPct}):</b> <code>$${tpStr}</code> (Borsaya Mühürlendi)\n` +
                  `━━━━━━━━━━━━━━━━━━━━\n` +
                  `🛡️ <i>TP ve SL emirleri doğrudan Bitget UTA emir defterine mühürlenmiştir.</i>`;

    await sendTelegramAlert(tgMsg);

    return res.status(200).json({
      success: true,
      trade: newTrade,
      bitget_order: placeOrderRes,
      wallet_equity: currentEquity,
      margin_used: dynamicMargin
    });

  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}
