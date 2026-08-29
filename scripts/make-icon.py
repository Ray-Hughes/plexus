#!/usr/bin/env python3
"""Generate the Plexus app icon.

A plexus is a network of interconnected nerves: two pairs of nodes that stay
distinct (Claude coral on the left, Copilot blue on the right) wired through one
shared centre. Rendered at 4x and downsampled, because Pillow has no
anti-aliasing of its own.
"""

from PIL import Image, ImageDraw
from pathlib import Path

SIZE = 1024
SS = 4  # supersample factor
S = SIZE * SS

BG = (13, 16, 23, 255)
LINE = (108, 122, 145, 255)
CLAUDE = (217, 119, 87, 255)
COPILOT = (88, 166, 255, 255)
CENTER_RING = (226, 232, 240, 255)

def lerp(a, b, t):
    return tuple(round(x + (y - x) * t) for x, y in zip(a, b))

def main() -> None:
    img = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)

    # Rounded-square ground, matching macOS's squircle proportions closely enough.
    pad = int(S * 0.055)
    d.rounded_rectangle(
        [pad, pad, S - pad, S - pad],
        radius=int(S * 0.225),
        fill=BG,
    )

    cx = cy = S / 2
    span = S * 0.205
    nodes = {
        "cl_top": (cx - span, cy - span, CLAUDE, 1.0),
        "cl_bot": (cx - span, cy + span, CLAUDE, 0.5),
        "co_top": (cx + span, cy - span, COPILOT, 0.5),
        "co_bot": (cx + span, cy + span, COPILOT, 1.0),
    }

    width = int(S * 0.016)

    # Spokes into the shared centre, tinted toward whichever node they leave.
    for x, y, color, _ in nodes.values():
        d.line([x, y, cx, cy], fill=lerp(LINE, color, 0.35), width=width)

    # The outer ring: each side's two nodes stay wired to each other.
    d.line([nodes["cl_top"][0], nodes["cl_top"][1], nodes["cl_bot"][0], nodes["cl_bot"][1]],
           fill=lerp(LINE, CLAUDE, 0.2), width=width)
    d.line([nodes["co_top"][0], nodes["co_top"][1], nodes["co_bot"][0], nodes["co_bot"][1]],
           fill=lerp(LINE, COPILOT, 0.2), width=width)

    r = S * 0.072
    for x, y, color, alpha in nodes.values():
        fill = color[:3] + (round(255 * alpha),)
        d.ellipse([x - r, y - r, x + r, y + r], fill=fill)

    # The centre node is the bridge: hollow, so it reads as a junction rather
    # than a fifth peer.
    cr = S * 0.088
    d.ellipse([cx - cr, cy - cr, cx + cr, cy + cr], fill=BG)
    d.ellipse([cx - cr, cy - cr, cx + cr, cy + cr], outline=CENTER_RING, width=int(S * 0.019))

    out = img.resize((SIZE, SIZE), Image.LANCZOS)
    assets = Path(__file__).resolve().parent.parent / "assets"
    assets.mkdir(exist_ok=True)
    out.save(assets / "icon.png")

    # A 256px copy for the README header.
    out.resize((256, 256), Image.LANCZOS).save(assets / "logo.png")
    print(f"wrote {assets/'icon.png'} (1024) and {assets/'logo.png'} (256)")

if __name__ == "__main__":
    main()
