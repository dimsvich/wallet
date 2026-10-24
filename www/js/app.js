let db; // Глобальная переменная для нашей базы данных

document.addEventListener("DOMContentLoaded", async () => {
  const syncBtn = document.getElementById("syncBtn");
  const tokenInput = document.getElementById("monoToken");
  const statusEl = document.getElementById("status");
  const txContainer = document.getElementById("transactions");

  // 1. ПОДКЛЮЧЕНИЕ К БАЗЕ ПРИ ЗАПУСКЕ
  try {
    const sqlite = Capacitor.Plugins.CapacitorSQLite;
    db = await sqlite.createConnection({
      database: "zenlocal",
      version: 1,
      encrypted: false,
      mode: "no-encryption",
    });
    await db.open();

    // Создаем таблицу, если это первый запуск
    await db.execute({
      statements: `
            CREATE TABLE IF NOT EXISTS transactions (
                id TEXT PRIMARY KEY NOT NULL,
                bank TEXT NOT NULL,
                amount INTEGER NOT NULL,
                category TEXT,
                description TEXT,
                date INTEGER NOT NULL
            );
        `,
    });

    // Сразу выводим на экран то, что уже сохранено в памяти телефона
    await loadFromDB();
  } catch (error) {
    console.error("Ошибка БД:", error);
    statusEl.innerText = "Ошибка загрузки локальной базы.";
  }

  // Восстанавливаем токен из настроек
  const savedToken = localStorage.getItem("mono_token");
  if (savedToken) tokenInput.value = savedToken;

  // 2. СИНХРОНИЗАЦИЯ С МОНОБАНКОМ
  syncBtn.addEventListener("click", async () => {
    const token = tokenInput.value.trim();
    if (!token) return;

    localStorage.setItem("mono_token", token);
    statusEl.innerText = "Скачиваем выписку...";
    statusEl.style.color = "#888";

    try {
      const to = Math.floor(Date.now() / 1000);
      const from = to - 30 * 24 * 60 * 60;
      const url = `https://api.monobank.ua/personal/statement/0/${from}/${to}`;

      const response = await fetch(url, { headers: { "X-Token": token } });
      if (!response.ok) throw new Error("Ошибка API банка");

      const data = await response.json();
      statusEl.innerText = "Сохраняем в телефон...";

      // 3. ЗАПИСЬ В SQLITE
      for (let tx of data) {
        // Если транзакция с таким id уже есть, база просто проигнорирует команду
        await db.run(
          `INSERT OR IGNORE INTO transactions (id, bank, amount, category, description, date) 
                     VALUES (?, ?, ?, ?, ?, ?)`,
          [
            tx.id,
            "monobank",
            tx.amount,
            tx.mcc.toString(),
            tx.description,
            tx.time,
          ],
        );
      }

      statusEl.innerText = `Успешно! Синхронизировано ${data.length} операций.`;
      statusEl.style.color = "#4caf50";

      // Обновляем интерфейс — теперь читаем свежие данные прямо из локальной базы
      await loadFromDB();
    } catch (error) {
      console.error(error);
      statusEl.innerText = "Ошибка подключения к банку.";
      statusEl.style.color = "#f44336";
    }
  });

  // 4. ФУНКЦИЯ ЧТЕНИЯ ИЗ БАЗЫ И ОТРИСОВКИ
  async function loadFromDB() {
    try {
      // Вытягиваем последние 50 операций (сортировка по убыванию даты)
      const result = await db.query(
        `SELECT * FROM transactions ORDER BY date DESC LIMIT 50`,
      );

      txContainer.innerHTML = "";

      if (result.values && result.values.length > 0) {
        result.values.forEach((tx) => {
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
                            <span class="tx-date">${dateStr}</span>
                        </div>
                        <div class="tx-amount ${colorClass}">${amountStr}</div>
                    `;
          txContainer.appendChild(card);
        });
      } else {
        txContainer.innerHTML =
          '<p style="text-align:center; color:#888;">База пуста. Нажми кнопку синхронизации.</p>';
      }
    } catch (error) {
      console.error("Ошибка чтения:", error);
    }
  }
});
