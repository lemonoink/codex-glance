#!/bin/sh

set -eu

EXPECTED_CORE="3.3.11"
EXPECTED_GFX="1.6.7"
EXPECTED_JSON="7.4.3"
EXPECTED_LVGL="9.5.0"
BOARD_FQBN="esp32:esp32:waveshare_esp32_s3_touch_lcd_169"

require_command() {
    if ! command -v "$1" >/dev/null 2>&1; then
        echo "missing: $1"
        exit 1
    fi
}

for command_name in git node npm arduino-cli jq; do
    require_command "$command_name"
done

echo "node:        $(node --version)"
echo "npm:         $(npm --version)"
echo "arduino-cli: $(arduino-cli version | sed -n '1p')"

core_version=$(arduino-cli core list --format json | jq -r '.platforms[] | select(.id == "esp32:esp32") | .installed_version')
if [ "$core_version" != "$EXPECTED_CORE" ]; then
    echo "ESP32 core: expected $EXPECTED_CORE, found ${core_version:-missing}"
    exit 1
fi
echo "ESP32 core:  $core_version"

library_json=$(arduino-cli lib list --format json)
gfx_version=$(printf '%s' "$library_json" | jq -r '.installed_libraries[] | select(.library.name == "GFX Library for Arduino") | .library.version')
json_version=$(printf '%s' "$library_json" | jq -r '.installed_libraries[] | select(.library.name == "ArduinoJson") | .library.version')
lvgl_version=$(printf '%s' "$library_json" | jq -r '.installed_libraries[] | select(.library.name == "lvgl") | .library.version')

if [ "$gfx_version" != "$EXPECTED_GFX" ] || [ "$json_version" != "$EXPECTED_JSON" ] || [ "$lvgl_version" != "$EXPECTED_LVGL" ]; then
    echo "library mismatch: Arduino_GFX=${gfx_version:-missing}, ArduinoJson=${json_version:-missing}, LVGL=${lvgl_version:-missing}"
    exit 1
fi
echo "Arduino_GFX: $gfx_version"
echo "ArduinoJson: $json_version"
echo "LVGL:        $lvgl_version"

cjk_glyph_count=$(node scripts/gb2312-symbols.mjs --count)
if [ "$cjk_glyph_count" != "6763" ]; then
    echo "CJK glyph set: expected 6763, found $cjk_glyph_count"
    exit 1
fi
echo "CJK glyphs:  $cjk_glyph_count"

if grep -q '^#define LV_USE_FONT_COMPRESSED 1$' firmware/codex_glance/lv_conf.h; then
    echo "CJK decoder: enabled"
else
    echo "CJK decoder: disabled (compressed glyphs will render blank)"
    exit 1
fi

if ! arduino-cli board details --fqbn "$BOARD_FQBN" >/dev/null 2>&1; then
    echo "missing board definition: $BOARD_FQBN"
    exit 1
fi
echo "board:       $BOARD_FQBN"

board_port=$(arduino-cli board list --format json | jq -r '.detected_ports[]? | select(any(.matching_boards[]?; .fqbn == "esp32:esp32:esp32_family")) | .port.address' | sed -n '1p')
if [ -n "$board_port" ]; then
    echo "USB device:  $board_port"
else
    echo "USB device:  not connected (compile remains available)"
fi

echo "environment ready"
