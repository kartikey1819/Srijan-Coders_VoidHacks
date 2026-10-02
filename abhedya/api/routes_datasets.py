"""Dataset routes: upload a CSV, watch it being analysed, switch the active case. Owner: A. Additive only."""
import re

from fastapi import APIRouter, HTTPException, Query, Request

from abhedya import datasets
from contracts.models import DatasetInfo, DatasetProgress

router = APIRouter(prefix="/api")
_ID = re.compile(r"^(official|[0-9a-f]{12})$")


def _check(ds_id: str) -> str:
    if not _ID.match(ds_id):
        raise HTTPException(status_code=404, detail="Unknown dataset")
    return ds_id


@router.get("/datasets", response_model=list[DatasetInfo])
def list_datasets():
    return datasets.list_datasets()


@router.post("/datasets", response_model=DatasetProgress, status_code=202)
async def upload(request: Request, name: str = Query("upload.csv", max_length=200)):
    """The request body is the CSV itself (application/octet-stream), written to disk chunk by chunk."""
    w = datasets.UploadWriter(name)
    try:
        async for chunk in request.stream():
            w.write(chunk)
        ds_id, existed = w.finish()
    except ValueError as e:
        w.abort()
        raise HTTPException(status_code=413 if "1 GB" in str(e) else 422, detail=str(e))
    if not existed:
        datasets.enqueue(ds_id)
    p = datasets.progress(ds_id)
    if existed and p and p.status == "error":
        datasets.enqueue(ds_id)
        p = datasets.progress(ds_id)
    return p


@router.get("/datasets/{ds_id}/progress", response_model=DatasetProgress)
def get_progress(ds_id: str):
    p = datasets.progress(_check(ds_id))
    if p is None:
        raise HTTPException(status_code=404, detail="Unknown dataset")
    return p


@router.post("/datasets/{ds_id}/activate", response_model=DatasetInfo)
def activate(ds_id: str):
    try:
        return datasets.activate(_check(ds_id))
    except FileNotFoundError as e:
        raise HTTPException(status_code=409, detail=str(e))


@router.delete("/datasets/{ds_id}", response_model=list[DatasetInfo])
def remove(ds_id: str):
    """Removes a case (database, graph cache, stored copy). The official CSV itself is never deleted."""
    try:
        return datasets.remove(_check(ds_id))
    except KeyError:
        raise HTTPException(status_code=404, detail="Unknown dataset")
    except (ValueError, FileNotFoundError) as e:
        raise HTTPException(status_code=409, detail=str(e))
    except OSError as e:
        raise HTTPException(status_code=409, detail=f"Could not delete the files ({e.strerror or e}); close other programs using them and retry.")
