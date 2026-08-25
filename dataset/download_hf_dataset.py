"""
download_hf_dataset.py - Cach nhanh nhat de co dataset lon: tai dataset
tieng Viet co san tren HuggingFace, khoi phai cao gi ca.

Cai dat:
    pip install datasets

Chay:
    python download_hf_dataset.py

Vai dataset tieng Viet dang dung thu (chon 1 trong danh sach DATASET_OPTIONS
duoi day, hoac tim them tai https://huggingface.co/datasets?language=vi):

  - "5CD-AI/Vietnamese-Alpaca-gpt4-70k"   -> instruction/response, ~70k mau
  - "bkai-foundation-models/vi-alpaca"     -> instruction tieng Viet
  - "vilm/OpenOrca-Viet"                   -> hoi dap tong hop
  - "ura-hcmut/ura-llama-sft"               -> chat SFT tieng Viet

Script nay tai 1 dataset, tu dong chuyen ve format {system, user, assistant}
giong het sample_dataset.jsonl de dung truc tiep cho finetune_guide.md.
"""

import json
from datasets import load_dataset

DATASET_NAME = "bkai-foundation-models/vi-alpaca"  # doi sang dataset ban muon
SPLIT = "train"
MAX_SAMPLES = 2000  # gioi han so mau de train nhanh, tang len neu can nhieu hon
OUTPUT_FILE = "train.jsonl"

SYSTEM_PROMPT = (
    "Ban la AI Bot, tro ly than thien trong ung dung chat da phong ChatNet. "
    "Tra loi ngan gon, tu nhien, dung trong tam."
)


def main():
    print(f"Dang tai dataset '{DATASET_NAME}'...")
    ds = load_dataset(DATASET_NAME, split=SPLIT)
    print(f"Tong so mau co san: {len(ds)}")

    ds = ds.select(range(min(MAX_SAMPLES, len(ds))))

    with open(OUTPUT_FILE, "w", encoding="utf-8") as f:
        count = 0
        for row in ds:
            # Cac dataset alpaca-style thuong co field "instruction", "input", "output"
            # Neu dataset ban chon co field khac, sua lai o day cho phu hop.
            instruction = row.get("instruction", "").strip()
            extra_input = row.get("input", "").strip() if row.get("input") else ""
            output = row.get("output", "").strip()

            if not instruction or not output:
                continue

            user_content = instruction if not extra_input else f"{instruction}\n{extra_input}"

            sample = {
                "messages": [
                    {"role": "system", "content": SYSTEM_PROMPT},
                    {"role": "user", "content": user_content},
                    {"role": "assistant", "content": output},
                ]
            }
            f.write(json.dumps(sample, ensure_ascii=False) + "\n")
            count += 1

    print(f"Da ghi {count} mau vao {OUTPUT_FILE} - dung file nay lam train.jsonl trong finetune_guide.md")


if __name__ == "__main__":
    main()
