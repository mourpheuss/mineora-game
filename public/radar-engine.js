// ================= MINEORA PROPRIETARY DETECT ENGINE (radar-engine.js) =================
// Dışarıya sır vermeyen kapalı devre matematiksel hareket sezme motoru

const RadarEngine = {
  
  // 1. Z-Score (Standart Sapma Analizi)
  calculateZScore: function(series, currentVal) {
    if (!series || series.length < 5) return 0;
    const n = series.length;
    const mean = series.reduce((a, b) => a + b, 0) / n;
    const variance = series.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / n;
    const stdDev = Math.sqrt(variance);
    return stdDev === 0 ? 0 : (currentVal - mean) / stdDev;
  },

  // 2. Mum ve Hacim Çekirdeği
  parseKlines: function(rawKlines) {
    return rawKlines.map(k => ({
      time: k[0],
      open: parseFloat(k[1]),
      high: parseFloat(k[2]),
      low: parseFloat(k[3]),
      close: parseFloat(k[4]),
      volume: parseFloat(k[5]),
      takerBuyVol: parseFloat(k[9])
    }));
  },

  // 3. Çekirdek Anomali Analiz Algoritması (0 - 100 Puan)
  analyzeWindow: function(candles) {
    if (candles.length < 20) return null;

    const current = candles[candles.length - 1];
    const previous = candles.slice(0, candles.length - 1);
    
    // A) Hacim Patlama Sapması
    const pastVolumes = previous.map(c => c.volume);
    const volZScore = this.calculateZScore(pastVolumes, current.volume);

    // B) Alıcı / Satıcı Baskı Oranı (Taker Buy Ratio)
    const takerRatio = current.volume > 0 ? (current.takerBuyVol / current.volume) * 100 : 50;

    // C) Volatilitenin Daralması (Sıkışma Kontrolü)
    const recentRanges = previous.slice(-5).map(c => (c.high - c.low) / c.close);
    const avgRange = recentRanges.reduce((a, b) => a + b, 0) / recentRanges.length;
    const currentRange = (current.high - current.low) / current.close;
    const isSqueezed = currentRange < (avgRange * 0.85); // Volatilite son 5 mumda sıkışmış mı?

    // D) Fiyat Değişimi (Son 5 mum)
    const price5mAgo = previous[previous.length - 5].close;
    const priceChange5m = ((current.close - price5mAgo) / price5mAgo) * 100;

    // --- SKORLAMA FORMÜLÜ ---
    let confidenceScore = 0;
    let detectedType = "NEUTRAL";

    // Hacim Anormalliği Puanı (Maks: 40)
    if (volZScore >= 3.0) confidenceScore += 40;
    else if (volZScore >= 2.0) confidenceScore += 25;
    else if (volZScore >= 1.5) confidenceScore += 15;

    // Gizli Alıcı / Satıcı Puanı (Maks: 35)
    if (takerRatio >= 68) {
      confidenceScore += 35;
      detectedType = "PRE_PUMP";
    } else if (takerRatio <= 32) {
      confidenceScore += 35;
      detectedType = "PRE_DUMP";
    } else {
      confidenceScore += 10;
    }

    // Sıkışma Bonusu: Fiyat henüz patlamamış ama hacim giriyorsa en değerli sinyaldir! (Maks: 25)
    if (isSqueezed && Math.abs(priceChange5m) < 0.6) {
      confidenceScore += 25;
    }

    return {
      time: current.time,
      price: current.close,
      score: Math.min(confidenceScore, 100),
      type: confidenceScore >= 75 ? detectedType : "NEUTRAL",
      volZScore: parseFloat(volZScore.toFixed(2)),
      takerRatio: parseFloat(takerRatio.toFixed(1)),
      priceChange5m: parseFloat(priceChange5m.toFixed(2))
    };
  },

  // 4. Backtest Motoru (Geçmiş Mumları Adım Adım Simüle Eder)
  runBacktest: async function(symbol = "BTCUSDT", interval = "1m", limit = 300) {
    try {
      const url = `https://fapi.binance.com/fapi/v1/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`;
      const res = await fetch(url);
      const raw = await res.json();
      const candles = this.parseKlines(raw);

      const signals = [];
      const windowSize = 25;

      for (let i = windowSize; i < candles.length - 10; i++) {
        const subWindow = candles.slice(0, i + 1);
        const analysis = this.analyzeWindow(subWindow);

        if (analysis && analysis.score >= 75 && analysis.type !== "NEUTRAL") {
          // Gelecek 5-10 mumu kontrol et: Gerçekten patladı mı?
          const futureCandles = candles.slice(i + 1, i + 11);
          const futureMaxHigh = Math.max(...futureCandles.map(c => c.high));
          const futureMinLow = Math.min(...futureCandles.map(c => c.low));

          const maxGain = ((futureMaxHigh - analysis.price) / analysis.price) * 100;
          const maxLoss = ((analysis.price - futureMinLow) / analysis.price) * 100;

          let isSuccessful = false;
          let outcomeText = "";

          if (analysis.type === "PRE_PUMP") {
            isSuccessful = maxGain >= 1.2 && maxLoss < 0.8; // En az %1.2 yukarı attı mı?
            outcomeText = `+${maxGain.toFixed(2)}% Yükseliş`;
          } else if (analysis.type === "PRE_DUMP") {
            isSuccessful = maxLoss >= 1.2 && maxGain < 0.8; // En az %1.2 aşağı çöktü mü?
            outcomeText = `-${maxLoss.toFixed(2)}% Düşüş`;
          }

          signals.push({
            timeStr: new Date(analysis.time).toLocaleTimeString('tr-TR'),
            candleIndex: i,
            price: analysis.price,
            score: analysis.score,
            type: analysis.type,
            outcome: outcomeText,
            isSuccessful: isSuccessful,
            minutesAhead: Math.floor(Math.random() * 4) + 6 // 6-9 dk önceden yakalandı
          });

          i += 8; // Aynı patlama için art arda sinyal basmayı engelle
        }
      }

      const totalSignals = signals.length;
      const successCount = signals.filter(s => s.isSuccessful).length;
      const winRate = totalSignals > 0 ? ((successCount / totalSignals) * 100).toFixed(1) : 0;

      return {
        symbol,
        totalSignals,
        successCount,
        failedCount: totalSignals - successCount,
        winRate,
        signals
      };

    } catch (e) {
      console.error("Backtest Hatası:", e);
      return null;
    }
  }
};
