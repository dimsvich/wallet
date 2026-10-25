/*
 * Разбор уведомлений Privat24 (пакет ua.privatbank.ap24).
 *
 * Известный формат (многострочный текст):
 *   +1₴ Зарахування переказу. Свічкар В.     <- знак, сумма, валюта, описание
 *   5*58 23:05                               <- маска карты и время операции
 *   Комісія 0.03₴                            <- необязательно
 *   Бал. 78 202.06₴                          <- баланс после операции
 *   Кред. ліміт 90 000₴                      <- необязательно (кредитные карты)
 *
 * Всё нераспознанное попадает в поле extra, исходный текст сохраняется в raw.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.BankNotifyParser = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const PRIVAT_PACKAGE = "ua.privatbank.ap24";

  const NUM = "(\\d[\\d ]*(?:[.,]\\d+)?)";
  const CUR = "(₴|грн|UAH|USD|EUR|PLN|GBP|\\$|€|[A-Z]{3})";

  function toNum(s) {
    return parseFloat(String(s).replace(/\s+/g, "").replace(",", "."));
  }

  function round2(x) {
    return Math.round(x * 100) / 100;
  }

  function normCurrency(c) {
    if (!c) return "UAH";
    if (c === "₴" || /^грн$/i.test(c)) return "UAH";
    if (c === "$") return "USD";
    if (c === "€") return "EUR";
    return String(c).toUpperCase();
  }

  function pad(n) {
    return String(n).padStart(2, "0");
  }

  // Строки текста без пустых, с обычными пробелами вместо неразрывных
  function normalize(text) {
    return String(text || "")
      .replace(/[\u00A0\u202F\u2009]/g, " ")
      .replace(/\r\n?/g, "\n")
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean);
  }

  /**
   * @param {{title?: string, text: string, postTime?: number}} n
   *        postTime: время появления уведомления (мс), нужно, чтобы определить дату
   * @returns {object} { ok: true, ... } или { ok: false, reason, raw }
   */
  function parsePrivatNotification(n) {
    const raw = String((n && n.text) || "");
    const flat = normalize(raw).join("\n");

    const head = flat.match(
      new RegExp("^([+\\-\\u2212\\u2013])\\s*" + NUM + "\\s*" + CUR + "\\s*"),
    );
    if (!head) return { ok: false, reason: "no-amount", raw };

    const sign = head[1] === "+" ? 1 : -1;
    const amount = round2(toNum(head[2]));
    const currency = normCurrency(head[3]);
    const rest = flat.slice(head[0].length);

    const card = rest.match(/(\d+\*+\d+)\s+(\d{1,2}):(\d{2})/);
    if (!card) return { ok: false, reason: "no-card-time", raw };

    const description = rest.slice(0, card.index).replace(/\s+/g, " ").trim();
    const after = rest.slice(card.index + card[0].length);

    // Необязательные поля после строки с картой
    let leftover = after;
    const cutOut = (m) => {
      if (m) leftover = leftover.replace(m[0], "");
      return m;
    };

    const commissionM = cutOut(
      after.match(
        new RegExp("(?:Комісія|Комиссия)\\s*" + NUM + "\\s*" + CUR + "?", "i"),
      ),
    );
    const balanceM = cutOut(
      after.match(
        new RegExp(
          "Бал(?:\\.|анс)?\\s*(-?\\s*\\d[\\d ]*(?:[.,]\\d+)?)\\s*" + CUR + "?",
          "i",
        ),
      ),
    );
    const limitM = cutOut(
      after.match(
        new RegExp(
          "Кред(?:\\.|ит\\.?)?\\s*(?:ліміт|лимит)\\s*" +
            NUM +
            "\\s*" +
            CUR +
            "?",
          "i",
        ),
      ),
    );

    const extra = leftover
      .split("\n")
      .map((s) => s.replace(/\s+/g, " ").trim())
      .filter(Boolean);

    // Дата: из времени уведомления, время суток из текста.
    // Если получилось «из будущего» (операция до полуночи, уведомление после), берём вчера.
    const post = new Date((n && n.postTime) || Date.now());
    const hh = parseInt(card[2], 10);
    const mm = parseInt(card[3], 10);
    const op = new Date(
      post.getFullYear(),
      post.getMonth(),
      post.getDate(),
      hh,
      mm,
      0,
      0,
    );
    if (op.getTime() - post.getTime() > 10 * 60 * 1000)
      op.setDate(op.getDate() - 1);

    const kindM = description.match(/^([^.]+)\.\s*(.*)$/);
    const kind = kindM ? kindM[1].trim() : description;
    const details = kindM ? kindM[2].trim() : "";

    const commission = commissionM ? round2(toNum(commissionM[1])) : 0;
    const balanceAfter = balanceM ? round2(toNum(balanceM[1])) : null;
    const creditLimit = limitM ? round2(toNum(limitM[1])) : null;
    const signedAmount = round2(sign * amount);

    const stamp =
      op.getFullYear() +
      pad(op.getMonth() + 1) +
      pad(op.getDate()) +
      pad(op.getHours()) +
      pad(op.getMinutes());
    const fingerprint = [
      card[1],
      stamp,
      signedAmount.toFixed(2),
      balanceAfter === null ? "" : balanceAfter.toFixed(2),
    ].join("|");

    return {
      ok: true,
      type: sign > 0 ? "income" : "expense",
      amount,
      signedAmount,
      currency,
      description,
      kind,
      details,
      cardMask: card[1],
      opTime: op.getTime(),
      commission,
      balanceAfter,
      creditLimit,
      extra,
      fingerprint,
      raw,
    };
  }

  /**
   * Проверка непрерывности по балансу.
   * Возвращает 0, если предыдущий баланс + сумма - комиссия = баланс после операции.
   * Ненулевое значение значит, что между операциями пропущены уведомления.
   */
  function balanceDelta(prevBalance, parsed) {
    if (
      parsed.balanceAfter === null ||
      prevBalance === null ||
      prevBalance === undefined
    )
      return null;
    const expected = round2(
      prevBalance + parsed.signedAmount - (parsed.commission || 0),
    );
    return round2(parsed.balanceAfter - expected);
  }

  return { PRIVAT_PACKAGE, parsePrivatNotification, balanceDelta };
});
