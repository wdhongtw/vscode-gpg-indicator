/**
 * Logger is a sample interface for basic logging ability.
 */
export interface Logger {

    /**
     * Log some message at info level.
     * @param message - a message without ending new line
     */
    info(message: string): void

    /**
     * Log some message at warning level.
     * @param message - a message without ending new line
     */
    warn(message: string): void
    
    /**
     * Log some message at error level.
     * @param message - a message without ending new line
     */
    error(message: string): void
}
