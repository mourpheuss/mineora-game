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
    // 0. BİTGET UNIFIED / UTA V3 BİLGİLERİ & 4 COİN KONTROLLÜ DCA PARAMETRELERİ
    // =========================================================================
    const ADMIN_API_KEY = "bg_70a6d856aad55c998597f8888e27a61f";
    const ADMIN_SECRET = "07562c9e62461b950ac8eec37fc9c9cb821bee34a57fc14fca54352bb5423804";
    const ADMIN_PASSPHRASE = "Ers4834754";
    const BITGET_BASE_URL = 'https://api.bitget.com';

    const TG_BOT_TOKEN = "8682225307:AAHaa-hieKBBluU6uZ2_-OgSPxGR7OwMssE";
    const TG_CHANNEL_ID = "-1004404988937";
    const TG_ADMIN_ID = "6457294906";
    const FIREBASE_BASE_URL = "https://mineora-web-default-rtdb.firebaseio.com";
    
    const SAME_COIN_LOCK_MS = 15 * 60 * 1000;
    const MAX_CONCURRENT_TRADES = 4;                // MAKSİMUM 4 İŞLEM SINIRI
    const LEVERAGE = 10;                            // 10x KALDIRAÇ (GÜNCELLENDİ)
    const MARGIN_RATIO = 0.03;                      // KASANIN %3'Ü İLE İLK GİRİŞ
    const DCA_DROP_STEP_PCT = 2.50;                 // HER -%2.50 GERİ GİTTİĞİNDE EKLEME
    const TP_TARGET_PCT = 0.70;                     // TEK VE KESİN TP: ORTALAMA MALİYETTEN +%0.70
    const MAX_DCA_ADDS = 4;                         // EN FAZLA 4 DEFA EKLEME YAPILSIN
    const startTime = Date.now();

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

    async function bingxPrivateRequest(endpoint, method = 'POST', params = {}, creds = {}) {
      if (!creds || !creds.key || !creds.secret) return { code: -1, msg: "BingX API anahtarları eksik" };
      const timestamp = Date.now().toString();
      const fullParams = { ...params, timestamp };

      const sortedKeys = Object.keys(fullParams).sort();
      const queryString = sortedKeys.map(k => `${k}=${encodeURIComponent(fullParams[k])}`).join('&');
      const signature = crypto.createHmac('sha256', creds.secret).update(queryString).digest('hex');
      const finalUrl = `https://open-api.bingx.com${endpoint}?${queryString}&signature=${signature}`;

      try {
        const response = await fetch(finalUrl, {
          method,
          headers: {
            'X-BX-APIKEY': creds.key,
            'Content-Type': 'application/json'
          }
        });
        return await response.json();
      } catch (err) {
        return { code: -1, msg: err.message };
      }
    }

    async function closeBitgetPosition(symbol, isLong) {
      const closeSide = isLong ? 'sell' : 'buy';
      let qty = "0";

      try {
        const posRes = await bitgetPrivateRequest(`/api/v3/position/current-position?category=USDT-FUTURES&symbol=${symbol}`, 'GET');
        if (posRes.code === '00000' && Array.isArray(posRes.data) && posRes.data.length > 0) {
          const totalQty = parseFloat(posRes.data[0].total || posRes.data[0].available || 0);
          if (totalQty > 0) {
            qty = totalQty.toString();
          }
        }
      } catch (e) {}

      if (qty === "0") {
        return { code: '00000', msg: 'Pozisyon borsada zaten kapalı.' };
      }

      await Promise.allSettled([
        bitgetPrivateRequest('/api/v3/trade/cancel-symbol-order', 'POST', { category: 'USDT-FUTURES', symbol }),
        bitgetPrivateRequest('/api/v3/trade/cancel-symbol-plan-order', 'POST', { category: 'USDT-FUTURES', symbol })
      ]);

      return await bitgetPrivateRequest('/api/v3/trade/place-order', 'POST', {
        category: 'USDT-FUTURES',
        symbol: symbol,
        side: closeSide,
        orderType: 'market',
        qty: qty,
        reduceOnly: 'yes'
      });
    }

    async function executeUserCloses(symbol, isLong) {
      const closeSideBitget = isLong ? 'sell' : 'buy';
      const closeSideBingx  = isLong ? 'SELL' : 'BUY';

      for (const [uname, udata] of Object.entries(allUsers)) {
        if (!udata || !udata.autoTradeEnabled) continue;
        const ex = udata.exchange || 'BITGET';
        const creds = udata.exchangeApi || udata.bitgetApi;
        if (!creds || !creds.key || !creds.secret) continue;

        try {
          if (ex === 'BITGET') {
            await bitgetPrivateRequest('/api/v3/trade/place-order', 'POST', {
              category: 'USDT-FUTURES',
              symbol: symbol,
              side: closeSideBitget,
              orderType: 'market',
              reduceOnly: 'yes'
            }, creds).catch(() => {});
          } else if (ex === 'BINGX') {
            const bingxSym = symbol.replace('USDT', '-USDT');
            await bingxPrivateRequest('/openApi/swap/v2/trade/order', 'POST', {
              symbol: bingxSym,
              side: closeSideBingx,
              type: 'MARKET',
              reduceOnly: 'true'
            }, creds).catch(() => {});
          }
        } catch (e) {}
      }
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

      return 100;
    }

    function calculateZScore(series, currentVal) {
      if (!series || series.length < 5) return 0;
      const n = series.length;
      const mean = series.reduce((a, b) => a + b, 0) / n;
      const variance = series.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / n;
      const stdDev = Math.sqrt(variance);
      return stdDev === 0 ? 0 : (currentVal - mean) / stdDev;
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

    const symbolPrecisionMap = {};
    const symbolVolumePlaceMap = {};
    const symbolMinQtyMap = {};

    if (contractsRes && contractsRes.ok) {
      try {
        const contractsJson = await contractsRes.json();
        if (contractsJson.code === '00000' && Array.isArray(contractsJson.data)) {
          contractsJson.data.forEach(c => {
            if (c.symbol) {
              if (c.pricePlace !== undefined) symbolPrecisionMap[c.symbol] = parseInt(c.pricePlace, 10);
              if (c.volumePlace !== undefined) symbolVolumePlaceMap[c.symbol] = parseInt(c.volumePlace, 10);
              if (c.minTradeNum !== undefined) symbolMinQtyMap[c.symbol] = parseFloat(c.minTradeNum);
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

    function calculateOrderQuantityDynamic(symbol, entryPrice, notional) {
      const rawQty = notional / entryPrice;
      const volPlace = symbolVolumePlaceMap[symbol] !== undefined ? symbolVolumePlaceMap[symbol] : 0;
      const minQty = symbolMinQtyMap[symbol] !== undefined ? symbolMinQtyMap[symbol] : 1;

      let finalQty = parseFloat(rawQty.toFixed(volPlace));
      if (finalQty < minQty) {
        finalQty = minQty;
      }
      return finalQty;
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
    let allUsers = {};
    try {
      const [atRes, lsRes, usRes] = await Promise.all([
        fetch(`${FIREBASE_BASE_URL}/active_trades.json`),
        fetch(`${FIREBASE_BASE_URL}/last_signals.json`),
        fetch(`${FIREBASE_BASE_URL}/users.json`)
      ]);
      activeTrades = (await atRes.json()) || {};
      lastSignals = (await lsRes.json()) || {};
      allUsers = (await usRes.json()) || {};
    } catch (e) {
      activeTrades = {};
      lastSignals = {};
      allUsers = {};
    }

    // =========================================================================
    // MODÜL 1: CANLI İŞLEM DENETLEYİCİSİ (+%0.70 TP & EN FAZLA 4 KEZ DCA EKLEME)
    // =========================================================================
    async function evaluateActiveTrades(currentTime) {
      let openCount = 0;
      for (const [tradeKey, trade] of Object.entries(activeTrades)) {
        if (!trade || trade.status !== 'OPEN') continue;
        openCount++;

        const curPrice = priceMap[trade.symbol];
        if (!curPrice || curPrice <= 0) continue;

        const isLong = trade.direction === 'LONG';
        const prec = getPrecision(trade.entryPrice, rawPriceMap[trade.symbol], trade.symbol);
        const pCurStr = curPrice.toFixed(prec);
        const pEntryStr = trade.entryPrice.toFixed(prec);

        const pnlPct = isLong
          ? ((curPrice - trade.entryPrice) / trade.entryPrice) * 100
          : ((trade.entryPrice - curPrice) / trade.entryPrice) * 100;

        // 1. KESİN TP: FİYAT ORTALAMA MALİYETTEN +%0.70 KÂR GÖRDÜĞÜNDE %100 TAM KAPANIŞ
        if (pnlPct >= TP_TARGET_PCT) {
          trade.status = 'TP_HIT';
          trade.closedAt = currentTime;
          trade.exitPrice = curPrice;
          trade.realizedPnlPct = pnlPct;
          
          await closeBitgetPosition(trade.symbol, isLong);
          await executeUserCloses(trade.symbol, isLong);

          const tgTpMsg = `🎯 <b>MINEORA SNIPER | TP HEDEFİ VURULDU (%100 KAPANDI)!</b>\n` +
                          `━━━━━━━━━━━━━━━━━━━━\n` +
                          `💎 <b>Parite:</b> #${trade.symbol}\n` +
                          `🧭 <b>Yön:</b> ${trade.direction}\n` +
                          `💵 <b>Ortalama Maliyet:</b> <code>$${pEntryStr}</code>\n` +
                          `🎯 <b>Kapanış Fiyatı:</b> <code>$${pCurStr}</code>\n` +
                          `💰 <b>Net Kâr:</b> +%${pnlPct.toFixed(2)} (${LEVERAGE}x ile <b>+%${(pnlPct * LEVERAGE).toFixed(1)} MARJİN KÂRI</b>)\n` +
                          `🧱 <b>Toplam Katman:</b> ${trade.dcaCount || 1}. Kademe Tamamlandı\n` +
                          `✨ <i>Pozisyon tamamen kapatıldı, kasa nakde geçti.</i>`;

          await sendTelegramAlert(tgTpMsg);

          await fetch(`${FIREBASE_BASE_URL}/active_trades/${tradeKey}.json`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(trade)
          });
          openCount--;
          continue;
        }

        // 2. DCA MALİYET İNDİRME: EN FAZLA 4 KEZ EKLEME (dcaCount < 5)
        const dcaCount = trade.dcaCount || 1;
        const nextDcaTriggerDropPct = dcaCount * DCA_DROP_STEP_PCT;

        if (dcaCount <= MAX_DCA_ADDS && pnlPct <= -nextDcaTriggerDropPct) {
          const lastMarginUsed = trade.lastMarginUsed || trade.marginUsed;
          const addMargin = parseFloat((lastMarginUsed * 0.50).toFixed(2));

          if (addMargin >= 1.0) {
            const addNotional = addMargin * LEVERAGE;
            const addQty = calculateOrderQuantityDynamic(trade.symbol, curPrice, addNotional);
            const addSide = isLong ? 'buy' : 'sell';

            const addOrderRes = await bitgetPrivateRequest('/api/v3/trade/place-order', 'POST', {
              category: 'USDT-FUTURES',
              symbol: trade.symbol,
              side: addSide,
              orderType: 'market',
              qty: addQty.toString()
            });

            if (addOrderRes.code === '00000') {
              const prevQty = trade.openSize || 0;
              const newTotalQty = prevQty + addQty;
              const prevNotional = prevQty * trade.entryPrice;
              const newTotalNotional = prevNotional + addNotional;
              const newAvgEntry = newTotalNotional / newTotalQty;

              trade.entryPrice = newAvgEntry;
              trade.openSize = newTotalQty;
              trade.totalMargin = (trade.totalMargin || trade.marginUsed) + addMargin;
              trade.lastMarginUsed = addMargin;
              trade.dcaCount = dcaCount + 1;
              trade.tp = isLong ? newAvgEntry * (1 + TP_TARGET_PCT / 100) : newAvgEntry * (1 - TP_TARGET_PCT / 100);

              const newEntryStr = newAvgEntry.toFixed(prec);
              const newTpStr = trade.tp.toFixed(prec);

              const tgDcaMsg = `🧱 <b>MINEORA SNIPER | DCA KADEME EKLEMESİ YAPILDI</b>\n` +
                               `━━━━━━━━━━━━━━━━━━━━\n` +
                               `💎 <b>Parite:</b> #${trade.symbol}\n` +
                               `🧭 <b>Yön:</b> ${trade.direction}\n` +
                               `📉 <b>Çekilme:</b> -%${Math.abs(pnlPct).toFixed(2)} (Eşik: -%${nextDcaTriggerDropPct.toFixed(2)})\n` +
                               `💵 <b>Eklenen Marjin:</b> $${addMargin} (Öncekinin %50'si)\n` +
                               `🎯 <b>Yeni Ortalama Maliyet:</b> <code>$${newEntryStr}</code>\n` +
                               `🚀 <b>Yeni TP Hedefi (+%0.70):</b> <code>$${newTpStr}</code>\n` +
                               `🧱 <b>Toplam Kademe Sayısı:</b> ${trade.dcaCount - 1} / ${MAX_DCA_ADDS} Ekleme Yapıldı`;

              await sendTelegramAlert(tgDcaMsg);

              await fetch(`${FIREBASE_BASE_URL}/active_trades/${tradeKey}.json`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(trade)
              });
            }
          }
        }
      }
      return openCount;
    }

    let currentOpenCount = await evaluateActiveTrades(Date.now());

    // =========================================================================
    // NÖBETÇİ MODU (SENTINEL LOOP): 4 İŞLEM DOLDUĞUNDA GENEL TARAMAYI DURDUR,
    // 52 SANİYE BOYUNCA 2.5 SANİYEDE BİR SADECE BU 4 POZİSYONU ANLIK DENETLE!
    // BİRİ KAPANDIĞI ANDA DÖNGÜDEN ÇIKIP DERHAL YENİ TARAMAYA GEÇ!
    // =========================================================================
    if (currentOpenCount >= MAX_CONCURRENT_TRADES) {
      console.log(`[SENTINEL MODE] 4 İşlem Dolu. Genel tarama kapatıldı, mikro-takip nöbetine girildi.`);

      while ((Date.now() - startTime) < 52000) {
        await new Promise(r => setTimeout(r, 2500));

        const activeSymbols = Object.values(activeTrades).filter(t => t && t.status === 'OPEN').map(t => t.symbol);
        if (activeSymbols.length === 0) break;

        try {
          const quickTickRes = await fetch("https://api.bitget.com/api/v2/mix/market/tickers?productType=USDT-FUTURES", { headers: browserHeaders });
          const qJson = await quickTickRes.json();
          if (qJson.code === '00000' && Array.isArray(qJson.data)) {
            qJson.data.forEach(t => {
              if (activeSymbols.includes(t.symbol)) {
                priceMap[t.symbol] = parseFloat(t.lastPr || 0);
              }
            });
          }
        } catch(e) {}

        currentOpenCount = await evaluateActiveTrades(Date.now());

        if (currentOpenCount < MAX_CONCURRENT_TRADES) {
          console.log(`[SENTINEL MODE] Bir işlem kapandı (${currentOpenCount}/${MAX_CONCURRENT_TRADES}). Yeni tarama başlatılıyor.`);
          break;
        }
      }

      if (currentOpenCount >= MAX_CONCURRENT_TRADES) {
        return res.status(200).json({ status: "SENTINEL_ACTIVE", message: "4 pozisyon 52 saniye boyunca gerçek zamanlı korundu ve takip edildi." });
      }
    }

    // =========================================================================
    // MODÜL 2: 20 DAKİKALIK SAF LİKİDİTE SÜPÜRME TARAMA MOTORU
    // =========================================================================
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

      if (genuineSpotCryptoSet.size > 0 && !genuineSpotCryptoSet.has(c.symbol)) return false;

      const p = parseFloat(c.lastPr || 0);
      if (p > 0 && p < 0.005) return false;

      const vol = parseFloat(c.usdtVolume || c.quoteVolume || 0);
      return vol >= 1500000;
    }).sort((a, b) => parseFloat(b.usdtVolume || 0) - parseFloat(a.usdtVolume || 0));

    let candidateTrade = null;

    for (const item of pool) {
      const isAlreadyOpen = Object.values(activeTrades).some(t => t && t.status === 'OPEN' && t.symbol === item.symbol);
      if (isAlreadyOpen) continue;

      const lastSentTime = lastSignals[item.symbol] || 0;
      if (Date.now() - lastSentTime < SAME_COIN_LOCK_MS) continue;

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
      const rangeSpan = rangeHigh - rangeLow;
      if (rangeSpan <= 0) continue;

      const sweepRange = sweep1m.high - sweep1m.low;
      if (sweepRange <= 0) continue;

      const sweepLowerWick = Math.min(sweep1m.open, sweep1m.close) - sweep1m.low;
      const sweepUpperWick = sweep1m.high - Math.max(sweep1m.open, sweep1m.close);

      // KURAL 1: CRON-SCAN (15) ORİJİNAL %48 FİTİL VE LİKİDİTE SÜPÜRMESİ
      const isBullishSweep = (sweep1m.low <= rangeLow) && (sweep1m.close > rangeLow) && ((sweepLowerWick / sweepRange) >= 0.48) && (cur1m.close > sweep1m.close);
      const isBearishSweep = (sweep1m.high >= rangeHigh) && (sweep1m.close < rangeHigh) && ((sweepUpperWick / sweepRange) >= 0.48) && (cur1m.close < sweep1m.close);

      if (!isBullishSweep && !isBearishSweep) continue;

      // KURAL 2: 1.8σ Z-SCORE HACİM ANOMALİSİ
      const volZScore = calculateZScore(pastList.map(c => c.volume), sweep1m.volume);
      if (volZScore < 1.8 || volZScore > 5.0) continue;

      // KURAL 3: 250$ KURUMSAL EMİR FİLTRESİ İLE TAKER AKIŞI
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

      // LONG TETİĞİ (%65 Kurumsal Alıcı Akışı)
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

      // SHORT TETİĞİ (%35 Satıcı Baskısı)
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
      return res.status(200).json({ status: "SCANNING", message: "Likidite süpürme fırsatları taranıyor..." });
    }

    // =========================================================================
    // MODÜL 3: CANLI BORSA EMRİ (KASANIN %3'Ü, STOP YOK, TEK TP: +%0.70)
    // =========================================================================
    const currentEquity = await getFuturesEquity();
    
    await fetch(`${FIREBASE_BASE_URL}/last_known_equity.json`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(currentEquity)
    }).catch(() => {});

    const dynamicMargin = parseFloat(Math.max(3, (currentEquity * MARGIN_RATIO)).toFixed(2));
    
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
    
    const orderSize = calculateOrderQuantityDynamic(candidateTrade.symbol, entryPrice, positionNotional);
    const precision = getPrecision(entryPrice, candidateTrade.rawPriceStr, candidateTrade.symbol);

    const tp = isLong ? entryPrice * (1 + TP_TARGET_PCT / 100) : entryPrice * (1 - TP_TARGET_PCT / 100);
    const tpFormatted = tp.toFixed(precision);

    const orderPayload = {
      category: 'USDT-FUTURES',
      symbol: candidateTrade.symbol,
      side: isLong ? 'buy' : 'sell',
      orderType: 'market',
      qty: orderSize.toString(),
      presetTakeProfitPrice: tpFormatted,
      takeProfit: tpFormatted,
      tpOrderType: 'market',
      tpTriggerBy: 'mark'
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

    let memberOrdersCount = 0;
    for (const [uname, udata] of Object.entries(allUsers)) {
      if (!udata || !udata.autoTradeEnabled) continue;
      const ex = udata.exchange || 'BITGET';
      const creds = udata.exchangeApi || udata.bitgetApi;
      if (!creds || !creds.key || !creds.secret) continue;

      try {
        if (ex === 'BITGET') {
          await bitgetPrivateRequest('/api/v3/account/set-leverage', 'POST', {
            category: 'USDT-FUTURES',
            symbol: candidateTrade.symbol,
            marginCoin: 'USDT',
            leverage: LEVERAGE.toString()
          }, creds);

          let uSize = 1;
          try {
            const uAcc = await bitgetPrivateRequest('/api/v3/account/assets', 'GET', {}, creds);
            const uList = Array.isArray(uAcc.data) ? uAcc.data : (uAcc.data?.assets || []);
            const uUsdt = uList.find(a => (a.coin === 'USDT' || a.coinName === 'USDT'));
            const uEq = parseFloat(uUsdt?.equity || 100);
            uSize = calculateOrderQuantityDynamic(candidateTrade.symbol, entryPrice, uEq * MARGIN_RATIO * LEVERAGE);
          } catch(e) { uSize = 1; }

          await bitgetPrivateRequest('/api/v3/trade/place-order', 'POST', {
            category: 'USDT-FUTURES',
            symbol: candidateTrade.symbol,
            side: isLong ? 'buy' : 'sell',
            orderType: 'market',
            qty: uSize.toString(),
            presetTakeProfitPrice: tpFormatted,
            takeProfit: tpFormatted,
            tpOrderType: 'market',
            tpTriggerBy: 'mark'
          }, creds);
          memberOrdersCount++;

        } else if (ex === 'BINGX') {
          const bingxSym = candidateTrade.symbol.replace('USDT', '-USDT');

          await bingxPrivateRequest('/openApi/swap/v2/trade/leverage', 'POST', {
            symbol: bingxSym,
            side: isLong ? 'LONG' : 'SHORT',
            leverage: LEVERAGE.toString()
          }, creds);

          let bSize = 1;
          try {
            const bBal = await bingxPrivateRequest('/openApi/swap/v2/user/balance', 'GET', {}, creds);
            const bEq = parseFloat(bBal.data?.balance?.equity || 100);
            bSize = calculateOrderQuantityDynamic(candidateTrade.symbol, entryPrice, bEq * MARGIN_RATIO * LEVERAGE);
          } catch(e) { bSize = 1; }

          await bingxPrivateRequest('/openApi/swap/v2/trade/order', 'POST', {
            symbol: bingxSym,
            side: isLong ? 'BUY' : 'SELL',
            positionSide: isLong ? 'LONG' : 'SHORT',
            type: 'MARKET',
            quantity: bSize.toString(),
            takeProfit: JSON.stringify({ type: 'TAKE_PROFIT_MARKET', stopPrice: parseFloat(tpFormatted), price: parseFloat(tpFormatted) })
          }, creds);
          memberOrdersCount++;
        }
      } catch(err) {}
    }

    const tradeId = `trade_${Date.now()}`;
    const newTrade = {
      id: tradeId,
      symbol: candidateTrade.symbol,
      direction: candidateTrade.direction,
      entryPrice,
      tp,
      sl: 0,
      status: 'OPEN',
      dcaCount: 1,
      marginUsed: dynamicMargin,
      totalMargin: dynamicMargin,
      lastMarginUsed: dynamicMargin,
      openSize: orderSize,
      score: candidateTrade.takerRatio,
      reason: candidateTrade.reason,
      createdAt: Date.now(),
      timestamp: new Date().toISOString(),
      walletEquityAtEntry: currentEquity,
      bitgetOrderResult: 'SUCCESS',
      tpResult: 'SUCCESS (BORSAYA MÜHÜRLENDİ)',
      stopResult: 'DISABLED (STOP YOK)',
      membersExecuted: memberOrdersCount
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
        body: JSON.stringify(Date.now())
      })
    ]);

    const pStr = entryPrice.toFixed(precision);
    const tpStr = tp.toFixed(precision);
    const lvlStr = candidateTrade.level.toFixed(precision);

    const tgMsg = `🎯 <b>MINEORA SNIPER | DCA LİKİDİTE SÜPÜRME</b>\n` +
                  `━━━━━━━━━━━━━━━━━━━━\n` +
                  `💎 <b>Parite:</b> #${candidateTrade.symbol}\n` +
                  `🧭 <b>Pozisyon:</b> ${isLong ? '🟢 LONG (Dip Likidite Avı)' : '🔴 SHORT (Tepe Likidite Avı)'}\n` +
                  `🧱 <b>Avlanan Seviye:</b> <code>$${lvlStr}</code>\n` +
                  `📊 <b>Hacim Anomalisi:</b> ${candidateTrade.volZScore}σ Z-Score\n` +
                  `⚡ <b>Kurumsal Güç:</b> %${candidateTrade.takerRatio}\n` +
                  `💵 <b>Giriş:</b> <code>$${pStr}</code>\n` +
                  `💼 <b>Model:</b> Kasanın %3'ü ($${dynamicMargin}) | ${LEVERAGE}x Kaldıraç\n` +
                  `🏦 <b>Borsa Emri:</b> ✅ Bitget UTA Emri Açıldı\n` +
                  `👥 <b>Ayna İşlem (Kullanıcılar):</b> ${memberOrdersCount} Üye Hesabında Açıldı\n` +
                  `━━━━━━━━━━━━━━━━━━━━\n` +
                  `🎯 <b>Hedef TP (+%${TP_TARGET_PCT}):</b> <code>$${tpStr}</code> (Borsaya Mühürlendi)\n` +
                  `🛡️ <b>Stop Mantığı:</b> STOP YOK! (Her -%${DCA_DROP_STEP_PCT} geri çekilmede son marjinin %50'si kadar ekleme yapılır | Maks 4 Ekleme)\n` +
                  `━━━━━━━━━━━━━━━━━━━━\n` +
                  `💡 <i>Kural: +%0.70 kâr görüldüğünde pozisyon %100 tam kapatılır.</i>`;

    await sendTelegramAlert(tgMsg);

    return res.status(200).json({
      success: true,
      trade: newTrade,
      bitget_order: placeOrderRes,
      wallet_equity: currentEquity,
      margin_used: dynamicMargin,
      members_executed: memberOrdersCount
    });

  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}
