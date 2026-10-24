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

    // Выводим курсы в интерфейс
    const rateUsdEl = document.getElementById("rateUsd");
    const rateEurEl = document.getElementById("rateEur");

    if (rateUsdEl) rateUsdEl.innerText = `${exchangeRates.USD.toFixed(2)} ₴`;
    if (rateEurEl) rateEurEl.innerText = `${exchangeRates.EUR.toFixed(2)} ₴`;
  } catch (e) {
    console.log("Не удалось подгрузить курсы, используем дефолтные");
    document.getElementById("rateUsd").innerText =
      `${exchangeRates.USD.toFixed(2)} ₴ (дефолт)`;
    document.getElementById("rateEur").innerText =
      `${exchangeRates.EUR.toFixed(2)} ₴ (дефолт)`;
  }
}
