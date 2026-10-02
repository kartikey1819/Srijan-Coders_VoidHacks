"""Narrative drafting with a local Ollama model. Owner: C.

The model gets facts only (ai/prompts.py), must answer in the Narrative JSON schema at temperature 0,
and its answer must pass ai/validator.py. One retry with the reasons; otherwise None and the caller
uses the deterministic fallback. Nothing leaves the machine: the model runs on 127.0.0.1.
"""
import os

import httpx
from pydantic import ValidationError

from abhedya.ai.prompts import AI_SECTIONS, SYSTEM, user_message
from abhedya.ai.validator import validate_narrative
from contracts.models import Evidence, Narrative

OLLAMA_URL = os.environ.get("ABHEDYA_OLLAMA_URL", "http://127.0.0.1:11434")
MODEL = os.environ.get("ABHEDYA_LLM_MODEL", "qwen2.5:3b")
TIMEOUT_S = float(os.environ.get("ABHEDYA_LLM_TIMEOUT", "90"))
# the model is on this machine: a listening server accepts at once, so a short connect limit makes the
# "model not running" case fall back quickly (Windows retries a refused connection for ~2 s otherwise)
CONNECT_TIMEOUT_S = 1.0


def _inline(schema: dict) -> dict:
    """Inline $defs/$ref: some Ollama versions ignore references in `format`."""
    defs = schema.pop("$defs", {})

    def walk(x):
        if isinstance(x, dict):
            if "$ref" in x:
                return walk(dict(defs[x["$ref"].split("/")[-1]]))
            return {k: walk(v) for k, v in x.items()}
        if isinstance(x, list):
            return [walk(v) for v in x]
        return x

    return walk(schema)


def _bounded(schema: dict) -> dict:
    """Hard limits inside the grammar the model must follow: only the prose sections, short paragraphs,
    so generation always ends well inside the token budget."""
    sec = schema["properties"]["sections"]
    sec["minItems"], sec["maxItems"] = 1, len(AI_SECTIONS)
    sec["items"]["properties"]["section_id"]["enum"] = list(AI_SECTIONS)
    par = sec["items"]["properties"]["paragraphs"]
    par["minItems"], par["maxItems"] = 1, 2
    para = par["items"]["properties"]
    para["text"]["maxLength"] = 600
    para["refs"]["maxItems"] = 12
    return schema


SCHEMA = _bounded(_inline(Narrative.model_json_schema()))
OPTIONS = {"temperature": 0, "num_ctx": 8192, "num_predict": 1600}


def narrate_with_status(ev: Evidence, client: httpx.Client | None = None) -> tuple[Narrative | None, str | None]:
    """Returns (narrative, None) on success or (None, reason)."""
    own = client is None
    client = client or httpx.Client(base_url=OLLAMA_URL, timeout=httpx.Timeout(TIMEOUT_S, connect=CONNECT_TIMEOUT_S))
    errors: list[str] = []
    try:
        for _ in range(2):
            try:
                r = client.post("/api/chat", json={
                    "model": MODEL, "stream": False, "format": SCHEMA, "options": OPTIONS,
                    "messages": [{"role": "system", "content": SYSTEM},
                                 {"role": "user", "content": user_message(ev, errors)}],
                })
                r.raise_for_status()
                content = r.json()["message"]["content"]
            except (httpx.HTTPError, KeyError, ValueError) as e:
                return None, f"local AI model unavailable ({type(e).__name__})"
            try:
                n = Narrative.model_validate_json(content)
            except ValidationError:
                errors = ["the reply did not match the JSON schema"]
                continue
            errors = validate_narrative(n, ev, AI_SECTIONS)
            if not errors:
                return n, None
        return None, "AI narrative rejected by the validator: " + "; ".join(errors[:3])
    finally:
        if own:
            client.close()


def narrate(ev: Evidence) -> Narrative | None:
    return narrate_with_status(ev)[0]
