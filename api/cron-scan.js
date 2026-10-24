// api/cron-scan.js
const TG_BOT_TOKEN = "8682225307:AAHaa-hieKBBluU6uZ2_-OgSPxGR7OwMssE";
const TG_CHAT_ID = "-1004404988937";
const EXCLUDED = ["BTCUSDT", "ETHUSDT", "SOLUSDT", "BNBUSDT", "XRPUSDT", "DOGEUSDT"];
const FIREBASE_DB_URL = "https://mineora-web-default-rtdb.firebaseio.com";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// 4 saatlik mükerrer bildirim kilidi
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

// Paritenin Açık Pozisyon (Open Interest) verisini Bitget'ten anlık çeker
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

async function sendTelegramAlert(coin, type, fundingFormatted, volFormatted, oiFormatted, desc, chgFormatted) {
  const onCooldown = await isAlertOnCooldown(coin.symbol, type);
  if (onCooldown) return;

  let icon = '⚡';
  let title = 'BALİNA AKÜMÜLASYONU (PATLAMA ÖNCESİ SIKIŞMA)';

  if (type === 'DUMP_RISK') {
    icon = '🚨';
    title = 'AŞIRI KALDIRAÇ TUZAĞI (ÇÖKÜŞ ÖNCESİ)';
  }

  const chgStr = (parseFloat(chgFormatted) >= 0 ? '+' : '') + chgFormatted + '%';
  const text = `${icon} <b>MINEORA VIP SENTINEL AVCI RADARI</b>\n<b>${title}</b>\n\n🪙 <b>Parite:</b> #${coin.symbol}\n💵 <b>Mevcut Fiyat:</b> $${coin.lastPr} (${chgStr})\n📊 <b>Fonlama Oranı:</b> %${fundingFormatted}\n📈 <b>Açık Pozisyon (OI):</b> $${oiFormatted}M USDT\n💰 <b>24s Vadeli Hacim:</b> $${volFormatted}M USDT\n\n📌 <b>Balina Ayak İzi Teşhisi:</b>\n${desc}\n\n⏰ <b>Zaman:</b> ${new Date().toLocaleTimeString('tr-TR', { timeZone: 'Europe/Istanbul' })}\n🔗 <a href="https://www.bitget.com/futures/usdt/${coin.symbol}">Bitget Tahtasını İncele</a>`;

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
      console.log(`[AVCI SİNYALİ ATILDI] ${coin.symbol} (${type})`);
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

      // 1. KURAL: TRENİ KAÇMIŞ COINLERİ ANINDA ELE (Zirveye oturmuş coinleri almayız)
      if (chg > 8.0) {
        continue;
      }

      // 2. KURAL: GERÇEK BALİNA SIKIŞTIRMASI (SHORT SQUEEZE HAZIRLIĞI)
      // Fiyat henüz yatay/sakin (-4% ile +8% arası) VE Fonlama Negatif (<= -0.0035 yani % -0.35)
      if (funding <= -0.0035 && chg >= -4.0 && chg <= 8.0) {
        // Balinanın tahtaya soktuğu Açık Pozisyonu (OI) kontrol et
        const oiRaw = await fetchOpenInterest(c.symbol);
        const oiValM = ((oiRaw * parseFloat(c.lastPr)) / 1000000).toFixed(2);

        await sendTelegramAlert(
          c,
          'EARLY_ACCUMULATION',
          fundingPct,
          volM,
          oiValM,
          `Fiyat henüz patlamadı (${chgFormatted}%). Tahtaya $${oiValM}M açık pozisyon girmiş ve Short'lar negatif fonlamada sıkışmış. Balina alttan topluyor; yukarı yönlü patlama an meselesi!`,
          chgFormatted
        );
        continue;
      }

      // 3. KURAL: DUMP & TASFİYE KALKANI (Aşırı Şişkin Long Tuzağı)
      // Fiyat sakin/tepede ama fonlama aşırı şişmiş (>= +0.015 yani % +1.50)
      if (funding >= 0.015 && chg >= -5.0 && chg <= 10.0) {
        const oiRaw = await fetchOpenInterest(c.symbol);
        const oiValM = ((oiRaw * parseFloat(c.lastPr)) / 1000000).toFixed(2);

        await sendTelegramAlert(
          c,
          'DUMP_RISK',
          fundingPct,
          volM,
          oiValM,
          `Fiyat henüz çökmedi ancak tahtada küçük yatırımcı Long tarafına yığılmış (+%${fundingPct} fonlama). Ani balina satışında seri likidasyon çöküşü gelebilir!`,
          chgFormatted
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
