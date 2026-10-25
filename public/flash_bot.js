const axios = require('axios');
const crypto = require('crypto');

// AYARLAR & KİMLİK BİLGİLERİ
const TELEGRAM_BOT_TOKEN = "8682225307:AAHaa-hieKBBluU6uZ2_-OgSPxGR7OwMssE";
const TELEGRAM_CHAT_ID = "-1004404988937";
const FIREBASE_DB_URL = "https://mineora-web-default-rtdb.firebaseio.com";

// KRİPTO DIŞI VE MAJÖR TAHTALAR
const EXCLUDED = [
  "BTCUSDT", "ETHUSDT", "SOLUSDT", "BNBUSDT", "XRPUSDT", "DOGEUSDT",
  "XAUUSDT", "XAGUSDT", "WTIUSDT", "BRENTUSDT",
  "NVDAUSDT", "TSLAUSDT", "AAPLUSDT", "MSFTUSDT", "AMZNUSDT", "GOOGLUSDT", 
  "COINUSDT", "MSTRUSDT", "SPXUSDT", "NDXUSDT"
];

let globalLastSignalTime = 0;
const GLOBAL_COOLDOWN_MS = 6 * 60 * 1000; // İki sinyal arası en az 6 dakika soğuma
const pairCooldown = new Map();

async function sendTelegramAlert(text) {
  if (!TELEGRAM_BOT_TOKEN) return;
  try {
    const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
    await axios.post(url, {
      chat_id: TELEGRAM_CHAT_ID,
      text: text,
      parse_mode: 'HTML',
      disable_web_page_preview: true
    });
    console.log("📲 [TELEGRAM] Sinyal iletildi.");
  } catch (err) {
    console.error("Telegram hatası:", err.message);
  }
}

// Bitget v2 REST API İmzalama Motoru
function signBitgetV2(secretKey, timestamp, method, requestPath, queryString = "", body = "") {
  const message = timestamp + method.toUpperCase() + requestPath + (queryString ? "?" + queryString : "") + (body ? body : "");
  return crypto.createHmac('sha256', secretKey).update(message).digest('base64');
}

// Otomatik Emir Açıcı
async function executeAutoTradesForUsers(symbol, side, price) {
  try {
    const res = await axios.get(`${FIREBASE_DB_URL}/users.json`);
    const users = res.data;
    if (!users) return;

    for (const [userId, user] of Object.entries(users)) {
      if (user.autoTradeEnabled && user.bitgetApi?.key && user.bitgetApi?.secret && user.bitgetApi?.passphrase) {
        openBitgetFlashOrder(userId, user.bitgetApi, symbol, side).catch(e => {
          console.error(`[${userId}] Oto-emir hatası:`, e.message);
        });
      }
    }
  } catch (err) {
    console.error("Firebase kullanıcı okuma hatası:", err.message);
  }
}

async function openBitgetFlashOrder(userId, api, symbol, side) {
  const timestamp = Date.now().toString();
  const path = "/api/v2/mix/order/place-order";
  
  const bodyData = {
    symbol: symbol,
    productType: "USDT-FUTURES",
    marginMode: "isolated",
    marginCoin: "USDT",
    size: "1",
    side: side === "LONG" ? "buy" : "sell",
    orderType: "market"
  };

  const bodyStr = JSON.stringify(bodyData);
  const sign = signBitgetV2(api.secret, timestamp, "POST", path, "", bodyStr);

  const headers = {
    'ACCESS-KEY': api.key,
    'ACCESS-SIGN': sign,
    'ACCESS-PASSPHRASE': api.passphrase,
    'ACCESS-TIMESTAMP': timestamp,
    'locale': 'en-US',
    'Content-Type': 'application/json'
  };

  try {
    const res = await axios.post(`https://api.bitget.com${path}`, bodyData, { headers });
    if (res.data.code === "00000") {
      console.log(`✅ [${userId}] ${symbol} (${side}) market emri iletildi.`);
    }
  } catch (e) {
    console.error(`❌ [${userId}] İşlem açılamadı:`, e.response?.data || e.message);
  }
}

// PUMP VE DUMP ÖNCESİ SIKIŞMA VE OPERASYON TESPİTİ
async function evaluateTicker(ticker) {
  const symbol = ticker.symbol;
  const now = Date.now();

  if (pairCooldown.has(symbol) && (now - pairCooldown.get(symbol) < 60 * 60 * 1000)) {
    return null;
  }

  const price = parseFloat(ticker.lastPr);
  const vol24h = parseFloat(ticker.usdtVolume || 0);
  if (vol24h < 1500000) return null; // En az $1.5M hacim

  try {
    // 1. KATI KURAL: UYKUDA OLMA / DURAĞANLIK KONTROLÜ
    // Fiyat son 15 dakikada kımıldamamış olmalı! Zaten koşmuş coine girilmez!
    const klinesRes = await axios.get(`https://api.bitget.com/api/v2/mix/market/candles?symbol=${symbol}&productType=USDT-FUTURES&granularity=15m&limit=1`);
    if (klinesRes.data.code !== "00000" || !klinesRes.data.data || klinesRes.data.data.length === 0) return null;

    const candle = klinesRes.data.data[0];
    const openP = parseFloat(candle[1]);
    const highP = parseFloat(candle[2]);
    const lowP = parseFloat(candle[3]);
    const spread = ((highP - lowP) / openP) * 100;

    // Son 15 dakikalık oynaklık %0.9'dan büyükse parite elenir (Trene sonradan binilmez!)
    if (spread > 0.95) return null;

    // 2. FONLAMA BASKISI (LİKİDASYON SIKIŞMASI)
    const fundingRate = parseFloat(ticker.fundingRate || 0) * 100;

    // 3. EMİR DEFTERİ DERİNLİĞİ (BORSA TUZAĞI)
    const depthRes = await axios.get(`https://api.bitget.com/api/v2/mix/market/orderbook?symbol=${symbol}&productType=USDT-FUTURES&limit=20`);
    if (depthRes.data.code !== "00000" || !depthRes.data.data) return null;

    const asks = depthRes.data.data.asks || [];
    const bids = depthRes.data.data.bids || [];

    let totalAskDepth = 0, totalBidDepth = 0;
    asks.slice(0, 15).forEach(a => totalAskDepth += parseFloat(a[1]));
    bids.slice(0, 15).forEach(b => totalBidDepth += parseFloat(b[1]));

    const depthRatio = totalAskDepth > 0 ? (totalBidDepth / totalAskDepth) : 1;

    // 4. TAPE AKIŞI (SESSİZ TOPLAMA / BOŞALTMA)
    const fillsRes = await axios.get(`https://api.bitget.com/api/v2/mix/market/fills?symbol=${symbol}&productType=USDT-FUTURES&limit=50`);
    if (fillsRes.data.code !== "00000" || !fillsRes.data.data) return null;

    const fills = fillsRes.data.data.fillList || fillsRes.data.data;
    let buyVol = 0, sellVol = 0;
    fills.forEach(f => {
      const val = parseFloat(f.price) * parseFloat(f.size);
      if (f.side === 'buy') buyVol += val;
      else sellVol += val;
    });
    const totalFillsVol = buyVol + sellVol || 1;
    const buyRatio = (buyVol / totalFillsVol) * 100;

    let signalType = null;
    let direction = "";
    let narrative = "";

    // PUMP ÖNCESİ SIKIŞMA (LONG):
    // Fonlama aşırı negatif (Short yığılması), satış kademeleri boşaltılmış (depthRatio >= 2.3), alıcılar sessizce topluyor
    if (fundingRate < -0.020 && depthRatio >= 2.3 && buyRatio >= 65) {
      direction = "LONG";
      signalType = "🚀 PUMP ÖNCESİ SIKIŞMA (LONG)";
      narrative = "İçerideki yatırımcılar aşırı oranda Short'ta rehin kalmışken tahtadaki satış kademeleri tamamen temizlendi. Fiyat uykuda, borsa Short'ları patlatmak için yukarı fırlatmak üzere!";
    }
    // DUMP ÖNCESİ TUZAK (SHORT):
    // Fonlama aşırı pozitif (Long yığılması), alış desteği geri çekilmiş (depthRatio <= 0.40), satış baskısı başlamış
    else if (fundingRate > 0.035 && depthRatio <= 0.40 && buyRatio <= 35) {
      direction = "SHORT";
      signalType = "🩸 DUMP ÖNCESİ TUZAK (SHORT)";
      narrative = "Bireysel kitle Long yığını oluşturmuşken tahtadaki alış desteği boşaltıldı. Fiyat henüz düşmedi, borsa Long'ları tasfiye etmek için sert bir alt iğne atmak üzere!";
    }

    if (!direction) return null;

    const isLong = direction === "LONG";
    const tp = isLong ? price * 1.018 : price * 0.982;
    const sl = isLong ? price * 0.993 : price * 1.007;

    pairCooldown.set(symbol, now);
    globalLastSignalTime = now;

    return {
      symbol,
      direction,
      price,
      tp,
      sl,
      signalType,
      narrative,
      spread: spread.toFixed(2),
      fundingRate: fundingRate.toFixed(4),
      depthRatio: depthRatio.toFixed(2),
      buyRatio: Math.round(buyRatio),
      detectedAt: now
    };
  } catch (err) {
    return null;
  }
}

// Ana Tarama Döngüsü
async function runRadarCycle() {
  const now = Date.now();
  if (now - globalLastSignalTime < GLOBAL_COOLDOWN_MS) return;

  try {
    const res = await axios.get("https://api.bitget.com/api/v2/mix/market/tickers?productType=USDT-FUTURES");
    if (res.data.code !== "00000" || !Array.isArray(res.data.data)) return;

    const tickers = res.data.data.filter(t => 
      t.symbol.endsWith("USDT") && 
      !EXCLUDED.includes(t.symbol) &&
      !t.symbol.includes("USDC")
    );

    for (const ticker of tickers) {
      const match = await evaluateTicker(ticker);
      if (match) {
        console.log(`\n🎯 [SNIPER TESPİTİ] ${match.symbol} -> ${match.signalType}`);

        const pStr = match.price < 1 ? match.price.toFixed(6) : match.price.toFixed(4);
        const tpStr = match.tp < 1 ? match.tp.toFixed(6) : match.tp.toFixed(4);
        const slStr = match.sl < 1 ? match.sl.toFixed(6) : match.sl.toFixed(4);

        const msg = 
`⚡ <b>MINEORA SNIPER | ${match.signalType}</b>
━━━━━━━━━━━━━━━━━━━━
💎 <b>Parite:</b> <code>#${match.symbol}</code> (<b>${match.direction}</b>)
💰 <b>Giriş (Henüz Patlamadı):</b> <code>$${pStr}</code>
⏱️ <b>Zaman Penceresi:</b> <code>5 - 15 Dakika (Operasyon Öncesi)</code>

🎯 <b>Hedef Kâr (TP):</b> <code>$${tpStr}</code> (±%1.8)
🛑 <b>Sert Stop (SL):</b> <code>$${slStr}</code> (±%0.7)

🔬 <b>BORSA OPERASYON İSTİHBARATI:</b>
• 15dk Oynaklık: <b>%${match.spread} (Tahta Uykuda)</b>
• Fonlama Oranı: <b>%${match.fundingRate}</b>
• Tahta Baskı Oranı: <b>${match.depthRatio}x</b>
• ${match.narrative}

⏳ <b>ZAMAN KURALI: 12 Dakika dolduğunda patlama gelmezse pozisyon terk edilir.</b>
━━━━━━━━━━━━━━━━━━━━
🌐 <b>Canlı Panel:</b> mineoragame.com`;

        await sendTelegramAlert(msg);

        // Canlı Panele Aktar
        try {
          await axios.put(`${FIREBASE_DB_URL}/activeFlashSignal.json`, match);
        } catch (e) {}

        // Otomatik Emir
        await executeAutoTradesForUsers(match.symbol, match.direction, match.price);
        break;
      }
    }
  } catch (err) {
    console.error("Tarama döngüsü hatası:", err.message);
  }
}

console.log("🛡️ Mineora Saf Pump & Dump Öncesi Sniper Motoru Başlatıldı...");
setInterval(runRadarCycle, 7000);
