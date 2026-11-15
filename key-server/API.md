# API сервера ключей

Базовый адрес: `https://jobsh.ru/keys`. Все ответы JSON, ошибки — `{"error": "<код>", "message": "<текст для человека>"}`. Время — ISO 8601 в UTC с `Z`.

## Клиент (`hrs`)

| Запрос | Тело или заголовок | Ответ |
|---|---|---|
| `POST /v1/activate` | `{"key", "install_id", "client"}` | `token`, `token_expires_at` (сутки, не дольше срока ключа) и статус |
| `GET /v1/status` | `Authorization: Bearer <token>` | статус |
| `GET /v1/bundle/latest` | `Authorization: Bearer <token>` | zip методики; заголовки `X-Bundle-Version`, `X-Bundle-Sha256`, `X-Bundle-Signature` (Ed25519, base64, подпись всего zip) |
| `POST /v1/bundle/accept` | `Authorization: Bearer <token>`, `{"version"}` | статус; человек согласился на предложенную версию, ключ переходит на неё, `hrs` скачивает её следующим запросом. `not_offered` 409, если эта версия сейчас не предлагается |
| `GET /v1/health` | — | `{"ok": true}` |
| `GET /v1/tariffs` | — | открытый, без токена: список из одного продаваемого тарифа — `id`, `title`, `price_rub_from` = `price_rub_to` (цена), `months`, `device_limit`, `active`; его читает лендинг |

Клиент передаёт свою версию в заголовке `X-Hrs-Version` (в `activate`, `status`, `bundle/latest`). Сервер отдаёт текущую версию методики канала ключа, если этот `hrs` её читает; иначе последнюю, которую он читает, и в статусе появляется `hrs_update` — текст с командой обновления. Запрос без заголовка считается запросом самого старого `hrs`.

Обновление по согласию (`hrs` от 0.4.0). Каждый ключ закреплён за своей версией методики (`pinned_version`), и `status` с `bundle/latest` отдают её, даже когда каналу выдаётся более новая. Тогда в статусе есть `update_available {version, changes}`: `changes` — список `{version, published_at, note, important}` от закреплённой версии до предложенной. Ключ переходит на новую версию только после `POST /v1/bundle/accept`. Если среди новых версий есть отмеченная «важное», ключ переходит сам, а в статусе появляется `auto_updated {from, to, at, changes}`: его нужно один раз показать человеку. Если канал откатили на более старую версию, ключ переходит на неё сам. Старый `hrs` (ниже 0.4.0 или без заголовка) получает версию канала, как раньше, и ключ закрепляется за тем, что он получил. При первой выкладке ключи в работе закрепляются за версией, которую скачали последней.

Статус: `key_hint` (первые 4 знака ключа), `tariff {id, title}`, `expires_at`, `days_left`, `state` (`active` или `expiring` — меньше суток до конца), `warning` (текст со ссылкой на продление или `null`), `renew_url`, `bundle {version, sha256}`, `hrs_update` (или `null`), `watermark` (8 hex-знаков: id водяного знака ключа, первые знаки sha256 от хэша ключа; hrs вписывает его в выданные тексты методики).

Отказы: `invalid_key` 404, `key_expired` 403, `key_revoked` 403, `device_limit` 403, `invalid_token`/`token_expired` 401, `no_bundle` 404. Ключ и токен проверяются при каждом запросе: отозванный ключ теряет доступ сразу, даже с живым токеном.

## Админка

Заголовок `Authorization: Bearer <токен>`. В `HRS_KEYS_ADMIN_TOKEN` можно перечислить несколько токенов через запятую, по одному на администратора; чтобы отозвать токен, уберите его из списка и перезапустите сервер. Для страницы админки с другого адреса задайте `HRS_KEYS_ADMIN_ORIGINS`.

| Запрос | Тело | Ответ |
|---|---|---|
| `GET /v1/admin/stats` | — | `keys`, `by_state {active, expiring, expired, revoked}`, `devices`, `activated` (ключи хотя бы с одним устройством), `by_segment {agency, private, tester: {keys, active, activated}}`, `agencies` (агентства со `stats`), `latest_bundle` |
| `GET /v1/admin/tariffs` | — | все тарифы, включая выключенные прежние (на них ссылаются старые ключи) |
| `GET /v1/admin/tariff` | — | единственный продаваемый тариф |
| `PATCH /v1/admin/tariff` | `price_rub` (1…10 000 000) | тариф; меняется только цена, название, срок и лимит устройств заданы в коде |
| `GET /v1/admin/keys?state=&segment=&agency=&archived=` | — | список ключей вне архива (`archived=true` — только архив); `segment` — `agency`, `private` или `tester`, `agency` — id агентства. У ключа есть `segment`, `agency_id`, `batch_id`, `note` (для кого) |
| `POST /v1/admin/keys/bulk` | `ids` (1…500), `action`: `move` (+ `segment`, `agency_id`), `archive` (+ `confirm: true` и `reason`: `expired` \| `revoked` \| `unneeded` \| `other`; для `other` обязателен `note`), `unarchive` | `{action, count}`; всё или ничего: при неизвестном id ничего не меняется |
| `PATCH /v1/admin/keys/{id}` | любые из `segment`, `agency_id` (для `segment=agency`), `note` | ключ; перенос между частными, тестировщиками и агентством |
| `POST /v1/admin/keys` | необязательно `tariff_id` (по умолчанию единственный тариф), `months` или `expires_at`, `order_ref`, `device_limit`, `segment` (`private` или `tester`; ключи агентств — только пакетом), `note` | ключ; поле `key` с самим ключом есть **только в этом ответе** |
| `GET /v1/admin/keys/{id}` | — | ключ |
| `POST /v1/admin/keys/{id}/extend` | `{"months": N}` (прибавляются к более поздней из дат: сегодня или текущий конец) или `{"until": "2027-01-31"}` | ключ |
| `POST /v1/admin/keys/{id}/revoke` | `{"reason": "refund" \| "violation" \| "reissue" \| "other"}` | ключ |
| `POST /v1/admin/keys/{id}/restore` | — | ключ |
| `POST /v1/admin/keys/{id}/reset-devices` | — | ключ |
| `DELETE /v1/admin/keys/{id}/devices/{install}` | — | ключ; отвязано одно устройство по 8 знакам из `devices[].install`. `not_found` 404, если такого нет; `ambiguous_device` 409, если префикс подходит к нескольким |
| `GET /v1/admin/keys/{id}/events?limit=100` | — | последние события ключа, новые сверху: `[{kind, detail, at}]`; `kind` — `activate`, `check`, `download`, `denied` или `admin`; `limit` от 1 до 1000 |
| `POST /v1/admin/keys/{id}/channel` | `{"channel": "test" \| "stable"}` | ключ; ключ канала `test` получает версии «на проверку» раньше всех |
| `GET /v1/admin/bundles` | — | опубликованные версии методики, у каждой `channels` — каким каналам она сейчас выдаётся, `note` — что изменилось, `important`, `keys` — сколько ключей на ней |
| `POST /v1/admin/bundles` | multipart: `file` — zip от `hrs-keys bundle build`, `note` — что изменилось (обязательно, до 1000 знаков), `important` — `true`, чтобы версия встала без вопроса | версия: `version`, `sha256`, `size`, `signature`, `published_at`, `format`, `min_hrs`, `revision`, `note`, `important`, `channels`, `keys` (сколько ключей на ней); сразу становится доступной всем. Без `note` — `note_required` 400 |
| `POST /v1/admin/bundles/{version}/current` | `{"channel": "test" \| "stable"}` | версия; выдать её каналу: перевести проверенную версию всем или откатиться. `stable` переключает и `test` |
| `GET /v1/admin/signing-key` | — | `public_key` для `hrs` |

## Редактор методики

Источник истины методики — черновик на сервере: каждое сохранение становится версией черновика (история, сравнение, откат), файлы хранятся в `<data>/library/blobs`. Доступ — токены администратора и токены методолога из `HRS_KEYS_METHODOLOGIST_TOKEN` (через запятую). Методолог видит только этот раздел и список версий методики; `GET /v1/admin/whoami` отвечает `{"role": "admin" | "methodologist"}`.

| Запрос | Тело | Ответ |
|---|---|---|
| `GET /v1/admin/methodology` | — | `head` (последняя версия черновика), `files [{path, sha, size}]`, `steps`, `stages` (как в манифесте, с `files`), `route` (этапы с номерами), `check`, `current {stable, test}` |
| `GET /v1/admin/methodology/file?path=&revision=` | — | `{path, sha, text, size}` |
| `PUT /v1/admin/methodology/file` | `{path, text, base_sha, message}`; `base_sha` — `sha` файла, который открыли (`null` для нового) | новая версия черновика; `conflict` 409, если файл успели изменить |
| `DELETE /v1/admin/methodology/file?path=&base_sha=` | — | новая версия черновика |
| `POST /v1/admin/methodology/upload?path=` | multipart `file`: zip заменяет весь черновик (папка библиотеки или опубликованный пакет), другой файл добавляется по `path` | новая версия черновика. Манифест старого вида переписывается в формат 2, если в архиве нет главного промпта `agent/genesis.md`, он берётся из опубликованной версии, а без неё ставится заглушка; с заглушкой проверка не пропускает публикацию (`genesis_placeholder`) |
| `POST /v1/admin/methodology/import-current` | — | черновик из версии, которую сейчас получают все |
| `PUT /v1/admin/methodology/route` | `{steps: [{id, title}], stages: [{id, title, step, dir, progress, tools, status}], version}` | новая версия черновика; новый этап получает `SKILL.md` и `references/procedure.md` из шаблона |
| `GET /v1/admin/methodology/revisions?limit=` | — | версии черновика, новые сверху: `[{id, at, by, message, files}]` |
| `GET /v1/admin/methodology/revisions/{id}/diff?against=` | — | `[{path, change: added \| removed \| changed, before, after}]` |
| `POST /v1/admin/methodology/revisions/{id}/restore` | — | новая версия черновика с файлами версии `id` |
| `POST /v1/admin/methodology/check` | — | `{ok, errors, findings, stages}` |
| `POST /v1/admin/methodology/publish` | `{channel: "test" \| "stable", note, important}`; `note` обязателен | опубликованная версия (`{version}` = `<версия манифеста>.r<номер версии черновика>`) и `check`; `check_failed` 422, если есть ошибки |
| `GET /v1/admin/methodology/export?revision=` | — | zip черновика |

Тариф: `id` (`self`, `guided`, `experts`), `title`, `price_rub_from`, `price_rub_to`, `months`, `device_limit`, `active` (0/1).

Ключ: `id`, `key_hint`, `tariff_id`, `issued_at`, `expires_at`, `device_limit`, `order_ref`, `revoked_at`, `revoke_reason`, `state` (`active`, `expiring`, `expired`, `revoked`), `devices [{install, first_seen, last_seen}]` (`install` — 8 знаков хэша установки), `last_seen`, `downloads`, `denied`, `watermark`.

Персональных данных в API нет: ни имён, ни почт, ни телефонов, ни IP. `order_ref` — только номер заказа платёжного сервиса.

## Агентства

Ключи агентствам выдаются пакетами (решение владельца 15.11.2026). Контакты представителя агентства хранятся только в таблице `agencies`; о пользователях ключей по-прежнему ничего личного.

| Запрос | Кто | Тело | Ответ |
|---|---|---|---|
| `GET /v1/admin/agencies` | админ | — | агентства со `stats {keys, by_state, active, activated, devices, last_seen}` |
| `POST /v1/admin/agencies` | админ | `name` (уникальное), `contact_name`, `phone`, `email`, `note` | агентство; 409 — название занято |
| `GET /v1/admin/agencies/{id}` | админ или это агентство | — | карточка: контакты, `stats`, `batches`; админу ещё `tokens` (без самих токенов) и `note` |
| `PATCH /v1/admin/agencies/{id}` | админ | поля карточки, `archived` | агентство; в архиве не выдаются пакеты и не работает вход агентства |
| `GET /v1/admin/agencies/{id}/keys` | админ или это агентство | — | ключи агентства; агентству — без номера заказа, водяного знака и версий методики |
| `GET /v1/admin/agencies/{id}/export.md` | админ или это агентство | — | список ключей в Markdown: начало ключа, даты, для кого, статус, устройства (полных ключей сервер не знает) |
| `POST /v1/admin/agencies/{id}/batches` | админ | `count` (1…200), `months` или `expires_at`, `device_limit`, `recipient` | `{batch, keys: [{id, key}], markdown, filename}` — полные ключи и файл с ними только в этом ответе |
| `POST /v1/admin/agencies/{id}/tokens` | админ | `label` | `{id, label, token}` — токен входа `jbsa_…` только в этом ответе, сервер хранит его HMAC |
| `DELETE /v1/admin/agencies/{id}/tokens/{token_id}` | админ | — | агентство; вход отозван |

Токен агентства: `whoami` → `{"role": "agency", "agency": {"id", "name"}}`. Все остальные разделы (все ключи, сводка, тариф, методика, версии, чужие агентства) отвечают 403.

## Архив

Ключи не удаляются: `archived_at` переносит ключ в архив. Ключ в архиве не работает (активация и проверка — 403 `key_revoked`, «Ключ отключён»), не попадает в списки, сводку и статистику агентств; `stats.archived` — сколько ключей в архиве. При переносе сохраняются `archive_reason`, `archive_note` и `archived_state` — состояние ключа в тот момент (`active`, `expiring`, `expired`, `revoked`; причина блокировки остаётся в `revoke_reason`). Повторный перенос уже архивного ключа причину не меняет. `unarchive` возвращает ключ в его раздел и очищает эти поля; история остаётся в журнале (`archive <reason>`, `unarchive`).
