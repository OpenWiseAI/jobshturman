"""HTTP API of the key server. See API.md.

Client (hrs):  POST /v1/activate, GET /v1/status, GET /v1/bundle/latest; header X-Hrs-Version
Admin:         /v1/admin/... with `Authorization: Bearer <HRS_KEYS_ADMIN_TOKEN>`
Methodologist: /v1/admin/methodology/... and the bundle list with a token of HRS_KEYS_METHODOLOGIST_TOKEN
Agency:        its own card and keys only (/v1/admin/agencies/<its id>...), with a login token issued in the admin
"""
import hmac

from fastapi import Depends, FastAPI, Form, Header, Query, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, Response
from pydantic import BaseModel, Field

from .service import KeyServer, KeyServerError, Settings

MAX_UPLOAD = 20 * 1024 * 1024  # a bundle or a draft file; anything bigger is not a methodology


async def _body(file: UploadFile) -> bytes:
    """The uploaded file, read no further than the limit: a huge upload must not fill the server's memory."""
    data = await file.read(MAX_UPLOAD + 1)
    if len(data) > MAX_UPLOAD:
        raise KeyServerError("too_large", f"Файл больше {MAX_UPLOAD // (1024 * 1024)} МБ", 413)
    return data


class Activate(BaseModel):
    key: str = Field(max_length=64)
    install_id: str = Field(max_length=100)
    client: str | None = Field(None, max_length=40)


class Issue(BaseModel):
    tariff_id: str | None = None  # one tariff: the server fills it in
    segment: str = Field("private", pattern="^(private|tester)$")
    note: str | None = Field(None, max_length=200, description="для кого ключ")
    months: int | None = Field(None, ge=1, le=60)
    expires_at: str | None = None
    order_ref: str | None = Field(None, max_length=64, description="номер заказа в платёжном сервисе, без ФИО")
    device_limit: int | None = Field(None, ge=1, le=10)


class Extend(BaseModel):
    months: int | None = Field(None, ge=1, le=60)
    until: str | None = None


class Channel(BaseModel):
    channel: str = Field(pattern="^(stable|test)$")


class Publish(BaseModel):
    channel: str = Field(pattern="^(stable|test)$")
    note: str = Field(min_length=1, max_length=1000)  # what changed: people see it before they update
    important: bool = False  # installed without asking, with the note as the explanation


class Accept(BaseModel):
    version: str = Field(min_length=1, max_length=80)


class FileSave(BaseModel):
    path: str = Field(max_length=300)
    text: str = Field(max_length=2_000_000)
    base_sha: str | None = Field(None, max_length=64)
    message: str | None = Field(None, max_length=200)


class RouteSave(BaseModel):
    steps: list[dict]
    stages: list[dict]
    version: str | None = Field(None, max_length=40)


class Revoke(BaseModel):
    reason: str = Field(pattern="^(refund|violation|reissue|other)$")


class KeyPatch(BaseModel):
    segment: str | None = Field(None, pattern="^(private|tester|agency)$")
    agency_id: str | None = Field(None, max_length=20)
    note: str | None = Field(None, max_length=200)


class Bulk(BaseModel):
    ids: list[str] = Field(min_length=1, max_length=500)
    action: str = Field(pattern="^(move|archive|unarchive)$")
    segment: str | None = Field(None, pattern="^(private|tester|agency)$")
    agency_id: str | None = Field(None, max_length=20)
    confirm: bool = False
    reason: str | None = Field(None, pattern="^(expired|revoked|unneeded|other)$")
    note: str | None = Field(None, max_length=200)


class AgencyFields(BaseModel):
    name: str | None = Field(None, max_length=80)
    contact_name: str | None = Field(None, max_length=120)
    phone: str | None = Field(None, max_length=40)
    email: str | None = Field(None, max_length=120)
    note: str | None = Field(None, max_length=500)


class AgencyPatch(AgencyFields):
    archived: bool | None = None


class Batch(BaseModel):
    count: int = Field(ge=1, le=200)
    months: int | None = Field(None, ge=1, le=60)
    expires_at: str | None = None
    device_limit: int | None = Field(None, ge=1, le=10)
    recipient: str | None = Field(None, max_length=200)


class AgencyToken(BaseModel):
    label: str | None = Field(None, max_length=80)


class TariffPrice(BaseModel):
    price_rub: int = Field(ge=1, le=10_000_000)


def create_app(settings: Settings | None = None, admin_origins: list[str] | None = None) -> FastAPI:
    ks = KeyServer(settings or Settings.from_env())
    app = FastAPI(title="JobShturman keys", version="1", docs_url=None, redoc_url=None, openapi_url="/v1/openapi.json")
    app.state.ks = ks
    if admin_origins:
        app.add_middleware(CORSMiddleware, allow_origins=admin_origins, allow_methods=["*"],
                           allow_headers=["Authorization", "Content-Type"])

    @app.exception_handler(KeyServerError)
    async def on_error(request: Request, exc: KeyServerError):
        return JSONResponse({"error": exc.code, "message": str(exc)}, status_code=exc.status)

    def bearer(authorization: str | None) -> str:
        scheme, _, value = (authorization or "").partition(" ")
        if scheme.lower() != "bearer" or not value:
            raise KeyServerError("unauthorized", "Нужен заголовок Authorization: Bearer ...", 401)
        return value.strip()

    # HRS_KEYS_ADMIN_TOKEN may list several tokens, comma separated: one per admin, each revoked on its own.
    admin_tokens = [t.strip() for t in (ks.s.admin_token or "").split(",") if t.strip()]

    # The methodologist (the author of the methodology) edits and publishes it and sees nothing else.
    method_tokens = [t.strip() for t in (ks.s.methodologist_token or "").split(",") if t.strip()]

    def principal(authorization: str | None) -> dict:
        token = bearer(authorization)
        if any(hmac.compare_digest(token, known) for known in admin_tokens):
            return {"role": "admin"}
        if any(hmac.compare_digest(token, known) for known in method_tokens):
            return {"role": "methodologist"}
        agency = ks.agency_for_token(token)
        if agency:
            return {"role": "agency", "agency": agency}
        raise KeyServerError("forbidden", "Неверный токен администратора", 403)

    def admin(authorization: str | None = Header(None)):
        if principal(authorization)["role"] != "admin":
            raise KeyServerError("forbidden", "Этот раздел только для администратора", 403)

    def editor(authorization: str | None = Header(None)) -> str:
        """The methodology: the admin and the methodologist; an agency never."""
        role = principal(authorization)["role"]
        if role not in ("admin", "methodologist"):
            raise KeyServerError("forbidden", "Этот раздел недоступен", 403)
        return role

    def agency_reader(agency_id: str, authorization: str | None = Header(None)) -> bool:
        """The admin sees every agency (True), an agency only itself (False)."""
        who = principal(authorization)
        if who["role"] == "admin":
            return True
        if who["role"] == "agency" and hmac.compare_digest(who["agency"]["id"], agency_id):
            return False
        raise KeyServerError("forbidden", "Этот раздел недоступен", 403)

    # --- client ---

    @app.post("/v1/activate")
    def activate(body: Activate, x_hrs_version: str | None = Header(None)):
        return ks.activate(body.key, body.install_id, x_hrs_version)

    @app.get("/v1/status")
    def status(authorization: str | None = Header(None), x_hrs_version: str | None = Header(None)):
        return ks.status(bearer(authorization), x_hrs_version)

    @app.get("/v1/bundle/latest")
    def bundle(authorization: str | None = Header(None), x_hrs_version: str | None = Header(None)):
        meta, data = ks.bundle(bearer(authorization), x_hrs_version)
        return Response(data, media_type="application/zip", headers={
            "X-Bundle-Version": meta["version"], "X-Bundle-Sha256": meta["sha256"],
            "X-Bundle-Signature": meta["signature"],
            "Content-Disposition": f'attachment; filename="methodology-{meta["version"]}.zip"'})

    @app.post("/v1/methodology/export")
    def export(authorization: str | None = Header(None)):
        """Download the whole methodology: always refused by the licence."""
        scheme, _, value = (authorization or "").partition(" ")
        ks.export(value.strip() if scheme.lower() == "bearer" else None)

    @app.post("/v1/bundle/accept")
    def accept(body: Accept, authorization: str | None = Header(None), x_hrs_version: str | None = Header(None)):
        return ks.accept(bearer(authorization), body.version, x_hrs_version)

    @app.get("/v1/health")
    def health():
        return {"ok": True}

    # Public: the landing shows the price from here, so an admin edit reaches the page without a redeploy.
    # Only the tariff on sale; the list shape is kept for installed clients and checks.
    @app.get("/v1/tariffs")
    def public_tariffs(response: Response):
        response.headers["Cache-Control"] = "public, max-age=60"
        t = ks.tariff()
        return [{"id": t["id"], "title": t["title"], "price_rub_from": t["price_rub_from"],
                 "price_rub_to": t["price_rub_to"], "months": t["months"], "device_limit": t["device_limit"],
                 "active": bool(t["active"])}]

    # --- admin ---

    a = [Depends(admin)]

    @app.get("/v1/admin/stats", dependencies=a)
    def stats():
        return ks.stats()

    @app.get("/v1/admin/tariffs", dependencies=a)
    def tariffs():
        return ks.tariffs()

    @app.get("/v1/admin/tariff", dependencies=a)
    def tariff():
        return ks.tariff()

    @app.patch("/v1/admin/tariff", dependencies=a)
    def tariff_price(body: TariffPrice):
        return ks.set_price(body.price_rub)

    @app.get("/v1/admin/keys", dependencies=a)
    def keys(state: str | None = None, segment: str | None = Query(None, pattern="^(private|tester|agency)$"),
             agency: str | None = Query(None, max_length=20), archived: bool = False):
        return ks.keys(state, segment, agency, archived)

    @app.post("/v1/admin/keys/bulk", dependencies=a)
    def keys_bulk(body: Bulk):
        return ks.bulk(body.ids, body.action, body.segment, body.agency_id, body.confirm, body.reason, body.note)

    @app.patch("/v1/admin/keys/{key_id}", dependencies=a)
    def key_patch(key_id: str, body: KeyPatch):
        return ks.set_segment(key_id, body.segment, body.agency_id, body.note)

    # --- agencies ---

    @app.get("/v1/admin/agencies", dependencies=a)
    def agencies():
        return ks.agencies()

    @app.post("/v1/admin/agencies", dependencies=a, status_code=201)
    def agency_create(body: AgencyFields):
        return ks.create_agency(**body.model_dump())

    @app.get("/v1/admin/agencies/{agency_id}")
    def agency(agency_id: str, full: bool = Depends(agency_reader)):
        return ks.agency(agency_id, full=full)

    @app.patch("/v1/admin/agencies/{agency_id}", dependencies=a)
    def agency_patch(agency_id: str, body: AgencyPatch):
        return ks.update_agency(agency_id, **body.model_dump(exclude_none=True))

    @app.get("/v1/admin/agencies/{agency_id}/keys")
    def agency_keys(agency_id: str, full: bool = Depends(agency_reader)):
        keys = ks.keys(agency_id=agency_id)
        return keys if full else [ks.agency_key_view(k) for k in keys]

    @app.get("/v1/admin/agencies/{agency_id}/export.md")
    def agency_export(agency_id: str, full: bool = Depends(agency_reader)):
        text, filename = ks.agency_markdown(agency_id)
        return Response(text, media_type="text/markdown; charset=utf-8",
                        headers={"Content-Disposition": f'attachment; filename="{filename}"'})

    @app.post("/v1/admin/agencies/{agency_id}/batches", dependencies=a, status_code=201)
    def agency_batch(agency_id: str, body: Batch):
        return ks.issue_batch(agency_id, body.count, body.months, body.expires_at, body.device_limit, body.recipient)

    @app.post("/v1/admin/agencies/{agency_id}/tokens", dependencies=a, status_code=201)
    def agency_token(agency_id: str, body: AgencyToken):
        return ks.create_agency_token(agency_id, body.label)

    @app.delete("/v1/admin/agencies/{agency_id}/tokens/{token_id}", dependencies=a)
    def agency_token_revoke(agency_id: str, token_id: str):
        return ks.revoke_agency_token(agency_id, token_id)

    @app.post("/v1/admin/keys", dependencies=a, status_code=201)
    def issue(body: Issue):
        return ks.issue(**body.model_dump())

    @app.get("/v1/admin/keys/{key_id}", dependencies=a)
    def key(key_id: str):
        return ks.key(key_id)

    @app.post("/v1/admin/keys/{key_id}/extend", dependencies=a)
    def extend(key_id: str, body: Extend):
        return ks.extend(key_id, body.months, body.until)

    @app.post("/v1/admin/keys/{key_id}/revoke", dependencies=a)
    def revoke(key_id: str, body: Revoke):
        return ks.revoke(key_id, body.reason)

    @app.post("/v1/admin/keys/{key_id}/restore", dependencies=a)
    def restore(key_id: str):
        return ks.restore(key_id)

    @app.post("/v1/admin/keys/{key_id}/reset-devices", dependencies=a)
    def reset_devices(key_id: str):
        return ks.reset_devices(key_id)

    @app.delete("/v1/admin/keys/{key_id}/devices/{install}", dependencies=a)
    def unbind_device(key_id: str, install: str):
        return ks.unbind_device(key_id, install)

    @app.get("/v1/admin/keys/{key_id}/events", dependencies=a)
    def key_events(key_id: str, limit: int = Query(100, ge=1, le=1000)):
        return ks.events(key_id, limit)

    @app.get("/v1/admin/whoami")
    def whoami(authorization: str | None = Header(None)):
        return principal(authorization)

    @app.post("/v1/admin/keys/{key_id}/channel", dependencies=a)
    def key_channel(key_id: str, body: Channel):
        return ks.set_channel(key_id, body.channel)

    @app.get("/v1/admin/bundles")
    def bundles(role: str = Depends(editor)):
        return ks.bundle_list()

    @app.post("/v1/admin/bundles/{version}/current")
    def bundle_current(version: str, body: Channel, role: str = Depends(editor)):
        return ks.set_current(version, body.channel)

    # --- the methodology editor ---

    m = "/v1/admin/methodology"

    @app.get(m)
    def draft(role: str = Depends(editor)):
        return ks.draft()

    @app.get(m + "/file")
    def draft_file(path: str, revision: int | None = None, role: str = Depends(editor)):
        return ks.draft_file(path, revision)

    @app.put(m + "/file")
    def draft_save(body: FileSave, role: str = Depends(editor)):
        return ks.draft_save(body.path, body.text, body.base_sha, role, body.message)

    @app.delete(m + "/file")
    def draft_delete(path: str, base_sha: str, role: str = Depends(editor)):
        return ks.draft_delete(path, base_sha, role)

    @app.post(m + "/upload")
    async def draft_upload(file: UploadFile, path: str | None = Query(None, max_length=300),
                           role: str = Depends(editor)):
        return ks.draft_upload(file.filename or "file", await _body(file), role, path)

    @app.post(m + "/import-current")
    def draft_import(role: str = Depends(editor)):
        return ks.draft_import_current(role)

    @app.put(m + "/route")
    def draft_route(body: RouteSave, role: str = Depends(editor)):
        return ks.draft_route(body.steps, body.stages, role, body.version)

    @app.get(m + "/revisions")
    def draft_revisions(limit: int = Query(100, ge=1, le=1000), role: str = Depends(editor)):
        return ks.draft_revisions(limit)

    @app.get(m + "/revisions/{revision}/diff")
    def draft_diff(revision: int, against: int | None = None, role: str = Depends(editor)):
        return ks.draft_diff(revision, against)

    @app.post(m + "/revisions/{revision}/restore")
    def draft_restore(revision: int, role: str = Depends(editor)):
        return ks.draft_restore(revision, role)

    @app.post(m + "/check")
    def draft_check(role: str = Depends(editor)):
        return ks.draft_check()

    @app.post(m + "/publish", status_code=201)
    def draft_publish(body: Publish, role: str = Depends(editor)):
        return ks.draft_publish(body.channel, role, body.note, body.important)

    @app.get(m + "/export")
    def draft_export(revision: int | None = None, role: str = Depends(editor)):
        return Response(ks.draft_export(revision), media_type="application/zip", headers={
            "Content-Disposition": 'attachment; filename="methodology-draft.zip"'})

    @app.post("/v1/admin/bundles", dependencies=a, status_code=201)
    async def publish(file: UploadFile, note: str = Form(""), important: bool = Form(False)):
        return ks.publish(await _body(file), note=note, important=important)

    @app.get("/v1/admin/signing-key", dependencies=a)
    def signing_key():
        return {"public_key": ks.public_key(), "algorithm": "Ed25519"}

    return app

