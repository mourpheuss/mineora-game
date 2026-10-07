// ================= 5. BORSA TAKAS / P2P MOTORU (p2p.js) =================
function getP2pOrders() {
  const saved = localStorage.getItem('mineora_global_p2p_orders');
  if (saved) { try { return JSON.parse(saved); } catch(e) {} }
  return [];
}
function saveP2pOrders(o) { 
  localStorage.setItem('mineora_global_p2p_orders', JSON.stringify(o)); 
  if (typeof fbDb !== 'undefined' && fbDb) {
    try { fbDb.ref('p2pOrders').set(o); } catch(e) {}
  }
}

let globalP2pOrders = getP2pOrders();
let p2pFilter = 'buy';
let p2pCreateSide = 'buy';
let activeP2pOrder = null;
let isP2pProcessing = false;

function setP2pFilter(filter) {
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
}

function setP2pCreateSide(side) {
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
}

function calculateP2pCreatePreview() {
  const price = parseFloat(document.getElementById('p2p-create-price')?.value) || 0;
  const amt = parseFloat(document.getElementById('p2p-create-amount')?.value) || 0;
  const preview = document.getElementById('p2p-preview-usdt');
  if (preview) preview.innerText = `$${(price * amt).toFixed(2)} USDT`;
}

function submitP2pOrder() {
  if (!CurrentUser) return;
  if (isP2pProcessing) { showToast("⏳ Processing request...", "info"); return; }

  const price = parseFloat(document.getElementById('p2p-create-price')?.value);
  const oraAmt = parseFloat(document.getElementById('p2p-create-amount')?.value);

  if (isNaN(price) || price <= 0 || isNaN(oraAmt) || oraAmt <= 0) {
    showToast("⚠️ Enter valid price and ORA quantity!", "warning");
    return;
  }

  const totalUsdt = Number((price * oraAmt).toFixed(2));
  const currentOra = Number(parseFloat(CurrentUser.ora || 0).toFixed(2));
  const currentUsdt = Number(parseFloat(CurrentUser.usdt || 0).toFixed(2));

  if (p2pCreateSide === 'sell') {
    if (oraAmt > currentOra) { showToast(`⚠️ Insufficient ORA to sell! Available: ${currentOra.toFixed(2)} ORA`, "warning"); return; }
    CurrentUser.ora = Number((currentOra - oraAmt).toFixed(2));
  } else {
    if (totalUsdt > currentUsdt) { showToast(`⚠️ Insufficient USDT for buy offer! Required: $${totalUsdt.toFixed(2)} USDT`, "warning"); return; }
    CurrentUser.usdt = Number((currentUsdt - totalUsdt).toFixed(2));
  }

  isP2pProcessing = true;
  saveUserWorld();
  updateHUD();

  globalP2pOrders.unshift({
    id: Date.now(), side: p2pCreateSide, merchant: CurrentUser.username, price: price, oraAmount: oraAmt, usdtAmount: totalUsdt
  });

  saveP2pOrders(globalP2pOrders);
  closeModal('modal-p2p-create');
  renderP2pOrders();
  showToast("📋 Offer listed on P2P book and funds locked in escrow!", "success");
  setTimeout(() => { isP2pProcessing = false; }, 800);
}

function cancelP2pOrder(orderId) {
  if (!CurrentUser || isP2pProcessing) return;
  const idx = globalP2pOrders.findIndex(o => o.id === orderId);
  if (idx === -1) return;
  const order = globalP2pOrders[idx];

  if (order.merchant.toLowerCase() !== CurrentUser.username.toLowerCase()) {
    showToast("⛔ You can only cancel your own offers!", "warning");
    return;
  }

  isP2pProcessing = true;
  if (order.side === 'sell') {
    CurrentUser.ora = Number(((CurrentUser.ora || 0) + order.oraAmount).toFixed(2));
    showToast(`↩️ Offer cancelled! Refunded ${order.oraAmount.toFixed(2)} ORA.`, "info");
  } else {
    CurrentUser.usdt = Number(((CurrentUser.usdt || 0) + order.usdtAmount).toFixed(2));
    showToast(`↩️ Offer cancelled! Refunded $${order.usdtAmount.toFixed(2)} USDT.`, "info");
  }

  globalP2pOrders.splice(idx, 1);
  saveP2pOrders(globalP2pOrders);
  saveUserWorld(); updateHUD(); renderP2pOrders();
  setTimeout(() => { isP2pProcessing = false; }, 600);
}

function renderP2pOrders() {
  const tbody = document.getElementById('p2p-order-list');
  if (!tbody) return;
  tbody.innerHTML = "";

  const targetSide = p2pFilter === 'buy' ? 'sell' : 'buy';
  const filtered = globalP2pOrders.filter(o => o.side === targetSide && o.oraAmount > 0);

  if (filtered.length === 0) {
    tbody.innerHTML = `<tr><td colspan="4" class="py-8 text-center text-slate-500">No active orders in this direction.</td></tr>`;
    return;
  }

  filtered.forEach(order => {
    const isMyOrder = CurrentUser && CurrentUser.username.toLowerCase() === order.merchant.toLowerCase();
    const tr = document.createElement('tr');
    tr.className = "hover:bg-mineora-bg/50 transition border-b border-mineora-border/40 text-xs";
    const btnClass = p2pFilter === 'buy' ? "bg-mineora-green hover:opacity-90 text-white" : "bg-rose-600 hover:opacity-90 text-white";
    const btnText = p2pFilter === 'buy' ? (currentLang === 'ru' ? "Оплатить USDT & Получить ORA" : "Pay USDT & Get ORA") : (currentLang === 'ru' ? "Отправить ORA & Получить USDT" : "Send ORA & Get USDT");

    tr.innerHTML = `
      <td class="py-3.5 px-4 font-bold text-white flex items-center gap-2">
        <div class="w-7 h-7 rounded-lg bg-mineora-input flex items-center justify-center text-mineora-gold text-xs font-black">
          ${order.merchant.charAt(0).toUpperCase()}
        </div>
        <div>
          <span>${order.merchant}</span>
          ${isMyOrder ? `<span class="ml-1 px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-300 text-[9px] font-bold">${currentLang === 'ru' ? 'ВАШ ОРДЕР' : 'YOUR OFFER'}</span>` : ''}
        </div>
      </td>
      <td class="py-3.5 px-4 font-mono font-bold text-white">$${order.price.toFixed(4)} USDT</td>
      <td class="py-3.5 px-4 font-mono">
        <span class="text-mineora-gold font-bold">${order.oraAmount.toLocaleString()} ORA</span>
        <span class="text-slate-400 text-[10px] block">($${order.usdtAmount.toFixed(2)} USDT)</span>
      </td>
      <td class="py-3.5 px-4 text-right">
        ${isMyOrder ? `
          <button type="button" onclick="cancelP2pOrder(${order.id})" class="px-3.5 py-1.5 rounded-xl text-xs font-black bg-rose-600/20 hover:bg-rose-600/40 text-rose-400 border border-rose-500/40 transition cursor-pointer">
            <i class="fa-solid fa-ban mr-1"></i> ${currentLang === 'ru' ? 'Отмена' : 'Cancel'}
          </button>
        ` : `
          <button type="button" onclick="openP2pTradeModal(${order.id})" class="px-4 py-2 rounded-xl text-xs font-black transition cursor-pointer shadow ${btnClass}">
            ${btnText}
          </button>
        `}
      </td>
    `;
    tbody.appendChild(tr);
  });
}

function openP2pTradeModal(orderId) {
  const order = globalP2pOrders.find(o => o.id === orderId);
  if (!order) return;
  activeP2pOrder = order;

  if (CurrentUser && CurrentUser.username.toLowerCase() === order.merchant.toLowerCase()) {
    showToast("⚠️ You cannot trade against your own offer!", "warning");
    return;
  }

  const isBuy = p2pFilter === 'buy';
  const title = document.getElementById('p2p-trade-title');
  const merchant = document.getElementById('p2p-trade-merchant');
  const price = document.getElementById('p2p-trade-price');
  const inputOra = document.getElementById('p2p-trade-input-ora');
  const btn = document.getElementById('p2p-trade-btn-confirm');

  if (title) {
    if (currentLang === 'ru') {
      title.innerText = isBuy ? `Купить ORA за USDT (${order.merchant})` : `Продать ORA за USDT (${order.merchant})`;
    } else {
      title.innerText = isBuy ? `Buy ORA with USDT (${order.merchant})` : `Sell ORA for USDT (${order.merchant})`;
    }
  }
  if (merchant) merchant.innerText = order.merchant;
  if (price) price.innerText = `$${order.price.toFixed(4)} USDT`;
  if (inputOra) inputOra.value = order.oraAmount;

  if (btn) {
    btn.className = isBuy 
      ? "w-full py-3.5 rounded-xl bg-mineora-green text-white font-black text-xs hover:opacity-90 transition cursor-pointer" 
      : "w-full py-3.5 rounded-xl bg-rose-600 text-white font-black text-xs hover:opacity-90 transition cursor-pointer";
    btn.innerText = isBuy 
      ? (currentLang === 'ru' ? "Оплатить USDT и Получить ORA" : "Pay USDT and Receive ORA")
      : (currentLang === 'ru' ? "Отправить ORA и Получить USDT" : "Send ORA and Receive USDT");
  }

  openModal('modal-p2p-trade');
}

function confirmP2pTrade() {
  if (!CurrentUser || !activeP2pOrder) return;
  if (isP2pProcessing) { showToast("⏳ Processing settlement...", "info"); return; }

  const amtOra = parseFloat(document.getElementById('p2p-trade-input-ora')?.value);
  if (isNaN(amtOra) || amtOra <= 0 || amtOra > activeP2pOrder.oraAmount) { 
    showToast("⚠️ Invalid quantity or exceeds offer bounds!", "warning"); 
    return; 
  }

  const feeUsdtPercent = (typeof ProtocolState !== 'undefined' && ProtocolState.feeUsdtPercent) ? ProtocolState.feeUsdtPercent : 1.0;
  const feeOraPercent = (typeof ProtocolState !== 'undefined' && ProtocolState.feeOraPercent) ? ProtocolState.feeOraPercent : 1.0;

  const rawUsdt = Number((amtOra * activeP2pOrder.price).toFixed(2));
  const feeUsdt = Number(((rawUsdt * feeUsdtPercent) / 100).toFixed(2));
  const burnOra = Number(((amtOra * feeOraPercent) / 100).toFixed(2));

  const merchantKey = `mineora_user_${activeP2pOrder.merchant.toLowerCase()}`;
  let merchantObj = null;
  try { merchantObj = JSON.parse(localStorage.getItem(merchantKey)); } catch(e) {}

  if (!merchantObj) { showToast("⚠️ Merchant record unavailable!", "warning"); return; }

  isP2pProcessing = true;

  if (p2pFilter === 'buy') {
    const totalUsdt = Number((rawUsdt + feeUsdt).toFixed(2));
    const myUsdt = Number(parseFloat(CurrentUser.usdt || 0).toFixed(2));
    if (myUsdt < totalUsdt) {
      showToast(`⚠️ Insufficient USDT! Required: $${totalUsdt.toFixed(2)} USDT`, "warning");
      isP2pProcessing = false;
      return;
    }

    CurrentUser.usdt = Number((myUsdt - totalUsdt).toFixed(2));
    CurrentUser.ora = Number(((CurrentUser.ora || 0) + (amtOra - burnOra)).toFixed(2));
    merchantObj.usdt = Number(((merchantObj.usdt || 0) + rawUsdt).toFixed(2));
    saveStoredUser(merchantObj);
    showToast(`✅ Trade settled! ${(amtOra - burnOra).toFixed(2)} ORA credited to wallet.`, "success");
  } else {
    const myOra = Number(parseFloat(CurrentUser.ora || 0).toFixed(2));
    if (myOra < amtOra) {
      showToast(`⚠️ Insufficient ORA to sell! Available: ${myOra.toFixed(2)} ORA`, "warning");
      isP2pProcessing = false;
      return;
    }

    const netUsdt = Number((rawUsdt - feeUsdt).toFixed(2));
    CurrentUser.ora = Number((myOra - amtOra).toFixed(2));
    CurrentUser.usdt = Number(((CurrentUser.usdt || 0) + netUsdt).toFixed(2));
    merchantObj.ora = Number(((merchantObj.ora || 0) + (amtOra - burnOra)).toFixed(2));
    saveStoredUser(merchantObj);
    showToast(`✅ Trade settled! $${netUsdt.toFixed(2)} USDT credited to wallet.`, "success");
  }

  if (typeof ProtocolState !== 'undefined') {
    ProtocolState.adminVaultUsdt = Number(((ProtocolState.adminVaultUsdt || 0) + feeUsdt).toFixed(2));
    ProtocolState.totalBurnedOra = Number(((ProtocolState.totalBurnedOra || 0) + burnOra).toFixed(2));
    saveGlobalProtocolState(ProtocolState);
  }

  if (typeof AdminState !== 'undefined') {
    AdminState.masterVaultUsdt = Number(((AdminState.masterVaultUsdt || 0) + feeUsdt).toFixed(2));
    AdminState.totalBurnedOra = Number(((AdminState.totalBurnedOra || 0) + burnOra).toFixed(2));
    if (typeof saveAdminProtocolState === 'function') saveAdminProtocolState(AdminState);
  }

  activeP2pOrder.oraAmount = Number((activeP2pOrder.oraAmount - amtOra).toFixed(2));
  activeP2pOrder.usdtAmount = Number((activeP2pOrder.oraAmount * activeP2pOrder.price).toFixed(2));
  if (activeP2pOrder.oraAmount <= 0.001) {
    globalP2pOrders = globalP2pOrders.filter(o => o.id !== activeP2pOrder.id);
  }

  saveP2pOrders(globalP2pOrders);
  saveUserWorld(); updateHUD(); closeModal('modal-p2p-trade'); renderP2pOrders();
  setTimeout(() => { isP2pProcessing = false; }, 800);
}

if (typeof fbDb !== 'undefined' && fbDb) {
  try {
    fbDb.ref('p2pOrders').on('value', snapshot => {
      const val = snapshot.val();
      if (val) {
        globalP2pOrders = val;
        localStorage.setItem('mineora_global_p2p_orders', JSON.stringify(val));
        const p2pSec = document.getElementById('sec-p2p');
        if (p2pSec && !p2pSec.classList.contains('hidden')) renderP2pOrders();
      }
    });
  } catch(e) {}
}