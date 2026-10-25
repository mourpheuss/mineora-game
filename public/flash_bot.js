const axios = require('axios');
const crypto = require('crypto');

// AYARLAR & KİMLİK BİLGİLERİ
const TELEGRAM_BOT_TOKEN = "8682225307:AAHaa-hieKBBluU6uZ2_-OgSPxGR7OwMssE";
const TELEGRAM_CHAT_ID = "-1004404988937";
const FIREBASE_DB_URL = "https://mineora-web-default-rtdb.firebaseio.com";

// KRİPTO DIŞI VE MAJÖR TAHTALARI ENGELLEME
const EXCLUDED = [
  "BTCUSDT", "ETHUSDT", "SOLUSDT", "BNBUSDT", "XRPUSDT", "DOGEUSDT",
  "XAUUSDT", "XAGUSDT", "WTIUSDT", "BRENTUSDT",
  "NVDAUSDT", "TSLAUSDT", "AAPLUSDT", "MSFTUSDT", "AMZNUSDT", "GOOGLUSDT", 
  "COINUSDT", "MSTRUSDT", "SPXUSDT", "NDXUSDT"
];

let globalLastSignalTime = 0;
const GLOBAL_COOLDOWN_MS = 5 * 60 * 1000; // İki sinyal arası en az 5 dakika soğuma
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

// PUMP & DUMP ÖNCESİ KESTİRİM MOTORU
async function evaluateTicker(ticker) {
  const symbol = ticker.symbol;
  const now = Date.now();

  if (pairCooldown.has(symbol) && (now - pairCooldown.get(symbol) < 60 * 60 * 1000)) {
    return null;
  }

  const price = parseFloat(ticker.lastPr);
  const vol24h = parseFloat(ticker.usdtVolume || 0);
  if (vol24h < 1500000) return null;

  try {
    // 1. KONTROL: FİYAT HENÜZ PATLAMAMIŞ OLMALI (UYKU / SIKIŞMA EVRESİ)
    // Son 15 dakikalık mumları kontrol ediyoruz; fiyat zaten %1.5'tan fazla koşmuşsa İPTAL
    const klinesRes = await axios.get(`https://api.bitget.com/api/v2/mix/market/candles?symbol=${symbol}&productType=USDT-FUTURES&granularity=15m&limit=2`);
    if (klinesRes.data.code !== "00000" || !klinesRes.data.data) return null;
    
    const candle = klinesRes.data.data[0];
    const openP = parseFloat(candle[1]);
    const highP = parseFloat(candle[2]);
    const lowP = parseFloat(candle[3]);
    const candleSpread = ((highP - lowP) / openP) * 100;
    
    // Eğer mum son 15 dakikada zaten %1.8'den fazla dalgalanmışsa hareket başlamıştır, girilmez!
    if (candleSpread > 1.8) return null;

    // 2. KONTROL: FONLAMA BASKISI (LİKİDASYON YIĞILMASI)
    const fundingRate = parseFloat(ticker.fundingRate || 0) * 100;

    // 3. KONTROL: EMİR DEFTERİ DERİNLİĞİ & TUZAK ANALİZİ
    const depthRes = await axios.get(`https://api.bitget.com/api/v2/mix/market/orderbook?symbol=${symbol}&productType=USDT-FUTURES&limit=20`);
    if (depthRes.data.code !== "00000" || !depthRes.data.data) return null;

    const asks = depthRes.data.data.asks || [];
    const bids = depthRes.data.data.bids || [];

    let totalAskDepth = 0, totalBidDepth = 0;
    asks.slice(0, 15).forEach(a => totalAskDepth += parseFloat(a[1]));
    bids.slice(0, 15).forEach(b => totalBidDepth += parseFloat(b[1]));

    const depthRatio = totalAskDepth > 0 ? (totalBidDepth / totalAskDepth) : 1;

    // 4. KONTROL: TAPE'TE SESSİZ ÖNCÜ BALİNA İŞLEMLERİ
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
    let narrative = "";

    // PUMP ÖNCESİ SIKIŞMA (Short Squeeze Hazırlığı):
    // Fonlama negatif (Short yığılması var), satış tahtası boşaltılmış (derinlik oranı > 2.2) ve alıcılar tahtayı sessizce topluyor
    if (fundingRate < -0.025 && depthRatio >= 2.2 && buyRatio >= 65) {
      signalType = "PUMP ÖNCESİ SIKIŞMA (LONG)";
      narrative = "Short pozisyonlar aşırı birikmişken satış kademeleri boşaltıldı. Borsa short tasfiyesi için sert yukarı vurmak üzere!";
    }
    // DUMP ÖNCESİ TUZAK (Long Squeeze Hazırlığı):
    // Fonlama aşırı pozitif (millet Long'da), alış kademeleri çekilmiş (derinlik oranı < 0.45) ve satış baskısı başlamış
    else if (fundingRate > 0.035 && depthRatio <= 0.45 && buyRatio <= 35) {
      signalType = "DUMP ÖNCESİ TUZAK (SHORT)";
      narrative = "Küçük yatırımcı kütlesi Long'da rehin kalmışken tahtadaki alış desteği geri çekildi. Sert tasfiye iğnesi aşağı bekleniyor!";
    }

    if (!signalType) return null;

    const isLong = signalType.includes("LONG");
    const tp = isLong ? price * 1.018 : price * 0.982;
    const sl = isLong ? price * 0.993 : price * 1.007;

    pairCooldown.set(symbol, now);
    globalLastSignalTime = now;

    return {
      symbol,
      price,
      tp,
      sl,
      signalType,
      narrative,
      fundingRate: fundingRate.toFixed(4),
      depthRatio: depthRatio.toFixed(2),
      buyRatio: Math.round(buyRatio),
      detectedAt: now
    };
  } catch (err) {
    return null;
  }
}

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
        console.log(`\n🎯 [PUMP/DUMP KESTİRİMİ] ${match.symbol} -> ${match.signalType}`);

        const pStr = match.price < 1 ? match.price.toFixed(6) : match.price.toFixed(4);
        const tpStr = match.tp < 1 ? match.tp.toFixed(6) : match.tp.toFixed(4);
        const slStr = match.sl < 1 ? match.sl.toFixed(6) : match.sl.toFixed(4);

        const msg = 
`🚨 <b>MINEORA SNIPER | ${match.signalType}</b>
━━━━━━━━━━━━━━━━━━━━
💎 <b>Parite:</b> <code>#${match.symbol}</code>
💰 <b>Giriş:</b> <code>$${pStr}</code>
⏱️ <b>Zaman Penceresi:</b> <code>5 - 15 Dakika (Patlama Öncesi)</code>

🎯 <b>Hedef Kâr (TP):</b> <code>$${tpStr}</code> (±%1.8)
🛑 <b>Sert Stop (SL):</b> <code>$${slStr}</code> (±%0.7)

🔬 <b>TAHTA İSTİHBARATI:</b>
• ${match.narrative}
• Fonlama Oranı: <b>%${match.fundingRate}</b>
• Tahta Baskı Çarpanı: <b>${match.depthRatio}x</b>
━━━━━━━━━━━━━━━━━━━━
🌐 <b>Canlı Panel:</b> mineoragame.com`;

        await sendTelegramAlert(msg);

        // Firebase Güncellemesi
        try {
          await axios.put(`${FIREBASE_DB_URL}/activeFlashSignal.json`, match);
        } catch (e) {}

        break;
      }
    }
  } catch (err) {
    console.error("Hata:", err.message);
  }
}

console.log("🛡️ Mineora Pump & Dump Kestirim Radarı Başlatıldı...");
setInterval(runRadarCycle, 7000);
