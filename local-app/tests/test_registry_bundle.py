import json

from hrshturman_local import collector_feed

CSV = ("source_id,current_username,current_name,included_in_search\n"
       "TG-1,@finjobs,Финансовые,да\n")


class FakeClient:
    def __init__(self, existing=None):
        self._sources = list(existing or [])
        self.imported = None

    def sources(self):
        return self._sources

    def import_telegram_registry_text(self, text):
        self.imported = text
        self._sources = [{"source_id": "TG-1", "origin": "registry_csv"}]
        return {"created": 1, "updated": 0, "total": 1}


class FakeLib:
    def __init__(self, files):
        self.files = files

    def read(self, name):
        if name in self.files:
            return self.files[name]
        raise KeyError(name)


def test_auto_import_reads_target_sources_from_manifest():
    lib = FakeLib({
        "library_manifest.json": json.dumps({"target_sources": "telegram_channels.csv"}),
        "telegram_channels.csv": CSV,
    })
    client = FakeClient()
    assert collector_feed.ensure_telegram_registry(client, lib) == {"created": 1, "updated": 0, "total": 1}
    assert client.imported == CSV


def test_auto_import_is_skipped_when_registry_sources_exist():
    lib = FakeLib({"telegram_channels.csv": CSV})
    client = FakeClient(existing=[{"source_id": "TG-1", "origin": "registry_csv"}])
    assert collector_feed.ensure_telegram_registry(client, lib) is None
    assert client.imported is None


def test_auto_import_falls_back_to_known_path_without_manifest():
    lib = FakeLib({"telegram_channels.csv": CSV})
    client = FakeClient()
    assert collector_feed.ensure_telegram_registry(client, lib)["total"] == 1


def test_auto_import_no_registry_in_bundle_is_a_noop():
    lib = FakeLib({"library_manifest.json": json.dumps({"version": "0.4.0"})})
    client = FakeClient()
    assert collector_feed.ensure_telegram_registry(client, lib) is None
    assert client.imported is None


def test_auto_import_ignores_escaping_manifest_pointer():
    lib = FakeLib({
        "library_manifest.json": json.dumps({"target_sources": "../../outside.csv"}),
        "telegram_channels.csv": CSV,
    })
    client = FakeClient()
    # the ".." pointer is ignored; the fallback path is used instead
    assert collector_feed.ensure_telegram_registry(client, lib)["total"] == 1
    assert client.imported == CSV
