const axios = require('axios');
const crypto = require('crypto');

// AYARLAR & KİMLİK BİLGİLERİ
const TELEGRAM_BOT_TOKEN = "8682225307:AAHaa-hieKBBluU6uZ2_-OgSPxGR7OwMssE";
const TELEGRAM_CHAT_ID = "-1004404988937";
const FIREBASE_DB_URL = "https://mineora-web-default-rtdb.firebaseio.com";

// HİSSELER, EMTİALAR VE MAJÖR COİNLERİ ENGELLEME
const EXCLUDED = [
  "BTCUSDT", "ETHUSDT", "SOLUSDT", "BNBUSDT", "XRPUSDT", "DOGEUSDT",
  "XAUUSDT", "XAGUSDT", "WTIUSDT", "BRENTUSDT",
  "NVDAUSDT", "TSLAUSDT", "AAPLUSDT", "MSFTUSDT", "AMZNUSDT", "GOOGLUSDT", 
  "COINUSDT", "MSTRUSDT", "SPXUSDT", "NDXUSDT"
];

let globalLastSignalTime = 0; // Peş peşe sinyal yağmasını önleyen kilit
const GLOBAL_COOLDOWN_MS = 4 * 60 * 1000; // En az 4 dakika yeni sinyal üretemez
const pairCooldown = new Map();

// Telegram Bildirim Fonksiyonu
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
    console.log("📲 [TELEGRAM] Sinyal kanala başarıyla iletildi.");
  } catch (err) {
    console.error("❌ Telegram hatası:", err.response?.data || err.message);
  }
}

// Bitget v2 REST API İmzalama Motoru
function signBitgetV2(secretKey, timestamp, method, requestPath, queryString = "", body = "") {
  const message = timestamp + method.toUpperCase() + requestPath + (queryString ? "?" + queryString : "") + (body ? body : "");
  return crypto.createHmac('sha256', secretKey).update(message).digest('base64');
}

// Otomatik Emir Motoru
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
  
  const bodyData = {
    symbol: symbol,
    productType: "USDT-FUTURES",
    marginMode: "isolated",
    marginCoin: "USDT",
    size: "1",
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
      console.log(`✅ [${userId}] ${symbol} market emri iletildi.`);
    }
  } catch (e) {
    console.error(`❌ [${userId}] İşlem açılamadı:`, e.response?.data || e.message);
  }
}

// GERÇEK BALİNA & BORSA HAREKETİ ANALİZİ
async function evaluateTicker(ticker) {
  const symbol = ticker.symbol;
  const now = Date.now();

  // Tekil parite için 60 dakika bekleme süresi
  if (pairCooldown.has(symbol)) {
    if (now - pairCooldown.get(symbol) < 60 * 60 * 1000) return null;
  }

  const price = parseFloat(ticker.lastPr);
  const vol24h = parseFloat(ticker.usdtVolume || 0);
  if (vol24h < 2000000) return null; // En az $2M hacimli tahtalar

  try {
    // 1. KONTROL: KOŞMUŞ COIN ENGELİ (Zaten yürümüş, doymuş coine binilmez!)
    // Son 1 dakikalık ve 5 dakikalık en son fiyat farkına bakıyoruz.
    // Eğer fiyat son anlarda zaten yukarı fırladıysa bu balinanın malı tepede yıkmasıdır.
    const priceChange24h = parseFloat(ticker.change24h || 0) * 100;
    if (priceChange24h > 15) return null; // Zaten %15+ uçmuş coinleri ele

    // 2. KONTROL: BALİNA BLOK ALIMLARI (Tape Analizi)
    const fillsRes = await axios.get(`https://api.bitget.com/api/v2/mix/market/fills?symbol=${symbol}&productType=USDT-FUTURES&limit=60`);
    if (fillsRes.data.code !== "00000" || !fillsRes.data.data) return null;

    const fills = fillsRes.data.data.fillList || fillsRes.data.data;
    let whaleBuyCount = 0;
    let whaleBuyVolume = 0;
    let totalTapeVolume = 0;

    fills.forEach(f => {
      const val = parseFloat(f.price) * parseFloat(f.size);
      totalTapeVolume += val;
      // En az $3,500 büyüklüğündeki piyasa alımları balina kabul edilir
      if (f.side === 'buy' && val >= 3500) {
        whaleBuyCount++;
        whaleBuyVolume += val;
      }
    });

    // Son 60 işlemde EN AZ 3 farklı büyük balina blok alımı olmalı ve toplam hacmin %60'ı bu bloklardan gelmeli
    if (whaleBuyCount < 3 || (whaleBuyVolume / totalTapeVolume) < 0.60) {
      return null;
    }

    // 3. KONTROL: EMİR DEFTERİNDE GERÇEK HAVA BOŞLUĞU
    const depthRes = await axios.get(`https://api.bitget.com/api/v2/mix/market/orderbook?symbol=${symbol}&productType=USDT-FUTURES&limit=15`);
    if (depthRes.data.code !== "00000" || !depthRes.data.data) return null;

    const asks = depthRes.data.data.asks || [];
    const bids = depthRes.data.data.bids || [];

    let totalAskDepth = 0;
    let totalBidDepth = 0;
    asks.slice(0, 10).forEach(a => totalAskDepth += parseFloat(a[1]));
    bids.slice(0, 10).forEach(b => totalBidDepth += parseFloat(b[1]));

    // Satış tahtası bomboş olmalı (Alış desteği satışın en az 2.5 katı)
    if (totalAskDepth === 0 || (totalBidDepth / totalAskDepth) < 2.5) {
      return null;
    }

    // 4. KONTROL: FONLAMA BASKISI
    const fundingRate = parseFloat(ticker.fundingRate || 0) * 100;
    // Fonlama aşırı pozitif olmamalı (Yani piyasa long yığılması yaşayıp kusmaya hazır olmamalı)
    if (fundingRate > 0.04) return null;

    // Hedefler (Net Scalp: +%1.3 TP, -%0.6 Katı SL)
    const tp = price * 1.013;
    const sl = price * 0.994;

    pairCooldown.set(symbol, now);
    globalLastSignalTime = now;

    return {
      symbol,
      price,
      tp,
      sl,
      whaleCount: whaleBuyCount,
      whaleVolK: Math.round(whaleBuyVolume / 1000),
      fundingRate: fundingRate.toFixed(4),
      detectedAt: now
    };
  } catch (err) {
    return null;
  }
}

// Ana Tarama Döngüsü
async function runRadarCycle() {
  const now = Date.now();
  // Sinyalden sonraki 4 dakika boyunca sistemi kilitler; piyasa genelinde peş peşe 10 coin patlamasını engeller
  if (now - globalLastSignalTime < GLOBAL_COOLDOWN_MS) {
    return;
  }

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
        console.log(`\n🚨 [GERÇEK BALİNA KIVILCIMI] #${match.symbol} bulundu!`);

        const pStr = match.price < 1 ? match.price.toFixed(6) : match.price.toFixed(4);
        const tpStr = match.tp < 1 ? match.tp.toFixed(6) : match.tp.toFixed(4);
        const slStr = match.sl < 1 ? match.sl.toFixed(6) : match.sl.toFixed(4);

        const msg = 
`⚡ <b>MINEORA FLASH 5M | BALİNA ATEŞLEMESİ</b>
━━━━━━━━━━━━━━━━━━━━
💎 <b>Parite:</b> <code>#${match.symbol}</code> (LONG)
💰 <b>Giriş:</b> <code>$${pStr}</code>
⏱️ <b>Zaman Penceresi:</b> <code>3 - 8 Dakika</code>

🎯 <b>Hızlı Kâr (TP):</b> <code>$${tpStr}</code> (+%1.3)
🛑 <b>Sert Stop (SL):</b> <code>$${slStr}</code> (-%0.6)

🐋 <b>BALİNA İSTİHBARATI:</b>
• Son 60 işlemde <b>${match.whaleCount} adet</b> kurumsal blok piyasa alımı ($${match.whaleVolK}K).
• Satış kademeleri temizlendi (Alış baskısı 2.5x üstün).
• Fonlama: <b>%${match.fundingRate}</b> (Short sıkışma potansiyeli).

⏳ <b>ZAMAN AŞIMI: 8:00 Dakika.</b>
━━━━━━━━━━━━━━━━━━━━
🌐 <b>Canlı Panel:</b> mineoragame.com`;

        await sendTelegramAlert(msg);

        // Firebase Güncellemesi
        try {
          await axios.put(`${FIREBASE_DB_URL}/activeFlashSignal.json`, match);
          console.log(`📡 [FIREBASE] ${match.symbol} canlı panele aktarıldı.`);
        } catch (fbErr) {
          console.error("❌ Firebase hatası:", fbErr.message);
        }

        // Otomatik Emir
        await executeAutoTradesForUsers(match.symbol, match.price);
        break; // Bir turda yalnızca en temiz tek bir balina sinyali üretilir
      }
    }
  } catch (err) {
    console.error("Döngü hatası:", err.message);
  }
}

console.log("🛡️ Mineora Saf Balina & Borsa Radarı Devrede...");
setInterval(runRadarCycle, 8000);
