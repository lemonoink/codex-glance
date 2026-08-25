ARDUINO_FQBN := esp32:esp32:waveshare_esp32_s3_touch_lcd_169:CDCOnBoot=cdc,PSRAM=enabled,PartitionScheme=app3M_fat9M_16MB
FIRMWARE_DIR := firmware/codex_glance

.PHONY: env-check bridge-install bridge-test bridge-run bridge-demo firmware-font firmware-compile firmware-upload firmware-monitor

env-check:
	./scripts/check-env.sh

bridge-install:
	npm --prefix bridge install

bridge-test:
	npm --prefix bridge test
	npm --prefix bridge run lint
	npm --prefix bridge run build

bridge-run:
	npm --prefix bridge run dev $(if $(PORT),-- --port "$(PORT)",)

bridge-demo:
	@test -n "$(PORT)" || (echo "PORT is required; run: npm --prefix bridge run ports" && exit 1)
	npm --prefix bridge run demo -- --port "$(PORT)"

firmware-font:
	@test -n "$(FONT)" || (echo "FONT is required; provide NotoSansSC-Regular.otf" && exit 1)
	./scripts/generate-cjk-font.sh "$(FONT)"

firmware-compile:
	arduino-cli compile --fqbn "$(ARDUINO_FQBN)" "$(FIRMWARE_DIR)"

firmware-upload:
	@test -n "$(PORT)" || (echo "PORT is required; run: arduino-cli board list" && exit 1)
	arduino-cli upload --fqbn "$(ARDUINO_FQBN)" --port "$(PORT)" "$(FIRMWARE_DIR)"

firmware-monitor:
	@test -n "$(PORT)" || (echo "PORT is required; run: arduino-cli board list" && exit 1)
	arduino-cli monitor --port "$(PORT)" --config baudrate=115200
