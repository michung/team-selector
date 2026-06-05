import { CONFIG, MODES, POSITIONS, DEFAULT_STATE, DEFAULT_SETTINGS, SLOT_FILL_ORDER } from './config.js';
import { StorageManager } from './managers/StorageManager.js';
import { TimerManager } from './managers/TimerManager.js';
import { SubsManager } from './managers/SubsManager.js';
import { EventManager } from './managers/EventManager.js';
import { RenderManager } from './managers/RenderManager.js';
import { DragManager } from './managers/DragManager.js';
import { AutoLineupManager } from './managers/AutoLineupManager.js';

/**
 * Main Team Selector Application
 * Coordinates all managers and handles core functionality
 */
export class TeamSelector {
    // Expose POSITIONS for use by managers
    static POSITIONS = POSITIONS;
    
    constructor() {
        // State and settings
        this.settings = { ...DEFAULT_SETTINGS };
        this.state = { ...DEFAULT_STATE };

        // Managers
        this.storage = new StorageManager();
        this.timer = new TimerManager(this);
        this.subs = new SubsManager(this);
        this.events = new EventManager(this);
        this.renderer = new RenderManager(this);
        this.drag = new DragManager(this);
        this.autoLineup = new AutoLineupManager(this);

        // Slot fill order for auto-placement
        this.slotFillOrder = SLOT_FILL_ORDER;

        // Cached DOM elements
        this.elements = {};
        
        // Hint fade timeouts
        this.hintTimeouts = {};
    }

    /**
     * Show a hint element with auto-fade after delay
     * @param {HTMLElement} element - The hint element to show
     * @param {string} key - Unique key to track the timeout
     * @param {number} delay - Delay in ms before fading (default 6000)
     */
    showHintWithFade(element, key, delay = 6000) {
        if (!element) return;
        
        // Clear any existing timeout for this hint
        if (this.hintTimeouts[key]) {
            clearTimeout(this.hintTimeouts[key]);
        }
        
        // Show the hint
        element.classList.remove('hidden');
        
        // Set timeout to fade it out
        this.hintTimeouts[key] = setTimeout(() => {
            element.classList.add('hidden');
        }, delay);
    }

    /**
     * Initialize the application
     */
    init() {
        this.cacheElements();
        this.loadState();
        this.initializeIntervalLineups();
        this.setupEventListeners();
        this.drag.setupDropZones();
        this.setupSwipeGestures();
        this.setupSwipeToSwitchMode();
        this.renderIntervalTabs();
        this.renderPitch();
        this.renderBench();
        this.renderStats();
        this.events.renderMatchEvents();
        this.renderRoster();
        this.updateScoreDisplay();
        
        // Set initial mode to show appropriate hints and UI
        this.setMode(this.state.mode);
        
        // Update title with opponent name if set
        this.updateTitle();
        
        // Restore stop button text based on match state
        this.timer.updateStopButtonText();
        
        // Show export button if match already ended
        this.updateExportButtonVisibility();
        
        // Listen for hash changes (shared URL pasted in same tab)
        window.addEventListener('hashchange', () => this.handleURLChange());
        window.addEventListener('popstate', () => this.handleURLChange());
    }

    /**
     * Handle URL change (for shared plans pasted in same tab)
     */
    handleURLChange() {
        // Check query param first, then hash
        const urlParams = new URLSearchParams(window.location.search);
        const planParam = urlParams.get('plan');
        const hash = window.location.hash.slice(1);
        const planData = planParam || hash;
        
        if (planData) {
            const sharedPlan = this.decodePlan(planData);
            if (sharedPlan) {
                this.state.players = sharedPlan.players;
                this.state.intervalLineups = sharedPlan.intervalLineups;
                this.settings.matchDuration = sharedPlan.matchDuration;
                this.settings.intervalCount = sharedPlan.intervalCount;
                if (sharedPlan.opponentName) this.settings.opponentName = sharedPlan.opponentName;
                if (sharedPlan.matchDate) this.settings.matchDate = sharedPlan.matchDate;
                if (sharedPlan.isHome !== undefined) this.settings.isHome = sharedPlan.isHome;
                if (sharedPlan.subsPerInterval !== undefined) this.settings.subsPerInterval = sharedPlan.subsPerInterval;
                
                // Clear URL
                history.replaceState(null, '', window.location.pathname);
                
                // Re-render everything with imported data
                this.initializeIntervalLineups();
                this.renderIntervalTabs();
                this.renderPitch();
                this.renderBench();
                this.renderStats();
                this.renderRoster();
                this.updateTitle();
                this.updateSubsDisplay();
                
                this.showToast('Plan imported!');
                this.saveState();
            }
        }
    }

    /**
     * Cache frequently accessed DOM elements
     */
    cacheElements() {
        this.elements = {
            pitch: document.getElementById('pitch'),
            positionSlots: document.getElementById('position-slots'),
            bench: document.getElementById('bench'),
            planControls: document.getElementById('plan-controls'),
            liveControls: document.getElementById('live-controls'),
            timerButtons: document.getElementById('timer-buttons'),
            intervalTabs: document.getElementById('interval-tabs'),
            currentTime: document.getElementById('current-time'),
            playPauseBtn: document.getElementById('play-pause-btn'),
            stopBtn: document.getElementById('stop-btn'),
            sharePlanBtn: document.getElementById('share-plan-btn'),
            statsTable: document.getElementById('stats-table'),
            statsSection: document.getElementById('stats-section'),
            statsHeading: document.getElementById('stats-heading'),
            eventsSection: document.getElementById('events-section'),
            eventsLog: document.getElementById('events-log'),
            subsSummary: document.getElementById('subs-summary'),
            assistPicker: document.getElementById('assist-picker'),
            ratingPicker: document.getElementById('rating-picker'),
            ratingPlayers: document.getElementById('rating-players'),
            ratingSaveBtn: document.getElementById('rating-save-btn'),
            ratingCancelBtn: document.getElementById('rating-cancel-btn'),
            toastContainer: document.getElementById('toast-container'),
            pitchActions: document.getElementById('pitch-actions'),
            pitchEndgameActions: document.getElementById('pitch-endgame-actions'),
            subsIcon: document.getElementById('subs-icon'),
            subsBadge: document.getElementById('subs-badge'),
            swipeHintLeft: document.getElementById('swipe-hint-left'),
            swipeHintRight: document.getElementById('swipe-hint-right'),
            hintPitch: document.getElementById('hint-pitch'),
            hintScore: document.getElementById('hint-score'),
            hintPin: document.getElementById('hint-pin'),
            intervalCount: document.getElementById('interval-count'),
            subsCount: document.getElementById('subs-count'),
            exportStatsBtn: document.getElementById('export-stats-btn'),
            ratePlayersBtn: document.getElementById('rate-players-btn'),
            resetMatchBtn: document.getElementById('reset-match')
        };
    }

    /**
     * Load state from storage or from shared URL
     */
    loadState() {
        // Check for shared plan in URL - try query param first (WhatsApp-friendly), then hash
        const urlParams = new URLSearchParams(window.location.search);
        const planParam = urlParams.get('plan');
        const hash = window.location.hash.slice(1);
        
        // Use query param if present, otherwise try hash
        const planData = planParam || hash;
        
        // Debug logging
        console.log('[Import] planParam:', planParam ? 'found' : 'none', 'hash:', hash ? 'found' : 'none');
        
        if (planData) {
            const sharedPlan = this.decodePlan(planData);
            if (sharedPlan) {
                this.state.players = sharedPlan.players;
                this.state.intervalLineups = sharedPlan.intervalLineups;
                this.settings.matchDuration = sharedPlan.matchDuration;
                this.settings.intervalCount = sharedPlan.intervalCount;
                if (sharedPlan.opponentName) this.settings.opponentName = sharedPlan.opponentName;
                if (sharedPlan.matchDate) this.settings.matchDate = sharedPlan.matchDate;
                if (sharedPlan.isHome !== undefined) this.settings.isHome = sharedPlan.isHome;
                if (sharedPlan.subsPerInterval !== undefined) this.settings.subsPerInterval = sharedPlan.subsPerInterval;
                // Clear URL params/hash so refreshing doesn't re-import
                history.replaceState(null, '', window.location.pathname);
                this.showToast('Plan imported!');
                this.saveState();
                return;
            } else {
                console.log('[Import] decodePlan returned null - invalid format?');
            }
        }

        const { state, settings } = this.storage.load();
        this.state = state;
        this.settings = settings;

        // Load sample players if none exist
        if (this.state.players.length === 0) {
            this.loadSamplePlayers();
        }
    }

    /**
     * Save current state
     */
    saveState() {
        this.storage.save(this.state, this.settings);
    }

    /**
     * Get match duration in seconds
     */
    get matchDurationSeconds() {
        return this.settings.matchDuration * 60;
    }

    // ==================== PLAYER UTILITIES ====================

    /**
     * Get a player by ID
     */
    getPlayerById(id) {
        return this.state.players.find(p => p.id === id);
    }

    /**
     * Get current lineup based on mode
     */
    getCurrentLineup() {
        if (this.state.mode === MODES.LIVE) {
            return this.state.liveLineup || this.state.intervalLineups[1] || [];
        }
        return this.state.intervalLineups[this.state.selectedPlanInterval] || [];
    }

    /**
     * Get bench players (not in current lineup)
     */
    getBenchPlayers() {
        const lineup = this.getCurrentLineup();
        return this.state.players.filter(p => !lineup.includes(p.id));
    }

    /**
     * Check if match is active (started and not ended)
     */
    isMatchActive() {
        // Consider match started if flag is set OR timer is running/has elapsed time (for backwards compatibility)
        const hasStarted = this.state.matchStarted || this.state.isRunning || this.state.pausedElapsedMs > 0;
        return hasStarted && !this.state.matchEnded;
    }

    // ==================== TIME UTILITIES ====================

    getElapsedSeconds() {
        return this.timer.getElapsedSeconds();
    }

    // ==================== UI UTILITIES ====================

    /**
     * Show toast notification
     */
    showToast(message, type = 'default', duration = 2000, undoCallback = null) {
        const toast = document.createElement('div');
        toast.className = `toast ${type === 'success' ? 'toast-success' : ''}`;
        
        const messageSpan = document.createElement('span');
        messageSpan.textContent = message;
        toast.appendChild(messageSpan);
        
        if (undoCallback) {
            const undoBtn = document.createElement('button');
            undoBtn.className = 'toast-undo';
            undoBtn.textContent = 'Undo';
            undoBtn.addEventListener('click', () => {
                undoCallback();
                toast.remove();
            });
            toast.appendChild(undoBtn);
            duration = 5000;
        }
        
        this.elements.toastContainer.appendChild(toast);
        
        setTimeout(() => {
            toast.classList.add('toast-out');
            setTimeout(() => toast.remove(), 300);
        }, duration);
    }

    /**
     * Trigger haptic feedback
     */
    hapticFeedback(pattern) {
        if ('vibrate' in navigator) {
            navigator.vibrate(pattern);
        }
    }

    /**
     * Format date as "3 Jun" (no year)
     */
    formatDate(dateStr) {
        if (!dateStr) return '';
        const date = new Date(dateStr);
        const day = date.getDate();
        const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
        const month = months[date.getMonth()];
        return `${day} ${month}`;
    }

    /**
     * Show the player rating picker overlay
     */
    showRatingPicker() {
        const container = this.elements.ratingPlayers;
        if (!container) return;
        
        container.innerHTML = '';
        
        // Get all players, sorted by minutes played (descending) - players who played first, then unused subs
        const allPlayers = [...this.state.players]
            .sort((a, b) => (b.minutesPlayed || 0) - (a.minutesPlayed || 0));
        
        allPlayers.forEach(player => {
            const currentRating = this.state.playerRatings[player.id] || 6;
            const isPotm = this.state.playerOfTheMatch === player.id;
            
            const row = document.createElement('div');
            row.className = `rating-player-row${isPotm ? ' potm-selected' : ''}`;
            row.dataset.playerId = player.id;
            
            // Stats: minutes always shown, goals/assists as text
            const minutes = Math.floor(player.minutesPlayed || 0);
            const stats = [];
            if (player.goals) stats.push(`${player.goals}G`);
            if (player.assists) stats.push(`${player.assists}A`);
            const statsText = `${minutes}' ${stats.join(' ')}`.trim();
            
            row.innerHTML = `
                <span class="rating-potm-star">⭐</span>
                <div class="rating-player-info">
                    <span class="rating-player-number">${player.number}</span>
                    <span class="rating-player-name">${player.name}</span>
                    <span class="rating-player-stats">${statsText}</span>
                </div>
                <div class="rating-stepper">
                    <button class="rating-stepper-btn" data-action="dec" ${currentRating <= 1 ? 'disabled' : ''}>−</button>
                    <span class="rating-value ${currentRating >= 8 ? 'rating-high' : currentRating <= 4 ? 'rating-low' : ''}">${currentRating}</span>
                    <button class="rating-stepper-btn" data-action="inc" ${currentRating >= 10 ? 'disabled' : ''}>+</button>
                </div>
            `;
            
            // Click row to select POTM
            row.addEventListener('click', (e) => {
                if (e.target.closest('.rating-stepper-btn')) return;
                
                // Toggle POTM selection
                const wasSelected = this.state.playerOfTheMatch === player.id;
                this.state.playerOfTheMatch = wasSelected ? null : player.id;
                
                // Update UI
                container.querySelectorAll('.rating-player-row').forEach(r => {
                    r.classList.toggle('potm-selected', r.dataset.playerId === String(this.state.playerOfTheMatch));
                });
            });
            
            // Stepper buttons
            row.querySelectorAll('.rating-stepper-btn').forEach(btn => {
                btn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    const action = btn.dataset.action;
                    let rating = this.state.playerRatings[player.id] || 6;
                    
                    if (action === 'inc' && rating < 10) rating++;
                    if (action === 'dec' && rating > 1) rating--;
                    
                    this.state.playerRatings[player.id] = rating;
                    
                    // Update display
                    const valueEl = row.querySelector('.rating-value');
                    valueEl.textContent = rating;
                    valueEl.className = `rating-value ${rating >= 8 ? 'rating-high' : rating <= 4 ? 'rating-low' : ''}`;
                    
                    // Update button states
                    row.querySelector('[data-action="dec"]').disabled = rating <= 1;
                    row.querySelector('[data-action="inc"]').disabled = rating >= 10;
                });
            });
            
            container.appendChild(row);
        });
        
        this.elements.ratingPicker.style.display = 'flex';
    }

    /**
     * Hide the rating picker
     */
    hideRatingPicker() {
        this.elements.ratingPicker.style.display = 'none';
    }

    /**
     * Save ratings and close picker
     */
    saveRatings() {
        this.saveState();
        this.hideRatingPicker();
        // Re-render to show rating badges on player cards
        this.renderPitch();
        this.renderBench();
        this.showToast('Ratings saved!', 'success');
    }

    /**
     * Export game stats to clipboard as CSV
     */
    exportStats() {
        const lines = [];
        
        // Match info header
        if (this.settings.opponentName) {
            lines.push(`Opponent,${this.settings.opponentName}`);
        }
        lines.push(`Venue,${this.settings.isHome ? 'Home' : 'Away'}`);
        if (this.settings.matchDate) {
            lines.push(`Date,${this.settings.matchDate}`);
        }
        lines.push('');
        
        // Player of the Match
        if (this.state.playerOfTheMatch) {
            const potm = this.getPlayerById(this.state.playerOfTheMatch);
            if (potm) {
                lines.push(`Player of the Match,${potm.name}`);
                lines.push('');
            }
        }
        
        // Starting lineup
        const starters = this.state.players
            .filter(p => p.startedGame)
            .map(p => p.name);
        lines.push('Starting Lineup');
        lines.push(starters.join(', '));
        lines.push('');
        
        // Player stats table (include Rating column)
        const headers = ['Player', 'Started', 'Minutes', 'Goals', 'Assists', 'Rating'];
        lines.push(headers.join(','));
        
        // Get all players sorted by minutes descending
        const players = [...this.state.players]
            .sort((a, b) => (b.minutesPlayed || 0) - (a.minutesPlayed || 0));
        
        // Add player rows
        for (const player of players) {
            const rating = this.state.playerRatings[player.id];
            const row = [
                player.name,
                player.startedGame ? 'Yes' : 'No',
                Math.floor(player.minutesPlayed || 0),
                player.goals || 0,
                player.assists || 0,
                rating || ''
            ];
            lines.push(row.join(','));
        }
        
        // Final score
        lines.push('');
        lines.push(`Final Score,${this.state.scoreUs} - ${this.state.scoreThem}`);
        
        // Match events
        if (this.state.matchEvents && this.state.matchEvents.length > 0) {
            lines.push('');
            lines.push('Match Events');
            
            for (const event of this.state.matchEvents) {
                const minutes = Math.floor(event.time / 60);
                const timeStr = `${minutes}'`;
                
                if (event.type === 'kickoff') {
                    lines.push(`${timeStr},Kick Off`);
                } else if (event.type === 'secondhalfkickoff') {
                    lines.push(`${timeStr},2nd Half Kick Off`);
                } else if (event.type === 'halftime') {
                    lines.push(`${timeStr},Half Time (${event.score})`);
                } else if (event.type === 'fulltime') {
                    lines.push(`${timeStr},Full Time (${event.score})`);
                } else if (event.type === 'goal') {
                    const assistText = event.assist ? ` (assist: ${event.assist})` : '';
                    const teamIcon = event.team === 'us' ? 'GOAL' : 'OPP GOAL';
                    lines.push(`${timeStr},${teamIcon} - ${event.scorer}${assistText} [${event.score}]`);
                } else if (event.type === 'sub') {
                    lines.push(`${timeStr},SUB: ${event.playerIn} on for ${event.playerOut}`);
                }
            }
        }
        
        // Plan URL
        lines.push('');
        const encoded = this.encodePlan();
        const url = `${window.location.origin}${window.location.pathname}#${encoded}`;
        lines.push('Plan URL');
        lines.push(url);
        
        const output = lines.join('\n');
        
        // Copy to clipboard
        navigator.clipboard.writeText(output).then(() => {
            this.showToast('Stats copied to clipboard!', 'success');
        }).catch(err => {
            console.error('Failed to copy:', err);
            this.showToast('Failed to copy stats');
        });
    }

    /**
     * Update export button visibility based on match state
     */
    updateExportButtonVisibility() {
        if (this.elements.pitchEndgameActions) {
            this.elements.pitchEndgameActions.style.display = this.state.matchEnded ? 'flex' : 'none';
        }
    }

    /**
     * Update app title with opponent name if set
     */
    updateTitle() {
        const titleEl = document.getElementById('app-title');
        if (titleEl) {
            if (this.settings.opponentName) {
                const venue = this.settings.isHome ? '(H)' : '(A)';
                titleEl.textContent = `⚽ vs ${this.settings.opponentName} ${venue}`;
            } else {
                titleEl.textContent = '⚽ Team Selector';
            }
        }
    }

    /**
     * Update score display with optional flash effect
     */
    updateScoreDisplay(flashTeam = null) {
        const scoreUs = document.getElementById('score-us');
        const scoreThem = document.getElementById('score-them');
        
        scoreUs.textContent = this.state.scoreUs;
        scoreThem.textContent = this.state.scoreThem;
        
        if (flashTeam === 'us') {
            scoreUs.classList.add('flash-green');
            setTimeout(() => scoreUs.classList.remove('flash-green'), 500);
        } else if (flashTeam === 'them') {
            scoreThem.classList.add('flash-red');
            setTimeout(() => scoreThem.classList.remove('flash-red'), 500);
        }
    }

    // ==================== INTERVAL MANAGEMENT ====================

    initializeIntervalLineups() {
        for (let i = 1; i <= this.settings.intervalCount; i++) {
            const lineup = this.state.intervalLineups[i];
            // Only initialize if lineup doesn't exist or is invalid
            // Don't re-initialize if lineup exists but is all nulls (cleared state)
            const needsInit = !lineup || 
                              !Array.isArray(lineup) || 
                              lineup.length !== CONFIG.SLOTS_COUNT;
            
            if (needsInit) {
                if (i === 1) {
                    this.state.intervalLineups[i] = Array(CONFIG.SLOTS_COUNT).fill(null);
                } else {
                    this.state.intervalLineups[i] = [...this.state.intervalLineups[i - 1]];
                }
            }
        }
        this.saveState();
    }

    // ==================== DELEGATION TO MANAGERS ====================

    // Subs
    getIntervalChanges() { return this.subs.getIntervalChanges(); }
    getNextIntervalSubs() { return this.subs.getNextIntervalSubs(); }
    applyPlannedSubs() { return this.subs.applyPlannedSubs(); }
    updateSubsIconBadge() { return this.subs.updateBadge(); }
    showSubsPopup() { return this.subs.showPopup(); }

    // Timer
    toggleTimer() {
        // Don't start if no players on pitch
        if (!this.state.isRunning) {
            const playersOnPitch = (this.state.liveLineup || []).filter(id => id !== null).length;
            if (playersOnPitch === 0) {
                this.showToast('Add players to the pitch first');
                return;
            }
        }
        return this.timer.toggle();
    }
    stopMatch() { return this.timer.stop(); }

    // Events  
    recordGoal(playerId, team) { return this.events.recordGoal(playerId, team); }
    recordSubstitution(playerIn, playerOut) { return this.events.recordSubstitution(playerIn, playerOut); }
    skipAssist() { return this.events.skipAssist(); }

    // ==================== PLAYER MINUTES ====================

    updatePlayerMinutes() {
        // Only update minutes display in live mode (plan mode always shows planned minutes)
        if (this.state.mode !== MODES.LIVE) return;
        
        // Update only the minutes text elements, not full re-render
        const currentElapsed = this.getElapsedSeconds();
        
        // Update pitch player minutes
        document.querySelectorAll('.pitch .player-card').forEach(card => {
            const playerId = parseInt(card.dataset.playerId);
            const player = this.getPlayerById(playerId);
            if (player) {
                const mins = this.getDisplayMinutes(player, currentElapsed);
                const minsEl = card.querySelector('.player-minutes');
                if (minsEl) minsEl.textContent = `${mins}'`;
            }
        });
        
        // Update bench player minutes
        document.querySelectorAll('.bench .player-card').forEach(card => {
            const playerId = parseInt(card.dataset.playerId);
            const player = this.getPlayerById(playerId);
            if (player) {
                const mins = Math.floor(player.minutesPlayed || 0);
                const minsEl = card.querySelector('.player-minutes');
                if (minsEl) minsEl.textContent = `${mins}'`;
            }
        });
    }
    
    getDisplayMinutes(player, currentElapsed) {
        // Cap elapsed at current half duration so minutes don't count in additional time
        const cappedElapsed = Math.min(currentElapsed, this.timer.currentHalfDurationSeconds);
        let mins = player.minutesPlayed || 0;
        if (player.onPitchSinceElapsed !== undefined) {
            // Also cap onPitchSinceElapsed to prevent negative minutes for players subbed on during additional time
            const cappedSince = Math.min(player.onPitchSinceElapsed, this.timer.currentHalfDurationSeconds);
            mins += (cappedElapsed - cappedSince) / 60;
        }
        return Math.floor(Math.max(0, mins));
    }

    finalizePlayerMinutes(playerId) {
        if (this.state.mode !== MODES.LIVE || !this.state.isRunning) return;
        const player = this.getPlayerById(playerId);
        if (player && player.onPitchSinceElapsed !== undefined) {
            // Cap both elapsed times to prevent counting additional time
            const halfDuration = this.timer.currentHalfDurationSeconds;
            const currentElapsed = Math.min(this.getElapsedSeconds(), halfDuration);
            const cappedSince = Math.min(player.onPitchSinceElapsed, halfDuration);
            player.minutesPlayed += Math.max(0, (currentElapsed - cappedSince) / 60);
            player.onPitchSinceElapsed = undefined;
        }
    }

    startPlayerMinutes(playerId) {
        if (this.state.mode !== MODES.LIVE || !this.state.isRunning) return;
        const player = this.getPlayerById(playerId);
        if (player) {
            // Cap at half duration - players subbed on during additional time start at 0 effective minutes
            player.onPitchSinceElapsed = Math.min(this.getElapsedSeconds(), this.timer.currentHalfDurationSeconds);
        }
    }

    finalizeAllOnPitchMinutes() {
        const halfDuration = this.timer.currentHalfDurationSeconds;
        const currentElapsed = Math.min(this.getElapsedSeconds(), halfDuration);
        const lineup = this.getCurrentLineup();
        lineup.forEach(playerId => {
            if (playerId !== null) {
                const player = this.getPlayerById(playerId);
                if (player && player.onPitchSinceElapsed !== undefined) {
                    // Cap onPitchSinceElapsed to prevent negative minutes for players subbed on during additional time
                    const cappedSince = Math.min(player.onPitchSinceElapsed, halfDuration);
                    player.minutesPlayed += Math.max(0, (currentElapsed - cappedSince) / 60);
                    player.onPitchSinceElapsed = undefined;
                }
            }
        });
    }

    checkIntervalChange() {
        const elapsed = this.getElapsedSeconds();
        const intervalDuration = this.matchDurationSeconds / this.settings.intervalCount;
        const newInterval = Math.min(
            Math.floor(elapsed / intervalDuration) + 1,
            this.settings.intervalCount
        );
        
        if (newInterval !== this.state.currentInterval) {
            this.state.currentInterval = newInterval;
            this.subs.updateBadge();
        }
    }

    // ==================== SETUP EVENT LISTENERS ====================
    // (Abbreviated - full implementation would include all event listeners)

    setupEventListeners() {
        // Mode tabs
        document.getElementById('plan-mode-btn').addEventListener('click', () => this.setMode(MODES.PLAN));
        document.getElementById('live-mode-btn').addEventListener('click', () => this.setMode(MODES.LIVE));

        // Timer controls
        this.elements.playPauseBtn.addEventListener('click', () => this.toggleTimer());
        this.elements.stopBtn.addEventListener('click', () => this.stopMatch());
        document.getElementById('reset-match').addEventListener('click', () => this.resetMatch());
        
        // Debug: Click timer to toggle speed (1x/10x/20x)
        this.elements.currentTime?.addEventListener('click', () => this.timer.toggleSpeed());

        // Score controls
        document.getElementById('score-them-team').addEventListener('click', () => this.recordGoal(null, 'them'));
        document.getElementById('no-assist-btn').addEventListener('click', () => this.skipAssist());

        // Rating picker controls
        this.elements.ratingSaveBtn?.addEventListener('click', () => this.saveRatings());
        this.elements.ratingCancelBtn?.addEventListener('click', () => this.hideRatingPicker());

        // Interval count steppers
        document.getElementById('interval-dec').addEventListener('click', () => {
            const newCount = Math.max(CONFIG.INTERVAL_LIMITS.MIN, this.settings.intervalCount - 1);
            this.updateIntervalCount(newCount);
        });
        document.getElementById('interval-inc').addEventListener('click', () => {
            const newCount = Math.min(CONFIG.INTERVAL_LIMITS.MAX, this.settings.intervalCount + 1);
            this.updateIntervalCount(newCount);
        });

        // Subs per interval steppers
        document.getElementById('subs-dec').addEventListener('click', () => {
            const newCount = Math.max(0, this.settings.subsPerInterval - 1);
            this.updateSubsPerInterval(newCount);
        });
        document.getElementById('subs-inc').addEventListener('click', () => {
            const maxSubs = this.getMaxBenchSize();
            const newCount = Math.min(maxSubs, this.settings.subsPerInterval + 1);
            this.updateSubsPerInterval(newCount);
        });

        // Auto generate lineups
        document.getElementById('auto-subs-btn').addEventListener('click', () => this.autoGenerateSubs());
        document.getElementById('clear-team-btn').addEventListener('click', () => this.clearAllLineups());

        // Swipe hint arrows (click to navigate)
        this.elements.swipeHintLeft?.addEventListener('click', () => {
            if (this.state.mode === MODES.PLAN && this.state.selectedPlanInterval > 1) {
                this.selectInterval(this.state.selectedPlanInterval - 1);
            }
        });
        this.elements.swipeHintRight?.addEventListener('click', () => {
            if (this.state.mode === MODES.PLAN && this.state.selectedPlanInterval < this.settings.intervalCount) {
                this.selectInterval(this.state.selectedPlanInterval + 1);
            }
        });

        // Subs icon - tap to show popup, hold to apply
        this.setupSubsIconListeners();

        // Settings
        document.getElementById('toggle-settings').addEventListener('click', () => this.toggleSettings());
        document.getElementById('toggle-squad').addEventListener('click', () => this.toggleSquad());
        
        // Reset squad button
        document.getElementById('reset-squad-btn')?.addEventListener('click', () => this.resetSquad());
        
        // Add player button and Enter key
        const addPlayerBtn = document.getElementById('add-player-btn');
        const newPlayerInput = document.getElementById('new-player-name');
        if (addPlayerBtn && newPlayerInput) {
            addPlayerBtn.addEventListener('click', () => this.addPlayer());
            newPlayerInput.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    this.addPlayer();
                }
            });
        }
        
        // Match duration input
        const matchDurationInput = document.getElementById('match-duration');
        if (matchDurationInput) {
            // Initialize with saved value
            matchDurationInput.value = this.settings.matchDuration;
            
            // Update preview on input (no toast)
            matchDurationInput.addEventListener('input', (e) => {
                const newDuration = parseInt(e.target.value) || 10;
                this.settings.matchDuration = Math.max(10, Math.min(120, newDuration));
                this.renderIntervalTabs();
                this.renderPitch();
                this.renderBench();
                this.renderStats();
            });
            
            // Save and confirm on blur/enter
            matchDurationInput.addEventListener('change', (e) => {
                const newDuration = parseInt(e.target.value) || 10;
                this.settings.matchDuration = Math.max(10, Math.min(120, newDuration));
                matchDurationInput.value = this.settings.matchDuration;
                this.renderIntervalTabs();
                this.renderPitch();
                this.renderBench();
                this.renderStats();
                this.saveState();
                this.showToast(`Match duration: ${this.settings.matchDuration} mins`);
            });
        }
        
        // Opponent name input
        const opponentNameInput = document.getElementById('opponent-name');
        if (opponentNameInput) {
            opponentNameInput.value = this.settings.opponentName || '';
            opponentNameInput.addEventListener('change', (e) => {
                this.settings.opponentName = e.target.value.trim();
                this.updateTitle();
                this.saveState();
            });
        }
        
        // Venue toggle (home/away)
        const venueToggle = document.getElementById('venue-toggle');
        if (venueToggle) {
            // Set initial state
            const venueButtons = venueToggle.querySelectorAll('.venue-btn');
            venueButtons.forEach(btn => {
                const isHome = btn.dataset.venue === 'home';
                btn.classList.toggle('active', isHome === this.settings.isHome);
                btn.addEventListener('click', () => {
                    this.settings.isHome = btn.dataset.venue === 'home';
                    venueButtons.forEach(b => b.classList.toggle('active', b === btn));
                    this.updateTitle();
                    this.saveState();
                });
            });
        }
        
        // Match date input
        const matchDateInput = document.getElementById('match-date');
        const matchDateDisplay = document.getElementById('match-date-display');
        if (matchDateInput && matchDateDisplay) {
            // Default to today if not set
            if (!this.settings.matchDate) {
                const today = new Date().toISOString().split('T')[0];
                this.settings.matchDate = today;
            }
            matchDateInput.value = this.settings.matchDate;
            matchDateDisplay.textContent = this.formatDate(this.settings.matchDate);
            
            matchDateInput.addEventListener('change', (e) => {
                this.settings.matchDate = e.target.value;
                matchDateDisplay.textContent = this.formatDate(e.target.value);
                this.saveState();
            });
        }
        
        // Export stats button
        this.elements.exportStatsBtn?.addEventListener('click', () => this.exportStats());
        
        // Rate players button
        this.elements.ratePlayersBtn?.addEventListener('click', () => this.showRatingPicker());
        
        // Share plan button
        this.elements.sharePlanBtn?.addEventListener('click', () => this.sharePlan());
        
        // Dev: Shift+Backspace to clear localStorage
        document.addEventListener('keydown', e => {
            if (e.key === 'Backspace' && e.shiftKey) {
                localStorage.clear();
                location.reload();
            }
        });
    }

    setupSubsIconListeners() {
        if (!this.elements.subsIcon) return;
        
        let holdTimer = null;
        let didHold = false;
        
        this.elements.subsIcon.addEventListener('touchstart', (e) => {
            e.stopPropagation();
            didHold = false;
            holdTimer = setTimeout(() => {
                didHold = true;
                this.applyPlannedSubs();
            }, CONFIG.LONG_PRESS_MS);
        });
        
        this.elements.subsIcon.addEventListener('touchend', (e) => {
            e.stopPropagation();
            clearTimeout(holdTimer);
            if (!didHold) this.showSubsPopup();
        });
        
        this.elements.subsIcon.addEventListener('touchcancel', () => clearTimeout(holdTimer));
        
        // Mouse fallback
        this.elements.subsIcon.addEventListener('mousedown', (e) => {
            didHold = false;
            holdTimer = setTimeout(() => {
                didHold = true;
                this.applyPlannedSubs();
            }, CONFIG.LONG_PRESS_MS);
        });
        
        this.elements.subsIcon.addEventListener('mouseup', (e) => {
            clearTimeout(holdTimer);
            if (!didHold) this.showSubsPopup();
        });
        
        this.elements.subsIcon.addEventListener('mouseleave', () => clearTimeout(holdTimer));
    }

    // Setup swipe gestures for interval navigation (Plan mode)
    setupSwipeGestures() {
        let startX = 0;
        let startY = 0;
        let isHorizontalSwipe = null;
        const swipeThreshold = 30;
        
        this.elements.pitch.addEventListener('touchstart', (e) => {
            startX = e.touches[0].clientX;
            startY = e.touches[0].clientY;
            isHorizontalSwipe = null;
        }, { passive: true });
        
        this.elements.pitch.addEventListener('touchmove', (e) => {
            if (this.state.mode !== MODES.PLAN) return;
            // Don't interfere with player drags
            if (this.drag.dragState.draggingPlayer || this.drag.wasDragging) return;
            
            const dx = Math.abs(e.touches[0].clientX - startX);
            const dy = Math.abs(e.touches[0].clientY - startY);
            
            // Determine swipe direction on first significant movement
            if (isHorizontalSwipe === null && (dx > 10 || dy > 10)) {
                isHorizontalSwipe = dx > dy;
            }
            
            // Prevent vertical scrolling when swiping horizontally
            if (isHorizontalSwipe) {
                e.preventDefault();
            }
        }, { passive: false });
        
        this.elements.pitch.addEventListener('touchend', (e) => {
            if (this.state.mode !== MODES.PLAN) return;
            // Don't trigger swipe if we're dragging or just finished dragging a player
            if (this.drag.dragState.draggingPlayer || this.drag.wasDragging) return;
            
            const endX = e.changedTouches[0].clientX;
            const dx = endX - startX;
            
            // Only trigger horizontal swipes
            if (isHorizontalSwipe && Math.abs(dx) > swipeThreshold) {
                // Hide swipe hints once user has learned the gesture
                this.elements.swipeHintLeft?.classList.add('hidden');
                this.elements.swipeHintRight?.classList.add('hidden');
                
                if (dx < 0 && this.state.selectedPlanInterval < this.settings.intervalCount) {
                    // Swipe left - next interval
                    this.selectInterval(this.state.selectedPlanInterval + 1);
                    this.showToast(`Interval ${this.state.selectedPlanInterval}`);
                } else if (dx > 0 && this.state.selectedPlanInterval > 1) {
                    // Swipe right - previous interval
                    this.selectInterval(this.state.selectedPlanInterval - 1);
                    this.showToast(`Interval ${this.state.selectedPlanInterval}`);
                }
            }
            
            isHorizontalSwipe = null;
        });
    }

    // Setup swipe to switch between Plan and Live modes
    setupSwipeToSwitchMode() {
        let touchStartX = 0;
        let touchStartY = 0;
        let touchStartTime = 0;
        
        const container = document.getElementById('app');
        if (!container) return;
        
        container.addEventListener('touchstart', (e) => {
            // Ignore if touching a player card (let drag handler manage those)
            if (e.target.closest('.player-card')) return;
            // Ignore if touching the pitch area in Plan mode (has its own interval swipe)
            if (e.target.closest('.pitch') && this.state.mode === MODES.PLAN) return;
            touchStartX = e.touches[0].clientX;
            touchStartY = e.touches[0].clientY;
            touchStartTime = Date.now();
        }, { passive: true });
        
        container.addEventListener('touchend', (e) => {
            if (!touchStartTime) return;
            
            const touchEndX = e.changedTouches[0].clientX;
            const touchEndY = e.changedTouches[0].clientY;
            const deltaX = touchEndX - touchStartX;
            const deltaY = touchEndY - touchStartY;
            const elapsed = Date.now() - touchStartTime;
            
            // Reset
            touchStartTime = 0;
            
            // Must be a quick horizontal swipe (not a slow drag or vertical scroll)
            const minSwipeDistance = 80;
            const maxSwipeTime = 300;
            const maxVerticalDrift = 100;
            
            if (elapsed > maxSwipeTime) return;
            if (Math.abs(deltaY) > maxVerticalDrift) return;
            if (Math.abs(deltaX) < minSwipeDistance) return;
            
            if (deltaX < 0 && this.state.mode === MODES.PLAN) {
                // Swipe left: Plan → Live
                this.setMode(MODES.LIVE);
            } else if (deltaX > 0 && this.state.mode === MODES.LIVE) {
                // Swipe right: Live → Plan
                this.setMode(MODES.PLAN);
            }
        }, { passive: true });
    }

    // ==================== MODE & SETTINGS ====================

    setMode(mode) {
        this.state.mode = mode;
        
        document.getElementById('plan-mode-btn').classList.toggle('active', mode === MODES.PLAN);
        document.getElementById('live-mode-btn').classList.toggle('active', mode === MODES.LIVE);
        this.elements.planControls.style.display = mode === MODES.PLAN ? 'block' : 'none';
        this.elements.liveControls.style.display = mode === MODES.LIVE ? 'block' : 'none';
        this.elements.timerButtons.style.display = mode === MODES.LIVE ? 'flex' : 'none';
        this.elements.sharePlanBtn.style.display = mode === MODES.PLAN ? 'inline-block' : 'none';
        this.elements.resetMatchBtn.style.display = mode === MODES.LIVE ? 'inline-block' : 'none';
        
        // Toggle stats vs events section
        this.elements.statsSection.style.display = mode === MODES.PLAN ? 'block' : 'none';
        this.elements.eventsSection.style.display = mode === MODES.LIVE ? 'block' : 'none';
        
        // Toggle hint badges based on mode (with auto-fade)
        if (mode === MODES.PLAN) {
            // Plan mode: show pin hint and swipe hints, hide live-specific hints
            this.showHintWithFade(this.elements.hintPin, 'hintPin', 6000);
            this.showHintWithFade(this.elements.swipeHintLeft, 'swipeLeft', 6000);
            this.showHintWithFade(this.elements.swipeHintRight, 'swipeRight', 6000);
            this.elements.hintPitch?.classList.add('hidden');
            this.elements.hintScore?.classList.add('hidden');
        } else {
            // Live mode: show goal hints, hide plan-specific hints
            this.elements.hintPin?.classList.add('hidden');
            this.elements.swipeHintLeft?.classList.add('hidden');
            this.elements.swipeHintRight?.classList.add('hidden');
            this.showHintWithFade(this.elements.hintPitch, 'hintPitch', 6000);
            this.showHintWithFade(this.elements.hintScore, 'hintScore', 6000);
        }
        
        if (mode === MODES.PLAN) {
            this.elements.pitchActions?.classList.remove('hidden');
            this.elements.subsIcon?.classList.remove('visible');
        } else {
            this.elements.pitchActions?.classList.add('hidden');
            this.elements.subsIcon?.classList.add('visible');
            
            const matchNotStarted = !this.state.startTime && this.state.pausedElapsedMs === 0;
            if (!this.state.liveLineup || matchNotStarted) {
                this.state.liveLineup = [...(this.state.intervalLineups[1] || Array(9).fill(null))];
            }
            this.updateSubsIconBadge();
        }
        
        this.drag.clearBenchSelection();
        this.renderPitch();
        this.renderBench();
        
        if (mode === MODES.LIVE) {
            this.events.renderMatchEvents();
        } else {
            this.renderStats();
        }
        this.saveState();
    }

    resetMatch() {
        if (confirm('Reset the match? This will reset the timer, scores, and player minutes.')) {
            this.timer.reset();
            this.state.currentInterval = 1;
            this.state.lastAppliedSubsInterval = 0;
            this.state.liveLineup = [...(this.state.intervalLineups[1] || Array(9).fill(null))];
            this.state.scoreUs = 0;
            this.state.scoreThem = 0;
            this.state.goalHistory = [];
            this.state.matchEvents = [];
            this.state.players.forEach(p => {
                p.minutesPlayed = 0;
                p.goals = 0;
                p.assists = 0;
                p.startedGame = false;
                p.onPitchSinceElapsed = undefined;
            });
            
            this.updateScoreDisplay();
            this.renderPitch();
            this.renderBench();
            this.renderStats();
            this.events.renderMatchEvents();
            this.updateSubsIconBadge();
            this.updateExportButtonVisibility();
            this.saveState();
            this.showToast('Match reset');
        }
    }

    toggleSettings() {
        const content = document.getElementById('settings-content');
        content.style.display = content.style.display === 'none' ? 'block' : 'none';
        document.getElementById('squad-content').style.display = 'none';
    }

    toggleSquad() {
        const content = document.getElementById('squad-content');
        content.style.display = content.style.display === 'none' ? 'block' : 'none';
        document.getElementById('settings-content').style.display = 'none';
    }

    // ==================== SHARE FUNCTIONALITY ====================

    sharePlan() {
        const encoded = this.encodePlan();
        // Use query param instead of hash - more reliable for WhatsApp/messaging apps
        const url = `${window.location.origin}${window.location.pathname}?plan=${encodeURIComponent(encoded)}`;
        
        navigator.clipboard.writeText(url).then(() => {
            // Show feedback
            const btn = this.elements.sharePlanBtn;
            const originalText = btn.textContent;
            btn.textContent = '✓ Copied!';
            btn.classList.add('copied');
            setTimeout(() => {
                btn.textContent = originalText;
                btn.classList.remove('copied');
            }, 2000);
        }).catch(err => {
            // Fallback: show URL in prompt
            prompt('Copy this URL to share your plan:', url);
        });
    }

    encodePlan() {
        // Build a compact JSON object and Base64 encode it
        const players = this.state.players;
        
        // Build lineups using player array index (not player ID)
        const lineups = [];
        for (let i = 1; i <= this.settings.intervalCount; i++) {
            const lineup = this.state.intervalLineups[i] || [];
            const indices = [];
            for (let slot = 0; slot < CONFIG.SLOTS_COUNT; slot++) {
                const playerId = lineup[slot];
                if (playerId === null || playerId === undefined) {
                    indices.push(null);
                } else {
                    const idx = players.findIndex(p => p.id === playerId);
                    indices.push(idx >= 0 ? idx : null);
                }
            }
            lineups.push(indices);
        }
        
        const data = {
            p: players.map(p => p.name),           // player names
            n: players.map(p => p.number),          // player numbers
            l: lineups,                             // lineups (array of arrays)
            d: this.settings.matchDuration,         // duration
            i: this.settings.intervalCount,         // intervals
            o: this.settings.opponentName || '',    // opponent
            t: this.settings.matchDate || '',       // date
            h: this.settings.isHome ? 1 : 0,        // home/away
            s: this.settings.subsPerInterval        // subs per interval
        };
        
        // Base64 encode (URL-safe: replace + with - and / with _)
        const json = JSON.stringify(data);
        const base64 = btoa(unescape(encodeURIComponent(json)));
        return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    }

    decodePlan(encoded) {
        try {
            // Try Base64 decode first (new format)
            if (!encoded.includes('|') && !encoded.includes('=')) {
                return this.decodePlanBase64(encoded);
            }
            // Fall back to old pipe-delimited format
            return this.decodePlanLegacy(encoded);
        } catch (e) {
            // If Base64 fails, try legacy format
            try {
                return this.decodePlanLegacy(encoded);
            } catch (e2) {
                console.error('Failed to decode plan:', e2);
                return null;
            }
        }
    }

    decodePlanBase64(encoded) {
        // Restore URL-safe Base64 to standard Base64
        let base64 = encoded.replace(/-/g, '+').replace(/_/g, '/');
        // Add padding if needed
        while (base64.length % 4) base64 += '=';
        
        const json = decodeURIComponent(escape(atob(base64)));
        const data = JSON.parse(json);
        
        const players = data.p.map((name, idx) => ({
            id: idx + 1,
            name: name,
            number: data.n[idx] || idx + 1,
            minutesPlayed: 0
        }));
        
        const intervalLineups = {};
        data.l.forEach((indices, intervalIdx) => {
            const lineup = [];
            for (let slot = 0; slot < CONFIG.SLOTS_COUNT; slot++) {
                const idx = indices[slot];
                if (idx === null || idx === undefined) {
                    lineup.push(null);
                } else {
                    lineup.push(players[idx] ? players[idx].id : null);
                }
            }
            intervalLineups[intervalIdx + 1] = lineup;
        });
        
        return {
            players,
            matchDuration: data.d || 60,
            intervalCount: data.i || 4,
            intervalLineups,
            opponentName: data.o || '',
            matchDate: data.t || '',
            isHome: data.h !== 0,
            subsPerInterval: data.s !== undefined ? data.s : 0
        };
    }

    // Legacy decoder for old pipe-delimited format (backward compatibility)
    decodePlanLegacy(hash) {
        // Handle URL-encoded pipes (some apps encode | as %7C)
        const normalizedHash = hash.replace(/%7C/gi, '|');
        
        const params = {};
        normalizedHash.split('|').forEach(part => {
            const [key, value] = part.split('=');
            params[key] = value;
        });
        
        if (!params.p || !params.l) return null;
        
        // Decode names - handle potential double-encoding from some apps
        const names = params.p.split(',').map(n => {
            let decoded = decodeURIComponent(n);
            // If still contains %XX patterns, decode again (double-encoded)
            if (decoded.includes('%')) {
                try { decoded = decodeURIComponent(decoded); } catch(e) {}
            }
            return decoded;
        });
        const numbers = params.n ? params.n.split(',').map(n => parseInt(n)) : names.map((_, i) => i + 1);
        
        const players = names.map((name, idx) => ({
            id: idx + 1,
            name: name,
            number: numbers[idx] || idx + 1,
            minutesPlayed: 0
        }));
        
        const matchDuration = parseInt(params.d) || 60;
        const intervalCount = parseInt(params.i) || 4;
        let opponentName = params.o ? decodeURIComponent(params.o) : '';
        // Handle potential double-encoding
        if (opponentName.includes('%')) {
            try { opponentName = decodeURIComponent(opponentName); } catch(e) {}
        }
        const matchDate = params.t || '';
        const isHome = params.h !== '0';  // Default to home if not specified
        const subsPerInterval = params.s !== undefined ? parseInt(params.s) : 0;
        
        const intervalLineups = {};
        const lineupStrs = params.l.split(';');
        lineupStrs.forEach((lineupStr, intervalIdx) => {
            const indices = lineupStr ? lineupStr.split(',') : [];
            // Ensure we always create exactly SLOTS_COUNT slots
            const lineup = [];
            for (let slot = 0; slot < CONFIG.SLOTS_COUNT; slot++) {
                const idx = indices[slot];
                if (!idx || idx === '-' || idx === '') {
                    lineup.push(null);
                } else {
                    const playerIdx = parseInt(idx);
                    lineup.push(players[playerIdx] ? players[playerIdx].id : null);
                }
            }
            intervalLineups[intervalIdx + 1] = lineup;
        });
        
        return { players, matchDuration, intervalCount, intervalLineups, opponentName, matchDate, isHome, subsPerInterval };
    }

    // ==================== RENDERING ====================

    renderPitch() {
        this.renderer.renderPitch();
    }

    renderBench() {
        this.renderer.renderBench();
    }

    renderStats() {
        this.renderer.renderStats();
    }

    renderIntervalTabs() {
        this.renderer.renderIntervalTabs();
    }

    renderRoster() {
        this.renderer.renderRoster();
    }

    // ==================== DRAG DELEGATION ====================

    setupDragForPlayer(element, playerId, location, slotIndex) {
        this.drag.setupDragForPlayer(element, playerId, location, slotIndex);
    }

    handleDrop(slotIndex, location) {
        this.drag.handleDrop(slotIndex, location);
    }

    handleDropOnBenchPlayer(playerId) {
        this.drag.handleDropOnBenchPlayer(playerId);
    }

    // ==================== LINEUP MANAGEMENT ====================

    setCurrentLineup(lineup) {
        if (this.state.mode === MODES.LIVE) {
            this.state.liveLineup = lineup;
        } else {
            this.state.intervalLineups[this.state.selectedPlanInterval] = lineup;
        }
        this.saveState();
    }

    isPlayerOnPitch(playerId) {
        return this.getCurrentLineup().includes(playerId);
    }

    getPlayerCurrentMinutes(playerId) {
        const player = this.getPlayerById(playerId);
        if (!player) return 0;
        
        let total = player.minutesPlayed || 0;
        
        // Add time since last went on pitch (if applicable)
        if (this.state.mode === MODES.LIVE && player.onPitchSinceElapsed !== undefined) {
            const currentElapsed = this.getElapsedSeconds();
            total += (currentElapsed - player.onPitchSinceElapsed) / 60;
        }
        
        return total;
    }

    getIntervalsForPlayer(playerId) {
        const intervals = [];
        for (let i = 1; i <= this.settings.intervalCount; i++) {
            if (this.state.intervalLineups[i]?.includes(playerId)) {
                intervals.push(i);
            }
        }
        return intervals.join(',') || '-';
    }

    // ==================== INTERVAL SELECTION ====================

    selectInterval(interval) {
        this.state.selectedPlanInterval = interval;
        this.renderIntervalTabs();
        this.renderPitch();
        this.renderBench();
        this.renderStats();
        this.saveState();
    }

    copyLineup(fromInterval, toInterval) {
        // Copy the lineup
        this.state.intervalLineups[toInterval] = [...this.state.intervalLineups[fromInterval]];
        
        // Copy pinned positions
        if (this.state.pinnedPositions) {
            // Clear existing pins for target interval
            for (let slot = 0; slot < CONFIG.SLOTS_COUNT; slot++) {
                delete this.state.pinnedPositions[`${toInterval}-${slot}`];
            }
            // Copy pins from source interval
            for (let slot = 0; slot < CONFIG.SLOTS_COUNT; slot++) {
                if (this.state.pinnedPositions[`${fromInterval}-${slot}`]) {
                    this.state.pinnedPositions[`${toInterval}-${slot}`] = true;
                }
            }
        }
        
        this.showToast(`Copied ${fromInterval} → ${toInterval}`);
        this.renderIntervalTabs();
        this.renderPitch();
        this.saveState();
    }

    // ==================== INTERVAL/SUBS SETTINGS ====================

    updateIntervalCount(newCount) {
        const oldCount = this.settings.intervalCount;
        this.settings.intervalCount = newCount;

        // Add new intervals (copy from last existing)
        if (newCount > oldCount) {
            const lastLineup = this.state.intervalLineups[oldCount] || Array(CONFIG.SLOTS_COUNT).fill(null);
            for (let i = oldCount + 1; i <= newCount; i++) {
                this.state.intervalLineups[i] = [...lastLineup];
            }
        }

        // Remove excess intervals
        if (newCount < oldCount) {
            for (let i = newCount + 1; i <= oldCount; i++) {
                delete this.state.intervalLineups[i];
            }
        }

        // Adjust selected interval if out of range
        if (this.state.selectedPlanInterval > newCount) {
            this.state.selectedPlanInterval = newCount;
        }
        if (this.state.currentInterval > newCount) {
            this.state.currentInterval = newCount;
        }

        this.saveState();
        this.elements.intervalCount.textContent = newCount;
        this.renderIntervalTabs();
        this.renderPitch();
        this.renderBench();
        this.renderStats();
    }

    getMaxBenchSize() {
        const gk = this.state.players.find(p => p.preferredPositions?.includes(0)) || this.state.players[0];
        const outfieldCount = gk ? this.state.players.length - 1 : this.state.players.length;
        return Math.max(0, outfieldCount - (CONFIG.SLOTS_COUNT - 1));
    }

    updateSubsPerInterval(newCount) {
        this.settings.subsPerInterval = newCount;
        this.updateSubsDisplay();
        this.saveState();
    }

    updateSubsDisplay() {
        const maxSubs = this.getMaxBenchSize();
        // Clamp to valid range [0, maxSubs]
        if (this.settings.subsPerInterval < 0) {
            this.settings.subsPerInterval = maxSubs;
        }
        if (this.settings.subsPerInterval > maxSubs) {
            this.settings.subsPerInterval = maxSubs;
        }
        if (this.elements.subsCount) {
            this.elements.subsCount.textContent = this.settings.subsPerInterval;
        }
    }

    // ==================== PIN MANAGEMENT ====================

    isPositionPinned(interval, slotIndex) {
        const key = `${interval}-${slotIndex}`;
        return this.state.pinnedPositions?.[key] === true;
    }

    pinPosition(interval, slotIndex) {
        if (!this.state.pinnedPositions) this.state.pinnedPositions = {};
        this.state.pinnedPositions[`${interval}-${slotIndex}`] = true;
        this.saveState();
    }

    unpinPosition(interval, slotIndex) {
        if (this.state.pinnedPositions) {
            delete this.state.pinnedPositions[`${interval}-${slotIndex}`];
            this.saveState();
        }
    }

    // ==================== AUTO LINEUP GENERATION ====================

    autoGenerateSubs() {
        this.autoLineup.generate();
    }

    clearAllLineups() {
        // Skip confirm on mobile (iOS Safari can block it) - users can use Auto to regenerate
        const pitchSize = CONFIG.SLOTS_COUNT;
        const intervalCount = this.settings.intervalCount;
        
        // Clear ALL interval lineups
        this.state.intervalLineups = {};
        for (let i = 1; i <= intervalCount; i++) {
            this.state.intervalLineups[i] = Array(pitchSize).fill(null);
        }
        
        // Also clear live lineup (in case mode is 'live')
        this.state.liveLineup = Array(pitchSize).fill(null);
        
        // Switch back to plan mode
        this.state.mode = 'plan';
        this.state.selectedPlanInterval = 1;
        
        // Clear pinned positions
        this.state.pinnedPositions = {};
        
        this.showToast('Lineups cleared');
        this.renderAll();
        this.saveState();
    }

    renderAll() {
        this.renderIntervalTabs();
        this.renderPitch();
        this.renderBench();
        this.renderStats();
        this.renderRoster();
        this.events.renderMatchEvents();
    }

    // ==================== PLAYER MANAGEMENT ====================

    addPlayer() {
        const input = document.getElementById('new-player-name');
        const name = input.value.trim();
        
        if (!name) {
            this.showToast('Enter a player name');
            return;
        }
        
        const maxId = this.state.players.reduce((max, p) => Math.max(max, p.id), 0);
        const maxNumber = this.state.players.reduce((max, p) => Math.max(max, p.number || 0), 0);
        
        const newPlayer = {
            id: maxId + 1,
            name: name,
            number: maxNumber + 1,
            preferredPositions: [],
            minutesPlayed: 0,
            goals: 0,
            assists: 0
        };
        
        this.state.players.push(newPlayer);
        input.value = '';
        
        this.renderRoster();
        this.renderBench();
        this.renderStats();
        this.saveState();
        this.showToast(`Added ${name}`);
    }

    togglePlayerPosition(playerId, slotIndex) {
        const player = this.getPlayerById(playerId);
        if (!player) return;
        
        if (!player.preferredPositions) player.preferredPositions = [];
        
        const idx = player.preferredPositions.indexOf(slotIndex);
        if (idx === -1) {
            player.preferredPositions.push(slotIndex);
        } else {
            player.preferredPositions.splice(idx, 1);
        }
        
        this.renderRoster();
        this.saveState();
    }

    deletePlayer(playerId) {
        const player = this.getPlayerById(playerId);
        if (!player) return;
        
        const playerCopy = { ...player };
        const lineupPositions = [];
        
        // Track and remove from lineups
        for (let i = 1; i <= this.settings.intervalCount; i++) {
            const lineup = this.state.intervalLineups[i];
            if (lineup) {
                const idx = lineup.indexOf(playerId);
                if (idx !== -1) {
                    lineupPositions.push({ interval: i, slot: idx });
                    lineup[idx] = null;
                }
            }
        }
        
        let liveSlot = -1;
        if (this.state.liveLineup) {
            const idx = this.state.liveLineup.indexOf(playerId);
            if (idx !== -1) {
                liveSlot = idx;
                this.state.liveLineup[idx] = null;
            }
        }
        
        this.state.players = this.state.players.filter(p => p.id !== playerId);
        
        this.renderRoster();
        this.renderPitch();
        this.renderBench();
        this.renderStats();
        this.saveState();
        
        // Toast with undo
        this.showToast(`Removed ${playerCopy.name}`, 'default', 5000, () => {
            this.state.players.push(playerCopy);
            for (const pos of lineupPositions) {
                if (this.state.intervalLineups[pos.interval]) {
                    this.state.intervalLineups[pos.interval][pos.slot] = playerId;
                }
            }
            if (liveSlot !== -1 && this.state.liveLineup) {
                this.state.liveLineup[liveSlot] = playerId;
            }
            this.renderRoster();
            this.renderPitch();
            this.renderBench();
            this.renderStats();
            this.saveState();
            this.showToast(`Restored ${playerCopy.name}`);
        });
    }

    // ==================== VISUAL EFFECTS ====================

    showScoringAnimation(element) {
        element.classList.add('scoring');
        this.hapticFeedback([50, 50, 100]);
        setTimeout(() => element.classList.remove('scoring'), 500);
    }

    loadSamplePlayers() {
        this.state.players = [
            { id: 1, name: 'Felix', number: 1, preferredPositions: [0], minutesPlayed: 0, goals: 0, assists: 0 },
            { id: 2, name: 'Chester', number: 2, preferredPositions: [1, 2, 3], minutesPlayed: 0, goals: 0, assists: 0 },
            { id: 3, name: 'Elliott', number: 3, preferredPositions: [2], minutesPlayed: 0, goals: 0, assists: 0 },
            { id: 4, name: 'Lucas', number: 4, preferredPositions: [1, 3], minutesPlayed: 0, goals: 0, assists: 0 },
            { id: 5, name: 'Alfie B', number: 5, preferredPositions: [1, 3, 4, 7], minutesPlayed: 0, goals: 0, assists: 0 },
            { id: 6, name: 'Jude', number: 6, preferredPositions: [4, 7, 8, 5, 6], minutesPlayed: 0, goals: 0, assists: 0 },
            { id: 7, name: 'Jaxson', number: 7, preferredPositions: [5, 6], minutesPlayed: 0, goals: 0, assists: 0 },
            { id: 8, name: 'Dylan', number: 8, preferredPositions: [6, 5, 1, 2], minutesPlayed: 0, goals: 0, assists: 0 },
            { id: 9, name: 'Stuart', number: 9, preferredPositions: [4, 7, 8], minutesPlayed: 0, goals: 0, assists: 0 },
            { id: 10, name: 'Alfie S', number: 10, preferredPositions: [7, 4], minutesPlayed: 0, goals: 0, assists: 0 },
            { id: 11, name: 'Ollie', number: 11, preferredPositions: [8, 4], minutesPlayed: 0, goals: 0, assists: 0 },
            { id: 12, name: 'Leo', number: 12, preferredPositions: [8, 4, 7], minutesPlayed: 0, goals: 0, assists: 0 },
            { id: 13, name: 'Sophie', number: 13, preferredPositions: [5, 6, 7, 8], minutesPlayed: 0, goals: 0, assists: 0 }
        ];
    }

    resetSquad() {
        // Skip confirm on mobile (iOS Safari can block it)
        // Reset players to default
        this.loadSamplePlayers();
        
        // Clear all lineups
        const pitchSize = CONFIG.SLOTS_COUNT;
        this.state.intervalLineups = {};
        for (let i = 1; i <= this.settings.intervalCount; i++) {
            this.state.intervalLineups[i] = Array(pitchSize).fill(null);
        }
        this.state.liveLineup = Array(pitchSize).fill(null);
        
        // Clear pinned positions
        this.state.pinnedPositions = {};
        
        this.showToast('Squad reset');
        this.renderAll();
        this.saveState();
    }
}

// Initialize on DOM ready
document.addEventListener('DOMContentLoaded', () => {
    window.app = new TeamSelector();
    window.app.init();
});
