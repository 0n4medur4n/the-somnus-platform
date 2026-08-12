from __future__ import annotations

from morpheo.infrastructure.db import create_engine_from_url


def test_create_engine_from_url_builds_a_lazy_mysql_engine() -> None:
    """Engine creation must not connect (cost policy §2: no eager pool warm-up)."""
    engine = create_engine_from_url("mysql+pymysql://user:pw@127.0.0.1:3306/somnus_morpheo")
    try:
        assert engine.dialect.name == "mysql"
        assert engine.pool.size() == 1
    finally:
        engine.dispose()
