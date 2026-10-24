let db;

document.addEventListener("DOMContentLoaded", async () => {
  const statusEl = document.getElementById("status");
  const txContainer = document.getElementById("transactions");

  const syncMonoBtn = document.getElementById("syncMonoBtn");
  const monoTokenInput = document.getElementById("monoToken");

  const manualAmountInput = document.getElementById("manualAmount");
  const manualDescInput = document.getElementById("manualDesc");
  const manualTypeSelect = document.getElementById("manualType");
  const addManualBtn = document.getElementById("addManualBtn");

  try {
    db = await initDB();
    await loadFromDB();
  } catch (error) {
    console.error("Ошибка БД:", error);
  }

  if (localStorage.getItem("mono_token"))
    monoTokenInput.value = localStorage.getItem("mono_token");

  // --- РУЧНОЙ ВВОД ---
  addManualBtn.addEventListener("click", async () => {
    const rawAmount = parseFloat(manualAmountInput.value);
    const desc = manualDescInput.value.trim() || "Без описания";
    const type = manualTypeSelect.value;

    if (isNaN(rawAmount) || rawAmount === 0) return;

    let amountInKopecks = Math.round(Math.abs(rawAmount) * 100);
    if (type === "expense") amountInKopecks = -amountInKopecks;

    const newTx = {
      id: "manual_" + Date.now(),
      bank: "manual",
      amount: amountInKopecks,
      category: "Ручной ввод",
      description: desc,
      date: Math.floor(Date.now() / 1000),
    };

    try {
      await saveTransactions([newTx]);
      manualAmountInput.value = "";
      manualDescInput.value = "";
      await loadFromDB();
    } catch (e) {
      console.error(e);
    }
  });

  // --- СИНХРОНИЗАЦИЯ МОНОБАНКА ---
  syncMonoBtn.addEventListener("click", async () => {
    const token = monoTokenInput.value.trim();
    if (!token) return;
    localStorage.setItem("mono_token", token);
    if (statusEl) statusEl.innerText = "Скачиваем выписку Mono...";

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

      const formattedTxs = data.map((t) => ({
        id: t.id,
        bank: "mono",
        amount: t.amount,
        category: t.mcc ? t.mcc.toString() : "",
        description: t.description,
        date: t.time,
      }));

      await saveTransactions(formattedTxs);
      if (statusEl)
        statusEl.innerText = `Успешно загружено операций: ${data.length}`;
      await loadFromDB();
    } catch (error) {
      console.error(error);
      if (statusEl) statusEl.innerText = "Ошибка подключения к Monobank.";
    }
  });

  // --- БАЗА ДАННЫХ И РАСЧЕТ БАЛАНСОВ ---
  function initDB() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open("ZenLocalDB", 1);
      request.onerror = () => reject("Нет доступа к IndexedDB");
      request.onsuccess = (e) => resolve(e.target.result);
      request.onupgradeneeded = (e) => {
        const database = e.target.result;
        if (!database.objectStoreNames.contains("transactions")) {
          database.createObjectStore("transactions", { keyPath: "id" });
        }
      };
    });
  }

  function saveTransactions(transactions) {
    return new Promise((resolve, reject) => {
      const tx = db.transaction("transactions", "readwrite");
      const store = tx.objectStore("transactions");
      transactions.forEach((t) => store.put(t));
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  async function loadFromDB() {
    return new Promise((resolve, reject) => {
      const tx = db.transaction("transactions", "readonly");
      const store = tx.objectStore("transactions");
      const request = store.getAll();

      request.onsuccess = () => {
        txContainer.innerHTML = "";
        let records = request.result;

        let totalBalance = 0;
        let monoBalance = 0;
        let manualBalance = 0;

        records.forEach((tx) => {
          totalBalance += tx.amount;
          if (tx.bank === "mono") monoBalance += tx.amount;
          else manualBalance += tx.amount;
        });

        // Обновляем цифры в шапке и на карточках счетов
        document.getElementById("totalBalance").innerText =
          (totalBalance / 100).toFixed(2) + " ₴";
        document.getElementById("monoBalance").innerText =
          (monoBalance / 100).toFixed(2) + " ₴";
        document.getElementById("manualBalance").innerText =
          (manualBalance / 100).toFixed(2) + " ₴";

        if (localStorage.getItem("mono_token")) {
          document.getElementById("monoSub").innerText = "Синхронизировано";
        }

        if (records.length > 0) {
          records.sort((a, b) => b.date - a.date);
          records = records.slice(0, 100);

          records.forEach((tx) => {
            const card = document.createElement("div");
            card.className = `tx-card`;

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
                                <span class="tx-date">${dateStr}</span>
                            </div>
                            <div class="tx-amount ${colorClass}">${amountStr}</div>
                        `;
            txContainer.appendChild(card);
          });
        } else {
          txContainer.innerHTML =
            '<p style="text-align:center; color:#888;">Операций пока нет.</p>';
        }
        resolve();
      };
      request.onerror = () => reject(request.error);
    });
  }
});
