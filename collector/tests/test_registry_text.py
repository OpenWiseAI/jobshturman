from hrs_collector.service import Collector

HEADER = "source_id,current_username,current_name,included_in_search"


def _collector(tmp_path):
    return Collector(tmp_path / "data")


def test_registry_import_from_text_matches_the_file_import(tmp_path):
    core = _collector(tmp_path)
    text = f"﻿{HEADER}\nTG-1,@finjobs,Финансовые вакансии,да\nTG-2,,Закрытый канал,нет\n"
    assert core.import_telegram_registry_text("me", text) == {"created": 2, "updated": 0, "total": 2}
    by_id = {s.source_id: s for s in core.list_sources("me")}
    assert by_id["TG-1"].enabled and by_id["TG-1"].spec.transport == "telegram_web"
    assert not by_id["TG-2"].enabled and by_id["TG-2"].spec.transport == "telegram_mtproto"
    assert by_id["TG-1"].origin == "registry_csv"


def test_registry_text_reimport_keeps_rows(tmp_path):
    core = _collector(tmp_path)
    text = f"{HEADER}\nTG-1,@finjobs,Финансовые,да\n"
    core.import_telegram_registry_text("me", text)
    assert core.import_telegram_registry_text("me", text) == {"created": 0, "updated": 1, "total": 1}


def test_registry_text_skips_blank_source_id(tmp_path):
    core = _collector(tmp_path)
    text = f"{HEADER}\nTG-1,@a,A,да\n,,,\n"
    assert core.import_telegram_registry_text("me", text)["total"] == 1
