"""FastAPI app: mounts the three owners' routers and the built web UI. Owner: A.
Run with `python -m abhedya serve` (127.0.0.1, one worker)."""
from fastapi import FastAPI, Request
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from abhedya import config
from abhedya.api import routes_datasets, routes_docs, routes_risk, routes_trace
from abhedya.engine import UnknownAccount

# no /docs or /redoc pages: they load scripts from an internet CDN and the app must work offline
app = FastAPI(title="Abhedya-Chakra", docs_url=None, redoc_url=None)
app.include_router(routes_trace.router)
app.include_router(routes_risk.router)
app.include_router(routes_docs.router)
app.include_router(routes_datasets.router)


@app.exception_handler(UnknownAccount)
async def not_found(_: Request, exc: UnknownAccount):
    return JSONResponse(status_code=404, content={"detail": str(exc.args[0]) if exc.args else "Not found"})


@app.exception_handler(FileNotFoundError)
async def not_ingested(_: Request, exc: FileNotFoundError):
    return JSONResponse(status_code=503, content={"detail": str(exc)})


if (config.WEB_DIST / "index.html").exists():
    app.mount("/assets", StaticFiles(directory=config.WEB_DIST / "assets"), name="assets")

    @app.get("/{path:path}", include_in_schema=False)
    async def spa(path: str):
        if path == "api" or path.startswith("api/"):  # unknown API paths stay 404, never the UI page
            return JSONResponse(status_code=404, content={"detail": "Not found"})
        f = (config.WEB_DIST / path).resolve()
        if path and f.is_file() and config.WEB_DIST.resolve() in f.parents:
            return FileResponse(f)
        return FileResponse(config.WEB_DIST / "index.html")
