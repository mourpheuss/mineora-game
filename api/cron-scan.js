// api/cron-scan.js
const TG_BOT_TOKEN = "8682225307:AAHaa-hieKBBluU6uZ2_-OgSPxGR7OwMssE";
const TG_CHAT_ID = "-1004404988937";
const EXCLUDED = ["BTCUSDT", "ETHUSDT", "SOLUSDT", "BNBUSDT", "XRPUSDT", "DOGEUSDT"];
const FIREBASE_DB_URL = "https://mineora-web-default-rtdb.firebaseio.com";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Firebase REST API ile 4 saatlik kilit kontrolü (Aynı coin 4 saatte en fazla 1 kez gider)
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

async function sendTelegramAlert(coin, type, fundingFormatted, volFormatted, desc, chgFormatted) {
  const onCooldown = await isAlertOnCooldown(coin.symbol, type);
  if (onCooldown) return;

  let icon = '🚀';
  let title = 'MEGA BALİNA PUMP / PATLAMA';

  if (type === 'SQUEEZE') {
    icon = '⚡';
    title = 'SHORT SQUEEZE (FONLAMA SIKIŞMASI)';
  } else if (type === 'DUMP') {
    icon = '🚨';
    title = 'AŞIRI KALDIRAÇ (ÇÖKÜŞ KALKANI)';
  }

  const chgStr = chgFormatted ? (parseFloat(chgFormatted) >= 0 ? '+' : '') + chgFormatted + '%' : '';
  const text = `${icon} <b>MINEORA VIP SENTINEL RADAR</b>\n<b>${title}</b>\n\n🪙 <b>Parite:</b> #${coin.symbol}\n💵 <b>Mevcut Fiyat:</b> $${coin.lastPr} (${chgStr})\n📊 <b>Fonlama Oranı:</b> %${fundingFormatted}\n💰 <b>24s Hacim:</b> $${volFormatted}M USDT\n\n📌 <b>Radar Analizi:</b>\n${desc}\n\n⏰ <b>Zaman:</b> ${new Date().toLocaleTimeString('tr-TR', { timeZone: 'Europe/Istanbul' })}\n🔗 <a href="https://www.bitget.com/futures/usdt/${coin.symbol}">Bitget Tahtasını Görüntüle</a>`;

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
      console.log(`[ALERT BAŞARILI] ${coin.symbol} (${type})`);
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

    // Likidite Havuzu (800K USDT barajı)
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

      // KURAL 1: BÜYÜK PATLAMA (BIRB, IRYS vb. +20% ve üzeri sert hacimli yükselenler)
      if (chg >= 20.0) {
        await sendTelegramAlert(
          c,
          'MEGA_PUMP',
          fundingPct,
          volM,
          `Tahtada agresif alım hacmi tespit edildi (+${chgFormatted}%). Yüksek volatilite ve güçlü momentum dalgası devrede.`,
          chgFormatted
        );
        continue;
      }

      // KURAL 2: ERKEN SHORT SQUEEZE (Fonlama Negatif: <= -0.005 ve Fiyat 0 ile +20% arasında hazırlıkta)
      if (funding <= -0.005 && chg >= 0 && chg < 20) {
        await sendTelegramAlert(
          c,
          'SQUEEZE',
          fundingPct,
          volM,
          `Vadeli tahtada Short pozisyonlar aşırı sıkıştı. Negatif fonlama baskısı yukarı patlamayı tetikleyebilir.`,
          chgFormatted
        );
        continue;
      }

      // KURAL 3: DUMP KALKANI (Aşırı Long Şişmesi)
      if (funding >= 0.015 || (chg >= 25 && funding >= 0.008)) {
        await sendTelegramAlert(
          c,
          'DUMP',
          fundingPct,
          volM,
          `Paritede aşırı kaldıraç ve küçük yatırımcı Long yığılması var. Ani tasfiye ve sert çöküş riski yüksek.`,
          chgFormatted
        );
        continue;
      }
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
