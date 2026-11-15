"""Agencies: keys in batches, a file with them, per-agency statistics and a read-only login of the agency."""
import re

import pytest
from fastapi.testclient import TestClient

from hrs_keys.app import create_app
from hrs_keys.service import Settings, generate_signing_key

ADMIN = {"Authorization": "Bearer admin-token-for-tests"}
AUTHOR = {"Authorization": "Bearer author-token"}
KEY_RE = re.compile(r"JBS-[A-Z0-9]{4}(?:-[A-Z0-9]{4}){4}")


@pytest.fixture
def server(tmp_path):
    settings = Settings(data=tmp_path / "data", secret=b"s" * 40, admin_token="admin-token-for-tests",
                        methodologist_token="author-token",
                        signing_key=tmp_path / "data" / "signing.pem", renew_url="https://example.test/renew")
    generate_signing_key(settings.signing_key)
    return TestClient(create_app(settings))


def agency(server, name="Ромашка", **extra):
    r = server.post("/v1/admin/agencies", json={"name": name, "contact_name": "Иван Петров", "phone": "+7 900 000-00-00",
                                                "email": "hr@romashka.test", **extra}, headers=ADMIN)
    assert r.status_code == 201, r.text
    return r.json()


def login(server, agency_id):
    r = server.post(f"/v1/admin/agencies/{agency_id}/tokens", json={"label": "Иван"}, headers=ADMIN)
    assert r.status_code == 201, r.text
    return {"Authorization": "Bearer " + r.json()["token"]}


def test_agency_card_and_unique_name(server):
    a = agency(server)
    assert (a["name"], a["contact_name"], a["phone"], a["email"]) == ("Ромашка", "Иван Петров", "+7 900 000-00-00",
                                                                      "hr@romashka.test")
    assert a["stats"]["keys"] == 0 and a["batches"] == [] and a["tokens"] == []
    assert server.post("/v1/admin/agencies", json={"name": "ромашка"}, headers=ADMIN).status_code == 409
    assert server.post("/v1/admin/agencies", json={"name": "  "}, headers=ADMIN).status_code == 400
    assert server.post("/v1/admin/agencies", json={"name": "Успех", "email": "нет"}, headers=ADMIN).status_code == 400
    r = server.patch(f"/v1/admin/agencies/{a['id']}", json={"phone": "+7 911", "name": "Ромашка 2"}, headers=ADMIN)
    assert (r.json()["phone"], r.json()["name"]) == ("+7 911", "Ромашка 2")
    assert [x["name"] for x in server.get("/v1/admin/agencies", headers=ADMIN).json()] == ["Ромашка 2"]


def test_batch_gives_keys_once_with_a_markdown_file(server):
    a = agency(server, name="Агентство 007")
    r = server.post(f"/v1/admin/agencies/{a['id']}/batches", json={"count": 3, "recipient": "Выпускники | весна"},
                    headers=ADMIN)
    assert r.status_code == 201, r.text
    out = r.json()
    keys = [k["key"] for k in out["keys"]]
    assert len(keys) == 3 == len(set(keys)) and all(KEY_RE.fullmatch(k) for k in keys)
    md = out["markdown"].replace("\u00a0", " ")
    assert "\u00a0" in out["markdown"] and "из\u00a0таблицы" in out["markdown"]  # no hanging prepositions
    assert md.startswith("# Ключи JobShturman — Агентство 007") and all(f"`{k}`" in md for k in keys)
    assert "Получатель: Выпускники / весна" in md and "действуют до:" in md and "https://jobsh.ru/#how" in md
    assert out["filename"].isascii() and out["filename"].startswith("jobshturman-keys-agentstvo-007-")
    # the keys work like any other key, and the server does not keep them
    act = server.post("/v1/activate", json={"key": keys[0], "install_id": "laptop-1"})
    assert act.status_code == 200, act.text
    listed = server.get(f"/v1/admin/agencies/{a['id']}/keys", headers=ADMIN).json()
    assert len(listed) == 3 and {k["segment"] for k in listed} == {"agency"}
    assert all(k["batch_id"] == out["batch"]["id"] and k["note"] == "Выпускники | весна" for k in listed)
    assert not any(k in r2.text for k in keys for r2 in [server.get(f"/v1/admin/agencies/{a['id']}/keys", headers=ADMIN),
                                                        server.get(f"/v1/admin/agencies/{a['id']}/export.md", headers=ADMIN)])
    card = server.get(f"/v1/admin/agencies/{a['id']}", headers=ADMIN).json()
    assert card["stats"]["keys"] == 3 and card["stats"]["activated"] == 1 and card["stats"]["active"] == 3
    assert card["batches"][0]["count"] == 3
    for bad in (0, 201, -1):
        assert server.post(f"/v1/admin/agencies/{a['id']}/batches", json={"count": bad}, headers=ADMIN).status_code == 422
    assert server.post("/v1/admin/agencies/nope/batches", json={"count": 1}, headers=ADMIN).status_code == 404


def test_export_lists_keys_without_the_keys(server):
    a = agency(server)
    server.post(f"/v1/admin/agencies/{a['id']}/batches", json={"count": 2}, headers=ADMIN)
    r = server.get(f"/v1/admin/agencies/{a['id']}/export.md", headers=ADMIN)
    assert r.status_code == 200 and r.headers["content-type"].startswith("text/markdown")
    assert "attachment" in r.headers["content-disposition"]
    assert r.text.count("| `JBS-") == 2 and "действует" in r.text and "Иван Петров" in r.text
    assert not KEY_RE.search(r.text)


def test_dashboard_splits_agencies_private_and_testers(server):
    a, b = agency(server, "Ромашка"), agency(server, "Успех")
    server.post(f"/v1/admin/agencies/{a['id']}/batches", json={"count": 2}, headers=ADMIN)
    server.post(f"/v1/admin/agencies/{b['id']}/batches", json={"count": 1}, headers=ADMIN)
    server.post("/v1/admin/keys", json={"order_ref": "P-1"}, headers=ADMIN)
    tester = server.post("/v1/admin/keys", json={"segment": "tester", "note": "Андрей"}, headers=ADMIN).json()
    assert tester["segment"] == "tester" and tester["note"] == "Андрей"
    # an agency key is issued only as a batch
    assert server.post("/v1/admin/keys", json={"segment": "agency"}, headers=ADMIN).status_code == 422
    stats = server.get("/v1/admin/stats", headers=ADMIN).json()
    assert {k: v["keys"] for k, v in stats["by_segment"].items()} == {"agency": 3, "private": 1, "tester": 1}
    assert {x["name"]: x["stats"]["keys"] for x in stats["agencies"]} == {"Ромашка": 2, "Успех": 1}
    def seg(query):
        return len(server.get(f"/v1/admin/keys?{query}", headers=ADMIN).json())
    assert (seg("segment=tester"), seg("segment=private"), seg(f"agency={a['id']}")) == (1, 1, 2)
    # a private key can be moved to an agency and back
    pk = server.get("/v1/admin/keys?segment=private", headers=ADMIN).json()[0]
    moved = server.patch(f"/v1/admin/keys/{pk['id']}", json={"segment": "agency", "agency_id": b["id"]}, headers=ADMIN)
    assert (moved.json()["segment"], moved.json()["agency_id"]) == ("agency", b["id"])
    assert server.patch(f"/v1/admin/keys/{pk['id']}", json={"segment": "agency", "agency_id": "nope"},
                        headers=ADMIN).status_code == 404
    back = server.patch(f"/v1/admin/keys/{pk['id']}", json={"segment": "tester"}, headers=ADMIN).json()
    assert (back["segment"], back["agency_id"]) == ("tester", None)


def test_agency_login_sees_only_its_own_keys(server):
    a, b = agency(server, "Ромашка"), agency(server, "Успех")
    server.post(f"/v1/admin/agencies/{a['id']}/batches", json={"count": 2}, headers=ADMIN)
    server.post(f"/v1/admin/agencies/{b['id']}/batches", json={"count": 1}, headers=ADMIN)
    own = login(server, a["id"])
    assert server.get("/v1/admin/whoami", headers=own).json() == {"role": "agency", "agency": {"id": a["id"], "name": "Ромашка"}}
    card = server.get(f"/v1/admin/agencies/{a['id']}", headers=own).json()
    assert card["stats"]["keys"] == 2 and "tokens" not in card and "note" not in card
    keys = server.get(f"/v1/admin/agencies/{a['id']}/keys", headers=own).json()
    assert len(keys) == 2 and not {"order_ref", "watermark", "channel", "pinned_version"} & set(keys[0])
    assert server.get(f"/v1/admin/agencies/{a['id']}/export.md", headers=own).status_code == 200
    # nothing else: other agencies, all keys, issuing, the methodology, logins
    k_other = server.get(f"/v1/admin/agencies/{b['id']}/keys", headers=ADMIN).json()[0]["id"]
    forbidden = [
        ("get", f"/v1/admin/agencies/{b['id']}", None), ("get", f"/v1/admin/agencies/{b['id']}/keys", None),
        ("get", f"/v1/admin/agencies/{b['id']}/export.md", None), ("get", "/v1/admin/agencies", None),
        ("get", "/v1/admin/keys", None), ("get", f"/v1/admin/keys/{k_other}", None), ("get", "/v1/admin/stats", None),
        ("post", "/v1/admin/keys", {}), ("post", f"/v1/admin/agencies/{a['id']}/batches", {"count": 1}),
        ("post", f"/v1/admin/agencies/{a['id']}/tokens", {}), ("patch", f"/v1/admin/agencies/{a['id']}", {"name": "X"}),
        ("patch", f"/v1/admin/keys/{k_other}", {"segment": "tester"}), ("post", f"/v1/admin/keys/{k_other}/revoke", {"reason": "other"}),
        ("get", "/v1/admin/methodology", None), ("get", "/v1/admin/bundles", None), ("patch", "/v1/admin/tariff", {"price_rub": 1}),
        ("get", "/v1/admin/methodology/export", None), ("post", "/v1/admin/methodology/check", None),
    ]
    for method, url, body in forbidden:
        r = getattr(server, method)(url, headers=own, **({"json": body} if body is not None else {}))
        assert r.status_code == 403, (method, url, r.status_code)
    # the methodologist does not see agencies either
    assert server.get(f"/v1/admin/agencies/{a['id']}", headers=AUTHOR).status_code == 403
    assert server.get("/v1/admin/agencies", headers=AUTHOR).status_code == 403


def test_agency_login_can_be_revoked_and_dies_with_the_archive(server):
    a = agency(server)
    r = server.post(f"/v1/admin/agencies/{a['id']}/tokens", json={"label": "Иван"}, headers=ADMIN).json()
    token = {"Authorization": "Bearer " + r["token"]}
    assert r["token"].startswith("jbsa_") and len(r["token"]) > 30
    card = server.get(f"/v1/admin/agencies/{a['id']}", headers=ADMIN).json()
    assert [t["label"] for t in card["tokens"]] == ["Иван"] and r["token"] not in str(card)
    assert server.get("/v1/admin/whoami", headers=token).status_code == 200
    assert server.get("/v1/admin/agencies/" + a["id"], headers=ADMIN).json()["tokens"][0]["last_used_at"]
    # a guessed token of the same shape does not work
    assert server.get("/v1/admin/whoami", headers={"Authorization": "Bearer jbsa_" + "x" * 32}).status_code == 403
    server.patch(f"/v1/admin/agencies/{a['id']}", json={"archived": True}, headers=ADMIN)
    assert server.get("/v1/admin/whoami", headers=token).status_code == 403
    assert server.post(f"/v1/admin/agencies/{a['id']}/batches", json={"count": 1}, headers=ADMIN).status_code == 400
    server.patch(f"/v1/admin/agencies/{a['id']}", json={"archived": False}, headers=ADMIN)
    assert server.get("/v1/admin/whoami", headers=token).status_code == 200
    server.delete(f"/v1/admin/agencies/{a['id']}/tokens/{r['id']}", headers=ADMIN)
    assert server.get("/v1/admin/whoami", headers=token).status_code == 403


def test_the_database_keeps_no_agency_tokens_or_keys_in_plain_text(server):
    a = agency(server)
    token = server.post(f"/v1/admin/agencies/{a['id']}/tokens", json={}, headers=ADMIN).json()["token"]
    keys = [k["key"] for k in server.post(f"/v1/admin/agencies/{a['id']}/batches", json={"count": 2}, headers=ADMIN).json()["keys"]]
    dump = server.app.state.ks.db.path.read_bytes()
    assert token.encode() not in dump and not any(k.encode() in dump for k in keys)


def test_bulk_move_is_all_or_nothing(server):
    a = agency(server)
    ids = [server.post("/v1/admin/keys", json={"order_ref": f"P-{i}"}, headers=ADMIN).json()["id"] for i in range(3)]
    r = server.post("/v1/admin/keys/bulk", json={"ids": ids[:2], "action": "move", "segment": "agency", "agency_id": a["id"]},
                    headers=ADMIN)
    assert r.status_code == 200 and r.json() == {"action": "move", "count": 2}
    assert len(server.get(f"/v1/admin/agencies/{a['id']}/keys", headers=ADMIN).json()) == 2
    server.post("/v1/admin/keys/bulk", json={"ids": ids, "action": "move", "segment": "tester"}, headers=ADMIN)
    assert {k["segment"] for k in server.get("/v1/admin/keys", headers=ADMIN).json()} == {"tester"}
    # one unknown id: nothing moves
    r = server.post("/v1/admin/keys/bulk", json={"ids": [ids[0], "nope"], "action": "move", "segment": "private"}, headers=ADMIN)
    assert r.status_code == 404 and server.get(f"/v1/admin/keys/{ids[0]}", headers=ADMIN).json()["segment"] == "tester"
    assert server.post("/v1/admin/keys/bulk", json={"ids": ids, "action": "move", "segment": "agency", "agency_id": "nope"},
                       headers=ADMIN).status_code == 404
    assert server.post("/v1/admin/keys/bulk", json={"ids": [], "action": "move", "segment": "tester"}, headers=ADMIN).status_code == 422
    assert server.post("/v1/admin/keys/bulk", json={"ids": ids, "action": "delete"}, headers=ADMIN).status_code == 422


def test_archive_switches_the_key_off_and_hides_it_until_it_comes_back(server):
    a = agency(server)
    out = server.post(f"/v1/admin/agencies/{a['id']}/batches", json={"count": 2}, headers=ADMIN).json()
    key, key_id = out["keys"][0]["key"], out["keys"][0]["id"]
    assert server.post("/v1/activate", json={"key": key, "install_id": "pc"}).status_code == 200
    # without the confirmation nothing happens
    r = server.post("/v1/admin/keys/bulk", json={"ids": [key_id], "action": "archive"}, headers=ADMIN)
    assert r.status_code == 400 and server.get(f"/v1/admin/keys/{key_id}", headers=ADMIN).json()["state"] == "active"
    # the reason is required; "other" needs a comment
    for bad in ({}, {"reason": "lost"}, {"reason": "other"}):
        r = server.post("/v1/admin/keys/bulk", json={"ids": [key_id], "action": "archive", "confirm": True, **bad}, headers=ADMIN)
        assert r.status_code in (400, 422), bad
    assert server.post("/v1/admin/keys/bulk", json={"ids": [key_id], "action": "archive", "confirm": True,
                                                    "reason": "unneeded", "note": "Группа  закрыта"}, headers=ADMIN).status_code == 200
    archived = server.get(f"/v1/admin/keys/{key_id}", headers=ADMIN).json()
    assert archived["state"] == "archived" and archived["archived_state"] == "active"
    assert (archived["archive_reason"], archived["archive_note"]) == ("unneeded", "Группа закрыта")
    # archiving again keeps the first reason
    server.post("/v1/admin/keys/bulk", json={"ids": [key_id], "action": "archive", "confirm": True, "reason": "expired"}, headers=ADMIN)
    assert server.get(f"/v1/admin/keys/{key_id}", headers=ADMIN).json()["archive_reason"] == "unneeded"
    refused = server.post("/v1/activate", json={"key": key, "install_id": "pc"})
    assert refused.status_code == 403 and refused.json()["error"] == "key_revoked"
    assert key_id not in [k["id"] for k in server.get("/v1/admin/keys", headers=ADMIN).json()]
    assert [k["id"] for k in server.get("/v1/admin/keys?archived=true", headers=ADMIN).json()] == [key_id]
    assert server.get(f"/v1/admin/agencies/{a['id']}", headers=ADMIN).json()["stats"]["keys"] == 1
    stats = server.get("/v1/admin/stats", headers=ADMIN).json()
    assert stats["keys"] == 1 and stats["archived"] == 1
    own = login(server, a["id"])
    assert len(server.get(f"/v1/admin/agencies/{a['id']}/keys", headers=own).json()) == 1
    assert server.post("/v1/admin/keys/bulk", json={"ids": [key_id], "action": "unarchive"}, headers=own).status_code == 403
    server.post("/v1/admin/keys/bulk", json={"ids": [key_id], "action": "unarchive"}, headers=ADMIN)
    back = server.get(f"/v1/admin/keys/{key_id}", headers=ADMIN).json()
    assert back["state"] == "active" and back["archive_reason"] is None and back["archived_state"] is None
    events = [e["detail"] for e in server.get(f"/v1/admin/keys/{key_id}/events", headers=ADMIN).json()]
    assert "archive unneeded" in events and "unarchive" in events
    assert server.post("/v1/activate", json={"key": key, "install_id": "pc"}).status_code == 200


def test_archive_remembers_that_a_key_was_revoked_or_expired(server):
    ids = [server.post("/v1/admin/keys", json={"order_ref": f"P-{i}"}, headers=ADMIN).json()["id"] for i in range(2)]
    server.post(f"/v1/admin/keys/{ids[0]}/revoke", json={"reason": "refund"}, headers=ADMIN)
    with server.app.state.ks.db.tx() as c:
        c.execute("UPDATE keys SET expires_at = '2020-01-01T00:00:00Z' WHERE id = ?", (ids[1],))
    server.post("/v1/admin/keys/bulk", json={"ids": ids, "action": "archive", "confirm": True, "reason": "revoked"}, headers=ADMIN)
    keys = {k["id"]: k for k in server.get("/v1/admin/keys?archived=true", headers=ADMIN).json()}
    assert (keys[ids[0]]["archived_state"], keys[ids[0]]["revoke_reason"]) == ("revoked", "refund")
    assert keys[ids[1]]["archived_state"] == "expired"
