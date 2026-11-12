from functools import lru_cache
from pathlib import Path

from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

BACKEND_DIR = Path(__file__).resolve().parent.parent
PROJECT_DIR = BACKEND_DIR.parent


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=BACKEND_DIR / ".env", env_file_encoding="utf-8", extra="ignore"
    )

    gnani_api_key: str = ""
    anthropic_api_key: str = ""
    cors_origins: str = "http://localhost:5173"
    database_url: str = ""  # empty → sqlite file in data_dir

    # Gnani Vachana (docs.gnani.ai)
    gnani_base_url: str = "https://api.vachana.ai"
    stt_model: str = "prisma-v3.0"  # falls back to prisma-v2.5 if the key can't use v3
    stt_language: str = "en-IN"  # en-IN also accepts Hindi-English mixed speech (Latin output)
    stt_timeout_s: float = 15.0
    gnani_max_retries: int = 2

    @field_validator("gnani_api_key", "anthropic_api_key")
    @classmethod
    def _strip(cls, v: str) -> str:
        return v.strip().strip('"').strip("'")

    cases_dir: Path = PROJECT_DIR / "cases"
    data_dir: Path = BACKEND_DIR / "data"
    audio_cache_dir: Path = BACKEND_DIR / "audio_cache"

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]

    @property
    def gnani_configured(self) -> bool:
        return bool(self.gnani_api_key.strip())

    @property
    def llm_configured(self) -> bool:
        return bool(self.anthropic_api_key.strip())


@lru_cache
def get_settings() -> Settings:
    return Settings()
