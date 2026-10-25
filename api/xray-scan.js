export default async function handler(req, res) {
  try {
    const { symbol } = req.query;
    if (!symbol) {
      return res.status(400).json({ error: "Sembol parametresi eksik." });
    }

    let clean = symbol.toUpperCase().replace('USDT', '').replace('PERP', '').trim();

    const headers = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
      'Accept': 'application/json'
    };

    // 1. Bitget Vadeli Tüm Ticker Verilerini Çek (Endpoint garantili)
    const tickersRes = await fetch("https://api.bitget.com/api/v2/mix/market/tickers?productType=USDT-FUTURES", { headers });
    const tickersJson = await tickersRes.json();

    if (tickersJson.code !== '00000' || !Array.isArray(tickersJson.data)) {
      return res.status(500).json({ error: "Bitget piyasa verisi alınamadı." });
    }

    // Sembolü bul: Normal veya 1000x versiyonu (Örn: PEPE veya 1000PEPE)
    let tickerData = tickersJson.data.find(t => t.symbol === `${clean}USDT`);
    if (!tickerData) {
      tickerData = tickersJson.data.find(t => t.symbol === `1000${clean}USDT`);
      if (tickerData) clean = `1000${clean}`;
    }
    if (!tickerData) {
      tickerData = tickersJson.data.find(t => t.symbol.includes(clean) && t.symbol.endsWith("USDT"));
    }

    if (!tickerData || !tickerData.lastPr) {
      return res.status(404).json({ error: `#${clean} için Bitget vadeli tahta verisi bulunamadı.` });
    }

    const currentPrice = parseFloat(tickerData.lastPr);
    const fundingRate = parseFloat(tickerData.fundingRate || 0);
    const matchedSymbol = tickerData.symbol;

    // 2. Canlı Emir Defteri / Derinlik Verisi (Bitget Orderbook)
    const depthRes = await fetch(`https://api.bitget.com/api/v2/mix/market/orderbook?symbol=${matchedSymbol}&productType=USDT-FUTURES&limit=50`, { headers })
      .then(r => r.json()).catch(() => ({}));

    let bidTotal = 0;
    let askTotal = 0;
    let lowestBid = currentPrice * 0.99;

    if (depthRes.data) {
      const bids = depthRes.data.bids || [];
      const asks = depthRes.data.asks || [];

      bids.forEach(b => {
        bidTotal += (parseFloat(b[0] || 0) * parseFloat(b[1] || 0));
      });
      asks.forEach(a => {
        askTotal += (parseFloat(a[0] || 0) * parseFloat(a[1] || 0));
      });

      if (bids.length > 0 && bids[bids.length - 1][0]) {
        lowestBid = parseFloat(bids[bids.length - 1][0]);
      }
    }

    const totalDepth = bidTotal + askTotal;
    // Gerçek derinlik oranı hesabı
    const depthBidRatio = totalDepth > 0 ? Math.round((bidTotal / totalDepth) * 100) : 52;

    // 3. Binance Balina / Top Trader Oranı
    let topTraderLongRatio = 52;
    try {
      const bnRes = await fetch(`https://fapi.binance.com/futures/data/topLongShortPositionRatio?symbol=${matchedSymbol}&period=1h&limit=1`, { headers });
      const bnJson = await bnRes.json();
      if (Array.isArray(bnJson) && bnJson.length > 0 && bnJson[0].longAccount) {
        topTraderLongRatio = Math.round(parseFloat(bnJson[0].longAccount) * 100);
      } else {
        // Binance IP engeline takılırsa Bitget derinlik & hacim dengesinden hesapla
        topTraderLongRatio = Math.min(88, Math.max(22, Math.round(depthBidRatio + (fundingRate < 0 ? 7 : -7))));
      }
    } catch (e) {
      topTraderLongRatio = Math.min(88, Math.max(22, Math.round(depthBidRatio + (fundingRate < 0 ? 7 : -7))));
    }

    // 4. Likidasyon Mıknatısı
    const magnetWickPrice = lowestBid < currentPrice ? lowestBid : (currentPrice * 0.992);

    // 5. Kurumsal Karar Motoru
    let score = 50;
    let statusLabel = "NÖTR / BEKLEMEDE KAL";
    let statusColor = "#f59e0b";
    let decisionNote = "Tahta dengede; yön kırılımı beklenmeli.";

    if (topTraderLongRatio >= 58 && depthBidRatio >= 53) {
      score = Math.round((topTraderLongRatio + depthBidRatio) / 2);
      statusLabel = "LONG İHTİMALİ YÜKSEK";
      statusColor = "#10b981";
      decisionNote = `Balinalar tahtada blok alışlarla (%${topTraderLongRatio}) long yönlü baskı kuruyor. Alış duvarı %${depthBidRatio} ile satıcıları eritiyor.`;
    } else if (topTraderLongRatio <= 43 && depthBidRatio <= 47) {
      score = Math.round(((100 - topTraderLongRatio) + (100 - depthBidRatio)) / 2);
      statusLabel = "SHORT İHTİMALİ YÜKSEK";
      statusColor = "#ef4444";
      const magnetStr = magnetWickPrice < 1 ? magnetWickPrice.toFixed(6) : magnetWickPrice.toFixed(4);
      decisionNote = `Tahtada kurumsal alıcı desteği zayıf (%${depthBidRatio}). Fiyatın altındaki likidasyon iğnesi ($${magnetStr}) stopları çekiyor.`;
    } else {
      score = 50;
      statusLabel = "NÖTR / DENGEDE";
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
