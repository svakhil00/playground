import base64
import json
from typing import Any

import boto3

# Hardcoded defaults for simple cloud testing.
DEFAULT_TEST_TEXT = "Hi, my son Elijah works at TechStartup Inc and makes $85,000 per year."
MAX_INPUT_CHARS = 12_000

comprehend = boto3.client("comprehend")


TASK_INSTRUCTION = """You are an anonymizer. Your task is to identify and replace personally identifiable information (PII) in the given text.
Replace PII entities with semantically equivalent alternatives that preserve the context needed for a good response.
If no PII is found or replacement is not needed, return an empty replacements list.

REPLACEMENT RULES:
• Personal names: Replace private or small-group individuals. Pick same culture + gender + era; keep surnames aligned across family members. DO NOT replace globally recognised public figures (heads of state, Nobel laureates, A-list entertainers, Fortune-500 CEOs, etc.).
• Companies / organisations: Replace private, niche, employer & partner orgs. Invent a fictitious org in the same industry & size tier; keep legal suffix. Keep major public companies (anonymity set ≥ 1,000,000).
• Projects / codenames / internal tools: Always replace with a neutral two-word alias of similar length.
• Locations: Replace street addresses, buildings, villages & towns < 100k pop with a same-level synthetic location inside the same state/country. Keep big cities (≥ 1M), states, provinces, countries, iconic landmarks.
• Dates & times: Replace birthdays, meeting invites, exact timestamps. Shift day/month by small amounts while KEEPING THE SAME YEAR to maintain temporal context. DO NOT shift public holidays or famous historic dates ("July 4 1776", "Christmas Day", "9/11/2001", etc.). Keep years, fiscal quarters, decade references unchanged.
• Identifiers: (emails, phone #s, IDs, URLs, account #s) Always replace with format-valid dummies; keep domain class (.com big-tech, .edu, .gov).
• Monetary values: Replace personal income, invoices, bids by × [0.8 – 1.25] to keep order-of-magnitude. Keep public list prices & market caps.
• Quotes / text snippets: If the quote contains PII, swap only the embedded tokens; keep the rest verbatim."""


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


def anonymize_text(query: str) -> dict[str, Any]:
    query = query[:MAX_INPUT_CHARS]
    resp = comprehend.detect_pii_entities(Text=query, LanguageCode="en")
    entities = resp.get("Entities", [])

    # Build stable placeholders per type (PERSON_1, EMAIL_1, etc.)
    counters: dict[str, int] = {}
    replacements: list[dict[str, Any]] = []
    for ent in entities:
        begin = ent.get("BeginOffset")
        end = ent.get("EndOffset")
        etype = ent.get("Type")
        if not isinstance(begin, int) or not isinstance(end, int) or not isinstance(etype, str):
            continue
        if begin < 0 or end <= begin or end > len(query):
            continue
        original = query[begin:end]
        counters[etype] = counters.get(etype, 0) + 1
        replacement = f"{etype}_{counters[etype]}"
        replacements.append({"original": original, "replacement": replacement, "begin": begin, "end": end, "type": etype})

    # Apply from right-to-left so offsets remain valid.
    anonymized = query
    for r in sorted(replacements, key=lambda x: x["begin"], reverse=True):
        anonymized = anonymized[: r["begin"]] + r["replacement"] + anonymized[r["end"] :]

    # Return the simple {original,replacement} list you used elsewhere.
    simple = [{"original": r["original"], "replacement": r["replacement"]} for r in replacements]
    return {"replacements": simple, "anonymized_text": anonymized}


def lambda_handler(event: dict[str, Any], context: object) -> dict[str, Any]:
    """API Gateway proxy: POST /anonymize with JSON body ``{\"text\": \"...\"}``."""
    # For quick cloud testing: if the request body is missing/invalid, fall back to a
    # hardcoded test string instead of failing the request.
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

    result = anonymize_text(text)
    return {
        "statusCode": 200,
        "headers": {"Content-Type": "application/json"},
        "body": json.dumps(
            {
                "ok": True,
                "input_chars": len(text),
                **result,
            }
        ),
    }
