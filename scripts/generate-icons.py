#!/usr/bin/env python3
import os
import shutil
import subprocess
from PIL import Image, ImageDraw, ImageFilter

ROOT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC_ICON = os.path.join(ROOT_DIR, "icon-v1.png")
OUT_DIR = os.path.join(ROOT_DIR, "assets", "icons")
PUBLIC_DIR = os.path.join(ROOT_DIR, "public")


def create_rounded_mask(size: int, radius: int) -> Image.Image:
    """Create a supersampled 4x antialiased rounded rectangle mask."""
    scale = 4
    big_size = size * scale
    big_radius = radius * scale
    mask = Image.new("L", (big_size, big_size), 0)
    draw = ImageDraw.Draw(mask)
    draw.rounded_rectangle(
        (0, 0, big_size - 1, big_size - 1),
        radius=big_radius,
        fill=255,
    )
    return mask.resize((size, size), Image.Resampling.LANCZOS)


def compose_platform_icon(
    src_img: Image.Image,
    canvas_size: int,
    body_size: int,
    corner_radius: int,
    shadow_offset_y: int,
    shadow_blur: int,
    shadow_alpha: int,
) -> Image.Image:
    """
    Compose a platform-adapted icon with proper padding, rounded corners,
    subtle drop shadow, and delicate edge border.
    """
    canvas = Image.new("RGBA", (canvas_size, canvas_size), (0, 0, 0, 0))
    offset = (canvas_size - body_size) // 2

    # Resize artwork to body_size x body_size
    body_img = src_img.convert("RGBA").resize(
        (body_size, body_size), Image.Resampling.LANCZOS
    )
    mask = create_rounded_mask(body_size, corner_radius)

    # Create soft drop shadow
    if shadow_blur > 0 and shadow_alpha > 0:
        shadow_layer = Image.new("RGBA", (canvas_size, canvas_size), (0, 0, 0, 0))
        shadow_Tint = Image.new("RGBA", (body_size, body_size), (0, 0, 0, shadow_alpha))
        shadow_layer.paste(
            shadow_Tint, (offset, offset + shadow_offset_y), mask
        )
        shadow_layer = shadow_layer.filter(ImageFilter.GaussianBlur(radius=shadow_blur))
        canvas = Image.alpha_composite(canvas, shadow_layer)

    # Apply rounded mask to artwork
    rounded_body = Image.new("RGBA", (body_size, body_size), (0, 0, 0, 0))
    rounded_body.paste(body_img, (0, 0), mask)

    # Subtle inner border so light edges stay crisp on any background
    scale = 4
    border_layer = Image.new("RGBA", (body_size * scale, body_size * scale), (0, 0, 0, 0))
    b_draw = ImageDraw.Draw(border_layer)
    b_draw.rounded_rectangle(
        (2, 2, body_size * scale - 3, body_size * scale - 3),
        radius=corner_radius * scale,
        outline=(255, 255, 255, 45),
        width=max(2, scale),
    )
    border_small = border_layer.resize((body_size, body_size), Image.Resampling.LANCZOS)
    rounded_body = Image.alpha_composite(rounded_body, border_small)

    body_layer = Image.new("RGBA", (canvas_size, canvas_size), (0, 0, 0, 0))
    body_layer.paste(rounded_body, (offset, offset), rounded_body)
    canvas = Image.alpha_composite(canvas, body_layer)
    return canvas


def main() -> None:
    if not os.path.exists(SRC_ICON):
        raise FileNotFoundError(f"Source icon not found: {SRC_ICON}")

    os.makedirs(OUT_DIR, exist_ok=True)
    os.makedirs(PUBLIC_DIR, exist_ok=True)

    src = Image.open(SRC_ICON).convert("RGBA")

    # 1. macOS Icon (Apple HIG: 824x824 body inside 1024x1024 canvas, ~22.37% corner radius = 184px)
    mac_icon = compose_platform_icon(
        src_img=src,
        canvas_size=1024,
        body_size=824,
        corner_radius=184,
        shadow_offset_y=10,
        shadow_blur=18,
        shadow_alpha=68,
    )
    mac_png_path = os.path.join(OUT_DIR, "icon-mac.png")
    mac_icon.save(mac_png_path, format="PNG")
    print(f"Generated macOS PNG icon: {mac_png_path}")

    # Build macOS .icns via iconutil if on macOS
    iconset_dir = os.path.join(OUT_DIR, "icon.iconset")
    if os.path.exists(iconset_dir):
        shutil.rmtree(iconset_dir)
    os.makedirs(iconset_dir, exist_ok=True)

    mac_sizes = [
        (16, "icon_16x16.png"),
        (32, "icon_16x16@2x.png"),
        (32, "icon_32x32.png"),
        (64, "icon_32x32@2x.png"),
        (128, "icon_128x128.png"),
        (256, "icon_128x128@2x.png"),
        (256, "icon_256x256.png"),
        (512, "icon_256x256@2x.png"),
        (512, "icon_512x512.png"),
        (1024, "icon_512x512@2x.png"),
    ]
    for sz, filename in mac_sizes:
        resized = mac_icon.resize((sz, sz), Image.Resampling.LANCZOS)
        resized.save(os.path.join(iconset_dir, filename), format="PNG")

    icns_path = os.path.join(OUT_DIR, "icon.icns")
    if shutil.which("iconutil"):
        subprocess.run(["iconutil", "-c", "icns", iconset_dir, "-o", icns_path], check=True)
        print(f"Generated macOS ICNS bundle: {icns_path}")
    shutil.rmtree(iconset_dir, ignore_errors=True)

    # 2. Windows Icon (Balanced 220x220 body inside 256x256 canvas so it is not oversized, 40px radius)
    win_icon = compose_platform_icon(
        src_img=src,
        canvas_size=256,
        body_size=220,
        corner_radius=40,
        shadow_offset_y=3,
        shadow_blur=5,
        shadow_alpha=60,
    )
    win_png_path = os.path.join(OUT_DIR, "icon-win.png")
    win_icon.save(win_png_path, format="PNG")
    print(f"Generated Windows PNG icon: {win_png_path}")

    ico_path = os.path.join(OUT_DIR, "icon.ico")
    win_icon.save(
        ico_path,
        format="ICO",
        sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)],
    )
    print(f"Generated Windows multi-size ICO: {ico_path}")

    # 3. Web / Favicon (64x64)
    favicon = win_icon.resize((64, 64), Image.Resampling.LANCZOS)
    favicon_path = os.path.join(PUBLIC_DIR, "favicon.png")
    favicon.save(favicon_path, format="PNG")
    print(f"Generated Web favicon: {favicon_path}")


if __name__ == "__main__":
    main()
