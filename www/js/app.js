let db; // Глобальная переменная для локальной базы данных

document.addEventListener('DOMContentLoaded', async () => {
    const syncBtn = document.getElementById('syncBtn');
    const tokenInput = document.getElementById('monoToken');
    const statusEl = document.getElementById('status');
    const txContainer = document.getElementById('transactions');

    // 1. ИНИЦИАЛИЗАЦИЯ ВСТРОЕННОЙ БАЗЫ INDEXED-DB
    try {
        db = await initDB();
        await loadFromDB(); // Выводим историю при запуске (офлайн)
    } catch (error) {
        console.error("Ошибка БД:", error);
        statusEl.innerText = "Ошибка загрузки локальной базы.";
        statusEl.style.color = '#f44336';
    }

    const savedToken = localStorage.getItem('mono_token');
    if (savedToken) tokenInput.value = savedToken;

    // 2. СИНХРОНИЗАЦИЯ С МОНОБАНКОМ
    syncBtn.addEventListener('click', async () => {
        const token = tokenInput.value.trim();
        if (!token) return;

        localStorage.setItem('mono_token', token);
        statusEl.innerText = 'Скачиваем выписку...';
        statusEl.style.color = '#888';

        try {
            const to = Math.floor(Date.now() / 1000);
            const from = to - (30 * 24 * 60 * 60); 
            const url = `https://api.monobank.ua/personal/statement/0/${from}/${to}`;

            // CapacitorHttp перехватит этот запрос и обойдет CORS
            const response = await fetch(url, { headers: { 'X-Token': token } });
            if (!response.ok) throw new Error('Ошибка API банка');
            
            const data = await response.json();
            statusEl.innerText = 'Сохраняем в телефон...';
            
            // 3. ЗАПИСЬ В БАЗУ ДАННЫХ
            await saveTransactions(data);

            statusEl.innerText = `Успешно! Синхронизировано ${data.length} операций.`;
            statusEl.style.color = '#4caf50';

            await loadFromDB(); // Обновляем экран из базы

        } catch (error) {
            console.error(error);
            statusEl.innerText = 'Ошибка подключения к банку.';
            statusEl.style.color = '#f44336';
        }
    });

    // --- ФУНКЦИИ ДЛЯ РАБОТЫ С INDEXED-DB ---

    function initDB() {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open("ZenLocalDB", 1);
            
            request.onerror = () => reject("Нет доступа к IndexedDB");
            request.onsuccess = (e) => resolve(e.target.result);
            
            // Срабатывает только при первом запуске (создает "таблицу")
            request.onupgradeneeded = (e) => {
                const database = e.target.result;
                if (!database.objectStoreNames.contains('transactions')) {
                    // keyPath 'id' делает ID от банка уникальным ключом
                    database.createObjectStore('transactions', { keyPath: 'id' });
                }
            };
        });
    }

    function saveTransactions(transactions) {
        return new Promise((resolve, reject) => {
            const tx = db.transaction('transactions', 'readwrite');
            const store = tx.objectStore('transactions');
            
            transactions.forEach(t => {
                // put автоматически добавляет новую запись или перезаписывает старую (защита от дублей)
                store.put({
                    id: t.id,
                    bank: 'monobank',
                    amount: t.amount,
                    category: t.mcc ? t.mcc.toString() : '',
                    description: t.description,
                    date: t.time
                });
            });
            
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
        });
    }

    async function loadFromDB() {
        return new Promise((resolve, reject) => {
            const tx = db.transaction('transactions', 'readonly');
            const store = tx.objectStore('transactions');
            const request = store.getAll();

            request.onsuccess = () => {
                txContainer.innerHTML = ''; 
                let records = request.result;

                if (records.length > 0) {
                    // Сортируем по дате и выводим последние 50 операций
                    records.sort((a, b) => b.date - a.date);
                    records = records.slice(0, 50);

                    records.forEach(tx => {
                        const card = document.createElement('div');
                        card.className = 'tx-card';
                        
                        const amount = tx.amount / 100;
                        const amountStr = amount > 0 ? `+${amount} ₴` : `${amount} ₴`;
                        const colorClass = amount > 0 ? 'green' : 'white';
                        
                        const dateObj = new Date(tx.date * 1000);
                        const dateStr = dateObj.toLocaleDateString('ru-RU') + ' ' + dateObj.toLocaleTimeString('ru-RU', {hour: '2-digit', minute:'2-digit'});

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
                    txContainer.innerHTML = '<p style="text-align:center; color:#888;">База пуста. Нажми синхронизацию.</p>';
                }
                resolve();
            };
            request.onerror = () => reject(request.error);
        });
    }
});