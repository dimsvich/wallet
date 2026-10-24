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

  // Ручное добавление операции
  const addManualBtn = document.getElementById("addManualBtn");
  if (addManualBtn) {
    addManualBtn.addEventListener("click", async () => {
      const accountId = document.getElementById("opAccountSelect").value;
      const rawAmount = parseFloat(
        document.getElementById("manualAmount").value,
      );
      const desc =
        document.getElementById("manualDesc").value.trim() || "Без описания";
      const type = document.getElementById("manualType").value;

      if (!accountId || isNaN(rawAmount) || rawAmount === 0) return;

      let amountInKopecks = Math.round(Math.abs(rawAmount) * 100);
      if (type === "expense") amountInKopecks = -amountInKopecks;

      const newTx = {
        id: "tx_" + Date.now(),
        accountId: accountId,
        amount: amountInKopecks,
        description: desc,
        date: Math.floor(Date.now() / 1000),
      };

      await saveTransaction(newTx);
      document.getElementById("manualAmount").value = "";
      document.getElementById("manualDesc").value = "";
      await refreshAppData();
    });
  }
});

// --- ГЛОБАЛЬНЫЕ ФУНКЦИИ ДЛЯ ИНТЕРФЕЙСА (ОКНА И ВКЛАДКИ) ---

window.switchTab = function (tabName, btn) {
  document
    .querySelectorAll(".tab-content")
    .forEach((el) => el.classList.remove("active"));
  document
    .querySelectorAll(".nav-item")
    .forEach((el) => el.classList.remove("active"));
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
  document.getElementById("bankFields").style.display =
    type === "bank" ? "block" : "none";
};

// Создание счета
window.createAccount = async function () {
  const name = document.getElementById("accName").value.trim();
  const startBalance =
    parseFloat(document.getElementById("accStartBalance").value) || 0;
  const currency = document.getElementById("accCurrency").value;
  const type = document.getElementById("accType").value;
  const bankName = document.getElementById("bankName").value;
  const token = document.getElementById("bankToken").value.trim();

  if (!name) {
    alert("Введите название счета");
    return;
  }

  const newAccount = {
    id: "acc_" + Date.now(),
    name: name,
    startBalance: Math.round(startBalance * 100),
    currency: currency,
    type: type,
    bank: type === "bank" ? bankName : null,
    token: type === "bank" ? token : null,
  };

  await saveAccount(newAccount);
  window.closeModal("accountModal");
  await refreshAppData();
};

// Открытие модалки корректировки баланса
window.openAdjustModal = function (accountId, currentBalance) {
  document.getElementById("adjustAccId").value = accountId;
  document.getElementById("adjustRealAmount").value = (
    currentBalance / 100
  ).toFixed(2);
  window.openModal("adjustModal");
};

// Сохранение корректировки баланса
window.saveBalanceAdjustment = async function () {
  const accountId = document.getElementById("adjustAccId").value;
  const realAmountVal = parseFloat(
    document.getElementById("adjustRealAmount").value,
  );
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
      amount: diff,
      description: "Коррекция баланса",
      date: Math.floor(Date.now() / 1000),
    };
    await saveTransaction(adjTx);
  }

  window.closeModal("adjustModal");
  await refreshAppData();
};

// Экспорт бэкапа
window.exportData = async function () {
  const accounts = await getAllAccounts();
  const transactions = await getAllTransactions();
  const backup = { accounts, transactions, date: new Date().toISOString() };
  const blob = new Blob([JSON.stringify(backup, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `zenlocal_backup_${Date.now()}.json`;
  a.click();
};

// Синхронизация Монобанка
window.syncMonoAccount = async function (accountId, token) {
  const statusEl = document.getElementById("status");
  if (statusEl) statusEl.innerText = "Синхронизация Монобанка...";

  try {
    const to = Math.floor(Date.now() / 1000);
    const from = to - 30 * 24 * 60 * 60;
    const response = await fetch(
      `https://api.monobank.ua/personal/statement/0/${from}/${to}`,
      {
        headers: { "X-Token": token },
      },
    );

    if (!response.ok) throw new Error("Ошибка API Mono");
    const data = await response.json();

    for (let t of data) {
      const txData = {
        id: "mono_" + t.id,
        accountId: accountId,
        amount: t.amount,
        description: t.description,
        date: t.time,
      };
      await saveTransaction(txData);
    }

    if (statusEl)
      statusEl.innerText = `Успешно загружено операций: ${data.length}`;
    await refreshAppData();
  } catch (error) {
    console.error(error);
    if (statusEl) statusEl.innerText = "Ошибка синхронизации Монобанка.";
  }
};

// --- ЗАГРУЗКА КУРСОВ ВАЛЮТ МОНОБАНКА ---
async function fetchRates() {
  try {
    const res = await fetch("https://api.monobank.ua/bank/currency");
    if (!res.ok) return;
    const data = await res.json();

    const usdRate = data.find(
      (item) => item.currencyCodeA === 840 && item.currencyCodeB === 980,
    );
    const eurRate = data.find(
      (item) => item.currencyCodeA === 978 && item.currencyCodeB === 980,
    );

    if (usdRate)
      exchangeRates.USD =
        usdRate.rateSell || usdRate.rateCross || exchangeRates.USD;
    if (eurRate)
      exchangeRates.EUR =
        eurRate.rateSell || eurRate.rateCross || exchangeRates.EUR;

    const rateUsdEl = document.getElementById("rateUsd");
    const rateEurEl = document.getElementById("rateEur");

    if (rateUsdEl) rateUsdEl.innerText = `${exchangeRates.USD.toFixed(2)} ₴`;
    if (rateEurEl) rateEurEl.innerText = `${exchangeRates.EUR.toFixed(2)} ₴`;
  } catch (e) {
    console.log("Не удалось подгрузить курсы");
    if (document.getElementById("rateUsd"))
      document.getElementById("rateUsd").innerText =
        `${exchangeRates.USD.toFixed(2)} ₴`;
    if (document.getElementById("rateEur"))
      document.getElementById("rateEur").innerText =
        `${exchangeRates.EUR.toFixed(2)} ₴`;
  }
}

// --- БАЗА ДАННЫХ ---
function initDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("ZenLocalDB", 2);
    request.onerror = () => reject("Ошибка IndexedDB");
    request.onsuccess = (e) => resolve(e.target.result);
    request.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains("accounts"))
        db.createObjectStore("accounts", { keyPath: "id" });
      if (!db.objectStoreNames.contains("transactions"))
        db.createObjectStore("transactions", { keyPath: "id" });
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

function saveTransaction(txData) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction("transactions", "readwrite");
    tx.objectStore("transactions").put(txData);
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

async function getAllTransactions() {
  return new Promise((resolve) => {
    const tx = db.transaction("transactions", "readonly");
    const req = tx.objectStore("transactions").getAll();
    req.onsuccess = () => resolve(req.result);
  });
}

// --- Обновление интерфейса ---
async function refreshAppData() {
  const accounts = await getAllAccounts();
  const transactions = await getAllTransactions();

  const accountsList = document.getElementById("accountsList");
  const opAccountSelect = document.getElementById("opAccountSelect");
  const txContainer = document.getElementById("transactions");

  if (!accountsList || !opAccountSelect || !txContainer) return;

  accountsList.innerHTML = "";
  opAccountSelect.innerHTML = "";

  let totalGlobalBalanceUAH = 0;

  accounts.forEach((acc) => {
    let accBalance = acc.startBalance;
    transactions.forEach((tx) => {
      if (tx.accountId === acc.id) accBalance += tx.amount;
    });

    let balanceInUAH = accBalance;
    if (acc.currency === "USD") balanceInUAH = accBalance * exchangeRates.USD;
    if (acc.currency === "EUR") balanceInUAH = accBalance * exchangeRates.EUR;
    totalGlobalBalanceUAH += balanceInUAH;

    const symbol =
      acc.currency === "USD" ? "$" : acc.currency === "EUR" ? "€" : "₴";

    const card = document.createElement("div");
    card.className = "account-card";
    card.innerHTML = `
            <div class="account-info">
                <span class="account-name">${acc.name}</span>
                <span class="account-sub">${acc.type === "bank" ? "Банк: " + acc.bank : "Наличные"}</span>
                <div class="account-actions">
                    <button class="btn-secondary btn-sm" onclick="openAdjustModal('${acc.id}', ${accBalance})">Сверить баланс</button>
                    ${acc.type === "bank" && acc.token ? `<button class="btn-sm" style="background:#ff5722;" onclick="syncMonoAccount('${acc.id}', '${acc.token}')">🔄 Sync</button>` : ""}
                </div>
            </div>
            <div class="account-sum">${(accBalance / 100).toFixed(2)} ${symbol}</div>
        `;
    accountsList.appendChild(card);

    const opt = document.createElement("option");
    opt.value = acc.id;
    opt.innerText = `${acc.name} (${(accBalance / 100).toFixed(2)} ${symbol})`;
    opAccountSelect.appendChild(opt);
  });

  if (accounts.length === 0) {
    accountsList.innerHTML =
      '<p style="color:#888; text-align:center;">Нет счетов. Создайте первый счет.</p>';
  }

  document.getElementById("totalBalance").innerText =
    (totalGlobalBalanceUAH / 100).toFixed(2) + " ₴";

  txContainer.innerHTML = "";
  if (transactions.length > 0) {
    transactions.sort((a, b) => b.date - a.date);
    transactions.slice(0, 100).forEach((tx) => {
      const acc = accounts.find((a) => a.id === tx.accountId);
      const accName = acc ? acc.name : "Удаленный счет";
      const symbol = acc
        ? acc.currency === "USD"
          ? "$"
          : acc.currency === "EUR"
            ? "€"
            : "₴"
        : "₴";

      const card = document.createElement("div");
      card.className = "tx-card";

      const amount = tx.amount / 100;
      const amountStr =
        amount > 0 ? `+${amount} ${symbol}` : `${amount} ${symbol}`;
      const colorClass = amount > 0 ? "green" : "white";

      const dateObj = new Date(tx.date * 1000);
      const dateStr =
        dateObj.toLocaleDateString("ru-RU") +
        " " +
        dateObj.toLocaleTimeString("ru-RU", {
          hour: "2-digit",
          minute: "2-digit",
        });

      card.innerHTML = `
                <div class="tx-info">
                    <span class="tx-desc">${tx.description}</span>
                    <span class="tx-date">${accName} • ${dateStr}</span>
                </div>
                <div class="tx-amount ${colorClass}">${amountStr}</div>
            `;
      txContainer.appendChild(card);
    });
  } else {
    txContainer.innerHTML =
      '<p style="text-align:center; color:#888;">Операций пока нет.</p>';
  }
}
