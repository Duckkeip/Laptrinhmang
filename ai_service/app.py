"""
app.py - AI inference microservice cho AI Bot trong ChatNet.

Load base model PhoGPT-4B-Chat (trust_remote_code) + LoRA adapter da train
tren Colab, expose 1 endpoint POST /generate de server.js (Node) goi moi
khi co lenh /ai hoac @AI trong phong chat.

QUAN TRONG - cac fix bat buoc phai co (rut ra tu qua trinh debug tren Colab):
  1. trust_remote_code=True  - PhoGPT dung kien truc custom, KHONG dung class
     MptForCausalLM co san cua transformers (se sinh chu vo nghia neu thieu).
  2. bnb_4bit_compute_dtype=torch.bfloat16 - float16 gay NaN khi generate do
     co che ALiBi cua kien truc MPT.
  3. Copy thu cong cac file .py vao cache truoc khi load - tranh loi thieu
     file flash_attn_triton.py do co che tu dong cua transformers hay loi.

Chay:
    pip install -r requirements.txt
    python app.py
Mac dinh lang nghe o http://localhost:8000

Bien moi truong co the chinh:
    BASE_MODEL_DIR   - thu muc chua base model (se tu tai neu chua co)
    ADAPTER_PATH     - thu muc chua LoRA adapter da train (giai nen tu Drive)
"""

import os
import re
import json
import shutil
import torch
from fastapi import FastAPI
from pydantic import BaseModel
from transformers import AutoModelForCausalLM, AutoTokenizer, BitsAndBytesConfig
from peft import PeftModel

MODEL_NAME = "vinai/PhoGPT-4B-Chat"
BASE_MODEL_DIR = os.environ.get("BASE_MODEL_DIR", "./phogpt_base")
ADAPTER_PATH = os.environ.get("ADAPTER_PATH", "./qlora_adapter_v2")
FACTS_PATH = os.environ.get("FACTS_PATH", "./facts.json")

SYSTEM_PROMPT = (
    "Ban la AI Bot, tro ly trong ung dung chat da phong ChatNet. "
    "Chi tra loi ve: chao hoi xa giao, cach su dung ung dung chat nay, va cac cau hoi kien thuc pho thong don gian "
    "ma ban chac chan dung. "
    "Neu khong chac chan hoac khong co du thong tin (dac biet cac chu de chuyen sau, ten rieng, su kien cu the), "
    "hay noi thang la khong biet hoac khong chac chan, TUYET DOI KHONG bia dat thong tin."
)

app = FastAPI(title="ChatNet AI Bot Service")

print("Dang chuan bi model, co the mat vai phut...")

# 1) Tai base model neu chua co san trong BASE_MODEL_DIR
if not os.path.isdir(BASE_MODEL_DIR) or not os.listdir(BASE_MODEL_DIR):
    print(f"Chua co base model o {BASE_MODEL_DIR}, dang tai tu HuggingFace...")
    from huggingface_hub import snapshot_download
    snapshot_download(repo_id=MODEL_NAME, local_dir=BASE_MODEL_DIR)
    print("Da tai xong base model.")

if not os.path.isdir(ADAPTER_PATH):
    raise RuntimeError(
        f"Khong tim thay adapter tai {ADAPTER_PATH}. "
        "Giai nen file qlora_adapter_v2 (tai tu Google Drive) vao dung duong dan nay, "
        "hoac chinh bien moi truong ADAPTER_PATH."
    )

# 2) Copy san file .py vao cache cua transformers - tranh loi thieu flash_attn_triton.py
cache_dir = os.path.expanduser(
    f"~/.cache/huggingface/modules/transformers_modules/{os.path.basename(BASE_MODEL_DIR.rstrip('/'))}"
)
os.makedirs(cache_dir, exist_ok=True)
for fname in os.listdir(BASE_MODEL_DIR):
    if fname.endswith(".py"):
        shutil.copy(os.path.join(BASE_MODEL_DIR, fname), os.path.join(cache_dir, fname))

# 3) Load tokenizer + base model (BAT BUOC trust_remote_code=True)
bnb_config = BitsAndBytesConfig(
    load_in_4bit=True,
    bnb_4bit_quant_type="nf4",
    bnb_4bit_compute_dtype=torch.bfloat16,   # KHONG dung float16 - gay NaN
    bnb_4bit_use_double_quant=True,
)

tokenizer = AutoTokenizer.from_pretrained(BASE_MODEL_DIR, use_fast=True, trust_remote_code=True)
if tokenizer.pad_token is None:
    tokenizer.pad_token = tokenizer.eos_token

base_model = AutoModelForCausalLM.from_pretrained(
    BASE_MODEL_DIR,
    quantization_config=bnb_config,
    device_map="auto",
    trust_remote_code=True,
)

model = PeftModel.from_pretrained(base_model, ADAPTER_PATH)
model.eval()
print("Model da san sang.")


# ---------- RAG don gian: tra cuu fact tinh, KHONG can train lai ----------
def load_facts():
    if not os.path.exists(FACTS_PATH):
        print(f"Khong tim thay {FACTS_PATH}, bo qua RAG tinh (van chay binh thuong).")
        return {}
    with open(FACTS_PATH, "r", encoding="utf-8") as f:
        return json.load(f)


FACTS = load_facts()


def retrieve_facts(user_prompt: str, max_facts: int = 3) -> list[str]:
    """Tim cac fact TINH (tu facts.json) co tu khoa xuat hien trong cau hoi."""
    prompt_lower = user_prompt.lower()
    matched = []
    for keyword, fact in FACTS.items():
        if keyword.lower() in prompt_lower:
            matched.append(fact)
        if len(matched) >= max_facts:
            break
    return matched


# ---------- RAG dong: tra cuu truc tiep tren Wikipedia tieng Viet ----------
# Khong gioi han pham vi nhu facts.json - tra cuu duoc BAT KY chu de nao
# co tren Wikipedia, khong can tu gom du lieu.
import requests

WIKI_SEARCH_URL = "https://vi.wikipedia.org/w/api.php"
WIKI_SUMMARY_URL = "https://vi.wikipedia.org/api/rest_v1/page/summary/{title}"
ENABLE_WIKI_RAG = os.environ.get("ENABLE_WIKI_RAG", "true").lower() == "true"


def retrieve_wikipedia(user_prompt: str, timeout: float = 3.0) -> str | None:
    """Tim bai Wikipedia tieng Viet lien quan nhat toi cau hoi, tra ve
    doan tom tat ngan de lam ngu canh. Tra ve None neu khong tim thay
    hoac loi mang (khong lam sap service neu mat internet/timeout)."""
    if not ENABLE_WIKI_RAG:
        return None
    try:
        search_res = requests.get(
            WIKI_SEARCH_URL,
            params={
                "action": "query", "list": "search", "srsearch": user_prompt,
                "format": "json", "srlimit": 1,
            },
            timeout=timeout,
        )
        search_res.raise_for_status()
        results = search_res.json().get("query", {}).get("search", [])
        if not results:
            return None

        title = results[0]["title"]
        summary_res = requests.get(
            WIKI_SUMMARY_URL.format(title=requests.utils.quote(title)),
            timeout=timeout,
        )
        summary_res.raise_for_status()
        extract = summary_res.json().get("extract", "")
        if extract:
            return f"{title}: {extract[:500]}"
        return None
    except Exception as e:
        print(f"Loi tra cuu Wikipedia (bo qua, van tra loi binh thuong): {e}")
        return None


def clean_output(text: str) -> str:
    """Cat bo phan model 'roi ri' them cau hoi/tra loi gia do anh huong tu
    template goc cua PhoGPT (### Cau hoi / ### Tra loi)."""
    match = re.search(r"#{2,3}", text)
    if match:
        text = text[: match.start()].strip()
    match2 = re.search(r"(Câu hỏi\s*:|Đáp\s*:)", text)
    if match2:
        text = text[: match2.start()].strip()
    return text.strip()


class GenerateRequest(BaseModel):
    prompt: str
    room: str | None = None
    username: str | None = None


class GenerateResponse(BaseModel):
    reply: str


@app.post("/generate", response_model=GenerateResponse)
def generate(req: GenerateRequest):
    # RAG: uu tien fact tinh (facts.json, ban tu kiem soat noi dung), sau do
    # bo sung bang tra cuu Wikipedia song neu khong co fact tinh nao khop.
    facts = retrieve_facts(req.prompt)
    if not facts:
        wiki_fact = retrieve_wikipedia(req.prompt)
        if wiki_fact:
            facts = [wiki_fact]

    system_content = SYSTEM_PROMPT
    if facts:
        facts_text = "\n".join(f"- {f}" for f in facts)
        system_content += f"\n\nThong tin tham khao (uu tien dung neu lien quan, bo qua neu khong lien quan):\n{facts_text}"

    messages = [
        {"role": "system", "content": system_content},
        {"role": "user", "content": req.prompt},
    ]
    inputs = tokenizer.apply_chat_template(
        messages, add_generation_prompt=True, return_tensors="pt", return_dict=True,
    )
    inputs = {k: v.to(model.device) for k, v in inputs.items()}

    with torch.no_grad():
        output = model.generate(
            **inputs,
            max_new_tokens=200,
            do_sample=True,
            temperature=0.7,
            top_p=0.9,
            repetition_penalty=1.15,
            no_repeat_ngram_size=4,
            pad_token_id=tokenizer.pad_token_id,
            eos_token_id=tokenizer.eos_token_id,
        )

    reply = tokenizer.decode(
        output[0][inputs["input_ids"].shape[1]:], skip_special_tokens=True
    ).strip()
    reply = clean_output(reply)

    return GenerateResponse(reply=reply or "Xin loi, minh chua nghi ra cau tra loi.")


@app.get("/health")
def health():
    return {"status": "ok"}


@app.post("/reload-facts")
def reload_facts():
    """Goi endpoint nay sau khi sua facts.json de ap dung ngay, khong can
    restart ca service (model van giu nguyen trong RAM, chi doc lai file)."""
    global FACTS
    FACTS = load_facts()
    return {"status": "ok", "so_fact": len(FACTS)}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
