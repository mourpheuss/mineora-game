// Canlı Vadeli Cüzdan Bakiyesini Oku
    async function getFuturesEquity() {
      try {
        const accRes = await bitgetPrivateRequest('/api/v3/account/assets?coin=USDT', 'GET');
        if (accRes && accRes.code === '00000' && Array.isArray(accRes.data)) {
          const usdtItem = accRes.data.find(a => (a.coin === 'USDT' || a.coinName === 'USDT'));
          if (usdtItem) {
            const eq = parseFloat(usdtItem.available || usdtItem.equity || usdtItem.balance || 0);
            if (eq > 5) return eq;
          }
        }
      } catch (e) {}

      try {
        const accResV2 = await bitgetPrivateRequest('/api/v2/mix/account/accounts?productType=USDT-FUTURES', 'GET');
        if (accResV2 && accResV2.code === '00000' && Array.isArray(accResV2.data)) {
          const usdtAcc = accResV2.data.find(a => a.marginCoin === 'USDT');
          if (usdtAcc) {
            const eq = parseFloat(usdtAcc.available || usdtAcc.equity || usdtAcc.usdtEquity || 0);
            if (eq > 5) return eq;
          }
        }
      } catch (e) {}

      return 400; // API düşerse kasan 400$ olduğu için 400$ kabul edilsin (20$ marjin açsın)!
    }
