import base64
import json
from typing import Any

import boto3

# "Model 2": different behavior — uses Comprehend but returns redactions instead of placeholders.
DEFAULT_TEST_TEXT = "Hi, my son Elijah works at TechStartup Inc and makes $85,000 per year."
MAX_INPUT_CHARS = 12_000

comprehend = boto3.client("comprehend")


def _apply_replacements(text: str, replacements: list[dict[str, Any]]) -> str:
    pairs: list[tuple[str, str]] = []
    for r in replacements:
        o = r.get("original")
        n = r.get("replacement")
        if isinstance(o, str) and isinstance(n, str) and o:
            pairs.append((o, n))
    pairs.sort(key=lambda x: len(x[0]), reverse=True)
    out = text
    for old, new in pairs:
        out = out.replace(old, new)
    return out


def run_model2(query: str) -> dict[str, Any]:
    query = query[:MAX_INPUT_CHARS]
    resp = comprehend.detect_pii_entities(Text=query, LanguageCode="en")
    entities = resp.get("Entities", [])

    # Redact spans, but keep distinct placeholders per unique entity string
    # so different names don't collapse into the same token.
    replacements: list[dict[str, Any]] = []
    seen: dict[str, dict[str, int]] = {}  # type -> original -> id
    counters: dict[str, int] = {}  # type -> next id
    for ent in entities:
        begin = ent.get("BeginOffset")
        end = ent.get("EndOffset")
        etype = ent.get("Type")
        if not isinstance(begin, int) or not isinstance(end, int) or not isinstance(etype, str):
            continue
        if begin < 0 or end <= begin or end > len(query):
            continue
        original = query[begin:end]
        # Assign stable numbering within each type based on the exact substring.
        bucket = seen.setdefault(etype, {})
        if original not in bucket:
            counters[etype] = counters.get(etype, 0) + 1
            bucket[original] = counters[etype]
        replacement = f"[{etype}_{bucket[original]}]"
        replacements.append({"original": original, "replacement": replacement})

    anonymized = _apply_replacements(query, replacements)
    return {"replacements": replacements, "anonymized_text": anonymized}


def lambda_handler(event: dict[str, Any], context: object) -> dict[str, Any]:
    text = DEFAULT_TEST_TEXT
    try:
        raw = event.get("body")
        if raw:
            if event.get("isBase64Encoded"):
                raw = base64.b64decode(raw).decode("utf-8")
            payload = json.loads(raw)
            candidate = payload.get("text", DEFAULT_TEST_TEXT)
            if isinstance(candidate, str) and candidate:
                text = candidate
    except (json.JSONDecodeError, TypeError, UnicodeDecodeError):
        pass

    result = run_model2(text)
    return {
        "statusCode": 200,
        "headers": {"Content-Type": "application/json"},
        "body": json.dumps({"ok": True, "input_chars": len(text), **result}),
    }

