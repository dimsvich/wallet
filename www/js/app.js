let db;

document.addEventListener("DOMContentLoaded", async () => {
  try {
    db = await initDB();
    await refreshAppData();
  } catch (error) {
    console.error("Ошибка инициализации БД:", error);
  }

  // Обработчик кнопки создания счета
  window.createAccount = async function () {
    const name = document.getElementById("accName").value.trim();
    const startBalance =
      parseFloat(document.getElementById("accStartBalance").value) || 0;
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
      startBalance: Math.round(startBalance * 100), // в копейках
      type: type,
      bank: type === "bank" ? bankName : null,
      token: type === "bank" ? token : null,
    };

    await saveAccount(newAccount);
    closeModal();
    await refreshAppData();
  };

  // Ручное добавление операции
  document
    .getElementById("addManualBtn")
    .addEventListener("click", async () => {
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
});

// --- БАЗА ДАННЫХ ИНДЕКСОВ ---
function initDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("ZenLocalDB", 2); // версия 2 для новых таблиц
    request.onerror = () => reject("Ошибка IndexedDB");
    request.onsuccess = (e) => resolve(e.target.result);
    request.onupgradeneeded = (e) => {
      const database = e.target.result;
      if (!database.objectStoreNames.contains("accounts")) {
        database.createObjectStore("accounts", { keyPath: "id" });
      }
      if (!database.objectStoreNames.contains("transactions")) {
        database.createObjectStore("transactions", { keyPath: "id" });
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

// --- Синхронизация Монобанка для конкретного счета ---
async function syncMonoAccount(accountId, token) {
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
}

// --- Обновление интерфейса и расчет балансов ---
async function refreshAppData() {
  const accounts = await getAllAccounts();
  const transactions = await getAllTransactions();

  const accountsList = document.getElementById("accountsList");
  const opAccountSelect = document.getElementById("opAccountSelect");
  const txContainer = document.getElementById("transactions");

  accountsList.innerHTML = "";
  opAccountSelect.innerHTML = "";

  let totalGlobalBalance = 0;

  accounts.forEach((acc) => {
    // Считаем баланс счета: стартовый + сумма всех его транзакций
    let accBalance = acc.startBalance;
    transactions.forEach((tx) => {
      if (tx.accountId === acc.id) {
        accBalance += tx.amount;
      }
    });
    totalGlobalBalance += accBalance;

    // Рендерим карточку счета
    const card = document.createElement("div");
    card.className = "account-card";
    card.innerHTML = `
            <div class="account-info">
                <span class="account-name">${acc.name}</span>
                <span class="account-sub">${acc.type === "bank" ? "Банк: " + acc.bank : "Наличные"}</span>
            </div>
            <div style="display: flex; align-items: center; gap: 10px;">
                <div class="account-sum">${(accBalance / 100).toFixed(2)} ₴</div>
                ${acc.type === "bank" && acc.token ? `<button style="padding: 6px 10px; margin:0; font-size:12px;" onclick="syncMonoAccount('${acc.id}', '${acc.token}')">🔄</button>` : ""}
            </div>
        `;
    accountsList.appendChild(card);

    // Добавляем в выпадающий список выбора счета при создании транзакции
    const opt = document.createElement("option");
    opt.value = acc.id;
    opt.innerText = acc.name;
    opAccountSelect.appendChild(opt);
  });

  if (accounts.length === 0) {
    accountsList.innerHTML =
      '<p style="color:#888; text-align:center;">Нет счетов. Создайте первый счет кнопкой ниже.</p>';
  }

  document.getElementById("totalBalance").innerText =
    (totalGlobalBalance / 100).toFixed(2) + " ₴";

  // Рендерим историю транзакций
  txContainer.innerHTML = "";
  if (transactions.length > 0) {
    transactions.sort((a, b) => b.date - a.date);
    transactions.slice(0, 100).forEach((tx) => {
      const acc = accounts.find((a) => a.id === tx.accountId);
      const accName = acc ? acc.name : "Удаленный счет";

      const card = document.createElement("div");
      card.className = "tx-card";

      const amount = tx.amount / 100;
      const amountStr = amount > 0 ? `+${amount} ₴` : `${amount} ₴`;
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
