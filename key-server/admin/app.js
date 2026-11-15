"use strict";

// Админка открыта по /jobshturman/_/admin/, сервер ключей — /jobshturman/keys/ (см. key-server/API.md).
const API_BASE = "../../keys/v1/admin";
const TOKEN_KEY = "hrs-keys-admin-token";
const root = document.getElementById("app");
const dialog = document.getElementById("dialog");
const filters = { query: "", status: "all", segment: "all", agency: "all", reason: "all" };
const data = { keys: [], tariffs: [], tariff: null, agencies: [], agency: null, who: null, stats: null, current: null, role: null, draft: null, route: null, file: null };
const statusNames = { active: "Активен", expiring: "Истекает", expired: "Истёк", revoked: "Заблокирован" };
const stateNames = { ...statusNames, archived: "В архиве" };
const archiveReasonNames = { expired: "Истёк срок", revoked: "Был заблокирован", unneeded: "Больше не нужен", other: "Другая причина" };
let pendingArchive = null;  // причина между первым и вторым подтверждением архива
const reasonNames = { refund: "Возврат оплаты", violation: "Нарушение условий", reissue: "Перевыпуск ключа", other: "Другое" };
const deniedNames = { revoked: "ключ заблокирован", expired: "срок истёк", device_limit: "превышен лимит устройств", export: "просил выгрузить всю методику", archived: "ключ в архиве" };
// Методика: главный промпт — файл внутри пакета, агент читает его первым (key-server/API.md, «Редактор методики»).
const GENESIS = "agent/genesis.md";
const MANIFEST = "library_manifest.json";
const roleNames = { admin: "Администратор", methodologist: "Автор методики", agency: "Агентство" };
const segmentNames = { agency: "Агентство", private: "Частный", tester: "Тестировщик" };
// Разделы ключей: «Частные» и «Тестировщики» — тот же список с заданным сегментом.
const SEGMENT_PAGES = { private: "private", testers: "tester" };
// Выбор нескольких ключей для действий пакетом: перенос в раздел или агентство, архив.
const selection = { on: false, ids: new Set() };
const channelNames = { test: "Тестовые ключи", stable: "Все пользователи" };
const changeNames = { added: "Добавлен", removed: "Удалён", changed: "Изменён" };
const progressNames = {
  intake: "Анкета заполнена", facts: "Собраны факты", facts_confirmed: "Факты подтверждены", resume: "Есть резюме",
  vacancies: "Найдены вакансии", scored: "Вакансии оценены", decided: "Решения по вакансиям", sent: "Отклики отправлены", funnel: "Есть ответы работодателей",
};
let fullKey = null;
let batchFile = null;  // файл с ключами пакета: только до закрытия окна
let noticeTimer;
let renderSeq = 0;
let shellShown = false;

// Оболочка админки появляется в DOM только после входа; до входа на странице одна карточка.
// Автор методики видит только методику, главный промпт и версии; администратор — всё.
const NAV = {
  dashboard: ['<path d="M4 13h6V4H4zM14 20h6v-9h-6zM14 4v4h6V4zM4 20h6v-3H4z"/>', "Сводка"],
  agencies: ['<path d="M3 21h18M5 21V7l7-4 7 4v14M9 21v-6h6v6M9 10h.01M15 10h.01"/>', "Агентства"],
  private: ['<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>', "Частные"],
  testers: ['<path d="M9 3h6M10 3v6L4 19a1.5 1.5 0 0 0 1.3 2h13.4a1.5 1.5 0 0 0 1.3-2L14 9V3"/>', "Тестировщики"],
  agency: ['<path d="M3 21h18M5 21V7l7-4 7 4v14M9 21v-6h6v6"/>', "Ключи агентства"],
  archive: ['<rect x="3" y="4" width="18" height="5" rx="1"/><path d="M5 9v10a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V9M10 13h4"/>', "Архив"],
  keys: ['<circle cx="8" cy="15" r="5"/><path d="m11.5 11.5 8-8L22 6l-2 2-2-2-2 2 2 2-3 3"/>', 'Все ключи <span class="nav-count" id="nav-count"></span>'],
  tariff: ['<rect x="3" y="4" width="18" height="16" rx="3"/><path d="M3 9h18M7 15h4"/>', "Тариф"],
  methodology: ['<path d="M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2V5Z"/><path d="M19 19v2H6M8 7h7M8 11h5"/>', "Методика"],
  genesis: ['<circle cx="12" cy="12" r="9"/><path d="m15.5 8.5-2 5-5 2 2-5 5-2Z"/>', "Главный промпт"],
  bundles: ['<path d="M12 3 3 7.5l9 4.5 9-4.5L12 3Z"/><path d="m3 12 9 4.5 9-4.5M3 16.5 12 21l9-4.5"/>', "Версии"],
};

function shell(role) {
  const pages = role === "admin" ? ["dashboard", "keys", "agencies", "private", "testers", "archive", "tariff", "methodology", "genesis", "bundles"]
    : role === "agency" ? ["agency"] : ["methodology", "genesis", "bundles"];
  const home = { admin: "dashboard", agency: "agency" }[role] || "methodology";
  const subtitle = { admin: "Сервер ключей", agency: escapeHTML(data.who?.agency?.name || "Кабинет агентства") }[role] || "Редактор методики";
  return `
  <a class="skip-link" href="#main">Перейти к содержимому</a>
  <aside class="sidebar">
    <a class="brand" href="#${home}" aria-label="JobShturman — ${{ admin: "сводка", agency: "ключи агентства" }[role] || "методика"}">
      <span class="brand-mark" aria-hidden="true">H</span>
      <span><strong>JobShturman</strong><small>${subtitle}</small></span>
    </a>
    <div class="nav-label">${roleNames[role] || "Управление"}</div>
    <nav aria-label="Главная навигация">
      ${pages.map((page) => `<a href="#${page}" data-nav="${page}">
        <svg viewBox="0 0 24 24" aria-hidden="true">${NAV[page][0]}</svg>
        ${NAV[page][1]}
      </a>`).join("")}
    </nav>
    <div class="sidebar-foot"><button class="button" data-action="logout" type="button">Выйти</button><p>Токен хранится только в этой вкладке.</p></div>
  </aside>
  <div class="workspace">
    <header class="topbar"><span>${{ admin: "Администрирование", agency: "Кабинет агентства" }[role] || "Редактор"} <span class="divider">/</span> <strong id="breadcrumb">Ключи</strong></span><span class="topbar-note">${{ admin: "Ручная выдача после оплаты", agency: "Только просмотр" }[role] || "Каждое сохранение — новая версия черновика"}</span></header>
    <main id="main" tabindex="-1"></main>
    <footer class="page-footer">JobShturman <span>${{ admin: "Только ключи, устройства и номера заказов", agency: "Ключи вашего агентства" }[role] || "Пользователи получают методику только после публикации"}</span></footer>
  </div>`;
}

class AuthError extends Error {}

const escapeHTML = (value) => String(value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));
// Без « г.» в конце, чтобы после даты не получалось «г..».
const date = (value) => value ? new Date(value).toLocaleDateString("ru-RU", { day: "2-digit", month: "short", year: "numeric" }).replace(/\s?г\.$/, "") : "—";
const dateTime = (value) => value ? new Date(value).toLocaleString("ru-RU", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "—";
const tariffTitle = (id) => data.tariffs.find((tariff) => tariff.id === id)?.title || id;
const keyLabel = (key) => `JBS-${key.key_hint}…`;
const agencyName = (id) => (id && data.agencies.find((agency) => agency.id === id)?.name) || "";
// Почему ключ в архиве и каким он был до переноса: истёк, заблокирован (с причиной), действовал.
function archiveInfo(key) {
  if (key.state !== "archived") return "";
  const before = key.archived_state === "revoked" && key.revoke_reason ? `заблокирован · ${reasonNames[key.revoke_reason] || key.revoke_reason}`
    : (stateNames[key.archived_state] || "").toLocaleLowerCase("ru");
  return `<span class="small">${escapeHTML(archiveReasonNames[key.archive_reason] || "Причина не указана")}</span>${key.archive_note ? `<span class="small muted">${escapeHTML(key.archive_note)}</span>` : ""}${before ? `<span class="small muted">До архива: ${escapeHTML(before)}</span>` : ""}`;
}

// Кому выдан ключ: агентство, частный покупатель или тестировщик, и для кого.
const ownerOf = (key) => {
  const who = key.segment === "agency" ? (agencyName(key.agency_id) || "Агентство") : segmentNames[key.segment] || "Частный";
  return `${escapeHTML(who)}${key.note ? `<br><span class="small muted">${escapeHTML(key.note)}</span>` : ""}`;
};
const rub = (value) => `${Number(value).toLocaleString("ru-RU")} ₽`;
const priceOf = (tariff) => tariff.price_rub_from === tariff.price_rub_to ? rub(tariff.price_rub_from) : `${rub(tariff.price_rub_from)}–${rub(tariff.price_rub_to)}`;
const months = (n) => `${n} ${n % 10 === 1 && n % 100 !== 11 ? "месяц" : [2, 3, 4].includes(n % 10) && ![12, 13, 14].includes(n % 100) ? "месяца" : "месяцев"}`;

// --- токен и запросы ---

function readToken() {
  try { return window.sessionStorage.getItem(TOKEN_KEY) || ""; } catch { return ""; }
}

function writeToken(token) {
  try {
    if (token) window.sessionStorage.setItem(TOKEN_KEY, token);
    else window.sessionStorage.removeItem(TOKEN_KEY);
  } catch { /* Без sessionStorage вход не переживёт перезагрузку. */ }
}

function apiUrl(path) {
  return new URL(`${API_BASE}${path}`, window.location.href).toString();
}

function errorText(body, status) {
  if (typeof body?.message === "string") return body.message;
  if (Array.isArray(body?.detail)) return `Проверьте поля: ${body.detail.map((item) => item.loc?.at(-1)).filter(Boolean).join(", ")}.`;
  return `Сервер ключей ответил ошибкой ${status}.`;
}

async function api(path, { method = "GET", json, form } = {}) {
  const token = readToken();
  if (!token) throw new AuthError("Введите токен администратора.");
  const headers = { Authorization: `Bearer ${token}` };
  let body;
  if (json !== undefined) { headers["Content-Type"] = "application/json"; body = JSON.stringify(json); }
  else if (form) body = form;
  let response;
  try {
    response = await fetch(apiUrl(path), { method, headers, body, cache: "no-store" });
  } catch {
    throw new Error("Сервер ключей недоступен. Проверьте соединение и повторите.");
  }
  const result = await response.json().catch(() => null);
  if (response.status === 401 || response.status === 403) throw new AuthError(`${errorText(result, response.status).replace(/\.$/, "")}. Войдите заново.`);
  if (!response.ok) throw Object.assign(new Error(errorText(result, response.status)), { status: response.status, code: result?.error });
  return result;
}

function logout(message = "", isError = true) {
  writeToken("");
  if (window.location.hash) window.history.replaceState(null, "", window.location.pathname + window.location.search);
  Object.assign(data, { keys: [], stats: null, current: null, role: null, who: null, agencies: [], agency: null, draft: null, route: null, file: null });
  if (dialog.open) dialog.close();
  renderLogin(message, isError);
}

// --- модель ---

function addMonths(value, count) {
  const result = new Date(value);
  const originalDay = result.getDate();
  result.setDate(1);
  result.setMonth(result.getMonth() + count);
  const lastDay = new Date(result.getFullYear(), result.getMonth() + 1, 0).getDate();
  result.setDate(Math.min(originalDay, lastDay));
  return result;
}

function inputDate(value) {
  const d = new Date(value);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// Конец выбранного дня по местному времени браузера, без долей секунды.
function endOfDay(until) {
  return new Date(`${until}T23:59:59`);
}

function filteredKeys() {
  const query = filters.query.trim().toLocaleLowerCase("ru");
  return data.keys.filter((key) =>
    (!query || [key.key_hint, key.order_ref || "", key.id, key.note || "", agencyName(key.agency_id)].some((text) => text.toLocaleLowerCase("ru").includes(query))) &&
    (filters.segment === "all" || key.segment === filters.segment) &&
    (filters.agency === "all" || key.agency_id === filters.agency) &&
    (filters.reason === "all" || key.state !== "archived" || key.archive_reason === filters.reason));
}

function eventText(event) {
  const detail = event.detail || "";
  if (event.kind === "activate") return "Вход с устройства";
  if (event.kind === "check") return "Проверка ключа";
  if (event.kind === "download") return detail ? `Скачан пакет v${detail}` : "Скачан пакет";
  if (event.kind === "denied") return `Отказ: ${deniedNames[detail] || detail}`;
  if (detail === "issue") return "Ключ выдан";
  if (detail === "restore") return "Ключ разблокирован";
  if (detail === "reset devices") return "Сброшены все устройства";
  if (detail.startsWith("extend to ")) return `Ключ продлён до ${dateTime(detail.slice(10))}`;
  if (detail.startsWith("revoke ")) return `Ключ заблокирован · ${reasonNames[detail.slice(7)] || detail.slice(7)}`;
  if (detail.startsWith("unbind device ")) return `Устройство отвязано · ${detail.slice(14)}`;
  if (detail === "archive" || detail.startsWith("archive ")) {
    const reason = archiveReasonNames[detail.slice(8)];
    return `Перенесён в архив: ключ отключён${reason ? ` · ${reason}` : ""}`;
  }
  if (detail === "unarchive") return "Возвращён из архива";
  if (detail.startsWith("segment ")) {
    const [, segment, agency] = detail.split(" ");
    return `Перенесён: ${segment === "agency" ? agencyName(agency) || "агентство" : segmentNames[segment] || segment}`;
  }
  return detail || event.kind;
}

// Тариф один, в админке меняется только его цена.
function tariffPrice(tariff, fields) {
  const raw = String(fields.get("price") || "").replace(/[\s\u00a0]/g, "");
  const price = Number(raw);
  if (!raw || !Number.isSafeInteger(price) || price < 1 || price > 10000000) throw new Error("Цена — целое число рублей от 1 до 10\u00a0000\u00a0000.");
  return price === tariff.price_rub_from && price === tariff.price_rub_to ? null : price;
}

// --- разметка ---

function icon(name) {
  const paths = {
    plus: '<path d="M12 5v14M5 12h14"/>',
    search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 4 4"/>',
    info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7h.01"/>',
    back: '<path d="m10 5-7 7 7 7M3 12h18"/>',
    download: '<path d="M12 4v12M7 11l5 5 5-5M4 20h16"/>',
    close: '<path d="m6 6 12 12M6 18 18 6"/>',
    check: '<path d="m5 12 4 4L19 6"/>',
    copy: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3"/>',
    upload: '<path d="M12 16V4M7 9l5-5 5 5M4 20h16"/>',
  };
  return `<svg viewBox="0 0 24 24" aria-hidden="true">${paths[name]}</svg>`;
}

function badge(key) {
  return `<span class="badge ${escapeHTML(key.state)}"><span class="dot" aria-hidden="true"></span>${stateNames[key.state] || escapeHTML(key.state)}</span>`;
}

function notice(text) {
  const element = document.getElementById("notice");
  clearTimeout(noticeTimer);
  element.textContent = text;
  element.hidden = false;
  noticeTimer = setTimeout(() => { element.hidden = true; }, 4500);
}

const mainEl = () => document.getElementById("main");

function setNav(page) {
  if (!shellShown) {
    root.innerHTML = shell(data.role);
    shellShown = true;
    document.title = { admin: "Сервер ключей · JobShturman", agency: "Кабинет агентства · JobShturman" }[data.role] || "Методика · JobShturman";
  }
  document.getElementById("breadcrumb").textContent = { dashboard: "Сводка", agencies: "Агентства", agency: "Агентство", private: "Частные ключи", testers: "Тестировщики", archive: "Архив", tariff: "Тариф", bundles: "Версии", key: "Карточка ключа", keys: "Все ключи", methodology: "Методика", genesis: "Главный промпт", edit: "Файл методики" }[page];
  const current = { key: "keys", edit: "methodology", agency: data.role === "agency" ? "agency" : "agencies" }[page] || page;
  document.querySelectorAll("[data-nav]").forEach((link) => {
    if (link.dataset.nav === current) link.setAttribute("aria-current", "page");
    else link.removeAttribute("aria-current");
  });
}

function renderLogin(message = "", isError = true) {
  renderSeq++;
  shellShown = false;
  document.title = "Вход";
  root.innerHTML = `<main class="login-screen"><form id="login-form" class="panel login" autocomplete="off">
    <h1>Вход</h1>
    <div class="field"><label for="token">Токен</label><input id="token" name="token" type="password" required spellcheck="false" autocomplete="off"></div>
    ${message && !isError ? `<p class="muted" role="status">${escapeHTML(message)}</p>` : ""}
    <p class="form-error" role="alert" ${message && isError ? "" : "hidden"}>${isError ? escapeHTML(message) : ""}</p>
    <button type="submit" class="button primary">Войти</button></form></main>`;
}

function renderFailure(message) {
  mainEl().innerHTML = `<div class="empty"><h1>Не удалось загрузить</h1><p class="muted">${escapeHTML(message)}</p><button class="button" data-action="reload">Повторить</button></div>`;
}

// segment: null — все ключи; "private" или "tester" — раздел «Частные» или «Тестировщики».
function renderKeys(segment = null) {
  const own = segment && segment !== "archived" ? data.keys.filter((key) => key.segment === segment) : data.keys;
  const stats = segment ? countKeys(own) : data.stats;
  const by = stats.by_state || {};
  const head = { private: ["Частные ключи", "Ключи частных покупателей: без агентства и не для тестирования."],
    tester: ["Тестировщики", "Ключи тех, кто проверяет продукт. Тестовые версии методики включаются в карточке ключа."],
    archived: ["Архив", "Отключённые ключи: у пользователей они не работают и не попадают в статистику. Можно вернуть."] }[segment]
    || ["Все ключи", "Выдача и управление доступом к методике: агентства, частные покупатели, тестировщики."];
  mainEl().innerHTML = `
    <div class="page-heading"><div><h1>${head[0]}</h1><p>${head[1]}</p></div>
      ${segment === "archived" ? "" : `<button class="button primary" data-action="issue" data-segment="${segment || "private"}">${icon("plus")}Выдать ключ</button>`}</div>
    ${segment === "archived" ? "" : `    <div class="stats" aria-label="Сводка по всем ключам">
      <div class="stat"><span class="stat-top"><span class="dot success-text" aria-hidden="true"></span>Активных</span><strong>${(by.active || 0) + (by.expiring || 0)}</strong><small class="muted">Из них истекают за сутки: ${by.expiring || 0}</small></div>
      <div class="stat"><span class="stat-top"><span class="dot warning-text" aria-hidden="true"></span>Истекли</span><strong>${by.expired || 0}</strong><small class="muted">Можно продлить</small></div>
      <div class="stat"><span class="stat-top"><span class="dot danger-text" aria-hidden="true"></span>Заблокировано</span><strong>${by.revoked || 0}</strong><small class="muted">Доступ приостановлен</small></div>
      <div class="stat"><span class="stat-top"><span class="dot" aria-hidden="true"></span>Устройств</span><strong>${stats.devices}</strong><small class="muted">Методика ${stats.latest_bundle ? `v${escapeHTML(stats.latest_bundle)}` : "не опубликована"}</small></div>
    </div>`}
    <div class="filters${segment ? "" : " filters-wide"}">
      <div class="search">${icon("search")}<input id="search" type="search" value="${escapeHTML(filters.query)}" placeholder="Ключ, заказ, агентство или получатель" aria-label="Поиск по началу ключа, номеру заказа, агентству или получателю"></div>
      ${segment ? "" : `<select id="segment-filter" aria-label="Кому выдан"><option value="all">Все: агентства, частные, тестировщики</option>${Object.entries({ agency: "Агентства", private: "Частные", tester: "Тестировщики" }).map(([id, title]) => `<option value="${id}" ${filters.segment === id ? "selected" : ""}>${title}</option>`).join("")}</select>
      <select id="agency-filter" aria-label="Агентство"><option value="all">Все агентства</option>${data.agencies.map((agency) => `<option value="${escapeHTML(agency.id)}" ${filters.agency === agency.id ? "selected" : ""}>${escapeHTML(agency.name)}</option>`).join("")}</select>`}
      ${segment === "archived" ? `<select id="reason-filter" aria-label="Причина архивации"><option value="all">Все причины</option>${Object.entries(archiveReasonNames).map(([id, title]) => `<option value="${id}" ${filters.reason === id ? "selected" : ""}>${title}</option>`).join("")}</select>` : `<select id="status-filter" aria-label="Фильтр по статусу"><option value="all">Все статусы</option>${Object.entries(statusNames).map(([id, title]) => `<option value="${id}" ${filters.status === id ? "selected" : ""}>${title}</option>`).join("")}</select>`}
    </div>
    <div class="result-line"><span id="result-count" role="status" aria-live="polite"></span><span class="actions"><button class="text-button" id="reset-filters" data-action="reset">Сбросить фильтры</button><button class="button" data-action="select-toggle" aria-pressed="${selection.on}">${selection.on ? "Готово" : "Выбрать"}</button></span></div>
    <div class="bulk-bar" id="bulk-bar" ${selection.on ? "" : "hidden"}></div>
    <div class="table-wrap" role="region" aria-label="Список ключей, прокручивается по горизонтали" tabindex="0">
      <table><thead><tr>${selection.on ? '<th scope="col" class="check-cell"><input type="checkbox" id="select-all" aria-label="Выбрать все показанные ключи"></th>' : ""}<th scope="col">Ключ</th><th scope="col">Кому</th><th scope="col">Статус</th><th scope="col">Срок до</th><th scope="col">Устройства</th><th scope="col">Последний вход</th><th scope="col">Номер заказа</th></tr></thead><tbody id="key-rows"></tbody></table>
      <div id="empty" class="empty" hidden><h3>Ключи не найдены</h3><p class="muted">Измените запрос или сбросьте фильтры.</p></div>
    </div>
    <div class="info-note">${icon("info")}<p>Ключи выдаются вручную после оплаты. За сутки до окончания агент предупреждает о продлении. Сервер хранит только хэш ключа, устройства, номер заказа и получателя.</p></div>`;
  updateList();
}

function updateList() {
  const visible = filteredKeys();
  document.getElementById("key-rows").innerHTML = visible.map((key) => `<tr${selection.ids.has(key.id) ? ' class="selected"' : ""}>
    ${selection.on ? `<td class="check-cell"><input type="checkbox" data-select="${escapeHTML(key.id)}" aria-label="Выбрать ключ ${escapeHTML(keyLabel(key))}" ${selection.ids.has(key.id) ? "checked" : ""}></td>` : ""}
    <td><a class="key-link" href="#key-${escapeHTML(key.id)}" aria-label="Открыть ключ ${escapeHTML(keyLabel(key))}">${escapeHTML(keyLabel(key))}</a></td>
    <td>${ownerOf(key)}</td><td><div class="state-cell">${badge(key)}${archiveInfo(key)}</div></td><td>${date(key.expires_at)}</td>
    <td>${key.devices.length}<span class="muted"> / ${key.device_limit}</span></td><td class="muted small">${dateTime(key.last_seen)}</td><td class="mono muted">${escapeHTML(key.order_ref || "—")}</td>
  </tr>`).join("");
  document.getElementById("result-count").textContent = `Показано ${visible.length} из ${data.keys.length} ключей`;
  document.getElementById("empty").hidden = visible.length !== 0;
  document.getElementById("reset-filters").hidden = !filters.query && filters.status === "all" && filters.segment === "all" && filters.agency === "all" && filters.reason === "all";
  updateBulk();
}

// Панель действий над выбранными ключами. В архиве — только возврат.
function updateBulk() {
  const bar = document.getElementById("bulk-bar");
  if (!bar) return;
  const visible = filteredKeys();
  // Выбор держится только за показанными ключами: скрытые фильтром не попадут в действие незаметно.
  [...selection.ids].forEach((id) => { if (!visible.some((key) => key.id === id)) selection.ids.delete(id); });
  const count = selection.ids.size;
  const all = document.getElementById("select-all");
  if (all) { all.checked = count > 0 && count === visible.length; all.indeterminate = count > 0 && count < visible.length; }
  bar.hidden = !selection.on;
  if (!selection.on) return;
  const archive = lastPage === "archive";
  const targets = [["private", "Частные"], ["tester", "Тестировщики"], ...data.agencies.filter((agency) => !agency.archived_at).map((agency) => [`agency:${agency.id}`, `Агентство: ${agency.name}`])];
  bar.innerHTML = `<strong>Выбрано: ${count}</strong>
    ${archive ? `<button class="button primary" data-action="bulk-unarchive" ${count ? "" : "disabled"}>Вернуть из архива</button>`
      : `<select id="bulk-target" aria-label="Куда перенести">${targets.map(([value, title]) => `<option value="${escapeHTML(value)}">${escapeHTML(title)}</option>`).join("")}</select>
      <button class="button primary" data-action="bulk-move" ${count ? "" : "disabled"}>Перенести</button>
      <button class="button danger" data-action="bulk-archive" ${count ? "" : "disabled"}>В архив</button>`}
    <button class="text-button" data-action="select-none" ${count ? "" : "disabled"}>Снять выбор</button>`;
}

function renderDetail(key, events) {
  const reason = escapeHTML(reasonNames[key.revoke_reason] || key.revoke_reason || "");
  const facts = [
    ["Кому", key.segment === "agency" && key.agency_id ? `<a href="#agency-${escapeHTML(key.agency_id)}">${escapeHTML(agencyName(key.agency_id) || "Агентство")}</a>${key.note ? `<br><span class="small muted">${escapeHTML(key.note)}</span>` : ""}` : ownerOf(key)],
    ["Идентификатор", `<code>${escapeHTML(key.id)}</code>`], ["Тариф", escapeHTML(tariffTitle(key.tariff_id))],
    ["Дата выдачи", dateTime(key.issued_at)], ["Срок до", dateTime(key.expires_at)],
    ["Лимит устройств", `${key.devices.length} из ${key.device_limit}`], ["Последний вход", dateTime(key.last_seen)],
    ["Скачиваний пакета", key.downloads], ["Отказов в доступе", key.denied],
    ["Номер заказа", key.order_ref ? `<code>${escapeHTML(key.order_ref)}</code>` : "—"],
    ["Версии методики", key.channel === "test" ? "Тестовые: получает новую версию первым" : "Обычные"],
    ["Версия у пользователя", key.pinned_version ? `<span class="mono">v${escapeHTML(key.pinned_version)}</span>` : "Ещё не скачана"],
  ];
  if (key.revoked_at) facts.push(["Заблокирован", `${dateTime(key.revoked_at)} · ${reason}`]);
  if (key.archived_at) facts.unshift(["В архиве", `${dateTime(key.archived_at)}<div class="state-cell">${archiveInfo(key)}</div>`]);
  const revoked = key.state === "revoked";
  mainEl().innerHTML = `
    ${key.archived_at ? `<a class="back-link" href="#archive">${icon("back")}Архив</a>` : `<a class="back-link" href="#keys">${icon("back")}Все ключи</a>`}
    <div class="page-heading detail-heading"><div><h1 class="mono">${escapeHTML(keyLabel(key))}</h1>${badge(key)}</div>
      <div class="actions">${key.archived_at ? '<button class="button primary" data-action="unarchive-one">Вернуть из архива</button>' : `<button class="button" data-action="move">Кому выдан</button><button class="button" data-action="toggle-channel">${key.channel === "test" ? "Вернуть в обычные" : "Сделать тестовым"}</button><button class="button" data-action="extend">Продлить</button><button class="button ${revoked ? "" : "danger"}" data-action="${revoked ? "restore" : "revoke"}">${revoked ? "Разблокировать" : "Заблокировать"}</button>`}</div></div>
    ${key.archived_at ? '<p class="warning-note">Ключ в архиве: у пользователя он не работает. После возврата заработает снова, если не истёк срок и нет блокировки.</p>' : ""}
    ${revoked ? `<p class="warning-note blocked-note"><strong>Доступ заблокирован.</strong> Причина: ${reason}</p>` : key.state === "expired" ? '<p class="warning-note">Срок ключа истёк. Доступ к методике отключён; наработки пользователя остаются в его локальном хранилище.</p>' : key.state === "expiring" ? '<p class="warning-note">До окончания меньше суток. Агент предупреждает пользователя и даёт ссылку на продление.</p>' : ""}
    <div class="detail-grid"><div class="stack">
      <section class="panel"><h2>Детали ключа</h2><dl class="facts">${facts.map(([title, value]) => `<dt>${title}</dt><dd>${value}</dd>`).join("")}</dl></section>
      <section class="panel"><div class="panel-heading"><h2>Устройства <span class="muted">${key.devices.length} / ${key.device_limit}</span></h2>${key.devices.length ? '<button class="button" data-action="reset-devices">Сбросить все</button>' : ""}</div>
        ${key.devices.length ? key.devices.map((device) => `<div class="device"><div class="device-info"><code>${escapeHTML(device.install)}</code><p class="small muted">Первый вход ${dateTime(device.first_seen)}<br>Последний вход ${dateTime(device.last_seen)}</p></div><button class="button" data-action="detach" data-device="${escapeHTML(device.install)}" aria-label="Отвязать устройство ${escapeHTML(device.install)}">Отвязать</button></div>`).join("") : '<p class="muted">Активированных устройств пока нет.</p>'}
        <p class="small muted">Начало хэша случайного ID установки. Отвязка освобождает место для нового устройства.</p>
      </section>
    </div><section class="panel"><h2>Журнал событий</h2>${events.length ? `<ol class="timeline">${events.map((event) => `<li>${escapeHTML(eventText(event))}<time datetime="${escapeHTML(event.at)}">${dateTime(event.at)}</time></li>`).join("")}</ol>` : '<p class="muted">Событий пока нет.</p>'}</section></div>`;
}

// --- сводка и агентства ---

function countKeys(keys) {
  const by = {};
  keys.forEach((key) => { by[key.state] = (by[key.state] || 0) + 1; });
  const devices = keys.reduce((sum, key) => sum + (Array.isArray(key.devices) ? key.devices.length : key.devices || 0), 0);
  return { keys: keys.length, by_state: by, devices, activated: keys.filter((key) => (Array.isArray(key.devices) ? key.devices.length : key.devices) > 0).length, latest_bundle: data.stats?.latest_bundle };
}

const activeOf = (by) => (by.active || 0) + (by.expiring || 0);

function statTiles(stats, label) {
  const by = stats.by_state || {};
  return `<div class="stats" aria-label="${escapeHTML(label)}">
    <div class="stat"><span class="stat-top"><span class="dot" aria-hidden="true"></span>Выдано</span><strong>${stats.keys}</strong><small class="muted">Истекли: ${by.expired || 0} · заблокированы: ${by.revoked || 0}</small></div>
    <div class="stat"><span class="stat-top"><span class="dot success-text" aria-hidden="true"></span>Действуют</span><strong>${activeOf(by)}</strong><small class="muted">Истекают за сутки: ${by.expiring || 0}</small></div>
    <div class="stat"><span class="stat-top"><span class="dot warning-text" aria-hidden="true"></span>Активированы</span><strong>${stats.activated || 0}</strong><small class="muted">Ключ введён хотя бы на одном устройстве</small></div>
    <div class="stat"><span class="stat-top"><span class="dot" aria-hidden="true"></span>Устройств</span><strong>${stats.devices}</strong><small class="muted">${stats.last_seen ? `Последний вход ${dateTime(stats.last_seen)}` : stats.latest_bundle ? `Методика v${escapeHTML(stats.latest_bundle)}` : "Входов пока нет"}</small></div>
  </div>`;
}

function agencyRows(agencies) {
  if (!agencies.length) return '<div class="empty"><h3>Агентств пока нет</h3><p class="muted">Заведите агентство, чтобы выдавать ему ключи пакетами.</p></div>';
  return `<div class="table-wrap" role="region" aria-label="Агентства, прокручивается по горизонтали" tabindex="0"><table><thead><tr>
    <th scope="col">Агентство</th><th scope="col">Контакт</th><th scope="col">Выдано</th><th scope="col">Действуют</th><th scope="col">Активированы</th><th scope="col">Последний вход</th></tr></thead><tbody>
    ${agencies.map((agency) => `<tr><td><a class="row-link" href="#agency-${escapeHTML(agency.id)}">${escapeHTML(agency.name)}</a>${agency.archived_at ? ' <span class="badge neutral">В архиве</span>' : ""}</td>
      <td class="small">${escapeHTML(agency.contact_name || "—")}${agency.phone ? `<br><span class="muted">${escapeHTML(agency.phone)}</span>` : ""}</td>
      <td>${agency.stats.keys}</td><td>${agency.stats.active}</td><td>${agency.stats.activated}</td><td class="muted small">${dateTime(agency.stats.last_seen)}</td></tr>`).join("")}
  </tbody></table></div>`;
}

function renderDashboard() {
  const stats = data.stats;
  const seg = stats.by_segment || {};
  const card = (id, title, href, hint) => {
    const s = seg[id] || { keys: 0, active: 0, activated: 0 };
    return `<a class="panel segment-card" href="#${href}"><span class="stat-top">${title}</span><strong>${s.keys}</strong><small class="muted">действуют ${s.active} · активированы ${s.activated}</small><small class="muted">${hint}</small></a>`;
  };
  mainEl().innerHTML = `
    <div class="page-heading"><div><h1>Сводка</h1><p>Все выданные ключи: агентства, частные покупатели и тестировщики.</p></div>
      <div class="actions"><button class="button" data-action="agency-new">${icon("plus")}Новое агентство</button><button class="button primary" data-action="issue" data-segment="private">${icon("plus")}Выдать ключ</button></div></div>
    ${statTiles(stats, "Сводка по всем ключам")}
    <div class="segment-grid">
      ${card("agency", "Агентства", "agencies", `${(stats.agencies || []).length} ${plural((stats.agencies || []).length, "агентство", "агентства", "агентств")}`)}
      ${card("private", "Частные", "private", "Без агентства")}
      ${card("tester", "Тестировщики", "testers", "Проверяют продукт")}
    </div>
    <section class="section-block"><div class="panel-heading"><h2>Агентства</h2><a class="text-button" href="#agencies">Все агентства</a></div>${agencyRows(stats.agencies || [])}</section>`;
}

function renderAgencies() {
  mainEl().innerHTML = `
    <div class="page-heading"><div><h1>Агентства</h1><p>Партнёры, которым ключи выдаются пакетами. Статистика — по каждому агентству.</p></div>
      <button class="button primary" data-action="agency-new">${icon("plus")}Новое агентство</button></div>
    ${agencyRows(data.agencies)}`;
}

function renderAgency(agency, keys) {
  const admin = data.role === "admin";
  const contacts = [["Контактное лицо", escapeHTML(agency.contact_name || "—")],
    ["Телефон", agency.phone ? `<a href="tel:${escapeHTML(agency.phone.replace(/[^\d+]/g, ""))}">${escapeHTML(agency.phone)}</a>` : "—"],
    ["Почта", agency.email ? `<a href="mailto:${escapeHTML(agency.email)}">${escapeHTML(agency.email)}</a>` : "—"]];
  if (admin) contacts.push(["Заметка", escapeHTML(agency.note || "—")], ["Заведено", date(agency.created_at)]);
  const rows = keys.map((key) => {
    const devices = Array.isArray(key.devices) ? key.devices.length : key.devices;
    const label = escapeHTML(keyLabel(key));
    return `<tr><td>${admin ? `<a class="key-link" href="#key-${escapeHTML(key.id)}">${label}</a>` : `<span class="mono">${label}</span>`}</td>
      <td class="small">${escapeHTML(key.note || "—")}</td><td>${badge(key)}</td><td>${date(key.issued_at)}</td><td>${date(key.expires_at)}</td>
      <td>${devices}<span class="muted"> / ${key.device_limit}</span></td><td class="muted small">${dateTime(key.last_seen)}</td></tr>`;
  }).join("");
  const tokens = admin ? `<section class="panel"><div class="panel-heading"><h2>Вход для агентства</h2><button class="button" data-action="token-new" ${agency.archived_at ? "disabled" : ""}>${icon("plus")}Выдать вход</button></div>
    ${agency.tokens.length ? agency.tokens.map((token) => `<div class="device"><div class="device-info"><strong>${escapeHTML(token.label || "Без подписи")}</strong>
      <p class="small muted">Выдан ${dateTime(token.created_at)} · ${token.revoked_at ? `отозван ${dateTime(token.revoked_at)}` : token.last_used_at ? `последний вход ${dateTime(token.last_used_at)}` : "ещё не входили"}</p></div>
      ${token.revoked_at ? '<span class="badge revoked">Отозван</span>' : `<button class="button" data-action="token-revoke" data-token="${escapeHTML(token.id)}">Отозвать</button>`}</div>`).join("") : '<p class="muted">Входов нет. Агентство увидит только свои ключи и не сможет ничего изменить.</p>'}</section>` : "";
  const batches = agency.batches.length ? `<ol class="timeline">${agency.batches.map((batch) => `<li>${batch.count} ${plural(batch.count, "ключ", "ключа", "ключей")} до ${date(batch.expires_at)}${batch.recipient ? ` · ${escapeHTML(batch.recipient)}` : ""}<time datetime="${escapeHTML(batch.issued_at)}">${dateTime(batch.issued_at)}</time></li>`).join("")}</ol>` : '<p class="muted">Пакетов пока нет.</p>';
  mainEl().innerHTML = `
    ${admin ? `<a class="back-link" href="#agencies">${icon("back")}Все агентства</a>` : ""}
    <div class="page-heading detail-heading"><div><h1>${escapeHTML(agency.name)}</h1>${agency.archived_at ? '<span class="badge neutral">В архиве</span>' : ""}</div>
      <div class="actions"><button class="button" data-action="agency-export">${icon("download")}Список ключей (.md)</button>
      ${admin ? `<button class="button" data-action="agency-edit">Изменить</button><button class="button primary" data-action="batch" ${agency.archived_at ? "disabled" : ""}>${icon("plus")}Выдать пакет ключей</button>` : ""}</div></div>
    ${statTiles(agency.stats, `Сводка по ключам агентства ${agency.name}`)}
    <div class="detail-grid"><div class="stack">
      <section class="panel"><h2>Контакты</h2><dl class="facts">${contacts.map(([title, value]) => `<dt>${title}</dt><dd>${value}</dd>`).join("")}</dl></section>
      ${tokens}
    </div><section class="panel"><h2>Пакеты</h2>${batches}</section></div>
    <section class="section-block"><h2>Ключи <span class="muted">${keys.length}</span></h2>
    ${keys.length ? `<div class="table-wrap" role="region" aria-label="Ключи агентства, прокручивается по горизонтали" tabindex="0"><table><thead><tr><th scope="col">Ключ</th><th scope="col">Получатель</th><th scope="col">Статус</th><th scope="col">Выдан</th><th scope="col">Срок до</th><th scope="col">Устройства</th><th scope="col">Последний вход</th></tr></thead><tbody>${rows}</tbody></table></div>` : '<p class="muted">Ключей пока нет.</p>'}
    <p class="small muted">${admin ? "Полные ключи видны только в файле, который скачивается сразу после выдачи пакета. В списке — начало ключа." : "Полные ключи — в файлах, которые вы получили вместе с пакетами. В списке — начало ключа."}</p></section>`;
}

const plural = (n, one, few, many) => (n % 10 === 1 && n % 100 !== 11 ? one : [2, 3, 4].includes(n % 10) && ![12, 13, 14].includes(n % 100) ? few : many);

function saveText(text, filename) {
  const url = URL.createObjectURL(new Blob([text], { type: "text/markdown;charset=utf-8" }));
  const link = Object.assign(document.createElement("a"), { href: url, download: filename });
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function renderTariff() {
  const tariff = data.tariff;
  mainEl().innerHTML = `<div class="page-heading"><div><h1>Тариф</h1><p>Один тариф. Здесь меняется только цена: она сразу появляется на\u00a0сайте.</p></div></div>
    <section class="panel tariff tariff-single"><h2>${escapeHTML(tariff.title)}</h2><p class="price">${priceOf(tariff)}</p>
      <dl class="facts"><dt>Срок ключа</dt><dd>${months(tariff.months)}</dd><dt>Лимит устройств</dt><dd>до\u00a0${tariff.device_limit}</dd></dl>
      <form class="tariff-form" data-id="${escapeHTML(tariff.id)}">
        <div class="field"><label for="price">Цена, ₽</label><input id="price" name="price" type="number" min="1" max="10000000" step="1" required inputmode="numeric" value="${tariff.price_rub_from}"></div>
        <p class="form-error" role="alert" hidden></p>
        <div class="dialog-actions"><button type="submit" class="button primary">Сохранить цену</button></div>
      </form></section>
    <div class="info-note">${icon("info")}<p>Название, срок и лимит устройств заданы в\u00a0программе. Новая цена действует для новых продаж; выданные ключи сохраняют свои условия.</p></div>`;
}

function renderBundles(bundles) {
  const upload = data.role === "admin" ? `<section class="panel upload"><h2>Загрузить готовый пакет</h2>
      <form id="bundle-form"><div class="field"><label for="bundle-file">Пакет zip</label><input id="bundle-file" name="file" type="file" accept=".zip,application/zip" required><small>Собирается командой <code>hrs-keys bundle build</code>; версия берётся из bundle.json внутри. Пакет сразу становится доступным всем. Обычный путь — публикация из раздела «Методика».</small></div>
        <div class="field"><label for="bundle-note">Что изменилось</label><textarea id="bundle-note" name="note" maxlength="1000" required placeholder="Например: новый этап про переговоры о зарплате, поправлены шаблоны писем"></textarea><small>Обязательно. Агент покажет это людям, когда предложит обновиться.</small></div>
    <label class="check"><input type="checkbox" name="important"> Важное: поставить без вопроса</label><small class="muted">Для исправлений, без которых работать нельзя. Агент сам перейдёт на эту версию и объяснит человеку, что изменилось.</small>
        <p class="form-error" role="alert" hidden></p>
        <div class="dialog-actions"><button type="submit" class="button primary">${icon("upload")}Опубликовать</button></div></form></section>` : "";
  const target = (bundle, channel) => bundle.channels.includes(channel) ? "" : `<button class="button" data-action="set-current" data-version="${escapeHTML(bundle.version)}" data-channel="${channel}">${channel === "test" ? "Тестовым" : "Всем"}</button>`;
  mainEl().innerHTML = `<div class="page-heading"><div><h1>Версии методики</h1><p>Версия с меткой «Тестовые ключи» предлагается тестовым ключам, с меткой «Все пользователи» — остальным. Люди переходят на неё, когда согласятся; «Важное» ставится само. Откат — сделать доступной прежнюю версию: ключи с более новой вернутся на неё.</p></div></div>
    ${upload}
    <div class="table-wrap" role="region" aria-label="Версии методики, прокручивается по горизонтали" tabindex="0">
      <table class="bundles"><thead><tr><th scope="col">Версия</th><th scope="col">Опубликована</th><th scope="col">Что изменилось</th><th scope="col">Ключей на версии</th><th scope="col">Размер</th><th scope="col">Сделать доступной</th></tr></thead><tbody>${bundles.map((bundle) => `<tr>
        <td><span class="mono">v${escapeHTML(bundle.version)}</span>${bundle.channels.map((channel) => ` <span class="badge ${channel === "stable" ? "active" : "expiring"}">${channelNames[channel]}</span>`).join("")}${bundle.min_hrs ? `<br><small class="muted">Нужен hrs ${escapeHTML(bundle.min_hrs)} или новее</small>` : ""}</td>
        <td>${dateTime(bundle.published_at)}</td><td class="small">${bundle.important ? '<span class="badge expiring">Важное</span> ' : ""}${escapeHTML(bundle.note || (bundle.revision ? `Черновик, версия ${bundle.revision}` : "—"))}</td><td>${bundle.keys ?? 0}</td>
        <td>${(bundle.size / 1024).toLocaleString("ru-RU", { maximumFractionDigits: 1 })} КБ</td><td><div class="actions">${target(bundle, "test")}${target(bundle, "stable")}</div></td></tr>`).join("")}</tbody></table>
      ${bundles.length ? "" : '<div class="empty"><h3>Версий пока нет</h3><p class="muted">Опубликуйте методику из раздела «Методика».</p></div>'}
    </div>
    <div class="info-note">${icon("info")}<p>«Всем» делает версию доступной и тестовым ключам. Старые установки hrs (до 0.4.0) не спрашивают и получают версию сразу; если она им не подходит — последнюю подходящую и подсказку обновить программу.</p></div>`;
}

// --- методика: черновик, маршрут, файлы, история ---

const stageNumber = (stages, index) => stages[index].status === "off" ? null : stages.slice(0, index).filter((stage) => stage.status !== "off").length;

function routeCopy(draft) {
  return {
    version: draft.manifest_version || "",
    steps: draft.steps.map((step) => ({ ...step })),
    stages: draft.stages.map(({ files, position, number, ...stage }) => ({ ...stage })),
    dirty: false,
  };
}

function checkPanel(check) {
  if (!check) return "";
  const item = (entry) => `<li><code>${escapeHTML(entry.code)}</code>${entry.stage ? ` · ${escapeHTML(entry.stage)}` : ""} — ${escapeHTML(entry.detail)}</li>`;
  return `<section class="panel" id="check-panel"><h2>Проверка ${check.ok ? '<span class="badge active">Можно публиковать</span>' : '<span class="badge revoked">Есть ошибки</span>'}</h2>
    ${check.errors.length ? `<p class="small">Ошибки не дают опубликовать:</p><ul class="issues">${check.errors.map(item).join("")}</ul>` : ""}
    ${check.findings.length ? `<details><summary class="small">Замечания: ${check.findings.length}. Публикации не мешают</summary><ul class="issues">${check.findings.map(item).join("")}</ul></details>` : ""}
    ${check.ok && !check.findings.length ? '<p class="muted">Ошибок и замечаний нет.</p>' : ""}</section>`;
}

const fileSize = (file) => `${(file.size / 1024).toLocaleString("ru-RU", { maximumFractionDigits: 1 })} КБ`;
const fileItem = (file, dir = "") => `<li><a class="mono small" href="#edit/${encodeURIComponent(file.path)}">${escapeHTML(dir && file.path.startsWith(`${dir}/`) ? file.path.slice(dir.length + 1) : file.path)}</a> <span class="muted small">${fileSize(file)}</span></li>`;

function stageFiles(stage) {
  const paths = data.draft.stages.find((saved) => saved.id === stage.id)?.files || [];
  return data.draft.files.filter((file) => paths.includes(file.path));
}

function routePanel(open = new Set()) {
  const route = data.route;
  const option = (value, title, selected) => `<option value="${escapeHTML(value)}" ${value === selected ? "selected" : ""}>${escapeHTML(title)}</option>`;
  const stepTitle = (id) => route.steps.find((step) => step.id === id)?.title || id || "Без шага";
  const rows = route.stages.map((stage, i) => {
    const number = stageNumber(route.stages, i);
    const files = stageFiles(stage);
    const off = stage.status === "off";
    return `<li class="stage${off ? " off" : ""}" data-stage="${i}" data-id="${escapeHTML(stage.id)}"><details ${open.has(stage.id) ? "open" : ""}>
      <summary><span class="stage-number mono">${number === null ? "—" : number}</span><span class="stage-title">${escapeHTML(stage.title || stage.id)}</span>
        <span class="stage-meta"><span class="badge">${escapeHTML(stepTitle(stage.step))}</span>${off ? '<span class="badge revoked">Выключен</span>' : ""}<span class="muted small">${files.length ? `Файлов: ${files.length}` : "Новый этап"}</span></span></summary>
      <div class="stage-body">
        <div class="stage-fields">
          <div class="field"><label for="stage-title-${i}">Название</label><input id="stage-title-${i}" data-field="title" value="${escapeHTML(stage.title || "")}" maxlength="120"></div>
          <div class="field"><label for="stage-step-${i}">Шаг</label><select id="stage-step-${i}" data-field="step">${route.steps.map((step) => option(step.id, step.title, stage.step)).join("")}${route.steps.some((step) => step.id === stage.step) ? "" : option(stage.step || "", `Нет шага «${stage.step || ""}»`, stage.step || "")}</select></div>
          <div class="field"><label for="stage-progress-${i}">Чем отмечается прогресс</label><select id="stage-progress-${i}" data-field="progress">${option("", "—", stage.progress || "")}${Object.entries(progressNames).map(([id, title]) => option(id, title, stage.progress || "")).join("")}</select></div>
          <label class="check"><input type="checkbox" data-field="on" ${off ? "" : "checked"}> Этап включён</label>
        </div>
        <div class="stage-files"><h3>Файлы этапа <span class="muted small mono">${escapeHTML(stage.dir || "")}</span></h3>
          ${files.length ? `<ul>${files.map((file) => fileItem(file, stage.dir)).join("")}</ul>` : '<p class="muted small">Файлы появятся после сохранения маршрута.</p>'}
          <button class="button" data-action="file-new" data-dir="${escapeHTML(stage.dir || "")}">${icon("plus")}Файл в этап</button></div>
        <div class="actions stage-actions"><button class="button" data-action="stage-up" ${i ? "" : "disabled"}>↑ Выше</button><button class="button" data-action="stage-down" ${i < route.stages.length - 1 ? "" : "disabled"}>↓ Ниже</button><button class="button danger" data-action="stage-remove">Убрать из маршрута</button></div>
      </div></details></li>`;
  }).join("");
  const steps = route.steps.map((step, i) => `<li data-step="${i}"><input data-field="step-title" value="${escapeHTML(step.title || "")}" aria-label="Название шага ${escapeHTML(step.id)}" maxlength="80"><code>${escapeHTML(step.id)}</code>
    <span class="muted small">Этапов: ${route.stages.filter((stage) => stage.step === step.id).length}</span>
    <button class="button ghost" data-action="step-remove" aria-label="Убрать шаг ${escapeHTML(step.id)}" ${route.stages.some((stage) => stage.step === step.id) ? "disabled" : ""}>${icon("close")}</button></li>`).join("");
  return `<div class="panel-heading"><h2>Маршрут <span class="muted">включено этапов: ${route.stages.filter((stage) => stage.status !== "off").length}</span></h2>
      <div class="actions"><button class="button" data-action="step-add">${icon("plus")}Шаг</button><button class="button" data-action="stage-add">${icon("plus")}Этап</button></div></div>
    <p class="small muted">Агент идёт по включённым этапам сверху вниз; номер этапа — его место в маршруте. Откройте этап, чтобы изменить его или открыть его файлы. Выключенный или убранный этап остаётся в файлах черновика.</p>
    <details class="steps-box"><summary>Шаги — крупные группы этапов, их видит пользователь: ${route.steps.map((step) => escapeHTML(step.title || step.id)).join(" · ")}</summary><ol class="steps">${steps}</ol></details>
    <ol class="stages">${rows}</ol>
    <div class="form-row route-save"><div class="field"><label for="route-version">Версия методики</label><input id="route-version" data-field="version" value="${escapeHTML(route.version)}" maxlength="40" placeholder="0.5.0"></div>
      <div class="dialog-actions"><span class="small muted" role="status">${route.dirty ? "Есть несохранённые изменения" : ""}</span><button class="button" data-action="route-reset" ${route.dirty ? "" : "disabled"}>Отменить</button><button class="button primary" data-action="route-save" ${route.dirty ? "" : "disabled"}>Сохранить маршрут</button></div></div>`;
}

function updateRoute() {
  const panel = document.getElementById("route-panel");
  const open = new Set([...(panel.querySelectorAll?.("li.stage") || [])].filter((item) => item.querySelector("details")?.open).map((item) => item.dataset.id));
  panel.innerHTML = routePanel(open);
}

function commonFiles(draft) {
  const staged = new Set(draft.stages.flatMap((stage) => stage.files));
  const main = draft.files.filter((file) => file.path === GENESIS || file.path === MANIFEST || file.path.startsWith("agent/"));
  return [["Главный промпт и маршрут", main], ["Не относятся к этапам", draft.files.filter((file) => !staged.has(file.path) && !main.includes(file))]].filter(([, files]) => files.length);
}

function renderMethodology(draft, revisions) {
  data.draft = draft;
  data.route = routeCopy(draft);
  const head = draft.head;
  const current = Object.entries(draft.current || {}).map(([channel, version]) => `${channelNames[channel]}: <span class="mono">v${escapeHTML(version)}</span>`).join(" · ");
  const publish = `<button class="button" data-action="publish" data-channel="test">Опубликовать тестовым</button><button class="button primary" data-action="publish" data-channel="stable">Опубликовать всем</button>`;
  mainEl().innerHTML = `<div class="page-heading"><div><h1>Методика</h1><p>${head ? `Черновик: версия ${head.id} от ${dateTime(head.at)}, ${head.files} файлов.` : "Черновик пуст."} ${current ? `Сейчас у пользователей — ${current}.` : "Пользователи пока ничего не получили."}</p></div>
      ${head ? `<div class="actions">${publish}</div>` : ""}</div>
    ${head ? "" : `<div class="info-note">${icon("info")}<p>Начните с загрузки библиотеки (zip) ниже или возьмите опубликованную версию. Старая библиотека с папками stage-00…25 подходит: маршрут и главный промпт добавятся сами.</p></div>`}
    ${checkPanel(draft.check)}
    ${head ? `<section class="panel" id="route-panel">${routePanel()}</section>` : ""}
    ${head ? `<section class="panel"><div class="panel-heading"><h2>Общие файлы</h2><div class="actions"><button class="button" data-action="file-new">${icon("plus")}Новый файл</button></div></div>
      <p class="small muted">Файлы этапов открываются из маршрута выше.</p>
      ${commonFiles(draft).map(([title, files]) => `<details class="files" open><summary>${escapeHTML(title)} <span class="muted small">${files.length}</span></summary><ul>${files.map((file) => fileItem(file)).join("")}</ul></details>`).join("")}</section>` : ""}
    <section class="panel upload"><h2>Загрузить</h2>
      <form id="draft-upload-form"><div class="field"><label for="draft-file">Файл или архив zip</label><input id="draft-file" name="file" type="file" required><small>Архив zip целиком заменяет черновик: прежний останется в истории. Отдельный файл добавляется или заменяет файл с тем же путём.</small></div>
        <div class="field"><label for="draft-path">Путь для отдельного файла</label><input id="draft-path" name="path" placeholder="skills/salary-talk/references/примеры.md" maxlength="300" spellcheck="false"><small>Пусто — файл ляжет в корень под своим именем.</small></div>
        <p class="form-error" role="alert" hidden></p>
        <div class="dialog-actions"><button type="button" class="button" data-action="import-current">Взять опубликованную версию</button>${head ? '<button type="button" class="button" data-action="export">Скачать черновик</button>' : ""}<button type="submit" class="button primary">${icon("upload")}Загрузить</button></div></form></section>
    ${revisions.length ? `<section class="panel"><h2>История черновика</h2><ol class="timeline revisions">${revisions.map((rev, i) => `<li><span><strong>Версия ${rev.id}</strong> · ${escapeHTML(rev.message)} <span class="muted small">${escapeHTML(roleNames[rev.by] || rev.by)}, файлов: ${rev.files}</span></span>
      <span class="actions"><time datetime="${escapeHTML(rev.at)}">${dateTime(rev.at)}</time><button class="button ghost" data-action="diff" data-rev="${rev.id}">Изменения</button>${i ? `<button class="button ghost" data-action="restore-rev" data-rev="${rev.id}">Вернуть</button>` : ""}</span></li>`).join("")}</ol></section>` : ""}`;
}

function renderFile(file, { genesis = false } = {}) {
  data.file = file;
  const fixed = file.path === GENESIS || file.path === MANIFEST;
  const heading = genesis
    ? `<div class="page-heading"><div><h1>Главный промпт</h1><p>Правила, по которым агент (Claude Code, Codex и другие) ведёт кандидата через все этапы. Агент читает их первыми; они главнее текста навыка в установке. К пользователям попадают после публикации.</p></div>
        <div class="actions"><button class="button" data-action="publish" data-channel="test">Опубликовать тестовым</button><button class="button primary" data-action="publish" data-channel="stable">Опубликовать всем</button></div></div>`
    : `<a class="back-link" href="#methodology">${icon("back")}Методика</a>
      <div class="page-heading detail-heading"><div><h1 class="mono">${escapeHTML(file.path)}</h1>${file.isNew ? '<span class="badge expiring">Новый файл</span>' : ""}</div></div>`;
  mainEl().innerHTML = `${heading}
    <form id="file-form" class="panel editor-form">
      <div class="field"><label for="file-text">${genesis ? `<code>${GENESIS}</code>` : "Текст"}${file.isNew ? "" : ` <span class="muted small">${(file.size / 1024).toLocaleString("ru-RU", { maximumFractionDigits: 1 })} КБ</span>`}</label><textarea id="file-text" name="text" class="editor" spellcheck="false"></textarea></div>
      <div class="field"><label for="file-message">Что изменилось</label><input id="file-message" name="message" maxlength="200" placeholder="Необязательно: попадёт в историю"></div>
      <p class="form-error" role="alert" hidden></p>
      <div class="dialog-actions">${file.isNew || fixed ? "" : '<button type="button" class="button danger" data-action="file-delete">Удалить файл</button>'}<button type="submit" class="button primary">Сохранить</button></div>
    </form>
    <div class="info-note">${icon("info")}<p>Сохранение создаёт новую версию черновика; прежнюю можно вернуть в истории раздела «Методика». Если файл успели изменить в другой вкладке, сохранение не перезапишет чужую правку.</p></div>`;
  document.getElementById("file-text").value = file.text;
}

function renderNoGenesis() {
  mainEl().innerHTML = `<div class="empty"><h1>Главного промпта пока нет</h1><p class="muted">Он появится, когда в черновик загрузят библиотеку методики.</p><a class="button" href="#methodology">Открыть методику</a></div>`;
}

// Построчное сравнение для окна «Изменения»; большие файлы показываются целиком до и после.
function lineDiff(before, after) {
  const a = (before ?? "").split("\n");
  const b = (after ?? "").split("\n");
  if (a.length * b.length > 4_000_000) return [...a.map((line) => ["-", line]), ...b.map((line) => ["+", line])];
  const lcs = Array.from({ length: a.length + 1 }, () => new Uint32Array(b.length + 1));
  for (let i = a.length - 1; i >= 0; i--) for (let j = b.length - 1; j >= 0; j--) lcs[i][j] = a[i] === b[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
  const out = [];
  let i = 0;
  let j = 0;
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i] === b[j]) { out.push([" ", a[i]]); i++; j++; }
    else if (j < b.length && (i === a.length || lcs[i][j + 1] > lcs[i + 1][j])) out.push(["+", b[j++]]);
    else out.push(["-", a[i++]]);
  }
  // Неизменённые строки сворачиваются: остаются по три вокруг правок, пропуск отмечен «…».
  const near = out.map((_, k) => out.slice(Math.max(0, k - 3), k + 4).some(([mark]) => mark !== " "));
  return out.flatMap((line, k) => near[k] ? [line] : near[k - 1] || k === 0 ? [[" ", "…"]] : []);
}

function showDiff(revision, changes) {
  const body = changes.length ? changes.map((change) => `<details class="diff-file" ${changes.length < 4 ? "open" : ""}><summary><span class="badge ${change.change === "removed" ? "revoked" : change.change === "added" ? "active" : "neutral"}">${changeNames[change.change]}</span> <span class="mono small">${escapeHTML(change.path)}</span></summary>
    ${"after" in change ? `<pre class="diff">${lineDiff(change.before, change.after).map(([mark, line]) => `<span class="${mark === "+" ? "add" : mark === "-" ? "del" : ""}">${mark} ${escapeHTML(line)}</span>`).join("\n")}</pre>` : '<p class="small muted">Двоичный файл.</p>'}</details>`).join("") : '<p class="muted">Файлы не менялись.</p>';
  openDialog(`Изменения в версии ${revision}`, "По сравнению с предыдущей версией черновика.", `<div class="diff-list">${body}</div><div class="dialog-actions"><button class="button" data-action="close">Закрыть</button></div>`);
}

function showPublish(channel) {
  const check = data.draft?.check;
  openDialog(channel === "test" ? "Опубликовать для тестовых ключей" : "Опубликовать для всех", channel === "test"
    ? "Версию предложат только тестовым ключам. Остальные остаются на своей."
    : "Версию предложат всем: агент покажет, что изменилось, и спросит «Обновить?». Каждый остаётся на своей версии, пока не согласится. Откатить можно в разделе «Версии».", `<form id="publish-form" data-channel="${channel}">
    ${check && !check.ok ? '<p class="warning-note">В проверке есть ошибки: сервер не опубликует черновик, пока их не исправят.</p>' : ""}
    <div class="field"><label for="publish-note">Что изменилось</label><textarea id="publish-note" name="note" maxlength="1000" required placeholder="Например: новый этап про переговоры о зарплате, поправлены шаблоны писем"></textarea><small>Обязательно. Агент покажет это людям, когда предложит обновиться.</small></div>
    <label class="check"><input type="checkbox" name="important"> Важное: поставить без вопроса</label><small class="muted">Для исправлений, без которых работать нельзя. Агент сам перейдёт на эту версию и объяснит человеку, что изменилось.</small>
    ${formActions("Опубликовать")}</form>`);
}

function showStageAdd() {
  const steps = data.route.steps;
  if (!steps.length) { notice("Сначала добавьте шаг."); return; }
  openDialog("Новый этап", "Этап встанет в конец маршрута; перенесите его стрелками. Сервер создаст для него SKILL.md и процедуру по шаблону.", `<form id="stage-form">
    <div class="field"><label for="stage-title">Название</label><input id="stage-title" name="title" maxlength="120" required autofocus></div>
    <div class="field"><label for="stage-id">Папка (латиница, цифры, дефис)</label><input id="stage-id" name="code" maxlength="63" required pattern="[a-z0-9][a-z0-9\\-]*" placeholder="salary-talk" spellcheck="false"><small>Агент и hrs узнают этап по ней; после сохранения не меняется.</small></div>
    <div class="field"><label for="stage-step">Шаг</label><select id="stage-step" name="step">${steps.map((step) => `<option value="${escapeHTML(step.id)}">${escapeHTML(step.title)}</option>`).join("")}</select></div>
    ${formActions("Добавить")}</form>`);
}

function showStepAdd() {
  openDialog("Новый шаг", "Шаг — крупная группа этапов, которую видит пользователь.", `<form id="step-form">
    <div class="field"><label for="step-title">Название</label><input id="step-title" name="title" maxlength="80" required autofocus></div>
    <div class="field"><label for="step-id">Код (латиница, цифры, дефис)</label><input id="step-id" name="code" maxlength="63" required pattern="[a-z0-9][a-z0-9\\-]*" placeholder="interviews" spellcheck="false"></div>
    ${formActions("Добавить")}</form>`);
}

function showFileNew(dir = "") {
  openDialog("Новый файл", dir ? "Файл появится в папке этапа. Допишите имя файла." : "Путь внутри методики, например папка этапа и имя файла.", `<form id="file-new-form">
    <div class="field"><label for="new-path">Путь</label><input id="new-path" name="path" maxlength="300" required value="${dir ? escapeHTML(`${dir}/references/`) : ""}" placeholder="skills/salary-talk/references/примеры.md" spellcheck="false" autofocus></div>
    ${formActions("Открыть редактор")}</form>`);
}

function showRestore(revision) {
  openDialog(`Вернуть версию ${revision}`, "Черновик станет таким, как в этой версии. Это новая версия: текущую тоже можно будет вернуть.", `<form id="restore-form" data-rev="${revision}">${formActions("Вернуть", true)}</form>`);
}

function showFileDelete(file) {
  openDialog("Удалить файл", `${escapeHTML(file.path)} пропадёт из черновика. Вернуть можно из истории.`, `<form id="file-delete-form">${formActions("Удалить", true)}</form>`);
}

const ID_RE = /^[a-z0-9][a-z0-9-]{0,62}$/;

function addStage(fields) {
  const id = String(fields.get("code") || "").trim();
  const title = String(fields.get("title") || "").trim();
  if (!ID_RE.test(id)) throw new Error("Папка: латинские строчные буквы, цифры и дефис.");
  if (data.route.stages.some((stage) => stage.id === id)) throw new Error(`Этап «${id}» уже есть.`);
  if (!title) throw new Error("Укажите название этапа.");
  data.route.stages.push({ id, title, step: fields.get("step"), tools: [] });
  data.route.dirty = true;
}

function addStep(fields) {
  const id = String(fields.get("code") || "").trim();
  const title = String(fields.get("title") || "").trim();
  if (!ID_RE.test(id)) throw new Error("Код: латинские строчные буквы, цифры и дефис.");
  if (data.route.steps.some((step) => step.id === id)) throw new Error(`Шаг «${id}» уже есть.`);
  if (!title) throw new Error("Укажите название шага.");
  data.route.steps.push({ id, title });
  data.route.dirty = true;
}

function routeBody() {
  const route = data.route;
  return {
    steps: route.steps.map((step) => ({ id: step.id, title: step.title })),
    stages: route.stages.map((stage) => ({ ...stage })),
    ...(route.version.trim() ? { version: route.version.trim() } : {}),
  };
}

function editRoute(target) {
  const field = target.dataset.field;
  if (field === "version") data.route.version = target.value;
  else if (field === "step-title") data.route.steps[Number(target.closest("[data-step]").dataset.step)].title = target.value;
  else {
    const stage = data.route.stages[Number(target.closest("[data-stage]").dataset.stage)];
    if (field === "on") { if (target.checked) delete stage.status; else stage.status = "off"; }
    else if (field === "progress" && !target.value) delete stage.progress;
    else stage[field] = target.value;
  }
  data.route.dirty = true;
}

function moveStage(index, by) {
  const stages = data.route.stages;
  const to = index + by;
  if (to < 0 || to >= stages.length) return;
  [stages[index], stages[to]] = [stages[to], stages[index]];
  data.route.dirty = true;
  updateRoute();
}

async function download(path, filename) {
  const response = await fetch(apiUrl(path), { headers: { Authorization: `Bearer ${readToken()}` }, cache: "no-store" });
  if (!response.ok) throw new Error(`Сервер ключей ответил ошибкой ${response.status}.`);
  const url = URL.createObjectURL(await response.blob());
  const link = Object.assign(document.createElement("a"), { href: url, download: filename });
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const PAGES = ["tariff", "bundles", "methodology", "genesis", "dashboard", "keys", "agencies", "private", "testers", "archive"];
let lastPage = null;

async function render() {
  const seq = ++renderSeq;
  if (!readToken()) { renderLogin(); return; }
  if (!data.role) {
    try {
      data.who = await api("/whoami");
      data.role = data.who.role;
    } catch (failure) {
      if (seq !== renderSeq) return;
      if (failure instanceof AuthError) logout(failure.message);
      else renderLogin(failure.message);
      return;
    }
    if (seq !== renderSeq) return;
  }
  const route = window.location.hash.slice(1);
  let page = PAGES.includes(route) ? route : route.startsWith("edit/") ? "edit" : route.startsWith("key-") ? "key"
    : route.startsWith("agency-") ? "agency" : data.role === "agency" ? "agency" : data.role === "admin" ? "dashboard" : "methodology";
  // Агентство видит только свою карточку; автор методики — только методику.
  if (data.role === "agency") page = "agency";
  else if (data.role !== "admin" && ["dashboard", "keys", "key", "tariff", "agencies", "agency", "private", "testers", "archive"].includes(page)) page = "methodology";
  if (page in SEGMENT_PAGES) Object.assign(filters, { segment: SEGMENT_PAGES[page], agency: "all" });
  else if ((page === "keys" && lastPage in SEGMENT_PAGES) || page === "archive") Object.assign(filters, { segment: "all", agency: "all" });
  // Выбор ключей живёт в пределах одного раздела.
  if (page !== lastPage) { selection.on = false; selection.ids.clear(); }
  lastPage = page;
  setNav(page);
  mainEl().innerHTML = '<p class="muted loading" role="status">Загрузка…</p>';
  let draw;
  try {
    if (page === "archive") {
      const [stats, keys, agencies] = await Promise.all([api("/stats"), api("/keys?archived=true"), api("/agencies")]);
      draw = () => { Object.assign(data, { stats, keys, agencies }); renderKeys("archived"); };
    } else if (page === "keys" || page in SEGMENT_PAGES) {
      const query = filters.status === "all" ? "" : `?state=${encodeURIComponent(filters.status)}`;
      const [stats, keys, tariffs, tariff, agencies] = await Promise.all([api("/stats"), api(`/keys${query}`), api("/tariffs"), api("/tariff"), api("/agencies")]);
      draw = () => { Object.assign(data, { stats, keys, tariffs, tariff, agencies }); renderKeys(SEGMENT_PAGES[page] || null); };
    } else if (page === "dashboard") {
      const [stats, tariff] = await Promise.all([api("/stats"), api("/tariff")]);
      draw = () => { Object.assign(data, { stats, tariff, agencies: stats.agencies || [] }); renderDashboard(); };
    } else if (page === "agencies") {
      const agencies = await api("/agencies");
      draw = () => { data.agencies = agencies; renderAgencies(); };
    } else if (page === "agency") {
      const id = data.role === "agency" ? data.who.agency.id : route.slice(7);
      const path = `/agencies/${encodeURIComponent(id)}`;
      const [agency, keys] = await Promise.all([api(path), api(`${path}/keys`)]);
      draw = () => { data.agency = agency; renderAgency(agency, keys); };
    } else if (page === "key") {
      const id = encodeURIComponent(route.slice(4));
      const [key, events, tariffs, agencies] = await Promise.all([api(`/keys/${id}`), api(`/keys/${id}/events?limit=100`), api("/tariffs"), api("/agencies")]);
      draw = () => { Object.assign(data, { current: key, tariffs, agencies }); renderDetail(key, events); };
    } else if (page === "tariff") {
      const tariff = await api("/tariff");
      draw = () => { data.tariff = tariff; renderTariff(); };
    } else if (page === "methodology") {
      const [draft, revisions] = await Promise.all([api("/methodology"), api("/methodology/revisions?limit=50")]);
      draw = () => renderMethodology(draft, revisions);
    } else if (page === "edit" || page === "genesis") {
      const path = page === "genesis" ? GENESIS : decodeURIComponent(route.slice(5));
      const pending = data.file?.isNew && data.file.path === path ? data.file : null;
      const file = pending || await api(`/methodology/file?path=${encodeURIComponent(path)}`).catch((failure) => {
        if (failure.status === 404 && page === "genesis") return null;
        throw failure;
      });
      draw = () => file ? renderFile(file, { genesis: page === "genesis" }) : renderNoGenesis();
    } else {
      const bundles = await api("/bundles");
      draw = () => renderBundles(bundles);
    }
  } catch (failure) {
    if (seq !== renderSeq) return;
    if (failure instanceof AuthError) logout(failure.message);
    else renderFailure(failure.message);
    return;
  }
  if (seq !== renderSeq) return;
  if (page !== "key") data.current = null;
  if (page !== "agency") data.agency = null;
  if (page !== "edit" && page !== "genesis") data.file = null;
  draw();
  // Счётчик в меню — только там, где сводка только что загружена, иначе он мог устареть.
  if (data.role === "admin") document.getElementById("nav-count").textContent = ["dashboard", "keys", "private", "testers", "archive"].includes(page) && data.stats ? data.stats.keys : "";
}

// --- окна ---

function openDialog(title, description, body) {
  dialog.innerHTML = `<div class="dialog-heading"><h2 id="dialog-title">${title}</h2><button class="button ghost close-button" data-action="close" aria-label="Закрыть окно">${icon("close")}</button></div><p class="dialog-description">${description}</p>${body}`;
  if (!dialog.open) dialog.showModal();
}

function termFields(selected = 3, minDate = new Date()) {
  const choices = [...new Set([1, 3, 6, 12, Number(selected)])].sort((a, b) => a - b);
  return `<div class="field"><label for="term">Срок</label><select id="term" name="term" autofocus>${choices.map((n) => `<option value="${n}" ${n === Number(selected) ? "selected" : ""}>${months(n)}</option>`).join("")}<option value="date">До даты</option></select></div>
    <div class="field" id="until-field" hidden><label for="until">Дата окончания, включительно</label><input id="until" name="until" type="date" min="${inputDate(minDate)}" disabled></div>`;
}

function formActions(label, focusCancel = false) {
  return `<p class="form-error" id="form-error" role="alert" hidden></p><div class="dialog-actions"><button type="button" class="button" data-action="close"${focusCancel ? " autofocus" : ""}>Отмена</button><button type="submit" class="button primary">${label}</button></div>`;
}

// Номер заказа по умолчанию: дата и короткий код, например ORD-20261115-K7QM. Можно исправить или поставить «б/н».
const NO_ORDER = "б/н";
function orderSlug(now = new Date()) {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = new Uint8Array(4);
  if (globalThis.crypto?.getRandomValues) globalThis.crypto.getRandomValues(bytes);
  else bytes.forEach((_, i) => { bytes[i] = Math.floor(Math.random() * 256); });
  const code = [...bytes].map((b) => alphabet[b % alphabet.length]).join("");
  return `ORD-${inputDate(now).replaceAll("-", "")}-${code}`;
}

function showIssue(segment = "private") {
  const tariff = data.tariff;
  if (!tariff) { notice("Тариф не загрузился, обновите страницу."); return; }
  openDialog("Выдать ключ", `Тариф «${escapeHTML(tariff.title)}» · ${priceOf(tariff)}.`, `<form id="issue-form">
    <div class="field"><label for="issue-note">Получатель</label><input id="issue-note" name="note" maxlength="200" placeholder="Например, Иван Петров" autocomplete="off" autofocus><small>Имя и фамилия в именительном падеже или пометка. Без телефонов и почты.</small></div>
    <div class="field"><label for="issue-segment">Кому</label><select id="issue-segment" name="segment">${["private", "tester"].map((id) => `<option value="${id}" ${segment === id ? "selected" : ""}>${{ private: "Частный покупатель", tester: "Тестировщик" }[id]}</option>`).join("")}</select><small>Ключи агентствам выдаются пакетами в карточке агентства.</small></div>
    ${termFields(tariff.months).replace(" autofocus", "")}
    <div class="field"><label for="device-limit">Лимит устройств</label><input id="device-limit" name="deviceLimit" type="number" min="1" max="10" step="1" value="${tariff.device_limit}" required></div>
    <div class="field"><label for="order">Номер заказа</label><div class="input-row"><input id="order" name="order" maxlength="64" autocomplete="off" required value="${escapeHTML(orderSlug())}"><button type="button" class="button" data-action="order-none">${NO_ORDER}</button><button type="button" class="button" data-action="order-new">Новый</button></div><small>Заполнен автоматически: дата и код. Впишите номер из платёжного сервиса, если он есть, или нажмите «${NO_ORDER}», если заказа не было.</small></div>
    ${formActions("Выдать ключ")}</form>`);
}

function showIssued(key) {
  openDialog("Ключ выдан", "Скопируйте и передайте ключ по оплаченному заказу.", `<div class="key-success">${icon("check")}</div>
    <div class="field"><label for="full-key">Полный ключ доступа</label><textarea id="full-key" class="key-output" readonly spellcheck="false" autocomplete="off"></textarea><button class="button" data-action="copy" autofocus>${icon("copy")}Скопировать</button><p class="small muted" id="copy-result" role="status"></p></div>
    <p class="warning-note">Ключ показан только один раз. После закрытия окна он больше не появится: сервер хранит только хэш. Убедитесь, что сохранили ключ.</p>
    <p class="small muted">${escapeHTML(tariffTitle(key.tariff_id))} · до ${date(key.expires_at)} · ${escapeHTML(key.order_ref || "")}</p>
    <div class="dialog-actions"><button class="button primary" data-action="issued-done" data-id="${escapeHTML(key.id)}">Сохранено, открыть карточку</button></div>`);
  document.getElementById("full-key").value = fullKey;
}

// --- окна агентств ---

function showAgencyForm(agency = null) {
  const value = (name) => escapeHTML(agency?.[name] || "");
  openDialog(agency ? "Изменить агентство" : "Новое агентство", agency ? escapeHTML(agency.name) : "Карточка партнёра, которому ключи выдаются пакетами.", `<form id="agency-form" data-id="${agency ? escapeHTML(agency.id) : ""}">
    <div class="field"><label for="agency-name">Название</label><input id="agency-name" name="name" maxlength="80" required value="${value("name")}" placeholder="Например, агентство «Ромашка»" autofocus></div>
    <div class="field"><label for="agency-contact">Контактное лицо</label><input id="agency-contact" name="contact_name" maxlength="120" value="${value("contact_name")}" autocomplete="off"></div>
    <div class="form-row"><div class="field"><label for="agency-phone">Телефон</label><input id="agency-phone" name="phone" type="tel" maxlength="40" value="${value("phone")}" autocomplete="off"></div>
      <div class="field"><label for="agency-email">Почта</label><input id="agency-email" name="email" type="email" maxlength="120" value="${value("email")}" autocomplete="off"></div></div>
    <div class="field"><label for="agency-note">Заметка</label><textarea id="agency-note" name="note" maxlength="500" placeholder="Видна только администраторам">${value("note")}</textarea></div>
    ${agency ? `<label class="check"><input type="checkbox" name="archived" ${agency.archived_at ? "checked" : ""}> В архиве: новые пакеты не выдаются, вход агентства отключён</label>` : ""}
    ${formActions(agency ? "Сохранить" : "Завести агентство")}</form>`);
}

function showBatch(agency) {
  const tariff = data.tariff || { months: 12, device_limit: 2 };
  openDialog("Выдать пакет ключей", `${escapeHTML(agency.name)}. Ключи создаются сразу; файл с ними можно скачать только в следующем окне.`, `<form id="batch-form">
    <div class="field"><label for="batch-count">Сколько ключей</label><input id="batch-count" name="count" type="number" min="1" max="200" step="1" value="1" required autofocus></div>
    ${termFields(tariff.months || 12).replace(' autofocus', '')}
    <div class="field"><label for="batch-limit">Устройств на ключ</label><input id="batch-limit" name="deviceLimit" type="number" min="1" max="10" step="1" value="${tariff.device_limit || 2}" required></div>
    <div class="field"><label for="batch-recipient">Получатель</label><input id="batch-recipient" name="recipient" maxlength="200" placeholder="Например, группа выпускников, весна 2027" autocomplete="off"><small>Попадёт в файл и в список ключей. Без ФИО, если это не нужно агентству.</small></div>
    ${formActions("Создать ключи")}</form>`);
}

function showBatchDone(result) {
  batchFile = { text: result.markdown, filename: result.filename };
  const count = result.keys.length;
  openDialog("Ключи созданы", `${escapeHTML(result.agency.name)} · ${count} ${plural(count, "ключ", "ключа", "ключей")} до ${date(result.batch.expires_at)}.`, `<div class="key-success">${icon("check")}</div>
    <p class="warning-note">Файл с ключами доступен только сейчас. Сервер хранит лишь проверочные отпечатки ключей, поэтому после закрытия окна ключи не восстановить: только перевыпустить.</p>
    <div class="dialog-actions"><button class="button" data-action="copy-batch">${icon("copy")}Скопировать текст</button><button class="button primary" data-action="save-batch" autofocus>${icon("download")}Скачать файл .md</button></div>
    <p class="small muted" id="copy-result" role="status"></p>
    <div class="dialog-actions"><button class="button" data-action="close">Файл сохранён, закрыть</button></div>`);
}

function showTokenForm(agency) {
  openDialog("Вход для агентства", `${escapeHTML(agency.name)} увидит в админке только свои ключи и сводку по ним. Изменить ничего не сможет.`, `<form id="token-form">
    <div class="field"><label for="token-label">Чей вход</label><input id="token-label" name="label" maxlength="80" placeholder="Например, Иван, руководитель" autocomplete="off" autofocus><small>Подпись видна только вам: по ней понятно, какой вход отозвать.</small></div>
    ${formActions("Выдать вход")}</form>`);
}

function showTokenDone(token) {
  fullKey = token.token;
  const address = window.location.href.split("#")[0];
  openDialog("Вход выдан", "Передайте агентству адрес и токен. Токен показан один раз.", `<div class="key-success">${icon("check")}</div>
    <div class="field"><label>Адрес админки</label><p class="mono">${escapeHTML(address)}</p></div>
    <div class="field"><label for="full-key">Токен входа</label><textarea id="full-key" class="key-output" readonly spellcheck="false" autocomplete="off"></textarea><button class="button" data-action="copy" autofocus>${icon("copy")}Скопировать</button><p class="small muted" id="copy-result" role="status"></p></div>
    <p class="warning-note">После закрытия окна токен больше не появится: сервер хранит только его отпечаток. Потерянный токен отзовите и выдайте новый.</p>
    <div class="dialog-actions"><button class="button primary" data-action="close">Сохранено</button></div>`);
  document.getElementById("full-key").value = fullKey;
}

function showTokenRevoke(agency, tokenId) {
  const token = agency.tokens.find((item) => item.id === tokenId);
  openDialog("Отозвать вход", `${escapeHTML(agency.name)} · ${escapeHTML(token?.label || "Без подписи")}. Войти с этим токеном больше не получится.`, `<form id="token-revoke-form" data-token="${escapeHTML(tokenId)}">${formActions("Отозвать", true)}</form>`);
}

function showMove(key) {
  openDialog("Кому выдан ключ", `${escapeHTML(keyLabel(key))}. Перенос меняет раздел и статистику, сам ключ продолжает работать.`, `<form id="move-form">
    <div class="field"><label for="move-segment">Раздел</label><select id="move-segment" name="segment" autofocus>${Object.entries({ private: "Частный покупатель", tester: "Тестировщик", agency: "Агентство" }).map(([id, title]) => `<option value="${id}" ${key.segment === id ? "selected" : ""}>${title}</option>`).join("")}</select></div>
    <div class="field" id="move-agency-field" ${key.segment === "agency" ? "" : "hidden"}><label for="move-agency">Агентство</label><select id="move-agency" name="agency">${data.agencies.filter((agency) => !agency.archived_at || agency.id === key.agency_id).map((agency) => `<option value="${escapeHTML(agency.id)}" ${key.agency_id === agency.id ? "selected" : ""}>${escapeHTML(agency.name)}</option>`).join("")}</select></div>
    <div class="field"><label for="move-note">Получатель</label><input id="move-note" name="note" maxlength="200" placeholder="Например, Иван Петров" value="${escapeHTML(key.note || "")}" autocomplete="off"></div>
    ${formActions("Сохранить")}</form>`);
}

async function submitAgencyForm(form) {
  const fields = new FormData(form);
  if (form.id === "agency-form") {
    const body = Object.fromEntries(["name", "contact_name", "phone", "email", "note"].map((name) => [name, String(fields.get(name) || "").trim()]));
    if (!body.name) throw new Error("Укажите название агентства.");
    if (body.email && !/^[^\s@]+@[^\s@]+$/.test(body.email)) throw new Error("Почта указана неверно.");
    if (form.dataset.id) {
      const saved = await api(`/agencies/${encodeURIComponent(form.dataset.id)}`, { method: "PATCH", json: { ...body, archived: fields.get("archived") === "on" } });
      dialog.close();
      notice(`Сохранено: ${saved.name}.`);
      await render();
    } else {
      const created = await api("/agencies", { method: "POST", json: body });
      dialog.close();
      notice(`Заведено: ${created.name}.`);
      window.location.hash = `agency-${created.id}`;
    }
    return true;
  }
  if (form.id === "batch-form") {
    const count = Number(fields.get("count"));
    const limit = Number(fields.get("deviceLimit"));
    if (!Number.isSafeInteger(count) || count < 1 || count > 200) throw new Error("Количество ключей — от 1 до 200.");
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 10) throw new Error("Устройств на ключ — от 1 до 10.");
    const body = { count, device_limit: limit };
    const recipient = String(fields.get("recipient") || "").trim();
    if (recipient) body.recipient = recipient;
    if (fields.get("term") === "date") {
      const expires = endOfDay(fields.get("until"));
      if (!Number.isFinite(expires.getTime()) || expires <= new Date()) throw new Error("Дата окончания должна быть в будущем.");
      body.expires_at = expires.toISOString();
    } else body.months = Number(fields.get("term"));
    const result = await api(`/agencies/${encodeURIComponent(data.agency.id)}/batches`, { method: "POST", json: body });
    showBatchDone(result);
    render();
    return true;
  }
  if (form.id === "token-form") {
    const label = String(fields.get("label") || "").trim();
    showTokenDone(await api(`/agencies/${encodeURIComponent(data.agency.id)}/tokens`, { method: "POST", json: label ? { label } : {} }));
    render();
    return true;
  }
  if (form.id === "token-revoke-form") {
    await api(`/agencies/${encodeURIComponent(data.agency.id)}/tokens/${encodeURIComponent(form.dataset.token)}`, { method: "DELETE" });
    dialog.close();
    notice("Вход отозван.");
    await render();
    return true;
  }
  if (form.id === "move-form") {
    const segment = fields.get("segment");
    const body = { segment, note: String(fields.get("note") || "").trim() };
    if (segment === "agency") {
      body.agency_id = fields.get("agency");
      if (!body.agency_id) throw new Error("Выберите агентство.");
    }
    await api(`/keys/${encodeURIComponent(data.current.id)}`, { method: "PATCH", json: body });
    dialog.close();
    notice("Ключ перенесён.");
    await render();
    return true;
  }
  return false;
}

async function copyBatch() {
  if (!batchFile) return;
  let copied = false;
  try { await navigator.clipboard.writeText(batchFile.text); copied = true; } catch { /* остаётся кнопка «Скачать». */ }
  const result = document.getElementById("copy-result");
  if (result) result.textContent = copied ? "Текст с ключами скопирован." : "Не удалось скопировать: скачайте файл.";
}

// --- действия пакетом ---

function selectedKeys() {
  return data.keys.filter((key) => selection.ids.has(key.id));
}

function bulkTarget(value) {
  if (value?.startsWith("agency:")) {
    const id = value.slice(7);
    return { segment: "agency", agency_id: id, title: `агентство «${agencyName(id) || "?"}»` };
  }
  return { segment: value, title: { private: "частные", tester: "тестировщики" }[value] || value };
}

function keyList(keys) {
  const shown = keys.slice(0, 8).map((key) => escapeHTML(keyLabel(key))).join(", ");
  return keys.length > 8 ? `${shown} и ещё ${keys.length - 8}` : shown;
}

function showBulkMove(value) {
  const keys = selectedKeys();
  const target = bulkTarget(value);
  openDialog("Перенести ключи", `${keys.length} ${plural(keys.length, "ключ", "ключа", "ключей")} → ${escapeHTML(target.title)}. Ключи продолжат работать, меняется только раздел и статистика.`,
    `<form id="bulk-move-form" data-target="${escapeHTML(value)}"><p class="small mono">${keyList(keys)}</p>${formActions("Перенести")}</form>`);
}

function showBulkArchive(step = 1) {
  const keys = selectedKeys();
  const active = keys.filter((key) => ["active", "expiring"].includes(key.state)).length;
  const n = keys.length;
  if (step === 1) {
    // Подсказка: все выбранные истекли — «Истёк срок», все заблокированы — «Был заблокирован».
    const guess = keys.every((key) => key.state === "expired") ? "expired" : keys.every((key) => key.state === "revoked") ? "revoked" : "unneeded";
    openDialog("Перенести в архив?", `${n} ${plural(n, "ключ", "ключа", "ключей")}. Ключи не удаляются: они хранятся в базе, но перестают работать у пользователей и пропадают из списков и статистики. Вернуть можно из раздела «Архив».`,
      `<form id="bulk-archive-1"><p class="small mono">${keyList(keys)}</p>
      <div class="field"><label for="archive-reason">Причина</label><select id="archive-reason" name="reason" autofocus>${Object.entries(archiveReasonNames).map(([id, title]) => `<option value="${id}" ${guess === id ? "selected" : ""}>${title}</option>`).join("")}</select><small>Статус каждого ключа на момент переноса сохранится сам: действовал, истёк или был заблокирован.</small></div>
      <div class="field"><label for="archive-note">Комментарий</label><input id="archive-note" name="note" maxlength="200" autocomplete="off" placeholder="Обязателен для «Другой причины»"></div>
      ${active ? `<p class="warning-note">Среди них действующих: ${active}. Эти люди сразу потеряют доступ к методике.</p>` : ""}${formActions("Продолжить", true)}</form>`);
  } else {
    openDialog("Подтвердите перенос в архив", `Причина: ${escapeHTML(archiveReasonNames[pendingArchive?.reason] || "")}. Чтобы перенести ${n} ${plural(n, "ключ", "ключа", "ключей")} в архив, введите число ${n}.`,
      `<form id="bulk-archive-2"><div class="field"><label for="archive-count">Сколько ключей переносим</label><input id="archive-count" name="count" inputmode="numeric" autocomplete="off" required autofocus></div>${formActions(`В архив: ${n}`, false)}</form>`);
  }
}

function showBulkUnarchive() {
  const keys = selectedKeys();
  openDialog("Вернуть из архива", `${keys.length} ${plural(keys.length, "ключ", "ключа", "ключей")} снова заработают у пользователей (если не истёк срок и нет блокировки) и вернутся в свои разделы.`,
    `<form id="bulk-unarchive-form"><p class="small mono">${keyList(keys)}</p>${formActions("Вернуть")}</form>`);
}

async function submitBulk(form) {
  if (!["bulk-move-form", "bulk-archive-1", "bulk-archive-2", "bulk-unarchive-form"].includes(form.id)) return false;
  const ids = [...selection.ids];
  if (!ids.length) throw new Error("Ключи не выбраны.");
  if (form.id === "bulk-archive-1") {
    const fields = new FormData(form);
    const reason = String(fields.get("reason") || "");
    const note = String(fields.get("note") || "").trim();
    if (!(reason in archiveReasonNames)) throw new Error("Выберите причину.");
    if (reason === "other" && !note) throw new Error("Для «Другой причины» напишите комментарий.");
    pendingArchive = { reason, note };
    showBulkArchive(2);
    return true;
  }
  let body, message;
  if (form.id === "bulk-move-form") {
    const target = bulkTarget(form.dataset.target);
    body = { ids, action: "move", segment: target.segment, ...(target.agency_id ? { agency_id: target.agency_id } : {}) };
    message = `Перенесено: ${ids.length} → ${target.title}.`;
  } else if (form.id === "bulk-archive-2") {
    if (String(new FormData(form).get("count") || "").trim() !== String(ids.length)) throw new Error(`Введите ${ids.length}, чтобы подтвердить.`);
    if (!pendingArchive) throw new Error("Причина не выбрана: начните заново.");
    body = { ids, action: "archive", confirm: true, reason: pendingArchive.reason, ...(pendingArchive.note ? { note: pendingArchive.note } : {}) };
    message = `В архиве: ${ids.length}. Эти ключи больше не работают.`;
  } else {
    body = { ids, action: "unarchive" };
    message = `Возвращено из архива: ${ids.length}.`;
  }
  await api("/keys/bulk", { method: "POST", json: body });
  selection.ids.clear();
  selection.on = false;
  dialog.close();
  notice(message);
  await render();
  return true;
}

// --- действия ---

// Окна раздела «Методика». false — форма не отсюда.
async function submitMethodology(form) {
  const fields = new FormData(form);
  if (form.id === "stage-form" || form.id === "step-form") {
    if (form.id === "stage-form") addStage(fields); else addStep(fields);
    dialog.close();
    updateRoute();
    notice("Добавлено. Сохраните маршрут, чтобы изменение попало в черновик.");
    return true;
  }
  if (form.id === "file-new-form") {
    const path = String(fields.get("path") || "").trim().replace(/^\/+/, "");
    if (!path || path.split("/").some((part) => !part || part.startsWith("."))) throw new Error("Путь без «..», скрытых папок и пустых частей.");
    if (data.draft?.files.some((file) => file.path === path)) throw new Error("Такой файл уже есть: откройте его из списка.");
    data.file = { path, text: "", isNew: true };
    dialog.close();
    window.location.hash = `edit/${encodeURIComponent(path)}`;
    return true;
  }
  let message;
  if (form.id === "publish-form") {
    const note = String(fields.get("note") || "").trim();
    const published = await api("/methodology/publish", { method: "POST", json: { channel: form.dataset.channel, note, important: fields.get("important") === "on" } });
    message = `Опубликована версия v${published.version} для: ${form.dataset.channel === "test" ? "тестовых ключей" : "всех пользователей"}.`;
  } else if (form.id === "restore-form") {
    const head = await api(`/methodology/revisions/${encodeURIComponent(form.dataset.rev)}/restore`, { method: "POST" });
    message = `Версия ${form.dataset.rev} возвращена. Черновик: версия ${head.id}.`;
  } else if (form.id === "file-delete-form") {
    const file = data.file;
    await api(`/methodology/file?path=${encodeURIComponent(file.path)}&base_sha=${encodeURIComponent(file.sha)}`, { method: "DELETE" });
    message = `Файл ${file.path} удалён из черновика.`;
    dialog.close();
    notice(message);
    window.location.hash = "methodology";
    return true;
  } else return false;
  dialog.close();
  notice(message);
  await render();
  return true;
}

async function issueKey(form) {
  const fields = new FormData(form);
  const limit = Number(fields.get("deviceLimit"));
  const order = String(fields.get("order") || "").trim();
  const segment = fields.get("segment") === "tester" ? "tester" : "private";
  const note = String(fields.get("note") || "").trim();
  const body = { order_ref: order || null, device_limit: limit, segment };
  if (note) body.note = note;
  if (fields.get("term") === "date") {
    const expires = endOfDay(fields.get("until"));
    if (!Number.isFinite(expires.getTime()) || expires <= new Date()) throw new Error("Дата окончания должна быть в будущем.");
    body.expires_at = expires.toISOString();
  } else body.months = Number(fields.get("term"));
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 10 || !order || order.length > 64) throw new Error(`Проверьте срок, лимит устройств и номер заказа (если заказа не было — «${NO_ORDER}»).`);
  const issued = await api("/keys", { method: "POST", json: body });
  fullKey = issued.key;
  delete issued.key;
  showIssued(issued);
  render();
}

async function extendKey(key, fields) {
  const path = `/keys/${encodeURIComponent(key.id)}/extend`;
  if (fields.get("term") !== "date") return api(path, { method: "POST", json: { months: Number(fields.get("term")) } });
  const until = endOfDay(fields.get("until"));
  if (!Number.isFinite(until.getTime()) || until.getTime() <= Math.max(Date.now(), new Date(key.expires_at).getTime())) throw new Error("Новая дата должна быть позже текущего срока и сегодняшнего дня.");
  return api(path, { method: "POST", json: { until: until.toISOString() } });
}

async function copyKey() {
  if (!fullKey) return;
  let copied = false;
  try {
    await navigator.clipboard.writeText(fullKey);
    copied = true;
  } catch {
    const output = document.getElementById("full-key");
    if (!output) return;
    output.focus();
    output.select();
    try { copied = document.execCommand("copy"); } catch { /* Ручное копирование остаётся доступным. */ }
  }
  const result = document.getElementById("copy-result");
  if (result) result.textContent = copied ? "Ключ скопирован." : "Ключ выделен. Скопируйте его сочетанием ⌘C или Ctrl+C.";
}

function showError(element, failure) {
  if (failure instanceof AuthError) { logout(failure.message); return; }
  element.textContent = failure.message;
  element.hidden = false;
}

async function submitMainForm(form) {
  const submit = form.querySelector('[type="submit"]');
  const error = form.querySelector(".form-error");
  if (submit.disabled) return;
  submit.disabled = true;
  error.hidden = true;
  try {
    if (form.id === "login-form") {
      writeToken(String(new FormData(form).get("token") || "").trim());
      data.who = await api("/whoami");
      data.role = data.who.role;
    } else if (form.classList.contains("tariff-form")) {
      const price = tariffPrice(data.tariff, new FormData(form));
      if (price === null) { notice("Цена не изменилась."); submit.disabled = false; return; }
      data.tariff = await api("/tariff", { method: "PATCH", json: { price_rub: price } });
      notice(`Цена сохранена: ${priceOf(data.tariff)}.`);
    } else if (form.id === "bundle-form") {
      const published = await api("/bundles", { method: "POST", form: new FormData(form) });
      notice(`Опубликована версия v${published.version}.`);
    } else if (form.id === "draft-upload-form") {
      const fields = new FormData(form);
      const path = String(fields.get("path") || "").trim();
      const head = await api(`/methodology/upload${path ? `?path=${encodeURIComponent(path)}` : ""}`, { method: "POST", form: fields });
      notice(head.unchanged ? "Изменений нет: такие файлы уже в черновике." : `Загружено. Черновик: версия ${head.id}.`);
    } else if (form.id === "file-form") {
      const file = data.file;
      const fields = new FormData(form);
      const message = String(fields.get("message") || "").trim();
      const head = await api("/methodology/file", { method: "PUT", json: { path: file.path, text: String(fields.get("text") ?? ""), base_sha: file.isNew ? null : file.sha, ...(message ? { message } : {}) } });
      data.file = null;
      notice(head.unchanged ? "Изменений нет." : `Сохранено. Черновик: версия ${head.id}.`);
    }
    await render();
  } catch (failure) {
    if (form.id === "login-form") {
      writeToken("");
      data.role = null;
      data.who = null;
      error.textContent = failure.message;
      error.hidden = false;
    } else showError(error, failure);
    submit.disabled = false;
  }
}

root.addEventListener("input", (event) => {
  if (event.target.id === "search") { filters.query = event.target.value; updateList(); }
  else if (event.target.dataset?.field && data.route) {
    editRoute(event.target);
    if (event.target.dataset.field === "title") { const title = event.target.closest(".stage")?.querySelector(".stage-title"); if (title) title.textContent = event.target.value; }
    // Кнопки включаются сразу, без перерисовки: иначе потерялся бы фокус в поле.
    ["route-save", "route-reset"].forEach((action) => { const button = document.querySelector?.(`[data-action="${action}"]`); if (button) button.disabled = false; });
  }
});
root.addEventListener("change", (event) => {
  if (event.target.dataset?.field && data.route) {
    editRoute(event.target);
    if (event.target.tagName === "SELECT" || event.target.type === "checkbox") updateRoute();
  }
  else if (event.target.id === "status-filter") { filters.status = event.target.value; render(); }
  else if (event.target.id === "segment-filter") { filters.segment = event.target.value; updateList(); }
  else if (event.target.id === "reason-filter") { filters.reason = event.target.value; updateList(); }
  else if (event.target.dataset?.select) {
    if (event.target.checked) selection.ids.add(event.target.dataset.select); else selection.ids.delete(event.target.dataset.select);
    event.target.closest("tr")?.classList.toggle("selected", event.target.checked);
    updateBulk();
  } else if (event.target.id === "select-all") {
    filteredKeys().forEach((key) => { if (event.target.checked) selection.ids.add(key.id); else selection.ids.delete(key.id); });
    updateList();
  }
  else if (event.target.id === "agency-filter") { filters.agency = event.target.value; if (filters.agency !== "all") filters.segment = "agency"; render(); }
});
root.addEventListener("click", async (event) => {
  const button = event.target.closest("[data-action]");
  if (!button) return;
  const key = data.current;
  const action = button.dataset.action;
  if (action === "logout") logout("Вы вышли. Токен удалён из этой вкладки.", false);
  else if (action === "issue") showIssue(button.dataset.segment);
  else if (action === "agency-new") showAgencyForm();
  else if (action === "select-toggle") { selection.on = !selection.on; selection.ids.clear(); renderKeys(lastPage === "archive" ? "archived" : SEGMENT_PAGES[lastPage] || null); }
  else if (action === "select-none") { selection.ids.clear(); updateList(); }
  else if (action === "unarchive-one" && key) { selection.ids.clear(); selection.ids.add(key.id); data.keys = [key]; showBulkUnarchive(); }
  else if (action === "bulk-move" && selection.ids.size) showBulkMove(document.getElementById("bulk-target").value);
  else if (action === "bulk-archive" && selection.ids.size) showBulkArchive(1);
  else if (action === "bulk-unarchive" && selection.ids.size) showBulkUnarchive();
  else if (action === "agency-edit" && data.agency) showAgencyForm(data.agency);
  else if (action === "batch" && data.agency) showBatch(data.agency);
  else if (action === "token-new" && data.agency) showTokenForm(data.agency);
  else if (action === "token-revoke" && data.agency) showTokenRevoke(data.agency, button.dataset.token);
  else if (action === "move" && key) showMove(key);
  else if (action === "agency-export" && data.agency) {
    button.disabled = true;
    try { await download(`/agencies/${encodeURIComponent(data.agency.id)}/export.md`, `jobshturman-keys-${inputDate(new Date())}.md`); }
    catch (failure) { if (failure instanceof AuthError) logout(failure.message); else notice(failure.message); }
    button.disabled = false;
  }
  else if (action === "reload") render();
  else if (action === "reset") { Object.assign(filters, { query: "", status: "all", agency: "all", reason: "all", segment: SEGMENT_PAGES[lastPage] || "all" }); render(); }
  else if (action === "publish") showPublish(button.dataset.channel);
  else if (action === "stage-add") showStageAdd();
  else if (action === "step-add") showStepAdd();
  else if (action === "file-new") showFileNew(button.dataset.dir);
  else if (action === "restore-rev") showRestore(Number(button.dataset.rev));
  else if (action === "file-delete" && data.file) showFileDelete(data.file);
  else if (action === "stage-up" || action === "stage-down") moveStage(Number(button.closest("[data-stage]").dataset.stage), action === "stage-up" ? -1 : 1);
  else if (action === "stage-remove") { data.route.stages.splice(Number(button.closest("[data-stage]").dataset.stage), 1); data.route.dirty = true; updateRoute(); }
  else if (action === "step-remove") { data.route.steps.splice(Number(button.closest("[data-step]").dataset.step), 1); data.route.dirty = true; updateRoute(); }
  else if (action === "route-reset") { data.route = routeCopy(data.draft); updateRoute(); }
  else if (["route-save", "diff", "import-current", "export", "set-current", "toggle-channel"].includes(action)) {
    button.disabled = true;
    try {
      if (action === "route-save") {
        const head = await api("/methodology/route", { method: "PUT", json: routeBody() });
        notice(head.unchanged ? "Изменений нет." : `Маршрут сохранён. Черновик: версия ${head.id}.`);
      } else if (action === "diff") {
        showDiff(button.dataset.rev, await api(`/methodology/revisions/${encodeURIComponent(button.dataset.rev)}/diff`));
        button.disabled = false;
        return;
      } else if (action === "import-current") {
        const head = await api("/methodology/import-current", { method: "POST" });
        notice(head.unchanged ? "Черновик уже совпадает с опубликованной версией." : `${head.message}. Черновик: версия ${head.id}.`);
      } else if (action === "export") {
        await download("/methodology/export", "methodology-draft.zip");
        button.disabled = false;
        return;
      } else if (action === "set-current") {
        await api(`/bundles/${encodeURIComponent(button.dataset.version)}/current`, { method: "POST", json: { channel: button.dataset.channel } });
        notice(`v${button.dataset.version} — текущая для: ${button.dataset.channel === "test" ? "тестовых ключей" : "всех пользователей"}.`);
      } else if (action === "toggle-channel" && key) {
        const channel = key.channel === "test" ? "stable" : "test";
        await api(`/keys/${encodeURIComponent(key.id)}/channel`, { method: "POST", json: { channel } });
        notice(channel === "test" ? "Ключ получает тестовые версии методики." : "Ключ получает обычные версии методики.");
      }
      await render();
    } catch (failure) {
      if (failure instanceof AuthError) logout(failure.message);
      else { notice(failure.message); button.disabled = false; }
    }
  }
  else if (key && action === "extend") showExtend(key);
  else if (key && action === "revoke") showRevoke(key);
  else if (key && action === "detach") showDetach(key, button.dataset.device);
  else if (key && action === "reset-devices") showResetDevices(key);
  else if (key && action === "restore") {
    button.disabled = true;
    try {
      const restored = await api(`/keys/${encodeURIComponent(key.id)}/restore`, { method: "POST" });
      notice(restored.state === "expired" ? "Блокировка снята. Срок ключа истёк — нужно продление." : "Ключ разблокирован.");
      await render();
    } catch (failure) {
      if (failure instanceof AuthError) logout(failure.message);
      else { notice(failure.message); button.disabled = false; }
    }
  }
});
root.addEventListener("submit", (event) => {
  event.preventDefault();
  if (event.target.reportValidity()) submitMainForm(event.target);
});

dialog.addEventListener("change", (event) => {
  if (event.target.id === "term") {
    const custom = event.target.value === "date";
    document.getElementById("until-field").hidden = !custom;
    const until = document.getElementById("until");
    until.disabled = !custom;
    until.required = custom;
  } else if (event.target.id === "move-segment") {
    document.getElementById("move-agency-field").hidden = event.target.value !== "agency";
  }
});

dialog.addEventListener("click", (event) => {
  const button = event.target.closest("[data-action]");
  if (!button) return;
  if (button.dataset.action === "close") dialog.close();
  else if (button.dataset.action === "copy") copyKey();
  else if (button.dataset.action === "copy-batch") copyBatch();
  else if (button.dataset.action === "order-none") document.getElementById("order").value = NO_ORDER;
  else if (button.dataset.action === "order-new") document.getElementById("order").value = orderSlug();
  else if (button.dataset.action === "save-batch" && batchFile) saveText(batchFile.text, batchFile.filename);
  else if (button.dataset.action === "issued-done") {
    dialog.close();
    window.location.hash = `key-${button.dataset.id}`;
  }
});

dialog.addEventListener("close", () => {
  fullKey = null;
  pendingArchive = null;
  batchFile = null;
  dialog.replaceChildren();
});

dialog.addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.target;
  if (!form.reportValidity()) return;
  const submit = form.querySelector('[type="submit"]');
  if (submit.disabled) return;
  submit.disabled = true;
  const error = document.getElementById("form-error");
  error.hidden = true;
  try {
    if (form.id === "issue-form") { await issueKey(form); return; }
    if (await submitAgencyForm(form)) return;
    if (await submitBulk(form)) return;
    if (await submitMethodology(form)) return;
    const key = data.current;
    if (!key) throw new Error("Ключ не найден.");
    const fields = new FormData(form);
    const path = `/keys/${encodeURIComponent(key.id)}`;
    let message;
    if (form.id === "extend-form") {
      const extended = await extendKey(key, fields);
      message = `Ключ продлён до ${date(extended.expires_at)}.`;
    } else if (form.id === "revoke-form") {
      await api(`${path}/revoke`, { method: "POST", json: { reason: fields.get("reason") } });
      message = "Ключ заблокирован.";
    } else if (form.id === "detach-form") {
      await api(`${path}/devices/${encodeURIComponent(form.dataset.device)}`, { method: "DELETE" });
      message = "Устройство отвязано. Место освободилось.";
    } else if (form.id === "reset-form") {
      await api(`${path}/reset-devices`, { method: "POST" });
      message = "Все устройства отвязаны.";
    }
    dialog.close();
    notice(message);
    await render();
  } catch (failure) {
    showError(error, failure);
    submit.disabled = false;
  }
});

window.addEventListener("hashchange", () => { render(); mainEl()?.focus(); });
render();
