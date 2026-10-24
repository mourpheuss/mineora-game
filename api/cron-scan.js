// api/cron-scan.js
const TG_BOT_TOKEN = "8682225307:AAHaa-hieKBBluU6uZ2_-OgSPxGR7OwMssE";
const TG_CHAT_ID = "-1004404988937";
const EXCLUDED = ["BTCUSDT", "ETHUSDT", "SOLUSDT", "BNBUSDT", "XRPUSDT", "DOGEUSDT"];
const FIREBASE_DB_URL = "https://mineora-web-default-rtdb.firebaseio.com";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Firebase REST API ile 4 saatlik kilit kontrolü
async function isAlertOnCooldown(symbol, type) {
  try {
    const res = await fetch(`${FIREBASE_DB_URL}/sent_alerts/${symbol}_${type}.json`);
    if (!res.ok) return false;
    const lastSentTime = await res.json();
    if (lastSentTime && (Date.now() - Number(lastSentTime) < 14400000)) { // 4 Saatlik Kilit (14.400.000 ms)
      return true;
    }
  } catch (err) {
    console.error("Firebase kontrol hatası:", err);
  }
  return false;
}

// Gönderilen mesajı Firebase'e kaydetme
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

async function sendTelegramAlert(coin, type, fundingFormatted, volFormatted, desc, chgFormatted) {
  // 1. Kilit kontrolü: 4 saat dolmadıysa KESİNLİKLE kanala gitmez
  const onCooldown = await isAlertOnCooldown(coin.symbol, type);
  if (onCooldown) {
    console.log(`[ENGEL] ${coin.symbol} (${type}) için 4 saatlik kilit aktif, mesaj atılmadı.`);
    return;
  }

  let icon = '🚀';
  let title = 'MEGA SQUEEZE (PATLAMA FIRSATI)';

  if (type === 'PUMP_COMPLETED') {
    icon = '🏁';
    title = 'HEDEF GÖRÜLDÜ / KÂR REALİZASYONU';
  } else if (type === 'DUMP') {
    icon = '🚨';
    title = 'AŞIRI KALDIRAÇ (ÇÖKÜŞ KALKANI)';
  }

  const text = `${icon} <b>MINEORA VIP SENTINEL RADAR</b>\n<b>${title}</b>\n\n🪙 <b>Parite:</b> #${coin.symbol}\n💵 <b>Mevcut Fiyat:</b> $${coin.lastPr} (${chgFormatted ? (chgFormatted >= 0 ? '+' : '') + chgFormatted + '%' : ''})\n📊 <b>Fonlama Oranı:</b> %${fundingFormatted}\n💰 <b>24s Vadeli Hacim:</b> $${volFormatted}M USDT\n\n📌 <b>Radar Analizi:</b>\n${desc}\n\n⏰ <b>Zaman:</b> ${new Date().toLocaleTimeString('tr-TR', { timeZone: 'Europe/Istanbul' })}\n🔗 <a href="https://www.bitget.com/futures/usdt/${coin.symbol}">Bitget Tahtasını Görüntüle</a>`;

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
      // 2. Mesaj başarıyla gittikten hemen sonra Firebase'e mühür vurulur
      await markAlertAsSent(coin.symbol, type);
      console.log(`[VIP ALERT GÖNDERİLDİ VE KİLİTLENDİ] ${coin.symbol} (${type})`);
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

    const liquidPool = json.data.filter(t => {
      return t.symbol.endsWith("USDT") &&
             !EXCLUDED.includes(t.symbol) &&
             parseFloat(t.usdtVolume || 0) >= 1200000;
    });

    const pumpCandidates = liquidPool.filter(t => {
      return parseFloat(t.fundingRate || 0) <= -0.015;
    });

    const dumpCandidates = liquidPool.filter(t => {
      const funding = parseFloat(t.fundingRate || 0);
      const chg = parseFloat(t.change24h || 0) * 100;
      return funding >= 0.020 || (chg >= 20 && funding >= 0.010);
    });

    // Pump / Squeeze Taraması
    for (const c of pumpCandidates) {
      const funding = (parseFloat(c.fundingRate || 0) * 100).toFixed(4);
      const vol = (parseFloat(c.usdtVolume || 0) / 1000000).toFixed(2);
      const chg = (parseFloat(c.change24h || 0) * 100).toFixed(1);

      if (parseFloat(chg) >= 15) {
        await sendTelegramAlert(
          c,
          'PUMP_COMPLETED',
          funding,
          vol,
          `Short squeeze dalgası yaşandı (+${chg}% sıçradı). Zirve test edildi; yeni pozisyon açmak yüksek risk taşır. Kâr alma ve izleme bölgesidir.`,
          chg
        );
      } else {
        await sendTelegramAlert(
          c,
          'PUMP',
          funding,
          vol,
          'Aşırı negatif fonlama birikimi. Short pozisyonlar sıkıştı, tahta yukarı patlama (Short Squeeze) hazırlığında.',
          chg
        );
      }
    }

    // Dump Taraması
    for (const c of dumpCandidates) {
      const funding = (parseFloat(c.fundingRate || 0) * 100).toFixed(4);
      const vol = (parseFloat(c.usdtVolume || 0) / 1000000).toFixed(2);
      const chg = (parseFloat(c.change24h || 0) * 100).toFixed(1);
      await sendTelegramAlert(
        c,
        'DUMP',
        funding,
        vol,
        'Aşırı pozitif fonlama ve kontrolsüz Long yığılması. Sert tasfiye ve çöküş (Dump) riski bulunuyor.',
        chg
      );
    }
  } catch (err) {
    console.error("Tarama hatası:", err);
  }
}

export default async function handler(req, res) {
  await performSingleScan();
  await sleep(25000);
  await performSingleScan();
  return res.status(200).json({ success: true, timestamp: Date.now() });
}
