let db;
let exchangeRates = { USD: 41.5, EUR: 45.0 };

// Твой Client ID от Google Cloud
const GOOGLE_CLIENT_ID =
  "890708614909-kbcj733qlet8g8kapjq0kiikvmi8rpda.apps.googleusercontent.com";
let googleTokenClient;
let currentGoogleToken = localStorage.getItem("google_access_token");
// Палитра для диаграммы (до 20 цветов)
const CHART_COLORS = [
  "#f44336",
  "#2196F3",
  "#FFC107",
  "#4CAF50",
  "#9C27B0",
  "#FF9800",
  "#00BCD4",
  "#8BC34A",
  "#E91E63",
  "#3F51B5",
  "#009688",
  "#FFEB3B",
  "#CDDC39",
  "#673AB7",
  "#795548",
  "#607D8B",
];

document.addEventListener("DOMContentLoaded", async () => {
  try {
    db = await initDB();
    await fetchRates();
    await refreshAppData();
    await autoSyncBanks(); // Запуск авто-синхронизации
  } catch (error) {
    console.error("Ошибка инициализации:", error);
  }

  const addManualBtn = document.getElementById("addManualBtn");
  if (addManualBtn) {
    addManualBtn.addEventListener("click", async () => {
      const accountId = document.getElementById("opAccountSelect").value;
      const categoryId = document.getElementById("opCategorySelect").value;
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

// --- АВТОМАТИЧЕСКАЯ СИНХРОНИЗАЦИЯ (с интервалом 1 минута) ---
async function autoSyncBanks() {
  const accounts = await getAllAccounts();
  const now = Date.now();
  for (let acc of accounts) {
    if (acc.type === "bank" && acc.token) {
      const lastSync = localStorage.getItem(`lastSync_${acc.id}`) || 0;
      if (now - lastSync > 60 * 1000) {
        // 60 секунд
        // Вызываем тихую синхронизацию
        await window.syncMonoAccount(acc.id, acc.token, true);
        localStorage.setItem(`lastSync_${acc.id}`, now);
      }
    }
  }
}

// --- ГЛОБАЛЬНЫЕ ФУНКЦИИ ИНТЕРФЕЙСА ---
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

// Загрузка списка карт Монобанка
window.loadMonoAccountsList = async function () {
  const token = document.getElementById("bankToken").value.trim();
  if (!token) return alert("Сначала введите токен Монобанка");

  const container = document.getElementById("monoCardsContainer");
  const select = document.getElementById("monoCardSelect");
  select.innerHTML = "<option>Загрузка карт...</option>";
  container.style.display = "block";

  try {
    const res = await fetch("https://api.monobank.ua/personal/client-info", {
      headers: { "X-Token": token },
    });
    if (!res.ok) throw new Error("Неверный токен");
    const data = await res.json();
    select.innerHTML = "";
    if (data.accounts && data.accounts.length > 0) {
      data.accounts.forEach((acc) => {
        const currencySymbol =
          acc.currencyCode === 840 ? "$" : acc.currencyCode === 978 ? "€" : "₴";
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
    select.innerHTML =
      '<option value="">Ошибка загрузки (проверьте токен)</option>';
  }
};

window.createAccount = async function () {
  const nameInput = document.getElementById("accName").value.trim();
  const type = document.getElementById("accType").value;
  let newAccount = {};

  if (type === "bank") {
    // Монобанк
    const token = document.getElementById("bankToken").value.trim();
    const cardSelectStr = document.getElementById("monoCardSelect").value;
    if (!token || !cardSelectStr) return alert("Введите токен и выберите карту");
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
  } else if (type === "privat") {
    // ПриватБанк (Push)
    if (!nameInput) return alert("Введите название счета");
    const startBalance = parseFloat(document.getElementById("accStartBalance").value) || 0;
    const currency = document.getElementById("accCurrency").value;
    const cardMask = document.getElementById("privatCardMask").value.trim();

    newAccount = {
      id: "acc_" + Date.now(),
      name: nameInput,
      startBalance: Math.round(startBalance * 100),
      creditLimit: 0,
      currency: currency,
      type: "privat", // СТРОГО ТИП privat
      bank: "privat24",
      token: null,
      bankAccountId: null,
      cardMask: cardMask
    };
  } else {
    // Наличные
    if (!nameInput) return alert("Введите название счета");
    const startBalance = parseFloat(document.getElementById("accStartBalance").value) || 0;
    const currency = document.getElementById("accCurrency").value;
    
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

window.createCategory = async function () {
  const name = document.getElementById("newCatName").value.trim();
  if (!name) return;
  await saveCategory({ id: "cat_" + Date.now(), name: name });
  document.getElementById("newCatName").value = "";
  await refreshAppData();
};
window.openCreateCategoryModal = function () {
  document.getElementById("editCategoryId").value = "";
  document.getElementById("categoryNameInput").value = "";
  document.getElementById("categoryModalTitle").innerText =
    "Добавить категорию";
  document.getElementById("saveCategoryBtn").innerText = "Создать";
  window.openModal("categoryModal");
};
window.openEditCategoryModal = async function (categoryId) {
  const categories = await getAllCategories();
  const category = categories.find((c) => c.id === categoryId);
  if (!category) return;
  document.getElementById("editCategoryId").value = categoryId;
  document.getElementById("categoryNameInput").value = category.name;
  document.getElementById("categoryModalTitle").innerText =
    "Редактировать категорию";
  document.getElementById("saveCategoryBtn").innerText = "Сохранить";
  window.openModal("categoryModal");
};
window.saveNewCategory = async function () {
  const categoryId = document.getElementById("editCategoryId").value;
  const categoryName = document
    .getElementById("categoryNameInput")
    .value.trim();
  if (!categoryName) return alert("Введите название категории");
  if (categoryId) {
    const categories = await getAllCategories();
    const category = categories.find((c) => c.id === categoryId);
    if (category) {
      category.name = categoryName;
      await saveCategory(category);
    }
  } else {
    await saveCategory({ id: "cat_" + Date.now(), name: categoryName });
  }
  window.closeModal("categoryModal");
  await refreshAppData();
};
window.deleteCategory = async function (categoryId) {
  if (categoryId === "cat_default")
    return alert("Нельзя удалить категорию 'Без категории'");
  const transactions = await getAllTransactions();
  const usageCount = transactions.filter(
    (t) => t.categoryId === categoryId,
  ).length;
  let confirmMsg = "Удалить категорию?";
  if (usageCount > 0)
    confirmMsg += `\nОперации (${usageCount}) станут 'Без категории'.`;
  if (!confirm(confirmMsg)) return;
  if (usageCount > 0) {
    const txsToUpdate = transactions.filter((t) => t.categoryId === categoryId);
    for (const t of txsToUpdate) {
      t.categoryId = "cat_default";
      await saveTransaction(t);
    }
  }
  await removeCategory(categoryId);
  await refreshAppData();
};

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
  const rawAmount = parseFloat(document.getElementById("editTxAmount").value);
  if (isNaN(rawAmount)) return;
  const transactions = await getAllTransactions();
  const tx = transactions.find((t) => t.id === txId);
  if (!tx) return;
  let newAmount = Math.round(Math.abs(rawAmount) * 100);
  if (tx.amount < 0) newAmount = -newAmount;
  tx.accountId = document.getElementById("editTxAccount").value;
  tx.categoryId = document.getElementById("editTxCategory").value;
  tx.amount = newAmount;
  tx.description = document.getElementById("editTxDesc").value.trim();
  tx.userModified = true;
  await saveTransaction(tx);
  window.closeModal("editTxModal");
  await refreshAppData();
};
window.deleteTransaction = async function () {
  await removeTransaction(document.getElementById("editTxId").value);
  window.closeModal("editTxModal");
  await refreshAppData();
};

window.openAdjustModal = function (accountId, currentBalance) {
  document.getElementById("adjustAccId").value = accountId;
  document.getElementById("adjustRealAmount").value = (
    currentBalance / 100
  ).toFixed(2);
  window.openModal("adjustModal");
};
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
  const diff = Math.round(realAmountVal * 100) - currentBalance;
  if (diff !== 0) {
    await saveTransaction({
      id: "tx_adj_" + Date.now(),
      accountId: accountId,
      categoryId: "cat_default",
      amount: diff,
      description: "Коррекция баланса",
      date: Math.floor(Date.now() / 1000),
      userModified: true,
    });
  }
  window.closeModal("adjustModal");
  await refreshAppData();
};

function setSyncStatusMsg(text, isHtml = false) {
  const statusEl = document.getElementById("status");
  const homeStatusEl = document.getElementById("homeStatus");
  if (statusEl) {
    isHtml ? (statusEl.innerHTML = text) : (statusEl.innerText = text);
  }
  if (homeStatusEl) {
    isHtml ? (homeStatusEl.innerHTML = text) : (homeStatusEl.innerText = text);
  }
}

// Синхронизация Монобанка (добавлен флаг isSilent)
window.syncMonoAccount = async function (accountId, token, isSilent = false) {
  if (!isSilent) setSyncStatusMsg("Синхронизация Монобанка...");
  try {
    const headers = { "X-Token": token };
    const accounts = await getAllAccounts();
    const targetAcc = accounts.find((a) => a.id === accountId);
    const bankAccId = targetAcc ? targetAcc.bankAccountId : null;
    const to = Math.floor(Date.now() / 1000);
    const from = to - 30 * 24 * 60 * 60;
    const stmtResponse = await fetch(
      `https://api.monobank.ua/personal/statement/0/${from}/${to}`,
      { headers },
    );
    if (!stmtResponse.ok) throw new Error("Ошибка API");
    const data = await stmtResponse.json();
    const existingTxs = await getAllTransactions();

    for (let t of data) {
      const txId = "mono_" + t.id;
      const existing = existingTxs.find((item) => item.id === txId);
      if (existing && existing.userModified) continue;
      await saveTransaction({
        id: txId,
        accountId: accountId,
        categoryId: "cat_default",
        amount: t.amount,
        description: t.description,
        date: t.time,
        userModified: false,
      });
    }

    const clientResponse = await fetch(
      "https://api.monobank.ua/personal/client-info",
      { headers },
    );
    if (clientResponse.ok) {
      const clientData = await clientResponse.json();
      if (clientData.accounts && clientData.accounts.length > 0) {
        const bankAccount = bankAccId
          ? clientData.accounts.find((a) => a.id === bankAccId) ||
            clientData.accounts[0]
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
            setSyncStatusMsg(
              `⚠️ Баланс расходится на <span style="color:#ff5722;">${diffUah} ₴</span>. <button class="btn-sm" style="background:#ff5722;" onclick="openAdjustModal('${accountId}', ${internalBalance + diff})">Сверить</button>`,
              true,
            );
            await refreshAppData();
            return;
          }
        }
      }
    }
    if (!isSilent) setSyncStatusMsg(`Синхронизация успешна!`);
    await refreshAppData();
  } catch (error) {
    if (!isSilent) setSyncStatusMsg("Ошибка подключения к Mono.");
  }
};

function renderTransactionsGrouped(
  transactionsToRender,
  containerElement,
  accounts,
  categories,
) {
  if (!containerElement) return;
  containerElement.innerHTML = "";
  if (transactionsToRender.length === 0) {
    containerElement.innerHTML =
      '<p style="text-align:center; color:#888;">Операций пока нет.</p>';
    return;
  }
  const grouped = {};
  transactionsToRender.forEach((tx) => {
    const dateObj = new Date(tx.date * 1000);
    const dateStr = dateObj.toLocaleDateString("ru-RU", {
      day: "numeric",
      month: "long",
      year: "numeric",
    });
    if (!grouped[dateStr]) grouped[dateStr] = [];
    grouped[dateStr].push(tx);
  });
  for (const [dateStr, txs] of Object.entries(grouped)) {
    const header = document.createElement("div");
    header.style =
      "font-size: 13px; color: #888; margin: 15px 0 8px 5px; font-weight: bold; text-transform: uppercase;";
    header.innerText = dateStr;
    containerElement.appendChild(header);
    txs.forEach((tx) => {
      const acc = accounts.find((a) => a.id === tx.accountId);
      const cat = categories.find((c) => c.id === tx.categoryId);
      const symbol = acc
        ? acc.currency === "USD"
          ? "$"
          : acc.currency === "EUR"
            ? "€"
            : "₴"
        : "₴";
      const card = document.createElement("div");
      card.className = "tx-card";
      card.onclick = () => openEditTransaction(tx.id);
      const amount = tx.amount / 100;
      const amountStr =
        amount > 0 ? `+${amount} ${symbol}` : `${amount} ${symbol}`;
      const colorClass = amount > 0 ? "green" : "white";
      const timeStr = new Date(tx.date * 1000).toLocaleTimeString("ru-RU", {
        hour: "2-digit",
        minute: "2-digit",
      });
      card.innerHTML = `
          <div class="tx-info">
              <span class="tx-desc">${tx.description}</span>
              <span class="tx-date">${cat ? cat.name : "Без категории"} • ${acc ? acc.name : ""} • ${timeStr}</span>
          </div>
          <div class="tx-amount ${colorClass}">${amountStr}</div>`;
      containerElement.appendChild(card);
    });
  }
}

// --- ЛОГИКА АНАЛИТИКИ (График и выбор месяцев) ---
function populateAnalyticsFilters(transactions) {
  const monthSelect = document.getElementById("analyticsMonth");
  if (!monthSelect) return;

  const months = new Set();
  transactions.forEach((tx) => {
    const d = new Date(tx.date * 1000);
    // Формат YYYY-MM
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    months.add(key);
  });

  // Если транзакций нет, добавим текущий
  if (months.size === 0) {
    const d = new Date();
    months.add(
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`,
    );
  }

  const sortedMonths = Array.from(months).sort().reverse(); // Новые сверху
  const currentVal = monthSelect.value;
  monthSelect.innerHTML = "";

  const monthNames = [
    "Январь",
    "Февраль",
    "Март",
    "Апрель",
    "Май",
    "Июнь",
    "Июль",
    "Август",
    "Сентябрь",
    "Октябрь",
    "Ноябрь",
    "Декабрь",
  ];

  sortedMonths.forEach((m) => {
    const [year, month] = m.split("-");
    const opt = document.createElement("option");
    opt.value = m;
    opt.innerText = `${monthNames[parseInt(month) - 1]} ${year}`;
    monthSelect.appendChild(opt);
  });

  if (currentVal && sortedMonths.includes(currentVal))
    monthSelect.value = currentVal;
}

window.renderAnalytics = async function () {
  const monthVal = document.getElementById("analyticsMonth").value;
  const typeVal = document.getElementById("analyticsType").value;
  if (!monthVal) return;

  const transactions = await getAllTransactions();
  const categories = await getAllCategories();
  const accounts = await getAllAccounts();

  // Фильтруем транзакции по месяцу и типу
  let filteredTxs = transactions.filter((tx) => {
    // Исключаем системные корректировки из аналитики
    if (tx.description.startsWith("Коррекция баланса")) return false;

    const d = new Date(tx.date * 1000);
    const txMonth = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    if (txMonth !== monthVal) return false;

    if (typeVal === "expense") return tx.amount < 0;
    if (typeVal === "income") return tx.amount > 0;
    return false;
  });

  // Группируем по категориям и приводим к базовой валюте (Гривна)
  const categoryTotals = {};
  filteredTxs.forEach((tx) => {
    const catId = tx.categoryId || "cat_default";
    const acc = accounts.find((a) => a.id === tx.accountId);

    let txAmountUAH = Math.abs(tx.amount);
    if (acc) {
      if (acc.currency === "USD") txAmountUAH *= exchangeRates.USD;
      if (acc.currency === "EUR") txAmountUAH *= exchangeRates.EUR;
    }

    if (!categoryTotals[catId]) categoryTotals[catId] = 0;
    categoryTotals[catId] += txAmountUAH;
  });

  // Формируем данные для графика
  let chartData = [];
  let colorIndex = 0;
  for (let catId in categoryTotals) {
    const cat = categories.find((c) => c.id === catId);
    chartData.push({
      label: cat ? cat.name : "Без категории",
      value: categoryTotals[catId],
      color: CHART_COLORS[colorIndex % CHART_COLORS.length],
    });
    colorIndex++;
  }
  // Сортируем от большего к меньшему
  chartData.sort((a, b) => b.value - a.value);

  drawPieChart("analyticsChart", chartData);
  drawLegend("analyticsLegend", chartData);
};

function drawPieChart(canvasId, data) {
  const canvas = document.getElementById(canvasId);
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  const centerX = canvas.width / 2;
  const centerY = canvas.height / 2;
  const radius = Math.min(centerX, centerY) - 10;

  if (data.length === 0) {
    ctx.fillStyle = "#333";
    ctx.beginPath();
    ctx.arc(centerX, centerY, radius, 0, 2 * Math.PI);
    ctx.fill();
    ctx.fillStyle = "#888";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = "14px Arial";
    ctx.fillText("Нет операций", centerX, centerY);
    return;
  }

  const total = data.reduce((sum, item) => sum + item.value, 0);
  let startAngle = -Math.PI / 2; // Начинаем рисовать сверху

  data.forEach((item) => {
    const sliceAngle = (item.value / total) * 2 * Math.PI;
    ctx.fillStyle = item.color;
    ctx.beginPath();
    ctx.moveTo(centerX, centerY);
    ctx.arc(centerX, centerY, radius, startAngle, startAngle + sliceAngle);
    ctx.closePath();
    ctx.fill();
    startAngle += sliceAngle;
  });
}

function drawLegend(containerId, data) {
  const container = document.getElementById(containerId);
  if (!container) return;
  container.innerHTML = "";

  if (data.length === 0) return;
  const total = data.reduce((sum, item) => sum + item.value, 0);

  data.forEach((item) => {
    const percent = ((item.value / total) * 100).toFixed(1);
    const amountStr = (item.value / 100).toFixed(2);

    const row = document.createElement("div");
    row.className = "legend-item";
    row.innerHTML = `
            <div class="legend-color" style="background-color: ${item.color};"></div>
            <div class="legend-name">${item.label}</div>
            <div class="legend-amount">${amountStr} ₴</div>
            <div class="legend-percent">${percent}%</div>
        `;
    container.appendChild(row);
  });
}

// --- БАЗА ДАННЫХ И ИНИЦИАЛИЗАЦИЯ ---
function initDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("ZenLocalDB", 3);
    request.onerror = () => reject("Ошибка IndexedDB");
    request.onsuccess = (e) => resolve(e.target.result);
    request.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains("accounts"))
        db.createObjectStore("accounts", { keyPath: "id" });
      if (!db.objectStoreNames.contains("transactions"))
        db.createObjectStore("transactions", { keyPath: "id" });
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
function removeCategory(catId) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction("categories", "readwrite");
    tx.objectStore("categories").delete(catId);
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
    if (document.getElementById("rateUsd"))
      document.getElementById("rateUsd").innerText =
        `${exchangeRates.USD.toFixed(2)} ₴`;
    if (document.getElementById("rateEur"))
      document.getElementById("rateEur").innerText =
        `${exchangeRates.EUR.toFixed(2)} ₴`;
  } catch (e) {
    if (document.getElementById("rateUsd"))
      document.getElementById("rateUsd").innerText =
        `${exchangeRates.USD.toFixed(2)} ₴`;
    if (document.getElementById("rateEur"))
      document.getElementById("rateEur").innerText =
        `${exchangeRates.EUR.toFixed(2)} ₴`;
  }
}

// --- ОБНОВЛЕНИЕ ДАННЫХ ---
async function refreshAppData() {
  const accounts = await getAllAccounts();
  const categories = await getAllCategories();
  const transactions = await getAllTransactions();

  populateAnalyticsFilters(transactions);

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

    const symbol =
      acc.currency === "USD" ? "$" : acc.currency === "EUR" ? "€" : "₴";
    const ownFundsStr = (ownFunds / 100).toFixed(2);
    const availableStr = (accBalance / 100).toFixed(2);

    let sumHtml = `<div class="account-sum">${ownFundsStr} ${symbol}</div>`;
    if (creditLimit > 0) {
      sumHtml = `
            <div class="account-sum" style="color: ${ownFunds < 0 ? "#f44336" : "white"};">${ownFundsStr} ${symbol}</div>
            <div style="font-size: 11px; color: #888; text-align: right; margin-top: 3px;">Доступно: ${availableStr} ${symbol}</div>
        `;
    }

    // Для ГЛАВНОЙ вкладки (без кнопки редактирования/сверки)
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
            <div style="display:flex; flex-direction:column; justify-content:center; align-items:flex-end;">${sumHtml}</div>
        `;
      homeAccountsList.appendChild(homeCard);
    }

    // Для вкладки СЧЕТА (с кнопкой Сверить)
    if (accountsList) {
      const adminCard = document.createElement("div");
      adminCard.className = "account-card";
      adminCard.innerHTML = `
            <div class="account-info">
                <span class="account-name">${acc.name}</span>
                <span class="account-sub">${acc.type === "bank" ? "Банк: " + acc.bank : "Наличные"}</span>
                <div class="account-actions">
                    <button class="btn-secondary btn-sm" onclick="openAdjustModal('${acc.id}', ${accBalance})">Сверить</button>
                    <button class="btn-secondary btn-sm" style="background: #d9534f; color: white; border: none;" onclick="deleteAccount('${acc.id}')">Удалить</button>
                    ${acc.type === "bank" && acc.token ? `<button class="btn-sm" style="background:#ff5722;" onclick="syncMonoAccount('${acc.id}', '${acc.token}')">🔄 Sync</button>` : ""}
                </div>
            </div>
            <div style="display:flex; flex-direction:column; justify-content:center; align-items:flex-end;">${sumHtml}</div>
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
    if (homeAccountsList)
      homeAccountsList.innerHTML =
        '<p style="color:#888; text-align:center;">Нет счетов.</p>';
    if (accountsList)
      accountsList.innerHTML =
        '<p style="color:#888; text-align:center;">Нет счетов. Добавьте первый счет.</p>';
  }

  categories.forEach((cat) => {
    if (opCategorySelect) {
      const opt = document.createElement("option");
      opt.value = cat.id;
      opt.innerText = cat.name;
      opCategorySelect.appendChild(opt);
    }
  });

  document.getElementById("totalBalance").innerText =
    (totalGlobalBalanceUAH / 100).toFixed(2) + " ₴";

  const categoriesList = document.getElementById("categoriesList");
  if (categoriesList) {
    categoriesList.innerHTML = "";
    categories.forEach(function (cat) {
      var usageCount = transactions.filter(function (t) {
        return t.categoryId === cat.id;
      }).length;
      var isDefault = cat.id === "cat_default";
      var usageText =
        usageCount > 0 ? usageCount + " операций" : "Не используется";
      var card = document.createElement("div");
      card.className = "category-card";
      var actionsHtml = "";
      if (!isDefault) {
        actionsHtml =
          '<button class="btn-sm" onclick="openEditCategoryModal(\x27' +
          cat.id +
          '\x27)">\u270E Редакт.</button>' +
          '<button class="btn-sm btn-danger" onclick="deleteCategory(\x27' +
          cat.id +
          '\x27)">\u2715 Удалить</button>';
      } else {
        actionsHtml =
          '<span style="color:#888;font-size:12px;">Системная</span>';
      }
      card.innerHTML =
        '<div class="category-info"><span class="category-name">' +
        cat.name +
        '</span><span class="category-usage">' +
        usageText +
        '</span></div><div class="category-actions">' +
        actionsHtml +
        "</div>";
      categoriesList.appendChild(card);
    });
  }

  const sortedTxs = transactions.sort((a, b) => b.date - a.date).slice(0, 100);
  renderTransactionsGrouped(sortedTxs, homeTransactions, accounts, categories);
  renderTransactionsGrouped(sortedTxs, txContainer, accounts, categories);

  if (document.getElementById("tab-analytics").classList.contains("active"))
    renderAnalytics();
}

// --- ЭКСПОРТ (С поддержкой нативного меню Android Share) ---
window.exportData = async function () {
  const accounts = await getAllAccounts();
  const categories = await getAllCategories();
  const transactions = await getAllTransactions();

  const backup = {
    appName: "ZenLocal",
    version: "1.0",
    date: new Date().toISOString(),
    accounts,
    categories,
    transactions,
  };

  const jsonStr = JSON.stringify(backup, null, 2);
  const fileName = `zenlocal_backup_${Date.now()}.json`;

  // Создаем файл
  const blob = new Blob([jsonStr], { type: "application/json" });
  const file = new File([blob], fileName, { type: "application/json" });

  // Пытаемся использовать нативное меню "Поделиться" (Android/iOS)
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({
        files: [file],
        title: "Резервная копия ZenLocal",
        text: "Файл резервной копии базы данных ZenLocal",
      });
      return; // Успешно поделились, прерываем функцию
    } catch (e) {
      console.log(
        "Шаринг отменен или не удался, пробуем обычное скачивание",
        e,
      );
    }
  }

  // Запасной вариант (обычное скачивание в папку Downloads)
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
};

// --- ИМПОРТ И ВОССТАНОВЛЕНИЕ ДАННЫХ ---
document.addEventListener("DOMContentLoaded", () => {
  const importInput = document.getElementById("importFile");
  if (importInput) {
    importInput.addEventListener("change", function (e) {
      const file = e.target.files[0];
      if (!file) return;

      const reader = new FileReader();
      reader.onload = async function (event) {
        try {
          const data = JSON.parse(event.target.result);

          // Простейшая проверка, что это наш файл
          if (!data.accounts || !data.categories || !data.transactions) {
            alert("Ошибка: Неверный формат файла резервной копии.");
            importInput.value = ""; // Сбрасываем инпут
            return;
          }

          if (
            confirm(
              "ВНИМАНИЕ!\n\nТекущие данные будут удалены и заменены данными из копии.\nПродолжить?",
            )
          ) {
            await restoreDatabase(data);
            alert("Данные успешно восстановлены!");
            importInput.value = ""; // Сбрасываем инпут
            await refreshAppData();
          } else {
            importInput.value = "";
          }
        } catch (err) {
          console.error(err);
          alert(
            "Ошибка при чтении файла. Убедитесь, что выбран правильный JSON-бэкап.",
          );
          importInput.value = "";
        }
      };
      reader.readAsText(file);
    });
  }
});

// Функция полной очистки и перезаписи базы при импорте
async function restoreDatabase(data) {
  return new Promise((resolve, reject) => {
    // Очищаем все хранилища
    const tx = db.transaction(
      ["accounts", "categories", "transactions"],
      "readwrite",
    );
    const accStore = tx.objectStore("accounts");
    const catStore = tx.objectStore("categories");
    const transStore = tx.objectStore("transactions");

    accStore.clear();
    catStore.clear();
    transStore.clear();

    // Заливаем новые данные
    data.accounts.forEach((acc) => accStore.put(acc));
    data.categories.forEach((cat) => catStore.put(cat));
    data.transactions.forEach((t) => transStore.put(t));

    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}
// ==========================================
// ИНТЕГРАЦИЯ GOOGLE DRIVE (APPDATA)
// ==========================================

// Вход через нативный плагин @capgo/capacitor-social-login
let socialLoginReady = false;

window.connectGoogleAccount = async function () {
  try {
    const SocialLogin =
      window.Capacitor &&
      window.Capacitor.Plugins &&
      window.Capacitor.Plugins.SocialLogin;

    if (!SocialLogin) {
      alert(
        "Плагин Google-входа не найден. Он работает только в установленном приложении.",
      );
      return;
    }

    // Инициализация нужна один раз. Здесь именно WEB client ID
    if (!socialLoginReady) {
      await SocialLogin.initialize({
        google: { webClientId: GOOGLE_CLIENT_ID },
      });
      socialLoginReady = true;
    }

    const res = await SocialLogin.login({
      provider: "google",
      options: {
        scopes: ["https://www.googleapis.com/auth/drive.appdata"],
      },
    });

    const at = res && res.result && res.result.accessToken;
    const token = typeof at === "string" ? at : at && at.token;
    if (!token) {
      throw new Error(
        "В ответе нет access token. Поля ответа: " +
          Object.keys((res && res.result) || {}).join(", "),
      );
    }

    currentGoogleToken = token;
    localStorage.setItem("google_access_token", currentGoogleToken);

    updateGoogleUI(true);
    await checkAndSyncCloudOnLogin();
    alert("Успешный вход в Google Аккаунт!");
  } catch (error) {
    console.error("Ошибка входа через Google:", error);
    alert("Не удалось войти: " + (error.message || error));
  }
};

// При запуске: если токен уже сохранён, пробуем использовать его
document.addEventListener("DOMContentLoaded", () => {
  setTimeout(() => {
    if (currentGoogleToken) {
      updateGoogleUI(true);
      checkAndSyncCloudOnLogin();
    }
  }, 1000);
});

function updateGoogleUI(isConnected) {
  const status = document.getElementById("googleStatus");
  const btnConnect = document.getElementById("btnGoogleConnect");
  const syncBlocks = document.getElementById("googleSyncBlocks");

  if (status && isConnected) {
    status.innerText = "✅ Google Drive подключен";
    status.style.color = "#4caf50";
    if (btnConnect) {
      btnConnect.innerText = "Обновить авторизацию";
      btnConnect.style.background = "#333";
    }
    if (syncBlocks) syncBlocks.style.display = "flex";
  } else if (status) {
    status.innerText = "Аккаунт не подключен";
    if (syncBlocks) syncBlocks.style.display = "none";
  }
}

async function findCloudBackupFile() {
  const response = await fetch(
    'https://www.googleapis.com/drive/v3/files?spaces=appDataFolder&q=name="zenlocal_sync.json"',
    {
      headers: { Authorization: `Bearer ${currentGoogleToken}` },
    },
  );
  if (!response.ok) {
    if (response.status === 401) {
      // токен истёк (живёт около часа): нужно войти заново
      localStorage.removeItem("google_access_token");
      currentGoogleToken = null;
      updateGoogleUI(false);
    }
    throw new Error("Ошибка поиска файла в Drive");
  }
  const data = await response.json();
  return data.files.length > 0 ? data.files[0].id : null;
}

async function checkAndSyncCloudOnLogin() {
  try {
    const fileId = await findCloudBackupFile();
    const localTransactions = await getAllTransactions();

    if (fileId && localTransactions.length === 0) {
      console.log("Свежая установка! Восстанавливаем из облака...");
      await forceRestoreFromCloud(fileId);
    } else if (localTransactions.length > 0) {
      await forceBackupToCloud();
    }
  } catch (e) {
    console.error("Авто-синхронизация прервана:", e);
  }
}

window.forceBackupToCloud = async function () {
  if (!currentGoogleToken) return;

  const statusEl = document.getElementById("googleStatus");
  if (statusEl) statusEl.innerText = "☁️ Выгрузка в облако...";

  const accounts = await getAllAccounts();
  const categories = await getAllCategories();
  const transactions = await getAllTransactions();
  const backup = {
    accounts,
    categories,
    transactions,
    date: new Date().toISOString(),
  };
  const fileContent = JSON.stringify(backup);
  const fileBlob = new Blob([fileContent], { type: "application/json" });

  try {
    const existingFileId = await findCloudBackupFile();
    // parents можно указывать только при создании файла, при обновлении (PATCH) Drive вернёт 403
    const metadata = { name: "zenlocal_sync.json" };
    if (!existingFileId) metadata.parents = ["appDataFolder"];

    const form = new FormData();
    form.append(
      "metadata",
      new Blob([JSON.stringify(metadata)], { type: "application/json" }),
    );
    form.append("file", fileBlob);

    let url =
      "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart";
    let method = "POST";

    if (existingFileId) {
      url = `https://www.googleapis.com/upload/drive/v3/files/${existingFileId}?uploadType=multipart`;
      method = "PATCH";
    }

    const res = await fetch(url, {
      method: method,
      headers: { Authorization: `Bearer ${currentGoogleToken}` },
      body: form,
    });

    if (!res.ok) throw new Error("Ошибка при загрузке");
    if (statusEl)
      statusEl.innerText =
        "✅ Сохранено в облаке: " + new Date().toLocaleTimeString();
  } catch (e) {
    console.error(e);
    if (statusEl) statusEl.innerText = "❌ Ошибка выгрузки в облако";
  }
};

window.forceRestoreFromCloud = async function (knownFileId = null) {
  if (!currentGoogleToken) return alert("Сначала подключите Google аккаунт");

  if (
    !knownFileId &&
    !confirm(
      "ВНИМАНИЕ! Текущие локальные данные будут стерты и заменены данными из Google Drive. Продолжить?",
    )
  )
    return;

  const statusEl = document.getElementById("googleStatus");
  if (statusEl) statusEl.innerText = "📥 Скачивание из облака...";

  try {
    const fileId = knownFileId || (await findCloudBackupFile());
    if (!fileId) {
      alert("В облаке пока нет резервной копии.");
      if (statusEl) statusEl.innerText = "✅ Google Drive подключен";
      return;
    }

    const res = await fetch(
      `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`,
      {
        headers: { Authorization: `Bearer ${currentGoogleToken}` },
      },
    );

    if (!res.ok) throw new Error("Ошибка скачивания");
    const data = await res.json();

    const tx = db.transaction(
      ["accounts", "categories", "transactions"],
      "readwrite",
    );
    tx.objectStore("accounts").clear();
    tx.objectStore("categories").clear();
    tx.objectStore("transactions").clear();

    data.accounts.forEach((acc) => tx.objectStore("accounts").put(acc));
    data.categories.forEach((cat) => tx.objectStore("categories").put(cat));
    data.transactions.forEach((t) => tx.objectStore("transactions").put(t));

    tx.oncomplete = async () => {
      if (statusEl) statusEl.innerText = "✅ Данные восстановлены из облака";
      await refreshAppData();
      alert("Данные успешно подтянуты из облака!");
    };
  } catch (e) {
    console.error(e);
    if (statusEl) statusEl.innerText = "❌ Ошибка загрузки из облака";
  }
};
// ==========================================
// ИНТЕГРАЦИЯ ПРИВАТ24 (РАЗБОР ПУШ-УВЕДОМЛЕНИЙ)
// ==========================================

window.processPushNotification = async function (
  rawText,
  postTime = Date.now(),
) {
  if (typeof BankNotifyParser === "undefined") {
    console.error("Скрипт bank-notify-parser.js не подключен!");
    return;
  }

  // 1. Парсим текст уведомления
  const parsed = BankNotifyParser.parsePrivatNotification({
    text: rawText,
    postTime: postTime,
  });

  if (!parsed.ok) {
    console.log("Пуш проигнорирован (не финансовая операция):", parsed.reason);
    return;
  }

  // 2. Ищем счет Приват24 в базе по маске карты
  const accounts = await getAllAccounts();
  let targetAccount = null;

  for (const acc of accounts) {
    if (acc.type === "privat") {
      // Если маска не задана, либо она совпадает с той, что в пуше
      if (!acc.cardMask || acc.cardMask === parsed.cardMask) {
        targetAccount = acc;
        break;
      }
    }
  }

  if (!targetAccount) {
    console.warn(
      `[Приват24] Операция по карте ${parsed.cardMask}, но счет не найден в приложении.`,
    );
    return;
  }

  // 3. Формируем новую транзакцию
  const newTransaction = {
    id: Date.now().toString(),
    accountId: targetAccount.id,
    categoryId: null, // Оставляем пустой (или ID спец. категории), пользователь распределит позже
    type: parsed.type,
    amount: parsed.amount,
    date: new Date(parsed.opTime).toISOString(),
    comment: `Приват24: ${parsed.kind}. ${parsed.details}`.trim(),
    commission: parsed.commission || 0,
    rawFingerprint: parsed.fingerprint, // защита от дублей
  };

  // 4. Корректируем баланс (приоритет - остаток из пуша, если он есть)
  if (parsed.balanceAfter !== null) {
    targetAccount.balance = parsed.balanceAfter;
  } else {
    targetAccount.balance += parsed.signedAmount - newTransaction.commission;
  }

  // 5. Записываем транзакцию и обновленный счет в базу данных
  const tx = db.transaction(["accounts", "transactions"], "readwrite");
  tx.objectStore("accounts").put(targetAccount);
  tx.objectStore("transactions").put(newTransaction);

  tx.oncomplete = () => {
    console.log("✅ Транзакция из Приват24 успешно сохранена:", newTransaction);
    if (typeof refreshAppData === "function") refreshAppData();
  };

  tx.onerror = (e) =>
    console.error("Ошибка сохранения транзакции Приват24:", e);
};

// ==========================================
// ИНТЕГРАЦИЯ ПРИВАТ24 (ОБРАБОТКА ПУШЕЙ)
// ==========================================
window.processPushNotification = async function(rawText, postTime = Date.now()) {
    if (typeof BankNotifyParser === 'undefined') {
        console.error("❌ Ошибка: BankNotifyParser не загружен!");
        return;
    }

    // 1. Парсим текст пуша через твой скрипт
    const parsed = BankNotifyParser.parsePrivatNotification({ text: rawText, postTime: postTime });
    
    if (!parsed.ok) {
        console.log(" Пуш проигнорирован (не финансовая операция):", parsed.reason);
        return;
    }

    console.log(" Распознан платеж Приват24:", parsed);

    // 2. Ищем счет типа 'privat' в IndexedDB
    if (!window.db) {
        console.error("❌ База данных IndexedDB еще не инициализирована");
        return;
    }

    const transaction = db.transaction(["accounts", "transactions"], "readwrite");
    const accountsStore = transaction.objectStore("accounts");
    
    accountsStore.getAll().onsuccess = async function(event) {
        const accounts = event.target.result;
        let targetAccount = null;

        for (const acc of accounts) {
            if (acc.type === 'privat') {
                // Если маска пустая или совпадает с картой из пуша
                if (!acc.cardMask || acc.cardMask === parsed.cardMask) {
                    targetAccount = acc;
                    break;
                }
            }
        }

        if (!targetAccount) {
            console.warn(`⚠️ Операция по карте ${parsed.cardMask}, но счет Приват24 в приложении не найден!`);
            return;
        }

        // 3. Создаем объект транзакции
        const newTransaction = {
            id: "tx_" + Date.now(),
            accountId: targetAccount.id,
            categoryId: null, // Категорию можно будет выбрать в приложении
            type: parsed.type, // 'income' или 'expense'
            amount: Math.round(parsed.amount * 100), // В копейках
            date: new Date(parsed.opTime).toISOString(),
            comment: `${parsed.kind}. ${parsed.details}`.trim(),
            commission: Math.round((parsed.commission || 0) * 100)
        };

        // 4. Обновляем баланс счета
        if (parsed.balanceAfter !== null) {
            targetAccount.startBalance = Math.round(parsed.balanceAfter * 100);
        } else {
            targetAccount.startBalance += Math.round(parsed.signedAmount * 100) - newTransaction.commission;
        }

        // 5. Записываем в базу
        const writeTx = db.transaction(["accounts", "transactions"], "readwrite");
        writeTx.objectStore("accounts").put(targetAccount);
        writeTx.objectStore("transactions").put(newTransaction);

        writeTx.oncomplete = () => {
            console.log("✅ Успешно сохранено в базу из Приват24!");
            if (typeof refreshAppData === 'function') {
                refreshAppData();
            }
        };
    };
};
window.deleteAccount = async function(accountId) {
    if (!confirm("Удалить этот счет? История операций по нему также будет удалена.")) return;

    const tx = db.transaction(["accounts", "transactions"], "readwrite");
    
    // Удаляем сам счет
    tx.objectStore("accounts").delete(accountId);
    
    // Опционально: можно удалить связанные транзакции, чтобы не висели "сироты"
    const txStore = tx.objectStore("transactions");
    const request = txStore.openCursor();
    request.onsuccess = function(e) {
        const cursor = e.target.result;
        if (cursor) {
            if (cursor.value.accountId === accountId) {
                cursor.delete();
            }
            cursor.continue();
        }
    };

    tx.oncomplete = () => {
        console.log("✅ Счет успешно удален");
        refreshAppData();
    };
};