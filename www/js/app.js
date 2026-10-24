document.addEventListener("DOMContentLoaded", () => {
  const syncBtn = document.getElementById("syncBtn");
  const tokenInput = document.getElementById("monoToken");
  const statusEl = document.getElementById("status");
  const txContainer = document.getElementById("transactions");

  // Восстанавливаем токен из памяти, если уже вводили
  const savedToken = localStorage.getItem("mono_token");
  if (savedToken) {
    tokenInput.value = savedToken;
  }

  syncBtn.addEventListener("click", async () => {
    const token = tokenInput.value.trim();
    if (!token) {
      statusEl.innerText = "Сначала введи токен!";
      statusEl.style.color = "#f44336";
      return;
    }

    // Сохраняем токен в локальное хранилище телефона
    localStorage.setItem("mono_token", token);
    statusEl.innerText = "Связываемся с банком...";
    statusEl.style.color = "#888";
    txContainer.innerHTML = ""; // Очищаем старый список

    try {
      // Вычисляем даты в формате UNIX времени (в секундах)
      const to = Math.floor(Date.now() / 1000);
      const from = to - 30 * 24 * 60 * 60; // минус 30 дней

      // Параметр '0' означает основную гривневую карту
      const url = `https://api.monobank.ua/personal/statement/0/${from}/${to}`;

      const response = await fetch(url, {
        method: "GET",
        headers: {
          "X-Token": token,
        },
      });

      if (!response.ok) {
        throw new Error(`Ошибка ответа банка: ${response.status}`);
      }

      const data = await response.json();

      statusEl.innerText = `Успешно! Загружено ${data.length} операций.`;
      statusEl.style.color = "#4caf50";

      // Отрисовываем последние 15 операций
      data.slice(0, 15).forEach((tx) => {
        const card = document.createElement("div");
        card.className = "tx-card";

        // Сумма в Монобанке отдается в копейках. Делим на 100.
        const amount = tx.amount / 100;
        const amountStr = amount > 0 ? `+${amount} ₴` : `${amount} ₴`;
        const colorClass = amount > 0 ? "green" : "white";

        // Конвертируем UNIX время в понятную дату
        const dateObj = new Date(tx.time * 1000);
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
    } catch (error) {
      console.error(error);
      statusEl.innerText = "Ошибка подключения. Проверь интернет или токен.";
      statusEl.style.color = "#f44336";
    }
  });
});
