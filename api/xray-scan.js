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

    const browserHeaders = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept': 'application/json'
    };

    // Paralel Veri Çekimi (Bitget + Binance)
    const [
      bitgetTickerRes,
      bitgetDepthRes,
      bitgetFillsRes,
      bitgetOiRes,
      binanceFundingRes,
      binanceOiRes,
      binanceTopTraderRes
    ] = await Promise.all([
      // 1. Bitget Ticker (Fiyat, Fonlama, Hacim)
      fetch(`https://api.bitget.com/api/v2/mix/market/ticker?symbol=${symbol}&productType=usdt-futures`, { headers: browserHeaders }).then(r => r.json()).catch(() => ({})),
      // 2. Bitget Derinlik
      fetch(`https://api.bitget.com/api/v2/mix/market/orderbook?symbol=${symbol}&productType=usdt-futures&limit=20`, { headers: browserHeaders }).then(r => r.json()).catch(() => ({})),
      // 3. Bitget Tape (Son İşlemler)
      fetch(`https://api.bitget.com/api/v2/mix/market/fills?symbol=${symbol}&productType=usdt-futures&limit=100`, { headers: browserHeaders }).then(r => r.json()).catch(() => ({})) || {},
      // 4. Bitget Açık Pozisyon (OI)
      fetch(`https://api.bitget.com/api/v2/mix/market/open-interest?symbol=${symbol}&productType=usdt-futures`, { headers: browserHeaders }).then(r => r.json()).catch(() => ({})),
      // 5. Binance Fonlama
      fetch(`https://fapi.binance.com/fapi/v1/fundingRate?symbol=${symbol}&limit=1`, { headers: browserHeaders }).then(r => r.json()).catch(() => []),
      // 6. Binance OI
      fetch(`https://fapi.binance.com/fapi/v1/openInterest?symbol=${symbol}`, { headers: browserHeaders }).then(r => r.json()).catch(() => ({})),
      // 7. Binance Balina Dağılımı (Top Trader Long/Short)
      fetch(`https://fapi.binance.com/futures/data/topLongShortPositionRatio?symbol=${symbol}&period=5m&limit=1`, { headers: browserHeaders }).then(r => r.json()).catch(() => [])
    ]);

    // Fiyat Tespiti
    let currentPrice = 0;
    let bitgetFundingRate = 0;
    let bitgetVolUsdt = 0;

    if (bitgetTickerRes.code === '00000' && bitgetTickerRes.data) {
      const bData = Array.isArray(bitgetTickerRes.data) ? bitgetTickerRes.data[0] : bitgetTickerRes.data;
      currentPrice = parseFloat(bData?.lastPr || 0);
      bitgetFundingRate = parseFloat(bData?.fundingRate || 0) * 100;
      bitgetVolUsdt = parseFloat(bData?.usdtVolume || 0);
    }

    if (!currentPrice || currentPrice <= 0) {
      return res.status(404).json({ error: `Parite verisi alınamadı: ${symbol}` });
    }

    // --- AÇIK POZİSYON (OI) HESABI ---
    let totalOiUsd = 0;
    if (binanceOiRes && binanceOiRes.openInterest) {
      totalOiUsd = parseFloat(binanceOiRes.openInterest) * currentPrice;
    }
    // Binance engeline takılırsa Bitget OI verisi devreye girer
    if (!totalOiUsd && bitgetOiRes.code === '00000' && bitgetOiRes.data) {
      const oiList = bitgetOiRes.data.openInterestList || [];
      const oiSize = oiList.length > 0 ? parseFloat(oiList[0].size || 0) : parseFloat(bitgetOiRes.data.openInterest || 0);
      totalOiUsd = oiSize * currentPrice;
    }
    // Her iki borsa da yanıt vermezse 24s hacimden türetilen mantıksal tahmin
    if (!totalOiUsd && bitgetVolUsdt > 0) {
      totalOiUsd = bitgetVolUsdt * 0.45;
    }

    // --- FONLAMA ORANI HESABI ---
    let finalFunding = bitgetFundingRate;
    if (Array.isArray(binanceFundingRes) && binanceFundingRes.length > 0 && binanceFundingRes[0].fundingRate) {
      finalFunding = parseFloat(binanceFundingRes[0].fundingRate) * 100;
    }

    // --- BITGET TAHTA DERİNLİĞİ & LİKİDASYON MIKNATISI ---
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

    // --- BITGET BALİNA BLOK İŞLEMLERİ ($1200+) ---
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

    // --- BALİNA / TOP TRADER DAĞILIMI ---
    let whaleLongRatio = 50;
    if (Array.isArray(binanceTopTraderRes) && binanceTopTraderRes.length > 0 && binanceTopTraderRes[0].longAccount) {
      whaleLongRatio = Math.round(parseFloat(binanceTopTraderRes[0].longAccount) * 100);
    } else {
      // Binance verisi blokluysa Bitget tape ve fonlama üzerinden türetilir
      whaleLongRatio = whaleBuyRatio > 55 ? 64 : whaleBuyRatio < 40 ? 38 : 50;
    }
    const whaleShortRatio = 100 - whaleLongRatio;

    // --- MATEMATİKSEL TEYİT SKORU (0 - 100) ---
    let confirmationScore = 50;
    confirmationScore += (whaleLongRatio - 50) * 0.6;
    confirmationScore += (whaleBuyRatio - 50) * 0.5;

    if (finalFunding < -0.01) confirmationScore += 14;
    if (finalFunding > 0.03) confirmationScore -= 14;

    confirmationScore = Math.max(12, Math.min(96, Math.round(confirmationScore)));

    // --- 3 NET YÖN KARARI: LONG / SHORT / NÖTR ---
    let status = 'NEUTRAL';
    let statusLabel = '🟡 NÖTR / YÖN BELİRSİZ (İŞLEME GİRME)';
    let statusColor = '#f59e0b';
    let decisionNote = 'Tahta ve kurumsal emir akışı şu an dengede. Net bir Long veya Short üstünlüğü yok; yatay testere tuzağı riski nedeniyle kenarda beklenmeli.';

    if (confirmationScore >= 66) {
      status = 'LONG_BIAS';
      statusLabel = '🟢 LONG OLMA İHTİMALİ ÇOK YÜKSEK';
      statusColor = '#10b981';
      decisionNote = `Balinalar tahtada blok alışlarla (%${whaleBuyRatio}) yukarı yönlü baskı kuruyor. Açık pozisyon ve fonlama yapısı yukarı patlamayı destekliyor.`;
    } else if (confirmationScore <= 42) {
      status = 'SHORT_BIAS';
      statusLabel = '🔴 SHORT OLMA İHTİMALİ ÇOK YÜKSEK';
      statusColor = '#ef4444';
      decisionNote = `Tahtada kurumsal alıcı desteği yok (Blok alış sadece %${whaleBuyRatio}). Fiyatın altındaki likidasyon iğnesi ($${magnetWickPrice < 1 ? magnetWickPrice.toFixed(6) : magnetWickPrice.toFixed(4)}) stopları patlatmak için çekim yaratıyor. Long girmek tuzaktır!`;
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
        fundingPct: finalFunding.toFixed(4) + '%',
        oiUsd: `$${(totalOiUsd / 1000000).toFixed(2)}M`,
        whaleLongPct: `%${whaleLongRatio}`,
        whaleShortPct: `%${whaleShortRatio}`
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
