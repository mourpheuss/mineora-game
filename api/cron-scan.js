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
    const FIREBASE_BASE_URL = "https://mineora-web-default-rtdb.firebaseio.com";
    
    const LOCK_WINDOW_MS = 25 * 60 * 1000;
    const SAME_COIN_LOCK_MS = 20 * 60 * 1000;
    const LEVERAGE = 20;
    const MARGIN_RATIO = 0.05; // Kasanın kesinlikle %5'i
    const now = Date.now();

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

    // Pozisyonu Tamamen Kapatma Fonksiyonu
    async function closeBitgetPosition(symbol, isLong) {
      const closeSide = isLong ? 'sell' : 'buy';
      let qty = "1";

      try {
        const posRes = await bitgetPrivateRequest(`/api/v3/position/current-position?category=USDT-FUTURES&symbol=${symbol}`, 'GET');
        if (posRes.code === '00000' && Array.isArray(posRes.data) && posRes.data.length > 0) {
          const actualQty = parseFloat(posRes.data[0].total || posRes.data[0].available || 0);
          if (actualQty > 0) qty = actualQty.toString();
        }
      } catch (e) {}

      return await bitgetPrivateRequest('/api/v3/trade/place-order', 'POST', {
        category: 'USDT-FUTURES',
        symbol: symbol,
        side: closeSide,
        orderType: 'market',
        qty: qty,
        reduceOnly: 'yes'
      });
    }

    // CANLI KASA BAKİYESİNİ KESİN OKUMA MOTORU (UTA V3 + V2 ÇİFT YÖNTEM)
    async function getFuturesEquity() {
      // 1. Yol: Bitget V2 USDT-Futures Hesabı (UTA modunda en stabil bakiye kaynağı)
      try {
        const accResV2 = await bitgetPrivateRequest('/api/v2/mix/account/accounts?productType=USDT-FUTURES', 'GET');
        if (accResV2 && accResV2.code === '00000' && Array.isArray(accResV2.data)) {
          const usdtAcc = accResV2.data.find(a => (a.marginCoin === 'USDT' || a.coin === 'USDT'));
          if (usdtAcc) {
            const eq = parseFloat(usdtAcc.usdtEquity || usdtAcc.equity || usdtAcc.available || usdtAcc.maxTransferOut || 0);
            if (eq > 5) return eq;
          }
        }
      } catch (e) {}

      // 2. Yol: Bitget V3 Asset Listesi
      try {
        const accResV3 = await bitgetPrivateRequest('/api/v3/account/assets', 'GET');
        if (accResV3 && accResV3.code === '00000' && Array.isArray(accResV3.data)) {
          const usdtItem = accResV3.data.find(a => (a.coin === 'USDT' || a.coinName === 'USDT'));
          if (usdtItem) {
            const eq = parseFloat(usdtItem.equity || usdtItem.balance || usdtItem.available || 0);
            if (eq > 5) return eq;
          }
        }
      } catch (e) {}

      // 3. Yol: Tekil USDT V3 sorgusu
      try {
        const singleV3 = await bitgetPrivateRequest('/api/v3/account/assets?coin=USDT', 'GET');
        if (singleV3 && singleV3.code === '00000' && Array.isArray(singleV3.data) && singleV3.data.length > 0) {
          const eq = parseFloat(singleV3.data[0].equity || singleV3.data[0].available || singleV3.data[0].balance || 0);
          if (eq > 5) return eq;
        }
      } catch (e) {}

      // Hiçbir bakiye okunamazsa işlem büyüklüğünü minimumda tutmak için güvenli 100$ taban alınır
      return 100;
    }

    // 1. Bitget Vadeli Ticker Verilerini ve Spot Onaylı Listesini Çek
    const [tickersRes, spotSymbolsRes] = await Promise.all([
      fetch("https://api.bitget.com/api/v2/mix/market/tickers?productType=USDT-FUTURES", { headers: browserHeaders }),
      fetch("https://api.bitget.com/api/v2/spot/public/symbols", { headers: browserHeaders }).catch(() => null)
    ]);

    const tickersJson = await tickersRes.json();
    if (tickersJson.code !== '00000' || !Array.isArray(tickersJson.data)) {
      return res.status(500).json({ error: "Bitget piyasa verisi alınamadı." });
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
    tickersJson.data.forEach(t => {
      priceMap[t.symbol] = parseFloat(t.lastPr || 0);
    });

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
    // MODÜL 1: TP1, TP2 VE STOP KONTROLÜ + ANLIK TELEGRAM BİLDİRİMLERİ
    // =========================================================================
    for (const [tradeKey, trade] of Object.entries(activeTrades)) {
      if (!trade || trade.status !== 'OPEN') continue;

      const curPrice = priceMap[trade.symbol];
      if (!curPrice || curPrice <= 0) continue;

      const isLong = trade.direction === 'LONG';
      const isTp1Hit = isLong ? (curPrice >= trade.tp1) : (curPrice <= trade.tp1);
      const isTp2Hit = isLong ? (curPrice >= trade.tp2) : (curPrice <= trade.tp2);
      const isStopHit = isLong ? (curPrice <= trade.sl) : (curPrice >= trade.sl);

      const pCurStr = curPrice < 1 ? curPrice.toFixed(6) : curPrice.toFixed(4);
      const pEntryStr = trade.entryPrice < 1 ? trade.entryPrice.toFixed(6) : trade.entryPrice.toFixed(4);

      // 1. TP2 TAM HEDEF VURULDU
      if (isTp2Hit) {
        trade.status = 'TP2_HIT';
        trade.closedAt = now;
        await closeBitgetPosition(trade.symbol, isLong);

        const tgTp2Msg = `🚀 <b>MINEORA SNIPER | TP 2 HEDEF VURULDU!</b>\n` +
                         `━━━━━━━━━━━━━━━━━━━━\n` +
                         `💎 <b>Parite:</b> #${trade.symbol}\n` +
                         `🧭 <b>Yön:</b> ${trade.direction}\n` +
                         `💵 <b>Giriş:</b> <code>$${pEntryStr}</code>\n` +
                         `🎯 <b>Kapanış:</b> <code>$${pCurStr}</code>\n` +
                         `💰 <b>Net Kazanç:</b> +%1.20 (20x ile <b>+%24.0 KÂR</b>)\n` +
                         `✅ <i>Pozisyon maksimum kârla tamamen kapatıldı.</i>`;

        await fetch(`https://api.telegram.org/bot${TG_BOT_TOKEN}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ chat_id: TG_CHANNEL_ID, text: tgTp2Msg, parse_mode: 'HTML' })
        }).catch(() => {});

        await fetch(`${FIREBASE_BASE_URL}/active_trades/${tradeKey}.json`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(trade)
        });
        continue;
      }

      // 2. STOP SEVİYESİ VURULDU
      if (isStopHit) {
        trade.status = 'STOPPED';
        trade.closedAt = now;
        await closeBitgetPosition(trade.symbol, isLong);

        const isBreakEven = trade.tp1Hit;
        const tgStopMsg = isBreakEven
          ? `🛡️ <b>MINEORA SNIPER | BAŞABAŞ STOP (RİSKSİZ ÇIKIŞ)</b>\n` +
            `━━━━━━━━━━━━━━━━━━━━\n` +
            `💎 <b>Parite:</b> #${trade.symbol}\n` +
            `💵 <b>Giriş / Stop Fiyatı:</b> <code>$${pEntryStr}</code>\n` +
            `ℹ️ <i>TP1'de kâr kilitlenmişti; kalan kısım giriş seviyesinde 0 zararla kapatıldı.</i>`
          : `🛑 <b>MINEORA SNIPER | STOP LOSS ÇALIŞTI</b>\n` +
            `━━━━━━━━━━━━━━━━━━━━\n` +
            `💎 <b>Parite:</b> #${trade.symbol}\n` +
            `💵 <b>Kapanış:</b> <code>$${pCurStr}</code>\n` +
            `⚠️ <i>Fitil arkası koruma devreye girdi, pozisyon disiplinle kesildi.</i>`;

        await fetch(`https://api.telegram.org/bot${TG_BOT_TOKEN}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ chat_id: TG_CHANNEL_ID, text: tgStopMsg, parse_mode: 'HTML' })
        }).catch(() => {});

        await fetch(`${FIREBASE_BASE_URL}/active_trades/${tradeKey}.json`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(trade)
        });
        continue;
      }

      // 3. TP1 VURULDUĞUNDA (%50 KÂR AL & STOPU GİRİŞE TAŞI)
      if (isTp1Hit && !trade.tp1Hit) {
        trade.tp1Hit = true;
        trade.sl = trade.entryPrice;

        // Pozisyonun %50'sini Canlı Borsada Kapat
        try {
          const closeSide = isLong ? 'sell' : 'buy';
          let halfQty = Math.floor(parseFloat(trade.openSize || 1) / 2);
          if (halfQty <= 0) halfQty = 1;

          await bitgetPrivateRequest('/api/v3/trade/place-order', 'POST', {
            category: 'USDT-FUTURES',
            symbol: trade.symbol,
            side: closeSide,
            orderType: 'market',
            qty: halfQty.toString(),
            reduceOnly: 'yes'
          });
        } catch (e) {}

        // Kalan Kısmın Borsa Stopunu Doğrudan Girişe Taşı
        await bitgetPrivateRequest('/api/v3/trade/set-tpsl', 'POST', {
          category: 'USDT-FUTURES',
          symbol: trade.symbol,
          planType: 'pos_loss',
          triggerPrice: trade.entryPrice.toString(),
          triggerType: 'mark_price',
          holdSide: isLong ? 'long' : 'short'
        }).catch(() => {});

        // Telegram Bildirimi Gönder
        const tgTp1Msg = `🎯 <b>MINEORA SNIPER | TP 1 ALINDI (%50 KÂR KİLİTLENDİ)</b>\n` +
                         `━━━━━━━━━━━━━━━━━━━━\n` +
                         `💎 <b>Parite:</b> #${trade.symbol}\n` +
                         `💰 <b>Kâr:</b> +%0.60 (20x ile <b>+%12.0 Net</b>)\n` +
                         `🛡️ <b>Emniyet:</b> Pozisyonun %50'si nakde çevrildi, stop seviyesi <code>$${pEntryStr}</code> (Giriş) seviyesine çekildi. Risk sıfırlandı!`;

        await fetch(`https://api.telegram.org/bot${TG_BOT_TOKEN}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ chat_id: TG_CHANNEL_ID, text: tgTp1Msg, parse_mode: 'HTML' })
        }).catch(() => {});

        await fetch(`${FIREBASE_BASE_URL}/active_trades/${tradeKey}.json`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(trade)
        });
      }
    }
    

    // =========================================================================
    // MODÜL 2: SAF KRİPTO RADARI (FOREX, XAU VE HİSSE ENGELLİ)
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

    const pool = tickersJson.data.filter(c => {
      if (!c.symbol || !c.symbol.endsWith("USDT")) return false;
      if (c.symbol.includes("_") || c.symbol.includes(".") || c.symbol.includes("-")) return false;

      const symUpper = c.symbol.toUpperCase();
      for (const fx of FOREX_AND_FIAT) if (symUpper.includes(fx)) return false;
      for (const st of STOCKS_BLACKLIST) if (symUpper.includes(st)) return false;
      if (genuineSpotCryptoSet.size > 0 && !genuineSpotCryptoSet.has(c.symbol)) return false;

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

    let candidateTrade = null;

    for (const item of pool) {
      const lastSentTime = lastSignals[item.symbol] || 0;
      if (now - lastSentTime < SAME_COIN_LOCK_MS) continue;

      const candles1mRes = await fetch(`https://api.bitget.com/api/v2/mix/market/candles?symbol=${item.symbol}&productType=USDT-FUTURES&granularity=1m&limit=25`, { headers: browserHeaders })
        .then(r => r.json()).catch(() => ({}));

      if (candles1mRes.code !== '00000' || !Array.isArray(candles1mRes.data) || candles1mRes.data.length < 20) continue;

      const candles1m = candles1mRes.data.map(c => ({
        time: Number(c[0]),
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

      const isBullishSweep = (sweep1m.low <= rangeLow) && (sweep1m.close > rangeLow) && ((sweepLowerWick / sweepRange) >= 0.48) && (cur1m.close > sweep1m.close);
      const isBearishSweep = (sweep1m.high >= rangeHigh) && (sweep1m.close < rangeHigh) && ((sweepUpperWick / sweepRange) >= 0.48) && (cur1m.close < sweep1m.close);

      if (!isBullishSweep && !isBearishSweep) continue;

      const volZScore = calculateZScore(pastList.map(c => c.volume), sweep1m.volume);
      if (volZScore < 1.8) continue;

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
      return res.status(200).json({ status: "SCANNING", message: "Yalnızca Bitget onaylı saf kripto paritelerinde sniper fırsatları taranıyor..." });
    }

    // =========================================================================
    // MODÜL 3: CANLI BORSA EMRİ & FULL POZİSYON TP/SL KİLİTLEME
    // =========================================================================
    const currentEquity = await getFuturesEquity();
    const dynamicMargin = parseFloat((currentEquity * MARGIN_RATIO).toFixed(2)); // Kasada ne varsa net %5'i
    
    // Kaldıraç ayarla
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

    let orderSize = parseFloat((positionNotional / entryPrice).toFixed(0));
    if (orderSize <= 0) orderSize = 1;

    const tp1 = isLong ? entryPrice * 1.0060 : entryPrice * 0.9940;
    const tp2 = isLong ? entryPrice * 1.0120 : entryPrice * 0.9880;

    let sl = isLong 
      ? Math.min(candidateTrade.wickPoint * 0.9985, entryPrice * 0.9930)
      : Math.max(candidateTrade.wickPoint * 1.0015, entryPrice * 1.0070);

    const precision = entryPrice < 0.1 ? 6 : 4;
    const tp2Formatted = tp2.toFixed(precision);
    const slFormatted = sl.toFixed(precision);

    // 1. Ana Piyasa Giriş Emri
    const placeOrderRes = await bitgetPrivateRequest('/api/v3/trade/place-order', 'POST', {
      category: 'USDT-FUTURES',
      symbol: candidateTrade.symbol,
      side: isLong ? 'buy' : 'sell',
      orderType: 'market',
      qty: orderSize.toString()
    });

    let stopResult = 'SKIPPED';
    let tpResult = 'SKIPPED';

    // 2. BORSA POZİSYONUNA DOĞRUDAN FULL TP/SL ÇAKMA (Ekranda Full position TP/SL doldurulur)
    if (placeOrderRes.code === '00000') {
      // Pozisyon Stop Loss
      const slRes = await bitgetPrivateRequest('/api/v3/trade/set-tpsl', 'POST', {
        category: 'USDT-FUTURES',
        symbol: candidateTrade.symbol,
        planType: 'pos_loss',
        triggerPrice: slFormatted,
        triggerType: 'mark_price',
        holdSide: isLong ? 'long' : 'short'
      });
      stopResult = slRes.code === '00000' ? 'SUCCESS' : slRes.msg;

      // Pozisyon Take Profit (TP2)
      const tpRes = await bitgetPrivateRequest('/api/v3/trade/set-tpsl', 'POST', {
        category: 'USDT-FUTURES',
        symbol: candidateTrade.symbol,
        planType: 'pos_profit',
        triggerPrice: tp2Formatted,
        triggerType: 'mark_price',
        holdSide: isLong ? 'long' : 'short'
      });
      tpResult = tpRes.code === '00000' ? 'SUCCESS' : tpRes.msg;
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
      bitgetOrderResult: placeOrderRes.code === '00000' ? 'SUCCESS' : placeOrderRes.msg,
      stopResult: stopResult,
      tpResult: tpResult
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

    const pStr = entryPrice < 1 ? entryPrice.toFixed(6) : entryPrice.toFixed(4);
    const tp1Str = tp1 < 1 ? tp1.toFixed(6) : tp1.toFixed(4);
    const tp2Str = tp2 < 1 ? tp2.toFixed(6) : tp2.toFixed(4);
    const slStr = sl < 1 ? sl.toFixed(6) : sl.toFixed(4);

    const tgMsg = `🎯 <b>MINEORA SNIPER | BORSA KORUMALI İŞLEM AÇILDI</b>\n` +
                  `━━━━━━━━━━━━━━━━━━━━\n` +
                  `💎 <b>Parite:</b> #${candidateTrade.symbol}\n` +
                  `🧭 <b>Yön:</b> ${isLong ? '🟢 LONG' : '🔴 SHORT'}\n` +
                  `💵 <b>Giriş:</b> <code>$${pStr}</code>\n` +
                  `💼 <b>Model:</b> Kasanın %5'i ($${dynamicMargin}) | ${LEVERAGE}x Kaldıraç\n` +
                  `🏦 <b>Borsa Emri:</b> ${newTrade.bitgetOrderResult === 'SUCCESS' ? '✅ Pozisyon Açıldı' : '⚠️ ' + newTrade.bitgetOrderResult}\n` +
                  `🛑 <b>Full Stop Loss:</b> ${stopResult === 'SUCCESS' ? '✅ Borsaya İşlendi' : '⚠️ ' + stopResult}\n` +
                  `🚀 <b>Full Take Profit:</b> ${tpResult === 'SUCCESS' ? '✅ Borsaya İşlendi' : '⚠️ ' + tpResult}\n` +
                  `━━━━━━━━━━━━━━━━━━━━\n` +
                  `🎯 <b>Ara Kâr (TP 1):</b> <code>$${tp1Str}</code> (+%0.60 | %50 Kapanır)\n` +
                  `🚀 <b>Hedef (TP 2):</b> <code>$${tp2Str}</code> (+%1.20 | Kalan %50)\n` +
                  `🛑 <b>Fitil Stop:</b> <code>$${slStr}</code>\n` +
                  `━━━━━━━━━━━━━━━━━━━━\n` +
                  `🛡️ <i>TP/SL doğrudan Bitget Full Position TP/SL tablosuna mühürlenmiştir.</i>`;

    await fetch(`https://api.telegram.org/bot${TG_BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: TG_CHANNEL_ID, text: tgMsg, parse_mode: 'HTML' })
    }).catch(() => {});

    return res.status(200).json({
      success: true,
      trade: newTrade,
      bitget_order: placeOrderRes,
      stop_result: stopResult,
      tp_result: tpResult
    });

  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}
