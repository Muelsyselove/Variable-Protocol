# 桌宠立绘放大 + 资源校验（Pillow）
import os
from PIL import Image

BASE = r"e:/openclawwork/game-objects/Variable Protocol/src/renderer/src/assets/pets/lilong"

# 1) 立绘放大到 2048x3072
full = os.path.join(BASE, "Lilong-full.png")
img = Image.open(full)
if img.size != (2048, 3072):
    up = img.resize((2048, 3072), Image.LANCZOS)
    up.save(full, optimize=True)
    print("upscaled Lilong-full.png -> 2048x3072")

# 2) 全量校验：尺寸 / alpha / 透明占比 / 非透明包围盒
for f in sorted(os.listdir(BASE)):
    if not f.endswith(".png"):
        continue
    p = os.path.join(BASE, f)
    im = Image.open(p).convert("RGBA")
    a = im.getchannel("A")
    hist = a.histogram()
    total = im.width * im.height
    transparent = sum(hist[:10])
    bbox = a.getbbox()  # 非透明区域包围盒
    print(f"{f:34s} {im.width}x{im.height}  transparent={100*transparent/total:5.1f}%  bbox={bbox}")
