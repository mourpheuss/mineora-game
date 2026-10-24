// api/cron-scan.js
const TG_BOT_TOKEN = "8682225307:AAHaa-hieKBBluU6uZ2_-OgSPxGR7OwMssE";
const TG_CHAT_ID = "-1004404988937";
const EXCLUDED = ["BTCUSDT", "ETHUSDT", "SOLUSDT", "BNBUSDT", "XRPUSDT", "DOGEUSDT"];

// Bellek içi spam önleme (aynı pariteye 4 saat içinde tek sinyal)
let memoryAlerts = global._sentAlerts || {};
global._sentAlerts = memoryAlerts;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function sendTelegramAlert(coin, type, fundingFormatted, volFormatted, desc, chgFormatted) {
  const now = Date.now();
  const alertKey = `${coin.symbol}_${type}`;

  if (memoryAlerts[alertKey] && (now - memoryAlerts[alertKey] < 4 * 60 * 60 * 1000)) {
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
      memoryAlerts[alertKey] = now;
      console.log(`[VIP CRON ALERT] ${coin.symbol} iletildi.`);
    }
  } catch (err) {
    console.error("Cron Telegram hatası:", err);
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

    // 1. Squeeze Adayları (<= -0.015)
    const pumpCandidates = liquidPool.filter(t => {
      return parseFloat(t.fundingRate || 0) <= -0.015;
    });

    // 2. Dump Adayları (>= 0.020 veya +20% & >= 0.010)
    const dumpCandidates = liquidPool.filter(t => {
      const funding = parseFloat(t.fundingRate || 0);
      const chg = parseFloat(t.change24h || 0) * 100;
      return funding >= 0.020 || (chg >= 20 && funding >= 0.010);
    });

    // Pump sinyallerini işle
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

    // Dump sinyallerini işle
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
  // 1. Döngü: Anında tara
  await performSingleScan();

  // 25 saniye bekle
  await sleep(25000);

  // 2. Döngü: 25. saniyede tekrar tara
  await performSingleScan();

  return res.status(200).json({ success: true, timestamp: Date.now() });
}
