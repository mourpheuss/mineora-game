export default async function handler(req, res) {
  try {
    const browserHeaders = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept': 'application/json'
    };

    const TG_BOT_TOKEN = "8682225307:AAHaa-hieKBBluU6uZ2_-OgSPxGR7OwMssE";
    const TG_ADMIN_ID = "6457294906";
    const FIREBASE_BASE_URL = "https://mineora-web-default-rtdb.firebaseio.com";
    const TWO_HOURS_MS = 2 * 60 * 60 * 1000;
    const now = Date.now();

    // 1. Bitget Ticker Verilerini Çek
    const tickersRes = await fetch("https://api.bitget.com/api/v2/mix/market/tickers?productType=USDT-FUTURES", { headers: browserHeaders });
    const tickersJson = await tickersRes.json();

    if (tickersJson.code !== '00000' || !Array.isArray(tickersJson.data)) {
      return res.status(500).json({ error: "Bitget verisi alınamadı." });
    }

    const EXCLUDED = ["BTCUSDT", "ETHUSDT", "SOLUSDT", "BNBUSDT", "XRPUSDT", "DOGEUSDT"];
    const pool = tickersJson.data.filter(t => 
      t.symbol.endsWith("USDT") && 
      !EXCLUDED.includes(t.symbol) && 
      parseFloat(t.usdtVolume || 0) >= 800000
    );

    // 2. Firebase'deki Son Sinyalleri Oku
    let activeTrades = {};
    let lastSignals = {};
    try {
      const [atRes, lsRes] = await Promise.all([
        fetch(`${FIREBASE_BASE_URL}/active_trades.json`),
        fetch(`${FIREBASE_BASE_URL}/last_signals.json`)
      ]);
      activeTrades = (await atRes.json()) || {};
      lastSignals = (await lsRes.json()) || {};
    } catch (e) {
      activeTrades = {};
      lastSignals = {};
    }

    // SPAM KİLİDİ 1: Halihazırda son 2 saatte açılmış ve durumu OPEN olan işlem varsa bekle
    const hasOpenTrade = Object.values(activeTrades).some(t => {
      if (!t || t.status !== 'OPEN') return false;
      const tTime = t.createdAt || (t.timestamp ? new Date(t.timestamp).getTime() : 0);
      return (now - tTime) <= TWO_HOURS_MS;
    });

    if (hasOpenTrade) {
      return res.status(200).json({ status: "IDLE", message: "Takip edilen açık işlem bulunuyor, yeni sinyal kilitli." });
    }

    // 3. ANLIK HAREKET & İLK MUM DÖNÜŞ MOTORU (5. MUMU BEKLEMEYEN ALGORİTMA)
    let candidate = null;
    let direction = null;

    for (const item of pool) {
      // SPAM KİLİDİ 2: Bu pariteye son 2 saatte bildirim gittiyse ASLA tekrar atma
      const lastSentTime = lastSignals[item.symbol] || 0;
      if (now - lastSentTime < TWO_HOURS_MS) continue;

      const price = parseFloat(item.lastPr || 0);
      const high24 = parseFloat(item.high24h || 0);
      const low24 = parseFloat(item.low24h || 0);
      if (price <= 0 || high24 <= low24) continue;

      // Fiyatın gün içi bandındaki yeri (0 = Günün Dibi, 1 = Günün Tepesi)
      const rangePosition = (price - low24) / (high24 - low24);

      // Son 50 İşlemdeki Piyasa Alış / Satış Akışı (Tape Flow)
      const fillsRes = await fetch(`https://api.bitget.com/api/v2/mix/market/fills?symbol=${item.symbol}&productType=usdt-futures&limit=40`, { headers: browserHeaders })
        .then(r => r.json()).catch(() => ({}));

      const fills = fillsRes.data?.fillList || fillsRes.data || [];
      let buyVol = 0;
      let sellVol = 0;

      if (Array.isArray(fills)) {
        fills.forEach(f => {
          const val = parseFloat(f.price || 0) * parseFloat(f.size || 0);
          if (f.side === 'buy') buyVol += val;
          else sellVol += val;
        });
      }

      const totalFlow = buyVol + sellVol;
      const buyPct = totalFlow > 0 ? (buyVol / totalFlow) * 100 : 50;

      // HAREKETİ İLK MUMDA YAKALAMA KURALLARI:
      // LONG (Dipte Dönüş): Fiyat günün alt çeyreğinde (rangePosition <= 0.35) ve son işlemlerde ani alıcı akını var (%62+ alım)
      const isEarlyLongReversal = (rangePosition <= 0.35) && (buyPct >= 62);

      // SHORT (Tepede Dönüş): Fiyat günün üst çeyreğinde (rangePosition >= 0.70) ve aniden satış baskısı başladı (%38 altı alım)
      const isEarlyShortReversal = (rangePosition >= 0.70) && (buyPct <= 38);

      if (isEarlyLongReversal) {
        candidate = item;
        direction = 'LONG';
        break;
      }

      if (isEarlyShortReversal) {
        candidate = item;
        direction = 'SHORT';
        break;
      }
    }

    if (!candidate) {
      return res.status(200).json({ status: "SCANNING", message: "İlk mum dönüşü ve dip/tepe hacim patlaması taranıyor." });
    }

    // 4. Hedef ve Stop Seviyeleri (Dar Stop, Geniş TP)
    const entryPrice = parseFloat(candidate.lastPr);
    const isLong = direction === 'LONG';
    const tp1 = isLong ? entryPrice * 1.018 : entryPrice * 0.982;
    const tp2 = isLong ? entryPrice * 1.038 : entryPrice * 0.962;
    const sl = isLong ? entryPrice * 0.988 : entryPrice * 1.012;

    const tradeId = `trade_${Date.now()}`;
    const newTrade = {
      id: tradeId,
      symbol: candidate.symbol,
      direction: direction,
      entryPrice,
      tp1,
      tp2,
      sl,
      status: 'OPEN',
      createdAt: now,
      timestamp: new Date().toISOString()
    };

    // 5. KESİN KİLİTLEME: Önce Firebase'e Yaz, Onay Alınmadan Telegram'a ASLA Mesaj Atma
    const fbTradePromise = fetch(`${FIREBASE_BASE_URL}/active_trades/${tradeId}.json`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(newTrade)
    });

    const fbLockPromise = fetch(`${FIREBASE_BASE_URL}/last_signals/${candidate.symbol}.json`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(now)
    });

    const [fbRes1, fbRes2] = await Promise.all([fbTradePromise, fbLockPromise]);

    if (!fbRes1.ok) {
      return res.status(500).json({ error: "Firebase veritabanına kayıt yapılamadı, bildirim iptal edildi." });
    }

    // 6. Firebase Onaylandıktan Sonra Telegram Bildirimini Fırlat (Spam İmkansız)
    const pStr = entryPrice < 1 ? entryPrice.toFixed(6) : entryPrice.toFixed(4);
    const tp1Str = tp1 < 1 ? tp1.toFixed(6) : tp1.toFixed(4);
    const tp2Str = tp2 < 1 ? tp2.toFixed(6) : tp2.toFixed(4);
    const slStr = sl < 1 ? sl.toFixed(6) : sl.toFixed(4);

    const tgMsg = `🎯 <b>MINEORA SENTINEL | ANLIK ERKEN SİNYAL</b>\n` +
                  `━━━━━━━━━━━━━━━━━━━━\n` +
                  `💎 <b>Parite:</b> #${candidate.symbol}\n` +
                  `🧭 <b>Yön:</b> ${direction === 'LONG' ? '🟢 LONG (Dip Dönüşü)' : '🔴 SHORT (Tepe Dağıtımı)'}\n` +
                  `💵 <b>Giriş Seviyesi:</b> <code>$${pStr}</code>\n` +
                  `━━━━━━━━━━━━━━━━━━━━\n` +
                  `🎯 <b>Hedef 1:</b> <code>$${tp1Str}</code> (+%1.8)\n` +
                  `🚀 <b>Hedef 2:</b> <code>$${tp2Str}</code> (+%3.8)\n` +
                  `🛑 <b>Stop-Loss:</b> <code>$${slStr}</code> (-%1.2)\n` +
                  `━━━━━━━━━━━━━━━━━━━━\n` +
                  `⚡ <i>Hacim patlaması 1. mumda yakalanmıştır.</i>`;

    await fetch(`https://api.telegram.org/bot${TG_BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: TG_ADMIN_ID, text: tgMsg, parse_mode: 'HTML' })
    }).catch(() => {});

    return res.status(200).json({ success: true, trade: newTrade });

  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}
