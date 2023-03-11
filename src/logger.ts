import * as vscode from "vscode";

const toLocalTimeZoneString = (date = new Date()) => date.toLocaleString(vscode.env.language);

enum LogLevel {
    error = 1,
    warning,
    info
}
export class VscodeOutputLogger {
    private outputChannel: vscode.OutputChannel;
    private level: LogLevel;
    /**
     * @param name - The name of VS Code output channel on UI
     * @param level - The log level for the logger
     */
    constructor(name: string, level: string) {
        this.outputChannel = vscode.window.createOutputChannel(name);
        this.level = VscodeOutputLogger.levelFromString(level);
    }

    static levelFromString(level: string): LogLevel {
        switch (level) {
            case "error":
                return LogLevel.error;
            case "warning":
                return LogLevel.warning;
            case "info":
                return LogLevel.info;
            default:
                throw new Error(`unknown log level: ${level}`);
        }
    }

    setLevel(level: string): void {
        this.level = VscodeOutputLogger.levelFromString(level);
    }

    /**
     * Log some message at info level.
     * @param message - a message without ending new line
     */
    info(message: string): void {
        if (this.level < LogLevel.info) {
            return;
        }
        this.outputChannel.appendLine(`[${toLocalTimeZoneString()}] [INFO] ` + message);
    }

    /**
     * Log some message at warning level.
     * @param message - a message without ending new line
     */
    warn(message: string): void {
        if (this.level < LogLevel.warning) {
            return;
        }
        this.outputChannel.appendLine(`[${toLocalTimeZoneString()}] [WARN] ` + message);
    }

    /**
     * Log some message at error level.
     * @param message - a message without ending new line
     */
    error(message: string): void {
        if (this.level < LogLevel.error) {
            return;
        }
        this.outputChannel.appendLine(`[${toLocalTimeZoneString()}] [ERROR] ` + message);
    }
}
