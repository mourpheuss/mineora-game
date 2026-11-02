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
    // 0. BİTGET UNIFIED / UTA V3 BİLGİLERİ & PARAMETRELER
    // =========================================================================
    const ADMIN_API_KEY = "bg_70a6d856aad55c998597f8888e27a61f";
    const ADMIN_SECRET = "07562c9e62461b950ac8eec37fc9c9cb821bee34a57fc14fca54352bb5423804";
    const ADMIN_PASSPHRASE = "Ers4834754";
    const BITGET_BASE_URL = 'https://api.bitget.com';

    const TG_BOT_TOKEN = "8682225307:AAHaa-hieKBBluU6uZ2_-OgSPxGR7OwMssE";
    const TG_CHANNEL_ID = "-1004404988937";
    const TG_ADMIN_ID = "6457294906";
    const FIREBASE_BASE_URL = "https://mineora-web-default-rtdb.firebaseio.com";
    
    // YÖNETİM PARAMETRELERİ (LİKİDİTE SÜPÜRME MOTORU)
    const LOCK_WINDOW_MS = 25 * 60 * 1000;
    const SAME_COIN_LOCK_MS = 20 * 60 * 1000;
    const POST_STOP_COOLDOWN_MS = 25 * 60 * 1000;
    const LEVERAGE = 15;                            // 15x Kaldıraç
    const MARGIN_RATIO = 0.05;                      // Kasanın %5'i (Güvenli Risk)
    const TP1_RATIO_PCT = 0.60;                     // Hızlı TP1 (+%0.60)
    const TP2_RATIO_PCT = 1.20;                     // Hedef TP2 (+%1.20)
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

    async function closeBitgetPosition(symbol, isLong, halfClose = false) {
      const closeSide = isLong ? 'sell' : 'buy';
      let qty = "0";

      try {
        const posRes = await bitgetPrivateRequest(`/api/v3/position/current-position?category=USDT-FUTURES&symbol=${symbol}`, 'GET');
        if (posRes.code === '00000' && Array.isArray(posRes.data) && posRes.data.length > 0) {
          const totalQty = parseFloat(posRes.data[0].total || posRes.data[0].available || 0);
          if (totalQty > 0) {
            qty = halfClose ? (totalQty / 2).toString() : totalQty.toString();
          }
        }
      } catch (e) {}

      if (qty === "0") {
        return { code: '00000', msg: 'Pozisyon borsada zaten kapalı.' };
      }

      if (!halfClose) {
        await bitgetPrivateRequest('/api/v3/trade/cancel-symbol-order', 'POST', {
          category: 'USDT-FUTURES',
          symbol: symbol
        }).catch(() => {});
      }

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

    function calculateZScore(series, currentVal) {
      if (!series || series.length < 5) return 0;
      const n = series.length;
      const mean = series.reduce((a, b) => a + b, 0) / n;
      const variance = series.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / n;
      const stdDev = Math.sqrt(variance);
      return stdDev === 0 ? 0 : (currentVal - mean) / stdDev;
    }

    // 1. Bitget Vadeli Ticker, Spot Doğrulama ve Kontrat Basamaklarını Çek
    const [tickersRes, spotSymbolsRes, contractsRes] = await Promise.all([
      fetch("https://api.bitget.com/api/v2/mix/market/tickers?productType=USDT-FUTURES", { headers: browserHeaders }),
      fetch("https://api.bitget.com/api/v2/spot/public/symbols", { headers: browserHeaders }).catch(() => null),
      fetch("https://api.bitget.com/api/v2/mix/market/contracts?productType=USDT-FUTURES", { headers: browserHeaders }).catch(() => null)
    ]);

    const tickersJson = await tickersRes.json();
    if (tickersJson.code !== '00000' || !Array.isArray(tickersJson.data)) {
      return res.status(500).json({ error: "Bitget piyasa verisi alınamadı." });
    }

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
      if (price >= 100) return 2;
      if (price >= 10) return 3;
      if (rawPriceStr && typeof rawPriceStr === 'string' && rawPriceStr.includes('.')) {
        const decCount = rawPriceStr.split('.')[1].length;
        if (decCount > 0) return Math.min(6, decCount);
      }
      if (price >= 0.1) return 4;
      if (price >= 0.001) return 5;
      if (price >= 0.0001) return 6;
      return 8;
    }

    // cron-scan (15) Saf Kripto Doğrulama Filtresi (Hisseler ve sahte türevler elenir)
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
    // MODÜL 1: CANLI İŞLEM TAKİBİ & KADEMELİ KÂR / STOP KORUMASI
    // =========================================================================
    for (const [tradeKey, trade] of Object.entries(activeTrades)) {
      if (!trade || trade.status !== 'OPEN') continue;

      const curPrice = priceMap[trade.symbol];
      if (!curPrice || curPrice <= 0) continue;

      const isLong = trade.direction === 'LONG';
      const prec = getPrecision(trade.entryPrice, rawPriceMap[trade.symbol], trade.symbol);
      const pCurStr = curPrice.toFixed(prec);
      const pEntryStr = trade.entryPrice.toFixed(prec);

      const isTp2Hit = isLong ? (curPrice >= trade.tp2) : (curPrice <= trade.tp2);
      const isTp1Hit = isLong ? (curPrice >= trade.tp1) : (curPrice <= trade.tp1);
      const isStopHit = isLong ? (curPrice <= trade.sl) : (curPrice >= trade.sl);

      // TP2 VURULDU -> TÜM POZİSYONU KAPAT (+%1.20)
      if (isTp2Hit) {
        trade.status = 'TP2_HIT';
        trade.closedAt = now;
        await closeBitgetPosition(trade.symbol, isLong, false);

        const tgTp2Msg = `🚀 <b>MINEORA SNIPER | TP 2 TAM HEDEF VURULDU!</b>\n` +
                         `━━━━━━━━━━━━━━━━━━━━\n` +
                         `💎 <b>Parite:</b> #${trade.symbol}\n` +
                         `🧭 <b>Yön:</b> ${trade.direction}\n` +
                         `💵 <b>Giriş:</b> <code>$${pEntryStr}</code>\n` +
                         `🎯 <b>Kapanış:</b> <code>$${pCurStr}</code>\n` +
                         `💰 <b>Net Kâr:</b> +%${TP2_RATIO_PCT} (${LEVERAGE}x ile <b>+%${(TP2_RATIO_PCT * LEVERAGE).toFixed(1)} NET BÜYÜME</b>)\n` +
                         `🏆 <i>Likidite dalgası zirvede tam nakde dönüştü.</i>`;

        await sendTelegramAlert(tgTp2Msg);

        await fetch(`${FIREBASE_BASE_URL}/active_trades/${tradeKey}.json`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(trade)
        });
        continue;
      }

      // TP1 VURULDU -> %50 KÂR AL & STOP'U GİRİŞE KİLİTLE (RİSK: SIFIR)
      if (isTp1Hit && !trade.tp1Hit) {
        trade.tp1Hit = true;
        trade.sl = trade.entryPrice; // Stop başabaşa çekilir

        await closeBitgetPosition(trade.symbol, isLong, true);

        const tgTp1Msg = `🎯 <b>MINEORA SNIPER | HEDEF 1 (TP1) ALINDI!</b>\n` +
                         `━━━━━━━━━━━━━━━━━━━━\n` +
                         `💎 <b>Parite:</b> #${trade.symbol}\n` +
                         `🧭 <b>Yön:</b> ${trade.direction}\n` +
                         `💵 <b>Giriş:</b> <code>$${pEntryStr}</code>\n` +
                         `⚡ <b>Anlık:</b> <code>$${pCurStr}</code>\n` +
                         `💰 <b>Kâr:</b> +%${TP1_RATIO_PCT} (Pozisyonun %50'si nakde dönüldü)\n` +
                         `🛡️ <b>Savunma:</b> Stop-Loss maliyet ($${pEntryStr}) seviyesine çekildi. <b>Risk: SIFIR!</b>`;

        await sendTelegramAlert(tgTp1Msg);

        await fetch(`${FIREBASE_BASE_URL}/active_trades/${tradeKey}.json`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(trade)
        });
        continue;
      }

      // STOP LOSS ÇALIŞTI
      if (isStopHit) {
        trade.status = 'STOPPED';
        trade.closedAt = now;
        await closeBitgetPosition(trade.symbol, isLong, false);

        await fetch(`${FIREBASE_BASE_URL}/last_stopped_coins/${trade.symbol}.json`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(now)
        }).catch(() => {});

        const tgStopMsg = `🛑 <b>MINEORA SNIPER | DİSİPLİN ÇIKIŞI</b>\n` +
                          `━━━━━━━━━━━━━━━━━━━━\n` +
                          `💎 <b>Parite:</b> #${trade.symbol}\n` +
                          `💵 <b>Kapanış:</b> <code>$${pCurStr}</code>\n` +
                          `📉 <b>Durum:</b> ${trade.tp1Hit ? '0.00% (Başa Baş Korundu)' : 'Fitil Arkası Stop Tetiklendi'}\n` +
                          `⚠️ <i>Parite 25 dk soğumada.</i>`;

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
    // MODÜL 2: CRON-SCAN (15) SAF LİKİDİTE SÜPÜRME RADARI
    // =========================================================================
    const openTradesCount = Object.values(activeTrades).filter(t => {
      if (!t || t.status !== 'OPEN') return false;
      const tTime = t.createdAt || 0;
      return (now - tTime) <= LOCK_WINDOW_MS;
    }).length;

    if (openTradesCount >= 3) {
      return res.status(200).json({ status: "IDLE", message: "Takipte 3 aktif operasyon var." });
    }

    // TOKSİK COIN KARA LİSTESİ (Kayıpların %70'ini üretenler)
    const TOXIC_COINS_BLACKLIST = [
      "BCHUSDT", "PAXGUSDT", "XRPUSDT", "AVAXUSDT", "ENAUSDT", "TRXUSDT",
      "ADAUSDT", "IDOLUSDT", "LINKUSDT", "ETHUSDT", "PEPEUSDT", "ZECUSDT"
    ];

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

    const pool = tickersJson.data.filter(c => {
      if (!c.symbol || !c.symbol.endsWith("USDT")) return false;
      if (c.symbol.includes("_") || c.symbol.includes(".") || c.symbol.includes("-")) return false;

      const symUpper = c.symbol.toUpperCase();
      if (TOXIC_COINS_BLACKLIST.includes(symUpper)) return false;
      for (const fx of FOREX_AND_FIAT) if (symUpper.includes(fx)) return false;
      for (const st of STOCKS_BLACKLIST) if (symUpper.includes(st)) return false;

      // Bitget Spot tahtasında listeli gerçek kripto para doğrulaması
      if (genuineSpotCryptoSet.size > 0 && !genuineSpotCryptoSet.has(c.symbol)) return false;

      const p = parseFloat(c.lastPr || 0);
      if (p > 0 && p < 0.005) return false;

      const vol = parseFloat(c.usdtVolume || c.quoteVolume || 0);
      return vol >= 1500000;
    }).sort((a, b) => parseFloat(b.usdtVolume || 0) - parseFloat(a.usdtVolume || 0));

    let candidateTrade = null;

    for (const item of pool) {
      const lastSentTime = lastSignals[item.symbol] || 0;
      if (now - lastSentTime < SAME_COIN_LOCK_MS) continue;

      const lastStopTime = lastStoppedCoins[item.symbol] || 0;
      if (now - lastStopTime < POST_STOP_COOLDOWN_MS) continue;

      const candles1mRes = await fetch(`https://api.bitget.com/api/v2/mix/market/candles?symbol=${item.symbol}&productType=USDT-FUTURES&granularity=1m&limit=25`, { headers: browserHeaders })
        .then(r => r.json()).catch(() => ({}));

      if (candles1mRes.code !== '00000' || !Array.isArray(candles1mRes.data) || candles1mRes.data.length < 20) continue;

      const candles1m = candles1mRes.data.map(c => ({
        time: Math.floor(Number(c[0]) / 1000),
        open: Number(c[1]),
        high: Number(c[2]),
        low: Number(c[3]),
        close: Number(c[4]),
        volume: Number(c[5])
      })).sort((a, b) => a.time - b.time);

      const cur1m = candles1m[candles1m.length - 1];
      const sweep1m = candles1m[candles1m.length - 2];
      const pastList = candles1m.slice(0, -2);

      const rangeHigh = Math.max(...pastList.map(c => c.high));
      const rangeLow  = Math.min(...pastList.map(c => c.low));

      const sweepRange = sweep1m.high - sweep1m.low;
      if (sweepRange <= 0) continue;

      const sweepLowerWick = Math.min(sweep1m.open, sweep1m.close) - sweep1m.low;
      const sweepUpperWick = sweep1m.high - Math.max(sweep1m.open, sweep1m.close);

      // CRON-SCAN (15) KURAL 1: %48 FİTİL İLE LİKİDİTE SÜPÜRMESİ
      const isBullishSweep = (sweep1m.low <= rangeLow) && (sweep1m.close > rangeLow) && ((sweepLowerWick / sweepRange) >= 0.48) && (cur1m.close > sweep1m.close);
      const isBearishSweep = (sweep1m.high >= rangeHigh) && (sweep1m.close < rangeHigh) && ((sweepUpperWick / sweepRange) >= 0.48) && (cur1m.close < sweep1m.close);

      if (!isBullishSweep && !isBearishSweep) continue;

      // CRON-SCAN (15) KURAL 2: 1.8σ Z-SCORE HACİM ANOMALİSİ
      const volZScore = calculateZScore(pastList.map(c => c.volume), sweep1m.volume);
      if (volZScore < 1.8) continue;

      // CRON-SCAN (15) KURAL 3: 250$ EMİR FİLTRESİ İLE KURUMSAL TAKER AKIŞI
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

      // LONG TETİĞİ (%65 Teyit)
      if (isBullishSweep && takerBuyRatio >= 65) {
        candidateTrade = {
          symbol: item.symbol,
          direction: 'LONG',
          price: cur1m.close,
          rawPriceStr: item.lastPr,
          wickPoint: sweep1m.low,
          level: rangeLow,
          volZScore: parseFloat(volZScore.toFixed(2)),
          takerRatio: Math.round(takerBuyRatio),
          reason: `Son 20 dk dip seviyesi ($${rangeLow}) iğnelendi. %${Math.round((sweepLowerWick / sweepRange) * 100)} alt fitille satıcılar absorbe edildi, ${volZScore.toFixed(1)}σ Z-Score hacim ve %${Math.round(takerBuyRatio)} alıcı akışıyla sıçrama başladı.`
        };
        break;
      }

      // SHORT TETİĞİ (%35 Teyit)
      if (isBearishSweep && takerBuyRatio <= 35) {
        candidateTrade = {
          symbol: item.symbol,
          direction: 'SHORT',
          price: cur1m.close,
          rawPriceStr: item.lastPr,
          wickPoint: sweep1m.high,
          level: rangeHigh,
          volZScore: parseFloat(volZScore.toFixed(2)),
          takerRatio: Math.round(100 - takerBuyRatio),
          reason: `Son 20 dk tepe seviyesi ($${rangeHigh}) iğnelendi. %${Math.round((sweepUpperWick / sweepRange) * 100)} üst fitille boğa tuzağı kuruldu, ${volZScore.toFixed(1)}σ Z-Score hacim ve %${Math.round(100 - takerBuyRatio)} satıcı akışıyla çöküş başladı.`
        };
        break;
      }
    }

    if (!candidateTrade) {
      return res.status(200).json({ status: "SCANNING", message: "Saf likidite süpürme ve balina ayakizleri taranıyor..." });
    }

    // =========================================================================
    // MODÜL 3: CANLI BORSA EMRİ (BİTGET UTA V3 NATIVE MÜHÜRLEME)
    // =========================================================================
    const currentEquity = await getFuturesEquity();
    
    await fetch(`${FIREBASE_BASE_URL}/last_known_equity.json`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(currentEquity)
    }).catch(() => {});

    const dynamicMargin = parseFloat(Math.max(5, (currentEquity * MARGIN_RATIO)).toFixed(2));
    
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

    const precision = getPrecision(entryPrice, candidateTrade.rawPriceStr, candidateTrade.symbol);

    // Kademeli Hedef ve Fitil Arkası Stop Seviyeleri
    const tp1 = isLong ? entryPrice * (1 + TP1_RATIO_PCT / 100) : entryPrice * (1 - TP1_RATIO_PCT / 100);
    const tp2 = isLong ? entryPrice * (1 + TP2_RATIO_PCT / 100) : entryPrice * (1 - TP2_RATIO_PCT / 100);

    let sl = isLong 
      ? Math.min(candidateTrade.wickPoint * 0.9985, entryPrice * 0.9920)
      : Math.max(candidateTrade.wickPoint * 1.0015, entryPrice * 1.0080);

    const tp1Formatted = tp1.toFixed(precision);
    const slFormatted = sl.toFixed(precision);

    // Borsaya Mühürlü Market Emri (TP1 ve Fitil Stopu Borsa Sunucusuna Yazılır)
    const orderPayload = {
      category: 'USDT-FUTURES',
      symbol: candidateTrade.symbol,
      side: isLong ? 'buy' : 'sell',
      orderType: 'market',
      qty: orderSize.toString(),
      presetTakeProfitPrice: tp1Formatted,
      takeProfit: tp1Formatted,
      tpOrderType: 'market',
      tpTriggerBy: 'mark',
      presetStopLossPrice: slFormatted,
      stopLoss: slFormatted,
      slOrderType: 'market',
      slTriggerBy: 'mark'
    };

    const placeOrderRes = await bitgetPrivateRequest('/api/v3/trade/place-order', 'POST', orderPayload);

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
      tp1,
      tp2,
      sl,
      status: 'OPEN',
      tp1Hit: false,
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
    const tp1Str = tp1.toFixed(precision);
    const tp2Str = tp2.toFixed(precision);
    const slStr = sl.toFixed(precision);
    const lvlStr = candidateTrade.level.toFixed(precision);

    const tgMsg = `🎯 <b>MINEORA SNIPER | LİKİDİTE SÜPÜRME ALARMI</b>\n` +
                  `━━━━━━━━━━━━━━━━━━━━\n` +
                  `💎 <b>Parite:</b> #${candidateTrade.symbol}\n` +
                  `🧭 <b>Pozisyon:</b> ${isLong ? '🟢 LONG (Dip Likidite Avı)' : '🔴 SHORT (Tepe Likidite Avı)'}\n` +
                  `🧱 <b>Avlanan Seviye:</b> <code>$${lvlStr}</code>\n` +
                  `📊 <b>Hacim Anomalisi:</b> ${candidateTrade.volZScore}σ Z-Score\n` +
                  `⚡ <b>Kurumsal Güç:</b> %${candidateTrade.takerRatio}\n` +
                  `💵 <b>Giriş:</b> <code>$${pStr}</code>\n` +
                  `💼 <b>Model:</b> Kasanın %5'i ($${dynamicMargin}) | ${LEVERAGE}x Kaldıraç\n` +
                  `━━━━━━━━━━━━━━━━━━━━\n` +
                  `🎯 <b>Hızlı TP 1 (+%${TP1_RATIO_PCT}):</b> <code>$${tp1Str}</code> (Borsaya Mühürlendi)\n` +
                  `🚀 <b>Hedef TP 2 (+%${TP2_RATIO_PCT}):</b> <code>$${tp2Str}</code>\n` +
                  `🛑 <b>Fitil Arkası Stop:</b> <code>$${slStr}</code> (Borsaya Mühürlendi)\n` +
                  `━━━━━━━━━━━━━━━━━━━━\n` +
                  `📊 <i>İstihbarat: ${candidateTrade.reason}</i>\n` +
                  `💡 <i>Kural: TP1 (+%0.60) alındığı an borsa pozisyonunun %50'si satılır, stop girişe kilitlenir!</i>`;

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
