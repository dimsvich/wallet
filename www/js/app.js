let db;
let exchangeRates = { USD: 41.5, EUR: 45.0 };

document.addEventListener("DOMContentLoaded", async () => {
  try {
    db = await initDB();
    await fetchRates();
    await refreshAppData();
  } catch (error) {
    console.error("Ошибка инициализации:", error);
  }

  const addManualBtn = document.getElementById("addManualBtn");
  if (addManualBtn) {
    addManualBtn.addEventListener("click", async () => {
      const accountId = document.getElementById("opAccountSelect").value;
      const categoryId = document.getElementById("opCategorySelect").value;
      const rawAmount = parseFloat(document.getElementById("manualAmount").value);
      const desc = document.getElementById("manualDesc").value.trim() || "Без описания";
      const type = document.getElementById("manualType").value;

      if (!accountId || isNaN(rawAmount) || rawAmount === 0) return;

      let amountInKopecks = Math.round(Math.abs(rawAmount) * 100);
      if (type === "expense") amountInKopecks = -amountInKopecks;

      const newTx = {
        id: "tx_" + Date.now(),
        accountId: accountId,
        categoryId: categoryId || "cat_default",
        amount: amountInKopecks,
        description: desc,
        date: Math.floor(Date.now() / 1000),
        userModified: true,
      };

      await saveTransaction(newTx);
      document.getElementById("manualAmount").value = "";
      document.getElementById("manualDesc").value = "";
      await refreshAppData();
    });
  }
});

// --- ГЛОБАЛЬНЫЕ ФУНКЦИИ ИНТЕРФЕЙСА ---
window.switchTab = function (tabName, btn) {
  document.querySelectorAll(".tab-content").forEach((el) => el.classList.remove("active"));
  document.querySelectorAll(".nav-item").forEach((el) => el.classList.remove("active"));
  document.getElementById("tab-" + tabName).classList.add("active");
  btn.classList.add("active");
};

window.openModal = function (modalId) {
  document.getElementById(modalId).style.display = "flex";
};
window.closeModal = function (modalId) {
  document.getElementById(modalId).style.display = "none";
};

window.toggleBankSelect = function () {
  const type = document.getElementById("accType").value;
  const cashFields = document.getElementById("cashFields");
  const bankFields = document.getElementById("bankFields");
  if (type === "bank") {
    cashFields.style.display = "none";
    bankFields.style.display = "block";
  } else {
    cashFields.style.display = "block";
    bankFields.style.display = "none";
  }
};

// Загрузка списка карт Монобанка по токену
window.loadMonoAccountsList = async function () {
  const token = document.getElementById("bankToken").value.trim();
  if (!token) {
    alert("Сначала введите токен Монобанка");
    return;
  }

  const container = document.getElementById("monoCardsContainer");
  const select = document.getElementById("monoCardSelect");
  select.innerHTML = "<option>Загрузка карт...</option>";
  container.style.display = "block";

  try {
    const res = await fetch("https://api.monobank.ua/personal/client-info", {
      headers: { "X-Token": token },
    });

    if (!res.ok) throw new Error("Неверный токен или ошибка API");
    const data = await res.json();

    select.innerHTML = "";
    if (data.accounts && data.accounts.length > 0) {
      data.accounts.forEach((acc) => {
        const currencySymbol = acc.currencyCode === 840 ? "$" : acc.currencyCode === 978 ? "€" : "₴";
        const balance = (acc.balance / 100).toFixed(2);

        let typeName = acc.type || "Карта";
        if (typeName === "black") typeName = "Черная карта";
        if (typeName === "white") typeName = "Белая карта";
        if (typeName === "fop") typeName = "Счет ФОП";

        const opt = document.createElement("option");
        opt.value = JSON.stringify({
          id: acc.id,
          currencyCode: acc.currencyCode,
          balance: acc.balance,
          creditLimit: acc.creditLimit || 0,
          typeName: typeName,
        });
        opt.innerText = `${typeName} (${balance} ${currencySymbol})`;
        select.appendChild(opt);
      });
    } else {
      select.innerHTML = '<option value="">Счетов не найдено</option>';
    }
  } catch (e) {
    console.error(e);
    select.innerHTML = '<option value="">Ошибка загрузки (проверьте токен)</option>';
  }
};

// Создание счета
window.createAccount = async function () {
  const nameInput = document.getElementById("accName").value.trim();
  const type = document.getElementById("accType").value;
  let newAccount = {};

  if (type === "bank") {
    const token = document.getElementById("bankToken").value.trim();
    const cardSelectStr = document.getElementById("monoCardSelect").value;

    if (!token || !cardSelectStr) {
      alert("Введите токен и выберите карту из списка");
      return;
    }

    const cardInfo = JSON.parse(cardSelectStr);
    let currency = "UAH";
    if (cardInfo.currencyCode === 840) currency = "USD";
    if (cardInfo.currencyCode === 978) currency = "EUR";

    newAccount = {
      id: "acc_" + Date.now(),
      name: nameInput || cardInfo.typeName,
      startBalance: cardInfo.balance,
      creditLimit: cardInfo.creditLimit || 0,
      currency: currency,
      type: "bank",
      bank: "monobank",
      token: token,
      bankAccountId: cardInfo.id,
    };
  } else {
    const startBalance = parseFloat(document.getElementById("accStartBalance").value) || 0;
    const currency = document.getElementById("accCurrency").value;

    if (!nameInput) {
      alert("Введите название счета");
      return;
    }

    newAccount = {
      id: "acc_" + Date.now(),
      name: nameInput,
      startBalance: Math.round(startBalance * 100),
      creditLimit: 0,
      currency: currency,
      type: "cash",
      bank: null,
      token: null,
      bankAccountId: null,
    };
  }

  await saveAccount(newAccount);
  window.closeModal("accountModal");
  await refreshAppData();
};

// Создание категории
window.createCategory = async function () {
  const nameInput = document.getElementById("newCatName");
  const name = nameInput.value.trim();
  if (!name) return;

  const newCat = {
    id: "cat_" + Date.now(),
    name: name,
  };

  await saveCategory(newCat);
  nameInput.value = "";
  await refreshAppData();
};

window.openCreateCategoryModal = function () {
  document.getElementById("editCategoryId").value = "";
  document.getElementById("categoryNameInput").value = "";
  document.getElementById("categoryModalTitle").innerText = "Добавить категорию";
  document.getElementById("saveCategoryBtn").innerText = "Создать";
  window.openModal("categoryModal");
};

window.openEditCategoryModal = async function (categoryId) {
  const categories = await getAllCategories();
  const category = categories.find((c) => c.id === categoryId);
  if (!category) return;

  document.getElementById("editCategoryId").value = categoryId;
  document.getElementById("categoryNameInput").value = category.name;
  document.getElementById("categoryModalTitle").innerText = "Редактировать категорию";
  document.getElementById("saveCategoryBtn").innerText = "Сохранить";
  window.openModal("categoryModal");
};

window.saveNewCategory = async function () {
  const categoryId = document.getElementById("editCategoryId").value;
  const categoryName = document.getElementById("categoryNameInput").value.trim();

  if (!categoryName) {
    alert("Введите название категории");
    return;
  }

  if (categoryId) {
    const categories = await getAllCategories();
    const category = categories.find((c) => c.id === categoryId);
    if (category) {
      category.name = categoryName;
      await saveCategory(category);
    }
  } else {
    const newCat = {
      id: "cat_" + Date.now(),
      name: categoryName,
    };
    await saveCategory(newCat);
  }

  window.closeModal("categoryModal");
  await refreshAppData();
};

window.deleteCategory = async function (categoryId) {
  if (categoryId === "cat_default") {
    alert("Нельзя удалить категорию 'Без категории'");
    return;
  }

  const transactions = await getAllTransactions();
  const usageCount = transactions.filter((t) => t.categoryId === categoryId).length;

  let confirmMsg = "Вы уверены, что хотите удалить эту категорию?";
  if (usageCount > 0) {
    confirmMsg += `\n\nЭта категория используется в ${usageCount} операции(ях).\nОни будут переведены в 'Без категории'.`;
  }

  if (!confirm(confirmMsg)) return;

  if (usageCount > 0) {
    const txsToUpdate = transactions.filter((t) => t.categoryId === categoryId);
    for (const t of txsToUpdate) {
      t.categoryId = "cat_default";
      await saveTransaction(t);
    }
  }

  return new Promise((resolve, reject) => {
    const tx = db.transaction("categories", "readwrite");
    tx.objectStore("categories").delete(categoryId);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  })
    .then(() => refreshAppData())
    .catch((err) => console.error("Ошибка удаления:", err));
};

// Открытие редактора транзакции
window.openEditTransaction = async function (txId) {
  const transactions = await getAllTransactions();
  const tx = transactions.find((t) => t.id === txId);
  if (!tx) return;

  document.getElementById("editTxId").value = tx.id;
  document.getElementById("editTxAmount").value = (tx.amount / 100).toFixed(2);
  document.getElementById("editTxDesc").value = tx.description;

  const accounts = await getAllAccounts();
  const categories = await getAllCategories();

  const accSelect = document.getElementById("editTxAccount");
  const catSelect = document.getElementById("editTxCategory");

  accSelect.innerHTML = "";
  catSelect.innerHTML = "";

  accounts.forEach((a) => {
    const opt = document.createElement("option");
    opt.value = a.id;
    opt.innerText = a.name;
    if (a.id === tx.accountId) opt.selected = true;
    accSelect.appendChild(opt);
  });

  categories.forEach((c) => {
    const opt = document.createElement("option");
    opt.value = c.id;
    opt.innerText = c.name;
    if (c.id === tx.categoryId) opt.selected = true;
    catSelect.appendChild(opt);
  });

  window.openModal("editTxModal");
};

window.saveEditedTransaction = async function () {
  const txId = document.getElementById("editTxId").value;
  const accountId = document.getElementById("editTxAccount").value;
  const categoryId = document.getElementById("editTxCategory").value;
  const rawAmount = parseFloat(document.getElementById("editTxAmount").value);
  const desc = document.getElementById("editTxDesc").value.trim();

  if (isNaN(rawAmount)) return;

  const transactions = await getAllTransactions();
  const tx = transactions.find((t) => t.id === txId);
  if (!tx) return;

  const isNegative = tx.amount < 0;
  let newAmount = Math.round(Math.abs(rawAmount) * 100);
  if (isNegative) newAmount = -newAmount;

  tx.accountId = accountId;
  tx.categoryId = categoryId;
  tx.amount = newAmount;
  tx.description = desc;
  tx.userModified = true;

  await saveTransaction(tx);
  window.closeModal("editTxModal");
  await refreshAppData();
};

window.deleteTransaction = async function () {
  const txId = document.getElementById("editTxId").value;
  await removeTransaction(txId);
  window.closeModal("editTxModal");
  await refreshAppData();
};

// Корректировка баланса
window.openAdjustModal = function (accountId, currentBalance) {
  document.getElementById("adjustAccId").value = accountId;
  document.getElementById("adjustRealAmount").value = (currentBalance / 100).toFixed(2);
  window.openModal("adjustModal");
};

window.saveBalanceAdjustment = async function () {
  const accountId = document.getElementById("adjustAccId").value;
  const realAmountVal = parseFloat(document.getElementById("adjustRealAmount").value);
  if (isNaN(realAmountVal)) return;

  const accounts = await getAllAccounts();
  const transactions = await getAllTransactions();
  const acc = accounts.find((a) => a.id === accountId);
  if (!acc) return;

  let currentBalance = acc.startBalance;
  transactions.forEach((tx) => {
    if (tx.accountId === accountId) currentBalance += tx.amount;
  });

  const targetBalanceInKopecks = Math.round(realAmountVal * 100);
  const diff = targetBalanceInKopecks - currentBalance;

  if (diff !== 0) {
    const adjTx = {
      id: "tx_adj_" + Date.now(),
      accountId: accountId,
      categoryId: "cat_default",
      amount: diff,
      description: "Коррекция баланса",
      date: Math.floor(Date.now() / 1000),
      userModified: true,
    };
    await saveTransaction(adjTx);
  }

  window.closeModal("adjustModal");
  await refreshAppData();
};

// Функция для установки статуса сразу на обе вкладки
function setSyncStatusMsg(text, isHtml = false) {
  const statusEl = document.getElementById("status");
  const homeStatusEl = document.getElementById("homeStatus");
  if (statusEl) { isHtml ? statusEl.innerHTML = text : statusEl.innerText = text; }
  if (homeStatusEl) { isHtml ? homeStatusEl.innerHTML = text : homeStatusEl.innerText = text; }
}

// Синхронизация Монобанка
window.syncMonoAccount = async function (accountId, token) {
  setSyncStatusMsg("Синхронизация Монобанка...");

  try {
    const headers = { "X-Token": token };
    const accounts = await getAllAccounts();
    const targetAcc = accounts.find((a) => a.id === accountId);
    const bankAccId = targetAcc ? targetAcc.bankAccountId : null;

    const to = Math.floor(Date.now() / 1000);
    const from = to - 30 * 24 * 60 * 60;
    const stmtResponse = await fetch(`https://api.monobank.ua/personal/statement/0/${from}/${to}`, { headers });

    if (!stmtResponse.ok) throw new Error("Ошибка API выписки Mono");
    const data = await stmtResponse.json();

    const existingTxs = await getAllTransactions();

    for (let t of data) {
      const txId = "mono_" + t.id;
      const existing = existingTxs.find((item) => item.id === txId);

      if (existing && existing.userModified) continue;

      const txData = {
        id: txId,
        accountId: accountId,
        categoryId: "cat_default",
        amount: t.amount,
        description: t.description,
        date: t.time,
        userModified: false,
      };
      await saveTransaction(txData);
    }

    const clientResponse = await fetch("https://api.monobank.ua/personal/client-info", { headers });
    if (clientResponse.ok) {
      const clientData = await clientResponse.json();
      if (clientData.accounts && clientData.accounts.length > 0) {
        const bankAccount = bankAccId
          ? clientData.accounts.find((a) => a.id === bankAccId) || clientData.accounts[0]
          : clientData.accounts[0];

        const realBalanceInKopecks = bankAccount.balance;
        const realCreditLimit = bankAccount.creditLimit || 0;
        const updatedTransactions = await getAllTransactions();

        if (targetAcc) {
          if (targetAcc.creditLimit !== realCreditLimit) {
             targetAcc.creditLimit = realCreditLimit;
             await saveAccount(targetAcc);
          }

          let internalBalance = targetAcc.startBalance;
          updatedTransactions.forEach((tx) => {
            if (tx.accountId === accountId) internalBalance += tx.amount;
          });

          const diff = realBalanceInKopecks - internalBalance;
          if (diff !== 0) {
            const diffUah = (diff / 100).toFixed(2);
            setSyncStatusMsg(`⚠️ Внимание! Баланс расходится на <span style="color:#ff5722;">${diffUah} ₴</span>. 
            <button class="btn-sm" style="background:#ff5722; margin-top:5px;" onclick="openAdjustModal('${accountId}', ${internalBalance + diff})">Сверить автоматически</button>`, true);
            await refreshAppData();
            return;
          }
        }
      }
    }

    setSyncStatusMsg(`Синхронизация успешна! Балансы сходятся.`);
    await refreshAppData();
  } catch (error) {
    console.error(error);
    setSyncStatusMsg("Ошибка подключения к Monobank.");
  }
};

// --- ФУНКЦИЯ ДЛЯ ГРУППИРОВКИ И ОТРИСОВКИ ОПЕРАЦИЙ ---
function renderTransactionsGrouped(transactionsToRender, containerElement, accounts, categories) {
  if (!containerElement) return;
  containerElement.innerHTML = "";

  if (transactionsToRender.length === 0) {
    containerElement.innerHTML = '<p style="text-align:center; color:#888;">Операций пока нет.</p>';
    return;
  }

  // Группировка по дате (в формате "25 октября 2026 г.")
  const grouped = {};
  transactionsToRender.forEach((tx) => {
    const dateObj = new Date(tx.date * 1000);
    const dateStr = dateObj.toLocaleDateString("ru-RU", { day: 'numeric', month: 'long', year: 'numeric' });
    if (!grouped[dateStr]) grouped[dateStr] = [];
    grouped[dateStr].push(tx);
  });

  for (const [dateStr, txs] of Object.entries(grouped)) {
    // Создаем заголовок с датой
    const header = document.createElement("div");
    header.style = "font-size: 13px; color: #888; margin: 15px 0 8px 5px; font-weight: bold; text-transform: uppercase;";
    header.innerText = dateStr;
    containerElement.appendChild(header);

    // Отрисовываем операции за этот день
    txs.forEach((tx) => {
      const acc = accounts.find((a) => a.id === tx.accountId);
      const cat = categories.find((c) => c.id === tx.categoryId);
      const accName = acc ? acc.name : "Удаленный счет";
      const catName = cat ? cat.name : "Без категории";
      const symbol = acc ? (acc.currency === "USD" ? "$" : acc.currency === "EUR" ? "€" : "₴") : "₴";

      const card = document.createElement("div");
      card.className = "tx-card";
      card.onclick = () => openEditTransaction(tx.id);

      const amount = tx.amount / 100;
      const amountStr = amount > 0 ? `+${amount} ${symbol}` : `${amount} ${symbol}`;
      const colorClass = amount > 0 ? "green" : "white";

      // Внутри карточки выводим только время
      const dateObj = new Date(tx.date * 1000);
      const timeStr = dateObj.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });

      card.innerHTML = `
          <div class="tx-info">
              <span class="tx-desc">${tx.description}</span>
              <span class="tx-date">${catName} • ${accName} • ${timeStr}</span>
          </div>
          <div class="tx-amount ${colorClass}">${amountStr}</div>
      `;
      containerElement.appendChild(card);
    });
  }
}

// --- БАЗА ДАННЫХ (Версия 3) ---
function initDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("ZenLocalDB", 3);
    request.onerror = () => reject("Ошибка IndexedDB");
    request.onsuccess = (e) => resolve(e.target.result);
    request.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains("accounts")) db.createObjectStore("accounts", { keyPath: "id" });
      if (!db.objectStoreNames.contains("transactions")) db.createObjectStore("transactions", { keyPath: "id" });
      if (!db.objectStoreNames.contains("categories")) {
        const catStore = db.createObjectStore("categories", { keyPath: "id" });
        catStore.put({ id: "cat_default", name: "Без категории" });
      }
    };
  });
}
function saveAccount(acc) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction("accounts", "readwrite");
    tx.objectStore("accounts").put(acc);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}
function saveCategory(cat) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction("categories", "readwrite");
    tx.objectStore("categories").put(cat);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}
function saveTransaction(txData) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction("transactions", "readwrite");
    tx.objectStore("transactions").put(txData);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}
function removeTransaction(txId) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction("transactions", "readwrite");
    tx.objectStore("transactions").delete(txId);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}
async function getAllAccounts() {
  return new Promise((resolve) => {
    const tx = db.transaction("accounts", "readonly");
    const req = tx.objectStore("accounts").getAll();
    req.onsuccess = () => resolve(req.result);
  });
}
async function getAllCategories() {
  return new Promise((resolve) => {
    const tx = db.transaction("categories", "readonly");
    const req = tx.objectStore("categories").getAll();
    req.onsuccess = () => resolve(req.result);
  });
}
async function getAllTransactions() {
  return new Promise((resolve) => {
    const tx = db.transaction("transactions", "readonly");
    const req = tx.objectStore("transactions").getAll();
    req.onsuccess = () => resolve(req.result);
  });
}

// --- КУРСЫ ВАЛЮТ ---
async function fetchRates() {
  try {
    const res = await fetch("https://api.monobank.ua/bank/currency");
    if (!res.ok) return;
    const data = await res.json();
    const usdRate = data.find((item) => item.currencyCodeA === 840 && item.currencyCodeB === 980);
    const eurRate = data.find((item) => item.currencyCodeA === 978 && item.currencyCodeB === 980);

    if (usdRate) exchangeRates.USD = usdRate.rateSell || usdRate.rateCross || exchangeRates.USD;
    if (eurRate) exchangeRates.EUR = eurRate.rateSell || eurRate.rateCross || exchangeRates.EUR;

    if (document.getElementById("rateUsd")) document.getElementById("rateUsd").innerText = `${exchangeRates.USD.toFixed(2)} ₴`;
    if (document.getElementById("rateEur")) document.getElementById("rateEur").innerText = `${exchangeRates.EUR.toFixed(2)} ₴`;
  } catch (e) {
    if (document.getElementById("rateUsd")) document.getElementById("rateUsd").innerText = `${exchangeRates.USD.toFixed(2)} ₴`;
    if (document.getElementById("rateEur")) document.getElementById("rateEur").innerText = `${exchangeRates.EUR.toFixed(2)} ₴`;
  }
}

// --- ОБНОВЛЕНИЕ ИНТЕРФЕЙСА ---
async function refreshAppData() {
  const accounts = await getAllAccounts();
  const categories = await getAllCategories();
  const transactions = await getAllTransactions();

  const homeAccountsList = document.getElementById("homeAccountsList");
  const accountsList = document.getElementById("accountsList");
  const opAccountSelect = document.getElementById("opAccountSelect");
  const opCategorySelect = document.getElementById("opCategorySelect");
  
  const homeTransactions = document.getElementById("homeTransactions");
  const txContainer = document.getElementById("transactions");

  if (homeAccountsList) homeAccountsList.innerHTML = "";
  if (accountsList) accountsList.innerHTML = "";
  if (opAccountSelect) opAccountSelect.innerHTML = "";
  if (opCategorySelect) opCategorySelect.innerHTML = "";

  let totalGlobalBalanceUAH = 0;

  accounts.forEach((acc) => {
    let accBalance = acc.startBalance;
    transactions.forEach((tx) => {
      if (tx.accountId === acc.id) accBalance += tx.amount;
    });

    let creditLimit = acc.creditLimit || 0;
    let ownFunds = accBalance - creditLimit;

    let balanceInUAH = ownFunds;
    if (acc.currency === "USD") balanceInUAH = ownFunds * exchangeRates.USD;
    if (acc.currency === "EUR") balanceInUAH = ownFunds * exchangeRates.EUR;
    totalGlobalBalanceUAH += balanceInUAH;

    const symbol = acc.currency === "USD" ? "$" : acc.currency === "EUR" ? "€" : "₴";
    const ownFundsStr = (ownFunds / 100).toFixed(2);
    const availableStr = (accBalance / 100).toFixed(2);

    let sumHtml = `<div class="account-sum">${ownFundsStr} ${symbol}</div>`;
    if (creditLimit > 0) {
        sumHtml = `
            <div class="account-sum" style="color: ${ownFunds < 0 ? '#f44336' : 'white'};">${ownFundsStr} ${symbol}</div>
            <div style="font-size: 11px; color: #888; text-align: right; margin-top: 3px;">Доступно: ${availableStr} ${symbol}</div>
        `;
    }

    // 1. Отрисовка карточки для "ГЛАВНОЙ" вкладки (без кнопки Сверить)
    if (homeAccountsList) {
        const homeCard = document.createElement("div");
        homeCard.className = "account-card";
        homeCard.innerHTML = `
            <div class="account-info">
                <span class="account-name">${acc.name}</span>
                <span class="account-sub">${acc.type === "bank" ? "Банк: " + acc.bank : "Наличные"}</span>
                <div class="account-actions">
                    ${acc.type === "bank" && acc.token ? `<button class="btn-sm" style="background:#ff5722;" onclick="syncMonoAccount('${acc.id}', '${acc.token}')">🔄 Синхронизировать</button>` : ""}
                </div>
            </div>
            <div style="display:flex; flex-direction:column; justify-content:center; align-items:flex-end;">
                ${sumHtml}
            </div>
        `;
        homeAccountsList.appendChild(homeCard);
    }

    // 2. Отрисовка карточки для вкладки "СЧЕТА" (с кнопкой Сверить)
    if (accountsList) {
        const adminCard = document.createElement("div");
        adminCard.className = "account-card";
        adminCard.innerHTML = `
            <div class="account-info">
                <span class="account-name">${acc.name}</span>
                <span class="account-sub">${acc.type === "bank" ? "Банк: " + acc.bank : "Наличные"}</span>
                <div class="account-actions">
                    <button class="btn-secondary btn-sm" onclick="openAdjustModal('${acc.id}', ${accBalance})">Сверить</button>
                    ${acc.type === "bank" && acc.token ? `<button class="btn-sm" style="background:#ff5722;" onclick="syncMonoAccount('${acc.id}', '${acc.token}')">🔄 Sync</button>` : ""}
                </div>
            </div>
            <div style="display:flex; flex-direction:column; justify-content:center; align-items:flex-end;">
                ${sumHtml}
            </div>
        `;
        accountsList.appendChild(adminCard);
    }

    if (opAccountSelect) {
        const opt = document.createElement("option");
        opt.value = acc.id;
        opt.innerText = `${acc.name} (Ост: ${availableStr} ${symbol})`;
        opAccountSelect.appendChild(opt);
    }
  });

  if (accounts.length === 0) {
    if (homeAccountsList) homeAccountsList.innerHTML = '<p style="color:#888; text-align:center;">Нет счетов.</p>';
    if (accountsList) accountsList.innerHTML = '<p style="color:#888; text-align:center;">Нет счетов. Добавьте первый счет.</p>';
  }

  categories.forEach((cat) => {
    if (opCategorySelect) {
        const opt = document.createElement("option");
        opt.value = cat.id;
        opt.innerText = cat.name;
        opCategorySelect.appendChild(opt);
    }
  });

  document.getElementById("totalBalance").innerText = (totalGlobalBalanceUAH / 100).toFixed(2) + " ₴";

  const categoriesList = document.getElementById("categoriesList");
  if (categoriesList) {
    categoriesList.innerHTML = "";
    categories.forEach(function (cat) {
      var usageCount = transactions.filter(function (t) { return t.categoryId === cat.id; }).length;
      var isDefault = cat.id === "cat_default";
      var usageText = usageCount > 0 ? usageCount + " операций" : "Не используется";
      var card = document.createElement("div");
      card.className = "category-card";
      var actionsHtml = "";
      if (!isDefault) {
        actionsHtml =
          '<button class="btn-sm" onclick="openEditCategoryModal(\x27' + cat.id + '\x27)">\u270E Редакт.</button>' +
          '<button class="btn-sm btn-danger" onclick="deleteCategory(\x27' + cat.id + '\x27)">\u2715 Удалить</button>';
      } else {
        actionsHtml = '<span style="color:#888;font-size:12px;">Системная</span>';
      }
      card.innerHTML =
        '<div class="category-info"><span class="category-name">' + cat.name + '</span><span class="category-usage">' + usageText + '</span></div><div class="category-actions">' + actionsHtml + "</div>";
      categoriesList.appendChild(card);
    });
    if (categories.length === 0) {
      categoriesList.innerHTML = '<p style="color:#888; text-align:center;">Категорий нет. Создайте первую.</p>';
    }
  }

  // Отрисовка транзакций по датам для Главной вкладки и вкладки Операции
  const sortedTxs = transactions.sort((a, b) => b.date - a.date).slice(0, 100);
  renderTransactionsGrouped(sortedTxs, homeTransactions, accounts, categories);
  renderTransactionsGrouped(sortedTxs, txContainer, accounts, categories);
}

window.exportData = async function () {
  const accounts = await getAllAccounts();
  const categories = await getAllCategories();
  const transactions = await getAllTransactions();
  const backup = { accounts, categories, transactions, date: new Date().toISOString() };
  const blob = new Blob([JSON.stringify(backup, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `zenlocal_backup_${Date.now()}.json`;
  a.click();
};