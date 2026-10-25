export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  try {
    const rawSymbol = (req.query.symbol || req.body?.symbol || 'SOL').toUpperCase().trim();
    const symbol = rawSymbol.endsWith('USDT') ? rawSymbol : `${rawSymbol}USDT`;

    const [
      binanceFundingRes,
      binanceOiRes,
      binanceTopTraderRes,
      binanceTickerRes,
      bitgetTickerRes,
      bitgetDepthRes,
      bitgetFillsRes
    ] = await Promise.all([
      fetch(`https://fapi.binance.com/fapi/v1/fundingRate?symbol=${symbol}&limit=1`).then(r => r.json()).catch(() => []),
      fetch(`https://fapi.binance.com/fapi/v1/openInterest?symbol=${symbol}`).then(r => r.json()).catch(() => ({})),
      fetch(`https://fapi.binance.com/futures/data/topLongShortPositionRatio?symbol=${symbol}&period=5m&limit=1`).then(r => r.json()).catch(() => []),
      fetch(`https://fapi.binance.com/fapi/v1/ticker/price?symbol=${symbol}`).then(r => r.json()).catch(() => ({})),
      fetch(`https://api.bitget.com/api/v2/mix/market/ticker?symbol=${symbol}&productType=usdt-futures`).then(r => r.json()).catch(() => ({})),
      fetch(`https://api.bitget.com/api/v2/mix/market/orderbook?symbol=${symbol}&productType=usdt-futures&limit=20`).then(r => r.json()).catch(() => ({})),
      fetch(`https://api.bitget.com/api/v2/mix/market/fills?symbol=${symbol}&productType=usdt-futures&limit=100`).then(r => r.json()).catch(() => ({}))
    ]);

    // 1. Fiyat Bilgisi (Bitget yoksa Binance'ten yedek al)
    let currentPrice = 0;
    if (bitgetTickerRes.code === '00000' && bitgetTickerRes.data) {
      const bData = Array.isArray(bitgetTickerRes.data) ? bitgetTickerRes.data[0] : bitgetTickerRes.data;
      currentPrice = parseFloat(bData?.lastPr || 0);
    }
    if (!currentPrice && binanceTickerRes.price) {
      currentPrice = parseFloat(binanceTickerRes.price);
    }

    if (!currentPrice || currentPrice <= 0) {
      return res.status(404).json({ error: `Parite bulunamadı: ${symbol}` });
    }

    // 2. Binance Metrikleri
    let binanceFunding = 0;
    if (Array.isArray(binanceFundingRes) && binanceFundingRes.length > 0) {
      binanceFunding = parseFloat(binanceFundingRes[0].fundingRate || 0) * 100;
    }

    let binanceOiUsd = 0;
    if (binanceOiRes.openInterest) {
      binanceOiUsd = parseFloat(binanceOiRes.openInterest) * currentPrice;
    }

    let binanceWhaleLongRatio = 50;
    if (Array.isArray(binanceTopTraderRes) && binanceTopTraderRes.length > 0) {
      binanceWhaleLongRatio = Math.round(parseFloat(binanceTopTraderRes[0].longAccount || 0.5) * 100);
    }
    const binanceWhaleShortRatio = 100 - binanceWhaleLongRatio;

    // 3. Bitget Derinlik & Likidite Mıknatısı
    let magnetWickPrice = currentPrice * 0.992;
    let bidWallTotal = 0;
    let askWallTotal = 0;

    if (bitgetDepthRes.code === '00000' && bitgetDepthRes.data) {
      const bids = bitgetDepthRes.data.bids || [];
      const asks = bitgetDepthRes.data.asks || [];

      bids.forEach(b => { bidWallTotal += (parseFloat(b[0]) * parseFloat(b[1])); });
      asks.forEach(a => { askWallTotal += (parseFloat(a[0]) * parseFloat(a[1])); });

      if (bids.length > 0) {
        let maxBidSize = 0;
        bids.forEach(b => {
          const sz = parseFloat(b[1]);
          if (sz > maxBidSize) {
            maxBidSize = sz;
            magnetWickPrice = parseFloat(b[0]) * 0.996;
          }
        });
      }
    }

    // 4. Bitget Balina Alımları ($1200+)
    let totalTapeVolume = 0;
    let whaleBuyVolume = 0;
    let whaleSellVolume = 0;

    const fills = bitgetFillsRes.data?.fillList || bitgetFillsRes.data || [];
    if (Array.isArray(fills)) {
      fills.forEach(f => {
        const notional = parseFloat(f.price || 0) * parseFloat(f.size || 0);
        totalTapeVolume += notional;
        if (notional >= 1200) {
          if (f.side === 'buy') whaleBuyVolume += notional;
          else whaleSellVolume += notional;
        }
      });
    }

    const totalWhaleVol = whaleBuyVolume + whaleSellVolume;
    const whaleBuyRatio = totalWhaleVol > 0 ? Math.round((whaleBuyVolume / totalWhaleVol) * 100) : 50;

    // 5. Karar & Teyit Skoru Formülü
    let confirmationScore = 50;
    confirmationScore += (binanceWhaleLongRatio - 50) * 0.5;
    confirmationScore += (whaleBuyRatio - 50) * 0.5;

    if (binanceFunding < -0.01) confirmationScore += 12;
    if (binanceFunding > 0.04) confirmationScore -= 12;

    confirmationScore = Math.max(12, Math.min(96, Math.round(confirmationScore)));

    let status = 'NEUTRAL';
    let statusLabel = 'NÖTR / BEKLEMEDE';
    let statusColor = '#94a3b8';
    let decisionNote = '';

    if (confirmationScore >= 70) {
      status = 'APPROVED';
      statusLabel = 'SİNYAL ONAYLANDI (GÜVENLİ ALIM)';
      statusColor = '#10b981';
      decisionNote = `İndikatörün AL sinyali küresel verilerle doğrulanıyor. Binance balinalarının %${binanceWhaleLongRatio}'si Long tarafında ve tahtada kurumsal blok alımlar baskın.`;
    } else if (confirmationScore <= 38) {
      status = 'FAKE_TRAP';
      statusLabel = 'DİKKAT: SAHTE SİNYAL / TUZAK!';
      statusColor = '#ef4444';
      decisionNote = `Grafikteki AL sinyali yanıltıcı olabilir. Binance balinaları Short tarafında (%${binanceWhaleShortRatio}). Tahtada kurumsal alıcı desteği yok, iğneyle stop patlatabilir.`;
    } else {
      statusLabel = 'KISMİ TEYİT (RİSKLİ BÖLGE)';
      statusColor = '#f59e0b';
      decisionNote = `Piyasa şu an dengede. Net bir kurumsal blok akışı henüz başlamadı, hacmin oturması beklenmeli.`;
    }

    return res.status(200).json({
      success: true,
      symbol,
      price: currentPrice,
      score: confirmationScore,
      status,
      statusLabel,
      statusColor,
      decisionNote,
      binance: {
        fundingPct: binanceFunding.toFixed(4) + '%',
        oiUsd: binanceOiUsd > 0 ? `$${(binanceOiUsd / 1000000).toFixed(2)}M` : 'Veri Yok',
        whaleLongPct: `%${binanceWhaleLongRatio}`,
        whaleShortPct: `%${binanceWhaleShortRatio}`
      },
      bitget: {
        whaleBuyPct: `%${whaleBuyRatio}`,
        bidWallDepth: `$${(bidWallTotal / 1000).toFixed(1)}K`,
        askWallDepth: `$${(askWallTotal / 1000).toFixed(1)}K`,
        magnetWickPrice: magnetWickPrice < 1 ? magnetWickPrice.toFixed(6) : magnetWickPrice.toFixed(4)
      }
    });

  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}
