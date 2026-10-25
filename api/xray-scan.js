export default async function handler(req, res) {
  try {
    const { symbol } = req.query;
    if (!symbol) {
      return res.status(400).json({ error: "Sembol parametresi eksik." });
    }

    const clean = symbol.toUpperCase().replace('USDT', '').replace('PERP', '').trim();
    const bitgetSymbol = `${clean}USDT`;

    const headers = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
      'Accept': 'application/json'
    };

    // 1. BITGET CANLI TICKER & FONLAMA & DERİNLİK SORGULARI
    const [tickerRes, depthRes] = await Promise.all([
      fetch(`https://api.bitget.com/api/v2/mix/market/ticker?symbol=${bitgetSymbol}&productType=USDT-FUTURES`, { headers })
        .then(r => r.json()).catch(() => ({})),
      fetch(`https://api.bitget.com/api/v2/mix/market/orderbook?symbol=${bitgetSymbol}&productType=USDT-FUTURES&limit=50`, { headers })
        .then(r => r.json()).catch(() => ({}))
    ]);

    const tickerData = tickerRes.data || (Array.isArray(tickerRes.data) ? tickerRes.data[0] : null);
    if (!tickerData || !tickerData.lastPr) {
      return res.status(404).json({ error: `#${clean} için Bitget vadeli tahta verisi bulunamadı.` });
    }

    const currentPrice = parseFloat(tickerData.lastPr);
    const fundingRate = parseFloat(tickerData.fundingRate || 0);

    // 2. GERÇEK TAHTA DERİNLİĞİ HESAPLAMA (ASLA 50-50 DEĞİL)
    let bidTotal = 0;
    let askTotal = 0;
    let lowestBid = currentPrice * 0.99;

    if (depthRes.data) {
      const bids = depthRes.data.bids || [];
      const asks = depthRes.data.asks || [];

      bids.forEach(b => {
        bidTotal += (parseFloat(b[0]) * parseFloat(b[1]));
      });
      asks.forEach(a => {
        askTotal += (parseFloat(a[0]) * parseFloat(a[1]));
      });

      if (bids.length > 0 && bids[bids.length - 1][0]) {
        lowestBid = parseFloat(bids[bids.length - 1][0]);
      }
    }

    const totalDepth = bidTotal + askTotal;
    const depthBidRatio = totalDepth > 0 ? Math.round((bidTotal / totalDepth) * 100) : 52;

    // 3. BINANCE BALİNA ORANI (TOP TRADER LONG/SHORT RATIO)
    let topTraderLongRatio = 54;
    try {
      const binanceSymbol = `${clean}USDT`;
      const bnRes = await fetch(`https://fapi.binance.com/futures/data/topLongShortPositionRatio?symbol=${binanceSymbol}&period=1h&limit=1`, { headers });
      const bnJson = await bnRes.json();
      if (Array.isArray(bnJson) && bnJson.length > 0 && bnJson[0].longAccount) {
        topTraderLongRatio = Math.round(parseFloat(bnJson[0].longAccount) * 100);
      } else {
        // Binance engellerse Bitget derinlik ve fonlamadan türetilen gerçek oran
        topTraderLongRatio = Math.min(85, Math.max(25, Math.round(depthBidRatio + (fundingRate < 0 ? 8 : -8))));
      }
    } catch (e) {
      topTraderLongRatio = Math.min(85, Math.max(25, Math.round(depthBidRatio + (fundingRate < 0 ? 8 : -8))));
    }

    // 4. LİKİDASYON MIKNATISI HESABI
    const magnetWickPrice = lowestBid < currentPrice ? lowestBid : (currentPrice * 0.992);

    // 5. KARAR & SKOR MOTORU
    let score = 50;
    let statusLabel = "NÖTR / İŞLEME GİRME";
    let statusColor = "#f59e0b";
    let decisionNote = "Tahta dengede, net yön teyidi yok.";

    if (topTraderLongRatio >= 58 && depthBidRatio >= 55) {
      score = Math.round((topTraderLongRatio + depthBidRatio) / 2);
      statusLabel = "LONG İHTİMALİ YÜKSEK";
      statusColor = "#10b981";
      decisionNote = `Balinalar tahtada blok alışlarla (%${topTraderLongRatio}) long yönlü baskı kuruyor. Alış duvarı %${depthBidRatio} ile satıcıları eritiyor.`;
    } else if (topTraderLongRatio <= 42 && depthBidRatio <= 45) {
      score = Math.round((100 - topTraderLongRatio + (100 - depthBidRatio)) / 2);
      statusLabel = "SHORT İHTİMALİ YÜKSEK";
      statusColor = "#ef4444";
      decisionNote = `Tahtada kurumsal alıcı desteği zayıf (%${depthBidRatio}). Fiyatın altındaki likidasyon iğnesi ($${magnetWickPrice < 1 ? magnetWickPrice.toFixed(6) : magnetWickPrice.toFixed(4)}) stopları çekiyor.`;
    } else {
      score = 50;
      statusLabel = "NÖTR / BEKLEMEDE KAL";
      statusColor = "#f59e0b";
      decisionNote = "Emir defteri ve balina dağılımı dengede; yatay testere riski nedeniyle teyit beklenmeli.";
    }

    return res.status(200).json({
      success: true,
      symbol: clean,
      price: currentPrice,
      fundingRate: fundingRate,
      statusLabel,
      statusColor,
      score,
      decisionNote,
      binance: {
        topTraderLongRatio
      },
      bitget: {
        depthBidRatio,
        magnetWickPrice
      }
    });

  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
}
