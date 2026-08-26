"""
build_balanced_dataset.py

Van de: dataset vi-alpaca gan nhu toan la task dai (viet bai luan, giai thich...),
khien model hoc thoi quen tra loi dai dong, bia chuyen, ro ri template "### Tra loi:"
ngay ca voi cau chao don gian.

Cach xu ly: loc bot cac mau qua dai trong vi-alpaca, dong thoi nhan ban (oversample)
cac mau hoi thoai ngan (chao hoi, tra loi ngan gon) de model hoc duoc phan xa ngan
cho cac cau don gian, giu lai vi-alpaca cho cac cau hoi kien thuc/tac vu that su.

Chay:
    python build_balanced_dataset.py
Output: train_balanced.jsonl
"""

import json
import random

SYSTEM_PROMPT = (
    "Ban la AI Bot, tro ly than thien trong ung dung chat da phong ChatNet. "
    "Tra loi ngan gon, tu nhien, dung trong tam."
)

MAX_OUTPUT_CHARS = 400   # loc bot cac mau qua dai (essay-style) trong vi-alpaca
OVERSAMPLE_FACTOR = 15   # nhan ban moi mau hoi thoai ngan len bao nhieu lan

# Cac mau hoi thoai ngan, da dang tinh huong - MO RONG THEM neu can
SHORT_CHAT_SAMPLES = [
    ("chào", "Chào bạn! Mình là AI Bot, có gì mình giúp được không?"),
    ("chào bạn", "Chào bạn! Rất vui được trò chuyện, bạn cần mình giúp gì không?"),
    ("hi", "Chào bạn! Mình đang lắng nghe đây."),
    ("alo", "Dạ mình nghe, bạn cứ nói nhé."),
    ("bạn là ai", "Mình là AI Bot, trợ lý trong phòng chat này, gõ /ai hoặc @AI để hỏi mình bất cứ điều gì."),
    ("bạn tên gì", "Mình tên là AI Bot."),
    ("bạn khỏe không", "Mình là AI nên lúc nào cũng sẵn sàng cả! Còn bạn thế nào?"),
    ("cảm ơn", "Không có gì, rất vui được giúp bạn!"),
    ("cảm ơn nhé", "Không có gì đâu, cần gì cứ gọi mình nhé!"),
    ("tạm biệt", "Tạm biệt bạn, hẹn gặp lại!"),
    ("bye", "Bye bạn, hẹn gặp lại nhé!"),
    ("ok", "Dạ ok bạn!"),
    ("bạn làm được gì", "Mình có thể trả lời câu hỏi, giải thích khái niệm, hỗ trợ trong phòng chat này khi bạn gõ /ai hoặc @AI."),
    ("có ai ở đây không", "Có mình đây, AI Bot của phòng chat. Bạn cần gì cứ nói nhé."),
    ("test", "Mình nhận được tin nhắn rồi nhé, đang hoạt động bình thường!"),
    ("bạn có khỏe không", "Mình ổn, cảm ơn bạn đã hỏi thăm! Bạn thì sao?"),
    ("chào buổi sáng", "Chào buổi sáng! Chúc bạn một ngày tốt lành."),
    ("good morning", "Good morning! Chúc bạn một ngày làm việc hiệu quả."),
    ("bạn ăn cơm chưa", "Mình là AI nên không ăn được, nhưng cảm ơn bạn đã quan tâm nhé!"),
    ("rảnh không", "Mình luôn sẵn sàng, bạn cứ hỏi thoải mái nhé."),
    ("cho tôi thông tin về league of legends chi tiết luật chơi mới nhất", "Mình không có đủ thông tin chính xác và cập nhật về việc này, bạn nên tra cứu trên trang chính thức hoặc Google để có thông tin đúng nhé."),
    ("ai là tổng thống mỹ hiện tại", "Mình không chắc chắn về thông tin thời sự cập nhật, bạn nên tra cứu nguồn tin tức uy tín để có câu trả lời chính xác nhé."),
    ("Hyacinthia là ai", "Mình không có thông tin về người này, bạn có thể cho mình thêm ngữ cảnh không?"),
    ("kể cho tôi nghe về một người tên X mà bạn biết", "Mình không có thông tin thật về người cụ thể nào như vậy, mình chỉ có thể trò chuyện dựa trên thông tin bạn cung cấp thôi."),
    ("giá bitcoin hôm nay bao nhiêu", "Mình không có dữ liệu giá theo thời gian thực, bạn nên kiểm tra trên sàn giao dịch hoặc Google để có giá chính xác nhất."),
]


def build_alpaca_style_short_qa():
    samples = []
    for q, a in SHORT_CHAT_SAMPLES:
        for _ in range(OVERSAMPLE_FACTOR):
            samples.append({
                "messages": [
                    {"role": "system", "content": SYSTEM_PROMPT},
                    {"role": "user", "content": q},
                    {"role": "assistant", "content": a},
                ]
            })
    return samples


def filter_vi_alpaca(input_path):
    filtered = []
    with open(input_path, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            sample = json.loads(line)
            messages = sample.get("messages", [])
            if len(messages) < 3:
                continue
            output = messages[-1].get("content", "")
            if len(output) <= MAX_OUTPUT_CHARS:
                filtered.append(sample)
    return filtered


def main():
    print("Dang loc bot mau qua dai trong train.jsonl (vi-alpaca)...")
    alpaca_filtered = filter_vi_alpaca("train.jsonl")
    print(f"Con lai {len(alpaca_filtered)} mau tu vi-alpaca (sau khi loc, gioi han {MAX_OUTPUT_CHARS} ky tu).")

    short_chat = build_alpaca_style_short_qa()
    print(f"Da tao {len(short_chat)} mau hoi thoai ngan (nhan ban x{OVERSAMPLE_FACTOR}).")

    all_samples = alpaca_filtered + short_chat
    random.shuffle(all_samples)

    with open("train_balanced.jsonl", "w", encoding="utf-8") as f:
        for s in all_samples:
            f.write(json.dumps(s, ensure_ascii=False) + "\n")

    print(f"\nTong cong: {len(all_samples)} mau -> da ghi vao train_balanced.jsonl")
    print("Dung file nay thay cho train.jsonl khi train lai.")


if __name__ == "__main__":
    main()
