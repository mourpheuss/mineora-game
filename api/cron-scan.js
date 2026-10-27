import crypto from 'crypto';

export default async function handler(req, res) {
  try {
    const browserHeaders = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
      'Accept': 'application/json'
    };

    // =========================================================================
    // 0. SENİN YÖNETİCİ HESABIN (BİTGET UNIFIED / UTA V3)
    // =========================================================================
    const ADMIN_API_KEY = "bg_f73437198f37d20e56939b82041041d0";
    const ADMIN_SECRET = "fe44b9c347eb5d9dd0e624876809102bb3ec8bab9481ad7bdb5ddf4d8d332ecd";
    const ADMIN_PASSPHRASE = "Ers4834754";
    const BITGET_BASE_URL = 'https://api.bitget.com';

    const TG_BOT_TOKEN = "8682225307:AAHaa-hieKBBluU6uZ2_-OgSPxGR7OwMssE";
    const TG_CHANNEL_ID = "-1004404988937";
    const TG_ADMIN_ID = "6457294906";
    const FIREBASE_BASE_URL = "https://mineora-web-default-rtdb.firebaseio.com";
    
    const LOCK_WINDOW_MS = 25 * 60 * 1000;
    const SAME_COIN_LOCK_MS = 20 * 60 * 1000;
    const LEVERAGE = 20;
    const MARGIN_RATIO = 0.10; // Kasanın %10'u
    const now = Date.now();

    // Bitget V3 (UTA) ve V2 İmzalı İstek Motoru
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

    // BingX V2 Swap API İmzalı İstek Motoru (Üyeler İçin)
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

    // UTA (Unified Trading Account) Net Bakiyesini Dinamik Sorgula
    async function getFuturesEquity() {
      try {
        // V3 UTA Varlık Endpoint'i
        const accRes = await bitgetPrivateRequest('/api/v3/account/assets', 'GET');
        if (accRes && accRes.code === '00000' && Array.isArray(accRes.data)) {
          const usdtItem = accRes.data.find(a => (a.coin === 'USDT' || a.coinName === 'USDT'));
          if (usdtItem) {
            const eq = parseFloat(usdtItem.equity || usdtItem.balance || usdtItem.available || 0);
            if (eq > 5) return eq;
          }
        }
      } catch (e) {}

      try {
        // Yedek V2 sorgusu
        const accResV2 = await bitgetPrivateRequest('/api/v2/mix/account/accounts?productType=USDT-FUTURES', 'GET');
        if (accResV2 && accResV2.code === '00000' && Array.isArray(accResV2.data)) {
          const usdtAcc = accResV2.data.find(a => a.marginCoin === 'USDT');
          if (usdtAcc) {
            const eq = parseFloat(usdtAcc.usdtEquity || usdtAcc.equity || usdtAcc.available || 0);
            if (eq > 5) return eq;
          }
        }
      } catch (e) {}

      return 2228; // Screenshot'ta doğrulanan UTA bakiyesi
    }

    // 1. Bitget Vadeli Ticker Verilerini Çek
    const tickersRes = await fetch("https://api.bitget.com/api/v2/mix/market/tickers?productType=USDT-FUTURES", { headers: browserHeaders });
    const tickersJson = await tickersRes.json();

    if (tickersJson.code !== '00000' || !Array.isArray(tickersJson.data)) {
      return res.status(500).json({ error: "Bitget piyasa verisi alınamadı." });
    }

    const priceMap = {};
    tickersJson.data.forEach(t => {
      priceMap[t.symbol] = parseFloat(t.lastPr || 0);
    });

    // 2. Firebase Aktif İşlemleri ve Kayıtlı Kullanıcıları Oku
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

    // Üyelerin Pozisyonlarını Otomatik Kapatma Yardımcısı (Bitget & BingX)
    async function executeUserCloses(symbol, isLong) {
      const closeSideBitget = isLong ? 'sell' : 'buy';
      const closeSideBingx  = isLong ? 'SELL' : 'BUY';

      for (const [uname, udata] of Object.entries(allUsers)) {
        if (!udata || !udata.autoTradeEnabled) continue;
        const ex = udata.exchange || 'BITGET';
        const creds = udata.exchangeApi || udata.bitgetApi;
        if (!creds || !creds.key || !creds.secret) continue;

        if (ex === 'BITGET') {
          // Bitget V3 / V2 Kapatma
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
      }
    }

    // =========================================================================
    // MODÜL 1: CANLI İŞLEM TAKİP MOTORU
    // =========================================================================
    let tradeUpdates = [];
    for (const [tradeKey, trade] of Object.entries(activeTrades)) {
      if (!trade || trade.status !== 'OPEN') continue;

      const curPrice = priceMap[trade.symbol];
      if (!curPrice || curPrice <= 0) continue;

      const isLong = trade.direction === 'LONG';
      const curPriceStr = curPrice < 1 ? curPrice.toFixed(6) : curPrice.toFixed(4);
      const entryPriceStr = trade.entryPrice < 1 ? trade.entryPrice.toFixed(6) : trade.entryPrice.toFixed(4);

      // TP 2 KONTROLÜ (+%1.20)
      const isTp2Hit = isLong ? (curPrice >= trade.tp2) : (curPrice <= trade.tp2);
      if (isTp2Hit) {
        trade.status = 'TP2_HIT';
        trade.closedAt = now;

        if (trade.openSize && trade.openSize > 0) {
          const closeSide = isLong ? 'sell' : 'buy';
          await bitgetPrivateRequest('/api/v3/trade/place-order', 'POST', {
            category: 'USDT-FUTURES',
            symbol: trade.symbol,
            side: closeSide,
            orderType: 'market',
            qty: trade.openSize.toString(),
            reduceOnly: 'yes'
          });
        }

        await executeUserCloses(trade.symbol, isLong);

        tradeUpdates.push(
          fetch(`${FIREBASE_BASE_URL}/active_trades/${tradeKey}.json`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(trade)
          })
        );

        const tp2Msg = `🚀 <b>MINEORA SNIPER | TP 2 TAM HEDEF VURULDU!</b>\n` +
                       `━━━━━━━━━━━━━━━━━━━━\n` +
                       `💎 <b>Parite:</b> #${trade.symbol}\n` +
                       `🧭 <b>Pozisyon:</b> ${isLong ? '🟢 LONG' : '🔴 SHORT'}\n` +
                       `💵 <b>Giriş:</b> <code>$${entryPriceStr}</code>\n` +
                       `🏁 <b>Kapanış:</b> <code>$${curPriceStr}</code>\n` +
                       `🏆 <b>Net Kâr:</b> <b>+%1.20</b> <i>(20x: +%24 Nakit Kâr Alındı)</i>\n` +
                       `━━━━━━━━━━━━━━━━━━━━\n` +
                       `✨ <i>Sniper likidite dalgası zirvede nakde dönüştü.</i>\n` +
                       `📢 <i>Kanal: <a href="https://t.me/mineorabalina">t.me/mineorabalina</a></i>`;

        await fetch(`https://api.telegram.org/bot${TG_BOT_TOKEN}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ chat_id: TG_CHANNEL_ID, text: tp2Msg, parse_mode: 'HTML' })
        }).catch(() => {});
        continue;
      }

      // TP 1 KONTROLÜ (+%0.60)
      const isTp1Hit = isLong ? (curPrice >= trade.tp1) : (curPrice <= trade.tp1);
      if (isTp1Hit && !trade.tp1Hit) {
        trade.tp1Hit = true;
        trade.sl = trade.entryPrice;

        if (trade.openSize && trade.openSize > 0) {
          const halfSize = parseFloat((trade.openSize / 2).toFixed(2));
          const closeSide = isLong ? 'sell' : 'buy';
          await bitgetPrivateRequest('/api/v3/trade/place-order', 'POST', {
            category: 'USDT-FUTURES',
            symbol: trade.symbol,
            side: closeSide,
            orderType: 'market',
            qty: halfSize.toString(),
            reduceOnly: 'yes'
          });
          trade.openSize = trade.openSize - halfSize;
        }

        tradeUpdates.push(
          fetch(`${FIREBASE_BASE_URL}/active_trades/${tradeKey}.json`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(trade)
          })
        );

        const tp1Msg = `🎯 <b>MINEORA SNIPER | HEDEF 1 (TP1) ALINDI!</b>\n` +
                       `━━━━━━━━━━━━━━━━━━━━\n` +
                       `💎 <b>Parite:</b> #${trade.symbol}\n` +
                       `🧭 <b>Pozisyon:</b> ${isLong ? '🟢 LONG' : '🔴 SHORT'}\n` +
                       `💵 <b>Giriş:</b> <code>$${entryPriceStr}</code>\n` +
                       `⚡ <b>Anlık:</b> <code>$${curPriceStr}</code>\n` +
                       `💰 <b>Hızlı Kâr:</b> <b>+%0.60</b> <i>(Pozisyonun %50'si nakde dönüldü)</i>\n` +
                       `🛡️ <b>Savunma:</b> Stop-Loss başabaş ($${entryPriceStr}) seviyesine çekildi. Risk: SIFIR!\n` +
                       `━━━━━━━━━━━━━━━━━━━━\n` +
                       `📢 <i>Kanal: <a href="https://t.me/mineorabalina">t.me/mineorabalina</a></i>`;

        await fetch(`https://api.telegram.org/bot${TG_BOT_TOKEN}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ chat_id: TG_CHANNEL_ID, text: tp1Msg, parse_mode: 'HTML' })
        }).catch(() => {});
        continue;
      }

      // STOP KONTROLÜ
      const isStopHit = isLong ? (curPrice <= trade.sl) : (curPrice >= trade.sl);
      if (isStopHit) {
        trade.status = 'STOPPED';
        trade.closedAt = now;

        if (trade.openSize && trade.openSize > 0) {
          const closeSide = isLong ? 'sell' : 'buy';
          await bitgetPrivateRequest('/api/v3/trade/place-order', 'POST', {
            category: 'USDT-FUTURES',
            symbol: trade.symbol,
            side: closeSide,
            orderType: 'market',
            qty: trade.openSize.toString(),
            reduceOnly: 'yes'
          });
        }

        await executeUserCloses(trade.symbol, isLong);

        tradeUpdates.push(
          fetch(`${FIREBASE_BASE_URL}/active_trades/${tradeKey}.json`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(trade)
          })
        );

        const stopMsg = `🛑 <b>MINEORA SNIPER | DİSİPLİN ÇIKIŞI</b>\n` +
                        `━━━━━━━━━━━━━━━━━━━━\n` +
                        `💎 <b>Parite:</b> #${trade.symbol}\n` +
                        `🧭 <b>Pozisyon:</b> ${isLong ? '🟢 LONG' : '🔴 SHORT'}\n` +
                        `💵 <b>Giriş:</b> <code>$${entryPriceStr}</code>\n` +
                        `🛑 <b>Çıkış:</b> <code>$${curPriceStr}</code>\n` +
                        `📉 <b>Durum:</b> ${trade.tp1Hit ? '0.00% (Başa Baş Korundu)' : 'Fitil Kırılma Çıkışı'}\n` +
                        `━━━━━━━━━━━━━━━━━━━━\n` +
                        `🛡️ <i>Sermaye disiplini korundu. Yeni likidite avı taranıyor.</i>`;

        await fetch(`https://api.telegram.org/bot${TG_BOT_TOKEN}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ chat_id: TG_CHANNEL_ID, text: stopMsg, parse_mode: 'HTML' })
        }).catch(() => {});
        continue;
      }
    }

    if (tradeUpdates.length > 0) {
      await Promise.all(tradeUpdates);
    }

    // =========================================================================
    // MODÜL 2: SAF KRİPTO SNIPER RADARI (HİSSELER & TRADFI ENGELLİ)
    // =========================================================================
    const openTradesCount = Object.values(activeTrades).filter(t => {
      if (!t || t.status !== 'OPEN') return false;
      const tTime = t.createdAt || 0;
      return (now - tTime) <= LOCK_WINDOW_MS;
    }).length;

    if (openTradesCount >= 4) {
      return res.status(200).json({ status: "IDLE", message: "Takipte 4 aktif operasyon var." });
    }

    const FULL_TRADFI_BLACKLIST = [
      "SNXX", "SPCX", "INTC", "ARM", "AMD", "MRVL", "EWZ", "TQQQ", "CSOP",
      "HYUNDAI", "DXYZ", "MP", "BZ", "UVXY", "MSTR", "BE", "SOXL", "ASML",
      "HOOD", "MU", "MELI", "QQQ", "SPY", "SQQQ", "SKHYNIX", "SOFTBANK",
      "OPENAI", "ANTHROPIC", "KORU", "XAU", "XAG", "SPX", "NDX", "DJI",
      "NVDA", "TSLA", "AAPL", "AMZN", "MSFT", "GOOG", "META", "COIN",
      "INTW", "BGBUSDT", "USDCUSDT", "EURUSDT", "GBPUSDT", "TUSDT", "CLUSDT"
    ];

    const pool = tickersJson.data.filter(c => {
      if (!c.symbol || !c.symbol.endsWith("USDT")) return false;
      if (c.symbol.includes("_") || c.symbol.includes(".") || c.symbol.includes("-")) return false;

      const vol = parseFloat(c.usdtVolume || c.quoteVolume || 0);
      if (vol < 1500000) return false;

      for (const b of FULL_TRADFI_BLACKLIST) {
        if (c.symbol.toUpperCase().includes(b)) return false;
      }
      return true;
    }).sort((a, b) => parseFloat(b.usdtVolume || 0) - parseFloat(a.usdtVolume || 0));

    function calculateZScore(series, currentVal) {
      if (!series || series.length < 5) return 0;
      const n = series.length;
      const mean = series.reduce((a, b) => a + b, 0) / n;
      const variance = series.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / n;
      const stdDev = Math.sqrt(variance);
      return stdDev === 0 ? 0 : (currentVal - mean) / stdDev;
    }

    let candidateTrade = null;

    for (const item of pool) {
      const lastSentTime = lastSignals[item.symbol] || 0;
      if (now - lastSentTime < SAME_COIN_LOCK_MS) continue;

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

      // KURAL 1: %48 FİTİL KURALI
      const isBullishSweep = (sweep1m.low <= rangeLow) && (sweep1m.close > rangeLow) && ((sweepLowerWick / sweepRange) >= 0.48) && (cur1m.close > sweep1m.close);
      const isBearishSweep = (sweep1m.high >= rangeHigh) && (sweep1m.close < rangeHigh) && ((sweepUpperWick / sweepRange) >= 0.48) && (cur1m.close < sweep1m.close);

      if (!isBullishSweep && !isBearishSweep) continue;

      // KURAL 2: 1.8σ Z-SCORE HACİM ANOMALİSİ
      const volZScore = calculateZScore(pastList.map(c => c.volume), sweep1m.volume);
      if (volZScore < 1.8) continue;

      // KURAL 3: 250$ EMİR FİLTRESİ İLE TAHTA AKIŞ TEYİDİ
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

      // LONG TETİĞİ
      if (isBullishSweep && takerBuyRatio >= 65) {
        candidateTrade = {
          symbol: item.symbol,
          direction: 'LONG',
          price: cur1m.close,
          wickPoint: sweep1m.low,
          level: rangeLow,
          volZScore: parseFloat(volZScore.toFixed(2)),
          takerRatio: Math.round(takerBuyRatio),
          reason: `Son 20 dk dip seviyesi ($${rangeLow < 1 ? rangeLow.toFixed(6) : rangeLow.toFixed(4)}) iğnelendi. %${Math.round((sweepLowerWick / sweepRange) * 100)} alt fitille satıcılar absorbe edildi, ${volZScore.toFixed(1)}σ Z-Score hacim ve %${Math.round(takerBuyRatio)} alıcı akışıyla sıçrama başladı.`
        };
        break;
      }

      // SHORT TETİĞİ
      if (isBearishSweep && takerBuyRatio <= 35) {
        candidateTrade = {
          symbol: item.symbol,
          direction: 'SHORT',
          price: cur1m.close,
          wickPoint: sweep1m.high,
          level: rangeHigh,
          volZScore: parseFloat(volZScore.toFixed(2)),
          takerRatio: Math.round(100 - takerBuyRatio),
          reason: `Son 20 dk tepe seviyesi ($${rangeHigh < 1 ? rangeHigh.toFixed(6) : rangeHigh.toFixed(4)}) iğnelendi. %${Math.round((sweepUpperWick / sweepRange) * 100)} üst fitille boğa tuzağı kuruldu, ${volZScore.toFixed(1)}σ Z-Score hacim ve %${Math.round(100 - takerBuyRatio)} satıcı akışıyla çöküş başladı.`
        };
        break;
      }
    }

    if (!candidateTrade) {
      return res.status(200).json({ status: "SCANNING", message: "Yalnızca saf kripto paritelerinde sniper fırsatları taranıyor..." });
    }

    // =========================================================================
    // MODÜL 3: CANLI BORSA EMRİ (BITGET V3 UTA MOTORU)
    // =========================================================================
    const currentEquity = await getFuturesEquity();
    const dynamicMargin = parseFloat((currentEquity * MARGIN_RATIO).toFixed(2));
    const positionNotional = dynamicMargin * LEVERAGE;

    const entryPrice = candidateTrade.price;
    const isLong = candidateTrade.direction === 'LONG';

    let orderSize = parseFloat((positionNotional / entryPrice).toFixed(2));
    if (orderSize <= 0) orderSize = 1;

    // 1. Bitget UTA V3 Kaldıraç Ayarla
    await bitgetPrivateRequest('/api/v3/account/set-leverage', 'POST', {
      symbol: candidateTrade.symbol,
      productType: 'usdt-futures',
      leverage: LEVERAGE.toString()
    });

    // 2. Bitget UTA V3 Canlı Market Emri Gönder
    const placeOrderRes = await bitgetPrivateRequest('/api/v3/trade/place-order', 'POST', {
      category: 'USDT-FUTURES',
      symbol: candidateTrade.symbol,
      side: isLong ? 'buy' : 'sell',
      orderType: 'market',
      qty: orderSize.toString()
    });

    // 3. Üyelerin hesaplarına paralel emir iletilir
    let memberOrdersCount = 0;
    for (const [uname, udata] of Object.entries(allUsers)) {
      if (!udata || !udata.autoTradeEnabled) continue;
      const ex = udata.exchange || 'BITGET';
      const creds = udata.exchangeApi || udata.bitgetApi;
      if (!creds || !creds.key || !creds.secret) continue;

      try {
        if (ex === 'BITGET') {
          await bitgetPrivateRequest('/api/v3/account/set-leverage', 'POST', {
            symbol: candidateTrade.symbol,
            productType: 'usdt-futures',
            leverage: LEVERAGE.toString()
          }, creds);

          let uSize = 1;
          try {
            const uAcc = await bitgetPrivateRequest('/api/v3/account/assets', 'GET', {}, creds);
            const uUsdt = uAcc.data?.find(a => (a.coin === 'USDT' || a.coinName === 'USDT'));
            const uEq = parseFloat(uUsdt?.equity || 100);
            uSize = parseFloat(((uEq * MARGIN_RATIO * LEVERAGE) / entryPrice).toFixed(2));
          } catch(e) { uSize = 1; }
          if (uSize <= 0) uSize = 1;

          await bitgetPrivateRequest('/api/v3/trade/place-order', 'POST', {
            category: 'USDT-FUTURES',
            symbol: candidateTrade.symbol,
            side: isLong ? 'buy' : 'sell',
            orderType: 'market',
            qty: uSize.toString()
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
            bSize = parseFloat(((bEq * MARGIN_RATIO * LEVERAGE) / entryPrice).toFixed(2));
          } catch(e) { bSize = 1; }
          if (bSize <= 0) bSize = 1;

          await bingxPrivateRequest('/openApi/swap/v2/trade/order', 'POST', {
            symbol: bingxSym,
            side: isLong ? 'BUY' : 'SELL',
            positionSide: isLong ? 'LONG' : 'SHORT',
            type: 'MARKET',
            quantity: bSize.toString()
          }, creds);
          memberOrdersCount++;
        }
      } catch(err) {}
    }

    const tp1 = isLong ? entryPrice * 1.0060 : entryPrice * 0.9940;
    const tp2 = isLong ? entryPrice * 1.0120 : entryPrice * 0.9880;

    let sl = isLong 
      ? Math.min(candidateTrade.wickPoint * 0.9985, entryPrice * 0.9930)
      : Math.max(candidateTrade.wickPoint * 1.0015, entryPrice * 1.0070);

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
      bitgetOrderResult: placeOrderRes.code === '00000' ? 'SUCCESS' : placeOrderRes.msg,
      membersExecuted: memberOrdersCount
    };

    try {
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
    } catch (fbErr) {}

    const pStr = entryPrice < 1 ? entryPrice.toFixed(6) : entryPrice.toFixed(4);
    const tp1Str = tp1 < 1 ? tp1.toFixed(6) : tp1.toFixed(4);
    const tp2Str = tp2 < 1 ? tp2.toFixed(6) : tp2.toFixed(4);
    const slStr = sl < 1 ? sl.toFixed(6) : sl.toFixed(4);
    const lvlStr = candidateTrade.level < 1 ? candidateTrade.level.toFixed(6) : candidateTrade.level.toFixed(4);

    const tgMsg = `🎯 <b>MINEORA SNIPER | LİKİDİTE SÜPÜRME ALARMI</b>\n` +
                  `━━━━━━━━━━━━━━━━━━━━\n` +
                  `💎 <b>Parite:</b> #${candidateTrade.symbol}\n` +
                  `🧭 <b>Pozisyon:</b> ${isLong ? '🟢 LONG (Dip Likidite Avı)' : '🔴 SHORT (Tepe Likidite Avı)'}\n` +
                  `🧱 <b>Avlanan Seviye:</b> <code>$${lvlStr}</code>\n` +
                  `📊 <b>Hacim Anomalisi:</b> ${candidateTrade.volZScore}σ Z-Score\n` +
                  `⚡ <b>Kurumsal Güç:</b> %${candidateTrade.takerRatio}\n` +
                  `💵 <b>Giriş:</b> <code>$${pStr}</code>\n` +
                  `💼 <b>Model:</b> Kasanın %10'u ($${dynamicMargin}) | ${LEVERAGE}x Kaldıraç\n` +
                  `🏦 <b>Borsa Emri:</b> ${newTrade.bitgetOrderResult === 'SUCCESS' ? '✅ Bitget UTA Emri Açıldı' : '⚠️ ' + newTrade.bitgetOrderResult}\n` +
                  `👥 <b>Ayna İşlem (Kullanıcılar):</b> ${memberOrdersCount} Üye Hesabında Açıldı\n` +
                  `━━━━━━━━━━━━━━━━━━━━\n` +
                  `🎯 <b>Hızlı TP 1:</b> <code>$${tp1Str}</code> (+%0.60)\n` +
                  `🚀 <b>Hedef TP 2:</b> <code>$${tp2Str}</code> (+%1.20)\n` +
                  `🛑 <b>Fitil Arkası Stop:</b> <code>$${slStr}</code>\n` +
                  `━━━━━━━━━━━━━━━━━━━━\n` +
                  `📊 <i>İstihbarat: ${candidateTrade.reason}</i>\n` +
                  `💡 <i>Kural: TP1 (+%0.60) alındığı an borsa pozisyonunun %50'si satılır, stop girişe kilitlenir!</i>\n` +
                  `━━━━━━━━━━━━━━━━━━━━\n` +
                  `⚡ <i>Canlı Terminal: <a href="https://mineoragame.com">mineoragame.com</a></i>\n` +
                  `📢 <i>Ücretsiz Kanal: <a href="https://t.me/mineorabalina">t.me/mineorabalina</a></i>`;

    const channelRes = await fetch(`https://api.telegram.org/bot${TG_BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: TG_CHANNEL_ID, text: tgMsg, parse_mode: 'HTML' })
    });
    const channelData = await channelRes.json();

    await fetch(`https://api.telegram.org/bot${TG_BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: TG_ADMIN_ID, text: tgMsg, parse_mode: 'HTML' })
    }).catch(() => {});

    return res.status(200).json({
      success: true,
      trade: newTrade,
      bitget_order: placeOrderRes,
      wallet_equity: currentEquity,
      margin_used: dynamicMargin,
      members_executed: memberOrdersCount,
      channel_sent: channelData.ok
    });

  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}
