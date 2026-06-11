#!/usr/bin/env python3
"""Regenerate all whim brand icons from src/assets/image.png.

Crops the logo to a centered square with comfortable padding, then downscales
(LANCZOS, no upscaling) into every app/window/tray/icon asset the repo uses.
"""
import os
import subprocess
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, 'src', 'assets', 'image.png')

# Content bbox measured from image.png: (284,258,769,612), center (526,435).
# Square crop centered on the logo with ~76% width fill (side 640 from a 1024 src).
CENTER_X, CENTER_Y = 526, 435
HALF = 320  # -> 640px square


def load_master():
    im = Image.open(SRC).convert('RGBA')
    box = (CENTER_X - HALF, CENTER_Y - HALF, CENTER_X + HALF, CENTER_Y + HALF)
    master = im.crop(box)
    assert master.size == (2 * HALF, 2 * HALF), master.size
    return master


def resized(master, size):
    return master.resize((size, size), Image.LANCZOS)


def save_png(master, path, size):
    os.makedirs(os.path.dirname(path) or '.', exist_ok=True)
    resized(master, size).save(path, format='PNG')
    print(f'  png  {size:>4}px  {os.path.relpath(path, ROOT)}')


def save_ico(master, path, sizes):
    os.makedirs(os.path.dirname(path) or '.', exist_ok=True)
    base = resized(master, max(sizes))
    base.save(path, format='ICO', sizes=[(s, s) for s in sizes])
    print(f'  ico         {os.path.relpath(path, ROOT)}  sizes={sizes}')


def main():
    master = load_master()
    print(f'master crop: {master.size}')

    # 1) copilot.png (window icon / welcome / walkthrough) — 512 square, transparent.
    for rel in ['copilot.png',
                os.path.join('src', 'renderer', 'copilot.png'),
                os.path.join('src', 'assets', 'copilot.png'),
                os.path.join('walkthrough', 'assets', 'copilot.png')]:
        save_png(master, os.path.join(ROOT, rel), 512)

    # 2) Tray icons. macOS tray is a template image (alpha silhouette) -> 32px.
    #    Windows tray is colored -> 16px.
    save_png(master, os.path.join(ROOT, 'src', 'assets', 'tray-icon.png'), 32)
    save_png(master, os.path.join(ROOT, 'src', 'assets', 'tray-icon-16.png'), 16)

    # 3) Windows ICO (window icon + packaging icon).
    ico_sizes = [16, 24, 32, 48, 64, 128, 256]
    save_ico(master, os.path.join(ROOT, 'src', 'assets', 'icon.ico'), ico_sizes)
    save_ico(master, os.path.join(ROOT, 'build', 'icon.ico'), ico_sizes)

    # 4) macOS iconset -> icns (matches existing entry set).
    iconset = os.path.join(ROOT, 'build', 'icon.iconset')
    os.makedirs(iconset, exist_ok=True)
    iconset_map = {
        'icon_16x16.png': 16,
        'icon_16x16@2x.png': 32,
        'icon_32x32.png': 32,
        'icon_32x32@2x.png': 64,
        'icon_128x128.png': 128,
        'icon_128x128@2x.png': 256,
        'icon_256x256.png': 256,
        'icon_256x256@2x.png': 512,
    }
    for name, size in iconset_map.items():
        save_png(master, os.path.join(iconset, name), size)

    icns = os.path.join(ROOT, 'build', 'icon.icns')
    subprocess.run(['iconutil', '-c', 'icns', iconset, '-o', icns], check=True)
    print(f'  icns        {os.path.relpath(icns, ROOT)}')


if __name__ == '__main__':
    main()
