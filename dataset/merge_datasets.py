"""
merge_datasets.py - Gop 2 file train.jsonl va train_sharegpt.jsonl thanh 1 file
train_final.jsonl duy nhat de dua vao Colab train.
"""

import random

INPUT_FILES = ["train.jsonl", "train_sharegpt.jsonl"]
OUTPUT_FILE = "train_final.jsonl"

all_lines = []
for fname in INPUT_FILES:
    try:
        with open(fname, "r", encoding="utf-8") as f:
            lines = f.readlines()
            print(f"{fname}: {len(lines)} dong")
            all_lines.extend(lines)
    except FileNotFoundError:
        print(f"KHONG THAY {fname}, bo qua.")

random.shuffle(all_lines)  # tron ngau nhien de model khong hoc theo thu tu co dinh

with open(OUTPUT_FILE, "w", encoding="utf-8") as f:
    f.writelines(all_lines)

print(f"\nTong cong: {len(all_lines)} dong -> da ghi vao {OUTPUT_FILE}")