let db;
let exchangeRates = { USD: 41.5, EUR: 45.0 };

const GOOGLE_CLIENT_ID =
  "890708614909-kbcj733qlet8g8kapjq0kiikvmi8rpda.apps.googleusercontent.com";
let currentGoogleToken = localStorage.getItem("google_access_token");

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
    await autoSyncBanks();
  } catch (error) {
    console.error("Ошибка инициализации:", error);
  }

  const addManualBtn = document.getElementById("addManualBtn");
  if (addManualBtn) {
    addManualBtn.addEventListener("click", async () => {
      const accountId = document.getElementById("opAccountSelect").value;
      const categoryId = document.getElementById("opCategorySelect").value;
      const toAccountId = document.getElementById("opToAccountSelect").value;
      const rawAmount = parseFloat(
        document.getElementById("manualAmount").value,
      );
      const desc =
        document.getElementById("manualDesc").value.trim() || "Без описания";
      const type = document.getElementById("manualType").value;

      if (!accountId || isNaN(rawAmount) || rawAmount === 0) return;

      let amountInKopecks = Math.round(Math.abs(rawAmount) * 100);

      if (type === "transfer") {
        if (accountId === toAccountId)
          return alert("Выберите разные счета для перевода");

        const targetRawAmount = parseFloat(
          document.getElementById("transferTargetAmount").value,
        );
        if (isNaN(targetRawAmount) || targetRawAmount === 0)
          return alert("Укажите сумму зачисления");

        let targetAmountInKopecks = Math.round(Math.abs(targetRawAmount) * 100);

        await saveTransaction({
          id: "tx_out_" + Date.now(),
          accountId: accountId,
          categoryId: "cat_default",
          amount: -amountInKopecks,
          description: "Перевод: " + desc,
          date: Math.floor(Date.now() / 1000),
          userModified: true,
          isTransfer: true,
        });

        await saveTransaction({
          id: "tx_in_" + (Date.now() + 1),
          accountId: toAccountId,
          categoryId: "cat_default",
          amount: targetAmountInKopecks,
          description: "Перевод: " + desc,
          date: Math.floor(Date.now() / 1000),
          userModified: true,
          isTransfer: true,
        });
      } else {
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
      }

      document.getElementById("manualAmount").value = "";
      document.getElementById("manualDesc").value = "";
      if (document.getElementById("transferTargetAmount"))
        document.getElementById("transferTargetAmount").value = "";
      await refreshAppData();
    });
  }

  // Слушатели для конвертации перевода
  const opAcc = document.getElementById("opAccountSelect");
  const opToAcc = document.getElementById("opToAccountSelect");
  const manAmount = document.getElementById("manualAmount");
  if (opAcc) opAcc.addEventListener("change", window.updateTransferCalculation);
  if (opToAcc)
    opToAcc.addEventListener("change", window.updateTransferCalculation);
  if (manAmount)
    manAmount.addEventListener("input", window.updateTransferCalculation);
});

// --- АВТОМАТИЧЕСКАЯ СИНХРОНИЗАЦИЯ ---
async function autoSyncBanks() {
  const accounts = await getAllAccounts();
  const now = Date.now();
  for (let acc of accounts) {
    if (acc.type === "bank" && acc.token) {
      const lastSync = localStorage.getItem(`lastSync_${acc.id}`) || 0;
      if (now - lastSync > 60 * 1000) {
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
  if (btn) btn.classList.add("active");
  if (tabName === "analytics") renderAnalytics();
};

window.openModal = function (modalId) {
  document.getElementById(modalId).style.display = "flex";
};
window.closeModal = function (modalId) {
  document.getElementById(modalId).style.display = "none";
};

// --- КОНВЕРТАЦИЯ ПРИ ПЕРЕВОДАХ ---
window.updateTransferCalculation = async function () {
  const type = document.getElementById("manualType").value;
  if (type !== "transfer") return;

  const amount = parseFloat(document.getElementById("manualAmount").value);
  const targetInput = document.getElementById("transferTargetAmount");

  if (isNaN(amount) || amount === 0) {
    targetInput.value = "";
    return;
  }

  const fromAccId = document.getElementById("opAccountSelect").value;
  const toAccId = document.getElementById("opToAccountSelect").value;
  if (!fromAccId || !toAccId || fromAccId === toAccId) return;

  const accounts = await getAllAccounts();
  const fromAcc = accounts.find((a) => a.id === fromAccId);
  const toAcc = accounts.find((a) => a.id === toAccId);
  if (!fromAcc || !toAcc) return;

  let targetAmount = amount;
  if (fromAcc.currency !== toAcc.currency) {
    let amountInUAH = amount;
    if (fromAcc.currency === "USD") amountInUAH = amount * exchangeRates.USD;
    if (fromAcc.currency === "EUR") amountInUAH = amount * exchangeRates.EUR;

    if (toAcc.currency === "USD")
      targetAmount = amountInUAH / exchangeRates.USD;
    else if (toAcc.currency === "EUR")
      targetAmount = amountInUAH / exchangeRates.EUR;
    else targetAmount = amountInUAH;
  }

  targetInput.value = targetAmount.toFixed(2);
};

// --- ЗАГРУЗКА КАРТ МОНОБАНКА ---
window.loadMonoAccountsList = async function () {
  const token = document.getElementById("bankToken").value.trim();
  if (!token) return alert("Сначала введите токен Монобанка");

  const container = document.getElementById("monoCardsContainer");
  const triggerMonoCard = document.getElementById("triggerMonoCard");
  if (triggerMonoCard) triggerMonoCard.innerText = "Загрузка карт...";
  if (container) container.style.display = "block";

  try {
    const res = await fetch("https://api.monobank.ua/personal/client-info", {
      headers: { "X-Token": token },
    });
    if (!res.ok) throw new Error("Неверный токен");
    const data = await res.json();

    let cardItems = [];
    if (data.accounts && data.accounts.length > 0) {
      data.accounts.forEach((acc) => {
        const currencySymbol =
          acc.currencyCode === 840 ? "$" : acc.currencyCode === 978 ? "€" : "₴";
        const balance = (acc.balance / 100).toFixed(2);
        let typeName = acc.type || "Карта";
        if (typeName === "black") typeName = "Черная карта";
        if (typeName === "white") typeName = "Белая карта";
        if (typeName === "fop") typeName = "Счет ФОП";

        const valObj = JSON.stringify({
          id: acc.id,
          currencyCode: acc.currencyCode,
          balance: acc.balance,
          creditLimit: acc.creditLimit || 0,
          typeName: typeName,
        });

        cardItems.push({
          id: valObj,
          name: `${typeName} (${balance} ${currencySymbol})`,
        });
      });

      if (typeof selectDataCache !== "undefined") {
        selectDataCache.monoCard = cardItems;
      }
      if (cardItems.length > 0 && typeof selectCustomOption === "function") {
        selectCustomOption("monoCard", cardItems[0].id, cardItems[0].name);
      }
    } else {
      if (triggerMonoCard) triggerMonoCard.innerText = "Счетов не найдено";
    }
  } catch (e) {
    if (triggerMonoCard) triggerMonoCard.innerText = "Ошибка загрузки";
  }
};

window.createAccount = async function () {
  const nameInput = document.getElementById("accName").value.trim();
  const type = document.getElementById("accType").value;
  const isSavings = document.getElementById("accIsSavings").checked;
  const icon = document.getElementById("accIcon")
    ? document.getElementById("accIcon").value
    : "💳";
  let newAccount = {};

  if (type === "bank") {
    const token = document.getElementById("bankToken").value.trim();
    const cardSelectStr = document.getElementById("monoCardSelect").value;
    if (!token || !cardSelectStr)
      return alert("Введите токен и выберите карту");
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
      isSavings: isSavings,
      icon: icon,
    };
  } else if (type === "privat") {
    if (!nameInput) return alert("Введите название счета");
    const startBalance =
      parseFloat(document.getElementById("accStartBalance").value) || 0;
    const currency = document.getElementById("accCurrency").value;
    const cardMask = document.getElementById("privatCardMask").value.trim();

    newAccount = {
      id: "acc_" + Date.now(),
      name: nameInput,
      startBalance: Math.round(startBalance * 100),
      creditLimit: 0,
      currency: currency,
      type: "privat",
      bank: "privat24",
      token: null,
      bankAccountId: null,
      cardMask: cardMask,
      isSavings: isSavings,
      icon: icon,
    };
  } else {
    if (!nameInput) return alert("Введите название счета");
    const startBalance =
      parseFloat(document.getElementById("accStartBalance").value) || 0;
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
      isSavings: isSavings,
      icon: icon,
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

window.openEditCategoryModal = async function (categoryId) {
  const categories = await getAllCategories();
  const category = categories.find((c) => c.id === categoryId);
  if (!category) return;
  document.getElementById("editCategoryId").value = categoryId;
  document.getElementById("categoryNameInput").value = category.name;
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
  if (!confirm(`Удалить категорию? Операций: ${usageCount}`)) return;

  for (const t of transactions.filter((t) => t.categoryId === categoryId)) {
    t.categoryId = "cat_default";
    await saveTransaction(t);
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
  if (typeof selectCustomOption === "function") {
    const acc = accounts.find((a) => a.id === tx.accountId);
    const cat = categories.find((c) => c.id === tx.categoryId);
    selectCustomOption("editTxAccount", tx.accountId, acc ? acc.name : "Счет");
    selectCustomOption(
      "editTxCategory",
      tx.categoryId,
      cat ? cat.name : "Категория",
    );
  }
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
  if (statusEl)
    isHtml ? (statusEl.innerHTML = text) : (statusEl.innerText = text);
  if (homeStatusEl)
    isHtml ? (homeStatusEl.innerHTML = text) : (homeStatusEl.innerText = text);
}

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
    if (!isSilent) setSyncStatusMsg("Синхронизация успешна!");
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

function populateAnalyticsFilters(transactions) {
  const monthSelect = document.getElementById("analyticsMonth");
  if (!monthSelect) return;
  const months = new Set();
  transactions.forEach((tx) => {
    const d = new Date(tx.date * 1000);
    months.add(
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`,
    );
  });
  if (months.size === 0) {
    const d = new Date();
    months.add(
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`,
    );
  }
  const sortedMonths = Array.from(months).sort().reverse();
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

  let filteredTxs = transactions.filter((tx) => {
    if (tx.description.startsWith("Коррекция баланса") || tx.isTransfer)
      return false;
    const d = new Date(tx.date * 1000);
    const txMonth = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    if (txMonth !== monthVal) return false;
    if (typeVal === "expense") return tx.amount < 0;
    if (typeVal === "income") return tx.amount > 0;
    return false;
  });

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
  if (data.length === 0) return;
  const total = data.reduce((sum, item) => sum + item.value, 0);
  let startAngle = -Math.PI / 2;
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
        <div class="legend-percent">${percent}%</div>`;
    container.appendChild(row);
  });
}

// --- БАЗА ДАННЫХ ---
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
  } catch (e) {}
  if (document.getElementById("rateUsd"))
    document.getElementById("rateUsd").innerText =
      `${exchangeRates.USD.toFixed(2)} ₴`;
  if (document.getElementById("rateEur"))
    document.getElementById("rateEur").innerText =
      `${exchangeRates.EUR.toFixed(2)} ₴`;
}

// --- ГЛАВНАЯ ФУНКЦИЯ ОБНОВЛЕНИЯ ДАННЫХ ---
async function refreshAppData() {
  const accounts = await getAllAccounts();
  const categories = await getAllCategories();
  const transactions = await getAllTransactions();

  populateAnalyticsFilters(transactions);

  const homeAccountsList = document.getElementById("homeAccountsList");
  const accountsList = document.getElementById("accountsList");
  const opAccountSelect = document.getElementById("opAccountSelect");
  const opToAccountSelect = document.getElementById("opToAccountSelect");

  const homeTransactions = document.getElementById("homeTransactions");
  const txContainer = document.getElementById("transactions");

  if (homeAccountsList) homeAccountsList.innerHTML = "";
  if (accountsList) accountsList.innerHTML = "";
  if (opAccountSelect) opAccountSelect.innerHTML = "";
  if (opToAccountSelect) opToAccountSelect.innerHTML = "";

  let totalGlobalBalanceUAH = 0;
  const mainAccounts = accounts.filter((acc) => !acc.isSavings);
  const savingsAccounts = accounts.filter((acc) => acc.isSavings);

  const renderAccountCardHTML = (acc, accBalance, isMainView) => {
    let creditLimit = acc.creditLimit || 0;
    let ownFunds = accBalance - creditLimit;
    const symbol =
      acc.currency === "USD" ? "$" : acc.currency === "EUR" ? "€" : "₴";
    const ownFundsStr = (ownFunds / 100).toFixed(2);
    const availableStr = (accBalance / 100).toFixed(2);
    const accIcon = acc.icon || "💳";
    const savingsBadge = acc.isSavings
      ? `<span style="background: #9C27B0; color: white; padding: 2px 6px; border-radius: 4px; font-size: 10px; margin-left: 5px;">Сейф</span>`
      : "";

    let sumHtml = `<div class="account-sum">${ownFundsStr} ${symbol}</div>`;
    if (creditLimit > 0) {
      sumHtml = `
          <div class="account-sum" style="color: ${ownFunds < 0 ? "#f44336" : "white"};">${ownFundsStr} ${symbol}</div>
          <div style="font-size: 11px; color: #888; text-align: right; margin-top: 3px;">Доступно: ${availableStr} ${symbol}</div>
      `;
    }

    if (isMainView) {
      return `
          <div class="account-info">
              <span class="account-name">${accIcon} ${acc.name} ${savingsBadge}</span>
              <span class="account-sub">${acc.type === "bank" || acc.type === "privat" ? "Банк: " + acc.bank : "Наличные"}</span>
          </div>
          <div style="display:flex; flex-direction:column; justify-content:center; align-items:flex-end;">${sumHtml}</div>
      `;
    } else {
      let hiddenActionsHtml = `
          <button class="swipe-action-btn swipe-edit" onclick="openEditAccountModal('${acc.id}')" title="Изменить имя">✏️</button>
          <button class="swipe-action-btn swipe-delete" onclick="deleteAccount('${acc.id}')" title="Удалить">🗑️</button>
      `;
      if (acc.type === "bank" && acc.token) {
        hiddenActionsHtml = `
              <button class="swipe-action-btn swipe-sync" onclick="syncMonoAccount('${acc.id}', '${acc.token}')" title="Sync">🔄</button>
              <button class="swipe-action-btn swipe-edit" onclick="openEditAccountModal('${acc.id}')" title="Изменить имя">✏️</button>
              <button class="swipe-action-btn swipe-delete" onclick="deleteAccount('${acc.id}')" title="Удалить">🗑️</button>
          `;
      }
      return `
          <div class="account-swipe-actions">${hiddenActionsHtml}</div>
          <div class="account-card-front">
              <div class="account-info">
                  <span class="account-name">${accIcon} ${acc.name} ${savingsBadge}</span>
                  <span class="account-sub">${acc.type === "bank" || acc.type === "privat" ? "Банк: " + acc.bank : "Наличные"}</span>
              </div>
              <div style="display:flex; flex-direction:column; justify-content:center; align-items:flex-end;">${sumHtml}</div>
          </div>
      `;
    }
  };

  const buildAccountListSection = (targetContainer, isMain) => {
    if (!targetContainer) return;
    if (mainAccounts.length > 0) {
      const header = document.createElement("div");
      header.className = "section-header";
      header.style.marginTop = "0";
      header.innerText = "Основные счета";
      targetContainer.appendChild(header);

      mainAccounts.forEach((acc) => {
        let accBalance = acc.startBalance;
        transactions.forEach((tx) => {
          if (tx.accountId === acc.id) accBalance += tx.amount;
        });
        if (isMain) {
          const card = document.createElement("div");
          card.className = "account-card";
          card.innerHTML = renderAccountCardHTML(acc, accBalance, true);
          targetContainer.appendChild(card);
        } else {
          const swipeContainer = document.createElement("div");
          swipeContainer.className = "account-swipe-container";
          swipeContainer.innerHTML = renderAccountCardHTML(
            acc,
            accBalance,
            false,
          );
          targetContainer.appendChild(swipeContainer);
        }
      });
    }

    if (savingsAccounts.length > 0) {
      const header = document.createElement("div");
      header.className = "section-header";
      header.innerText = "🐷 Накопления и сейфы";
      targetContainer.appendChild(header);

      savingsAccounts.forEach((acc) => {
        let accBalance = acc.startBalance;
        transactions.forEach((tx) => {
          if (tx.accountId === acc.id) accBalance += tx.amount;
        });
        if (isMain) {
          const card = document.createElement("div");
          card.className = "account-card";
          card.style.borderColor = "rgba(156, 39, 176, 0.3)";
          card.innerHTML = renderAccountCardHTML(acc, accBalance, true);
          targetContainer.appendChild(card);
        } else {
          const swipeContainer = document.createElement("div");
          swipeContainer.className = "account-swipe-container";
          swipeContainer.style.borderColor = "rgba(156, 39, 176, 0.3)";
          swipeContainer.innerHTML = renderAccountCardHTML(
            acc,
            accBalance,
            false,
          );
          targetContainer.appendChild(swipeContainer);
        }
      });
    }
  };

  buildAccountListSection(homeAccountsList, true);
  buildAccountListSection(accountsList, false);

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

    if (!acc.isSavings) totalGlobalBalanceUAH += balanceInUAH;

    const symbol =
      acc.currency === "USD" ? "$" : acc.currency === "EUR" ? "€" : "₴";
    const availableStr = (accBalance / 100).toFixed(2);

    if (opAccountSelect) {
      const opt = document.createElement("option");
      opt.value = acc.id;
      opt.innerText = `${acc.name} (Ост: ${availableStr} ${symbol})`;
      opAccountSelect.appendChild(opt);
    }
    if (opToAccountSelect) {
      const optTo = document.createElement("option");
      optTo.value = acc.id;
      optTo.innerText = `${acc.name} (Ост: ${availableStr} ${symbol})`;
      opToAccountSelect.appendChild(optTo);
    }
  });

  document.getElementById("totalBalance").innerText =
    (totalGlobalBalanceUAH / 100).toFixed(2) + " ₴";

  const sortedTxs = transactions.sort((a, b) => b.date - a.date).slice(0, 100);
  renderTransactionsGrouped(sortedTxs, homeTransactions, accounts, categories);
  renderTransactionsGrouped(sortedTxs, txContainer, accounts, categories);

  const categoriesList = document.getElementById("categoriesList");
  if (categoriesList) {
    categoriesList.innerHTML = "";
    const incomeCategories = categories.filter(
      (c) => c.type === "income" || c.id === "cat_default",
    );
    const expenseCategories = categories.filter(
      (c) => c.type === "expense" || (!c.type && c.id !== "cat_default"),
    );

    const renderCatGroup = (title, cats) => {
      if (cats.length === 0) return;
      const groupHeader = document.createElement("div");
      groupHeader.className = "section-header";
      groupHeader.innerText = title;
      categoriesList.appendChild(groupHeader);

      cats.forEach((cat) => {
        const usageCount = transactions.filter(
          (t) => t.categoryId === cat.id,
        ).length;
        const isDefault = cat.id === "cat_default";
        const usageText =
          usageCount > 0 ? `${usageCount} операций` : "Не используется";
        const card = document.createElement("div");
        card.className = "category-card";
        let actionsHtml = isDefault
          ? '<span style="color:#888;font-size:12px;">Системная</span>'
          : `<button class="btn-sm" onclick="openEditCategoryModal('${cat.id}')">✏️</button><button class="btn-sm btn-danger" onclick="deleteCategory('${cat.id}')">✕</button>`;

        card.innerHTML = `<div class="category-info"><span class="category-name">${cat.name}</span><span class="category-usage">${usageText}</span></div><div class="category-actions">${actionsHtml}</div>`;
        categoriesList.appendChild(card);
      });
    };
    renderCatGroup("📥 Категории доходов", incomeCategories);
    renderCatGroup("📤 Категории расходов", expenseCategories);
  }

  if (document.getElementById("tab-analytics").classList.contains("active"))
    renderAnalytics();

  if (typeof selectDataCache !== "undefined") {
    selectDataCache.account = accounts.map((a) => ({
      id: a.id,
      name: `${a.name} (${(a.startBalance / 100).toFixed(2)} ${a.currency === "USD" ? "$" : a.currency === "EUR" ? "€" : "₴"})`,
    }));
    selectDataCache.toAccount = accounts.map((a) => ({
      id: a.id,
      name: `${a.name} (${(a.startBalance / 100).toFixed(2)} ${a.currency === "USD" ? "$" : a.currency === "EUR" ? "€" : "₴"})`,
    }));
    selectDataCache.category = categories.map((c) => ({
      id: c.id,
      name: c.name,
    }));
    selectDataCache.editTxAccount = accounts.map((a) => ({
      id: a.id,
      name: a.name,
    }));
    selectDataCache.editTxCategory = categories.map((c) => ({
      id: c.id,
      name: c.name,
    }));

    if (
      accounts.length > 0 &&
      !document.getElementById("opAccountSelect").value &&
      typeof selectCustomOption === "function"
    ) {
      selectCustomOption(
        "account",
        accounts[0].id,
        selectDataCache.account[0].name,
      );
      selectCustomOption(
        "toAccount",
        accounts[accounts.length > 1 ? 1 : 0].id,
        selectDataCache.toAccount[accounts.length > 1 ? 1 : 0].name,
      );
    }
    if (
      categories.length > 0 &&
      !document.getElementById("opCategorySelect").value &&
      typeof selectCustomOption === "function"
    ) {
      selectCustomOption("category", categories[0].id, categories[0].name);
    }
  }
}

window.deleteAccount = async function (accountId) {
  if (
    !confirm("Удалить этот счет? История операций по нему также будет удалена.")
  )
    return;
  const tx = db.transaction(["accounts", "transactions"], "readwrite");
  tx.objectStore("accounts").delete(accountId);
  const txStore = tx.objectStore("transactions");
  const request = txStore.getAll();
  request.onsuccess = function (e) {
    e.target.result.forEach((t) => {
      if (t.accountId === accountId) txStore.delete(t.id);
    });
  };
  tx.oncomplete = async () => {
    await refreshAppData();
  };
};
