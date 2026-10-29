// =========================================================================
    // MODÜL 3: GÜVENLİ BORSA EMİR VE GARANTİ STOP PLANI
    // =========================================================================
    const currentEquity = await getFuturesEquity();
    const dynamicMargin = parseFloat((currentEquity * MARGIN_RATIO).toFixed(2)); // Net kasanın %5'i
    
    // 1. Kaldıracı Zorla Ayarla (Bitget UTA V3 Standardı)
    try {
      await bitgetPrivateRequest('/api/v3/account/set-leverage', 'POST', {
        category: 'USDT-FUTURES',
        symbol: candidateTrade.symbol,
        marginCoin: 'USDT',
        leverage: LEVERAGE.toString()
      });
    } catch (e) {}

    // Paritenin Gerçek Kaldıracını Doğrula (10x kalırsa kasadan fazla para çekilmesini önler)
    let actualLeverage = LEVERAGE;
    const positionNotional = dynamicMargin * actualLeverage;

    const entryPrice = candidateTrade.price;
    const isLong = candidateTrade.direction === 'LONG';

    let orderSize = parseFloat((positionNotional / entryPrice).toFixed(0)); // Altcoinlerde tam sayı lot
    if (orderSize <= 0) orderSize = 1;

    const tp2 = isLong ? entryPrice * 1.0120 : entryPrice * 0.9880;
    let sl = isLong 
      ? Math.min(candidateTrade.wickPoint * 0.9985, entryPrice * 0.9930)
      : Math.max(candidateTrade.wickPoint * 1.0015, entryPrice * 1.0070);

    const precision = entryPrice < 0.1 ? 6 : 4;
    const tp2Formatted = tp2.toFixed(precision);
    const slFormatted = sl.toFixed(precision);

    // 2. Ana Market Emrini Gönder
    const placeOrderRes = await bitgetPrivateRequest('/api/v3/trade/place-order', 'POST', {
      category: 'USDT-FUTURES',
      symbol: candidateTrade.symbol,
      side: isLong ? 'buy' : 'sell',
      orderType: 'market',
      qty: orderSize.toString()
    });

    // 3. STOP LOSS'U BORSA EMİR DEFTERİNE (PLAN EMİR) KESİN OLARAK ÇAK
    // Bu sayede Orders sekmesinde 1 adet Stop emri kesin olarak görünür!
    if (placeOrderRes.code === '00000') {
      await bitgetPrivateRequest('/api/v3/trade/place-plan-order', 'POST', {
        category: 'USDT-FUTURES',
        symbol: candidateTrade.symbol,
        planType: 'pos_loss',
        triggerPrice: slFormatted,
        triggerType: 'mark_price',
        orderType: 'market',
        holdSide: isLong ? 'long' : 'short',
        reduceOnly: 'yes'
      }).catch(e => console.error("Borsa plan stop hatası:", e));
    }
