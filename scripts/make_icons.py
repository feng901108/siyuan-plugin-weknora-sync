"""生成插件图标 icon.png (160x160) 和预览图 preview.png (1024x768)"""
from PIL import Image, ImageDraw, ImageFont
import os

OUT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def find_font(size):
    candidates = [
        "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
        "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf",
        "/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc",
        "/usr/share/fonts/truetype/noto/NotoSansCJK-Bold.ttc",
    ]
    for p in candidates:
        if os.path.exists(p):
            try:
                return ImageFont.truetype(p, size)
            except Exception:
                continue
    return ImageFont.load_default()


def make_icon():
    size = 160
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    for y in range(size):
        ratio = y / size
        r = int(30 + (90 - 30) * ratio)
        g = int(90 + (60 - 90) * ratio)
        b = int(220 + (200 - 220) * ratio)
        draw.line([(0, y), (size, y)], fill=(r, g, b, 255))
    mask = Image.new("L", (size, size), 0)
    mdraw = ImageDraw.Draw(mask)
    mdraw.rounded_rectangle([0, 0, size - 1, size - 1], radius=28, fill=255)
    out = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    out.paste(img, (0, 0), mask)
    draw = ImageDraw.Draw(out)
    font = find_font(96)
    text = "W"
    bbox = draw.textbbox((0, 0), text, font=font)
    tw, th = bbox[2] - bbox[0], bbox[3] - bbox[1]
    x = (size - tw) // 2 - bbox[0]
    y = (size - th) // 2 - bbox[1] - 4
    draw.text((x, y), text, fill=(255, 255, 255, 255), font=font)
    draw.polygon(
        [(size - 30, size - 30), (size - 14, size - 30), (size - 22, size - 44)],
        fill=(255, 220, 80, 255),
    )
    icon_path = os.path.join(OUT_DIR, "icon.png")
    out.save(icon_path, "PNG")
    print(f"saved {icon_path} ({os.path.getsize(icon_path)} bytes)")


def make_preview():
    w, h = 1024, 768
    img = Image.new("RGB", (w, h), (245, 247, 250))
    draw = ImageDraw.Draw(img)
    draw.rectangle([0, 0, w, 80], fill=(30, 90, 220))
    title_font = find_font(36)
    draw.text((40, 22), "WeKnora Sync - SiYuan Plugin", fill=(255, 255, 255), font=title_font)
    body_font = find_font(22)
    small_font = find_font(16)
    panel_y = 110
    draw.rectangle([40, panel_y, w - 40, panel_y + 280], fill=(255, 255, 255), outline=(220, 225, 230), width=1)
    draw.text((60, panel_y + 16), "1. WeKnora Connection", fill=(40, 50, 70), font=find_font(24))
    labels = [
        ("Base URL", "http://localhost:8080"),
        ("API Key", "sk-xxxxxxxxxxxx"),
        ("Knowledge Base", "My SiYuan Notes"),
    ]
    for i, (label, val) in enumerate(labels):
        ly = panel_y + 60 + i * 50
        draw.text((60, ly + 8), label, fill=(90, 100, 115), font=body_font)
        draw.rectangle([220, ly, w - 60, ly + 36], fill=(250, 251, 253), outline=(210, 215, 225), width=1)
        draw.text((230, ly + 8), val, fill=(70, 80, 100), font=body_font)
    nb_y = panel_y + 220
    draw.text((60, nb_y), "2. Select SiYuan Notebooks", fill=(40, 50, 70), font=find_font(24))
    draw.rectangle([60, nb_y + 34, w - 60, nb_y + 70], fill=(250, 251, 253), outline=(210, 215, 225), width=1)
    draw.text((70, nb_y + 42), "v Personal Notes    v Work Log    v Reading Notes", fill=(70, 80, 100), font=body_font)
    pb_y = panel_y + 320
    draw.text((60, pb_y), "Progress: 42/128 (failed 0) | Current: /Personal Notes/Tech/Go Basics.md", fill=(40, 50, 70), font=body_font)
    draw.rectangle([60, pb_y + 32, w - 60, pb_y + 44], fill=(230, 235, 245))
    draw.rectangle([60, pb_y + 32, 60 + (w - 120) * 42 // 128, pb_y + 44], fill=(30, 110, 230))
    log_y = pb_y + 70
    draw.rectangle([40, log_y, w - 40, h - 40], fill=(248, 250, 252), outline=(220, 225, 230), width=1)
    logs = [
        ("[14:23:01] OK [Product Manual] uploaded (images: 8/8)", (60, 140, 60)),
        ("[14:23:05] OK [Architecture] uploaded (images: 3/3)", (60, 140, 60)),
        ("[14:23:06] WARN [Draft] 1 image base64 failed: xxx.png", (200, 130, 30)),
        ("[14:23:10] OK [Go Basics] uploaded (images: 5/5)", (60, 140, 60)),
        ("[14:23:14] OK [DB Design] uploaded (images: 12/12)", (60, 140, 60)),
    ]
    for i, (line, color) in enumerate(logs):
        draw.text((55, log_y + 12 + i * 24), line, fill=color, font=small_font)
    preview_path = os.path.join(OUT_DIR, "preview.png")
    img.save(preview_path, "PNG")
    print(f"saved {preview_path} ({os.path.getsize(preview_path)} bytes)")


if __name__ == "__main__":
    make_icon()
    make_preview()
