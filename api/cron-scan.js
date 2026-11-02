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
    
    // YÖNETİM PARAMETRELERİ (GÜVENLİ VE BİLEŞİK BÜYÜME)
    const LOCK_WINDOW_MS = 25 * 60 * 1000;
    const SAME_COIN_LOCK_MS = 15 * 60 * 1000;
    const POST_STOP_COOLDOWN_MS = 25 * 60 * 1000;
    const LEVERAGE = 15;                            // 15x KALDIRAÇ
    const MARGIN_RATIO = 0.05;                      // KASANIN %5'İ (GÜVENLİ RİSK)
    const DOYMA_TP_PCT = 0.55;                      // BORSAYA MÜHÜRLÜ KESİN DOYMA TP'Sİ (+%0.55)
    const MIN_SL_PCT = 0.65;                        // GÜRÜLTÜDEN KORUYAN MİNİMUM STOP (-%0.65)
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

    // 1. Bitget Vadeli Ticker ve Kontrat Bilgilerini Çek
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
    // MODÜL 1: CANLI İŞLEM TAKİBİ & ERKEN KÂR KORUMASI
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

      const currentPnlPct = isLong 
        ? ((curPrice - trade.entryPrice) / trade.entryPrice * 100)
        : ((trade.entryPrice - curPrice) / trade.entryPrice * 100);

      const prevMaxPnl = trade.maxPnlPct || 0;
      const peakPnl = Math.max(prevMaxPnl, currentPnlPct);
      trade.maxPnlPct = parseFloat(peakPnl.toFixed(2));

      const openMinutes = (now - (trade.createdAt || now)) / (60 * 1000);
      let dynamicExitReason = null;

      // 1. ZAMAN AŞIMI ÇIKIŞI (4 Dakika Kuralı):
      // Fiyat 4 dakikadır açık ve kârda oyalanıyorsa (+%0.30), beklemeden çık!
      if (openMinutes >= 4.0 && currentPnlPct >= 0.30) {
        dynamicExitReason = `4 dk zaman aşımı. Hareket doydu, +%${currentPnlPct.toFixed(2)} ile kilitlendi.`;
      }
      // 2. ZİRVEDEN GERİ ÇEKİLME:
      // Fiyat +%0.45 gördükten sonra %0.12 gevşerse anında piyasa emriyle kapat!
      else if (peakPnl >= 0.45 && currentPnlPct <= (peakPnl - 0.12)) {
        dynamicExitReason = `Zirveden (%+${peakPnl}) geri çekilme görüldü. Net %+${currentPnlPct.toFixed(2)} ile kapatıldı.`;
      }
      // 3. ERKEN BREAKEVEN:
      // Fiyat +%0.35 gördüyse maliyete yaklaşınca (+%0.06) sıfır zararla kapat!
      else if (peakPnl >= 0.35 && currentPnlPct <= 0.06) {
        dynamicExitReason = `+%${peakPnl} kâr sonrası giriş seviyesine geri çekilme. Zarar engellendi.`;
      }

      if (dynamicExitReason) {
        trade.status = 'DYNAMIC_TP';
        trade.closedAt = now;
        trade.exitPrice = curPrice;
        await closeBitgetPosition(trade.symbol, isLong);

        const netGrowth = (currentPnlPct * LEVERAGE).toFixed(1);
        const tgDynMsg = `🎯 <b>MINEORA PRO | KÂR KİLİTLENDİ!</b>\n` +
                         `━━━━━━━━━━━━━━━━━━━━\n` +
                         `💎 <b>Parite:</b> #${trade.symbol}\n` +
                         `🧭 <b>Yön:</b> ${trade.direction}\n` +
                         `💵 <b>Giriş:</b> <code>$${pEntryStr}</code>\n` +
                         `🎯 <b>Kapanış:</b> <code>$${pCurStr}</code>\n` +
                         `💰 <b>Net Kâr:</b> +%${currentPnlPct.toFixed(2)} (${LEVERAGE}x ile <b>+%${netGrowth} Kasa Büyümesi</b>)\n` +
                         `🛡️ <b>Sebep:</b> <i>${dynamicExitReason}</i>`;

        await sendTelegramAlert(tgDynMsg);

        await fetch(`${FIREBASE_BASE_URL}/active_trades/${tradeKey}.json`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(trade)
        });
        continue;
      }

      // Bitget'in kendi sunucusunda mühürlü TP'si vurulduğunda (+%0.55):
      if (isTpHit) {
        trade.status = 'TP_HIT';
        trade.closedAt = now;
        await closeBitgetPosition(trade.symbol, isLong);

        const tgTpMsg = `🚀 <b>MINEORA PRO | MÜHÜRLÜ DOYMA TP'Sİ VURULDU!</b>\n` +
                        `━━━━━━━━━━━━━━━━━━━━\n` +
                        `💎 <b>Parite:</b> #${trade.symbol}\n` +
                        `🧭 <b>Yön:</b> ${trade.direction}\n` +
                        `💵 <b>Giriş:</b> <code>$${pEntryStr}</code>\n` +
                        `🎯 <b>Kapanış:</b> <code>$${pCurStr}</code>\n` +
                        `💰 <b>Net Kâr:</b> +%${DOYMA_TP_PCT} (${LEVERAGE}x ile <b>+%${(DOYMA_TP_PCT * LEVERAGE).toFixed(1)} NET BÜYÜME</b>)\n` +
                        `✅ <i>Borsa emri doldurdu, kâr kasaya eklendi.</i>`;

        await sendTelegramAlert(tgTpMsg);

        await fetch(`${FIREBASE_BASE_URL}/active_trades/${tradeKey}.json`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(trade)
        });
        continue;
      }

      // Stop Loss vurulduğunda:
      if (isStopHit) {
        trade.status = 'STOPPED';
        trade.closedAt = now;
        await closeBitgetPosition(trade.symbol, isLong);

        await fetch(`${FIREBASE_BASE_URL}/last_stopped_coins/${trade.symbol}.json`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(now)
        }).catch(() => {});

        const tgStopMsg = `🛑 <b>MINEORA PRO | STOP LOSS ÇALIŞTI</b>\n` +
                          `━━━━━━━━━━━━━━━━━━━━\n` +
                          `💎 <b>Parite:</b> #${trade.symbol}\n` +
                          `💵 <b>Kapanış:</b> <code>$${pCurStr}</code>\n` +
                          `⚠️ <i>Stop seviyesi tetiklendi. Parite 25 dk soğumada.</i>`;

        await sendTelegramAlert(tgStopMsg);

        await fetch(`${FIREBASE_BASE_URL}/active_trades/${tradeKey}.json`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(trade)
        });
        continue;
      }

      await fetch(`${FIREBASE_BASE_URL}/active_trades/${tradeKey}/maxPnlPct.json`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(trade.maxPnlPct)
      }).catch(() => {});
    }

    // =========================================================================
    // MODÜL 2: 6 İNDİKATÖR CONFLUENCE MOTORU
    // =========================================================================
    const openTradesCount = Object.values(activeTrades).filter(t => {
      if (!t || t.status !== 'OPEN') return false;
      const tTime = t.createdAt || 0;
      return (now - tTime) <= LOCK_WINDOW_MS;
    }).length;

    if (openTradesCount >= 3) {
      return res.status(200).json({ status: "IDLE", message: "Takipte 3 aktif operasyon var." });
    }

    // ─────────────────────────────────────────────────────────────────────────
    // TOKSİK COIN KARA LİSTESİ (Kayıpların %70'ini üreten pariteler)
    // ─────────────────────────────────────────────────────────────────────────
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

    const LOW_LEVERAGE_OR_MICRO_BLACKLIST = ["QUSDT", "SOPHUSDT"];

    const pool = tickersJson.data.filter(c => {
      if (!c.symbol || !c.symbol.endsWith("USDT")) return false;
      if (c.symbol.includes("_") || c.symbol.includes(".") || c.symbol.includes("-")) return false;

      const symUpper = c.symbol.toUpperCase();
      if (TOXIC_COINS_BLACKLIST.includes(symUpper)) return false;
      for (const fx of FOREX_AND_FIAT) if (symUpper.includes(fx)) return false;
      for (const st of STOCKS_BLACKLIST) if (symUpper.includes(st)) return false;
      for (const low of LOW_LEVERAGE_OR_MICRO_BLACKLIST) if (symUpper === low) return false;
      if (genuineSpotCryptoSet.size > 0 && !genuineSpotCryptoSet.has(c.symbol)) return false;

      const p = parseFloat(c.lastPr || 0);
      if (p > 0 && p < 0.005) return false;

      const vol = parseFloat(c.usdtVolume || c.quoteVolume || 0);
      return vol >= 2000000;
    }).sort((a, b) => parseFloat(b.usdtVolume || 0) - parseFloat(a.usdtVolume || 0));

    // ─────────────────────────────────────────────────────────────────────────
    // MATEMATİKSEL İNDİKATÖR FONKSİYONLARI (PURE JS)
    // ─────────────────────────────────────────────────────────────────────────
    function calculateEMA(series, period) {
      if (series.length < period) return series[series.length - 1];
      const k = 2 / (period + 1);
      let ema = series.slice(0, period).reduce((a, b) => a + b, 0) / period;
      for (let i = period; i < series.length; i++) {
        ema = series[i] * k + ema * (1 - k);
      }
      return ema;
    }

    function calculateEMASeries(series, period) {
      if (series.length < period) return series;
      const k = 2 / (period + 1);
      const res = [];
      let ema = series.slice(0, period).reduce((a, b) => a + b, 0) / period;
      res.push(ema);
      for (let i = period; i < series.length; i++) {
        ema = series[i] * k + ema * (1 - k);
        res.push(ema);
      }
      return res;
    }

    function calculateRSI(closes, period = 14) {
      if (closes.length <= period) return 50;
      let gains = 0, losses = 0;
      for (let i = 1; i <= period; i++) {
        const diff = closes[i] - closes[i - 1];
        if (diff >= 0) gains += diff; else losses -= diff;
      }
      let avgGain = gains / period, avgLoss = losses / period;
      for (let i = period + 1; i < closes.length; i++) {
        const diff = closes[i] - closes[i - 1];
        avgGain = (avgGain * (period - 1) + (diff > 0 ? diff : 0)) / period;
        avgLoss = (avgLoss * (period - 1) + (diff < 0 ? -diff : 0)) / period;
      }
      return avgLoss === 0 ? 100 : 100 - (100 / (1 + (avgGain / avgLoss)));
    }

    function calculateBollinger(closes, period = 20, multiplier = 2) {
      if (closes.length < period) return { mean: closes[closes.length - 1], upper: 0, lower: 0, pctB: 0.5 };
      const slice = closes.slice(-period);
      const mean = slice.reduce((a, b) => a + b, 0) / period;
      const variance = slice.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / period;
      const stdDev = Math.sqrt(variance);
      const upper = mean + (multiplier * stdDev);
      const lower = mean - (multiplier * stdDev);
      const last = closes[closes.length - 1];
      const pctB = (upper - lower === 0) ? 0.5 : (last - lower) / (upper - lower);
      return { mean, upper, lower, pctB, bandwidth: (upper - lower) / mean * 100 };
    }

    function calculateCCI(candles, period = 20) {
      if (candles.length < period) return 0;
      const tpList = candles.map(c => (c.high + c.low + c.close) / 3);
      const slice = tpList.slice(-period);
      const mean = slice.reduce((a, b) => a + b, 0) / period;
      const meanDev = slice.reduce((a, b) => a + Math.abs(b - mean), 0) / period;
      const lastTp = tpList[tpList.length - 1];
      return meanDev === 0 ? 0 : (lastTp - mean) / (0.015 * meanDev);
    }

    function calculateMACD(closes) {
      if (closes.length < 35) return { macdHist: 0, isBullish: true };
      const ema12Series = calculateEMASeries(closes, 12);
      const ema26Series = calculateEMASeries(closes, 26);
      const offset = ema12Series.length - ema26Series.length;
      const macdLine = [];
      for (let i = 0; i < ema26Series.length; i++) {
        macdLine.push(ema12Series[i + offset] - ema26Series[i]);
      }
      const signalLine = calculateEMASeries(macdLine, 9);
      const lastMacd = macdLine[macdLine.length - 1];
      const lastSignal = signalLine[signalLine.length - 1];
      const prevMacd = macdLine[macdLine.length - 2] || lastMacd;
      const prevSignal = signalLine[signalLine.length - 2] || lastSignal;
      const hist = lastMacd - lastSignal;
      const prevHist = prevMacd - prevSignal;
      return { macdHist: hist, prevHist, histGrowing: hist > prevHist, isBullish: hist > 0 };
    }

    function calculateTRIX(closes, period = 12) {
      if (closes.length < period * 3) return { trix: 0, slopeUp: true };
      const e1 = calculateEMASeries(closes, period);
      const e2 = calculateEMASeries(e1, period);
      const e3 = calculateEMASeries(e2, period);
      const n = e3.length;
      if (n < 2) return { trix: 0, slopeUp: true };
      const trixCurrent = ((e3[n - 1] - e3[n - 2]) / e3[n - 2]) * 10000;
      const trixPrev = n >= 3 ? ((e3[n - 2] - e3[n - 3]) / e3[n - 3]) * 10000 : trixCurrent;
      return { trix: trixCurrent, slopeUp: trixCurrent > trixPrev };
    }

    function calculateUltimateRSI(closes) {
      const fastRsi = calculateRSI(closes, 7);
      const midRsi = calculateRSI(closes, 14);
      const smoothed = (fastRsi * 0.6) + (midRsi * 0.4);
      return { val: smoothed, isOversold: smoothed <= 32, isOverbought: smoothed >= 68 };
    }

    let candidateTrade = null;

    for (const item of pool) {
      const lastSentTime = lastSignals[item.symbol] || 0;
      if (now - lastSentTime < SAME_COIN_LOCK_MS) continue;

      const lastStopTime = lastStoppedCoins[item.symbol] || 0;
      if (now - lastStopTime < POST_STOP_COOLDOWN_MS) continue;

      const candles1mRes = await fetch(`https://api.bitget.com/api/v2/mix/market/candles?symbol=${item.symbol}&productType=USDT-FUTURES&granularity=1m&limit=90`, { headers: browserHeaders })
        .then(r => r.json()).catch(() => ({}));

      if (candles1mRes.code !== '00000' || !Array.isArray(candles1mRes.data) || candles1mRes.data.length < 60) continue;

      const candles1m = candles1mRes.data.map(c => ({
        time: Number(c[0]),
        open: Number(c[1]),
        high: Number(c[2]),
        low: Number(c[3]),
        close: Number(c[4]),
        volume: Number(c[5])
      })).sort((a, b) => a.time - b.time);

      const closes = candles1m.map(c => c.close);
      const cur1m = candles1m[candles1m.length - 1];
      const sweep1m = candles1m[candles1m.length - 2];

      const h1High = Math.max(...candles1m.slice(-60).map(c => c.high));
      const h1Low  = Math.min(...candles1m.slice(-60).map(c => c.low));
      const h1Range = h1High - h1Low;
      if (h1Range <= 0) continue;
      const h1Pos = (cur1m.close - h1Low) / h1Range;
      const h1RangePct = (h1Range / cur1m.close) * 100;

      // 6 İNDİKATÖRÜ HESAPLA
      const rsiVal = calculateRSI(closes, 14);
      const bb = calculateBollinger(closes, 20, 2);
      const cciVal = calculateCCI(candles1m, 20);
      const macd = calculateMACD(closes);
      const trix = calculateTRIX(closes, 12);
      const ultRsi = calculateUltimateRSI(closes);

      const sweepRange = sweep1m.high - sweep1m.low;
      if (sweepRange <= 0) continue;
      const lowerWickPct = (Math.min(sweep1m.open, sweep1m.close) - sweep1m.low) / sweepRange;
      const upperWickPct = (sweep1m.high - Math.max(sweep1m.open, sweep1m.close)) / sweepRange;

      // TAHTA AKIŞI
      const fillsRes = await fetch(`https://api.bitget.com/api/v2/mix/market/fills?symbol=${item.symbol}&productType=usdt-futures&limit=60`, { headers: browserHeaders })
        .then(r => r.json()).catch(() => ({}));

      const fills = fillsRes.data?.fillList || fillsRes.data || [];
      let buyUsd = 0, sellUsd = 0;
      if (Array.isArray(fills)) {
        fills.forEach(f => {
          const val = parseFloat(f.price || 0) * parseFloat(f.size || 0);
          if (val >= 250) {
            if (f.side === 'buy') buyUsd += val; else sellUsd += val;
          }
        });
      }
      const totalFlow = buyUsd + sellUsd;
      const takerBuyRatio = totalFlow > 0 ? (buyUsd / totalFlow) * 100 : 50;

      // ── CONFLUENCE SKORLAMASI ──
      let longScore = 0;
      if (bb.pctB <= 0.20 || cur1m.low <= bb.lower) longScore++;
      if (rsiVal <= 38 || (rsiVal > 30 && rsiVal < 50)) longScore++;
      if (ultRsi.isOversold || ultRsi.val <= 36) longScore++;
      if (cciVal <= -80) longScore++;
      if (macd.histGrowing || macd.macdHist > macd.prevHist) longScore++;
      if (trix.slopeUp) longScore++;

      const isLongValid = (longScore >= 4) && 
                          (h1Pos <= 0.40) && 
                          (lowerWickPct >= 0.40) && 
                          (takerBuyRatio >= 62);

      let shortScore = 0;
      if (bb.pctB >= 0.80 || cur1m.high >= bb.upper) shortScore++;
      if (rsiVal >= 62 || (rsiVal < 70 && rsiVal > 50)) shortScore++;
      if (ultRsi.isOverbought || ultRsi.val >= 64) shortScore++;
      if (cciVal >= 80) shortScore++;
      if (!macd.histGrowing || macd.macdHist < macd.prevHist) shortScore++;
      if (!trix.slopeUp) shortScore++;

      const isShortValid = (shortScore >= 4) && 
                           (h1Pos >= 0.60) && 
                           (upperWickPct >= 0.40) && 
                           (takerBuyRatio <= 38);

      // Gürültüyü engelleyen dinamik stop (Taban: %0.65)
      let dynamicSlPct = Math.max(MIN_SL_PCT, Math.min(0.95, h1RangePct * 0.22));

      if (isLongValid) {
        candidateTrade = {
          symbol: item.symbol,
          direction: 'LONG',
          price: cur1m.close,
          rawPriceStr: item.lastPr,
          wickPoint: sweep1m.low,
          dynamicTpPct: DOYMA_TP_PCT,
          dynamicSlPct: parseFloat(dynamicSlPct.toFixed(2)),
          h1RangePct: parseFloat(h1RangePct.toFixed(2)),
          longScore,
          indicators: `BB:%B=${bb.pctB.toFixed(2)}, RSI=${rsiVal.toFixed(0)}, UltRSI=${ultRsi.val.toFixed(0)}, CCI=${cciVal.toFixed(0)}`,
          reason: `${longScore}/6 İndikatör Konsensüsü + %${Math.round(lowerWickPct * 100)} alt fitil reddi + %${Math.round(takerBuyRatio)} alıcı akışı.`
        };
        break;
      }

      if (isShortValid) {
        candidateTrade = {
          symbol: item.symbol,
          direction: 'SHORT',
          price: cur1m.close,
          rawPriceStr: item.lastPr,
          wickPoint: sweep1m.high,
          dynamicTpPct: DOYMA_TP_PCT,
          dynamicSlPct: parseFloat(dynamicSlPct.toFixed(2)),
          h1RangePct: parseFloat(h1RangePct.toFixed(2)),
          shortScore,
          indicators: `BB:%B=${bb.pctB.toFixed(2)}, RSI=${rsiVal.toFixed(0)}, UltRSI=${ultRsi.val.toFixed(0)}, CCI=${cciVal.toFixed(0)}`,
          reason: `${shortScore}/6 İndikatör Konsensüsü + %${Math.round(upperWickPct * 100)} üst fitil satışı + %${Math.round(100 - takerBuyRatio)} satıcı akışı.`
        };
        break;
      }
    }

    if (!candidateTrade) {
      return res.status(200).json({ status: "SCANNING", message: "6-İndikatör Confluence fırsatları taranıyor..." });
    }

    // =========================================================================
    // MODÜL 3: CANLI BORSA EMRİ (BORSAYA MÜHÜRLÜ DOYMA TP'Sİ: +%0.55)
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

    const tpRatio = candidateTrade.dynamicTpPct / 100;
    const slRatio = candidateTrade.dynamicSlPct / 100;

    // Kesin TP ve Tabanlı SL Seviyeleri:
    const tp = isLong ? entryPrice * (1 + tpRatio) : entryPrice * (1 - tpRatio);
    let sl = isLong 
      ? Math.min(candidateTrade.wickPoint * 0.998, entryPrice * (1 - slRatio))
      : Math.max(candidateTrade.wickPoint * 1.002, entryPrice * (1 + slRatio));

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

    if (placeOrderRes.code !== '00000') {
      await sendTelegramAlert(
        `⚠️ <b>MINEORA PRO | BİTGET EMİR REDDİ</b>\n` +
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
      maxPnlPct: 0,
      status: 'OPEN',
      reason: candidateTrade.reason,
      indicators: candidateTrade.indicators,
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

    const tgMsg = `🎯 <b>MINEORA PRO | KESİN DOYMA SCALP</b>\n` +
                  `━━━━━━━━━━━━━━━━━━━━\n` +
                  `💎 <b>Borsa:</b> BİTGET UTA\n` +
                  `💎 <b>Parite:</b> #${candidateTrade.symbol}\n` +
                  `🧭 <b>Yön:</b> ${isLong ? '🟢 LONG' : '🔴 SHORT'}\n` +
                  `💵 <b>Giriş:</b> <code>$${pStr}</code>\n` +
                  `💼 <b>Model:</b> Kasanın %5'i | ${LEVERAGE}x Kaldıraç\n` +
                  `🎯 <b>Mühürlü Doyma Hedefi (+%${candidateTrade.dynamicTpPct}):</b> <code>$${tpStr}</code> (Net: <b>+%${(candidateTrade.dynamicTpPct * LEVERAGE).toFixed(1)}</b>)\n` +
                  `🛑 <b>Geniş Tabanlı Stop (-%${candidateTrade.dynamicSlPct}):</b> <code>$${slStr}</code>\n` +
                  `━━━━━━━━━━━━━━━━━━━━\n` +
                  `⚡ <i>Bitget Motoruna Kilitlendi: +%0.55'e anlık temasta borsa TP'yi doğrudan alır; geri dönüş stopuna fırsat vermez.</i>`;

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
