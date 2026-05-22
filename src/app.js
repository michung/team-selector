import { CONFIG, MODES, POSITIONS, DEFAULT_STATE, DEFAULT_SETTINGS, SLOT_FILL_ORDER } from './config.js';
import { StorageManager } from './managers/StorageManager.js';
import { TimerManager } from './managers/TimerManager.js';
import { SubsManager } from './managers/SubsManager.js';
import { EventManager } from './managers/EventManager.js';
import { RenderManager } from './managers/RenderManager.js';
import { DragManager } from './managers/DragManager.js';

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
            toastContainer: document.getElementById('toast-container'),
            pitchActions: document.getElementById('pitch-actions'),
            subsIcon: document.getElementById('subs-icon'),
            subsBadge: document.getElementById('subs-badge'),
            swipeHintLeft: document.getElementById('swipe-hint-left'),
            swipeHintRight: document.getElementById('swipe-hint-right'),
            hintPitch: document.getElementById('hint-pitch'),
            hintScore: document.getElementById('hint-score'),
            hintPin: document.getElementById('hint-pin'),
            intervalCount: document.getElementById('interval-count'),
            subsCount: document.getElementById('subs-count')
        };
    }

    /**
     * Load state from storage or from shared URL
     */
    loadState() {
        // Check for shared plan in URL hash
        const hash = window.location.hash.slice(1);
        if (hash) {
            const sharedPlan = this.decodePlan(hash);
            if (sharedPlan) {
                this.state.players = sharedPlan.players;
                this.state.intervalLineups = sharedPlan.intervalLineups;
                this.settings.matchDuration = sharedPlan.matchDuration;
                this.settings.intervalCount = sharedPlan.intervalCount;
                // Clear the hash so refreshing doesn't re-import
                history.replaceState(null, '', window.location.pathname);
                this.showToast('Plan imported!');
                this.saveState();
                return;
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
    toggleTimer() { return this.timer.toggle(); }
    stopMatch() { return this.timer.stop(); }

    // Events  
    recordGoal(playerId, team) { return this.events.recordGoal(playerId, team); }
    recordSubstitution(playerIn, playerOut) { return this.events.recordSubstitution(playerIn, playerOut); }
    skipAssist() { return this.events.skipAssist(); }

    // ==================== PLAYER MINUTES ====================

    updatePlayerMinutes() {
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
                const mins = Math.round(player.minutesPlayed || 0);
                const minsEl = card.querySelector('.player-minutes');
                if (minsEl) minsEl.textContent = `${mins}'`;
            }
        });
    }
    
    getDisplayMinutes(player, currentElapsed) {
        let mins = player.minutesPlayed || 0;
        if (player.onPitchSinceElapsed !== undefined) {
            mins += (currentElapsed - player.onPitchSinceElapsed) / 60;
        }
        return Math.round(mins);
    }

    finalizePlayerMinutes(playerId) {
        if (this.state.mode !== MODES.LIVE || !this.state.isRunning) return;
        const player = this.getPlayerById(playerId);
        if (player && player.onPitchSinceElapsed !== undefined) {
            const currentElapsed = this.getElapsedSeconds();
            player.minutesPlayed += (currentElapsed - player.onPitchSinceElapsed) / 60;
            player.onPitchSinceElapsed = undefined;
        }
    }

    startPlayerMinutes(playerId) {
        if (this.state.mode !== MODES.LIVE || !this.state.isRunning) return;
        const player = this.getPlayerById(playerId);
        if (player) {
            player.onPitchSinceElapsed = this.getElapsedSeconds();
        }
    }

    finalizeAllOnPitchMinutes() {
        const currentElapsed = Math.min(this.getElapsedSeconds(), this.matchDurationSeconds);
        const lineup = this.getCurrentLineup();
        lineup.forEach(playerId => {
            if (playerId !== null) {
                const player = this.getPlayerById(playerId);
                if (player && player.onPitchSinceElapsed !== undefined) {
                    player.minutesPlayed += (currentElapsed - player.onPitchSinceElapsed) / 60;
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
        const swipeThreshold = 50;
        
        this.elements.pitch.addEventListener('touchstart', (e) => {
            startX = e.touches[0].clientX;
            startY = e.touches[0].clientY;
        }, { passive: true });
        
        this.elements.pitch.addEventListener('touchend', (e) => {
            if (this.state.mode !== MODES.PLAN) return;
            // Don't trigger swipe if we're dragging or just finished dragging a player
            if (this.drag.dragState.draggingPlayer || this.drag.wasDragging) return;
            
            const endX = e.changedTouches[0].clientX;
            const endY = e.changedTouches[0].clientY;
            const dx = endX - startX;
            const dy = endY - startY;
            
            // Only trigger swipe if horizontal movement is greater than vertical
            if (Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > swipeThreshold) {
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
        }, { passive: true });
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
                p.onPitchSinceElapsed = undefined;
            });
            
            this.updateScoreDisplay();
            this.renderPitch();
            this.renderBench();
            this.renderStats();
            this.events.renderMatchEvents();
            this.updateSubsIconBadge();
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
        const url = `${window.location.origin}${window.location.pathname}#${encoded}`;
        
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
        // Compact format: p=name1,name2|n=num1,num2|l=lineup1;lineup2|d=duration|i=intervals
        const players = this.state.players;
        const names = players.map(p => encodeURIComponent(p.name)).join(',');
        const numbers = players.map(p => p.number).join(',');
        
        // Build lineups using player array index (not player ID)
        const lineups = [];
        for (let i = 1; i <= this.settings.intervalCount; i++) {
            const lineup = this.state.intervalLineups[i] || [];
            const indices = lineup.map(playerId => {
                if (playerId === null) return '-';
                const idx = players.findIndex(p => p.id === playerId);
                return idx >= 0 ? idx : '-';
            });
            lineups.push(indices.join(','));
        }
        
        const parts = [
            `p=${names}`,
            `n=${numbers}`,
            `l=${lineups.join(';')}`,
            `d=${this.settings.matchDuration}`,
            `i=${this.settings.intervalCount}`
        ];
        
        return parts.join('|');
    }

    decodePlan(hash) {
        try {
            const params = {};
            hash.split('|').forEach(part => {
                const [key, value] = part.split('=');
                params[key] = value;
            });
            
            if (!params.p || !params.l) return null;
            
            const names = params.p.split(',').map(n => decodeURIComponent(n));
            const numbers = params.n ? params.n.split(',').map(n => parseInt(n)) : names.map((_, i) => i + 1);
            
            const players = names.map((name, idx) => ({
                id: idx + 1,
                name: name,
                number: numbers[idx] || idx + 1,
                minutesPlayed: 0
            }));
            
            const matchDuration = parseInt(params.d) || 60;
            const intervalCount = parseInt(params.i) || 4;
            
            const intervalLineups = {};
            const lineupStrs = params.l.split(';');
            lineupStrs.forEach((lineupStr, intervalIdx) => {
                const indices = lineupStr.split(',');
                intervalLineups[intervalIdx + 1] = indices.map(idx => {
                    if (idx === '-' || idx === '') return null;
                    const playerIdx = parseInt(idx);
                    return players[playerIdx] ? players[playerIdx].id : null;
                });
            });
            
            return { players, matchDuration, intervalCount, intervalLineups };
        } catch (e) {
            console.error('Failed to decode plan:', e);
            return null;
        }
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
        this.state.intervalLineups[toInterval] = [...this.state.intervalLineups[fromInterval]];
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
        // Initialize to max if unset (-1) or clamp if exceeds current max
        if (this.settings.subsPerInterval === -1 || this.settings.subsPerInterval > maxSubs) {
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
        const players = this.state.players;
        const intervals = this.settings.intervalCount;
        const pitchSize = CONFIG.SLOTS_COUNT;
        
        if (players.length < pitchSize) {
            this.showToast('Need at least 9 players');
            return;
        }
        
        // Save existing lineups to get pinned player values
        const existingLineups = {};
        for (let i = 1; i <= intervals; i++) {
            existingLineups[i] = this.state.intervalLineups[i] 
                ? [...this.state.intervalLineups[i]] 
                : Array(pitchSize).fill(null);
        }
        
        // Build locked positions from pinnedPositions
        const lockedPerInterval = {};
        const lockedPlayerIds = new Set();
        
        for (let interval = 1; interval <= intervals; interval++) {
            lockedPerInterval[interval] = new Map();
            for (let slot = 0; slot < pitchSize; slot++) {
                if (this.isPositionPinned(interval, slot)) {
                    const playerId = existingLineups[interval][slot];
                    if (playerId !== null) {
                        lockedPerInterval[interval].set(slot, playerId);
                        lockedPlayerIds.add(playerId);
                    }
                }
            }
        }
        
        // Clear lineups to rebuild
        this.state.intervalLineups = {};
        
        // Find the GK - check if any GK is locked, otherwise use default
        let gkId = null;
        for (let interval = 1; interval <= intervals; interval++) {
            if (lockedPerInterval[interval].has(0)) {
                gkId = lockedPerInterval[interval].get(0);
                break;
            }
        }
        if (!gkId) {
            const gk = players.find(p => p.preferredPositions?.includes(0)) || players[0];
            gkId = gk.id;
        }
        
        // Available players for rotation (everyone except GK)
        const availablePlayers = players.filter(p => p.id !== gkId);
        
        // Track how many intervals each player has been assigned
        const intervalsPlayed = {};
        availablePlayers.forEach(p => intervalsPlayed[p.id] = 0);
        
        // Pre-count locked intervals for each player
        for (let interval = 1; interval <= intervals; interval++) {
            for (const [slot, playerId] of lockedPerInterval[interval]) {
                if (slot !== 0 && intervalsPlayed[playerId] !== undefined) {
                    intervalsPlayed[playerId]++;
                }
            }
        }
        
        // Build lineups interval by interval
        for (let interval = 1; interval <= intervals; interval++) {
            const lineup = new Array(pitchSize).fill(null);
            const locked = lockedPerInterval[interval];
            
            // Set GK (locked or default)
            lineup[0] = locked.has(0) ? locked.get(0) : gkId;
            
            // Set all locked players in their positions
            for (const [slot, playerId] of locked) {
                lineup[slot] = playerId;
            }
            
            // Track who's already assigned this interval
            const assignedThisInterval = new Set(lineup.filter(id => id !== null));
            
            // Open slots (not locked)
            const openSlots = [];
            for (let slot = 1; slot < pitchSize; slot++) {
                if (!locked.has(slot)) {
                    openSlots.push(slot);
                }
            }
            
            // For each open slot, find best player
            for (const slot of openSlots) {
                const candidates = availablePlayers.filter(p => 
                    !assignedThisInterval.has(p.id) &&
                    p.preferredPositions?.includes(slot)
                );
                
                if (candidates.length > 0) {
                    candidates.sort((a, b) => {
                        const diff = intervalsPlayed[a.id] - intervalsPlayed[b.id];
                        return diff !== 0 ? diff : Math.random() - 0.5;
                    });
                    
                    const chosen = candidates[0];
                    lineup[slot] = chosen.id;
                    assignedThisInterval.add(chosen.id);
                }
            }
            
            // Fill remaining empty open slots
            for (const slot of openSlots) {
                if (lineup[slot] !== null) continue;
                
                const unassigned = availablePlayers
                    .filter(p => !assignedThisInterval.has(p.id))
                    .sort((a, b) => {
                        const diff = intervalsPlayed[a.id] - intervalsPlayed[b.id];
                        return diff !== 0 ? diff : Math.random() - 0.5;
                    });
                
                if (unassigned.length > 0) {
                    lineup[slot] = unassigned[0].id;
                    assignedThisInterval.add(unassigned[0].id);
                }
            }
            
            // Bench swap logic - only for open slots
            const onBench = availablePlayers.filter(p => !assignedThisInterval.has(p.id));
            const maxSwaps = Math.min(this.settings.subsPerInterval, onBench.length);
            let swapCount = 0;
            
            onBench.sort((a, b) => {
                const diff = intervalsPlayed[a.id] - intervalsPlayed[b.id];
                return diff !== 0 ? diff : Math.random() - 0.5;
            });
            
            for (const sub of onBench) {
                if (swapCount >= maxSwaps) break;
                
                const subTime = intervalsPlayed[sub.id];
                const subPrefs = sub.preferredPositions || [];
                
                for (const prefSlot of subPrefs) {
                    if (prefSlot === 0 || locked.has(prefSlot)) continue;
                    
                    const currentPlayerId = lineup[prefSlot];
                    if (!currentPlayerId) continue;
                    
                    const currentTime = intervalsPlayed[currentPlayerId];
                    
                    if (subTime < currentTime) {
                        lineup[prefSlot] = sub.id;
                        swapCount++;
                        break;
                    }
                }
            }
            
            // Update intervals played
            for (const slot of openSlots) {
                if (lineup[slot]) {
                    intervalsPlayed[lineup[slot]]++;
                }
            }
            
            this.state.intervalLineups[interval] = lineup;
        }
        
        // Show result message
        const lockedCount = lockedPlayerIds.size;
        const intervalDuration = this.settings.matchDuration / intervals;
        const outfieldSlots = pitchSize - 1;
        const totalPlayingSlots = intervals * outfieldSlots;
        const targetIntervals = totalPlayingSlots / availablePlayers.length;
        const avgMinutes = Math.round(targetIntervals * intervalDuration);
        
        const msg = lockedCount > 0 
            ? `Kept ${lockedCount} pinned · ~${avgMinutes} mins for others`
            : `~${targetIntervals.toFixed(1)} intervals · ~${avgMinutes} mins each`;
        this.showToast(msg);
        
        this.renderAll();
        this.saveState();
    }

    clearAllLineups() {
        if (!confirm('Clear all lineups?')) return;
        
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
        this.events.renderMatchEvents();
    }

    // ==================== PLAYER MANAGEMENT ====================

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
        if (!confirm('Remove this player from the squad?')) return;
        
        // Remove from all lineups
        for (let i = 1; i <= this.settings.intervalCount; i++) {
            const lineup = this.state.intervalLineups[i];
            if (lineup) {
                const idx = lineup.indexOf(playerId);
                if (idx !== -1) lineup[idx] = null;
            }
        }
        
        // Remove from live lineup
        if (this.state.liveLineup) {
            const idx = this.state.liveLineup.indexOf(playerId);
            if (idx !== -1) this.state.liveLineup[idx] = null;
        }
        
        // Remove from players array
        this.state.players = this.state.players.filter(p => p.id !== playerId);
        
        this.renderRoster();
        this.renderPitch();
        this.renderBench();
        this.renderStats();
        this.saveState();
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
}

// Initialize on DOM ready
document.addEventListener('DOMContentLoaded', () => {
    window.app = new TeamSelector();
    window.app.init();
});
