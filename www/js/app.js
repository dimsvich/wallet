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
  const editAmountInput = document.getElementById("editTxAmount");
  if (editAmountInput) {
    editAmountInput.addEventListener("input", () => {
      if (window.updateEditTransferCalculation)
        window.updateEditTransferCalculation();
    });
  }
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

  const opAcc = document.getElementById("opAccountSelect");
  const opToAcc = document.getElementById("opToAccountSelect");
  const manAmount = document.getElementById("manualAmount");
  if (opAcc) opAcc.addEventListener("change", window.updateTransferCalculation);
  if (opToAcc)
    opToAcc.addEventListener("change", window.updateTransferCalculation);
  if (manAmount)
    manAmount.addEventListener("input", window.updateTransferCalculation);
});

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

window.switchTab = function (tabName, btn) {
  document
    .querySelectorAll(".tab-content")
    .forEach((el) => el.classList.remove("active"));
  document
    .querySelectorAll(".nav-item")
    .forEach((el) => el.classList.remove("active"));
  const targetTab = document.getElementById("tab-" + tabName);
  if (targetTab) targetTab.classList.add("active");
  if (btn) btn.classList.add("active");
  if (tabName === "analytics") renderAnalytics();
};

window.openModal = function (modalId) {
  document.getElementById(modalId).style.display = "flex";
};
window.closeModal = function (modalId) {
  document.getElementById(modalId).style.display = "none";
};

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

window.openEditAccountModal = async function (accountId) {
  const accounts = await getAllAccounts();
  const acc = accounts.find((a) => a.id === accountId);
  if (!acc) return;

  document.getElementById("editAccId").value = acc.id;
  document.getElementById("editAccName").value = acc.name;
  const icon = acc.icon || "💳";
  document.getElementById("editAccIconVal").value = icon;
  document.getElementById("editAccIsSavings").checked = !!acc.isSavings;

  const tokenContainer = document.getElementById("editMonoTokenContainer");
  const tokenInput = document.getElementById("editAccToken");

  if (acc.type === "bank") {
    tokenContainer.style.display = "block";
    tokenInput.value = acc.token || "";
  } else {
    tokenContainer.style.display = "none";
    tokenInput.value = "";
  }

  document.querySelectorAll(".edit-icon-chip").forEach((el) => {
    if (el.innerText === icon) {
      el.style.borderColor = "var(--primary-color)";
    } else {
      el.style.borderColor = "var(--border-color)";
    }
  });

  openModal("editAccountModal");
};

window.saveEditedAccount = async function () {
  const accountId = document.getElementById("editAccId").value;
  const newName = document.getElementById("editAccName").value.trim();
  const newIcon = document.getElementById("editAccIconVal").value;
  const isSavings = document.getElementById("editAccIsSavings").checked;
  const newToken = document.getElementById("editAccToken").value.trim();

  if (!newName) return alert("Введите название счета");

  const accounts = await getAllAccounts();
  const acc = accounts.find((a) => a.id === accountId);
  if (!acc) return;

  acc.name = newName;
  acc.icon = newIcon;
  acc.isSavings = isSavings;
  if (acc.type === "bank") {
    acc.token = newToken;
  }

  await saveAccount(acc);
  closeModal("editAccountModal");
  await refreshAppData();
};

window.createCategory = async function () {
  const name = document.getElementById("newCatName").value.trim();
  const type = document.getElementById("newCatType")
    ? document.getElementById("newCatType").value
    : "expense";
  if (!name) return alert("Введите название категории");

  await saveCategory({
    id: "cat_" + Date.now(),
    name: name,
    type: type,
  });

  document.getElementById("newCatName").value = "";
  if (typeof selectCustomOption === "function") {
    selectCustomOption("catType", "expense", "Расход");
  }
  await refreshAppData();
};

window.openEditCategoryModal = async function (categoryId) {
  const categories = await getAllCategories();
  const category = categories.find((c) => c.id === categoryId);
  if (!category) return;

  document.getElementById("editCategoryId").value = categoryId;
  document.getElementById("categoryNameInput").value = category.name;

  const catType = category.type || "expense";
  const typeName = catType === "income" ? "Доход" : "Расход";

  if (typeof selectCustomOption === "function") {
    selectCustomOption("editCatType", catType, typeName);
  }

  window.openModal("categoryModal");
};

window.saveNewCategory = async function () {
  const categoryId = document.getElementById("editCategoryId").value;
  const categoryName = document
    .getElementById("categoryNameInput")
    .value.trim();
  const categoryType = document.getElementById("categoryTypeInput")
    ? document.getElementById("categoryTypeInput").value
    : "expense";

  if (!categoryName) return alert("Введите название категории");

  if (categoryId) {
    const categories = await getAllCategories();
    const category = categories.find((c) => c.id === categoryId);
    if (category) {
      category.name = categoryName;
      category.type = categoryType;
      await saveCategory(category);
    }
  } else {
    await saveCategory({
      id: "cat_" + Date.now(),
      name: categoryName,
      type: categoryType,
    });
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
  document.getElementById("editTxDesc").value = tx.description.replace(
    /^Перевод:\s*/,
    "",
  );

  let currentType = "expense";
  let typeName = "Расход";
  let displayAmount = Math.abs(tx.amount);
  let targetAmount = "";
  let toAccountId = null;
  let activeAccountId = tx.accountId;

  if (tx.isTransfer) {
    currentType = "transfer";
    typeName = "Перевод";

    const pairTx = transactions.find(
      (t) =>
        t.id !== tx.id &&
        t.description === tx.description &&
        Math.abs(t.date - tx.date) <= 60,
    );
    const txOut = tx.amount < 0 ? tx : pairTx;
    const txIn = tx.amount > 0 ? tx : pairTx;

    if (txOut && txIn) {
      displayAmount = Math.abs(txOut.amount);
      targetAmount = (txIn.amount / 100).toFixed(2);
      toAccountId = txIn.accountId;
      activeAccountId = txOut.accountId;
    }
  } else if (tx.amount > 0) {
    currentType = "income";
    typeName = "Доход";
  }

  document.getElementById("editTxAmount").value = (displayAmount / 100).toFixed(
    2,
  );
  if (document.getElementById("editTxTargetAmount")) {
    document.getElementById("editTxTargetAmount").value = targetAmount;
  }

  const accounts = await getAllAccounts();
  const categories = await getAllCategories();

  if (typeof selectDataCache !== "undefined") {
    selectDataCache.editTxToAccount = accounts.map((a) => ({
      id: a.id,
      name: a.name,
    }));
  }

  if (typeof selectCustomOption === "function") {
    selectCustomOption("editTxType", currentType, typeName);

    const acc = accounts.find((a) => a.id === activeAccountId);
    const cat = categories.find((c) => c.id === tx.categoryId);

    selectCustomOption(
      "editTxAccount",
      activeAccountId,
      acc ? acc.name : "Счет",
    );
    selectCustomOption(
      "editTxCategory",
      tx.categoryId || "cat_default",
      cat ? cat.name : "Без категории",
    );

    const fallbackOtherAcc =
      accounts.find((a) => a.id !== activeAccountId) || accounts[0];
    const finalToAccId = toAccountId || fallbackOtherAcc.id;
    const toAccObj = accounts.find((a) => a.id === finalToAccId);

    if (toAccObj) {
      selectCustomOption("editTxToAccount", finalToAccId, toAccObj.name);
    }
  }

  if (typeof toggleEditTransferFields === "function") {
    toggleEditTransferFields(currentType);
  }

  window.openModal("editTxModal");
};

window.saveEditedTransaction = async function () {
  const txId = document.getElementById("editTxId").value;
  const rawAmount = parseFloat(document.getElementById("editTxAmount").value);
  if (isNaN(rawAmount) || rawAmount <= 0)
    return alert("Введите корректную сумму");

  const transactions = await getAllTransactions();
  const tx = transactions.find((t) => t.id === txId);
  if (!tx) return;

  const txType = document.getElementById("editTxType").value;
  const fromAccountId = document.getElementById("editTxAccount").value;
  const toAccountId = document.getElementById("editTxToAccount").value;
  let desc = document.getElementById("editTxDesc").value.trim();

  let amountInKopecks = Math.round(Math.abs(rawAmount) * 100);

  let oldPairId = null;
  if (tx.isTransfer) {
    const oldPair = transactions.find(
      (t) =>
        t.id !== tx.id &&
        t.description === tx.description &&
        Math.abs(t.date - tx.date) <= 60,
    );
    if (oldPair) oldPairId = oldPair.id;
  }

  if (txType === "transfer") {
    if (!fromAccountId || !toAccountId || fromAccountId === toAccountId) {
      return alert("Выберите разные счета для перевода");
    }
    const rawTargetAmount = parseFloat(
      document.getElementById("editTxTargetAmount").value,
    );
    if (isNaN(rawTargetAmount) || rawTargetAmount <= 0) {
      return alert("Укажите сумму зачисления");
    }
    let targetAmountInKopecks = Math.round(Math.abs(rawTargetAmount) * 100);
    if (!desc.startsWith("Перевод:")) desc = "Перевод: " + desc;

    if (oldPairId) await removeTransaction(oldPairId);

    tx.accountId = fromAccountId;
    tx.categoryId = "cat_default";
    tx.amount = -amountInKopecks;
    tx.description = desc;
    tx.isTransfer = true;
    tx.userModified = true;
    await saveTransaction(tx);

    await saveTransaction({
      id: "tx_in_" + Date.now(),
      accountId: toAccountId,
      categoryId: "cat_default",
      amount: targetAmountInKopecks,
      description: desc,
      date: tx.date,
      userModified: true,
      isTransfer: true,
    });
  } else {
    if (oldPairId) await removeTransaction(oldPairId);

    if (txType === "expense") amountInKopecks = -amountInKopecks;

    tx.accountId = fromAccountId;
    tx.categoryId =
      document.getElementById("editTxCategory").value || "cat_default";
    tx.amount = amountInKopecks;
    tx.description = desc;
    tx.isTransfer = false;
    tx.userModified = true;
    await saveTransaction(tx);
  }

  window.closeModal("editTxModal");
  await refreshAppData();
};

window.deleteTransaction = async function () {
  const txId = document.getElementById("editTxId").value;
  const transactions = await getAllTransactions();
  const tx = transactions.find((t) => t.id === txId);

  if (tx && tx.isTransfer) {
    const pairTx = transactions.find(
      (t) =>
        t.id !== tx.id &&
        t.description === tx.description &&
        Math.abs(t.date - tx.date) <= 60,
    );
    if (pairTx) await removeTransaction(pairTx.id);
  }

  await removeTransaction(txId);
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
    if (!targetAcc) throw new Error("Счет не найден");

    const bankAccId = targetAcc.bankAccountId || "0";
    let currentBankBalance = null;
    let creditLimit = targetAcc.creditLimit || 0;

    try {
      const clientRes = await fetch(
        "https://api.monobank.ua/personal/client-info",
        { headers },
      );
      if (clientRes.ok) {
        const clientData = await clientRes.json();
        const card =
          clientData.accounts.find((a) => a.id === bankAccId) ||
          clientData.accounts[0];
        if (card) {
          currentBankBalance = card.balance;
          creditLimit = card.creditLimit || 0;
        }
      }
    } catch (e) {
      console.warn("Не удалось получить client-info");
    }

    const to = Math.floor(Date.now() / 1000);
    const from = to - 30 * 24 * 60 * 60;
    const stmtResponse = await fetch(
      `https://api.monobank.ua/personal/statement/${bankAccId}/${from}/${to}`,
      { headers },
    );

    if (stmtResponse.ok) {
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

      if (currentBankBalance === null && data.length > 0) {
        currentBankBalance = data[0].balance;
      }
    }

    targetAcc.creditLimit = creditLimit;
    await saveAccount(targetAcc);

    if (currentBankBalance !== null) {
      const updatedTxs = await getAllTransactions();
      let calculatedBalance = targetAcc.startBalance;

      updatedTxs.forEach((tx) => {
        if (tx.accountId === accountId) {
          calculatedBalance += tx.amount;
        }
      });

      const diff = currentBankBalance - calculatedBalance;

      if (diff !== 0) {
        const symbol =
          targetAcc.currency === "USD"
            ? "$"
            : targetAcc.currency === "EUR"
              ? "€"
              : "₴";
        const diffStr = (Math.abs(diff) / 100).toFixed(2);
        const appBalStr = (calculatedBalance / 100).toFixed(2);
        const bankBalStr = (currentBankBalance / 100).toFixed(2);

        if (!isSilent) {
          const confirmFix = confirm(
            `Баланс в Монобанке (${bankBalStr} ${symbol}) не совпадает с приложением (${appBalStr} ${symbol}).\n\n` +
              `Разница: ${diff > 0 ? "+" : "-"}${diffStr} ${symbol}.\n\n` +
              `Создать операцию коррекции баланса?`,
          );

          if (confirmFix) {
            await saveTransaction({
              id: "tx_adj_" + Date.now(),
              accountId: accountId,
              categoryId: "cat_default",
              amount: diff,
              description: "Коррекция баланса (Монобанк)",
              date: Math.floor(Date.now() / 1000),
              userModified: true,
            });
          }
        }
      }
    }

    if (!isSilent) setSyncStatusMsg("Синхронизация успешна!");
    await refreshAppData();
  } catch (error) {
    console.error("Ошибка синхронизации Mono:", error);
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
  const processedTxIds = new Set();
  const transferPairs = [];

  const transfers = transactionsToRender.filter((t) => t.isTransfer);
  transfers.forEach((t1) => {
    if (processedTxIds.has(t1.id)) return;

    const t2 = transfers.find(
      (t) =>
        t.id !== t1.id &&
        !processedTxIds.has(t.id) &&
        t.description === t1.description &&
        Math.abs(t.date - t1.date) <= 60,
    );

    if (t2) {
      processedTxIds.add(t1.id);
      processedTxIds.add(t2.id);
      const txOut = t1.amount < 0 ? t1 : t2;
      const txIn = t1.amount > 0 ? t1 : t2;
      transferPairs.push({
        isPairedTransfer: true,
        txOut,
        txIn,
        date: txOut.date,
      });
    }
  });

  const allItems = [];
  transactionsToRender.forEach((tx) => {
    if (!processedTxIds.has(tx.id)) allItems.push(tx);
  });
  allItems.push(...transferPairs);

  allItems.sort((a, b) => b.date - a.date);

  allItems.forEach((item) => {
    const dateObj = new Date(item.date * 1000);
    const dateStr = dateObj.toLocaleDateString("ru-RU", {
      day: "numeric",
      month: "long",
      year: "numeric",
    });
    if (!grouped[dateStr]) grouped[dateStr] = [];
    grouped[dateStr].push(item);
  });

  for (const [dateStr, items] of Object.entries(grouped)) {
    const header = document.createElement("div");
    header.style =
      "font-size: 13px; color: #888; margin: 15px 0 8px 5px; font-weight: bold; text-transform: uppercase;";
    header.innerText = dateStr;
    containerElement.appendChild(header);

    items.forEach((item) => {
      if (item.isPairedTransfer) {
        const accOut = accounts.find((a) => a.id === item.txOut.accountId);
        const accIn = accounts.find((a) => a.id === item.txIn.accountId);

        const symOut = accOut
          ? accOut.currency === "USD"
            ? "$"
            : accOut.currency === "EUR"
              ? "€"
              : "₴"
          : "₴";
        const symIn = accIn
          ? accIn.currency === "USD"
            ? "$"
            : accIn.currency === "EUR"
              ? "€"
              : "₴"
          : "₴";

        const valOut = (item.txOut.amount / 100).toFixed(2);
        const valIn = (item.txIn.amount / 100).toFixed(2);

        const card = document.createElement("div");
        card.className = "tx-card transfer-card";
        card.onclick = () => openEditTransaction(item.txOut.id);

        card.innerHTML = `
          <div class="transfer-icon">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#f8fafc" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M5 12h14"></path><path d="M12 5l7 7-7 7"></path>
              </svg>
          </div>
          <div class="transfer-info">
              <span class="transfer-dest">${accIn ? accIn.name : "Счет удален"}</span>
              <span class="transfer-source">${accOut ? accOut.name : "Счет удален"}</span>
          </div>
          <div class="transfer-amounts">
              <span class="transfer-amount-in">${valIn} ${symIn}</span>
              <span class="transfer-amount-out">${valOut} ${symOut}</span>
          </div>`;
        containerElement.appendChild(card);
      } else {
        const tx = item;
        const acc = accounts.find((a) => a.id === tx.accountId);
        const cat = categories.find((c) => c.id === tx.categoryId);
        const symbol = acc
          ? acc.currency === "USD"
            ? "$"
            : acc.currency === "EUR"
              ? "€"
              : "₴"
          : "₴";

        const amount = tx.amount / 100;
        const amountStr =
          amount > 0 ? `+${amount} ${symbol}` : `${amount} ${symbol}`;
        const colorClass = amount > 0 ? "green" : "white";
        const timeStr = new Date(tx.date * 1000).toLocaleTimeString("ru-RU", {
          hour: "2-digit",
          minute: "2-digit",
        });

        const card = document.createElement("div");
        card.className = "tx-card";
        card.onclick = () => openEditTransaction(tx.id);

        card.innerHTML = `
            <div class="tx-info">
                <span class="tx-desc">${tx.description}</span>
                <span class="tx-date">${cat ? cat.name : "Без категории"} • ${acc ? acc.name : ""} • ${timeStr}</span>
            </div>
            <div class="tx-amount ${colorClass}">${amountStr}</div>`;
        containerElement.appendChild(card);
      }
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
        catStore.put({
          id: "cat_default",
          name: "Без категории",
          type: "expense",
        });
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
          <button class="swipe-action-btn swipe-edit" onclick="openEditAccountModal('${acc.id}')" title="Изменить">✏️</button>
          <button class="swipe-action-btn swipe-delete" onclick="deleteAccount('${acc.id}')" title="Удалить">🗑️</button>
      `;
      if (acc.type === "bank" && acc.token) {
        hiddenActionsHtml = `
              <button class="swipe-action-btn swipe-sync" onclick="syncMonoAccount('${acc.id}', '${acc.token}')" title="Sync">🔄</button>
              <button class="swipe-action-btn swipe-edit" onclick="openEditAccountModal('${acc.id}')" title="Изменить">✏️</button>
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
    const incomeCategories = categories.filter((c) => c.type === "income");
    const expenseCategories = categories.filter(
      (c) => c.type === "expense" || !c.type || c.id === "cat_default",
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

  const blob = new Blob([jsonStr], { type: "application/json" });
  const file = new File([blob], fileName, { type: "application/json" });

  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({
        files: [file],
        title: "Резервная копия ZenLocal",
        text: "Файл резервной копии базы данных ZenLocal",
      });
      return;
    } catch (e) {
      console.log("Шаринг отменен или не удался", e);
    }
  }

  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
};

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
          if (!data.accounts || !data.categories || !data.transactions) {
            alert("Ошибка: Неверный формат файла резервной копии.");
            importInput.value = "";
            return;
          }
          if (
            confirm(
              "ВНИМАНИЕ!\n\nТекущие данные будут удалены и заменены данными из копии.\nПродолжить?",
            )
          ) {
            await restoreDatabase(data);
            alert("Данные успешно восстановлены!");
            importInput.value = "";
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

async function restoreDatabase(data) {
  return new Promise((resolve, reject) => {
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

    data.accounts.forEach((acc) => accStore.put(acc));
    data.categories.forEach((cat) => catStore.put(cat));
    data.transactions.forEach((t) => transStore.put(t));

    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

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
    if (!socialLoginReady) {
      await SocialLogin.initialize({
        google: { webClientId: GOOGLE_CLIENT_ID },
      });
      socialLoginReady = true;
    }

    const res = await SocialLogin.login({
      provider: "google",
      options: { scopes: ["https://www.googleapis.com/auth/drive.appdata"] },
    });

    const at = res && res.result && res.result.accessToken;
    const token = typeof at === "string" ? at : at && at.token;
    if (!token) throw new Error("В ответе нет access token.");

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
    { headers: { Authorization: `Bearer ${currentGoogleToken}` } },
  );
  if (!response.ok) {
    if (response.status === 401) {
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
      await window.forceRestoreFromCloud(fileId);
    } else if (localTransactions.length > 0) {
      await window.forceBackupToCloud();
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
  const fileBlob = new Blob([JSON.stringify(backup)], {
    type: "application/json",
  });

  try {
    const existingFileId = await findCloudBackupFile();
    const metadata = { name: "zenlocal_sync.json" };
    if (!existingFileId) metadata.parents = ["appDataFolder"];

    const form = new FormData();
    form.append(
      "metadata",
      new Blob([JSON.stringify(metadata)], { type: "application/json" }),
    );
    form.append("file", fileBlob);

    let url = existingFileId
      ? `https://www.googleapis.com/upload/drive/v3/files/${existingFileId}?uploadType=multipart`
      : "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart";
    let method = existingFileId ? "PATCH" : "POST";

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
    console.error("❌ Ошибка: BankNotifyParser не загружен!");
    return;
  }
  const parsed = BankNotifyParser.parsePrivatNotification({
    text: rawText,
    postTime: postTime,
  });
  if (!parsed.ok) return;

  const accounts = await getAllAccounts();
  let targetAccount = null;

  for (const acc of accounts) {
    if (acc.type === "privat") {
      if (!acc.cardMask || acc.cardMask === parsed.cardMask) {
        targetAccount = acc;
        break;
      }
    }
  }

  if (!targetAccount) return;

  const newTransaction = {
    id: "tx_" + Date.now(),
    accountId: targetAccount.id,
    categoryId: "cat_default",
    type: parsed.type,
    amount: Math.round((parsed.amount + (parsed.commission || 0)) * 100),
    date: Math.floor(parsed.opTime / 1000),
    description: `${parsed.kind}. ${parsed.details}`.trim(),
    userModified: false,
  };

  if (newTransaction.type === "expense")
    newTransaction.amount = -Math.abs(newTransaction.amount);

  if (parsed.balanceAfter !== null) {
    targetAccount.startBalance = Math.round(parsed.balanceAfter * 100);
  } else {
    targetAccount.startBalance +=
      newTransaction.amount - Math.round((parsed.commission || 0) * 100);
  }

  if (parsed.creditLimit !== null)
    targetAccount.creditLimit = Math.round(parsed.creditLimit * 100);

  await saveAccount(targetAccount);
  await saveTransaction(newTransaction);
  if (typeof refreshAppData === "function") await refreshAppData();
};

window.processMissedPushes = async function (jsonString) {
  try {
    const pushes = JSON.parse(jsonString);
    for (const p of pushes) {
      await window.processPushNotification(p.text, p.time);
    }
  } catch (e) {
    console.error("❌ Ошибка обработки фоновых пушей:", e);
  }
};

// ==========================================
// ИМПОРТ CSV ДЗЕН-МАНИ
// ==========================================
window.importZenmoneyCSV = async function (csvText) {
  function parseCSV(text) {
    const lines = text.split(/\r\n|\n/);
    const result = [];
    for (let i = 0; i < lines.length; i++) {
      let line = lines[i].trim();
      if (!line) continue;
      const row = [];
      let insideQuote = false;
      let entry = "";
      for (let j = 0; j < line.length; j++) {
        const char = line[j];
        if (char === '"') {
          insideQuote = !insideQuote;
        } else if (char === ";" && !insideQuote) {
          row.push(entry.trim());
          entry = "";
        } else {
          entry += char;
        }
      }
      row.push(entry.trim());
      result.push(row);
    }
    return result;
  }

  const rows = parseCSV(csvText);
  if (rows.length < 2) return alert("Файл пуст или некорректен.");

  const headers = rows[0].map((h) =>
    h.replace(/^\ufeff/, "").replace(/"/g, ""),
  );
  const dataRows = rows.slice(1);

  const idx = {
    date: headers.indexOf("date"),
    categoryName: headers.indexOf("categoryName"),
    payee: headers.indexOf("payee"),
    comment: headers.indexOf("comment"),
    outcomeAccountName: headers.indexOf("outcomeAccountName"),
    outcome: headers.indexOf("outcome"),
    outcomeCurrency: headers.indexOf("outcomeCurrencyShortTitle"),
    incomeAccountName: headers.indexOf("incomeAccountName"),
    income: headers.indexOf("income"),
    incomeCurrency: headers.indexOf("incomeCurrencyShortTitle"),
    createdDate: headers.indexOf("createdDate"),
  };

  function cleanAccName(name) {
    if (!name) return "";
    return name
      .replace(/^[\*\s]+/, "")
      .replace(/[\*\s]+$/, "")
      .trim();
  }

  const accountsMap = new Map();
  const categoriesMap = new Map();
  categoriesMap.set("Без категории", "cat_default");

  dataRows.forEach((row) => {
    const outAcc = cleanAccName(row[idx.outcomeAccountName]);
    const incAcc = cleanAccName(row[idx.incomeAccountName]);
    const outCurr = row[idx.outcomeCurrency] || "UAH";
    const incCurr = row[idx.incomeCurrency] || "UAH";
    const catName = (row[idx.categoryName] || "").replace(/"/g, "").trim();

    // Функция создания конфига счета с автоматическим определением, является ли он сейфом/накопительным
    const createAccObj = (accName, currency) => {
      const lower = accName.toLowerCase();
      const isPrivat = lower.includes("приват") || lower.includes("universal");
      const isSavings =
        lower.includes("копилка") ||
        lower.includes("долги") ||
        currency === "USD" ||
        currency === "EUR";

      let type = "bank";
      if (lower.includes("наличные")) type = "cash";
      else if (isPrivat) type = "privat";

      let icon = "💳";
      if (lower.includes("наличные")) icon = "💵";
      else if (lower.includes("копилка")) icon = "🐖";
      else if (currency === "USD" || currency === "EUR") icon = "💎";

      return {
        id: "acc_" + Math.random().toString(36).substr(2, 9),
        name: accName,
        startBalance: 0,
        creditLimit: 0,
        currency: currency,
        type: type,
        bank: type === "cash" ? null : accName,
        token: null,
        bankAccountId: null,
        isSavings: isSavings,
        icon: icon,
      };
    };

    if (outAcc && !accountsMap.has(outAcc)) {
      accountsMap.set(outAcc, createAccObj(outAcc, outCurr));
    }

    if (incAcc && !accountsMap.has(incAcc)) {
      accountsMap.set(incAcc, createAccObj(incAcc, incCurr));
    }

    if (catName && !categoriesMap.has(catName)) {
      const outcomeVal = parseFloat(row[idx.outcome]) || 0;
      const incomeVal = parseFloat(row[idx.income]) || 0;
      const catType = incomeVal > 0 && outcomeVal === 0 ? "income" : "expense";

      categoriesMap.set(catName, {
        id: "cat_" + Math.random().toString(36).substr(2, 9),
        name: catName,
        type: catType,
      });
    }
  });

  const newTransactions = [];

  dataRows.forEach((row, rIdx) => {
    const outAccName = cleanAccName(row[idx.outcomeAccountName]);
    const incAccName = cleanAccName(row[idx.incomeAccountName]);
    const outcome = parseFloat(row[idx.outcome]) || 0;
    const income = parseFloat(row[idx.income]) || 0;
    const catName = (row[idx.categoryName] || "").replace(/"/g, "").trim();
    const payee = (row[idx.payee] || "").replace(/"/g, "").trim();
    const comment = (row[idx.comment] || "").replace(/"/g, "").trim();

    const createdStr = (row[idx.createdDate] || row[idx.date] || "").replace(
      " ",
      "T",
    );
    const timestamp =
      Math.floor(new Date(createdStr).getTime() / 1000) ||
      Math.floor(Date.now() / 1000);

    let desc = [payee, comment].filter(Boolean).join(". ") || "Без описания";

    const catObj = categoriesMap.get(catName);
    const categoryId =
      typeof catObj === "object" ? catObj.id : catObj || "cat_default";

    if (
      outAccName &&
      incAccName &&
      outAccName !== incAccName &&
      outcome > 0 &&
      income > 0
    ) {
      const transferDesc =
        desc !== "Без описания" ? "Перевод: " + desc : "Перевод";
      const outAcc = accountsMap.get(outAccName);
      const incAcc = accountsMap.get(incAccName);

      if (outAcc && incAcc) {
        newTransactions.push({
          id: `tx_import_out_${rIdx}_${timestamp}`,
          accountId: outAcc.id,
          categoryId: "cat_default",
          amount: -Math.round(outcome * 100),
          description: transferDesc,
          date: timestamp,
          userModified: true,
          isTransfer: true,
        });

        newTransactions.push({
          id: `tx_import_in_${rIdx}_${timestamp}`,
          accountId: incAcc.id,
          categoryId: "cat_default",
          amount: Math.round(income * 100),
          description: transferDesc,
          date: timestamp,
          userModified: true,
          isTransfer: true,
        });
      }
    } else if (outcome > 0) {
      const acc = accountsMap.get(outAccName);
      if (acc) {
        newTransactions.push({
          id: `tx_import_${rIdx}_${timestamp}`,
          accountId: acc.id,
          categoryId: categoryId,
          amount: -Math.round(outcome * 100),
          description: desc,
          date: timestamp,
          userModified: true,
          isTransfer: false,
        });
      }
    } else if (income > 0) {
      const acc = accountsMap.get(incAccName);
      if (acc) {
        newTransactions.push({
          id: `tx_import_${rIdx}_${timestamp}`,
          accountId: acc.id,
          categoryId: categoryId,
          amount: Math.round(income * 100),
          description: desc,
          date: timestamp,
          userModified: true,
          isTransfer: false,
        });
      }
    }
  });

  const accountsToSave = Array.from(accountsMap.values());
  const categoriesToSave = Array.from(categoriesMap.values()).filter(
    (c) => typeof c === "object",
  );

  const tx = db.transaction(
    ["accounts", "categories", "transactions"],
    "readwrite",
  );
  const accStore = tx.objectStore("accounts");
  const catStore = tx.objectStore("categories");
  const transStore = tx.objectStore("transactions");

  accountsToSave.forEach((acc) => accStore.put(acc));
  categoriesToSave.forEach((cat) => catStore.put(cat));
  newTransactions.forEach((t) => transStore.put(t));

  tx.oncomplete = async () => {
    alert(
      `Импорт успешно завершен!\n\nЗагружено:\n• Счетов: ${accountsToSave.length}\n• Категорий: ${categoriesToSave.length}\n• Операций: ${newTransactions.length}`,
    );
    await refreshAppData();
  };
};

window.handleZenmoneyImport = function (input) {
  const file = input.files && input.files[0];
  if (!file) return;

  if (!confirm(`Импортировать операции из файла "${file.name}"?`)) {
    input.value = "";
    return;
  }

  const reader = new FileReader();
  reader.onload = async function (e) {
    try {
      if (typeof window.importZenmoneyCSV !== "function") {
        alert("Ошибка: функция importZenmoneyCSV не найдена в app.js!");
        return;
      }
      await window.importZenmoneyCSV(e.target.result);
      input.value = "";
    } catch (err) {
      console.error("Ошибка при импорте:", err);
      alert("Ошибка при импорте: " + (err.message || err));
      input.value = "";
    }
  };
  reader.onerror = function () {
    alert("Ошибка чтения файла на устройстве");
  };
  reader.readAsText(file);
};
