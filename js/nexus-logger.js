/**
 * NEXUS Logger - On-screen logging for VR debugging
 * Works in both desktop and VR environments
 */
(function () {
    const buffer = [];
    const maxLines = 50;

    /**
     * Push a log entry to the buffer
     * @param {string} level - Log level (INFO, WARN, ERROR)
     * @param {string} msg - Message text
     * @param {*} data - Optional data object
     */
    function push(level, msg, data) {
        const timestamp = new Date().toISOString().split('T')[1].split('.')[0]; // HH:MM:SS
        const dataStr = data ? ` ${JSON.stringify(data)}` : '';
        const line = `[${timestamp}] ${level}: ${msg}${dataStr}`;

        buffer.push({ timestamp, level, msg, data, line });

        // Keep buffer size limited
        while (buffer.length > maxLines) {
            buffer.shift();
        }

        // Also log to console
        const consoleMethod = level === 'ERROR' ? 'error' : level === 'WARN' ? 'warn' : 'log';
        console[consoleMethod](`[NEXUS] ${line}`);

        // Dispatch event for VR panel to catch
        window.dispatchEvent(
            new CustomEvent('nexus-log', {
                detail: { line, level, msg, data, timestamp },
            })
        );
    }

    // Expose global logger
    window.NEXUS_LOGGER = {
        /**
         * Log info message
         * @param {string} msg - Message
         * @param {*} data - Optional data
         */
        info: (msg, data) => push('INFO', msg, data),

        /**
         * Log warning message
         * @param {string} msg - Message
         * @param {*} data - Optional data
         */
        warn: (msg, data) => push('WARN', msg, data),

        /**
         * Log error message
         * @param {string} msg - Message
         * @param {*} data - Optional data
         */
        error: (msg, data) => push('ERROR', msg, data),

        /**
         * Get all log entries
         * @returns {Array} Log buffer
         */
        get: () => buffer.slice(),

        /**
         * Clear log buffer
         */
        clear: () => {
            buffer.length = 0;
        },

        /**
         * Get recent logs as formatted string
         * @param {number} count - Number of recent logs to get
         * @returns {string} Formatted log string
         */
        getRecent: (count = 10) => {
            return buffer
                .slice(-count)
                .map((entry) => entry.line)
                .join('\n');
        },
    };

    // Log initialization
    console.log('[NEXUS] Logger initialized');
})();
