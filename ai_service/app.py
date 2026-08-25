"""
app.py - AI inference microservice cho AI Bot trong ChatNet.

Load base model + LoRA adapter (kết quả từ finetune_guide.md), expose
1 endpoint duy nhất POST /generate để server.js (Node) gọi mỗi khi có
lệnh /ai hoặc @AI trong phòng chat.

Chạy:
    pip install -r requirements.txt
    python app.py
Mặc định lắng nghe ở http://localhost:8000
"""

import os
import torch
from fastapi import FastAPI
from pydantic import BaseModel
from transformers import AutoModelForCausalLM, AutoTokenizer, BitsAndBytesConfig
from peft import PeftModel

BASE_MODEL = os.environ.get("BASE_MODEL", "Viet-Mistral/Vistral-7B-Chat")
ADAPTER_PATH = os.environ.get("ADAPTER_PATH", "your-username/ai-bot-vistral-lora")

SYSTEM_PROMPT = (
    "Ban la AI Bot, tro ly than thien trong ung dung chat da phong ChatNet. "
    "Tra loi ngan gon, tu nhien, dung trong tam."
)

app = FastAPI(title="ChatNet AI Bot Service")

print("Dang load model, co the mat vai phut...")
bnb_config = BitsAndBytesConfig(load_in_4bit=True, bnb_4bit_compute_dtype=torch.bfloat16)
tokenizer = AutoTokenizer.from_pretrained(BASE_MODEL)
base_model = AutoModelForCausalLM.from_pretrained(
    BASE_MODEL, quantization_config=bnb_config, device_map="auto"
)
model = PeftModel.from_pretrained(base_model, ADAPTER_PATH)
model.eval()
print("Model da san sang.")


class GenerateRequest(BaseModel):
    prompt: str
    room: str | None = None
    username: str | None = None


class GenerateResponse(BaseModel):
    reply: str


@app.post("/generate", response_model=GenerateResponse)
def generate(req: GenerateRequest):
    messages = [
        {"role": "system", "content": SYSTEM_PROMPT},
        {"role": "user", "content": req.prompt},
    ]
    input_ids = tokenizer.apply_chat_template(
        messages, add_generation_prompt=True, return_tensors="pt"
    ).to(model.device)

    with torch.no_grad():
        output = model.generate(
            input_ids,
            max_new_tokens=256,
            temperature=0.7,
            top_p=0.9,
            do_sample=True,
            pad_token_id=tokenizer.eos_token_id,
        )

    reply = tokenizer.decode(
        output[0][input_ids.shape[1]:], skip_special_tokens=True
    ).strip()

    return GenerateResponse(reply=reply or "Xin loi, minh chua nghi ra cau tra loi.")


@app.get("/health")
def health():
    return {"status": "ok"}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
