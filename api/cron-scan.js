export default async function handler(req, res) {
  try {
    const browserHeaders = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept': 'application/json'
    };

    const TG_BOT_TOKEN = "8682225307:AAHaa-hieKBBluU6uZ2_-OgSPxGR7OwMssE";
    const TG_ADMIN_ID = "6457294906";
    const FIREBASE_BASE_URL = "https://mineora-web-default-rtdb.firebaseio.com";

    // 1. Bitget Vadeli Ticker Listesini Çek
    const tickersRes = await fetch("https://api.bitget.com/api/v2/mix/market/tickers?productType=USDT-FUTURES", { headers: browserHeaders });
    const tickersJson = await tickersRes.json();

    if (tickersJson.code !== '00000' || !Array.isArray(tickersJson.data)) {
      return res.status(500).json({ error: "Bitget ticker verisi alınamadı." });
    }

    const EXCLUDED = ["BTCUSDT", "ETHUSDT", "SOLUSDT", "BNBUSDT", "XRPUSDT", "DOGEUSDT"];
    
    // Yalnızca yeterli likiditeye sahip pariteler
    const pool = tickersJson.data.filter(t => 
      t.symbol.endsWith("USDT") && 
      !EXCLUDED.includes(t.symbol) && 
      parseFloat(t.usdtVolume || 0) >= 1500000
    );

    // 2. Mevcut Açık İşlemleri Kontrol Et
    let activeTrades = {};
    try {
      const atRes = await fetch(`${FIREBASE_BASE_URL}/active_trades.json`);
      activeTrades = (await atRes.json()) || {};
    } catch (e) { activeTrades = {}; }

    const now = Date.now();
    const THREE_HOURS_MS = 3 * 60 * 60 * 1000;

    // Halihazırda açık bir işlem var mı?
    const hasOpenTrade = Object.values(activeTrades).some(t => {
      if (!t || t.status !== 'OPEN') return false;
      const tTime = t.timestamp ? new Date(t.timestamp).getTime() : (t.createdAt || now);
      return (now - tTime) <= THREE_HOURS_MS;
    });

    if (hasOpenTrade) {
      return res.status(200).json({ status: "IDLE", message: "Zaten açık bir işlem takip ediliyor." });
    }

    // 3. GELİŞMİŞ KURUMSAL FİLTRELEME & SIKIŞMA TARAMASI
    let selectedCandidate = null;
    let selectedDirection = null;

    for (const item of pool) {
      const funding = parseFloat(item.fundingRate || 0);
      const chg24h = parseFloat(item.change24h || 0) * 100;
      const price = parseFloat(item.lastPr || 0);

      if (price <= 0) continue;

      // --- LONG ŞARTLARI (TUZAKLARDAN ARINDIRILMIŞ) ---
      // 1. Fonlama eksi olmalı (-%0.02 veya daha negatif)
      // 2. Parite aşırı çöküşte OLMAMALI (24s düşüş -%3.5'ten fazla ise serbest düşüş sayılır, girilmez)
      // 3. Fiyat aşırı şişmemiş olmalı (< +8%)
      const isLongCandidate = (funding <= -0.0002) && (chg24h >= -3.5) && (chg24h <= 8.0);

      // --- SHORT ŞARTLARI ---
      // 1. Fonlama pozitif (+%0.02+)
      // 2. Fiyat primli (+7% ve üzeri)
      const isShortCandidate = (funding >= 0.0002) && (chg24h >= 7.0);

      if (!isLongCandidate && !isShortCandidate) continue;

      // 4. İKİNCİ AŞAMA: EMİR DEFTERİ & TAPE (SON İŞLEMLER) TEYİDİ
      const [depthRes, fillsRes] = await Promise.all([
        fetch(`https://api.bitget.com/api/v2/mix/market/orderbook?symbol=${item.symbol}&productType=usdt-futures&limit=20`, { headers: browserHeaders }).then(r => r.json()).catch(() => ({})),
        fetch(`https://api.bitget.com/api/v2/mix/market/fills?symbol=${item.symbol}&productType=usdt-futures&limit=60`, { headers: browserHeaders }).then(r => r.json()).catch(() => ({}))
      ]);

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
      const takerBuyRatio = totalFlow > 0 ? (buyVol / totalFlow) * 100 : 50;

      // Emir Defteri Desteği (Alış Duvarı vs Satış Duvarı)
      let bidDepth = 0;
      let askDepth = 0;
      if (depthRes.data) {
        (depthRes.data.bids || []).forEach(b => { bidDepth += parseFloat(b[0]) * parseFloat(b[1]); });
        (depthRes.data.asks || []).forEach(a => { askDepth += parseFloat(a[0]) * parseFloat(a[1]); });
      }

      // KESİN GİRİŞ KURALLARI:
      if (isLongCandidate && takerBuyRatio >= 58 && bidDepth >= askDepth * 0.9) {
        selectedCandidate = item;
        selectedDirection = 'LONG';
        break; // Teyitli parite bulundu
      }

      if (isShortCandidate && takerBuyRatio <= 42 && askDepth >= bidDepth * 1.1) {
        selectedCandidate = item;
        selectedDirection = 'SHORT';
        break;
      }
    }

    if (!selectedCandidate) {
      return res.status(200).json({ status: "SCANNING", message: "Eşik değerleri tam karşılayan kurumsal sinyal bulunamadı (Tuzaklar elendi)." });
    }

    // 5. SEVİYE HESAPLARI (HASSAS HEDEFLER)
    const entryPrice = parseFloat(selectedCandidate.lastPr);
    const isLong = selectedDirection === 'LONG';
    const tp1 = isLong ? entryPrice * 1.018 : entryPrice * 0.982;
    const tp2 = isLong ? entryPrice * 1.038 : entryPrice * 0.962;
    const sl = isLong ? entryPrice * 0.988 : entryPrice * 1.012;

    const tradeId = `trade_${Date.now()}`;
    const newTrade = {
      id: tradeId,
      symbol: selectedCandidate.symbol,
      direction: selectedDirection,
      entryPrice,
      tp1,
      tp2,
      sl,
      status: 'OPEN',
      createdAt: now,
      timestamp: new Date().toISOString()
    };

    // 6. Firebase'e Yaz
    await fetch(`${FIREBASE_BASE_URL}/active_trades/${tradeId}.json`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(newTrade)
    });

    // 7. Telegram Bildirimi Fırlat
    const pStr = entryPrice < 1 ? entryPrice.toFixed(6) : entryPrice.toFixed(4);
    const tp1Str = tp1 < 1 ? tp1.toFixed(6) : tp1.toFixed(4);
    const tp2Str = tp2 < 1 ? tp2.toFixed(6) : tp2.toFixed(4);
    const slStr = sl < 1 ? sl.toFixed(6) : sl.toFixed(4);

    const tgMsg = `🎯 <b>MINEORA SENTINEL | KURUMSAL SİNYAL</b>\n` +
                  `━━━━━━━━━━━━━━━━━━━━\n` +
                  `💎 <b>Parite:</b> #${selectedCandidate.symbol}\n` +
                  `🧭 <b>Yön:</b> ${selectedDirection === 'LONG' ? '🟢 LONG' : '🔴 SHORT'}\n` +
                  `💵 <b>Giriş Seviyesi:</b> <code>$${pStr}</code>\n` +
                  `━━━━━━━━━━━━━━━━━━━━\n` +
                  `🎯 <b>Hedef 1 (+%1.8):</b> <code>$${tp1Str}</code>\n` +
                  `🚀 <b>Hedef 2 (+%3.8+):</b> <code>$${tp2Str}</code>\n` +
                  `🛑 <b>Stop-Loss:</b> <code>$${slStr}</code>\n` +
                  `━━━━━━━━━━━━━━━━━━━━\n` +
                  `⚡ <i>Emir defteri ve tape akışı doğrulanmıştır.</i>`;

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
