# Hướng dẫn tự train lại model AI cho ChatNet (thay thế notebook đã mất)

## 0. Việc phải làm trước: dựng lại dataset

Không có dataset thì không train được gì cả. Ba nguồn để dựng lại:

1. **Dữ liệu chat thật của chính app bạn** — dùng `dataset/build_dataset_from_mongo.js`
   để export lịch sử chat từ MongoDB, sau đó tự ghép các đoạn hỏi-đáp liên tiếp
   thành format chuẩn.
2. **Tự viết tay 100–300 mẫu** theo đúng format `dataset/sample_dataset.jsonl`
   (system / user / assistant) — với một trợ lý chat đơn giản, vài trăm mẫu
   chất lượng tốt vẫn có tác dụng rõ rệt hơn hàng nghìn mẫu hời hợt.
3. **Sinh dữ liệu tổng hợp bằng một AI có sẵn** (Claude, GPT...) — viết prompt
   yêu cầu nó tạo ra 200-500 cặp hội thoại mẫu đúng phong cách bot bạn muốn,
   rồi tự kiểm tra lại chất lượng trước khi dùng.

Gộp cả ba nguồn lại thành 1 file `train.jsonl`, càng nhiều mẫu càng tốt
(khuyến nghị tối thiểu ~300-500 mẫu để thấy hiệu quả rõ).

## 1. Model gốc để finetune

Với GPU T4 miễn phí trên Colab, **không finetune full model** — dùng QLoRA
(finetune 4-bit, chỉ train adapter nhỏ). Gợi ý model tiếng Việt:

- `Viet-Mistral/Vistral-7B-Chat` — chất lượng tiếng Việt tốt, đã chat-tuned sẵn.
- `vinai/PhoGPT-4B-Chat` — nhẹ hơn, dễ train hơn trên T4.

## 2. Code Colab (dán từng cell)

### Cell 1 — cài thư viện
```python
!pip install -q -U transformers accelerate peft bitsandbytes trl datasets
```

### Cell 2 — upload dataset
```python
from google.colab import files
uploaded = files.upload()  # chọn train.jsonl
```

### Cell 3 — load model 4-bit + LoRA config
```python
import torch
from transformers import AutoModelForCausalLM, AutoTokenizer, BitsAndBytesConfig
from peft import LoraConfig, get_peft_model, prepare_model_for_kbit_training

MODEL_NAME = "Viet-Mistral/Vistral-7B-Chat"  # hoặc "vinai/PhoGPT-4B-Chat"

bnb_config = BitsAndBytesConfig(
    load_in_4bit=True,
    bnb_4bit_quant_type="nf4",
    bnb_4bit_compute_dtype=torch.bfloat16,
    bnb_4bit_use_double_quant=True,
)

tokenizer = AutoTokenizer.from_pretrained(MODEL_NAME)
model = AutoModelForCausalLM.from_pretrained(
    MODEL_NAME,
    quantization_config=bnb_config,
    device_map="auto",
)
model = prepare_model_for_kbit_training(model)

lora_config = LoraConfig(
    r=16,
    lora_alpha=32,
    target_modules=["q_proj", "k_proj", "v_proj", "o_proj"],
    lora_dropout=0.05,
    bias="none",
    task_type="CAUSAL_LM",
)
model = get_peft_model(model, lora_config)
model.print_trainable_parameters()  # chỉ ~vài % tham số được train
```

### Cell 4 — load dataset + format theo chat template
```python
from datasets import load_dataset

dataset = load_dataset("json", data_files="train.jsonl", split="train")

def format_example(example):
    text = tokenizer.apply_chat_template(example["messages"], tokenize=False)
    return {"text": text}

dataset = dataset.map(format_example)
```

### Cell 5 — train với SFTTrainer
```python
from trl import SFTTrainer, SFTConfig

config = SFTConfig(
    output_dir="./ai-bot-lora",
    per_device_train_batch_size=2,
    gradient_accumulation_steps=4,
    num_train_epochs=3,
    learning_rate=2e-4,
    logging_steps=10,
    save_strategy="epoch",
    bf16=True,
    dataset_text_field="text",
    max_seq_length=1024,
)

trainer = SFTTrainer(
    model=model,
    args=config,
    train_dataset=dataset,
)
trainer.train()
```

### Cell 6 — lưu adapter + đẩy lên HuggingFace Hub (để deploy sau)
```python
model.save_pretrained("./ai-bot-lora-final")
tokenizer.save_pretrained("./ai-bot-lora-final")

# (tuỳ chọn) đẩy lên HF Hub để tải về dùng ở bước deploy
from huggingface_hub import login
login()  # dán token HuggingFace của bạn
model.push_to_hub("your-username/ai-bot-vistral-lora")
tokenizer.push_to_hub("your-username/ai-bot-vistral-lora")
```

## 3. Deploy model đã train

Xem `ai_service/app.py` — một FastAPI server nhỏ load model gốc + LoRA adapter,
expose endpoint `POST /generate`. Chạy server này (trên máy có GPU, hoặc thuê
GPU rẻ như RunPod/Vast.ai nếu máy bạn không có GPU đủ mạnh — model 7B chạy
inference vẫn cần khá nhiều RAM/VRAM).

## 4. Nối vào server.js

Xem phần đã patch trong `server.js`: khi tin nhắn bắt đầu bằng `/ai ` hoặc
chứa `@AI`, server gọi `POST {AI_SERVICE_URL}/generate`, lấy câu trả lời,
lưu vào MongoDB như tin nhắn bình thường (username: "AI Bot") và broadcast
qua socket.io.
