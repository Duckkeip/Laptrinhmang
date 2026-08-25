"""
crawl_and_generate_dataset.py

Cao text tho tu 1 danh sach URL, roi dung Claude API de TU DONG sinh ra
cac cap hoi-dap tu noi dung do -> ra dataset chuan de finetune, nhanh hon
nhieu so voi ngoi go tay tung cau.

*** Luu y ve ban quyen / dieu khoan su dung ***
Chi cao noi dung ban duoc phep dung (trang cua chinh ban, tai lieu open
data, Wikipedia, FAQ cong khai...). Kiem tra robots.txt va dieu khoan cua
trang truoc khi cao. Khong cao noi dung co ban quyen ma khong duoc phep.

Cai dat:
    pip install requests beautifulsoup4 anthropic

Chay:
    export ANTHROPIC_API_KEY=sk-ant-...
    python crawl_and_generate_dataset.py
"""

import json
import time
import requests
from bs4 import BeautifulSoup
from anthropic import Anthropic

# ---- 1. Danh sach URL muon cao ----
URLS = [
    "https://vi.wikipedia.org/wiki/Node.js",
    "https://vi.wikipedia.org/wiki/MongoDB",
    # them URL khac o day - vd trang FAQ, blog ky thuat cua chinh ban...
]

OUTPUT_FILE = "train.jsonl"
QA_PER_PAGE = 8  # so cap hoi-dap muon sinh tu moi trang

SYSTEM_PROMPT_FOR_BOT = (
    "Ban la AI Bot, tro ly than thien trong ung dung chat da phong ChatNet. "
    "Tra loi ngan gon, tu nhien, dung trong tam."
)

client = Anthropic()  # doc ANTHROPIC_API_KEY tu bien moi truong


def scrape_text(url):
    """Cao va lam sach text chinh cua 1 trang."""
    headers = {"User-Agent": "Mozilla/5.0 (dataset-builder research bot)"}
    res = requests.get(url, headers=headers, timeout=15)
    res.raise_for_status()
    soup = BeautifulSoup(res.text, "html.parser")

    for tag in soup(["script", "style", "nav", "footer", "header"]):
        tag.decompose()

    text = soup.get_text(separator="\n")
    lines = [ln.strip() for ln in text.splitlines() if ln.strip()]
    return "\n".join(lines)[:8000]  # gioi han do dai de tiet kiem token


def generate_qa_pairs(source_text, n_pairs):
    """Goi Claude de doc noi dung va tu sinh ra n cap hoi-dap tieng Viet."""
    prompt = f"""Doc noi dung duoi day va tao ra {n_pairs} cap hoi-dap tu nhien
bang tieng Viet, giong nhu nguoi dung dang hoi mot tro ly chat ve chu de nay.
Cau tra loi phai NGAN GON (2-4 cau), dung trong tam, khong bia dat thong tin
ngoai noi dung duoc cung cap.

Tra ve DUY NHAT mot JSON array, khong them chu giai thich nao khac, dung dinh dang:
[{{"question": "...", "answer": "..."}}, ...]

Noi dung:
\"\"\"
{source_text}
\"\"\"
"""
    response = client.messages.create(
        model="claude-sonnet-4-6",
        max_tokens=2000,
        messages=[{"role": "user", "content": prompt}],
    )
    raw = response.content[0].text.strip()
    raw = raw.replace("```json", "").replace("```", "").strip()
    return json.loads(raw)


def main():
    all_samples = []

    for url in URLS:
        print(f"Dang cao: {url}")
        try:
            text = scrape_text(url)
        except Exception as e:
            print(f"  Loi khi cao {url}: {e}")
            continue

        print(f"  Dang sinh {QA_PER_PAGE} cap hoi-dap tu noi dung...")
        try:
            qa_pairs = generate_qa_pairs(text, QA_PER_PAGE)
        except Exception as e:
            print(f"  Loi khi goi Claude API: {e}")
            continue

        for qa in qa_pairs:
            all_samples.append({
                "messages": [
                    {"role": "system", "content": SYSTEM_PROMPT_FOR_BOT},
                    {"role": "user", "content": qa["question"]},
                    {"role": "assistant", "content": qa["answer"]},
                ]
            })

        time.sleep(1)  # tranh goi API qua nhanh

    with open(OUTPUT_FILE, "w", encoding="utf-8") as f:
        for sample in all_samples:
            f.write(json.dumps(sample, ensure_ascii=False) + "\n")

    print(f"\nHoan tat: {len(all_samples)} mau da ghi vao {OUTPUT_FILE}")


if __name__ == "__main__":
    main()
