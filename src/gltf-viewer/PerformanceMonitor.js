/**
 * Adaptive Performance Monitor
 * Monitors FPS and automatically adjusts rendering quality to maintain
 * smooth frame rates across all devices.
 *
 * Quality levels:
 *   0 = Full (SSAO + Bloom + FXAA + 2048 shadows)
 *   1 = High (no SSAO, Bloom + FXAA)
 *   2 = Medium (no SSAO, no Bloom, FXAA only)
 *   3 = Low (no post-processing, 1024 shadows)
 *
 * Automatically downgrades if FPS stays below threshold for sustained period.
 * Can upgrade back if FPS recovers for sustained period.
 */

export class PerformanceMonitor {
    /**
     * @param {object} options
     * @param {number} [options.targetFPS=50]         Target FPS (downgrade below this)
     * @param {number} [options.downgradeFPS=30]      Critical FPS (immediate downgrade)
     * @param {number} [options.upgradeFPS=55]        FPS needed to upgrade quality back
     * @param {number} [options.sampleWindow=60]      Frames to average over
     * @param {number} [options.downgradeDelay=3000]  ms of low FPS before downgrading
     * @param {number} [options.upgradeDelay=8000]    ms of high FPS before upgrading
     * @param {number} [options.initialLevel=0]       Starting quality level
     */
    constructor(options = {}) {
        this.targetFPS = options.targetFPS || 50;
        this.downgradeFPS = options.downgradeFPS || 30;
        this.upgradeFPS = options.upgradeFPS || 55;
        this.sampleWindow = options.sampleWindow || 60;
        this.downgradeDelay = options.downgradeDelay || 3000;
        this.upgradeDelay = options.upgradeDelay || 8000;

        this.qualityLevel = options.initialLevel || 0;
        this.maxLevel = 3;

        // FPS tracking
        this._frameTimes = [];
        this._lastFrameTime = 0;
        this._currentFPS = 60;

        // Timing for quality transitions
        this._lowFPSSince = 0;
        this._highFPSSince = 0;
        this._isLowFPS = false;
        this._isHighFPS = false;

        // Callbacks
        this._onQualityChange = null;

        // Enabled state
        this.enabled = true;
    }

    /**
     * Set callback for quality level changes.
     * @param {function(level: number, fps: number)} callback
     */
    onQualityChange(callback) {
        this._onQualityChange = callback;
    }

    /**
     * Call once per frame from the animation loop.
     * @param {number} dt - Delta time in seconds (from THREE.Clock.getDelta())
     */
    update(dt) {
        if (!this.enabled || dt <= 0) return;

        const now = performance.now();
        const fps = 1 / dt;

        // Rolling average
        this._frameTimes.push(fps);
        if (this._frameTimes.length > this.sampleWindow) {
            this._frameTimes.shift();
        }

        // Compute average FPS
        const sum = this._frameTimes.reduce((a, b) => a + b, 0);
        this._currentFPS = sum / this._frameTimes.length;

        // Skip quality adjustments until we have enough samples
        if (this._frameTimes.length < 20) return;

        // Check for sustained low FPS → downgrade
        if (this._currentFPS < this.downgradeFPS) {
            // Immediate downgrade for critical FPS drop
            this._downgrade(now);
        } else if (this._currentFPS < this.targetFPS) {
            if (!this._isLowFPS) {
                this._isLowFPS = true;
                this._lowFPSSince = now;
            } else if (now - this._lowFPSSince > this.downgradeDelay) {
                this._downgrade(now);
            }
            this._isHighFPS = false;
        } else if (this._currentFPS > this.upgradeFPS) {
            this._isLowFPS = false;
            if (!this._isHighFPS) {
                this._isHighFPS = true;
                this._highFPSSince = now;
            } else if (now - this._highFPSSince > this.upgradeDelay) {
                this._upgrade(now);
            }
        } else {
            // In acceptable range — reset timers
            this._isLowFPS = false;
            this._isHighFPS = false;
        }
    }

    _downgrade(now) {
        if (this.qualityLevel >= this.maxLevel) return;

        this.qualityLevel++;
        this._isLowFPS = false;
        this._lowFPSSince = 0;
        this._frameTimes = []; // Reset samples after change

        console.log(
            `[PerfMonitor] ⬇ Quality downgraded to level ${this.qualityLevel} (FPS: ${this._currentFPS.toFixed(1)})`
        );

        if (this._onQualityChange) {
            this._onQualityChange(this.qualityLevel, this._currentFPS);
        }
    }

    _upgrade(now) {
        if (this.qualityLevel <= 0) return;

        this.qualityLevel--;
        this._isHighFPS = false;
        this._highFPSSince = 0;
        this._frameTimes = []; // Reset samples after change

        console.log(
            `[PerfMonitor] ⬆ Quality upgraded to level ${this.qualityLevel} (FPS: ${this._currentFPS.toFixed(1)})`
        );

        if (this._onQualityChange) {
            this._onQualityChange(this.qualityLevel, this._currentFPS);
        }
    }

    /**
     * Get the current average FPS.
     * @returns {number}
     */
    getFPS() {
        return this._currentFPS;
    }

    /**
     * Get current quality level.
     * @returns {number} 0-3
     */
    getQualityLevel() {
        return this.qualityLevel;
    }

    /**
     * Force a specific quality level.
     * @param {number} level 0-3
     */
    setQualityLevel(level) {
        this.qualityLevel = Math.max(0, Math.min(this.maxLevel, level));
        this._frameTimes = [];
        if (this._onQualityChange) {
            this._onQualityChange(this.qualityLevel, this._currentFPS);
        }
    }
}
