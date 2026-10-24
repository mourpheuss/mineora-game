// api/cron-scan.js
const TG_BOT_TOKEN = "8682225307:AAHaa-hieKBBluU6uZ2_-OgSPxGR7OwMssE";
const TG_CHAT_ID = "-1004404988937";
const EXCLUDED = ["BTCUSDT", "ETHUSDT", "SOLUSDT", "BNBUSDT", "XRPUSDT", "DOGEUSDT"];
const FIREBASE_DB_URL = "https://mineora-web-default-rtdb.firebaseio.com";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// 4 saatlik mükerrer kilit kontrolü
async function isAlertOnCooldown(symbol, type) {
  try {
    const res = await fetch(`${FIREBASE_DB_URL}/sent_alerts/${symbol}_${type}.json`);
    if (!res.ok) return false;
    const lastSentTime = await res.json();
    if (lastSentTime && (Date.now() - Number(lastSentTime) < 14400000)) {
      return true;
    }
  } catch (err) {
    console.error("Firebase kontrol hatası:", err);
  }
  return false;
}

async function markAlertAsSent(symbol, type) {
  try {
    await fetch(`${FIREBASE_DB_URL}/sent_alerts/${symbol}_${type}.json`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(Date.now())
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

async function sendTelegramAlert(coin, type, fundingFormatted, volFormatted, oiFormatted, chgFormatted, countdownStr) {
  const onCooldown = await isAlertOnCooldown(coin.symbol, type);
  if (onCooldown) return;

  const isPump = type === 'EARLY_ACCUMULATION';
  const icon = isPump ? '⚡' : '🚨';
  const yonStr = isPump ? '🚀 PUMP HAZIRLIĞI (Short Sıkışması)' : '🩸 DUMP HAZIRLIĞI (Aşırı Long Tuzağı)';
  const chgStr = (parseFloat(chgFormatted) >= 0 ? '+' : '') + chgFormatted + '%';

  // Sade, laf kalabalığı olmayan, şık mesaj şablonu
  const text = `
${icon} <b>MINEORA VIP SENTINEL</b>

🎯 <b>Parite:</b> #${coin.symbol}
📊 <b>Yön:</b> <b>${yonStr}</b>
💵 <b>Fiyat:</b> $${coin.lastPr} (${chgStr})
📈 <b>Fonlama Oranı:</b> %${fundingFormatted}
⏳ <b>Fonlama Sayacı:</b> ${countdownStr} kaldı
💼 <b>Açık Pozisyon (OI):</b> $${oiFormatted}M USDT
💰 <b>24s Hacim:</b> $${volFormatted}M USDT

🔗 <a href="https://www.bitget.com/futures/usdt/${coin.symbol}">Bitget Tahtasını Aç</a>
`.trim();

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
    const data = await res.json();
    if (data.ok) {
      await markAlertAsSent(coin.symbol, type);
      console.log(`[SADE ALERT GÖNDERİLDİ] ${coin.symbol} (${type})`);
    }
  } catch (err) {
    console.error("Telegram gönderme hatası:", err);
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
      const funding = parseFloat(c.fundingRate || 0);
      const chg = parseFloat(c.change24h || 0) * 100;
      const volM = (parseFloat(c.usdtVolume || 0) / 1000000).toFixed(2);
      const fundingPct = (funding * 100).toFixed(4);
      const chgFormatted = chg.toFixed(1);

      // Fiyatı zaten %8'in üzerine çıkmış olan trenleri es geçiyoruz
      if (chg > 8.0) continue;

      // 1. PUMP HAZIRLIĞI (Fiyat sakin, fonlama negatif sıkışmış)
      if (funding <= -0.0035 && chg >= -4.0 && chg <= 8.0) {
        const [oiRaw, countdown] = await Promise.all([
          fetchOpenInterest(c.symbol),
          fetchFundingCountdown(c.symbol)
        ]);
        const oiValM = ((oiRaw * parseFloat(c.lastPr)) / 1000000).toFixed(2);

        await sendTelegramAlert(
          c,
          'EARLY_ACCUMULATION',
          fundingPct,
          volM,
          oiValM,
          chgFormatted,
          countdown
        );
        continue;
      }

      // 2. DUMP HAZIRLIĞI (Fiyat sakin/tepede, aşırı pozitif fonlama tuzağı)
      if (funding >= 0.015 && chg >= -5.0 && chg <= 10.0) {
        const [oiRaw, countdown] = await Promise.all([
          fetchOpenInterest(c.symbol),
          fetchFundingCountdown(c.symbol)
        ]);
        const oiValM = ((oiRaw * parseFloat(c.lastPr)) / 1000000).toFixed(2);

        await sendTelegramAlert(
          c,
          'DUMP_RISK',
          fundingPct,
          volM,
          oiValM,
          chgFormatted,
          countdown
        );
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
