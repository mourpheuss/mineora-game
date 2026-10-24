// api/cron-scan.js
const TG_BOT_TOKEN = "8682225307:AAHaa-hieKBBluU6uZ2_-OgSPxGR7OwMssE";
const TG_CHAT_ID = "-1004404988937";
const EXCLUDED = ["BTCUSDT", "ETHUSDT", "SOLUSDT", "BNBUSDT", "XRPUSDT", "DOGEUSDT"];
const FIREBASE_DB_URL = "https://mineora-web-default-rtdb.firebaseio.com";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Sinyal durumunu ve sinyal fiyatını Firebase'den okuma
async function getAlertData(symbol, type) {
  try {
    const res = await fetch(`${FIREBASE_DB_URL}/sent_alerts/${symbol}_${type}.json`);
    if (!res.ok) return null;
    return await res.json();
  } catch (err) {
    console.error("Firebase okuma hatası:", err);
  }
  return null;
}

// Sinyal zamanını ve fiyatını kaydetme
async function saveAlertData(symbol, type, data) {
  try {
    await fetch(`${FIREBASE_DB_URL}/sent_alerts/${symbol}_${type}.json`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });
  } catch (err) {
    console.error("Firebase kayıt hatası:", err);
  }
}

// Bitget Açık Pozisyon (OI) Çekme
async function fetchOpenInterest(symbol) {
  try {
    const res = await fetch(`https://api.bitget.com/api/v2/mix/market/open-interest?symbol=${symbol}&productType=USDT-FUTURES`);
    const json = await res.json();
    if (json.code === "00000" && json.data && json.data.openInterestList && json.data.openInterestList[0]) {
      return parseFloat(json.data.openInterestList[0].size || 0);
    }
  } catch (e) {
    console.error("OI çekme hatası:", symbol, e);
  }
  return 0;
}

// Bitget Fonlama Sayacı (Funding Countdown) Çekme
async function fetchFundingCountdown(symbol) {
  try {
    const res = await fetch(`https://api.bitget.com/api/v2/mix/market/current-fund-rate?symbol=${symbol}&productType=USDT-FUTURES`);
    const json = await res.json();
    if (json.code === "00000" && Array.isArray(json.data) && json.data[0]) {
      const nextTime = Number(json.data[0].fundingTime);
      const diffMs = nextTime - Date.now();
      if (diffMs > 0) {
        const hours = Math.floor(diffMs / (1000 * 60 * 60));
        const minutes = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));
        return `${hours}s ${minutes}dk`;
      }
    }
  } catch (e) {
    console.error("Sayaç hatası:", symbol, e);
  }
  return "Bilinmiyor";
}

// Telegram Bildirim Fonksiyonu
async function sendTelegramMessage(text) {
  try {
    const res = await fetch(`https://api.telegram.org/bot${TG_BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: TG_CHAT_ID,
        text: text,
        parse_mode: 'HTML',
        disable_web_page_preview: true
      })
    });
    return await res.json();
  } catch (err) {
    console.error("Telegram gönderme hatası:", err);
    return { ok: false };
  }
}

async function performSingleScan() {
  try {
    const res = await fetch("https://api.bitget.com/api/v2/mix/market/tickers?productType=USDT-FUTURES");
    const json = await res.json();
    if (json.code !== "00000" || !Array.isArray(json.data)) return;

    // Likidite Barajı (En az 800K USDT hacim)
    const liquidPool = json.data.filter(t => {
      return t.symbol.endsWith("USDT") &&
             !EXCLUDED.includes(t.symbol) &&
             parseFloat(t.usdtVolume || 0) >= 800000;
    });

    for (const c of liquidPool) {
      const currentPrice = parseFloat(c.lastPr);
      const funding = parseFloat(c.fundingRate || 0);
      const chg = parseFloat(c.change24h || 0) * 100;
      const volM = (parseFloat(c.usdtVolume || 0) / 1000000).toFixed(2);
      const fundingPct = (funding * 100).toFixed(4);
      const chgFormatted = chg.toFixed(1);

      // ================= KONTROL 1: HEDEF GÖRÜLDÜ / KÂR ALMA & FOMO FRENI =================
      const earlyData = await getAlertData(c.symbol, 'EARLY_ACCUMULATION');
      if (earlyData && earlyData.entryPrice && !earlyData.targetReached) {
        const gainPct = ((currentPrice - earlyData.entryPrice) / earlyData.entryPrice) * 100;
        
        // Fiyat sinyal girişine göre en az +%18 sıçradıysa kâr mesajı gönderilir
        if (gainPct >= 18.0) {
          const targetMsg = `
🛑 <b>MINEORA AVCI | HEDEF GÖRÜLDÜ</b>

🎯 <b>Parite:</b> #${c.symbol}
📈 <b>Gerçekleşen Patlama:</b> +%${gainPct.toFixed(1)} sıçradı!
💵 <b>Mevcut Fiyat:</b> $${currentPrice}

⚠️ <b>YARI YOLDA TRENE ATLAMAYIN!</b>
Tahta tepe testini yaptı. Buradan yeni alım girmek yüksek risk taşır.

💰 <b>Aksiyon:</b> Erken girenler için kâr alma (TP) ve izleme bölgesidir.
🔗 <a href="https://www.bitget.com/futures/usdt/${c.symbol}">Bitget Tahtasını Aç</a>
`.trim();

          const sent = await sendTelegramMessage(targetMsg);
          if (sent.ok) {
            earlyData.targetReached = true;
            earlyData.targetTime = Date.now();
            await saveAlertData(c.symbol, 'EARLY_ACCUMULATION', earlyData);
            console.log(`[HEDEF BİLDİRİMİ ATILDI] ${c.symbol} (+%${gainPct.toFixed(1)})`);
          }
          continue;
        }
      }

      // Fiyatı zaten %8'in üzerinde olan trenleri yeni alım için eliyoruz
      if (chg > 8.0) continue;

      // ================= KONTROL 2: ERKEN PUMP HAZIRLIĞI =================
      if (funding <= -0.0035 && chg >= -4.0 && chg <= 8.0) {
        // 4 saatlik kilit kontrolü
        if (earlyData && (Date.now() - earlyData.timestamp < 14400000)) {
          continue;
        }

        const [oiRaw, countdown] = await Promise.all([
          fetchOpenInterest(c.symbol),
          fetchFundingCountdown(c.symbol)
        ]);
        const oiValM = ((oiRaw * currentPrice) / 1000000).toFixed(2);
        const chgStr = (parseFloat(chgFormatted) >= 0 ? '+' : '') + chgFormatted + '%';

        const alertMsg = `
⚡ <b>MINEORA VIP SENTINEL</b>

🎯 <b>Parite:</b> #${c.symbol}
📊 <b>Yön:</b> 🚀 PUMP HAZIRLIĞI (Short Sıkışması)
💵 <b>Fiyat:</b> $${c.lastPr} (${chgStr})
📈 <b>Fonlama Oranı:</b> %${fundingPct}
⏳ <b>Fonlama Sayacı:</b> ${countdown} kaldı
💼 <b>Açık Pozisyon (OI):</b> $${oiValM}M USDT
💰 <b>24s Hacim:</b> $${volM}M USDT

🔗 <a href="https://www.bitget.com/futures/usdt/${c.symbol}">Bitget Tahtasını Aç</a>
`.trim();

        const sent = await sendTelegramMessage(alertMsg);
        if (sent.ok) {
          await saveAlertData(c.symbol, 'EARLY_ACCUMULATION', {
            timestamp: Date.now(),
            entryPrice: currentPrice,
            targetReached: false
          });
          console.log(`[ERKEN PUMP SİNYALİ ATILDI] ${c.symbol}`);
        }
        continue;
      }

      // ================= KONTROL 3: DUMP HAZIRLIĞI =================
      if (funding >= 0.015 && chg >= -5.0 && chg <= 10.0) {
        const dumpData = await getAlertData(c.symbol, 'DUMP_RISK');
        if (dumpData && (Date.now() - dumpData.timestamp < 14400000)) {
          continue;
        }

        const [oiRaw, countdown] = await Promise.all([
          fetchOpenInterest(c.symbol),
          fetchFundingCountdown(c.symbol)
        ]);
        const oiValM = ((oiRaw * currentPrice) / 1000000).toFixed(2);
        const chgStr = (parseFloat(chgFormatted) >= 0 ? '+' : '') + chgFormatted + '%';

        const alertMsg = `
🚨 <b>MINEORA VIP SENTINEL</b>

🎯 <b>Parite:</b> #${c.symbol}
📊 <b>Yön:</b> 🩸 DUMP HAZIRLIĞI (Aşırı Long Tuzağı)
💵 <b>Fiyat:</b> $${c.lastPr} (${chgStr})
📈 <b>Fonlama Oranı:</b> %${fundingPct}
⏳ <b>Fonlama Sayacı:</b> ${countdown} kaldı
💼 <b>Açık Pozisyon (OI):</b> $${oiValM}M USDT
💰 <b>24s Hacim:</b> $${volM}M USDT

🔗 <a href="https://www.bitget.com/futures/usdt/${c.symbol}">Bitget Tahtasını Aç</a>
`.trim();

        const sent = await sendTelegramMessage(alertMsg);
        if (sent.ok) {
          await saveAlertData(c.symbol, 'DUMP_RISK', {
            timestamp: Date.now(),
            entryPrice: currentPrice
          });
          console.log(`[DUMP SİNYALİ ATILDI] ${c.symbol}`);
        }
        continue;
      }
    }
  } catch (err) {
    console.error("Avcı tarama hatası:", err);
  }
}

export default async function handler(req, res) {
  await performSingleScan();
  await sleep(25000);
  await performSingleScan();
  return res.status(200).json({ success: true, timestamp: Date.now() });
}
