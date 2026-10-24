document.addEventListener('DOMContentLoaded', () => {
    const statusEl = document.getElementById('status');
    
    // В будущем здесь будет логика подключения SQLite и банковских API
    setTimeout(() => {
        statusEl.innerText = "Готово к работе. Ждем подключения API.";
        statusEl.style.color = "#4caf50";
    }, 1500);
});