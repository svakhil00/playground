from transformers import AutoModelForCausalLM, AutoTokenizer
import json
import torch


def pick_device() -> torch.device:
    if torch.backends.mps.is_available():
        return torch.device("mps")
    if torch.cuda.is_available():
        return torch.device("cuda")
    return torch.device("cpu")


device = pick_device()
dtype = torch.float16 if device.type in ("mps", "cuda") else torch.float32

# Load model and tokenizer
#model_name = "eternisai/Anonymizer-0.6B"
model_name = "eternisai/Anonymizer-4B"
tokenizer = AutoTokenizer.from_pretrained(model_name, trust_remote_code=True)
model = AutoModelForCausalLM.from_pretrained(
    model_name,
    torch_dtype=dtype,
    trust_remote_code=True,
).to(device)

# Define the task instruction
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

# Define tool schema (required!)
tools = [{
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
                            "replacement": {"type": "string"}
                        },
                        "required": ["original", "replacement"]
                    }
                }
            },
            "required": ["replacements"]
        }
    }
}]

# Your query to anonymize
query = "Hi, my son Elijah works at TechStartup Inc and makes $85,000 per year."

# Format messages properly (critical step!)
messages = [
    {"role": "system", "content": TASK_INSTRUCTION},
    {"role": "user", "content": query + "\n/no_think"}
]

# Apply chat template with tools
formatted_prompt = tokenizer.apply_chat_template(
    messages,
    tools=tools,
    tokenize=False,
    add_generation_prompt=True
)

# Tokenize and generate
inputs = tokenizer(formatted_prompt, return_tensors="pt", truncation=True).to(model.device)
outputs = model.generate(**inputs, max_new_tokens=250, temperature=0.3, do_sample=True, top_p=0.9)

# Decode and extract response
response = tokenizer.decode(outputs[0], skip_special_tokens=False)
assistant_response = response.split("assistant")[-1].split("<|im_end|>")[0].strip()

print("Response:", assistant_response)
# Expected output format:
# <|tool_call|>{"name": "replace_entities", "arguments": {"replacements": [{"original": "Elijah", "replacement": "Nathan"}, {"original": "TechStartup Inc", "replacement": "DataSoft LLC"}, {"original": "$85,000", "replacement": "$72,000"}]}}</|tool_call|>
