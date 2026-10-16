#!/usr/bin/env python3
"""Build deterministic transparent long-cloud WebP layers for Song cards.

This is *only fog texture*, not a surrogate for curated painting/ceramic art.
Requires Pillow; reproducible seed and known output paths.
"""
from pathlib import Path
from random import Random
import argparse

from PIL import Image, ImageFilter

WIDTH = 1024
HEIGHT = 512
PROFILES = {
    "far-light": ((222, 226, 217), 34, 0.53),
    "near-light": ((239, 237, 227), 76, 0.68),
    "far-dark": ((64, 83, 88), 52, 0.49),
    "near-dark": ((37, 52, 62), 101, 0.63),
}


def field(width: int, height: int, grid_width: int, seed: int) -> Image.Image:
    rng = Random(seed)
    grid_height = max(2, round(height * grid_width / width))
    values = bytes(rng.randrange(0, 256) for _ in range(grid_width * grid_height))
    image = Image.frombytes("L", (grid_width, grid_height), values)
    return image.resize((width, height), Image.Resampling.BICUBIC).filter(
        ImageFilter.GaussianBlur(3)
    )


def create_layer(name: str, target: Path) -> None:
    pigment, density, height_bias = PROFILES[name]
    n1 = field(WIDTH, HEIGHT, 12, 20 + len(name) * 3)
    n2 = field(WIDTH, HEIGHT, 27, 810 + len(name) * 13)
    n3 = field(WIDTH, HEIGHT, 56, 1301 + len(name) * 19)
    v1, v2, v3 = n1.tobytes(), n2.tobytes(), n3.tobytes()
    alpha = bytearray(WIDTH * HEIGHT)
    for y in range(HEIGHT):
        # Clouds emerge from the lower half but wander above the silhouette.
        valley = max(0.0, min(1.0, (y / HEIGHT - (height_bias - .27)) * 2.0))
        base = (.16 + .84 * valley)
        for x in range(WIDTH):
            i = y * WIDTH + x
            f = (v1[i] * .52 + v2[i] * .34 + v3[i] * .14) / 255
            ridge = max(0.0, (f - .39) * 3.2)
            streak = .83 + .17 * ((x // 90) % 3) / 2
            alpha[i] = int(min(192, max(0, density * ridge * base * streak)))
    output = Image.new("RGBA", (WIDTH, HEIGHT), pigment + (0,))
    output.putalpha(Image.frombytes("L", (WIDTH, HEIGHT), bytes(alpha)))
    output.save(target, "WEBP", quality=86, method=6, lossless=False)
    # Some Pillow/libwebp builds emit odd-length RIFF files while declaring
    # the padded even length in bytes 4..7. Pillow tolerates the missing pad;
    # Chromium's strict WebP decoder refuses the image. Restore RIFF padding.
    encoded = target.read_bytes()
    assert encoded[:4] == b"RIFF" and encoded[8:12] == b"WEBP", target
    riff_size = int.from_bytes(encoded[4:8], byteorder="little") + 8
    if len(encoded) + 1 == riff_size:
        encoded += b"\x00"
    if len(encoded) != riff_size:
        raise ValueError(f"Invalid WebP RIFF length {len(encoded)} != {riff_size}: {target}")
    target.write_bytes(encoded)
    assert target.stat().st_size > 1500, f"Unexpectedly empty fog layer: {target}"
    print(f"{name}: {target.stat().st_size} bytes -> {target}")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", default="public/assets/achievements/song/shared/mist")
    args = parser.parse_args()
    folder = Path(args.output)
    folder.mkdir(parents=True, exist_ok=True)
    for name in PROFILES:
        create_layer(name, folder / f"{name}.webp")


if __name__ == "__main__":
    main()
