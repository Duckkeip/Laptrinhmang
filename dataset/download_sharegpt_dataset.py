"""
download_sharegpt_dataset.py

Tai dataset hoi thoai tu nhien nhieu luot (khong phai kieu viet luan dai nhu
vi-alpaca) - phu hop hon nhieu cho muc dich AI Bot tro chuyen trong phong chat.

Nguon: bkai-foundation-models/vi-self-chat-sharegpt-format (30.4k hoi thoai,
xay dung theo Self-Instruct + Baize, mo phong hoi thoai tu nhien nhieu luot).

Cai dat:
    pip install datasets

Chay:
    python download_sharegpt_dataset.py
"""

import json
from datasets import load_dataset

DATASET_NAME = "bkai-foundation-models/vi-self-chat-sharegpt-format"
SPLIT = "train"
MAX_CONVERSATIONS = 1500   # gioi han so hoi thoai de train nhanh, tang len neu can
OUTPUT_FILE = "train_sharegpt.jsonl"

SYSTEM_PROMPT = (
    "Ban la AI Bot, tro ly than thien trong ung dung chat da phong ChatNet. "
    "Tra loi ngan gon, tu nhien, dung trong tam."
)

ROLE_MAP = {"user": "user", "human": "user", "gpt": "assistant", "assistant": "assistant"}


def main():
    print(f"Dang tai dataset '{DATASET_NAME}'...")
    ds = load_dataset(DATASET_NAME, split=SPLIT)
    print(f"Tong so hoi thoai co san: {len(ds)}")

    ds = ds.select(range(min(MAX_CONVERSATIONS, len(ds))))

    count = 0
    with open(OUTPUT_FILE, "w", encoding="utf-8") as f:
        for row in ds:
            turns = row.get("conversations", [])
            if not turns:
                continue

            messages = [{"role": "system", "content": SYSTEM_PROMPT}]
            for turn in turns:
                role = ROLE_MAP.get(turn.get("from", "").lower())
                content = turn.get("value", "").strip()
                if role and content:
                    messages.append({"role": role, "content": content})

            # can it nhat 1 cap user-assistant sau system
            if len(messages) < 3:
                continue

            f.write(json.dumps({"messages": messages}, ensure_ascii=False) + "\n")
            count += 1

    print(f"Da ghi {count} hoi thoai vao {OUTPUT_FILE}")
    print("Co the gop file nay voi train.jsonl (vi-alpaca) hoac train_balanced.jsonl de tao dataset da dang hon.")


if __name__ == "__main__":
    main()