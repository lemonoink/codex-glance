#!/bin/sh

set -eu

if [ "$#" -ne 1 ]; then
    echo "usage: $0 /path/to/NotoSansSC-Regular.otf"
    exit 1
fi

font_source=$1
output_path="firmware/codex_glance/codex_glance_cjk_16.c"
font_symbols=$(node scripts/gb2312-symbols.mjs)

npx --yes lv_font_conv@1.5.3 \
    --size 16 \
    --bpp 2 \
    --format lvgl \
    --font "$font_source" \
    --range 0x20-0x7E,0x00B7,0x3000-0x303F,0xFF01-0xFF5E \
    --symbols "$font_symbols" \
    --no-kerning \
    --lv-include lvgl.h \
    --lv-font-name codex_glance_cjk_16 \
    --output "$output_path"

node scripts/normalize-lvgl-font.mjs "$output_path"

echo "generated: $output_path"
