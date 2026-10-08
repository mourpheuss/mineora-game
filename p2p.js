// ================= 5. BORSA TAKAS / P2P & TÜRKÇE LİKİDİTE BOTU MOTORU (p2p.js) =================
let p2pFilter = 'buy';
let p2pCreateSide = 'buy';
let activeP2pOrder = null;
let isP2pProcessing = false;
const ENABLE_P2P_BOTS = true;

function getLocalRealP2pOrders() {
  try {
    const raw = localStorage.getItem('mineora_real_p2p_orders');
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return (parsed && typeof parsed === 'object') ? parsed : {};
  } catch(e) { return {}; }
}

function saveLocalRealP2pOrders(ordersMap) {
  try {
    localStorage.setItem('mineora_real_p2p_orders', JSON.stringify(ordersMap));
  } catch(e) {}
}

let realP2pOrdersMap = getLocalRealP2pOrders();

if (typeof fbDb !== 'undefined' && fbDb) {
  fbDb.ref('p2pOrders').on('value', snapshot => {
    const cloudOrders = snapshot.val();
    if (cloudOrders && typeof cloudOrders === 'object') {
      realP2pOrdersMap = cloudOrders;
    } else {
      realP2pOrdersMap = {};
    }
    saveLocalRealP2pOrders(realP2pOrdersMap);
    const p2pSec = document.getElementById('sec-p2p');
    if (p2pSec && !p2pSec.classList.contains('hidden')) {
      renderP2pOrders();
    }
  });
}

const TR_BOT_USERNAMES = [
  "muratkaya", "burak94", "emrecan", "serkany", "hakan35", "volkandemir",
  "kaan_alp", "deniz91", "barisay", "tolga06", "onurx", "yasin_b",
  "gokhank", "oguzhan58", "selimy", "tarik34", "umutcelik", "yavuzk",
  "kadiravci", "eren98", "alperturan", "cemoe", "kerem07", "fatihyilmaz",
  "mertaslan", "ahmetoz", "caner34", "alikemal", "berkayt", "ugurcan92"
];

function getActiveBotOrders() {
  const timeBlock = Math.floor(Date.now() / (5 * 60 * 1000));
  let cache = null;
  try {
    cache = JSON.parse(localStorage.getItem('mineora_bot_p2p_cache_v2') || 'null');
  } catch(e) {}

  if (!cache || cache.timeBlock !== timeBlock || !Array.isArray(cache.orders)) {
    const freshOrders = [];
    const tieredPackages = [
      { usdt: 10,   ora: 100 },
      { usdt: 25,   ora: 250 },
      { usdt: 50,   ora: 500 },
      { usdt: 100,  ora: 1000 },
      { usdt: 250,  ora: 2500 },
      { usdt: 500,  ora: 5000 },
      { usdt: 1000, ora: 10000 },
      { usdt: 2500, ora: 25000 },
      { usdt: 3500, ora: 35000 },
      { usdt: 5000, ora: 50000 }
    ];

    function getDynamicTurkishBotName(index, salt) {
      return TR_BOT_USERNAMES[(timeBlock + index * 3 + salt) % TR_BOT_USERNAMES.length];
    }

    tieredPackages.forEach((pkg, idx) => {
      freshOrders.push({
        id: `bot_sell_${idx}`,
        isBot: true,
        side: 'sell',
        merchant: getDynamicTurkishBotName(idx, 2),
        price: 0.1000,
        oraAmount: pkg.ora,
        usdtAmount: pkg.usdt
      });
    });

    tieredPackages.forEach((pkg, idx) => {
      freshOrders.push({
        id: `bot_buy_${idx}`,
        isBot: true,
        side: 'buy',
        merchant: getDynamicTurkishBotName(idx, 8),
        price: 0.1000,
        oraAmount: pkg.ora,
        usdtAmount: pkg.usdt
      });
    });

    cache = { timeBlock: timeBlock, orders: freshOrders };
    localStorage.setItem('mineora_bot_p2p_cache_v2', JSON.stringify(cache));
  }

  return cache.orders;
}

function consumeBotOrder(orderId, filledOra) {
  const timeBlock = Math.floor(Date.now() / (5 * 60 * 1000));
  let cache = null;
  try {
    cache = JSON.parse(localStorage.getItem('mineora_bot_p2p_cache_v2') || 'null');
  } catch(e) {}

  if (!cache || cache.timeBlock !== timeBlock || !Array.isArray(cache.orders)) return;

  const idx = cache.orders.findIndex(o => o.id === orderId);
  if (idx !== -1) {
    cache.orders[idx].oraAmount = Number((cache.orders[idx].oraAmount - filledOra).toFixed(2));
    cache.orders[idx].usdtAmount = Number((cache.orders[idx].oraAmount * cache.orders[idx].price).toFixed(2));

    if (cache.orders[idx].oraAmount <= 0.001) {
      cache.orders.splice(idx, 1);
    }
    localStorage.setItem('mineora_bot_p2p_cache_v2', JSON.stringify(cache));
  }
}

window.setP2pFilter = function(filter) {
  p2pFilter = filter;
  const buyBtn = document.getElementById('p2p-tab-buy');
  const sellBtn = document.getElementById('p2p-tab-sell');
  
  if (buyBtn) {
    buyBtn.className = filter === 'buy' 
      ? "px-5 py-2 rounded-xl text-xs font-black bg-mineora-green text-white shadow-lg shadow-mineora-green/20 transition cursor-pointer" 
      : "px-5 py-2 rounded-xl text-xs font-black text-slate-400 hover:text-white transition cursor-pointer";
  }
  if (sellBtn) {
    sellBtn.className = filter === 'sell' 
      ? "px-5 py-2 rounded-xl text-xs font-black bg-rose-600 text-white shadow-lg shadow-rose-600/20 transition cursor-pointer" 
      : "px-5 py-2 rounded-xl text-xs font-black text-slate-400 hover:text-white transition cursor-pointer";
  }
  renderP2pOrders();
};

window.setP2pCreateSide = function(side) {
  p2pCreateSide = side;
  const buySideBtn = document.getElementById('p2p-side-buy-btn');
  const sellSideBtn = document.getElementById('p2p-side-sell-btn');

  if (buySideBtn) {
    buySideBtn.className = side === 'buy' 
      ? "py-2.5 rounded-xl font-bold bg-mineora-green text-white cursor-pointer shadow-lg" 
      : "py-2.5 rounded-xl font-bold bg-mineora-bg text-slate-400 border border-mineora-border cursor-pointer";
  }
  if (sellSideBtn) {
    sellSideBtn.className = side === 'sell' 
      ? "py-2.5 rounded-xl font-bold bg-rose-600 text-white cursor-pointer shadow-lg" 
      : "py-2.5 rounded-xl font-bold bg-mineora-bg text-slate-400 border border-mineora-border cursor-pointer";
  }
  calculateP2pCreatePreview();
};

window.calculateP2pCreatePreview = function() {
  const price = parseFloat(document.getElementById('p2p-create-price')?.value) || 0;
  const amt = parseFloat(document.getElementById('p2p-create-amount')?.value) || 0;
  const preview = document.getElementById('p2p-preview-usdt');
  if (preview) preview.innerText = `$${(price * amt).toFixed(2)} USDT`;
};

window.submitP2pOrder = function() {
  if (!CurrentUser) return;
  if (isP2pProcessing) { showToast("⏳ İşlem yapılıyor...", "info"); return; }

  const price = parseFloat(document.getElementById('p2p-create-price')?.value);
  const oraAmt = parseFloat(document.getElementById('p2p-create-amount')?.value);

  if (isNaN(price) || price <= 0 || isNaN(oraAmt) || oraAmt <= 0) {
    showToast("⚠️ Geçerli bir fiyat ve ORA miktarı girin!", "warning");
    return;
  }

  const totalUsdt = Number((price * oraAmt).toFixed(2));
  const currentOra = Number(parseFloat(CurrentUser.ora || 0).toFixed(2));
  const currentUsdt = Number(parseFloat(CurrentUser.usdt || 0).toFixed(2));

  if (p2pCreateSide === 'sell') {
    if (oraAmt > currentOra) { showToast(`⚠️ Yetersiz ORA! Mevcut: ${currentOra.toFixed(2)} ORA`, "warning"); return; }
    CurrentUser.ora = Number((currentOra - oraAmt).toFixed(2));
  } else {
    if (totalUsdt > currentUsdt) { showToast(`⚠️ Yetersiz USDT! Gerekli: $${totalUsdt.toFixed(2)} USDT`, "warning"); return; }
    CurrentUser.usdt = Number((currentUsdt - totalUsdt).toFixed(2));
  }

  isP2pProcessing = true;
  saveUserWorld();
  updateHUD();

  const orderId = `p2p_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
  const newOrder = {
    id: orderId,
    isBot: false,
    side: p2pCreateSide,
    merchant: CurrentUser.username.trim(),
    price: price,
    oraAmount: oraAmt,
    usdtAmount: totalUsdt,
    createdAt: Date.now()
  };

  if (!realP2pOrdersMap) realP2pOrdersMap = {};
  realP2pOrdersMap[orderId] = newOrder;
  saveLocalRealP2pOrders(realP2pOrdersMap);

  if (typeof fbDb !== 'undefined' && fbDb) {
    fbDb.ref(`p2pOrders/${orderId}`).set(newOrder).catch(err => {
      console.warn("Bulut ilan kaydı uyarısı:", err);
    });
  }

  closeModal('modal-p2p-create');
  renderP2pOrders();
  showToast("📋 İlanınız oluşturuldu, emanete (escrow) alındı ve listeye eklendi!", "success");
  setTimeout(() => { isP2pProcessing = false; }, 600);
};

window.cancelP2pOrder = function(orderId) {
  if (!CurrentUser) {
    showToast("⚠️ Lütfen önce giriş yapın!", "warning");
    return;
  }
  if (isP2pProcessing) {
    showToast("⏳ İşlem yürütülüyor, lütfen bekleyin...", "info");
    return;
  }

  let targetKey = null;
  let order = null;
  const searchId = (orderId !== undefined && orderId !== null) ? String(orderId).trim() : "";

  if (realP2pOrdersMap && searchId && searchId !== "undefined") {
    if (realP2pOrdersMap[searchId]) {
      order = realP2pOrdersMap[searchId];
      targetKey = searchId;
    } else {
      for (let k in realP2pOrdersMap) {
        const item = realP2pOrdersMap[k];
        if (item && (String(k) === searchId || String(item.id) === searchId || String(item._key) === searchId)) {
          order = item;
          targetKey = k;
          break;
        }
      }
    }
  }

  if (!order && realP2pOrdersMap) {
    const myUname = (CurrentUser.username || "").trim().toLowerCase();
    for (let k in realP2pOrdersMap) {
      const item = realP2pOrdersMap[k];
      if (item && (item.merchant || "").trim().toLowerCase() === myUname) {
        order = item;
        targetKey = k;
        break;
      }
    }
  }

  if (!order || !targetKey) {
    showToast("⚠️ İlan bulunamadı veya daha önce iptal edilmiş!", "warning");
    renderP2pOrders();
    return;
  }

  const myUsername = (CurrentUser.username || "").trim().toLowerCase();
  const merchantUsername = (order.merchant || "").trim().toLowerCase();

  if (myUsername !== merchantUsername && !CurrentUser.isRootAdmin) {
    showToast("⛔ Yalnızca kendi ilanlarınızı iptal edebilirsiniz!", "warning");
    return;
  }

  isP2pProcessing = true;

  if (order.side === 'sell') {
    const refundOra = Number(parseFloat(order.oraAmount || 0).toFixed(2));
    CurrentUser.ora = Number(((CurrentUser.ora || 0) + refundOra).toFixed(2));
    showToast("↩️ Satış ilanı iptal edildi! " + refundOra.toLocaleString() + " ORA kasanıza iade edildi.", "success");
  } else {
    const refundUsdt = Number(parseFloat(order.usdtAmount || 0).toFixed(2));
    CurrentUser.usdt = Number(((CurrentUser.usdt || 0) + refundUsdt).toFixed(2));
    showToast("↩️ Alış ilanı iptal edildi! $" + refundUsdt.toFixed(2) + " USDT kasanıza iade edildi.", "success");
  }

  if (realP2pOrdersMap) {
    delete realP2pOrdersMap[targetKey];
    if (order.id) delete realP2pOrdersMap[order.id];
  }
  saveLocalRealP2pOrders(realP2pOrdersMap);

  if (typeof fbDb !== 'undefined' && fbDb) {
    fbDb.ref("p2pOrders/" + targetKey).remove();
    if (order.id && String(order.id) !== String(targetKey)) {
      fbDb.ref("p2pOrders/" + order.id).remove();
    }
  }

  saveUserWorld();
  updateHUD();
  renderP2pOrders();
  setTimeout(() => { isP2pProcessing = false; }, 400);
};

window.renderP2pOrders = function() {
  const tbody = document.getElementById('p2p-order-list');
  if (!tbody) return;
  tbody.innerHTML = "";

  const myUsername = (CurrentUser && CurrentUser.username ? CurrentUser.username : "").trim().toLowerCase();
  const targetSide = p2pFilter === 'buy' ? 'sell' : 'buy';

  const allRealOrders = [];
  if (realP2pOrdersMap && typeof realP2pOrdersMap === 'object') {
    Object.keys(realP2pOrdersMap).forEach(key => {
      const item = realP2pOrdersMap[key];
      if (item && typeof item === 'object') {
        const cleanKey = String(key);
        item._key = cleanKey;
        item.id = item.id ? String(item.id) : cleanKey;
        if (Number(item.oraAmount) > 0 && !item.isBot) {
          allRealOrders.push(item);
        }
      }
    });
  }

  const myOpenOrders = allRealOrders.filter(o => (o.merchant || "").trim().toLowerCase() === myUsername);
  let myOrdersContainer = document.getElementById('p2p-my-orders-banner');
  if (!myOrdersContainer) {
    myOrdersContainer = document.createElement('div');
    myOrdersContainer.id = 'p2p-my-orders-banner';
    const tableParent = tbody.closest('.rounded-3xl');
    if (tableParent && tableParent.parentElement) {
      tableParent.parentElement.insertBefore(myOrdersContainer, tableParent);
    }
  }

  if (myOpenOrders.length > 0) {
    let myCardsHtml = '';
    myOpenOrders.forEach(mo => {
      const isSell = mo.side === 'sell';
      const sideBadge = isSell 
        ? '<span class="px-2 py-0.5 rounded text-[10px] font-black uppercase bg-rose-500/20 text-rose-300">ORA Satış Emri</span>'
        : '<span class="px-2 py-0.5 rounded text-[10px] font-black uppercase bg-emerald-500/20 text-emerald-300">ORA Alış Emri</span>';
      const orderKey = mo._key || mo.id;

      myCardsHtml += '<div class="flex items-center justify-between bg-mineora-bg/90 p-2.5 rounded-xl border border-mineora-border text-xs font-mono">'
        + '<div class="flex items-center gap-3">'
        + sideBadge
        + '<strong class="text-mineora-gold">' + Number(mo.oraAmount).toLocaleString() + ' ORA</strong>'
        + '<span class="text-slate-400">($' + Number(mo.usdtAmount).toFixed(2) + ' USDT)</span>'
        + '<span class="text-slate-500 text-[11px]">Birim: $' + Number(mo.price).toFixed(4) + '</span>'
        + '</div>'
        + '<button type="button" onclick="cancelP2pOrder(\'' + orderKey + '\')" class="px-3 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-500 text-white font-black text-xs cursor-pointer shadow flex items-center gap-1.5 transition">'
        + '<i class="fa-solid fa-ban"></i> İlanı İptal Et & İade Al'
        + '</button>'
        + '</div>';
    });

    myOrdersContainer.className = "mb-4 p-4 rounded-2xl bg-amber-500/10 border border-amber-500/40 space-y-2.5 notranslate";
    myOrdersContainer.innerHTML = '<div class="flex items-center justify-between border-b border-amber-500/20 pb-2">'
      + '<span class="text-xs font-black text-amber-300 flex items-center gap-2">'
      + '<i class="fa-solid fa-list-check"></i> Sizin Aktif P2P İlanlarınız (' + myOpenOrders.length + ')'
      + '</span>'
      + '<span class="text-[10px] text-slate-400">İlanınızı dilediğiniz an tek tıkla iptal edip varlıklarınızı geri alabilirsiniz.</span>'
      + '</div>'
      + '<div class="space-y-2">' + myCardsHtml + '</div>';
  } else {
    myOrdersContainer.className = "hidden";
    myOrdersContainer.innerHTML = "";
  }

  const realUserOrders = allRealOrders
    .filter(o => o.side === targetSide)
    .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));

  const botOrders = ENABLE_P2P_BOTS 
    ? getActiveBotOrders().filter(o => o.side === targetSide && Number(o.oraAmount) > 0)
    : [];

  const combinedList = [...realUserOrders, ...botOrders];

  if (combinedList.length === 0) {
    tbody.innerHTML = '<tr><td colspan="4" class="py-8 text-center text-slate-500">Bu yönde aktif ilan bulunmuyor.</td></tr>';
    return;
  }

  combinedList.forEach(order => {
    const isMyOrder = (myUsername && (order.merchant || '').trim().toLowerCase() === myUsername);
    const tr = document.createElement('tr');
    tr.className = "hover:bg-mineora-bg/60 transition border-b border-mineora-border/60 text-xs";

    const btnClass = p2pFilter === 'buy' ? "bg-mineora-green hover:opacity-90 text-white" : "bg-rose-600 hover:opacity-90 text-white";
    const btnText = p2pFilter === 'buy' ? "USDT Öde & ORA Al" : "ORA Gönder & USDT Al";
    const orderKey = order._key || order.id || '';
    const initialLetter = order.merchant ? order.merchant.charAt(0).toUpperCase() : '?';

    let actionBtnHtml = '';
    if (isMyOrder) {
      actionBtnHtml = '<button type="button" onclick="cancelP2pOrder(\'' + orderKey + '\')" class="px-3.5 py-1.5 rounded-xl text-xs font-black bg-rose-600/30 hover:bg-rose-600 text-rose-300 hover:text-white border border-rose-500/40 transition cursor-pointer">'
        + '<i class="fa-solid fa-ban mr-1"></i> İptal Et</button>';
    } else {
      const botArg = order.isBot ? 'true' : 'false';
      actionBtnHtml = '<button type="button" onclick="openP2pTradeModal(\'' + orderKey + '\',' + botArg + ')" class="px-4 py-2 rounded-xl text-xs font-black transition cursor-pointer shadow ' + btnClass + '">'
        + btnText + '</button>';
    }

    const myBadgeHtml = isMyOrder ? '<span class="ml-2 px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-300 text-[9px] font-bold">SİZİN İLANINIZ</span>' : '';

    tr.innerHTML = '<td class="py-3.5 px-4 font-bold text-white flex items-center gap-2">'
      + '<div class="w-7 h-7 rounded-lg bg-mineora-input border border-mineora-border text-slate-200 flex items-center justify-center text-xs font-bold shrink-0">'
      + initialLetter + '</div>'
      + '<div class="flex items-center"><span class="text-white font-bold">' + order.merchant + '</span>' + myBadgeHtml + '</div>'
      + '</td>'
      + '<td class="py-3.5 px-4 font-mono font-bold text-white">$' + Number(order.price).toFixed(4) + ' USDT</td>'
      + '<td class="py-3.5 px-4 font-mono">'
      + '<span class="text-mineora-gold font-bold">' + Number(order.oraAmount).toLocaleString() + ' ORA</span>'
      + '<span class="text-slate-400 text-[10px] block">($' + Number(order.usdtAmount).toFixed(2) + ' USDT)</span>'
      + '</td>'
      + '<td class="py-3.5 px-4 text-right">' + actionBtnHtml + '</td>';

    tbody.appendChild(tr);
  });
};

window.openP2pTradeModal = function(orderId, isBotOrder = false) {
  let order = null;
  if (isBotOrder) {
    order = getActiveBotOrders().find(o => o.id === orderId);
  } else {
    order = (realP2pOrdersMap && realP2pOrdersMap[orderId]) ? realP2pOrdersMap[orderId] : null;
    if (!order && realP2pOrdersMap) {
      order = Object.values(realP2pOrdersMap).find(o => o && (o.id === orderId || String(o.id) === String(orderId)));
    }
  }

  if (!order) {
    showToast("⚠️ İlan bulunamadı!", "warning");
    return;
  }

  const myUsername = (CurrentUser?.username || "").trim().toLowerCase();
  const merchantUsername = (order.merchant || "").trim().toLowerCase();
  if (myUsername && merchantUsername && myUsername === merchantUsername) {
    const wantCancel = confirm("Bu sizin kendi ilanınızdır. İlanı iptal edip varlıklarınızı cüzdanınıza geri almak istiyor musunuz?");
    if (wantCancel) {
      cancelP2pOrder(order.id || orderId);
    }
    return;
  }

  activeP2pOrder = order;
  const isBuy = p2pFilter === 'buy';
  const title = document.getElementById('p2p-trade-title');
  const merchant = document.getElementById('p2p-trade-merchant');
  const price = document.getElementById('p2p-trade-price');
  const inputOra = document.getElementById('p2p-trade-input-ora');
  const btn = document.getElementById('p2p-trade-btn-confirm');

  if (title) title.innerText = isBuy ? ("ORA Satın Al (" + order.merchant + ")") : ("ORA Sat (" + order.merchant + ")");
  if (merchant) merchant.innerText = order.merchant;
  if (price) price.innerText = "$" + Number(order.price).toFixed(4) + " USDT";
  if (inputOra) inputOra.value = order.oraAmount;

  if (btn) {
    btn.className = isBuy 
      ? "w-full py-3.5 rounded-xl bg-mineora-green text-white font-black text-xs hover:opacity-90 transition cursor-pointer" 
      : "w-full py-3.5 rounded-xl bg-rose-600 text-white font-black text-xs hover:opacity-90 transition cursor-pointer";
    btn.innerText = isBuy ? "USDT Öde ve ORA Al" : "ORA Gönder ve USDT Al";
  }

  openModal('modal-p2p-trade');
};

window.confirmP2pTrade = function() {
  if (!CurrentUser || !activeP2pOrder) return;
  if (isP2pProcessing) { showToast("⏳ İşlem yürütülüyor...", "info"); return; }

  const amtOra = Number(parseFloat(document.getElementById('p2p-trade-input-ora')?.value) || 0);
  const orderMaxOra = Number(parseFloat(activeP2pOrder.oraAmount) || 0);

  if (isNaN(amtOra) || amtOra <= 0 || amtOra > orderMaxOra) { 
    showToast("⚠️ Geçersiz miktar veya emir sınırını aşıyor!", "warning"); 
    return; 
  }

  const orderPrice = Number(parseFloat(activeP2pOrder.price) || 0.1000);
  const feeUsdtPercent = (typeof ProtocolState !== 'undefined' && ProtocolState.feeUsdtPercent) ? ProtocolState.feeUsdtPercent : 1.0;
  const feeOraPercent = (typeof ProtocolState !== 'undefined' && ProtocolState.feeOraPercent) ? ProtocolState.feeOraPercent : 1.0;

  const rawUsdt = Number((amtOra * orderPrice).toFixed(2));
  const feeUsdt = Number(((rawUsdt * feeUsdtPercent) / 100).toFixed(2));
  const burnOra = Number(((amtOra * feeOraPercent) / 100).toFixed(2));

  const realCurrentUsdt = Number(parseFloat(CurrentUser.usdt || 0).toFixed(2));
  const realCurrentOra = Number(parseFloat(CurrentUser.ora || 0).toFixed(2));

  if (p2pFilter === 'buy') {
    const totalRequiredUsdt = Number((rawUsdt + feeUsdt).toFixed(2));

    if (realCurrentUsdt < totalRequiredUsdt || realCurrentUsdt <= 0) {
      showToast("⛔ Yetersiz Bakiye! Bu alım için $" + totalRequiredUsdt.toFixed(2) + " USDT gereklidir. Cüzdanınız: $" + realCurrentUsdt.toFixed(2) + " USDT", "warning");
      return;
    }

    isP2pProcessing = true;
    CurrentUser.usdt = Number((realCurrentUsdt - totalRequiredUsdt).toFixed(2));
    CurrentUser.ora = Number((realCurrentOra + (amtOra - burnOra)).toFixed(2));

    if (activeP2pOrder.isBot) {
      if (typeof AdminState !== 'undefined') {
        AdminState.masterVaultUsdt = Number(((AdminState.masterVaultUsdt || 0) + totalRequiredUsdt).toFixed(2));
        AdminState.totalBurnedOra = Number(((AdminState.totalBurnedOra || 0) + burnOra).toFixed(2));
        saveAdminProtocolState(AdminState);
      }
      consumeBotOrder(activeP2pOrder.id, amtOra);
    } else {
      let merchantObj = getStoredUser(activeP2pOrder.merchant);
      if (merchantObj) {
        merchantObj.usdt = Number(((merchantObj.usdt || 0) + rawUsdt).toFixed(2));
        addUserNotificationLog(merchantObj, "P2P İlanınız Satıldı", CurrentUser.username + " sizden " + amtOra + " ORA satın aldı.", "+$" + rawUsdt.toFixed(2) + " USDT", "income");
        saveStoredUser(merchantObj);
      }
    }

    addUserNotificationLog(CurrentUser, "P2P ORA Alımı", "$" + totalRequiredUsdt.toFixed(2) + " USDT ödenerek " + amtOra + " ORA satın alındı.", "+" + (amtOra - burnOra).toFixed(2) + " ORA", "income");
    showToast("✅ $" + totalRequiredUsdt.toFixed(2) + " USDT tahsil edildi, " + (amtOra - burnOra).toFixed(2) + " ORA cüzdanınıza aktarıldı!", "success");
  } else if (p2pFilter === 'sell') {
    if (realCurrentOra < amtOra || realCurrentOra <= 0) {
      showToast("⛔ Yetersiz Maden! Satmak istediğiniz miktar: " + amtOra.toFixed(2) + " ORA. Cüzdanınız: " + realCurrentOra.toFixed(2) + " ORA", "warning");
      return;
    }

    isP2pProcessing = true;
    const netReceiveUsdt = Number((rawUsdt - feeUsdt).toFixed(2));

    CurrentUser.ora = Number((realCurrentOra - amtOra).toFixed(2));
    CurrentUser.usdt = Number((realCurrentUsdt + netReceiveUsdt).toFixed(2));

    if (activeP2pOrder.isBot) {
      if (typeof AdminState !== 'undefined') {
        AdminState.totalBurnedOra = Number(((AdminState.totalBurnedOra || 0) + amtOra).toFixed(2));
        saveAdminProtocolState(AdminState);
      }
      consumeBotOrder(activeP2pOrder.id, amtOra);
    } else {
      let merchantObj = getStoredUser(activeP2pOrder.merchant);
      if (merchantObj) {
        merchantObj.ora = Number(((merchantObj.ora || 0) + (amtOra - burnOra)).toFixed(2));
        addUserNotificationLog(merchantObj, "P2P Alış İlanınız Doldu", CurrentUser.username + " size " + amtOra + " ORA sattı.", "+" + (amtOra - burnOra).toFixed(2) + " ORA", "income");
        saveStoredUser(merchantObj);
      }
    }

    addUserNotificationLog(CurrentUser, "P2P ORA Satışı", amtOra + " ORA satıldı, komisyon düşülerek net ödeme alındı.", "+$" + netReceiveUsdt.toFixed(2) + " USDT", "income");
    showToast("✅ " + amtOra.toFixed(2) + " ORA cüzdanınızdan düşüldü, $" + netReceiveUsdt.toFixed(2) + " USDT kasanıza yansıtıldı!", "success");
  }

  if (!activeP2pOrder.isBot) {
    const targetOrderId = activeP2pOrder._key || activeP2pOrder.id;
    const remainingOra = Number((orderMaxOra - amtOra).toFixed(2));
    if (remainingOra <= 0.001) {
      delete realP2pOrdersMap[targetOrderId];
      if (typeof fbDb !== 'undefined' && fbDb) fbDb.ref("p2pOrders/" + targetOrderId).remove();
    } else {
      realP2pOrdersMap[targetOrderId].oraAmount = remainingOra;
      realP2pOrdersMap[targetOrderId].usdtAmount = Number((remainingOra * orderPrice).toFixed(2));
      if (typeof fbDb !== 'undefined' && fbDb) {
        fbDb.ref("p2pOrders/" + targetOrderId).update({
          oraAmount: remainingOra,
          usdtAmount: realP2pOrdersMap[targetOrderId].usdtAmount
        });
      }
    }
    saveLocalRealP2pOrders(realP2pOrdersMap);
  }

  saveUserWorld();
  updateHUD();
  closeModal('modal-p2p-trade');
  renderP2pOrders();
  setTimeout(() => { isP2pProcessing = false; }, 500);
};

setInterval(() => {
  const p2pSec = document.getElementById('sec-p2p');
  if (p2pSec && !p2pSec.classList.contains('hidden') && typeof renderP2pOrders === 'function') {
    renderP2pOrders();
  }
}, 5 * 60 * 1000);