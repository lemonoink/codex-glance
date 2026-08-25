#include <Arduino.h>
#include <ArduinoJson.h>
#include <Arduino_GFX_Library.h>
#include <HWCDC.h>
#include <lvgl.h>

LV_FONT_DECLARE(codex_glance_cjk_16);

namespace {

constexpr int LCD_DC = 4;
constexpr int LCD_CS = 5;
constexpr int LCD_SCK = 6;
constexpr int LCD_MOSI = 7;
constexpr int LCD_RST = 8;
constexpr int LCD_BL = 15;
constexpr uint8_t DISPLAY_ROTATION = 1;
constexpr uint16_t DISPLAY_WIDTH = 280;
constexpr uint16_t DISPLAY_HEIGHT = 240;
constexpr uint16_t DRAW_BUFFER_ROWS = 32;

constexpr uint8_t PROTOCOL_VERSION = 3;
constexpr size_t MAX_MESSAGE_BYTES = 512;
constexpr size_t MAX_SESSION_LENGTH = 8;
constexpr size_t MAX_TASK_ID_LENGTH = 8;
constexpr size_t MAX_TITLE_BYTES = 96;
constexpr size_t MAX_PROJECT_BYTES = 48;
constexpr uint32_t HEARTBEAT_ANIMATION_MS = 500;
constexpr uint32_t LINK_TIMEOUT_MS = 10000;

constexpr const char *TOP_FIELDS[] = {
    "v",
    "type",
    "session",
    "seq",
    "counts",
    "page",
    "task",
};
constexpr const char *COUNT_FIELDS[] = {"run", "wait", "err"};
constexpr const char *PAGE_FIELDS[] = {"index", "total"};
constexpr const char *HEARTBEAT_FIELDS[] = {
    "v",
    "type",
    "session",
    "seq",
};
constexpr const char *TASK_FIELDS[] = {
    "id",
    "title",
    "project",
    "slot",
    "status",
    "phase",
    "elapsed",
    "agents",
};

enum class TaskStatus {
    WORKING,
    WAITING,
    DONE,
    ERROR,
};

enum class TaskPhase {
    THINKING,
    READING,
    EDITING,
    COMMAND,
    TESTING,
    SEARCHING,
    TOOL,
    APPROVAL,
    COMPLETE,
    FAILED,
};

struct TaskCard {
    char id[MAX_TASK_ID_LENGTH + 1];
    char title[MAX_TITLE_BYTES + 1];
    char project[MAX_PROJECT_BYTES + 1];
    uint8_t slot;
    TaskStatus status;
    TaskPhase phase;
    uint32_t elapsed;
    uint8_t agents;
};

struct DashboardState {
    char session[MAX_SESSION_LENGTH + 1];
    uint32_t sequence;
    uint8_t runningCount;
    uint8_t waitingCount;
    uint8_t errorCount;
    uint8_t pageIndex;
    uint8_t pageTotal;
    bool hasTask;
    TaskCard task;
};

HWCDC usbSerial;
Arduino_DataBus *displayBus = new Arduino_ESP32SPI(
    LCD_DC,
    LCD_CS,
    LCD_SCK,
    LCD_MOSI
);
Arduino_GFX *display = new Arduino_ST7789(
    displayBus,
    LCD_RST,
    0,
    true,
    240,
    280,
    0,
    20,
    0,
    20
);

uint8_t drawBuffer[DISPLAY_WIDTH * DRAW_BUFFER_ROWS * 2];
char inputBuffer[MAX_MESSAGE_BYTES];
size_t inputLength = 0;
bool inputOverflow = false;
DashboardState dashboard = {};
bool hasSnapshot = false;
bool linkLost = false;
bool heartbeatOn = false;
uint32_t lastSnapshotMs = 0;
uint32_t lastHeartbeatAnimationMs = 0;
uint32_t lastIdleRefreshMs = 0;

lv_display_t *lvDisplay = nullptr;
lv_obj_t *countsLabel = nullptr;
lv_obj_t *taskCardObject = nullptr;
lv_obj_t *accentBar = nullptr;
lv_obj_t *projectLabel = nullptr;
lv_obj_t *slotLabel = nullptr;
lv_obj_t *titleLabel = nullptr;
lv_obj_t *statusPill = nullptr;
lv_obj_t *statusLabelObject = nullptr;
lv_obj_t *phaseLabelObject = nullptr;
lv_obj_t *elapsedLabel = nullptr;
lv_obj_t *agentsLabel = nullptr;
lv_obj_t *idleCard = nullptr;
lv_obj_t *idleAccentBar = nullptr;
lv_obj_t *idlePill = nullptr;
lv_obj_t *idlePillLabel = nullptr;
lv_obj_t *idlePulseOuter = nullptr;
lv_obj_t *idlePulseInner = nullptr;
lv_obj_t *idleTitleLabel = nullptr;
lv_obj_t *idleSubtitleLabel = nullptr;
lv_obj_t *idleMetaLabel = nullptr;
lv_obj_t *pageLabel = nullptr;
lv_obj_t *pageBar = nullptr;
lv_obj_t *linkLabel = nullptr;
lv_obj_t *linkDot = nullptr;

const char *statusLabel(TaskStatus status) {
    switch (status) {
        case TaskStatus::WORKING:
            return "WORKING";
        case TaskStatus::WAITING:
            return "WAITING";
        case TaskStatus::DONE:
            return "DONE";
        case TaskStatus::ERROR:
            return "ERROR";
    }
    return "UNKNOWN";
}

const char *phaseLabel(TaskPhase phase) {
    switch (phase) {
        case TaskPhase::THINKING:
            return "THINKING";
        case TaskPhase::READING:
            return "READING";
        case TaskPhase::EDITING:
            return "EDITING";
        case TaskPhase::COMMAND:
            return "COMMAND";
        case TaskPhase::TESTING:
            return "TESTING";
        case TaskPhase::SEARCHING:
            return "SEARCHING";
        case TaskPhase::TOOL:
            return "TOOL";
        case TaskPhase::APPROVAL:
            return "APPROVAL";
        case TaskPhase::COMPLETE:
            return "COMPLETE";
        case TaskPhase::FAILED:
            return "FAILED";
    }
    return "UNKNOWN";
}

lv_color_t statusColor(TaskStatus status) {
    switch (status) {
        case TaskStatus::WORKING:
            return lv_color_hex(0x35D6FF);
        case TaskStatus::WAITING:
            return lv_color_hex(0xFFB648);
        case TaskStatus::DONE:
            return lv_color_hex(0x56E39F);
        case TaskStatus::ERROR:
            return lv_color_hex(0xFF5C68);
    }
    return lv_color_white();
}

bool parseStatus(const char *value, TaskStatus &status) {
    if (strcmp(value, "WORKING") == 0) {
        status = TaskStatus::WORKING;
    } else if (strcmp(value, "WAITING") == 0) {
        status = TaskStatus::WAITING;
    } else if (strcmp(value, "DONE") == 0) {
        status = TaskStatus::DONE;
    } else if (strcmp(value, "ERROR") == 0) {
        status = TaskStatus::ERROR;
    } else {
        return false;
    }
    return true;
}

bool parsePhase(const char *value, TaskPhase &phase) {
    if (strcmp(value, "THINKING") == 0) {
        phase = TaskPhase::THINKING;
    } else if (strcmp(value, "READING") == 0) {
        phase = TaskPhase::READING;
    } else if (strcmp(value, "EDITING") == 0) {
        phase = TaskPhase::EDITING;
    } else if (strcmp(value, "COMMAND") == 0) {
        phase = TaskPhase::COMMAND;
    } else if (strcmp(value, "TESTING") == 0) {
        phase = TaskPhase::TESTING;
    } else if (strcmp(value, "SEARCHING") == 0) {
        phase = TaskPhase::SEARCHING;
    } else if (strcmp(value, "TOOL") == 0) {
        phase = TaskPhase::TOOL;
    } else if (strcmp(value, "APPROVAL") == 0) {
        phase = TaskPhase::APPROVAL;
    } else if (strcmp(value, "COMPLETE") == 0) {
        phase = TaskPhase::COMPLETE;
    } else if (strcmp(value, "FAILED") == 0) {
        phase = TaskPhase::FAILED;
    } else {
        return false;
    }
    return true;
}

bool hasOnlyFields(
    JsonObjectConst object,
    const char *const *allowedFields,
    size_t allowedCount
) {
    if (object.size() != allowedCount) {
        return false;
    }

    for (JsonPairConst pair : object) {
        bool allowed = false;
        for (size_t index = 0; index < allowedCount; ++index) {
            if (strcmp(pair.key().c_str(), allowedFields[index]) == 0) {
                allowed = true;
                break;
            }
        }
        if (!allowed) {
            return false;
        }
    }
    return true;
}

bool isLowerHex(const char *value) {
    for (const char *cursor = value; *cursor != '\0'; ++cursor) {
        const bool digit = *cursor >= '0' && *cursor <= '9';
        const bool lowerHex = *cursor >= 'a' && *cursor <= 'f';
        if (!digit && !lowerHex) {
            return false;
        }
    }
    return true;
}

bool isSafeDisplayText(const char *value) {
    for (
        const unsigned char *cursor =
            reinterpret_cast<const unsigned char *>(value);
        *cursor != '\0';
        ++cursor
    ) {
        if (*cursor < 0x20 || *cursor == 0x7F) {
            return false;
        }
    }
    return true;
}

bool copyToken(
    JsonVariantConst variant,
    char *destination,
    size_t destinationSize,
    size_t minimumLength,
    bool (*validator)(const char *)
) {
    if (!variant.is<const char *>()) {
        return false;
    }

    const char *value = variant.as<const char *>();
    const size_t length = strlen(value);
    if (
        length < minimumLength ||
        length >= destinationSize ||
        !validator(value)
    ) {
        return false;
    }

    snprintf(destination, destinationSize, "%s", value);
    return true;
}

bool readSmallCount(JsonVariantConst variant, uint8_t &value, bool allowZero) {
    if (!variant.is<uint8_t>()) {
        return false;
    }
    value = variant.as<uint8_t>();
    return value <= 99 && (allowZero || value > 0);
}

bool parseTask(JsonObjectConst object, TaskCard &task) {
    if (!hasOnlyFields(object, TASK_FIELDS, 8)) {
        return false;
    }

    const char *statusValue = object["status"].as<const char *>();
    const char *phaseValue = object["phase"].as<const char *>();
    if (
        !copyToken(object["id"], task.id, sizeof(task.id), 1, isLowerHex) ||
        !copyToken(
            object["title"],
            task.title,
            sizeof(task.title),
            1,
            isSafeDisplayText
        ) ||
        !copyToken(
            object["project"],
            task.project,
            sizeof(task.project),
            1,
            isSafeDisplayText
        ) ||
        !object["status"].is<const char *>() ||
        !object["phase"].is<const char *>() ||
        !parseStatus(statusValue, task.status) ||
        !parsePhase(phaseValue, task.phase) ||
        !readSmallCount(object["slot"], task.slot, false) ||
        !object["elapsed"].is<uint32_t>() ||
        !readSmallCount(object["agents"], task.agents, false)
    ) {
        return false;
    }

    task.elapsed = object["elapsed"].as<uint32_t>();
    return true;
}

bool parseDashboard(JsonDocument &document, DashboardState &next) {
    const JsonObjectConst object = document.as<JsonObjectConst>();
    if (
        object.isNull() ||
        !hasOnlyFields(object, TOP_FIELDS, 7) ||
        !document["v"].is<uint8_t>() ||
        document["v"].as<uint8_t>() != PROTOCOL_VERSION ||
        !document["type"].is<const char *>() ||
        strcmp(document["type"].as<const char *>(), "dashboard") != 0 ||
        !copyToken(
            document["session"],
            next.session,
            sizeof(next.session),
            4,
            isLowerHex
        ) ||
        !document["seq"].is<uint32_t>() ||
        !document["counts"].is<JsonObjectConst>() ||
        !document["page"].is<JsonObjectConst>()
    ) {
        return false;
    }

    next.sequence = document["seq"].as<uint32_t>();
    const JsonObjectConst counts = document["counts"].as<JsonObjectConst>();
    if (
        !hasOnlyFields(counts, COUNT_FIELDS, 3) ||
        !readSmallCount(counts["run"], next.runningCount, true) ||
        !readSmallCount(counts["wait"], next.waitingCount, true) ||
        !readSmallCount(counts["err"], next.errorCount, true)
    ) {
        return false;
    }

    const JsonObjectConst page = document["page"].as<JsonObjectConst>();
    if (
        !hasOnlyFields(page, PAGE_FIELDS, 2) ||
        !readSmallCount(page["index"], next.pageIndex, true) ||
        !readSmallCount(page["total"], next.pageTotal, true)
    ) {
        return false;
    }

    if (next.pageTotal == 0) {
        next.hasTask = false;
        return next.pageIndex == 0 && document["task"].isNull();
    }
    if (
        next.pageIndex == 0 ||
        next.pageIndex > next.pageTotal ||
        !document["task"].is<JsonObjectConst>()
    ) {
        return false;
    }

    next.hasTask = parseTask(
        document["task"].as<JsonObjectConst>(),
        next.task
    );
    if (!next.hasTask) {
        return false;
    }
    if (
        next.task.status == TaskStatus::WORKING &&
        next.runningCount == 0
    ) {
        return false;
    }
    if (
        next.task.status == TaskStatus::WAITING &&
        next.waitingCount == 0
    ) {
        return false;
    }
    if (next.task.status == TaskStatus::ERROR && next.errorCount == 0) {
        return false;
    }
    return true;
}

void formatElapsed(uint32_t elapsed, char *output, size_t outputSize) {
    const uint32_t hours = min(elapsed / 3600, static_cast<uint32_t>(99));
    const uint32_t minutes = (elapsed / 60) % 60;
    const uint32_t seconds = elapsed % 60;
    if (hours > 0) {
        snprintf(
            output,
            outputSize,
            "%02lu:%02lu:%02lu",
            static_cast<unsigned long>(hours),
            static_cast<unsigned long>(minutes),
            static_cast<unsigned long>(seconds)
        );
    } else {
        snprintf(
            output,
            outputSize,
            "%02lu:%02lu",
            static_cast<unsigned long>(minutes),
            static_cast<unsigned long>(seconds)
        );
    }
}

void displayFlush(
    lv_display_t *lvDisplayHandle,
    const lv_area_t *area,
    uint8_t *pixelMap
) {
    const int16_t width = area->x2 - area->x1 + 1;
    const int16_t height = area->y2 - area->y1 + 1;
    display->draw16bitRGBBitmap(
        area->x1,
        area->y1,
        reinterpret_cast<uint16_t *>(pixelMap),
        width,
        height
    );
    lv_display_flush_ready(lvDisplayHandle);
}

void slideCardX(void *object, int32_t value) {
    lv_obj_set_x(static_cast<lv_obj_t *>(object), value);
}

void animateTaskCard() {
    lv_anim_t animation;
    lv_anim_init(&animation);
    lv_anim_set_var(&animation, taskCardObject);
    lv_anim_set_values(&animation, DISPLAY_WIDTH, 10);
    lv_anim_set_duration(&animation, 280);
    lv_anim_set_path_cb(&animation, lv_anim_path_ease_out);
    lv_anim_set_exec_cb(&animation, slideCardX);
    lv_anim_start(&animation);
}

void setObjectBackground(lv_obj_t *object, uint32_t color) {
    lv_obj_set_style_bg_color(object, lv_color_hex(color), 0);
    lv_obj_set_style_bg_opa(object, LV_OPA_COVER, 0);
}

lv_obj_t *createLabel(
    lv_obj_t *parent,
    const lv_font_t *font,
    lv_color_t color
) {
    lv_obj_t *label = lv_label_create(parent);
    lv_obj_set_style_text_font(label, font, 0);
    lv_obj_set_style_text_color(label, color, 0);
    return label;
}

void createUi() {
    lv_obj_t *screen = lv_screen_active();
    setObjectBackground(screen, 0x080B10);
    lv_obj_set_style_pad_all(screen, 0, 0);
    lv_obj_remove_flag(screen, LV_OBJ_FLAG_SCROLLABLE);

    lv_obj_t *brand = createLabel(
        screen,
        &lv_font_montserrat_16,
        lv_color_hex(0xF3F7FA)
    );
    lv_label_set_text(brand, "CODEX GLANCE");
    lv_obj_set_pos(brand, 20, 10);

    countsLabel = createLabel(
        screen,
        &lv_font_montserrat_12,
        lv_color_hex(0x8A96A3)
    );
    lv_label_set_text(countsLabel, "R0  W0  E0");
    lv_obj_align(countsLabel, LV_ALIGN_TOP_RIGHT, -20, 12);

    lv_obj_t *headerLine = lv_obj_create(screen);
    lv_obj_set_size(headerLine, 256, 1);
    lv_obj_set_pos(headerLine, 12, 39);
    setObjectBackground(headerLine, 0x202832);
    lv_obj_set_style_border_width(headerLine, 0, 0);
    lv_obj_set_style_radius(headerLine, 0, 0);

    taskCardObject = lv_obj_create(screen);
    lv_obj_set_size(taskCardObject, 260, 160);
    lv_obj_set_pos(taskCardObject, 10, 45);
    setObjectBackground(taskCardObject, 0x111720);
    lv_obj_set_style_radius(taskCardObject, 14, 0);
    lv_obj_set_style_border_width(taskCardObject, 1, 0);
    lv_obj_set_style_border_color(
        taskCardObject,
        lv_color_hex(0x2A3440),
        0
    );
    lv_obj_set_style_pad_all(taskCardObject, 0, 0);
    lv_obj_remove_flag(taskCardObject, LV_OBJ_FLAG_SCROLLABLE);

    accentBar = lv_obj_create(taskCardObject);
    lv_obj_set_size(accentBar, 4, 128);
    lv_obj_set_pos(accentBar, 0, 16);
    setObjectBackground(accentBar, 0x35D6FF);
    lv_obj_set_style_border_width(accentBar, 0, 0);
    lv_obj_set_style_radius(accentBar, 3, 0);

    projectLabel = createLabel(
        taskCardObject,
        &codex_glance_cjk_16,
        lv_color_hex(0x8A96A3)
    );
    lv_obj_set_pos(projectLabel, 16, 13);
    lv_obj_set_size(projectLabel, 120, 19);
    lv_label_set_long_mode(projectLabel, LV_LABEL_LONG_DOT);

    slotLabel = createLabel(
        taskCardObject,
        &lv_font_montserrat_12,
        lv_color_hex(0x8A96A3)
    );
    lv_obj_set_size(slotLabel, 27, 16);
    lv_obj_set_pos(slotLabel, 139, 15);
    lv_obj_set_style_text_align(slotLabel, LV_TEXT_ALIGN_RIGHT, 0);
    lv_label_set_long_mode(slotLabel, LV_LABEL_LONG_CLIP);

    statusPill = lv_obj_create(taskCardObject);
    lv_obj_set_size(statusPill, 78, 25);
    lv_obj_set_pos(statusPill, 170, 9);
    lv_obj_set_style_radius(statusPill, 13, 0);
    lv_obj_set_style_border_width(statusPill, 0, 0);
    lv_obj_set_style_pad_all(statusPill, 0, 0);
    lv_obj_remove_flag(statusPill, LV_OBJ_FLAG_SCROLLABLE);
    statusLabelObject = createLabel(
        statusPill,
        &lv_font_montserrat_12,
        lv_color_hex(0x080B10)
    );
    lv_obj_center(statusLabelObject);

    titleLabel = createLabel(
        taskCardObject,
        &codex_glance_cjk_16,
        lv_color_hex(0xF3F7FA)
    );
    lv_obj_set_pos(titleLabel, 16, 44);
    lv_obj_set_size(titleLabel, 228, 47);
    lv_label_set_long_mode(titleLabel, LV_LABEL_LONG_WRAP);

    phaseLabelObject = createLabel(
        taskCardObject,
        &lv_font_montserrat_14,
        lv_color_hex(0x35D6FF)
    );
    lv_obj_set_pos(phaseLabelObject, 16, 99);

    elapsedLabel = createLabel(
        taskCardObject,
        &lv_font_montserrat_14,
        lv_color_hex(0xF3F7FA)
    );
    lv_obj_set_pos(elapsedLabel, 16, 128);

    agentsLabel = createLabel(
        taskCardObject,
        &codex_glance_cjk_16,
        lv_color_hex(0x8A96A3)
    );
    lv_obj_align(agentsLabel, LV_ALIGN_BOTTOM_RIGHT, -14, -13);

    idleCard = lv_obj_create(screen);
    lv_obj_set_size(idleCard, 260, 160);
    lv_obj_set_pos(idleCard, 10, 45);
    setObjectBackground(idleCard, 0x111720);
    lv_obj_set_style_radius(idleCard, 14, 0);
    lv_obj_set_style_border_width(idleCard, 1, 0);
    lv_obj_set_style_border_color(idleCard, lv_color_hex(0x2A3440), 0);
    lv_obj_set_style_pad_all(idleCard, 0, 0);
    lv_obj_remove_flag(idleCard, LV_OBJ_FLAG_SCROLLABLE);

    idleAccentBar = lv_obj_create(idleCard);
    lv_obj_set_size(idleAccentBar, 4, 128);
    lv_obj_set_pos(idleAccentBar, 0, 16);
    setObjectBackground(idleAccentBar, 0x35D6FF);
    lv_obj_set_style_border_width(idleAccentBar, 0, 0);
    lv_obj_set_style_radius(idleAccentBar, 3, 0);

    lv_obj_t *idleSectionLabel = createLabel(
        idleCard,
        &lv_font_montserrat_12,
        lv_color_hex(0x8A96A3)
    );
    lv_label_set_text(idleSectionLabel, "SYSTEM STATUS");
    lv_obj_set_pos(idleSectionLabel, 16, 13);

    idlePill = lv_obj_create(idleCard);
    lv_obj_set_size(idlePill, 78, 25);
    lv_obj_set_pos(idlePill, 170, 9);
    setObjectBackground(idlePill, 0x35D6FF);
    lv_obj_set_style_radius(idlePill, 13, 0);
    lv_obj_set_style_border_width(idlePill, 0, 0);
    lv_obj_set_style_pad_all(idlePill, 0, 0);
    lv_obj_remove_flag(idlePill, LV_OBJ_FLAG_SCROLLABLE);
    idlePillLabel = createLabel(
        idlePill,
        &lv_font_montserrat_12,
        lv_color_hex(0x080B10)
    );
    lv_label_set_text(idlePillLabel, "CONNECT");
    lv_obj_center(idlePillLabel);

    idlePulseOuter = lv_obj_create(idleCard);
    lv_obj_set_size(idlePulseOuter, 34, 34);
    lv_obj_set_pos(idlePulseOuter, 113, 42);
    lv_obj_set_style_radius(idlePulseOuter, LV_RADIUS_CIRCLE, 0);
    lv_obj_set_style_border_width(idlePulseOuter, 0, 0);
    lv_obj_set_style_bg_color(idlePulseOuter, lv_color_hex(0x35D6FF), 0);
    lv_obj_set_style_bg_opa(idlePulseOuter, LV_OPA_20, 0);

    idlePulseInner = lv_obj_create(idleCard);
    lv_obj_set_size(idlePulseInner, 12, 12);
    lv_obj_set_pos(idlePulseInner, 124, 53);
    setObjectBackground(idlePulseInner, 0x35D6FF);
    lv_obj_set_style_radius(idlePulseInner, LV_RADIUS_CIRCLE, 0);
    lv_obj_set_style_border_width(idlePulseInner, 0, 0);

    idleTitleLabel = createLabel(
        idleCard,
        &codex_glance_cjk_16,
        lv_color_hex(0xF3F7FA)
    );
    lv_label_set_text(idleTitleLabel, "等待 Bridge");
    lv_obj_set_width(idleTitleLabel, 228);
    lv_obj_set_style_text_align(idleTitleLabel, LV_TEXT_ALIGN_CENTER, 0);
    lv_obj_set_pos(idleTitleLabel, 16, 82);

    idleSubtitleLabel = createLabel(
        idleCard,
        &codex_glance_cjk_16,
        lv_color_hex(0x8A96A3)
    );
    lv_label_set_text(idleSubtitleLabel, "请在 Mac 上启动连接服务");
    lv_obj_set_width(idleSubtitleLabel, 228);
    lv_obj_set_style_text_align(idleSubtitleLabel, LV_TEXT_ALIGN_CENTER, 0);
    lv_obj_set_pos(idleSubtitleLabel, 16, 105);

    idleMetaLabel = createLabel(
        idleCard,
        &lv_font_montserrat_12,
        lv_color_hex(0x5E6A78)
    );
    lv_label_set_text(idleMetaLabel, "USB CDC  |  PROTOCOL V3");
    lv_obj_set_width(idleMetaLabel, 228);
    lv_obj_set_style_text_align(idleMetaLabel, LV_TEXT_ALIGN_CENTER, 0);
    lv_obj_set_pos(idleMetaLabel, 16, 137);

    pageBar = lv_bar_create(screen);
    lv_obj_set_size(pageBar, 70, 3);
    lv_obj_set_pos(pageBar, 104, 217);
    lv_obj_set_style_bg_color(pageBar, lv_color_hex(0x202832), 0);
    lv_obj_set_style_bg_opa(pageBar, LV_OPA_COVER, 0);
    lv_obj_set_style_bg_color(
        pageBar,
        lv_color_hex(0x35D6FF),
        LV_PART_INDICATOR
    );
    lv_obj_set_style_radius(pageBar, 2, 0);
    lv_obj_set_style_radius(pageBar, 2, LV_PART_INDICATOR);

    pageLabel = createLabel(
        screen,
        &lv_font_montserrat_12,
        lv_color_hex(0x8A96A3)
    );
    lv_label_set_text(pageLabel, "0 / 0");
    lv_obj_align(pageLabel, LV_ALIGN_BOTTOM_MID, 0, -5);

    linkLabel = createLabel(
        screen,
        &lv_font_montserrat_12,
        lv_color_hex(0x8A96A3)
    );
    lv_label_set_text(linkLabel, "OFFLINE");
    lv_obj_set_style_text_color(linkLabel, lv_color_hex(0xFF5C68), 0);
    lv_obj_align(linkLabel, LV_ALIGN_BOTTOM_RIGHT, -32, -5);

    linkDot = lv_obj_create(screen);
    lv_obj_set_size(linkDot, 8, 8);
    lv_obj_align(linkDot, LV_ALIGN_BOTTOM_RIGHT, -18, -8);
    lv_obj_set_style_radius(linkDot, LV_RADIUS_CIRCLE, 0);
    lv_obj_set_style_border_width(linkDot, 0, 0);
    setObjectBackground(linkDot, 0xFF5C68);

    lv_obj_add_flag(taskCardObject, LV_OBJ_FLAG_HIDDEN);
    lv_obj_add_flag(pageBar, LV_OBJ_FLAG_HIDDEN);
    lv_obj_add_flag(pageLabel, LV_OBJ_FLAG_HIDDEN);
}

void updateIdleUi(uint32_t now) {
    if (dashboard.hasTask) {
        return;
    }

    const bool online = hasSnapshot && !linkLost;
    uint32_t color = 0x35D6FF;
    const char *pill = "CONNECT";
    const char *title = "等待 Bridge";
    const char *subtitle = "请在 Mac 上启动连接服务";
    char meta[48] = "USB CDC  |  PROTOCOL V3";

    if (online) {
        const uint32_t syncAge = (now - lastSnapshotMs) / 1000;
        color = 0x56E39F;
        pill = "READY";
        title = "暂时空闲";
        subtitle = "等待新的 Codex 任务";
        if (syncAge == 0) {
            snprintf(meta, sizeof(meta), "SYNC NOW  |  USB CDC V3");
        } else {
            snprintf(
                meta,
                sizeof(meta),
                "SYNC %lus AGO  |  USB CDC V3",
                static_cast<unsigned long>(syncAge)
            );
        }
    } else if (hasSnapshot) {
        const uint32_t syncAge = (now - lastSnapshotMs) / 1000;
        color = 0xFF5C68;
        pill = "OFFLINE";
        title = "Bridge 已离线";
        subtitle = "正在等待自动重新连接";
        snprintf(
            meta,
            sizeof(meta),
            "LAST SYNC %lus  |  RETRYING",
            static_cast<unsigned long>(syncAge)
        );
    }

    lv_label_set_text(idlePillLabel, pill);
    lv_label_set_text(idleTitleLabel, title);
    lv_label_set_text(idleSubtitleLabel, subtitle);
    lv_label_set_text(idleMetaLabel, meta);
    lv_obj_set_style_border_color(idleCard, lv_color_hex(color), 0);
    setObjectBackground(idleAccentBar, color);
    setObjectBackground(idlePill, color);
    lv_obj_set_style_bg_color(idlePulseOuter, lv_color_hex(color), 0);
    setObjectBackground(idlePulseInner, color);
}

void updateLinkUi() {
    const bool online = hasSnapshot && !linkLost;
    lv_label_set_text(linkLabel, online ? "LINK" : "OFFLINE");
    lv_obj_set_style_text_color(
        linkLabel,
        online ? lv_color_hex(0x8A96A3) : lv_color_hex(0xFF5C68),
        0
    );
    setObjectBackground(linkDot, online ? 0x35D6FF : 0xFF5C68);
    updateIdleUi(millis());
}

void updateDashboardUi(bool animate) {
    lv_label_set_text_fmt(
        countsLabel,
        "R%u  W%u  E%u",
        dashboard.runningCount,
        dashboard.waitingCount,
        dashboard.errorCount
    );

    if (!dashboard.hasTask) {
        lv_obj_add_flag(taskCardObject, LV_OBJ_FLAG_HIDDEN);
        lv_obj_add_flag(pageBar, LV_OBJ_FLAG_HIDDEN);
        lv_obj_add_flag(pageLabel, LV_OBJ_FLAG_HIDDEN);
        lv_obj_remove_flag(idleCard, LV_OBJ_FLAG_HIDDEN);
        updateLinkUi();
        return;
    }

    const TaskCard &task = dashboard.task;
    const lv_color_t color = statusColor(task.status);
    char elapsed[10];
    formatElapsed(task.elapsed, elapsed, sizeof(elapsed));

    lv_label_set_text(projectLabel, task.project);
    lv_label_set_text_fmt(slotLabel, "#%u", task.slot);
    lv_label_set_text(titleLabel, task.title);
    lv_label_set_text(statusLabelObject, statusLabel(task.status));
    lv_label_set_text(phaseLabelObject, phaseLabel(task.phase));
    lv_label_set_text(elapsedLabel, elapsed);
    lv_label_set_text_fmt(agentsLabel, "AGENTS  %u", task.agents);
    lv_label_set_text_fmt(
        pageLabel,
        "%u / %u",
        dashboard.pageIndex,
        dashboard.pageTotal
    );

    lv_obj_set_style_bg_color(accentBar, color, 0);
    lv_obj_set_style_bg_color(statusPill, color, 0);
    lv_obj_set_style_bg_opa(statusPill, LV_OPA_COVER, 0);
    lv_obj_set_style_text_color(phaseLabelObject, color, 0);
    lv_obj_set_style_border_color(taskCardObject, color, 0);
    lv_bar_set_range(
        pageBar,
        0,
        max<int32_t>(1, dashboard.pageTotal)
    );
    lv_bar_set_value(pageBar, dashboard.pageIndex, LV_ANIM_ON);
    lv_obj_set_style_bg_color(pageBar, color, LV_PART_INDICATOR);

    lv_obj_add_flag(idleCard, LV_OBJ_FLAG_HIDDEN);
    lv_obj_remove_flag(taskCardObject, LV_OBJ_FLAG_HIDDEN);
    lv_obj_remove_flag(pageBar, LV_OBJ_FLAG_HIDDEN);
    lv_obj_remove_flag(pageLabel, LV_OBJ_FLAG_HIDDEN);
    updateLinkUi();

    if (animate) {
        animateTaskCard();
    } else {
        lv_obj_set_x(taskCardObject, 10);
    }
}

void sendNack(const char *code) {
    usbSerial.printf(
        "{\"type\":\"nack\",\"v\":%u,\"code\":\"%s\"}\n",
        PROTOCOL_VERSION,
        code
    );
}

void sendAck() {
    usbSerial.printf(
        "{\"type\":\"ack\",\"v\":%u,\"session\":\"%s\",\"seq\":%lu}\n",
        PROTOCOL_VERSION,
        dashboard.session,
        static_cast<unsigned long>(dashboard.sequence)
    );
}

bool handleHeartbeat(JsonDocument &document) {
    const JsonObjectConst object = document.as<JsonObjectConst>();
    char session[MAX_SESSION_LENGTH + 1] = {};
    if (
        object.isNull() ||
        !hasOnlyFields(object, HEARTBEAT_FIELDS, 4) ||
        !document["v"].is<uint8_t>() ||
        document["v"].as<uint8_t>() != PROTOCOL_VERSION ||
        !document["type"].is<const char *>() ||
        strcmp(document["type"].as<const char *>(), "heartbeat") != 0 ||
        !copyToken(
            document["session"],
            session,
            sizeof(session),
            4,
            isLowerHex
        ) ||
        !document["seq"].is<uint32_t>()
    ) {
        sendNack("invalid_heartbeat");
        return true;
    }

    const uint32_t sequence = document["seq"].as<uint32_t>();
    if (!hasSnapshot || strcmp(dashboard.session, session) != 0) {
        sendNack("session_mismatch");
        return true;
    }
    if (sequence <= dashboard.sequence) {
        sendNack("stale_snapshot");
        return true;
    }

    dashboard.sequence = sequence;
    lastSnapshotMs = millis();
    if (linkLost) {
        linkLost = false;
        updateLinkUi();
    }
    sendAck();
    return true;
}

void handleMessage(const char *message) {
    JsonDocument document;
    const DeserializationError error = deserializeJson(document, message);
    if (error) {
        sendNack("invalid_json");
        return;
    }

    if (
        document["type"].is<const char *>() &&
        strcmp(document["type"].as<const char *>(), "heartbeat") == 0
    ) {
        handleHeartbeat(document);
        return;
    }

    DashboardState next = {};
    if (!parseDashboard(document, next)) {
        sendNack("invalid_dashboard");
        return;
    }
    if (
        hasSnapshot &&
        strcmp(dashboard.session, next.session) == 0 &&
        next.sequence <= dashboard.sequence
    ) {
        sendNack("stale_snapshot");
        return;
    }

    const bool animate =
        hasSnapshot &&
        next.hasTask &&
        dashboard.hasTask &&
        (
            next.pageIndex != dashboard.pageIndex ||
            strcmp(next.task.id, dashboard.task.id) != 0
        );
    dashboard = next;
    hasSnapshot = true;
    linkLost = false;
    lastSnapshotMs = millis();
    updateDashboardUi(animate);
    sendAck();
}

void readSerialInput() {
    while (usbSerial.available() > 0) {
        const char value = static_cast<char>(usbSerial.read());
        if (value == '\r') {
            continue;
        }

        if (value == '\n') {
            if (inputOverflow) {
                sendNack("line_too_long");
            } else if (inputLength > 0) {
                inputBuffer[inputLength] = '\0';
                handleMessage(inputBuffer);
            }
            inputLength = 0;
            inputOverflow = false;
            continue;
        }

        if (inputOverflow) {
            continue;
        }
        if (inputLength >= MAX_MESSAGE_BYTES - 2) {
            inputOverflow = true;
            continue;
        }
        inputBuffer[inputLength++] = value;
    }
}

void updateDisplayState(uint32_t now) {
    if (
        hasSnapshot &&
        !linkLost &&
        now - lastSnapshotMs >= LINK_TIMEOUT_MS
    ) {
        linkLost = true;
        updateLinkUi();
    }

    if (
        !dashboard.hasTask &&
        now - lastIdleRefreshMs >= 1000
    ) {
        lastIdleRefreshMs = now;
        updateIdleUi(now);
    }

    if (now - lastHeartbeatAnimationMs < HEARTBEAT_ANIMATION_MS) {
        return;
    }
    lastHeartbeatAnimationMs = now;
    heartbeatOn = !heartbeatOn;
    if (hasSnapshot && !linkLost) {
        lv_obj_set_style_opa(
            linkDot,
            heartbeatOn ? LV_OPA_COVER : LV_OPA_50,
            0
        );
    } else {
        lv_obj_set_style_opa(linkDot, LV_OPA_COVER, 0);
    }

    if (!dashboard.hasTask) {
        lv_obj_set_style_bg_opa(
            idlePulseOuter,
            heartbeatOn ? LV_OPA_40 : LV_OPA_10,
            0
        );
        lv_obj_set_style_opa(
            idlePulseInner,
            heartbeatOn ? LV_OPA_COVER : LV_OPA_60,
            0
        );
    }
}

}  // namespace

void setup() {
    usbSerial.setRxBufferSize(1024);
    usbSerial.begin(115200);
    pinMode(LCD_BL, OUTPUT);
    digitalWrite(LCD_BL, LOW);

    if (!display->begin()) {
        usbSerial.println("{\"type\":\"error\",\"code\":\"display_init_failed\"}");
        return;
    }
    display->setRotation(DISPLAY_ROTATION);

    lv_init();
    lv_tick_set_cb([]() -> uint32_t { return millis(); });
    lvDisplay = lv_display_create(DISPLAY_WIDTH, DISPLAY_HEIGHT);
    lv_display_set_color_format(lvDisplay, LV_COLOR_FORMAT_RGB565);
    lv_display_set_buffers(
        lvDisplay,
        drawBuffer,
        nullptr,
        sizeof(drawBuffer),
        LV_DISPLAY_RENDER_MODE_PARTIAL
    );
    lv_display_set_flush_cb(lvDisplay, displayFlush);
    createUi();
    lv_refr_now(lvDisplay);
    digitalWrite(LCD_BL, HIGH);

    usbSerial.println(
        "{\"type\":\"hello\",\"device\":\"codex-glance\",\"protocol\":3,\"ui\":\"lvgl-9.5\"}"
    );
}

void loop() {
    readSerialInput();
    updateDisplayState(millis());
    lv_timer_handler();
    delay(2);
}
