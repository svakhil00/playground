"""
Local script to exercise the Anonymizer model (not deployed by SAM; Lambda lives under
``ai-models/hello_world/``).
"""

from __future__ import annotations

import json
from typing import Any, Optional

from transformers import AutoModelForCausalLM, AutoTokenizer
import torch


def pick_device() -> torch.device:
    if torch.backends.mps.is_available():
        return torch.device("mps")
    if torch.cuda.is_available():
        return torch.device("cuda")
    return torch.device("cpu")


device = pick_device()
dtype = torch.float16 if device.type in ("mps", "cuda") else torch.float32

# model_name = "eternisai/Anonymizer-0.6B"
model_name = "eternisai/Anonymizer-4B"
tokenizer = AutoTokenizer.from_pretrained(model_name, trust_remote_code=True)
model = AutoModelForCausalLM.from_pretrained(
    model_name,
    torch_dtype=dtype,
    trust_remote_code=True,
).to(device)

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

tools = [
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


query = "Hi, my son Elijah works at TechStartup Inc and makes $85,000 per year."

messages = [
    {"role": "system", "content": TASK_INSTRUCTION},
    {"role": "user", "content": query + "\n/no_think"},
]

formatted_prompt = tokenizer.apply_chat_template(
    messages,
    tools=tools,
    tokenize=False,
    add_generation_prompt=True,
)

inputs = tokenizer(formatted_prompt, return_tensors="pt", truncation=True).to(model.device)
outputs = model.generate(**inputs, max_new_tokens=250, temperature=0.3, do_sample=True, top_p=0.9)

response = tokenizer.decode(outputs[0], skip_special_tokens=False)
assistant_response = response.split("assistant")[-1].split("<|redacted_im_end|>")[0].strip()

print("Response:", assistant_response)

replacements = parse_replacements(assistant_response)
if replacements:
    for r in replacements:
        print(f"Replace {r['original']!r} with {r['replacement']!r}")
else:
    print("No structured replacements parsed (missing or malformed tool_call).")
