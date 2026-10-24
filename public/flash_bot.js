const axios = require('axios');
const crypto = require('crypto');

// AYARLAR
const TELEGRAM_BOT_TOKEN = "8682225307:AAHaa-hieKBBluU6uZ2_-OgSPxGR7OwMssE";
const TELEGRAM_CHAT_ID = "-1004404988937";
const FIREBASE_DB_URL = "https://mineora-web-default-rtdb.firebaseio.com";

const EXCLUDED = ["BTCUSDT", "ETHUSDT", "SOLUSDT", "BNBUSDT", "XRPUSDT", "DOGEUSDT"];
const COOLDOWN_MINUTES = 60; // Aynı pariteye 1 saat içinde tekrar sinyal üretmez
const signalHistory = new Map();

// Telegram Bildirim Fonksiyonu
async function sendTelegramAlert(text) {
  if (!TELEGRAM_BOT_TOKEN || TELEGRAM_BOT_TOKEN.includes("BURAYA")) return;
  try {
    const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
    await axios.post(url, {
      chat_id: TELEGRAM_CHAT_ID,
      text: text,
      parse_mode: 'HTML',
      disable_web_page_preview: true
    });
  } catch (err) {
    console.error("Telegram gönderme hatası:", err.response?.data || err.message);
  }
}

// Bitget v2 REST API İmzalama Motoru
function signBitgetV2(secretKey, timestamp, method, requestPath, queryString = "", body = "") {
  const message = timestamp + method.toUpperCase() + requestPath + (queryString ? "?" + queryString : "") + (body ? body : "");
  return crypto.createHmac('sha256', secretKey).update(message).digest('base64');
}

// Kullanıcılar İçin Bitget Otomatik Emir Açıcı
async function executeAutoTradesForUsers(symbol, price) {
  try {
    const res = await axios.get(`${FIREBASE_DB_URL}/users.json`);
    const users = res.data;
    if (!users) return;

    for (const [userId, user] of Object.entries(users)) {
      if (user.autoTradeEnabled && user.bitgetApi?.key && user.bitgetApi?.secret && user.bitgetApi?.passphrase) {
        openBitgetFlashOrder(userId, user.bitgetApi, symbol, price).catch(e => {
          console.error(`[${userId}] Oto-emir hatası:`, e.message);
        });
      }
    }
  } catch (err) {
    console.error("Firebase kullanıcı okuma hatası:", err.message);
  }
}

async function openBitgetFlashOrder(userId, api, symbol, currentPrice) {
  const timestamp = Date.now().toString();
  const path = "/api/v2/mix/order/place-order";
  
  // Örnek: Minimum test büyüklüğü veya izole piyasa emri
  const bodyData = {
    symbol: symbol,
    productType: "USDT-FUTURES",
    marginMode: "isolated",
    marginCoin: "USDT",
    size: "1", // Parite lot büyüklüğü baz alınır
    side: "buy",
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
      console.log(`✅ [${userId}] ${symbol} için FLASH 5M emri başarıyla iletildi.`);
    } else {
      console.warn(`⚠️ [${userId}] Bitget Emir Uyarısı:`, res.data.msg);
    }
  } catch (e) {
    console.error(`❌ [${userId}] İşlem açılamadı:`, e.response?.data || e.message);
  }
}

// Kıvılcım & Spekülasyon Mikro-Analiz Motoru
async function evaluateTicker(ticker) {
  const symbol = ticker.symbol;
  const now = Date.now();

  if (signalHistory.has(symbol)) {
    const lastTime = signalHistory.get(symbol);
    if ((now - lastTime) < COOLDOWN_MINUTES * 60 * 1000) return null;
  }

  const price = parseFloat(ticker.lastPr);
  const vol24h = parseFloat(ticker.usdtVolume || 0);
  if (vol24h < 1500000) return null; // En az $1.5M likidite

  try {
    // 1. Son 50 işlemde Tape Agresyonu (Piyasa Alımları)
    const fillsRes = await axios.get(`https://api.bitget.com/api/v2/mix/market/fills?symbol=${symbol}&productType=USDT-FUTURES&limit=50`);
    if (fillsRes.data.code !== "00000" || !fillsRes.data.data) return null;

    let buyVolume = 0;
    let totalVolume = 0;
    const fills = fillsRes.data.data.fillList || fillsRes.data.data;
    
    fills.forEach(f => {
      const notional = parseFloat(f.price) * parseFloat(f.size);
      totalVolume += notional;
      if (f.side === 'buy') buyVolume += notional;
    });

    const buyRatio = totalVolume > 0 ? (buyVolume / totalVolume) * 100 : 0;
    // Tape Kıvılcımı: Son işlemlerde en az %75 alıcı baskısı ve $20.000+ anlık hacim
    if (buyRatio < 75 || totalVolume < 20000) return null;

    // 2. Emir Defteri Hava Boşluğu (Derinlik İncelmesi)
    const depthRes = await axios.get(`https://api.bitget.com/api/v2/mix/market/orderbook?symbol=${symbol}&productType=USDT-FUTURES&limit=15`);
    if (depthRes.data.code !== "00000" || !depthRes.data.data) return null;

    const asks = depthRes.data.data.asks || [];
    const bids = depthRes.data.data.bids || [];

    let totalAskDepth = 0;
    let totalBidDepth = 0;
    asks.slice(0, 10).forEach(a => totalAskDepth += parseFloat(a[1]));
    bids.slice(0, 10).forEach(b => totalBidDepth += parseFloat(b[1]));

    // Satış tarafı alış tarafına göre belirgin şekilde boşaltılmış mı?
    const isThinAsk = totalAskDepth > 0 && (totalBidDepth / totalAskDepth) >= 2.2;
    if (!isThinAsk) return null;

    // Hedef ve Stop Hesaplama (Hızlı Scalp %1.4 TP / %0.6 SL)
    const tp = price * 1.014;
    const sl = price * 0.994;

    signalHistory.set(symbol, now);

    return {
      symbol,
      price,
      tp,
      sl,
      buyRatio: Math.round(buyRatio),
      volK: Math.round(totalVolume / 1000),
      detectedAt: now
    };
  } catch (err) {
    return null;
  }
}

// Ana Tarama Döngüsü
async function runRadarCycle() {
  try {
    const res = await axios.get("https://api.bitget.com/api/v2/mix/market/tickers?productType=USDT-FUTURES");
    if (res.data.code !== "00000" || !Array.isArray(res.data.data)) return;

    const tickers = res.data.data.filter(t => t.symbol.endsWith("USDT") && !EXCLUDED.includes(t.symbol));

    for (const ticker of tickers) {
      const match = await evaluateTicker(ticker);
      if (match) {
        console.log(`\n🔥 [FLASH 5M KIVILCIMI] ${match.symbol} yakalandı!`);

        // Telegram Telsiz Anonsu
        const pStr = match.price < 1 ? match.price.toFixed(6) : match.price.toFixed(4);
        const tpStr = match.tp < 1 ? match.tp.toFixed(6) : match.tp.toFixed(4);
        const slStr = match.sl < 1 ? match.sl.toFixed(6) : match.sl.toFixed(4);

        const msg = 
`⚡ <b>MINEORA FLASH 5M | KIVILCIM ATEŞLENDİ!</b>
━━━━━━━━━━━━━━━━━━━━
💎 <b>Parite:</b> <code>#${match.symbol}</code> (LONG)
💰 <b>Giriş:</b> <code>$${pStr}</code>
⏱️ <b>Zaman Penceresi:</b> <code>3 - 8 Dakika</code>

🎯 <b>Hızlı Kâr (TP):</b> <code>$${tpStr}</code> (+%1.4)
🛑 <b>Sert Stop (SL):</b> <code>$${slStr}</code> (-%0.6)

🔬 <b>MİKRO-TEŞHİS:</b>
• Tahtada borsa satış kademeleri boşaltıldı (Hava Boşluğu).
• Tape Alıcı Baskısı: <b>%${match.buyRatio}</b> (Anlık $${match.volK}K alım).
• Beklenen Hızlı Sıçrama: <b>+%1.4 ile +%2.5</b>

⏳ <b>ZAMAN AŞIMI: 8:00 Dakika.</b> <i>(Süre bittiğinde hedefe gitmediyse pozisyonu terk et!)</i>
━━━━━━━━━━━━━━━━━━━━
🌐 <b>Canlı Panel:</b> mineoragame.com`;

        await sendTelegramAlert(msg);

        // Canlı Paneller için Firebase'e Aktif Sinyal Olarak Kaydet
        await axios.put(`${FIREBASE_DB_URL}/activeFlashSignal.json`, match).catch(() => {});

        // Bitget API'si bağlı kullanıcıların hesaplarında otomatik işlem aç
        await executeAutoTradesForUsers(match.symbol, match.price);
        break; // Döngü başına tek bir net kıvılcım odaklanır
      }
    }
  } catch (err) {
    console.error("Tarama döngüsü hatası:", err.message);
  }
}

console.log("🛡️ Mineora Flash 5M Kıvılcım & Spekülasyon Radarı Başlatıldı...");
setInterval(runRadarCycle, 8000); // 8 saniyede bir canlı piyasa kontrolü
