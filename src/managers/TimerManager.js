/**
 * Manages match timer, play/pause, and time calculations
 */
export class TimerManager {
    constructor(app) {
        this.app = app;
        this.timerInterval = null;
        this._lastDisplayedSecond = -1;
        this._lastStatsMinute = -1;
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
     * Get current half duration - half if HT not taken, full if HT taken
     */
    get currentHalfDurationSeconds() {
        if (this.state.halfTimeTaken) {
            return this.matchDurationSeconds;
        }
        return this.matchDurationSeconds / 2;
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
            const currentMinute = Math.floor(elapsed / 60);
            
            this.updateDisplay();
            this.app.updatePlayerMinutes();
            this.app.checkIntervalChange();
            
            // Only re-render stats table on minute boundary (live mode optimization)
            if (currentMinute !== this._lastStatsMinute) {
                this._lastStatsMinute = currentMinute;
                this.app.renderStats();
            }
            
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
        // Second half kick off: half time taken but second half not yet started
        const isSecondHalfKickOff = this.state.halfTimeTaken && !this.state.secondHalfStarted;

        this.state.isRunning = true;
        this.state.startTime = Date.now();
        this.state.lastTickTime = Date.now();
        this.state.matchStarted = true;
        
        if (isSecondHalfKickOff) {
            this.state.secondHalfStarted = true;
        }
        
        this.elements.playPauseBtn.textContent = '⏸';
        this.elements.playPauseBtn.classList.remove('btn-primary');
        this.elements.playPauseBtn.classList.add('btn-secondary');
        this.elements.stopBtn.disabled = false;

        // Set onPitchSinceElapsed for all players currently on pitch
        const currentElapsed = this.getElapsedSeconds();
        const lineup = this.app.getCurrentLineup();
        lineup.forEach(playerId => {
            if (playerId !== null) {
                const player = this.app.getPlayerById(playerId);
                if (player) {
                    // Always reset at kick-off to ensure clean start
                    if (isKickOff || player.onPitchSinceElapsed === undefined) {
                        player.onPitchSinceElapsed = currentElapsed;
                    }
                }
            }
        });

        if (isKickOff) {
            // Mark all players on pitch as starters
            lineup.forEach(playerId => {
                if (playerId !== null) {
                    const player = this.app.getPlayerById(playerId);
                    if (player) {
                        player.startedGame = true;
                    }
                }
            });
            this.app.events.recordKickOff();
        } else if (isSecondHalfKickOff) {
            this.app.events.recordSecondHalfKickOff();
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
     * Handle HT/FT button press
     */
    stop() {
        if (!this.state.halfTimeTaken) {
            this.stopHalfTime();
        } else {
            this.stopFullTime();
        }
    }

    /**
     * Stop for half time
     */
    stopHalfTime() {
        // Capture actual elapsed time BEFORE any changes
        const actualElapsed = this.getElapsedSeconds();
        
        if (this.state.isRunning) {
            this.pause();
        }
        
        // Record half time event with actual time (before reset)
        this.app.events.recordHalfTime(actualElapsed);
        
        this.state.halfTimeTaken = true;
        this.state.halfTimeShown = false; // Reset so we can show full time notification later
        
        // Reset timer to exact half-time mark
        const halfTimeMs = (this.matchDurationSeconds / 2) * 1000;
        this.state.pausedElapsedMs = halfTimeMs;
        this._lastDisplayedSecond = -1; // Force display update
        
        const score = `${this.state.scoreUs} - ${this.state.scoreThem}`;
        this.app.showToast(`Half time! Score: ${score}`, 'info', 3000);
        
        // Update button to show FT, keep play button enabled for second half
        this.elements.stopBtn.textContent = 'FT';
        this.elements.playPauseBtn.textContent = '▶';
        this.elements.playPauseBtn.classList.remove('btn-secondary');
        this.elements.playPauseBtn.classList.add('btn-primary');
        
        this.updateDisplay();
        this.app.saveState();
    }

    /**
     * Stop the match (end game)
     */
    stopFullTime() {
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
        
        // Show export stats button and rate button
        this.app.updateExportButtonVisibility();
        
        // Auto-show rating picker after a brief delay
        setTimeout(() => {
            this.app.showRatingPicker();
        }, 1500);
        
        this.app.saveState();
    }

    /**
     * Update the timer display
     */
    updateDisplay() {
        const elapsed = this.getElapsedSeconds();
        const halfDuration = this.currentHalfDurationSeconds;
        
        // Only update DOM if second changed
        if (elapsed === this._lastDisplayedSecond) return;
        this._lastDisplayedSecond = elapsed;
        
        let timeDisplay;
        if (elapsed >= halfDuration) {
            const additionalSeconds = elapsed - halfDuration;
            const additionalMins = Math.floor(additionalSeconds / 60);
            
            if (additionalMins > 0) {
                // Additional time: show as "5'+1'" format after a full minute
                const halfMins = Math.floor(halfDuration / 60);
                timeDisplay = `${halfMins}'+${additionalMins}'`;
            } else {
                // First minute of additional time: keep showing MM:SS format
                const mins = Math.floor(elapsed / 60);
                const secs = elapsed % 60;
                timeDisplay = `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
            }
        } else {
            // Normal time: show MM:SS
            const mins = Math.floor(elapsed / 60);
            const secs = elapsed % 60;
            timeDisplay = `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
        }
        
        this.elements.currentTime.textContent = timeDisplay;
        
        // Speed indicator
        if (this.state.speedMultiplier > 1) {
            this.elements.currentTime.textContent += ` (${this.state.speedMultiplier}x)`;
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
        this.state.matchStarted = false;
        this.state.matchEnded = false;
        this.state.halfTimeShown = false;
        this.state.fullTimeShown = false;
        this.state.halfTimeTaken = false;
        this.state.secondHalfStarted = false;
        this._lastDisplayedSecond = -1;
        this._lastStatsMinute = -1;
        
        this.elements.playPauseBtn.disabled = false;
        this.elements.playPauseBtn.textContent = '▶';
        this.elements.stopBtn.disabled = true;
        this.elements.stopBtn.textContent = 'HT';
        
        this.updateDisplay();
    }

    /**
     * Update stop button text based on state (for restoring from saved state)
     */
    updateStopButtonText() {
        if (this.state.matchEnded) {
            this.elements.stopBtn.disabled = true;
        } else if (this.state.matchStarted) {
            this.elements.stopBtn.disabled = false;
            this.elements.stopBtn.textContent = this.state.halfTimeTaken ? 'FT' : 'HT';
        } else {
            this.elements.stopBtn.disabled = true;
            this.elements.stopBtn.textContent = 'HT';
        }
    }
}
