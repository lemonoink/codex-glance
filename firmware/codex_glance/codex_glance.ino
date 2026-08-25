#include <Arduino.h>
#include <ArduinoJson.h>
#include <Arduino_GFX_Library.h>
#include <HWCDC.h>

namespace {

constexpr int LCD_DC = 4;
constexpr int LCD_CS = 5;
constexpr int LCD_SCK = 6;
constexpr int LCD_MOSI = 7;
constexpr int LCD_RST = 8;
constexpr int LCD_BL = 15;
constexpr uint8_t DISPLAY_ROTATION = 1;
constexpr uint8_t PROTOCOL_VERSION = 2;
constexpr size_t MAX_MESSAGE_BYTES = 512;
constexpr size_t MAX_VISIBLE_TASKS = 3;
constexpr size_t MAX_SESSION_LENGTH = 8;
constexpr size_t MAX_TASK_ID_LENGTH = 8;
constexpr size_t MAX_PROJECT_LENGTH = 14;
constexpr uint32_t HEARTBEAT_INTERVAL_MS = 500;
constexpr uint32_t LINK_TIMEOUT_MS = 10000;
constexpr uint32_t ALERT_DURATION_MS = 2000;

constexpr const char *TOP_FIELDS[] = {
    "v",
    "type",
    "session",
    "seq",
    "counts",
    "tasks",
};
constexpr const char *COUNT_FIELDS[] = {"run", "wait", "err"};
constexpr const char *HEARTBEAT_FIELDS[] = {
    "v",
    "type",
    "session",
    "seq",
};
constexpr const char *TASK_FIELDS[] = {
    "id",
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

struct TaskRow {
    char id[MAX_TASK_ID_LENGTH + 1];
    char project[MAX_PROJECT_LENGTH + 1];
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
    uint8_t taskCount;
    TaskRow tasks[MAX_VISIBLE_TASKS];
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

char inputBuffer[MAX_MESSAGE_BYTES];
size_t inputLength = 0;
bool inputOverflow = false;
DashboardState dashboard = {};
bool hasSnapshot = false;
bool linkLost = false;
bool alertActive = false;
uint32_t alertUntilMs = 0;
uint32_t lastSnapshotMs = 0;
uint32_t lastHeartbeatMs = 0;
bool heartbeatOn = false;

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

uint16_t statusColor(TaskStatus status) {
    switch (status) {
        case TaskStatus::WORKING:
            return RGB565_CYAN;
        case TaskStatus::WAITING:
            return RGB565_YELLOW;
        case TaskStatus::DONE:
            return RGB565_GREEN;
        case TaskStatus::ERROR:
            return RGB565_RED;
    }
    return RGB565_WHITE;
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

bool isSafeProject(const char *value) {
    for (const char *cursor = value; *cursor != '\0'; ++cursor) {
        const bool upper = *cursor >= 'A' && *cursor <= 'Z';
        const bool lower = *cursor >= 'a' && *cursor <= 'z';
        const bool digit = *cursor >= '0' && *cursor <= '9';
        const bool punctuation =
            *cursor == '.' || *cursor == '_' || *cursor == '-';
        if (!upper && !lower && !digit && !punctuation) {
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

bool parseTask(JsonObjectConst object, TaskRow &task) {
    if (!hasOnlyFields(object, TASK_FIELDS, 7)) {
        return false;
    }

    const char *statusValue = object["status"].as<const char *>();
    const char *phaseValue = object["phase"].as<const char *>();
    if (
        !copyToken(
            object["id"],
            task.id,
            sizeof(task.id),
            1,
            isLowerHex
        ) ||
        !copyToken(
            object["project"],
            task.project,
            sizeof(task.project),
            1,
            isSafeProject
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
        !hasOnlyFields(object, TOP_FIELDS, 6) ||
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
        !document["tasks"].is<JsonArrayConst>()
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

    const JsonArrayConst taskArray = document["tasks"].as<JsonArrayConst>();
    if (taskArray.size() > MAX_VISIBLE_TASKS) {
        return false;
    }

    next.taskCount = 0;
    uint8_t visibleRunning = 0;
    uint8_t visibleWaiting = 0;
    uint8_t visibleErrors = 0;
    for (JsonVariantConst item : taskArray) {
        if (!item.is<JsonObjectConst>()) {
            return false;
        }

        TaskRow &task = next.tasks[next.taskCount];
        if (!parseTask(item.as<JsonObjectConst>(), task)) {
            return false;
        }
        if (task.status == TaskStatus::WORKING) {
            ++visibleRunning;
        } else if (task.status == TaskStatus::WAITING) {
            ++visibleWaiting;
        } else if (task.status == TaskStatus::ERROR) {
            ++visibleErrors;
        }
        ++next.taskCount;
    }

    return (
        visibleRunning <= next.runningCount &&
        visibleWaiting <= next.waitingCount &&
        visibleErrors <= next.errorCount
    );
}

void drawRightText(const char *text, int16_t right, int16_t y, uint8_t size) {
    const int16_t width = strlen(text) * 6 * size;
    display->setTextSize(size);
    display->setCursor(right - width, y);
    display->print(text);
}

void formatElapsed(uint32_t elapsed, char *output, size_t outputSize) {
    const uint32_t minutes = min(elapsed / 60, static_cast<uint32_t>(99));
    const uint32_t seconds = elapsed % 60;
    snprintf(
        output,
        outputSize,
        "%02lu:%02lu",
        static_cast<unsigned long>(minutes),
        static_cast<unsigned long>(seconds)
    );
}

uint16_t activeTaskCount() {
    return (
        dashboard.runningCount +
        dashboard.waitingCount +
        dashboard.errorCount
    );
}

uint8_t visibleActiveTaskCount() {
    uint8_t count = 0;
    for (uint8_t index = 0; index < dashboard.taskCount; ++index) {
        if (dashboard.tasks[index].status != TaskStatus::DONE) {
            ++count;
        }
    }
    return count;
}

void renderFooter(bool online) {
    display->fillRect(0, 214, display->width(), 26, RGB565_BLACK);
    display->drawFastHLine(12, 214, display->width() - 24, RGB565_DARKGREY);
    display->setTextSize(1);
    display->setTextColor(RGB565_LIGHTGREY);
    display->setCursor(14, 224);

    const uint16_t active = activeTaskCount();
    const uint8_t visible = visibleActiveTaskCount();
    if (active > visible) {
        display->printf("+%u MORE", active - visible);
    } else {
        display->print("ALL VISIBLE");
    }

    display->setTextColor(online ? RGB565_WHITE : RGB565_RED);
    display->setCursor(198, 224);
    display->print(online ? "LINK" : "LINK LOST");
    display->fillCircle(
        266,
        227,
        5,
        online ? RGB565_CYAN : RGB565_RED
    );
}

void renderTaskRow(const TaskRow &task, uint8_t index) {
    const int16_t y = 58 + index * 52;
    const uint16_t color = statusColor(task.status);
    char elapsed[6];
    formatElapsed(task.elapsed, elapsed, sizeof(elapsed));

    display->fillRect(12, y, 4, 42, color);
    display->setTextColor(RGB565_WHITE);
    display->setTextSize(1);
    display->setCursor(23, y + 1);
    display->printf("%s #%u", task.project, task.slot);
    drawRightText(elapsed, 268, y + 1, 1);

    display->setTextColor(color);
    display->setTextSize(2);
    display->setCursor(23, y + 18);
    display->print(statusLabel(task.status));

    display->setTextColor(RGB565_LIGHTGREY);
    display->setTextSize(1);
    display->setCursor(120, y + 23);
    display->print(phaseLabel(task.phase));
    if (task.agents > 1) {
        display->setTextColor(RGB565_WHITE);
        display->setCursor(247, y + 23);
        display->printf("A%u", task.agents);
    }

    if (index < MAX_VISIBLE_TASKS - 1) {
        display->drawFastHLine(23, y + 47, 245, RGB565_DARKGREY);
    }
}

void renderDashboard() {
    display->fillScreen(RGB565_BLACK);
    display->setTextColor(RGB565_WHITE);
    display->setTextSize(2);
    display->setCursor(12, 8);
    display->print("CODEX GLANCE");

    char activeLabel[8];
    snprintf(activeLabel, sizeof(activeLabel), "%u ACT", activeTaskCount());
    display->setTextColor(RGB565_LIGHTGREY);
    drawRightText(activeLabel, 268, 12, 1);

    display->setTextSize(1);
    display->fillCircle(16, 39, 4, RGB565_CYAN);
    display->setCursor(25, 36);
    display->printf("%u RUN", dashboard.runningCount);
    display->fillCircle(102, 39, 4, RGB565_YELLOW);
    display->setCursor(111, 36);
    display->printf("%u WAIT", dashboard.waitingCount);
    display->fillCircle(199, 39, 4, RGB565_RED);
    display->setCursor(208, 36);
    display->printf("%u ERR", dashboard.errorCount);
    display->drawFastHLine(12, 52, display->width() - 24, RGB565_DARKGREY);

    if (dashboard.taskCount == 0) {
        display->setTextColor(RGB565_LIGHTGREY);
        display->setTextSize(2);
        display->setCursor(50, 105);
        display->print("NO ACTIVE TASKS");
        display->setTextSize(1);
        display->setCursor(95, 136);
        display->print("READY FOR CODEX");
    } else {
        for (uint8_t index = 0; index < dashboard.taskCount; ++index) {
            renderTaskRow(dashboard.tasks[index], index);
        }
    }

    renderFooter(!linkLost);
}

void renderWaitingScreen() {
    display->fillScreen(RGB565_BLACK);
    display->setTextColor(RGB565_WHITE);
    display->setTextSize(2);
    display->setCursor(68, 35);
    display->print("CODEX GLANCE");
    display->drawRoundRect(22, 82, 236, 72, 9, RGB565_CYAN);
    display->setTextColor(RGB565_CYAN);
    display->setCursor(34, 101);
    display->print("WAITING FOR BRIDGE");
    display->setTextColor(RGB565_LIGHTGREY);
    display->setTextSize(1);
    display->setCursor(76, 178);
    display->print("USB CDC PROTOCOL v2");
    display->fillCircle(140, 213, 6, RGB565_DARKGREY);
}

void renderAlert(const TaskRow &task) {
    const bool error = task.status == TaskStatus::ERROR;
    const uint16_t color = error ? RGB565_RED : RGB565_YELLOW;
    const char *title = error ? "TASK ERROR" : "ACTION NEEDED";

    display->fillScreen(RGB565_BLACK);
    display->drawRoundRect(8, 8, 264, 224, 12, color);
    display->setTextColor(RGB565_LIGHTGREY);
    display->setTextSize(1);
    display->setCursor(100, 26);
    display->print("CODEX GLANCE");

    display->setTextColor(color);
    display->setTextSize(3);
    const int16_t titleWidth = strlen(title) * 18;
    display->setCursor((display->width() - titleWidth) / 2, 62);
    display->print(title);

    display->setTextColor(RGB565_WHITE);
    display->setTextSize(2);
    char projectLabel[22];
    snprintf(
        projectLabel,
        sizeof(projectLabel),
        "%s #%u",
        task.project,
        task.slot
    );
    const int16_t projectWidth = strlen(projectLabel) * 12;
    display->setCursor((display->width() - projectWidth) / 2, 115);
    display->print(projectLabel);

    display->setTextColor(color);
    display->setTextSize(1);
    display->setCursor(112, 151);
    display->print(phaseLabel(task.phase));
    display->setTextColor(RGB565_LIGHTGREY);
    display->setCursor(76, 198);
    display->print("RETURNING TO DASHBOARD");
}

bool wasAlertAlreadyVisible(const TaskRow &task) {
    if (!hasSnapshot) {
        return false;
    }

    for (uint8_t index = 0; index < dashboard.taskCount; ++index) {
        const TaskRow &current = dashboard.tasks[index];
        if (
            strcmp(current.id, task.id) == 0 &&
            current.status == task.status
        ) {
            return true;
        }
    }
    return false;
}

const TaskRow *findNewAlert(const DashboardState &next) {
    for (uint8_t index = 0; index < next.taskCount; ++index) {
        const TaskRow &task = next.tasks[index];
        if (
            (
                task.status == TaskStatus::ERROR ||
                task.status == TaskStatus::WAITING
            ) &&
            !wasAlertAlreadyVisible(task)
        ) {
            return &task;
        }
    }
    return nullptr;
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
        renderDashboard();
    }
    sendAck();
    return true;
}

void handleMessage(const char *message) {
    JsonDocument document;
    const DeserializationError error = deserializeJson(document, message);
    if (error) {
        usbSerial.printf(
            "{\"type\":\"diagnostic\",\"stage\":\"json\",\"error\":\"%s\",\"bytes\":%u}\n",
            error.c_str(),
            strlen(message)
        );
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

    const TaskRow *newAlert = findNewAlert(next);
    TaskRow alertTask = {};
    if (newAlert != nullptr) {
        alertTask = *newAlert;
    }

    dashboard = next;
    hasSnapshot = true;
    linkLost = false;
    lastSnapshotMs = millis();

    if (newAlert != nullptr) {
        alertActive = true;
        alertUntilMs = millis() + ALERT_DURATION_MS;
        renderAlert(alertTask);
    } else {
        alertActive = false;
        renderDashboard();
    }

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
    if (alertActive && static_cast<int32_t>(now - alertUntilMs) >= 0) {
        alertActive = false;
        renderDashboard();
    }

    if (
        hasSnapshot &&
        !linkLost &&
        now - lastSnapshotMs >= LINK_TIMEOUT_MS
    ) {
        linkLost = true;
        alertActive = false;
        renderDashboard();
    }
}

void updateHeartbeat(uint32_t now) {
    if (now - lastHeartbeatMs < HEARTBEAT_INTERVAL_MS) {
        return;
    }

    lastHeartbeatMs = now;
    heartbeatOn = !heartbeatOn;
    if (linkLost) {
        return;
    }

    if (!hasSnapshot) {
        display->fillCircle(
            140,
            213,
            6,
            heartbeatOn ? RGB565_CYAN : RGB565_DARKGREY
        );
    } else if (!alertActive) {
        display->fillCircle(
            266,
            227,
            5,
            heartbeatOn ? RGB565_CYAN : RGB565_DARKGREY
        );
    }
}

}  // namespace

void setup() {
    usbSerial.setRxBufferSize(1024);
    usbSerial.begin(115200);
    pinMode(LCD_BL, OUTPUT);
    digitalWrite(LCD_BL, HIGH);

    if (!display->begin()) {
        usbSerial.println("{\"type\":\"error\",\"code\":\"display_init_failed\"}");
        return;
    }

    display->setRotation(DISPLAY_ROTATION);
    display->setTextWrap(false);
    renderWaitingScreen();
    usbSerial.println("{\"type\":\"hello\",\"device\":\"codex-glance\",\"protocol\":2}");
}

void loop() {
    readSerialInput();
    const uint32_t now = millis();
    updateDisplayState(now);
    updateHeartbeat(now);
    delay(2);
}
