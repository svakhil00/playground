"""
Lambda handler: S3 ObjectCreated -> read object body -> run Anonymizer -> return JSON.

Deploy: set the handler to ``model1.lambda_handler`` (if this file is model1.py in the zip
root) or rename the file to lambda_function.py and use ``lambda_function.lambda_handler``.
You still need a deployment package or container image with torch, transformers, and
dependencies — the inline console editor cannot supply those wheels by itself.

Optional env vars:
  MODEL_NAME   Hugging Face repo id (default: eternisai/Anonymizer-0.6B)
  MAX_INPUT_CHARS  Truncate input text (default: 12000)
  MAX_NEW_TOKENS   Generation cap (default: 250)
"""

from __future__ import annotations

import json
import os
import urllib.parse
from typing import Any, Optional

import boto3

# Writable cache on Lambda (must be before Hugging Face imports take effect)
os.environ.setdefault("TRANSFORMERS_CACHE", "/tmp/hf_transformers")
os.environ.setdefault("HF_HOME", "/tmp/hf_home")

from transformers import AutoModelForCausalLM, AutoTokenizer  # noqa: E402
import torch  # noqa: E402

print("Loading module (model loads on first invocation)")

s3 = boto3.client("s3")

_model: Any = None
_tokenizer: Any = None
_device: Optional[torch.device] = None

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

TOOLS = [
    {
        "type": "function",
        "function": {
            "name": "replace_entities",
            "description": "Replace PII entities with anonymized versions",
            "parameters": {
                "type": "object",
                "properties": {
                    "replacements": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "properties": {
                                "original": {"type": "string"},
                                "replacement": {"type": "string"},
                            },
                            "required": ["original", "replacement"],
                        },
                    }
                },
                "required": ["replacements"],
            },
        },
    }
]


def pick_device() -> torch.device:
    if torch.backends.mps.is_available():
        return torch.device("mps")
    if torch.cuda.is_available():
        return torch.device("cuda")
    return torch.device("cpu")


def get_model_and_tokenizer() -> tuple[Any, Any, torch.device]:
    global _model, _tokenizer, _device
    if _model is not None and _tokenizer is not None and _device is not None:
        return _model, _tokenizer, _device

    model_name = os.environ.get("MODEL_NAME", "eternisai/Anonymizer-0.6B")
    _device = pick_device()
    dtype = torch.float16 if _device.type in ("mps", "cuda") else torch.float32

    print(f"Loading model {model_name!r} on {_device} …")
    tok = AutoTokenizer.from_pretrained(model_name, trust_remote_code=True)
    mdl = AutoModelForCausalLM.from_pretrained(
        model_name,
        torch_dtype=dtype,
        trust_remote_code=True,
    ).to(_device)

    _tokenizer = tok
    _model = mdl
    return _model, _tokenizer, _device


def parse_replacements(text: str) -> Optional[list[dict[str, Any]]]:
    try:
        if "<|tool_call|>" in text:
            start = text.find("<|tool_call|>") + len("<|tool_call|>")
            end = text.find("</|tool_call|>")
        elif "<tool_call>" in text:
            start = text.find("<tool_call>") + len("<tool_call>")
            end = text.find("</tool_call>")
        else:
            return None
        if end == -1:
            return None
        tool_data = json.loads(text[start:end].strip())
        reps = tool_data.get("arguments", {}).get("replacements", [])
        return reps if isinstance(reps, list) else None
    except (json.JSONDecodeError, TypeError, ValueError, KeyError):
        return None


def apply_replacements(text: str, replacements: list[dict[str, Any]]) -> str:
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
    model, tokenizer, device = get_model_and_tokenizer()
    max_new = int(os.environ.get("MAX_NEW_TOKENS", "250"))

    messages = [
        {"role": "system", "content": TASK_INSTRUCTION},
        {"role": "user", "content": query + "\n/no_think"},
    ]
    formatted_prompt = tokenizer.apply_chat_template(
        messages,
        tools=TOOLS,
        tokenize=False,
        add_generation_prompt=True,
    )
    inputs = tokenizer(formatted_prompt, return_tensors="pt", truncation=True).to(device)
    outputs = model.generate(
        **inputs,
        max_new_tokens=max_new,
        temperature=0.2,
        do_sample=False,
    )
    full = tokenizer.decode(outputs[0], skip_special_tokens=False)
    assistant_response = full.split("assistant")[-1].split("<|redacted_im_end|>")[0].strip()

    replacements = parse_replacements(assistant_response) or []
    anonymized = apply_replacements(query, replacements)

    return {
        "assistant_raw": assistant_response,
        "replacements": replacements,
        "anonymized_text": anonymized,
    }


def lambda_handler(event: dict[str, Any], context: Any) -> dict[str, Any]:
    record = event["Records"][0]
    bucket = record["s3"]["bucket"]["name"]
    key = urllib.parse.unquote_plus(record["s3"]["object"]["key"], encoding="utf-8")

    max_chars = int(os.environ.get("MAX_INPUT_CHARS", "12000"))

    try:
        obj = s3.get_object(Bucket=bucket, Key=key)
        body = obj["Body"].read()
        text = body.decode("utf-8", errors="replace")
        if len(text) > max_chars:
            text = text[:max_chars]

        result = anonymize_text(text)

        return {
            "ok": True,
            "bucket": bucket,
            "key": key,
            "content_type": obj.get("ContentType"),
            "input_chars": len(text),
            **result,
        }
    except Exception as e:
        print(f"Error processing s3://{bucket}/{key}: {e}")
        raise
