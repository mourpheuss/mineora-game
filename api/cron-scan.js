import crypto from 'crypto';

export default async function handler(req, res) {
  try {
    const browserHeaders = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
      'Accept': 'application/json'
    };

    // =========================================================================
    // 0. BİTGET API VE TELEGRAM YAPILANDIRMASI
    // =========================================================================
    const ADMIN_API_KEY = "bg_f73437198f37d20e56939b82041041d0";
    const ADMIN_SECRET = "fe44b9c347eb5d9dd0e624876809102bb3ec8bab9481ad7bdb5ddf4d8d332ecd";
    const ADMIN_PASSPHRASE = "Ers4834754";
    const BITGET_BASE_URL = 'https://api.bitget.com';

    const TG_BOT_TOKEN = "8682225307:AAHaa-hieKBBluU6uZ2_-OgSPxGR7OwMssE";
    const TG_CHANNEL_ID = "-1004404988937";
    const TG_ADMIN_ID = "6457294906";
    const FIREBASE_BASE_URL = "https://mineora-web-default-rtdb.firebaseio.com";
    
    const LOCK_WINDOW_MS = 25 * 60 * 1000;      // 25 dk canlı takip penceresi
    const SAME_COIN_LOCK_MS = 20 * 60 * 1000;   // Aynı coine 20 dk tekrar giriş yasağı
    const LEVERAGE = 20;                        // 20x Kaldıraç
    const MARGIN_RATIO = 0.10;                  // KASANIN %10'U
    const now = Date.now();

    // Bitget V2 İmzalı İstek Motoru
    async function bitgetPrivateRequest(endpoint, method = 'POST', bodyObj = {}) {
      const timestamp = Date.now().toString();
      const bodyStr = method === 'GET' ? '' : JSON.stringify(bodyObj);
      const message = timestamp + method + endpoint + bodyStr;
      const signature = crypto.createHmac('sha256', ADMIN_SECRET).update(message).digest('base64');

      const headers = {
        'ACCESS-KEY': ADMIN_API_KEY,
        'ACCESS-SIGN': signature,
        'ACCESS-TIMESTAMP': timestamp,
        'ACCESS-PASSPHRASE': ADMIN_PASSPHRASE,
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

    // Vadeli Cüzdan Net Bakiyesini Dinamik Sorgula
    async function getFuturesEquity() {
      try {
        const accRes = await bitgetPrivateRequest('/api/v2/mix/account/accounts?productType=USDT-FUTURES', 'GET');
        if (accRes && accRes.code === '00000' && Array.isArray(accRes.data)) {
          const usdtAcc = accRes.data.find(a => a.marginCoin === 'USDT');
          if (usdtAcc) {
            const eq = parseFloat(usdtAcc.usdtEquity || usdtAcc.equity || usdtAcc.available || 0);
            if (eq > 10) return eq;
          }
        }
      } catch (e) {}
      return 2000; // API yanıt vermezse varsayılan güvenlik tabanı: 2.000$
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

    // 2. Firebase Aktif İşlemleri Oku
    let activeTrades = {};
    let lastSignals = {};
    try {
      const [atRes, lsRes] = await Promise.all([
        fetch(`${FIREBASE_BASE_URL}/active_trades.json`),
        fetch(`${FIREBASE_BASE_URL}/last_signals.json`)
      ]);
      activeTrades = (await atRes.json()) || {};
      lastSignals = (await lsRes.json()) || {};
    } catch (e) {
      activeTrades = {};
      lastSignals = {};
    }

    // =========================================================================
    // MODÜL 1: CANLI İŞLEM TAKİP MOTORU (TP1: +%0.60 | TP2: +%1.20)
    // =========================================================================
    let tradeUpdates = [];
    for (const [tradeKey, trade] of Object.entries(activeTrades)) {
      if (!trade || trade.status !== 'OPEN') continue;

      const curPrice = priceMap[trade.symbol];
      if (!curPrice || curPrice <= 0) continue;

      const isLong = trade.direction === 'LONG';
      const curPriceStr = curPrice < 1 ? curPrice.toFixed(6) : curPrice.toFixed(4);
      const entryPriceStr = trade.entryPrice < 1 ? trade.entryPrice.toFixed(6) : trade.entryPrice.toFixed(4);

      // TP 2 KONTROLÜ (+%1.20) -> KALAN POZİSYONU BORSADA TAM KAPAT
      const isTp2Hit = isLong ? (curPrice >= trade.tp2) : (curPrice <= trade.tp2);
      if (isTp2Hit) {
        trade.status = 'TP2_HIT';
        trade.closedAt = now;

        if (trade.openSize && trade.openSize > 0) {
          const closeSide = isLong ? 'sell' : 'buy';
          await bitgetPrivateRequest('/api/v2/mix/order/place-order', 'POST', {
            symbol: trade.symbol,
            productType: 'USDT-FUTURES',
            marginMode: 'crossed',
            marginCoin: 'USDT',
            size: trade.openSize.toString(),
            side: closeSide,
            orderType: 'market',
            reduceOnly: 'YES'
          });
        }

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

      // TP 1 KONTROLÜ (+%0.60) -> %50 KÂR AL & STOP'U GİRİŞE KİLİTLE
      const isTp1Hit = isLong ? (curPrice >= trade.tp1) : (curPrice <= trade.tp1);
      if (isTp1Hit && !trade.tp1Hit) {
        trade.tp1Hit = true;
        trade.sl = trade.entryPrice;

        if (trade.openSize && trade.openSize > 0) {
          const halfSize = parseFloat((trade.openSize / 2).toFixed(2));
          const closeSide = isLong ? 'sell' : 'buy';
          await bitgetPrivateRequest('/api/v2/mix/order/place-order', 'POST', {
            symbol: trade.symbol,
            productType: 'USDT-FUTURES',
            marginMode: 'crossed',
            marginCoin: 'USDT',
            size: halfSize.toString(),
            side: closeSide,
            orderType: 'market',
            reduceOnly: 'YES'
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

      // STOP KONTROLÜ -> POZİSYONU BORSADA BOŞALT
      const isStopHit = isLong ? (curPrice <= trade.sl) : (curPrice >= trade.sl);
      if (isStopHit) {
        trade.status = 'STOPPED';
        trade.closedAt = now;

        if (trade.openSize && trade.openSize > 0) {
          const closeSide = isLong ? 'sell' : 'buy';
          await bitgetPrivateRequest('/api/v2/mix/order/place-order', 'POST', {
            symbol: trade.symbol,
            productType: 'USDT-FUTURES',
            marginMode: 'crossed',
            marginCoin: 'USDT',
            size: trade.openSize.toString(),
            side: closeSide,
            orderType: 'market',
            reduceOnly: 'YES'
          });
        }

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
    // MODÜL 2: SNIPER LİKİDİTE AVI (MAX 4 İŞLEM & ARINDIRILMIŞ HAVUZ)
    // =========================================================================
    const openTradesCount = Object.values(activeTrades).filter(t => {
      if (!t || t.status !== 'OPEN') return false;
      const tTime = t.createdAt || 0;
      return (now - tTime) <= LOCK_WINDOW_MS;
    }).length;

    if (openTradesCount >= 4) {
      return res.status(200).json({ status: "IDLE", message: "Takipte 4 aktif operasyon var." });
    }

    // Gece stop ettiren hisseler + manipülatif sığ pariteler
    const TRADFI_AND_JUNK_BLACKLIST = [
      "OPENAI", "ANTHROPIC", "KORU", "XAU", "XAG", "SPX", "NDX", "DJI",
      "NVDA", "TSLA", "AAPL", "AMZN", "MSFT", "GOOG", "META", "COIN",
      "AMD", "MRVL", "TQQQ", "INTW", "CSOP", "HYUNDAI", "SKHYNIX",
      "BGBUSDT", "USDCUSDT", "EURUSDT", "GBPUSDT", "TUSDT", "CLUSDT",
      "DOOD", "CAP", "ERA", "ICNT", "APR", "MP", "XP", "CRCL"
    ];

    // Geceki 1.500.000$ hacim tabanı
    const pool = tickersJson.data.filter(c => {
      if (!c.symbol.endsWith("USDT")) return false;
      const vol = parseFloat(c.usdtVolume || c.quoteVolume || 0);
      if (vol < 1500000) return false;

      for (const b of TRADFI_AND_JUNK_BLACKLIST) {
        if (c.symbol.includes(b)) return false;
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

      // 1 DAKİKALIK MUMLAR (Son 25 Mum)
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

      // KURAL 1: GECEKİ ORJİNAL %48 FİTİL KURALI
      const isBullishSweep = (sweep1m.low <= rangeLow) && (sweep1m.close > rangeLow) && ((sweepLowerWick / sweepRange) >= 0.48) && (cur1m.close > sweep1m.close);
      const isBearishSweep = (sweep1m.high >= rangeHigh) && (sweep1m.close < rangeHigh) && ((sweepUpperWick / sweepRange) >= 0.48) && (cur1m.close < sweep1m.close);

      if (!isBullishSweep && !isBearishSweep) continue;

      // KURAL 2: GECEKİ 1.8σ Z-SCORE HACİM ANOMALİSİ
      const volZScore = calculateZScore(pastList.map(c => c.volume), sweep1m.volume);
      if (volZScore < 1.8) continue;

      // KURAL 3: GECEKİ 250$ EMİR FİLTRESİ İLE TAHTA AKIŞ TEYİDİ
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
          wickPoint: sweep1m.low,
          level: rangeLow,
          volZScore: parseFloat(volZScore.toFixed(2)),
          takerRatio: Math.round(takerBuyRatio),
          reason: `Son 20 dk dip seviyesi ($${rangeLow < 1 ? rangeLow.toFixed(6) : rangeLow.toFixed(4)}) iğnelendi. %${Math.round((sweepLowerWick / sweepRange) * 100)} alt fitille satıcılar absorbe edildi, ${volZScore.toFixed(1)}σ Z-Score hacim ve %${Math.round(takerBuyRatio)} alıcı akışıyla sıçrama başladı.`
        };
        break;
      }

      // SHORT TETİĞİ (%35 Teyit)
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
      return res.status(200).json({ status: "SCANNING", message: "Likidite süpürmeleri ve kurumsal ret mumları taranıyor..." });
    }

    // =========================================================================
    // MODÜL 3: CANLI BORSA EMRİ (KASANIN O ANKİ %10'U & 20X)
    // =========================================================================
    const currentEquity = await getFuturesEquity();
    const dynamicMargin = parseFloat((currentEquity * MARGIN_RATIO).toFixed(2)); // Net %10
    const positionNotional = dynamicMargin * LEVERAGE;                           // 20x Kaldıraçlı Hacim

    const entryPrice = candidateTrade.price;
    const isLong = candidateTrade.direction === 'LONG';

    // Kontrat adedini hesapla
    let orderSize = parseFloat((positionNotional / entryPrice).toFixed(2));
    if (orderSize <= 0) orderSize = 1;

    // 1. Kaldıracı 20x'e ayarla
    await bitgetPrivateRequest('/api/v2/mix/account/set-leverage', 'POST', {
      symbol: candidateTrade.symbol,
      productType: 'USDT-FUTURES',
      marginCoin: 'USDT',
      leverage: LEVERAGE.toString()
    });

    // 2. Canlı emri borsaya gönder
    const placeOrderRes = await bitgetPrivateRequest('/api/v2/mix/order/place-order', 'POST', {
      symbol: candidateTrade.symbol,
      productType: 'USDT-FUTURES',
      marginMode: 'crossed',
      marginCoin: 'USDT',
      size: orderSize.toString(),
      side: isLong ? 'buy' : 'sell',
      orderType: 'market'
    });

    // Hedefler ve Stop
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
      bitgetOrderResult: placeOrderRes.code === '00000' ? 'SUCCESS' : placeOrderRes.msg
    };

    // Firebase Kayıtları
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

    // Telegram VIP Bildirimi
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
                  `🏦 <b>Borsa Emri:</b> ${newTrade.bitgetOrderResult === 'SUCCESS' ? '✅ Bitget Emri Açıldı' : '⚠️ ' + newTrade.bitgetOrderResult}\n` +
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
      channel_sent: channelData.ok
    });

  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}
