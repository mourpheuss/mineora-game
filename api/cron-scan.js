// api/cron-scan.js
const TG_BOT_TOKEN = "8682225307:AAHaa-hieKBBluU6uZ2_-OgSPxGR7OwMssE";
const TG_CHAT_ID = "-1004404988937";
const EXCLUDED = ["BTCUSDT", "ETHUSDT", "SOLUSDT", "BNBUSDT", "XRPUSDT", "DOGEUSDT"];
const FIREBASE_DB_URL = "https://mineora-web-default-rtdb.firebaseio.com";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function isAlertOnCooldown(symbol, type) {
  try {
    const res = await fetch(`${FIREBASE_DB_URL}/sent_alerts/${symbol}_${type}.json`);
    if (!res.ok) return false;
    const lastSentTime = await res.json();
    if (lastSentTime && (Date.now() - Number(lastSentTime) < 14400000)) { // 4 saat kilit
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

  let icon = '⚡';
  let title = 'BALİNA SIKIŞTIRMA RADARI (PATLAMA ÖNCESİ)';

  if (type === 'DUMP_RISK') {
    icon = '🚨';
    title = 'AŞIRI KALDIRAÇ TUZAĞI (ÇÖKÜŞ ÖNCESİ)';
  }

  const chgStr = (parseFloat(chgFormatted) >= 0 ? '+' : '') + chgFormatted + '%';
  const text = `${icon} <b>MINEORA VIP SENTINEL RADAR</b>\n<b>${title}</b>\n\n🪙 <b>Parite:</b> #${coin.symbol}\n💵 <b>Mevcut Fiyat:</b> $${coin.lastPr} (${chgStr})\n📊 <b>Fonlama Oranı:</b> %${fundingFormatted}\n💰 <b>24s Vadeli Hacim:</b> $${volFormatted}M USDT\n\n📌 <b>Balina Ayak İzi Teşhisi:</b>\n${desc}\n\n⏰ <b>Zaman:</b> ${new Date().toLocaleTimeString('tr-TR', { timeZone: 'Europe/Istanbul' })}\n🔗 <a href="https://www.bitget.com/futures/usdt/${coin.symbol}">Bitget Tahtasını İncele</a>`;

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
      console.log(`[ERKEN SİNYAL GÖNDERİLDİ] ${coin.symbol} (${type})`);
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

    // Likidite Havuzu (800K hacim üzeri)
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

      // KURAL 1: UÇMUŞ COINLERİ TAMAMEN ENGELLE (+12% üzeri kesinlikle erken sinyal DEĞİLDİR)
      if (chg > 12.0) {
        continue; // Zaten fırlamış, arkasından kovalamıyoruz!
      }

      // KURAL 2: ERKEN PUMP / SHORT SQUEEZE (Fiyat henüz tabanda ama fonlama negatif sıkışmış)
      // Şart: Fiyat -4% ile +10% arasında, Fonlama <= -0.0035 (-%0.35)
      if (funding <= -0.0035 && chg >= -4.0 && chg <= 10.0) {
        await sendTelegramAlert(
          c,
          'EARLY_SQUEEZE',
          fundingPct,
          volM,
          `Fiyat henüz fırlamadı (${chgFormatted}%). Tahtada Short pozisyonlar negatif fonlamada sıkışmış durumda. Balina fitili ateşlediğinde yukarı sert patlama potansiyeli yüksek!`,
          chgFormatted
        );
        continue;
      }

      // KURAL 3: ERKEN DUMP / TASFİYE KALKANI (Fiyat tepede veya yatay, fonlama aşırı şişmiş)
      // Şart: Fonlama >= 0.015 (+%1.50)
      if (funding >= 0.015 && chg >= -5.0 && chg <= 12.0) {
        await sendTelegramAlert(
          c,
          'DUMP_RISK',
          fundingPct,
          volM,
          `Tahtada kontrolsüz Long yığılması var. Fiyat henüz çökmedi ancak ters bir balina satışında seri likidasyon çöküşü yaşanabilir. Kaldıraçlı Long girmeyin!`,
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
