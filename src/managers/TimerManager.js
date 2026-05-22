/**
 * Manages match timer, play/pause, and time calculations
 */
export class TimerManager {
    constructor(app) {
        this.app = app;
        this.timerInterval = null;
        this._lastDisplayedSecond = -1;
    }

    get state() { return this.app.state; }
    get settings() { return this.app.settings; }
    get elements() { return this.app.elements; }

    /**
     * Get match duration in seconds
     */
    get matchDurationSeconds() {
        return this.settings.matchDuration * 60;
    }

    /**
     * Calculate elapsed seconds based on start time (handles device sleep)
     */
    getElapsedSeconds() {
        if (!this.state.isRunning) {
            return Math.floor(this.state.pausedElapsedMs / 1000);
        }
        const now = Date.now();
        const runningMs = (now - this.state.startTime) * this.state.speedMultiplier;
        return Math.floor((this.state.pausedElapsedMs + runningMs) / 1000);
    }

    /**
     * Start the timer interval for updates
     */
    startTimerInterval() {
        this.timerInterval = setInterval(() => {
            const elapsed = this.getElapsedSeconds();
            
            this.updateDisplay();
            this.app.updatePlayerMinutes();
            this.app.checkIntervalChange();
            
            // Save state periodically
            if (elapsed % 10 === 0) {
                this.app.saveState();
            }
        }, 200);
    }

    /**
     * Toggle timer between running and paused
     */
    toggle() {
        if (this.state.isRunning) {
            this.pause();
        } else {
            this.start();
        }
    }

    /**
     * Start the timer
     */
    start() {
        if (this.state.isRunning) return;

        // Record kick off if this is the first start (not a resume)
        const isKickOff = this.state.pausedElapsedMs === 0;

        this.state.isRunning = true;
        this.state.startTime = Date.now();
        this.state.lastTickTime = Date.now();
        this.state.matchStarted = true;
        
        this.elements.playPauseBtn.textContent = '⏸';
        this.elements.playPauseBtn.classList.remove('btn-primary');
        this.elements.playPauseBtn.classList.add('btn-secondary');

        // Set onPitchSinceElapsed for all players currently on pitch
        const currentElapsed = this.getElapsedSeconds();
        const lineup = this.app.getCurrentLineup();
        lineup.forEach(playerId => {
            if (playerId !== null) {
                const player = this.app.getPlayerById(playerId);
                if (player && player.onPitchSinceElapsed === undefined) {
                    player.onPitchSinceElapsed = currentElapsed;
                }
            }
        });

        if (isKickOff) {
            this.app.events.recordKickOff();
        }

        this.startTimerInterval();
        this.app.saveState();
    }

    /**
     * Pause the timer
     */
    pause() {
        if (!this.state.isRunning) return;

        // Finalize minutes for all players on pitch before pausing
        this.app.finalizeAllOnPitchMinutes();

        // Accumulate elapsed time
        const now = Date.now();
        const runningMs = (now - this.state.startTime) * this.state.speedMultiplier;
        this.state.pausedElapsedMs += runningMs;
        
        this.state.isRunning = false;
        this.state.startTime = null;
        this.state.lastTickTime = null;
        
        this.elements.playPauseBtn.textContent = '▶';
        this.elements.playPauseBtn.classList.remove('btn-secondary');
        this.elements.playPauseBtn.classList.add('btn-primary');

        clearInterval(this.timerInterval);
        this.app.saveState();
    }

    /**
     * Stop the match (end game)
     */
    stop() {
        if (this.state.isRunning) {
            this.pause();
        }
        
        this.state.matchEnded = true;
        
        // Record full time event
        this.app.events.recordFullTime();
        
        const finalScore = `${this.state.scoreUs} - ${this.state.scoreThem}`;
        this.app.showToast(`Full time! Final score: ${finalScore}`, 'success', 3000);
        
        this.elements.playPauseBtn.disabled = true;
        this.elements.playPauseBtn.textContent = '✓';
        this.elements.stopBtn.disabled = true;
        
        this.app.saveState();
    }

    /**
     * Update the timer display
     */
    updateDisplay() {
        const elapsed = this.getElapsedSeconds();
        const matchDuration = this.matchDurationSeconds;
        
        // Cap display at match duration
        const displaySeconds = Math.min(elapsed, matchDuration);
        
        // Only update DOM if second changed
        if (displaySeconds === this._lastDisplayedSecond) return;
        this._lastDisplayedSecond = displaySeconds;
        
        const mins = Math.floor(displaySeconds / 60);
        const secs = displaySeconds % 60;
        this.elements.currentTime.textContent = 
            `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
        
        // Speed indicator
        if (this.state.speedMultiplier > 1) {
            this.elements.currentTime.textContent += ` (${this.state.speedMultiplier}x)`;
        }
        
        // Full time notification
        if (elapsed >= matchDuration && !this.state.fullTimeShown) {
            this.state.fullTimeShown = true;
            this.app.showToast('Full time!', 'success', 3000);
            this.app.hapticFeedback([200, 100, 200]);
        }
    }

    /**
     * Toggle speed multiplier for testing
     */
    toggleSpeed() {
        const speeds = [1, 10, 20];
        const currentIndex = speeds.indexOf(this.state.speedMultiplier);
        const nextIndex = (currentIndex + 1) % speeds.length;
        this.state.speedMultiplier = speeds[nextIndex];
        this.app.showToast(`Speed: ${this.state.speedMultiplier}x`);
    }

    /**
     * Reset the timer
     */
    reset() {
        this.pause();
        this.state.startTime = null;
        this.state.pausedElapsedMs = 0;
        this.state.lastTickTime = null;
        this.state.fullTimeShown = false;
        this._lastDisplayedSecond = -1;
        
        this.elements.playPauseBtn.disabled = false;
        this.elements.playPauseBtn.textContent = '▶';
        this.elements.stopBtn.disabled = false;
        
        this.updateDisplay();
    }
}
