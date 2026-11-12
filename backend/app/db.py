from collections.abc import Iterator

from sqlalchemy import Engine
from sqlmodel import Session, SQLModel, create_engine

from .config import get_settings

_engine: Engine | None = None


def get_engine() -> Engine:
    global _engine
    if _engine is None:
        settings = get_settings()
        settings.data_dir.mkdir(parents=True, exist_ok=True)
        url = settings.database_url or f"sqlite:///{settings.data_dir / 'mystery.db'}"
        _engine = create_engine(url, connect_args={"check_same_thread": False})
    return _engine


def init_db(engine: Engine | None = None) -> None:
    from . import models  # noqa: F401  (register tables)

    SQLModel.metadata.create_all(engine or get_engine())


def get_db() -> Iterator[Session]:
    with Session(get_engine()) as session:
        yield session
