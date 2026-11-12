import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .config import get_settings
from .db import init_db
from .engine.case_loader import all_cases
from .routers import accusation, board, cases, interrogation, player, sessions, voice
from .voice.gnani_client import close_gnani

settings = get_settings()
logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")


@asynccontextmanager
async def lifespan(_: FastAPI):
    all_cases()  # load + validate every case now; a broken case fails startup loudly
    init_db()
    yield
    await close_gnani()


app = FastAPI(title="Mystery Class API", version="0.7.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/api/health")
def health() -> dict:
    # Report whether integrations are configured — never the values themselves.
    return {
        "status": "ok",
        "version": app.version,
        "integrations": {
            "gnani": settings.gnani_configured,
            "llm": settings.llm_configured,
        },
    }


app.include_router(cases.router)
app.include_router(player.router)
app.include_router(sessions.router)
app.include_router(voice.router)
app.include_router(interrogation.router)
app.include_router(board.router)
app.include_router(accusation.router)
