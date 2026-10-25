export default async function handler(req, res) {
  try {
    const browserHeaders = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept': 'application/json'
    };

    const TG_BOT_TOKEN = "8682225307:AAHaa-hieKBBluU6uZ2_-OgSPxGR7OwMssE";
    const TG_ADMIN_ID = "6457294906";
    const FIREBASE_BASE_URL = "https://mineora-web-default-rtdb.firebaseio.com";
    const THREE_HOURS_MS = 3 * 60 * 60 * 1000;
    const now = Date.now();

    // 1. Bitget Vadeli Piyasa Verilerini Çek
    const tickersRes = await fetch("https://api.bitget.com/api/v2/mix/market/tickers?productType=USDT-FUTURES", { headers: browserHeaders });
    const tickersJson = await tickersRes.json();

    if (tickersJson.code !== '00000' || !Array.isArray(tickersJson.data)) {
      return res.status(500).json({ error: "Bitget verisi alınamadı." });
    }

    const EXCLUDED = ["BTCUSDT", "ETHUSDT", "SOLUSDT", "BNBUSDT", "XRPUSDT", "DOGEUSDT"];
    // Minimum 1.2M USDT hacimli canlı tahtalar
    const pool = tickersJson.data.filter(t => 
      t.symbol.endsWith("USDT") && 
      !EXCLUDED.includes(t.symbol) && 
      parseFloat(t.usdtVolume || 0) >= 1200000
    );

    // 2. Firebase'deki Aktif İşlemleri ve Son Sinyal Zamanlarını Oku
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

    // Aktif açık işlem kontrolü (Varsa yeni sinyal arama, spamı kes)
    const openTrades = Object.values(activeTrades).filter(t => {
      if (!t || t.status !== 'OPEN') return false;
      const tTime = t.createdAt || (t.timestamp ? new Date(t.timestamp).getTime() : 0);
      return (now - tTime) <= THREE_HOURS_MS;
    });

    if (openTrades.length > 0) {
      return res.status(200).json({ status: "IDLE", message: `Zaten aktif işlem takip ediliyor: #${openTrades[0].symbol}` });
    }

    // 3. GELİŞMİŞ KURUMSAL FİLTRELEME & TAHTA RÖNTGENİ
    let selectedCandidate = null;
    let selectedDirection = null;

    for (const item of pool) {
      // 3 Saatlik Katı Kilit: Bu coine son 3 saatte sinyal atılmışsa KESİNLİKLE GEÇ
      const lastSentTime = lastSignals[item.symbol] || 0;
      if (now - lastSentTime < THREE_HOURS_MS) continue;

      const funding = parseFloat(item.fundingRate || 0);
      const chg24h = parseFloat(item.change24h || 0) * 100;
      const price = parseFloat(item.lastPr || 0);
      if (price <= 0) continue;

      // TUZAKLARI ENGELLEYEN ŞARTLAR:
      // LONG: Fonlama negatif OLMALI, ancak parite serbest düşüşte OLMAMALI (24s değişimi >= -1.5% ve <= +5.5%)
      const isLongSetup = (funding <= -0.0003) && (chg24h >= -1.5) && (chg24h <= 5.5);

      // SHORT: Fonlama pozitif ve şişkin, fiyatta tepe yapmış (+6.5% üzeri)
      const isShortSetup = (funding >= 0.0003) && (chg24h >= 6.5);

      if (!isLongSetup && !isShortSetup) continue;

      // 4. İKİNCİ AŞAMA: EMİR DEFTERİ DUVARLARI VE PİYASA EMİR AKIŞI (TAPE FLOW) TEYİDİ
      const [depthRes, fillsRes] = await Promise.all([
        fetch(`https://api.bitget.com/api/v2/mix/market/orderbook?symbol=${item.symbol}&productType=usdt-futures&limit=25`, { headers: browserHeaders }).then(r => r.json()).catch(() => ({})),
        fetch(`https://api.bitget.com/api/v2/mix/market/fills?symbol=${item.symbol}&productType=usdt-futures&limit=50`, { headers: browserHeaders }).then(r => r.json()).catch(() => ({}))
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
      const buyRatio = totalFlow > 0 ? (buyVol / totalFlow) * 100 : 50;

      // Alış ve Satış Duvarı Büyüklükleri
      let bidDepth = 0;
      let askDepth = 0;
      if (depthRes.data) {
        (depthRes.data.bids || []).forEach(b => { bidDepth += parseFloat(b[0]) * parseFloat(b[1]); });
        (depthRes.data.asks || []).forEach(a => { askDepth += parseFloat(a[0]) * parseFloat(a[1]); });
      }

      // KESİN GİRİŞ TEYİTLERİ:
      // LONG: Piyasa alıcıları tahtayı en az %58 oranında süpürüyor olmalı + Alış desteği satıştan güçlü olmalı
      if (isLongSetup && buyRatio >= 58 && bidDepth >= askDepth * 1.1) {
        selectedCandidate = item;
        selectedDirection = 'LONG';
        break;
      }

      // SHORT: Satıcılar baskın (%42 altı alım) + Satış duvarı alıştan güçlü olmalı
      if (isShortSetup && buyRatio <= 42 && askDepth >= bidDepth * 1.1) {
        selectedCandidate = item;
        selectedDirection = 'SHORT';
        break;
      }
    }

    if (!selectedCandidate) {
      return res.status(200).json({ status: "SCANNING", message: "Yüksek olasılıklı kurumsal kurulum taranıyor (Tuzaklar elendi)." });
    }

    // 5. İŞLEM SEVİYELERİ
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

    // 6. ÖNCE FIREBASE'E YAZ (KİLİTLERİ DEVREYE SOK)
    await Promise.all([
      fetch(`${FIREBASE_BASE_URL}/active_trades/${tradeId}.json`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newTrade)
      }),
      fetch(`${FIREBASE_BASE_URL}/last_signals/${selectedCandidate.symbol}.json`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(now)
      })
    ]);

    // 7. TELEGRAM'A SADECE 1 KEZ GÖNDER
    const pStr = entryPrice < 1 ? entryPrice.toFixed(6) : entryPrice.toFixed(4);
    const tp1Str = tp1 < 1 ? tp1.toFixed(6) : tp1.toFixed(4);
    const tp2Str = tp2 < 1 ? tp2.toFixed(6) : tp2.toFixed(4);
    const slStr = sl < 1 ? sl.toFixed(6) : sl.toFixed(4);

    const tgMsg = `🎯 <b>MINEORA SENTINEL | KURUMSAL TEYİTLİ SİNYAL</b>\n` +
                  `━━━━━━━━━━━━━━━━━━━━\n` +
                  `💎 <b>Parite:</b> #${selectedCandidate.symbol}\n` +
                  `🧭 <b>Yön:</b> ${selectedDirection === 'LONG' ? '🟢 LONG (Alış Desteği Doğrulandı)' : '🔴 SHORT (Tepe Dağıtımı Doğrulandı)'}\n` +
                  `💵 <b>Giriş:</b> <code>$${pStr}</code>\n` +
                  `━━━━━━━━━━━━━━━━━━━━\n` +
                  `🎯 <b>Hedef 1:</b> <code>$${tp1Str}</code> (+%1.8)\n` +
                  `🚀 <b>Hedef 2:</b> <code>$${tp2Str}</code> (+%3.8)\n` +
                  `🛑 <b>Stop-Loss:</b> <code>$${slStr}</code> (-%1.2)\n` +
                  `━━━━━━━━━━━━━━━━━━━━\n` +
                  `⚡ <i>Emir Defteri ve Tape Akışı Onaylıdır.</i>`;

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
