// Team Selector App - 9-a-side Football Team Management (3-4-1 Formation)

// Configuration constants
const CONFIG = {
    STORAGE_KEY: 'teamSelectorState',
    LONG_PRESS_MS: 1000,
    DRAG_THRESHOLD: 10,
    SCORING_ANIMATION_MS: 500,
    SLOTS_COUNT: 9,
    SPEEDS: [1, 10, 20],
    HAPTIC_PATTERNS: {
        GOAL_US: [100, 50, 100],
        GOAL_THEM: 100
    },
    INTERVAL_LIMITS: { MIN: 1, MAX: 6 },
    DEFAULT_MATCH_DURATION: 60
};

// String constants to avoid magic strings
const MODES = { PLAN: 'plan', LIVE: 'live' };
const TEAMS = { US: 'us', THEM: 'them' };
const LOCATIONS = { PITCH: 'pitch', BENCH: 'bench' };

// Position slot mapping (index -> position name)
const POSITIONS = {
    0: 'GK',
    1: 'LB',
    2: 'CB',
    3: 'RB',
    4: 'LW',
    5: 'LCM',
    6: 'RCM',
    7: 'RW',
    8: 'FW'
};

// Default state template
const DEFAULT_STATE = {
    mode: 'plan',
    isRunning: false,
    startTime: null,           // Timestamp when timer started
    pausedElapsedMs: 0,        // Accumulated time when paused (milliseconds)
    lastTickTime: null,        // For tracking player minute deltas
    fullTimeShown: false,      // Whether full time notification has been shown
    currentInterval: 1,
    lastAppliedSubsInterval: 0,  // Track which interval's subs have been applied
    selectedPlanInterval: 1,
    players: [],
    intervalLineups: {},
    pinnedPositions: {},       // Track manually placed positions: { interval: [slot1, slot2, ...] }
    liveLineup: null,          // Actual lineup during live match (separate from planned)
    lastIntervalTime: 0,
    scoreUs: 0,
    scoreThem: 0,
    goalHistory: [],
    matchEvents: [],
    speedMultiplier: 1
};

const DEFAULT_SETTINGS = {
    matchDuration: CONFIG.DEFAULT_MATCH_DURATION,
    intervalCount: 4,
    playersOnPitch: CONFIG.SLOTS_COUNT,
    subsPerInterval: 0  // Will be set to max bench size on first use
};

class TeamSelector {
    constructor() {
        // Initialize with defaults (will be overwritten by loadState if saved data exists)
        this.settings = { ...DEFAULT_SETTINGS };
        this.state = { ...DEFAULT_STATE };

        // Drag state
        this.dragState = {
            draggingPlayer: null,
            sourceSlot: null,
            sourceLocation: null // 'pitch' or 'bench'
        };
        this.wasDragging = false; // Prevents swipe during/after drag

        // Flag to prevent auto-fill after removal
        this.justRemovedPlayer = false;
        this.justAddedPlayer = false;
        this.removedPlayersStack = []; // Track removed players for undo (LIFO stack)

        // Quick swap: selected bench player
        this.selectedBenchPlayer = null;

        // Slot fill order: top to bottom, left to right
        // FW, LW, LCM, RCM, RW, LB, CB, RB, GK
        this.slotFillOrder = [8, 4, 5, 6, 7, 1, 2, 3, 0];

        // Timer
        this.timerInterval = null;
        this._lastDisplayedSecond = -1; // Track last rendered second for display updates
        this._removedPlayersForSub = []; // Stack of removed players for substitution recording

        // Cached DOM elements (populated in init)
        this.elements = {};

        this.init();
    }

    init() {
        // Cache DOM elements for performance
        this.cacheElements();
        
        // Dev mode: clear localStorage if ?clear is in URL
        if (window.location.search.includes('clear')) {
            localStorage.removeItem(CONFIG.STORAGE_KEY);
            // Remove ?clear from URL without reload
            history.replaceState(null, '', window.location.pathname + window.location.hash);
        }
        
        // If shared plan in URL, clear localStorage first so it takes precedence
        const hash = window.location.hash.slice(1);
        if (hash && hash.includes('p=') && hash.includes('l=')) {
            localStorage.removeItem(CONFIG.STORAGE_KEY);
        }
        
        this.loadState();
        // Check for shared plan in URL (overrides saved state)
        if (window.location.hash) {
            this.loadFromUrl();
        }
        this.initializeIntervalLineups();
        this.setupEventListeners();
        this.setupDropZones(); // Setup drop zones once
        this.setupSwipeGestures(); // Setup swipe for interval navigation
        this.render();
    }

    cacheElements() {
        this.elements = {
            bench: document.getElementById('bench'),
            statsTable: document.getElementById('stats-table'),
            statsHeading: document.getElementById('stats-heading'),
            subsSummary: document.getElementById('subs-summary'),
            eventsLog: document.getElementById('events-log'),
            scoreUs: document.getElementById('score-us'),
            scoreThem: document.getElementById('score-them'),
            currentTime: document.getElementById('current-time'),
            intervalTabs: document.getElementById('interval-tabs'),
            copyPrevBtn: document.getElementById('copy-prev-btn'), // Legacy, may be null
            playPauseBtn: document.getElementById('play-pause-btn'),
            stopBtn: document.getElementById('stop-btn'),
            planControls: document.getElementById('plan-controls'),
            liveControls: document.getElementById('live-controls'),
            sharePlanBtn: document.getElementById('share-plan-btn'),
            timerButtons: document.getElementById('timer-buttons'),
            statsSection: document.getElementById('stats-section'),
            eventsSection: document.getElementById('events-section'),
            settingsContent: document.getElementById('settings-content'),
            squadContent: document.getElementById('squad-content'),
            matchDuration: document.getElementById('match-duration'),
            intervalCount: document.getElementById('interval-count'),
            assistPicker: document.getElementById('assist-picker'),
            assistOptions: document.getElementById('assist-options'),
            hintPitch: document.getElementById('hint-pitch'),
            hintPin: document.getElementById('hint-pin'),
            hintScore: document.getElementById('hint-score'),
            pitchActions: document.getElementById('pitch-actions'),
            swipeHintLeft: document.getElementById('swipe-hint-left'),
            swipeHintRight: document.getElementById('swipe-hint-right'),
            rosterList: document.getElementById('roster-list'),
            newPlayerName: document.getElementById('new-player-name'),
            toastContainer: document.getElementById('toast-container'),
            pitch: document.getElementById('pitch'),
            subsIcon: document.getElementById('subs-icon'),
            subsBadge: document.getElementById('subs-badge')
        };
    }

    // ==================== STATE MANAGEMENT ====================

    loadState() {
        try {
            const saved = localStorage.getItem(CONFIG.STORAGE_KEY);
            if (saved) {
                const parsed = JSON.parse(saved);
                // Deep merge with defaults to handle missing properties
                this.settings = { ...DEFAULT_SETTINGS, ...parsed.settings };
                this.state = { 
                    ...DEFAULT_STATE, 
                    ...parsed.state,
                    // Ensure arrays are never undefined
                    players: parsed.state?.players || [],
                    goalHistory: parsed.state?.goalHistory || [],
                    matchEvents: parsed.state?.matchEvents || [],
                    intervalLineups: parsed.state?.intervalLineups || {}
                };
                
                // Migrate from old elapsedSeconds format to new startTime-based format
                if (parsed.state?.elapsedSeconds !== undefined && !parsed.state?.pausedElapsedMs) {
                    this.state.pausedElapsedMs = parsed.state.elapsedSeconds * 1000;
                    this.state.startTime = null;
                    this.state.lastTickTime = null;
                    this.state.isRunning = false; // Force paused state on migration
                }
                
                // Clear stale session data (onPitchSinceElapsed is runtime-only)
                this.state.players.forEach(p => p.onPitchSinceElapsed = undefined);
                // Timer shouldn't be running on page load
                this.state.isRunning = false;
                this.state.startTime = null;
                
                // Migrate: add preferredPositions to players if missing
                this.state.players.forEach((p, idx) => {
                    if (!p.preferredPositions) {
                        // Infer from interval 1 lineup or default to original position
                        const lineup = this.state.intervalLineups[1] || [];
                        const slot = lineup.indexOf(p.id);
                        if (slot >= 0) {
                            p.preferredPositions = [slot];
                        } else if (idx < 9) {
                            // Original starting player
                            p.preferredPositions = [idx];
                        } else {
                            // Sub - no specific position yet
                            p.preferredPositions = [];
                        }
                    }
                });
            }
        } catch (e) {
            console.warn('Failed to load saved state, using defaults:', e);
            localStorage.removeItem(CONFIG.STORAGE_KEY);
            this.settings = { ...DEFAULT_SETTINGS };
            this.state = { ...DEFAULT_STATE };
        }

        // Load sample players if none exist
        if (this.state.players.length === 0) {
            this.loadSamplePlayers();
        }
    }

    saveState() {
        try {
            localStorage.setItem(CONFIG.STORAGE_KEY, JSON.stringify({
                settings: this.settings,
                state: this.state
            }));
        } catch (e) {
            console.warn('Failed to save state:', e);
        }
    }

    initializeIntervalLineups() {
        // Initialize lineups for each interval if not already set or if invalid
        for (let i = 1; i <= this.settings.intervalCount; i++) {
            const lineup = this.state.intervalLineups[i];
            // Check if lineup is missing, not an array, empty, or has no valid players
            const needsInit = !lineup || 
                              !Array.isArray(lineup) || 
                              lineup.length === 0 ||
                              (i === 1 && !lineup.some(id => id !== null && this.getPlayerById(id)));
            
            if (needsInit) {
                // Start with empty pitch - players must be dragged on
                if (i === 1) {
                    this.state.intervalLineups[i] = Array(9).fill(null);
                } else {
                    this.state.intervalLineups[i] = [...this.state.intervalLineups[i - 1]];
                }
            }
        }
        this.saveState();
    }

    updateIntervalCount(newCount) {
        const oldCount = this.settings.intervalCount;
        this.settings.intervalCount = newCount;

        // Add new intervals (copy from last existing)
        if (newCount > oldCount) {
            const lastLineup = this.state.intervalLineups[oldCount] || Array(9).fill(null);
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

    loadSamplePlayers() {
        // Default lineup: GK, LB, CB, RB, LW, LCM, RCM, RW, FW
        // Slot order: 0=GK, 1=LB, 2=CB, 3=RB, 4=LW, 5=LCM, 6=RCM, 7=RW, 8=FW
        // preferredPositions: ordered array of slot indices (first = most preferred)
        const defaultSquad = [
            { name: 'Felix', number: 1, positions: [0] },           // GK only
            { name: 'Chester', number: 2, positions: [1, 3, 2] },      // LB, can play RB
            { name: 'Elliott', number: 3, positions: [2] },         // CB
            { name: 'Lucas', number: 4, positions: [3, 1] },        // RB, can play LB
            { name: 'Alfie B', number: 5, positions: [1, 3, 7, 4] },  // LB, RB           
            { name: 'Jude', number: 6, positions: [4, 7, 8, 5, 6] },   // LW, can play RW, FW, LCM, RCM
            { name: 'Jaxson', number: 7, positions: [5, 6] },       // LCM, can play RCM
            { name: 'Dylan', number: 8, positions: [6, 5, 1, 2] },        // RCM, can play LCM
            { name: 'Stuart', number: 9, positions: [4, 7, 8] },       // LW, can play RW
            { name: 'Alfie S', number: 10, positions: [7, 4] },      // RW, can play LW
            { name: 'Ollie', number: 11, positions: [8, 4] },           // FW, can play LW
            { name: 'Leo', number: 12, positions: [8, 4, 7] },      // FW, LW, RW
            { name: 'Sophie', number: 13, positions: [5, 6, 8, 7] }, // LCM, RCM, FW, RW

        ];

        defaultSquad.forEach((player, index) => {
            this.state.players.push({
                id: index + 1,
                name: player.name,
                number: player.number,
                preferredPositions: player.positions,
                minutesPlayed: 0
            });
        });

        this.saveState();
    }

    getCurrentLineup() {
        if (this.state.mode === 'plan') {
            return this.state.intervalLineups[this.state.selectedPlanInterval] || Array(9).fill(null);
        }
        // In live mode, use the actual live lineup (not planned interval lineups)
        return this.state.liveLineup || this.state.intervalLineups[1] || Array(9).fill(null);
    }

    setCurrentLineup(lineup) {
        if (this.state.mode === 'plan') {
            this.state.intervalLineups[this.state.selectedPlanInterval] = lineup;
        } else {
            // In live mode, update the actual live lineup
            this.state.liveLineup = lineup;
        }
        this.saveState();
    }

    // Pin a position as manually placed (survives auto-generate)
    pinPosition(interval, slot) {
        if (!this.state.pinnedPositions[interval]) {
            this.state.pinnedPositions[interval] = [];
        }
        if (!this.state.pinnedPositions[interval].includes(slot)) {
            this.state.pinnedPositions[interval].push(slot);
        }
    }

    // Unpin a position (when player removed)
    unpinPosition(interval, slot) {
        if (this.state.pinnedPositions[interval]) {
            this.state.pinnedPositions[interval] = this.state.pinnedPositions[interval].filter(s => s !== slot);
        }
    }

    // Check if a position is pinned
    isPositionPinned(interval, slot) {
        return this.state.pinnedPositions[interval]?.includes(slot) || false;
    }

    // Clear all pinned positions
    clearAllPins() {
        this.state.pinnedPositions = {};
    }

    // ==================== EVENT LISTENERS ====================

    setupEventListeners() {
        // Mode tabs
        document.getElementById('plan-mode-btn').addEventListener('click', () => this.setMode('plan'));
        document.getElementById('live-mode-btn').addEventListener('click', () => this.setMode('live'));

        // Settings toggle
        document.getElementById('toggle-settings').addEventListener('click', () => {
            const isVisible = this.elements.settingsContent.style.display !== 'none';
            this.elements.settingsContent.style.display = isVisible ? 'none' : 'block';
            // Close squad if opening settings
            if (!isVisible) this.elements.squadContent.style.display = 'none';
        });

        // Squad toggle
        document.getElementById('toggle-squad').addEventListener('click', () => {
            const isVisible = this.elements.squadContent.style.display !== 'none';
            this.elements.squadContent.style.display = isVisible ? 'none' : 'block';
            // Close settings if opening squad
            if (!isVisible) this.elements.settingsContent.style.display = 'none';
        });

        // Settings inputs
        this.elements.matchDuration.addEventListener('change', (e) => {
            this.settings.matchDuration = parseInt(e.target.value) || CONFIG.DEFAULT_MATCH_DURATION;
            this.updateIntervalDisplay();
            this.renderStats();
            this.saveState();
        });

        // Interval count (Plan mode) - stepper buttons
        document.getElementById('interval-dec').addEventListener('click', () => {
            const newCount = Math.max(CONFIG.INTERVAL_LIMITS.MIN, this.settings.intervalCount - 1);
            this.updateIntervalCount(newCount);
        });
        document.getElementById('interval-inc').addEventListener('click', () => {
            const newCount = Math.min(CONFIG.INTERVAL_LIMITS.MAX, this.settings.intervalCount + 1);
            this.updateIntervalCount(newCount);
        });
        
        // Subs per interval stepper
        document.getElementById('subs-dec').addEventListener('click', () => {
            const newCount = Math.max(1, this.settings.subsPerInterval - 1);
            this.updateSubsPerInterval(newCount);
        });
        document.getElementById('subs-inc').addEventListener('click', () => {
            const maxSubs = this.getMaxBenchSize();
            const newCount = Math.min(maxSubs, this.settings.subsPerInterval + 1);
            this.updateSubsPerInterval(newCount);
        });
        
        document.getElementById('auto-subs-btn').addEventListener('click', () => this.autoGenerateSubs());
        document.getElementById('clear-team-btn').addEventListener('click', () => this.clearTeam());
        
        // Subs icon - tap to show popup, hold to apply subs
        if (this.elements.subsIcon) {
            let holdTimer = null;
            let didHold = false;
            
            this.elements.subsIcon.addEventListener('touchstart', (e) => {
                didHold = false;
                holdTimer = setTimeout(() => {
                    didHold = true;
                    this.applyPlannedSubs();
                }, CONFIG.LONG_PRESS_MS);
            });
            
            this.elements.subsIcon.addEventListener('touchend', (e) => {
                clearTimeout(holdTimer);
                if (!didHold) {
                    this.showSubsPopup();
                }
            });
            
            this.elements.subsIcon.addEventListener('touchcancel', () => {
                clearTimeout(holdTimer);
            });
            
            // Mouse fallback for desktop
            this.elements.subsIcon.addEventListener('mousedown', (e) => {
                didHold = false;
                holdTimer = setTimeout(() => {
                    didHold = true;
                    this.applyPlannedSubs();
                }, CONFIG.LONG_PRESS_MS);
            });
            
            this.elements.subsIcon.addEventListener('mouseup', (e) => {
                clearTimeout(holdTimer);
                if (!didHold) {
                    this.showSubsPopup();
                }
            });
            
            this.elements.subsIcon.addEventListener('mouseleave', () => {
                clearTimeout(holdTimer);
            });
        }

        // Timer controls
        this.elements.playPauseBtn.addEventListener('click', () => this.toggleTimer());
        this.elements.stopBtn.addEventListener('click', () => this.stopMatch());
        document.getElementById('reset-match').addEventListener('click', () => this.resetMatch());

        // Score controls - tap Them score to increment
        document.getElementById('score-them-team').addEventListener('click', () => this.recordGoal(null, 'them'));
        document.getElementById('no-assist-btn').addEventListener('click', () => this.skipAssist());

        // Speed toggle for testing (tap timer display)
        document.querySelector('.timer-display').addEventListener('click', () => this.toggleSpeed());

        // Add player
        document.getElementById('add-player-btn').addEventListener('click', () => this.addPlayer());
        document.getElementById('new-player-name').addEventListener('keypress', (e) => {
            if (e.key === 'Enter') this.addPlayer();
        });

        // Share plan button
        this.elements.sharePlanBtn.addEventListener('click', () => this.sharePlan());

        // Copy from previous interval button
        // Copy from previous interval button (removed - now using drag between tabs)
        // this.elements.copyPrevBtn.addEventListener('click', () => this.copyFromPreviousInterval());

        // Tap to dismiss live hints
        this.elements.hintPitch?.addEventListener('click', () => {
            this.elements.hintPitch.classList.add('hidden');
        });
        this.elements.hintScore?.addEventListener('click', () => {
            this.elements.hintScore.classList.add('hidden');
        });
        this.elements.hintPin?.addEventListener('click', () => {
            this.elements.hintPin.classList.add('hidden');
        });

        // Handle device wake from sleep - update timer immediately
        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'visible' && this.state.isRunning) {
                this.updateTimerDisplay();
                this.checkIntervalChange();
            }
        });

        // Swipe left/right to switch between Plan and Live modes
        this.setupSwipeToSwitchMode();

        // Set initial values
        this.elements.matchDuration.value = this.settings.matchDuration;
        this.elements.intervalCount.textContent = this.settings.intervalCount;
        this.updateSubsDisplay();
    }

    setupSwipeToSwitchMode() {
        let touchStartX = 0;
        let touchStartY = 0;
        let touchStartTime = 0;
        
        const container = document.getElementById('app');
        if (!container) return;
        
        container.addEventListener('touchstart', (e) => {
            // Ignore if touching a player card or the pitch (let other handlers manage those)
            if (e.target.closest('.player-card') || e.target.closest('.pitch-container')) return;
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
            
            if (deltaX < 0 && this.state.mode === 'plan') {
                // Swipe left: Plan → Live
                this.setMode('live');
            } else if (deltaX > 0 && this.state.mode === 'live') {
                // Swipe right: Live → Plan
                this.setMode('plan');
            }
        }, { passive: true });
    }
    
    // Get max possible bench size based on current players
    getMaxBenchSize() {
        const gk = this.state.players.find(p => p.preferredPositions?.includes(0)) || this.state.players[0];
        const outfieldCount = gk ? this.state.players.length - 1 : this.state.players.length;
        return Math.max(0, outfieldCount - (CONFIG.SLOTS_COUNT - 1));
    }
    
    // Update subs per interval setting
    updateSubsPerInterval(newCount) {
        this.settings.subsPerInterval = newCount;
        this.updateSubsDisplay();
        this.saveState();
    }
    
    // Update the subs display
    updateSubsDisplay() {
        const maxSubs = this.getMaxBenchSize();
        // Initialize to max if unset (0) or clamp if exceeds current max
        if (this.settings.subsPerInterval === 0 || this.settings.subsPerInterval > maxSubs) {
            this.settings.subsPerInterval = maxSubs;
        }
        // Ensure at least 1 if there's a bench
        if (maxSubs > 0 && this.settings.subsPerInterval < 1) {
            this.settings.subsPerInterval = 1;
        }
        const subsEl = document.getElementById('subs-count');
        if (subsEl) {
            subsEl.textContent = this.settings.subsPerInterval;
        }
    }

    // ==================== SCORE TRACKING ====================

    recordGoal(playerId, team = 'us') {
        // For 'them' goals or unassigned goals, record immediately without assist
        if (team === 'them' || !playerId) {
            this.finalizeGoal(playerId, null, team);
            return;
        }
        
        // For 'us' goals with a scorer, show assist picker
        this.pendingGoal = { scorerId: playerId, team: team };
        this.showAssistPicker(playerId);
    }

    showAssistPicker(scorerId) {
        const overlay = document.getElementById('assist-picker');
        const optionsContainer = document.getElementById('assist-options');
        optionsContainer.innerHTML = '';
        
        // Get current pitch players (excluding the scorer), sorted by number descending
        const lineup = this.getCurrentLineup();
        const players = lineup
            .filter(playerId => playerId && playerId !== scorerId)
            .map(playerId => this.getPlayerById(playerId))
            .filter(p => p)
            .sort((a, b) => b.number - a.number);
        
        players.forEach(player => {
            const btn = document.createElement('button');
            btn.className = 'btn assist-player-btn';
            btn.innerHTML = `<span class="assist-number">${player.number}</span> ${player.name}`;
            btn.addEventListener('click', () => this.selectAssist(player.id));
            optionsContainer.appendChild(btn);
        });
        
        // Disable pointer events briefly to prevent accidental selection on finger lift
        overlay.style.pointerEvents = 'none';
        overlay.classList.add('no-touch');
        overlay.style.display = 'flex';
        setTimeout(() => {
            overlay.style.pointerEvents = 'auto';
            overlay.classList.remove('no-touch');
        }, 500);
    }

    selectAssist(assistPlayerId) {
        if (this.pendingGoal) {
            this.finalizeGoal(this.pendingGoal.scorerId, assistPlayerId, this.pendingGoal.team);
            this.pendingGoal = null;
        }
        document.getElementById('assist-picker').style.display = 'none';
    }

    skipAssist() {
        if (this.pendingGoal) {
            this.finalizeGoal(this.pendingGoal.scorerId, null, this.pendingGoal.team);
            this.pendingGoal = null;
        }
        this.elements.assistPicker.style.display = 'none';
    }

    // Helper: Trigger haptic feedback for goals
    triggerGoalHaptic(team) {
        if ('vibrate' in navigator) {
            const pattern = team === 'us' 
                ? CONFIG.HAPTIC_PATTERNS.GOAL_US 
                : CONFIG.HAPTIC_PATTERNS.GOAL_THEM;
            navigator.vibrate(pattern);
        }
    }

    // Helper: Show scoring animation on element
    showScoringAnimation(element) {
        element.classList.add('scoring');
        setTimeout(() => element.classList.remove('scoring'), CONFIG.SCORING_ANIMATION_MS);
    }

    // Helper: Show toast notification
    showToast(message, type = 'default', duration = 2000, undoCallback = null) {
        const toast = document.createElement('div');
        toast.className = `toast ${type === 'success' ? 'toast-success' : ''}`;
        
        const messageSpan = document.createElement('span');
        messageSpan.textContent = message;
        toast.appendChild(messageSpan);
        
        // Add undo button if callback provided
        if (undoCallback) {
            const undoBtn = document.createElement('button');
            undoBtn.className = 'toast-undo';
            undoBtn.textContent = 'Undo';
            undoBtn.addEventListener('click', () => {
                undoCallback();
                toast.remove();
            });
            toast.appendChild(undoBtn);
            duration = 5000; // Extend duration for undo toasts
        }
        
        this.elements.toastContainer.appendChild(toast);
        
        setTimeout(() => {
            toast.classList.add('toast-out');
            setTimeout(() => toast.remove(), 300);
        }, duration);
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
            if (this.state.mode !== 'plan') return;
            // Don't trigger swipe if we're dragging or just finished dragging a player
            if (this.dragState.draggingPlayer || this.wasDragging) return;
            
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
                    this.selectPlanInterval(this.state.selectedPlanInterval + 1);
                    this.showToast(`Interval ${this.state.selectedPlanInterval}`);
                } else if (dx > 0 && this.state.selectedPlanInterval > 1) {
                    // Swipe right - previous interval
                    this.selectPlanInterval(this.state.selectedPlanInterval - 1);
                    this.showToast(`Interval ${this.state.selectedPlanInterval}`);
                }
            }
        }, { passive: true });
    }

    // Helper: Clear bench player selection
    clearBenchSelection() {
        if (this.selectedBenchPlayer) {
            const oldSelected = document.querySelector('.player-card.selected-for-swap');
            if (oldSelected) oldSelected.classList.remove('selected-for-swap');
            this.selectedBenchPlayer = null;
        }
    }

    finalizeGoal(playerId, assistPlayerId, team) {
        // Capture time once to ensure consistency between goalHistory and matchEvents
        const goalTime = this.getElapsedSeconds();
        
        if (team === 'us') {
            this.state.scoreUs++;
        } else {
            this.state.scoreThem++;
        }
        
        this.triggerGoalHaptic(team);
        
        this.state.goalHistory.push({
            playerId: playerId,
            assistPlayerId: assistPlayerId,
            time: goalTime,
            team: team
        });

        // Track goal for player
        let scorerName = team === 'them' ? 'Opponent' : 'Unknown';
        if (playerId) {
            const player = this.getPlayerById(playerId);
            if (player) {
                player.goals = (player.goals || 0) + 1;
                scorerName = player.name;
            }
        }

        // Track assist for player
        let assistName = null;
        if (assistPlayerId) {
            const assister = this.getPlayerById(assistPlayerId);
            if (assister) {
                assister.assists = (assister.assists || 0) + 1;
                assistName = assister.name;
            }
        }

        // Add to match events
        this.state.matchEvents.push({
            type: 'goal',
            time: goalTime,
            team: team,
            scorer: scorerName,
            assist: assistName,
            score: `${this.state.scoreUs} - ${this.state.scoreThem}`
        });

        // Show toast notification with undo option
        const goalText = team === 'us' 
            ? `⚽ Goal! ${scorerName}${assistName ? ` (assist: ${assistName})` : ''}`
            : `🔴 Goal - Opponent`;
        this.showToast(goalText, 'success', 2000, () => this.undoLastGoal());

        this.updateScoreDisplay();
        this.renderMatchEvents();
        this.renderPitch();
        this.renderBench();
        this.saveState();
    }

    undoLastGoal() {
        if (this.state.goalHistory.length === 0) return;
        
        const lastGoal = this.state.goalHistory.pop();
        
        if (lastGoal.team === 'us') {
            this.state.scoreUs = Math.max(0, this.state.scoreUs - 1);
        } else {
            this.state.scoreThem = Math.max(0, this.state.scoreThem - 1);
        }

        // Remove goal from player
        if (lastGoal.playerId) {
            const player = this.getPlayerById(lastGoal.playerId);
            if (player && player.goals > 0) {
                player.goals--;
            }
        }

        // Remove assist from player
        if (lastGoal.assistPlayerId) {
            const assister = this.getPlayerById(lastGoal.assistPlayerId);
            if (assister && assister.assists > 0) {
                assister.assists--;
            }
        }

        // Remove last goal event from match events
        for (let i = this.state.matchEvents.length - 1; i >= 0; i--) {
            if (this.state.matchEvents[i].type === 'goal') {
                this.state.matchEvents.splice(i, 1);
                break;
            }
        }

        this.updateScoreDisplay();
        this.renderMatchEvents();
        this.renderPitch();
        this.renderBench();
        this.saveState();
    }

    updateScoreDisplay() {
        this.elements.scoreUs.textContent = this.state.scoreUs;
        this.elements.scoreThem.textContent = this.state.scoreThem;
    }

    // ==================== TIMER FUNCTIONS ====================

    toggleSpeed() {
        // When changing speed, we need to recalculate pausedElapsedMs based on current speed
        // then apply the new speed going forward
        if (this.state.isRunning) {
            const now = Date.now();
            const runningMs = (now - this.state.startTime) * this.state.speedMultiplier;
            this.state.pausedElapsedMs += runningMs;
            this.state.startTime = now;
        }
        
        const currentIndex = CONFIG.SPEEDS.indexOf(this.state.speedMultiplier);
        this.state.speedMultiplier = CONFIG.SPEEDS[(currentIndex + 1) % CONFIG.SPEEDS.length];
        
        this.updateTimerDisplay();
        this.saveState();
    }

    // Calculate elapsed seconds based on start time (handles device sleep)
    getElapsedSeconds() {
        if (!this.state.isRunning) {
            return Math.floor(this.state.pausedElapsedMs / 1000);
        }
        const now = Date.now();
        const runningMs = (now - this.state.startTime) * this.state.speedMultiplier;
        return Math.floor((this.state.pausedElapsedMs + runningMs) / 1000);
    }

    startTimerInterval() {
        // Update display frequently - time is calculated from startTime, not incremented
        this.timerInterval = setInterval(() => {
            const elapsed = this.getElapsedSeconds();
            
            this.updateTimerDisplay();
            this.updatePlayerMinutes();
            this.checkIntervalChange();
            // Save state periodically (every ~10 seconds of game time)
            if (elapsed % 10 === 0) {
                this.saveState();
            }
        }, 200); // Update every 200ms for responsive display
    }

    toggleTimer() {
        if (this.state.isRunning) {
            this.pauseTimer();
        } else {
            this.startTimer();
        }
    }

    startTimer() {
        if (this.state.isRunning) return;

        this.state.isRunning = true;
        this.state.startTime = Date.now();
        this.state.lastTickTime = Date.now();
        this.elements.playPauseBtn.textContent = '⏸';
        this.elements.playPauseBtn.classList.remove('btn-primary');
        this.elements.playPauseBtn.classList.add('btn-secondary');

        // Set onPitchSinceElapsed for all players currently on pitch
        const currentElapsed = this.getElapsedSeconds();
        const lineup = this.getCurrentLineup();
        lineup.forEach(playerId => {
            if (playerId !== null) {
                const player = this.getPlayerById(playerId);
                if (player && player.onPitchSinceElapsed === undefined) {
                    player.onPitchSinceElapsed = currentElapsed;
                }
            }
        });

        this.startTimerInterval();
        this.saveState();
    }

    pauseTimer() {
        if (!this.state.isRunning) return;

        // Finalize minutes for all players on pitch before pausing
        this.finalizeAllOnPitchMinutes();

        // Accumulate elapsed time before pausing
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
        this.saveState();
    }

    stopMatch() {
        // First pause if running
        if (this.state.isRunning) {
            this.pauseTimer();
        }
        
        // Show confirmation with final score
        const finalScore = `${this.state.scoreUs} - ${this.state.scoreThem}`;
        this.showToast(`Full time! Final score: ${finalScore}`, 'success', 3000);
        
        // Disable the play/pause button to prevent restarting
        this.elements.playPauseBtn.disabled = true;
        this.elements.playPauseBtn.textContent = '✓';
        this.elements.stopBtn.disabled = true;
        
        this.saveState();
    }

    // Finalize minutes for all players currently on pitch
    finalizeAllOnPitchMinutes() {
        // Cap elapsed time at match duration to avoid over-counting
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

    // Finalize minutes for a specific player coming off pitch
    finalizePlayerMinutes(playerId) {
        if (this.state.mode !== 'live' || !this.state.isRunning) return;
        const player = this.getPlayerById(playerId);
        if (player && player.onPitchSinceElapsed !== undefined) {
            const currentElapsed = this.getElapsedSeconds();
            player.minutesPlayed += (currentElapsed - player.onPitchSinceElapsed) / 60;
            player.onPitchSinceElapsed = undefined;
        }
    }

    // Start tracking minutes for a player coming onto pitch
    startPlayerMinutes(playerId) {
        if (this.state.mode !== 'live') return;
        const player = this.getPlayerById(playerId);
        if (player) {
            player.onPitchSinceElapsed = this.getElapsedSeconds();
        }
    }

    // Get current minutes for a player (including live session if on pitch)
    getPlayerCurrentMinutes(playerId) {
        const player = this.getPlayerById(playerId);
        if (!player) return 0;
        
        let minutes = player.minutesPlayed || 0;
        
        // Add current session time if on pitch with timer running
        // Check isPlayerOnPitch to avoid stale onPitchSinceElapsed values
        if (this.state.isRunning && player.onPitchSinceElapsed !== undefined && this.isPlayerOnPitch(playerId)) {
            const currentElapsed = this.getElapsedSeconds();
            minutes += (currentElapsed - player.onPitchSinceElapsed) / 60;
        }
        
        return minutes;
    }

    // Cached calculation for match duration in seconds
    get matchDurationSeconds() {
        return this.settings.matchDuration * 60;
    }

    // Format event time with stoppage time notation (e.g., "60+2'" for 62 minutes in a 60-minute match)
    formatEventTime(seconds) {
        const matchDurationMinutes = this.settings.matchDuration;
        const eventMinutes = Math.floor(seconds / 60);
        
        if (eventMinutes > matchDurationMinutes) {
            const extraMinutes = eventMinutes - matchDurationMinutes;
            return `${matchDurationMinutes}+${extraMinutes}'`;
        }
        return `${eventMinutes}'`;
    }

    // Helper: Record a substitution event
    recordSubstitution(playerInId, playerOutId) {
        if (this.state.mode !== MODES.LIVE) return;
        const playerIn = this.getPlayerById(playerInId);
        const playerOut = this.getPlayerById(playerOutId);
        if (!playerIn || !playerOut) return;
        
        this.state.matchEvents.push({
            type: 'sub',
            time: this.getElapsedSeconds(),
            playerIn: playerIn.name,
            playerOut: playerOut.name
        });
        this.renderMatchEvents();
    }

    // ==================== MODE SWITCHING ====================

    setMode(mode) {
        this.state.mode = mode;
        
        // Update UI
        document.getElementById('plan-mode-btn').classList.toggle('active', mode === 'plan');
        document.getElementById('live-mode-btn').classList.toggle('active', mode === 'live');
        this.elements.planControls.style.display = mode === 'plan' ? 'block' : 'none';
        this.elements.liveControls.style.display = mode === 'live' ? 'block' : 'none';
        this.elements.sharePlanBtn.style.display = mode === 'plan' ? 'inline-block' : 'none';
        this.elements.timerButtons.style.display = mode === 'live' ? 'flex' : 'none';
        
        // Show swipe hints in plan mode, live hints in live mode
        if (mode === 'plan') {
            this.elements.pitchActions?.classList.remove('hidden');
            this.elements.subsIcon?.classList.remove('visible');
            this.elements.swipeHintLeft?.classList.remove('hidden');
            this.elements.swipeHintRight?.classList.remove('hidden');
            this.elements.hintPin?.classList.remove('hidden');
            this.elements.hintPitch?.classList.add('hidden');
            this.elements.hintScore?.classList.add('hidden');
            setTimeout(() => {
                this.elements.swipeHintLeft?.classList.add('hidden');
                this.elements.swipeHintRight?.classList.add('hidden');
                this.elements.hintPin?.classList.add('hidden');
            }, 5000);
        } else {
            this.elements.pitchActions?.classList.add('hidden');
            // Show subs icon in live mode
            this.elements.subsIcon?.classList.add('visible');
            // Initialize/refresh live lineup from interval 1 if match hasn't started
            const matchNotStarted = !this.state.startTime && this.state.pausedElapsedMs === 0;
            if (!this.state.liveLineup || matchNotStarted) {
                this.state.liveLineup = [...(this.state.intervalLineups[1] || Array(9).fill(null))];
            }
            // Update badge AFTER liveLineup is initialized
            this.updateSubsIconBadge();
            this.elements.swipeHintLeft?.classList.add('hidden');
            this.elements.swipeHintRight?.classList.add('hidden');
            this.elements.hintPin?.classList.add('hidden');
            this.elements.hintPitch?.classList.remove('hidden');
            this.elements.hintScore?.classList.remove('hidden');
            setTimeout(() => {
                this.elements.hintPitch?.classList.add('hidden');
                this.elements.hintScore?.classList.add('hidden');
            }, 4000);
        }
        
        // Toggle stats vs events section
        this.elements.statsSection.style.display = mode === 'plan' ? 'block' : 'none';
        this.elements.eventsSection.style.display = mode === 'live' ? 'block' : 'none';
        
        this.clearBenchSelection();
        this.renderPitch();
        this.renderBench();
        if (mode === 'live') {
            this.renderMatchEvents();
        } else {
            this.renderStats();
        }
        this.saveState();
    }

    selectPlanInterval(interval) {
        this.state.selectedPlanInterval = interval;
        this.clearBenchSelection();
        this.renderIntervalTabs();
        this.renderPitch();
        this.renderBench();
        this.saveState();
    }

    copyFromPreviousInterval() {
        const current = this.state.selectedPlanInterval;
        if (current > 1) {
            this.copyLineupFromTo(current - 1, current);
        }
    }

    // Copy lineup from one interval to another
    copyLineupFromTo(fromInterval, toInterval) {
        if (fromInterval === toInterval) return;
        if (!this.state.intervalLineups[fromInterval]) return;
        
        this.state.intervalLineups[toInterval] = [...this.state.intervalLineups[fromInterval]];
        this.showToast(`Copied interval ${fromInterval} → ${toInterval}`);
        this.renderPitch();
        this.renderBench();
        this.renderStats();
        this.saveState();
    }

    // Clear all lineups across all intervals
    clearTeam() {
        for (let i = 1; i <= this.settings.intervalCount; i++) {
            this.state.intervalLineups[i] = Array(CONFIG.SLOTS_COUNT).fill(null);
        }
        this.clearAllPins();
        this.showToast('Team cleared');
        this.renderPitch();
        this.renderBench();
        this.renderStats();
        this.saveState();
    }

    /**
     * Auto-generate substitution plan to distribute playtime fairly.
     * Preserves any manually placed players in their positions.
     * Algorithm:
     * 1. Save existing placements (locked positions)
     * 2. For each interval, fill empty positions with players preferring that position
     *    - If multiple players want same position, pick one with least game time
     * 3. After filling, check bench players - swap in if they have less time than starter
     *    (only for non-locked positions)
     */
    autoGenerateSubs() {
        const players = this.state.players;
        const intervals = this.settings.intervalCount;
        const pitchSize = CONFIG.SLOTS_COUNT; // 9
        
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
        
        // Build locked positions from pinnedPositions (not from all filled positions)
        const lockedPerInterval = {}; // interval -> Map<slot, playerId>
        const lockedPlayerIds = new Set(); // all players locked in at least one interval
        
        for (let interval = 1; interval <= intervals; interval++) {
            lockedPerInterval[interval] = new Map();
            const pinnedSlots = this.state.pinnedPositions[interval] || [];
            for (const slot of pinnedSlots) {
                const playerId = existingLineups[interval][slot];
                if (playerId !== null) {
                    lockedPerInterval[interval].set(slot, playerId);
                    lockedPlayerIds.add(playerId);
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
            
            // Bench swap logic - only for open slots (can't swap out locked players)
            const onPitchOpen = new Set(openSlots.map(s => lineup[s]).filter(id => id !== null));
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
                    if (prefSlot === 0 || locked.has(prefSlot)) continue; // Skip GK and locked slots
                    
                    const currentPlayerId = lineup[prefSlot];
                    if (!currentPlayerId) continue;
                    
                    const currentTime = intervalsPlayed[currentPlayerId];
                    
                    if (subTime < currentTime) {
                        lineup[prefSlot] = sub.id;
                        onPitchOpen.delete(currentPlayerId);
                        onPitchOpen.add(sub.id);
                        swapCount++;
                        break;
                    }
                }
            }
            
            // Update intervals played (only for slots we filled, not pre-counted locked ones)
            for (const slot of openSlots) {
                if (lineup[slot]) {
                    intervalsPlayed[lineup[slot]]++;
                }
            }
            
            this.state.intervalLineups[interval] = lineup;
        }
        
        // Calculate stats message
        const lockedCount = lockedPlayerIds.size;
        const intervalDuration = this.settings.matchDuration / intervals;
        const outfieldSlots = pitchSize - 1;
        const totalPlayingSlots = intervals * outfieldSlots;
        const targetIntervals = totalPlayingSlots / availablePlayers.length;
        const avgMinutes = Math.round(targetIntervals * intervalDuration);
        
        const msg = lockedCount > 0 
            ? `Kept ${lockedCount} placed · ~${avgMinutes} mins for others`
            : `~${targetIntervals.toFixed(1)} intervals · ~${avgMinutes} mins each`;
        this.showToast(msg);
        
        this.renderAll();
        this.saveState();
    }

    renderAll() {
        this.renderIntervalTabs();
        this.renderPitch();
        this.renderBench();
        this.renderStats();
        this.renderMatchEvents();
    }

    updateTimerDisplay() {
        const totalSeconds = this.getElapsedSeconds();
        const matchDurationSecs = this.matchDurationSeconds;
        
        // Show stoppage time format after match duration
        if (totalSeconds > matchDurationSecs) {
            const matchMinutes = this.settings.matchDuration;
            const extraSeconds = totalSeconds - matchDurationSecs;
            const extraMins = Math.floor(extraSeconds / 60);
            const speedStr = this.state.speedMultiplier > 1 ? ` (${this.state.speedMultiplier}x)` : '';
            this.elements.currentTime.textContent = `${matchMinutes}+${extraMins}${speedStr}`;
            this.elements.currentTime.classList.add('overtime');
        } else {
            const minutes = Math.floor(totalSeconds / 60);
            const seconds = totalSeconds % 60;
            const timeStr = `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
            const speedStr = this.state.speedMultiplier > 1 ? ` (${this.state.speedMultiplier}x)` : '';
            this.elements.currentTime.textContent = timeStr + speedStr;
            this.elements.currentTime.classList.remove('overtime');
        }
    }

    updateIntervalDisplay() {
        // Only update if elements exist (plan mode uses tabs instead)
        const currentEl = document.getElementById('current-interval');
        const totalEl = document.getElementById('total-intervals');
        if (currentEl) currentEl.textContent = this.state.currentInterval;
        if (totalEl) totalEl.textContent = this.settings.intervalCount;
    }

    checkIntervalChange() {
        const intervalDuration = (this.settings.matchDuration * 60) / this.settings.intervalCount;
        const expectedInterval = Math.floor(this.getElapsedSeconds() / intervalDuration) + 1;
        
        if (expectedInterval > this.state.currentInterval && 
            this.state.currentInterval < this.settings.intervalCount) {
            this.triggerIntervalChange(expectedInterval);
        }
    }

    triggerIntervalChange(newInterval) {
        this.state.currentInterval = newInterval;
        this.updateIntervalDisplay();
        // Update subs icon badge to show pending subs
        this.updateSubsIconBadge();
        this.renderPitch();
        this.renderBench();
        this.saveState();
    }

    nextInterval() {
        if (this.state.currentInterval < this.settings.intervalCount) {
            this.triggerIntervalChange(this.state.currentInterval + 1);
        }
    }

    showIntervalNotification() {
        // Compare current live lineup with planned lineup for this interval
        const liveLineup = this.state.liveLineup || [];
        const plannedLineup = this.state.intervalLineups[this.state.currentInterval] || [];
        
        // Find players who should come on and go off according to plan
        const playersOn = [];
        const playersOff = [];
        
        for (let i = 0; i < CONFIG.SLOTS_COUNT; i++) {
            const livePlayer = liveLineup[i];
            const plannedPlayer = plannedLineup[i];
            
            if (livePlayer !== plannedPlayer) {
                if (plannedPlayer && !liveLineup.includes(plannedPlayer)) {
                    playersOn.push(this.getPlayerById(plannedPlayer)?.name || 'Unknown');
                }
                if (livePlayer && !plannedLineup.includes(livePlayer)) {
                    playersOff.push(this.getPlayerById(livePlayer)?.name || 'Unknown');
                }
            }
        }
        
        const hasChanges = playersOn.length > 0 || playersOff.length > 0;
        const subsCount = Math.max(playersOn.length, playersOff.length);
        
        // Remove any existing banner/pill
        document.querySelector('.interval-banner')?.remove();
        document.querySelector('.interval-indicator-pill')?.remove();
        
        // Build substitutions HTML
        let subsHtml = '';
        if (!hasChanges) {
            subsHtml = '<p class="no-changes">No substitutions planned</p>';
        } else {
            const maxLen = Math.max(playersOn.length, playersOff.length);
            subsHtml = '<div class="subs-list">';
            for (let i = 0; i < maxLen; i++) {
                const on = playersOn[i] || '';
                const off = playersOff[i] || '';
                if (on && off) {
                    subsHtml += `<div class="sub-row"><span class="player-off">⬇️ ${off}</span><span class="player-on">⬆️ ${on}</span></div>`;
                } else if (on) {
                    subsHtml += `<div class="sub-row"><span class="player-on">⬆️ ${on}</span></div>`;
                } else if (off) {
                    subsHtml += `<div class="sub-row"><span class="player-off">⬇️ ${off}</span></div>`;
                }
            }
            subsHtml += '</div>';
        }
        
        // Create collapsible banner
        const banner = document.createElement('div');
        banner.className = 'interval-banner';
        banner.innerHTML = `
            <div class="interval-banner-header">
                <div>
                    <div class="interval-banner-title">🔄 Interval ${this.state.currentInterval}</div>
                    <div class="interval-banner-subtitle">Planned substitutions</div>
                </div>
            </div>
            ${subsHtml}
            <div class="interval-banner-buttons">
                ${hasChanges ? '<button class="apply-btn">Apply</button>' : ''}
                <button class="dismiss-btn">${hasChanges ? 'Skip' : 'OK'}</button>
            </div>
        `;
        document.body.appendChild(banner);
        
        // Create minimized pill indicator
        const pill = document.createElement('div');
        pill.className = 'interval-indicator-pill';
        pill.textContent = hasChanges ? `${subsCount} sub${subsCount > 1 ? 's' : ''} pending` : 'No subs';
        document.body.appendChild(pill);
        
        let minimizeTimeout = null;
        
        const minimize = () => {
            banner.classList.add('minimized');
            if (hasChanges) {
                pill.classList.add('visible');
            }
        };
        
        const expand = () => {
            banner.classList.remove('minimized');
            pill.classList.remove('visible');
            // Reset auto-minimize timer
            clearTimeout(minimizeTimeout);
            minimizeTimeout = setTimeout(minimize, 6000);
        };
        
        const dismiss = () => {
            clearTimeout(minimizeTimeout);
            banner.remove();
            pill.remove();
        };
        
        // Auto-minimize after 6 seconds
        minimizeTimeout = setTimeout(minimize, 6000);
        
        // Pill click expands banner
        pill.addEventListener('click', expand);
        
        // Apply planned subs
        if (hasChanges) {
            banner.querySelector('.apply-btn').addEventListener('click', () => {
                this.applyPlannedSubs();
                dismiss();
            });
        }
        
        // Dismiss button
        banner.querySelector('.dismiss-btn').addEventListener('click', dismiss);
    }
    
    // Get planned subs for the next interval
    getNextIntervalSubs() {
        // Use the next interval that hasn't been applied yet
        const nextInterval = (this.state.lastAppliedSubsInterval || 1) + 1;
        if (nextInterval > this.settings.intervalCount) {
            return { playersOn: [], playersOff: [], nextInterval: null, subsCount: 0 };
        }
        
        // Find the planned changes for this interval
        const allChanges = this.getIntervalChanges();
        const change = allChanges.find(c => c.interval === nextInterval);
        
        if (!change) {
            return { playersOn: [], playersOff: [], nextInterval, subsCount: 0 };
        }
        
        return {
            playersOn: change.on.map(p => p.name),
            playersOff: change.off.map(p => p.name),
            nextInterval,
            subsCount: change.on.length
        };
    }
    
    // Update the subs icon badge count
    updateSubsIconBadge() {
        if (!this.elements.subsBadge || !this.elements.subsIcon) return;
        
        const { subsCount, nextInterval } = this.getNextIntervalSubs();
        
        // Show/hide badge based on pending subs count
        if (subsCount > 0 && nextInterval) {
            this.elements.subsBadge.textContent = subsCount;
            this.elements.subsBadge.classList.add('visible');
        } else {
            this.elements.subsBadge.classList.remove('visible');
        }
    }
    
    // Show the subs popup
    showSubsPopup() {
        // Remove any existing popup
        document.querySelector('.subs-popup')?.remove();
        document.querySelector('.subs-popup-overlay')?.remove();
        
        // Get all interval changes (including past ones for reference)
        const allChanges = this.getIntervalChanges();
        
        if (allChanges.length === 0) {
            // No changes - show simple message
            const overlay = document.createElement('div');
            overlay.className = 'subs-popup-overlay';
            document.body.appendChild(overlay);
            
            const popup = document.createElement('div');
            popup.className = 'subs-popup';
            popup.innerHTML = '<p class="no-changes">No substitutions planned</p>';
            
            const pitchContainer = document.querySelector('.pitch-container');
            pitchContainer.appendChild(popup);
            
            overlay.addEventListener('click', () => {
                popup.remove();
                overlay.remove();
            });
            return;
        }
        
        // Find the default slide (first upcoming interval that hasn't been applied)
        const nextUnapplied = (this.state.lastAppliedSubsInterval || 1) + 1;
        let defaultIndex = allChanges.findIndex(c => c.interval >= nextUnapplied);
        if (defaultIndex === -1) defaultIndex = allChanges.length - 1;
        
        const intervalDurationMins = Math.round(this.settings.matchDuration / this.settings.intervalCount);
        
        // Build slides for each interval
        const slidesHtml = allChanges.map((c, idx) => {
            const timeStr = `${(c.interval - 1) * intervalDurationMins}'`;
            const maxLen = Math.max(c.on.length, c.off.length);
            const isPast = c.interval <= (this.state.lastAppliedSubsInterval || 0);
            
            let pairsHtml = '';
            for (let i = 0; i < maxLen; i++) {
                const on = c.on[i]?.name || '';
                const off = c.off[i]?.name || '';
                if (on || off) {
                    pairsHtml += `<div class="sub-pair">`;
                    if (on) pairsHtml += `<span class="sub-in">↑ ${on}</span>`;
                    if (off) pairsHtml += `<span class="sub-out">↓ ${off}</span>`;
                    pairsHtml += `</div>`;
                }
            }
            
            return `
                <div class="subs-slide ${idx === defaultIndex ? 'active' : ''}" data-index="${idx}">
                    <div class="sub-change match-event event-sub ${isPast ? 'past' : ''}">
                        <span class="event-time">${timeStr}</span>
                        <span class="event-icon">🔄</span>
                        <span class="event-detail event-detail-subs">
                            ${pairsHtml}
                        </span>
                    </div>
                </div>
            `;
        }).join('');
        
        // Build dots if more than one slide
        const dotsHtml = allChanges.length > 1 
            ? `<div class="subs-dots">${allChanges.map((c, idx) => {
                const isPast = c.interval <= (this.state.lastAppliedSubsInterval || 0);
                return `<span class="subs-dot ${idx === defaultIndex ? 'active' : ''} ${isPast ? 'past' : ''}" data-index="${idx}"></span>`;
              }).join('')}</div>` 
            : '';
        
        // Create overlay to close on outside click
        const overlay = document.createElement('div');
        overlay.className = 'subs-popup-overlay';
        document.body.appendChild(overlay);
        
        // Create popup
        const popup = document.createElement('div');
        popup.className = 'subs-popup';
        popup.innerHTML = `
            <div class="subs-slider">
                ${slidesHtml}
            </div>
            ${dotsHtml}
        `;
        
        // Position relative to pitch container
        const pitchContainer = document.querySelector('.pitch-container');
        pitchContainer.appendChild(popup);
        
        // Swipe functionality
        if (allChanges.length > 1) {
            let currentSlide = defaultIndex;
            let startX = 0;
            let isDragging = false;
            
            const slider = popup.querySelector('.subs-slider');
            const slides = popup.querySelectorAll('.subs-slide');
            const dots = popup.querySelectorAll('.subs-dot');
            
            const goToSlide = (index) => {
                if (index < 0 || index >= slides.length) return;
                currentSlide = index;
                slides.forEach((s, i) => s.classList.toggle('active', i === index));
                dots.forEach((d, i) => d.classList.toggle('active', i === index));
            };
            
            // Touch events
            slider.addEventListener('touchstart', (e) => {
                startX = e.touches[0].clientX;
                isDragging = true;
            });
            
            slider.addEventListener('touchend', (e) => {
                if (!isDragging) return;
                isDragging = false;
                const endX = e.changedTouches[0].clientX;
                const diff = startX - endX;
                
                if (Math.abs(diff) > 50) {
                    if (diff > 0) goToSlide(currentSlide + 1);
                    else goToSlide(currentSlide - 1);
                }
            });
            
            // Mouse events for desktop
            slider.addEventListener('mousedown', (e) => {
                startX = e.clientX;
                isDragging = true;
            });
            
            slider.addEventListener('mouseup', (e) => {
                if (!isDragging) return;
                isDragging = false;
                const diff = startX - e.clientX;
                
                if (Math.abs(diff) > 50) {
                    if (diff > 0) goToSlide(currentSlide + 1);
                    else goToSlide(currentSlide - 1);
                }
            });
            
            // Dot clicks
            dots.forEach(dot => {
                dot.addEventListener('click', () => {
                    goToSlide(parseInt(dot.dataset.index));
                });
            });
        }
        
        // Close on overlay click
        overlay.addEventListener('click', () => {
            popup.remove();
            overlay.remove();
        });
    }
    
    applyPlannedSubs() {
        // Next interval to apply (first hold = interval 2, second = interval 3, etc.)
        const nextInterval = (this.state.lastAppliedSubsInterval || 1) + 1;
        
        if (nextInterval > this.settings.intervalCount) {
            this.showToast('No more intervals');
            return;
        }
        
        const prevPlanned = this.state.intervalLineups[nextInterval - 1] || [];
        const nextPlanned = this.state.intervalLineups[nextInterval] || [];
        const liveLineup = [...(this.state.liveLineup || [])];
        
        // Find who's actually LEAVING (in prev but not in next)
        const playersLeaving = prevPlanned.filter(id => id && !nextPlanned.includes(id));
        // Find who's actually JOINING (in next but not in prev)
        const playersJoining = nextPlanned.filter(id => id && !prevPlanned.includes(id));
        
        // Record actual substitutions (players leaving/joining, not position swaps)
        const subsCount = Math.min(playersLeaving.length, playersJoining.length);
        for (let i = 0; i < subsCount; i++) {
            const playerOff = playersLeaving[i];
            const playerOn = playersJoining[i];
            this.finalizePlayerMinutes(playerOff);
            this.startPlayerMinutes(playerOn);
            this.recordSubstitution(playerOn, playerOff);
        }
        
        // Apply the full planned lineup for this interval
        this.state.liveLineup = [...nextPlanned];
        this.state.lastAppliedSubsInterval = nextInterval;
        this.saveState();
        this.renderPitch();
        this.renderBench();
        this.renderStats();
        this.updateSubsIconBadge();
        
        // Show toast
        if (subsCount > 0) {
            const swapNames = [];
            for (let i = 0; i < subsCount; i++) {
                const onName = this.getPlayerById(playersJoining[i])?.name;
                const offName = this.getPlayerById(playersLeaving[i])?.name;
                swapNames.push(`${onName}↔${offName}`);
            }
            this.showToast(`Int ${nextInterval}: ${swapNames.join(', ')}`);
        } else {
            this.showToast(`Interval ${nextInterval}: No subs needed`);
        }
    }

    resetMatch() {
        if (confirm('Reset the match? This will reset the timer, scores, and player minutes.')) {
            this.pauseTimer();
            this.state.startTime = null;
            this.state.pausedElapsedMs = 0;
            this.state.lastTickTime = null;
            this.state.fullTimeShown = false;
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
                p.onPitchSinceElapsed = undefined;
            });
            // Re-enable timer buttons
            this.elements.playPauseBtn.disabled = false;
            this.elements.playPauseBtn.textContent = '▶';
            this.elements.playPauseBtn.classList.remove('btn-secondary');
            this.elements.playPauseBtn.classList.add('btn-primary');
            this.elements.stopBtn.disabled = false;
            
            this.updateTimerDisplay();
            this.updateIntervalDisplay();
            this.updateScoreDisplay();
            this.updateSubsIconBadge();
            this.renderStats();
            this.renderMatchEvents();
            this.renderPitch();
            this.renderBench();
            this.saveState();
        }
    }

    // ==================== PLAYER MANAGEMENT ====================

    addPlayer() {
        const name = this.elements.newPlayerName.value.trim();

        if (!name) return;

        const maxNumber = this.state.players.reduce((max, p) => Math.max(max, p.number), 0);
        const maxId = this.state.players.reduce((max, p) => Math.max(max, p.id), 0);

        this.state.players.push({
            id: maxId + 1,
            name: name,
            number: maxNumber + 1,
            minutesPlayed: 0
        });

        this.elements.newPlayerName.value = '';
        this.saveState();
        this.renderRoster();
        this.renderBench();
        this.renderStats();
        this.updateSubsDisplay();
    }

    removePlayer(playerId) {
        // Remove from all interval lineups if on pitch
        for (let i = 1; i <= this.settings.intervalCount; i++) {
            if (this.state.intervalLineups[i]) {
                const pitchIndex = this.state.intervalLineups[i].indexOf(playerId);
                if (pitchIndex !== -1) {
                    this.state.intervalLineups[i][pitchIndex] = null;
                }
            }
        }

        // Remove from players array
        this.state.players = this.state.players.filter(p => p.id !== playerId);
        
        this.saveState();
        this.render();
        this.updateSubsDisplay();
    }

    getPlayerById(id) {
        return this.state.players.find(p => p.id === id);
    }

    isPlayerOnPitch(playerId) {
        return this.getCurrentLineup().includes(playerId);
    }

    getBenchPlayers() {
        return this.state.players.filter(p => !this.isPlayerOnPitch(p.id));
    }

    updatePlayerMinutes() {
        // Minutes are now calculated from timestamps, not incremented
        // This function just triggers display updates
        
        const elapsed = this.getElapsedSeconds();
        if (this._lastDisplayedSecond !== elapsed) {
            this._lastDisplayedSecond = elapsed;
            // Update minutes labels in-place instead of full re-render
            this.updateMinutesDisplay();
            // Only do full stats update every 10 seconds
            if (elapsed % 10 === 0) {
                this.renderStats();
            }
        }
    }

    // Update just the minutes display on player cards without recreating elements
    updateMinutesDisplay() {
        document.querySelectorAll('.player-card').forEach(card => {
            const playerId = parseInt(card.dataset.playerId);
            const player = this.getPlayerById(playerId);
            if (player) {
                const minutesEl = card.querySelector('.player-minutes');
                if (minutesEl) {
                    const minutes = Math.floor(this.getPlayerCurrentMinutes(playerId));
                    const plannedMinutes = this.getPlannedMinutes(player.id);
                    const minuteLabel = this.state.mode === 'plan' ? `${plannedMinutes}'` : `${minutes}'`;
                    minutesEl.textContent = minuteLabel;
                }
            }
        });
    }

    // ==================== DRAG AND DROP ====================

    // Helper: Handle player tap action (click/tap without drag)
    handlePlayerTap(playerId, location, slotIndex) {
        if (location === 'pitch') {
            // If a bench player is selected, swap them
            if (this.selectedBenchPlayer) {
                const lineup = [...this.getCurrentLineup()];
                const pitchPlayerId = lineup[slotIndex];
                lineup[slotIndex] = this.selectedBenchPlayer;
                this.setCurrentLineup(lineup);
                
                const benchPlayer = this.getPlayerById(this.selectedBenchPlayer);
                const pitchPlayer = pitchPlayerId ? this.getPlayerById(pitchPlayerId) : null;
                this.showToast(`${benchPlayer?.name} ↔ ${pitchPlayer?.name || 'empty'}`);
                
                // Record substitution in live mode
                // Track minutes for the swap
                this.finalizePlayerMinutes(pitchPlayerId);
                this.startPlayerMinutes(this.selectedBenchPlayer);
                
                if (pitchPlayer) {
                    this.recordSubstitution(this.selectedBenchPlayer, pitchPlayerId);
                }
                
                this.clearBenchSelection();
                this.renderPitch();
                this.renderBench();
                this.renderStats();
            } else if (this.state.mode === 'live') {
                // In live mode, show hint to select bench player first
                this.showToast('Select a sub first', 'default', 1500);
            } else {
                // In plan mode, allow removing player from pitch
                this.removePlayerFromPitch(slotIndex);
            }
        } else if (location === 'bench') {
            if (this.state.mode === 'live') {
                // In live mode, always use quick swap selection
                if (this.selectedBenchPlayer === playerId) {
                    // Deselect
                    this.clearBenchSelection();
                    this.renderBench();
                } else {
                    // Select this player for swap
                    this.clearBenchSelection();
                    this.selectedBenchPlayer = playerId;
                    const card = document.querySelector(`.player-card[data-player-id="${playerId}"]`);
                    if (card) card.classList.add('selected-for-swap');
                    this.showToast('Tap a pitch player to swap', 'default', 1500);
                }
            } else {
                // In plan mode, check if there's an empty slot on the pitch
                const lineup = this.getCurrentLineup();
                const hasEmptySlot = lineup.some(id => id === null);
                
                if (hasEmptySlot) {
                    // Auto-fill the empty slot with this player
                    this.addBenchPlayerToPitch(playerId);
                } else {
                    // No empty slots - toggle selection for quick swap
                    if (this.selectedBenchPlayer === playerId) {
                        // Deselect
                        this.clearBenchSelection();
                        this.renderBench();
                    } else {
                        // Select this player (or switch selection)
                        this.clearBenchSelection();
                        this.selectedBenchPlayer = playerId;
                        const card = document.querySelector(`.player-card[data-player-id="${playerId}"]`);
                        if (card) card.classList.add('selected-for-swap');
                        this.showToast('Tap a pitch player to swap', 'default', 1500);
                    }
                }
            }
        }
    }

    // Helper: Create drag preview element
    createDragPreview(playerId) {
        const dragPreview = document.createElement('div');
        dragPreview.className = 'drag-preview';
        const player = this.getPlayerById(playerId);
        dragPreview.textContent = player ? player.name : '';
        document.body.appendChild(dragPreview);
        return dragPreview;
    }

    // Helper: Handle touch end drop detection
    handleTouchDrop(touch, element) {
        element.style.display = 'none';
        const targetElement = document.elementFromPoint(touch.clientX, touch.clientY);
        element.style.display = '';
        
        if (!targetElement) return;
        
        const targetSlot = targetElement.closest('.player-slot');
        const targetBench = targetElement.closest('.bench');
        const targetCard = targetElement.closest('.player-card');
        
        if (targetSlot) {
            this.handleDrop(parseInt(targetSlot.dataset.slot), 'pitch');
        } else if (targetBench) {
            this.handleDrop(null, 'bench');
        } else if (targetCard) {
            const parentSlot = targetCard.closest('.player-slot');
            if (parentSlot) {
                this.handleDrop(parseInt(parentSlot.dataset.slot), 'pitch');
            }
        }
    }

    setupDragForPlayer(element, playerId, location, slotIndex = null) {
        let isDragging = false;
        let startX, startY;
        let longPressTimer = null;
        let touchMoved = false;
        let longPressTriggered = false;

        // Long press handler for goals (live mode) or pin toggle (plan mode)
        const triggerGoal = () => {
            this.recordGoal(playerId, 'us');
            this.showScoringAnimation(element);
        };

        const triggerPinToggle = () => {
            if (slotIndex === null) return;
            const interval = this.state.selectedPlanInterval;
            if (this.isPositionPinned(interval, slotIndex)) {
                this.unpinPosition(interval, slotIndex);
                this.showToast('Unpinned');
            } else {
                this.pinPosition(interval, slotIndex);
                this.showToast('Pinned 📌');
            }
            this.renderPitch();
        };

        const startLongPress = () => {
            if (location !== 'pitch') return;
            if (this.state.mode === 'live') {
                longPressTimer = setTimeout(() => {
                    triggerGoal();
                    longPressTimer = null;
                }, CONFIG.LONG_PRESS_MS);
            } else if (this.state.mode === 'plan') {
                longPressTimer = setTimeout(() => {
                    triggerPinToggle();
                    longPressTimer = null;
                }, CONFIG.LONG_PRESS_MS);
            }
        };

        const cancelLongPress = () => {
            if (longPressTimer) {
                clearTimeout(longPressTimer);
                longPressTimer = null;
            }
        };

        // Mouse events
        element.setAttribute('draggable', 'true');
        
        element.addEventListener('mousedown', () => startLongPress());
        element.addEventListener('mouseup', () => cancelLongPress());
        element.addEventListener('mouseleave', () => cancelLongPress());
        
        element.addEventListener('dragstart', (e) => {
            cancelLongPress();
            isDragging = true;
            this.startDrag(playerId, location, slotIndex);
            e.dataTransfer.effectAllowed = 'move';
            element.classList.add('dragging');
            
            // Create custom drag image
            const dragPreview = this.createDragPreview(playerId);
            e.dataTransfer.setDragImage(dragPreview, 40, 20);
            setTimeout(() => dragPreview.remove(), 0);
        });

        element.addEventListener('dragend', () => {
            element.classList.remove('dragging');
            this.endDrag();
            isDragging = false;
        });

        // Click to remove from pitch OR add bench player to pitch
        element.addEventListener('click', (e) => {
            e.stopPropagation();
            if (isDragging || longPressTriggered) return;
            this.handlePlayerTap(playerId, location, slotIndex);
        });

        // Touch events for mobile
        element.addEventListener('touchstart', (e) => {
            touchMoved = false;
            longPressTriggered = false;
            startX = e.touches[0].clientX;
            startY = e.touches[0].clientY;
            this.startDrag(playerId, location, slotIndex);
            
            // Start long press timer for goals (live) or pin toggle (plan)
            if (location === 'pitch') {
                longPressTimer = setTimeout(() => {
                    longPressTriggered = true;
                    if (this.state.mode === 'live') {
                        triggerGoal();
                    } else if (this.state.mode === 'plan') {
                        triggerPinToggle();
                    }
                }, CONFIG.LONG_PRESS_MS);
            }
        }, { passive: true });

        element.addEventListener('touchmove', (e) => {
            const touch = e.touches[0];
            const dx = Math.abs(touch.clientX - startX);
            const dy = Math.abs(touch.clientY - startY);
            
            if (dx > CONFIG.DRAG_THRESHOLD || dy > CONFIG.DRAG_THRESHOLD) {
                touchMoved = true;
                cancelLongPress();
                e.preventDefault();
                element.classList.add('dragging');
                this.handleTouchMove(touch);
            }
        }, { passive: false });

        element.addEventListener('touchend', (e) => {
            cancelLongPress();
            element.classList.remove('dragging');
            
            if (longPressTriggered) {
                // Prevent synthetic click event from firing
                e.preventDefault();
                longPressTriggered = false;
                this.endDrag();
                return;
            }
            
            if (touchMoved) {
                this.handleTouchDrop(e.changedTouches[0], element);
                this.clearAllDragOverStates();
            } else {
                e.stopPropagation();
                e.preventDefault(); // Prevent synthetic click event from firing
                this.handlePlayerTap(playerId, location, slotIndex);
            }
            this.endDrag();
        });
    }

    addBenchPlayerToPitch(playerId) {
        if (this.justAddedPlayer) return;
        this.justAddedPlayer = true;
        
        const lineup = this.getCurrentLineup();
        
        // Find first empty slot in priority order
        for (const slotIndex of this.slotFillOrder) {
            if (lineup[slotIndex] === null) {
                const newLineup = [...lineup];
                newLineup[slotIndex] = playerId;
                this.setCurrentLineup(newLineup);
                
                const player = this.getPlayerById(playerId);
                this.showToast(`${player?.name} → ${POSITIONS[slotIndex]}`);
                
                // Start tracking minutes for the new player
                this.startPlayerMinutes(playerId);
                
                // Record substitution in live mode if a player was just removed
                if (this.state.mode === MODES.LIVE && this._removedPlayersForSub.length > 0) {
                    const removedPlayer = this._removedPlayersForSub.shift(); // Take first removed (FIFO)
                    this.recordSubstitution(playerId, removedPlayer.id);
                }
                
                this.renderPitch();
                this.renderBench();
                this.renderStats();
                setTimeout(() => { this.justAddedPlayer = false; }, 100);
                return;
            }
        }
        // No empty slots available
        this.justAddedPlayer = false;
    }

    removePlayerFromPitch(slotIndex) {
        this.justRemovedPlayer = true;
        const lineup = [...this.getCurrentLineup()];
        const removedPlayerId = lineup[slotIndex];
        const removedPlayer = removedPlayerId ? this.getPlayerById(removedPlayerId) : null;
        if (removedPlayerId) {
            this.finalizePlayerMinutes(removedPlayerId);
            this.removedPlayersStack.push(removedPlayerId); // Add to stack for undo
            // Track the removed player for substitution recording
            if (this.state.mode === 'live' && removedPlayer) {
                this._removedPlayersForSub.push({
                    id: removedPlayerId,
                    name: removedPlayer.name,
                    time: this.getElapsedSeconds()
                });
            }
        }
        lineup[slotIndex] = null;
        // Unpin position in plan mode
        if (this.state.mode === 'plan') {
            this.unpinPosition(this.state.selectedPlanInterval, slotIndex);
        }
        this.setCurrentLineup(lineup);
        this.renderPitch();
        this.renderBench();
        this.renderStats();
        // Reset flag after a short delay
        setTimeout(() => { this.justRemovedPlayer = false; }, 100);
    }

    getLowestMinutesBenchPlayer() {
        const benchPlayers = this.getBenchPlayers();
        if (benchPlayers.length === 0) return null;
        
        return benchPlayers.reduce((lowest, player) => {
            const playerMinutes = this.getPlannedMinutes(player.id);
            const lowestMinutes = lowest ? this.getPlannedMinutes(lowest.id) : Infinity;
            return playerMinutes < lowestMinutes ? player : lowest;
        }, null);
    }

    fillEmptySlot(slotIndex) {
        const lineup = this.getCurrentLineup();
        if (lineup[slotIndex] !== null) return;
        
        // Use last removed player from stack if available and still on bench
        let playerToAdd = null;
        while (this.removedPlayersStack.length > 0) {
            const candidate = this.removedPlayersStack.pop();
            if (!this.isPlayerOnPitch(candidate)) {
                playerToAdd = candidate;
                break;
            }
        }
        
        if (!playerToAdd) return;
        
        const newLineup = [...lineup];
        newLineup[slotIndex] = playerToAdd;
        this.setCurrentLineup(newLineup);
        this.renderPitch();
        this.renderBench();
        this.renderStats();
    }

    startDrag(playerId, location, slotIndex) {
        this.wasDragging = true;
        this.dragState = {
            draggingPlayer: playerId,
            sourceLocation: location,
            sourceSlot: slotIndex
        };
    }

    endDrag() {
        this.clearAllDragOverStates();
        this.dragState = {
            draggingPlayer: null,
            sourceSlot: null,
            sourceLocation: null
        };
        // Clear wasDragging after a short delay to prevent swipe triggering
        setTimeout(() => { this.wasDragging = false; }, 100);
    }

    handleTouchMove(touch) {
        const element = document.elementFromPoint(touch.clientX, touch.clientY);
        this.clearAllDragOverStates();
        
        if (element) {
            const slot = element.closest('.player-slot');
            const bench = element.closest('.bench');
            
            if (slot) slot.classList.add('drag-over');
            if (bench) bench.classList.add('drag-over');
        }
    }

    handleTouchEnd(touch) {
        const element = document.elementFromPoint(touch.clientX, touch.clientY);
        
        if (element) {
            const slot = element.closest('.player-slot');
            const bench = element.closest('.bench');
            
            if (slot) {
                const slotIndex = parseInt(slot.dataset.slot);
                this.handleDrop(slotIndex, 'pitch');
            } else if (bench) {
                this.handleDrop(null, 'bench');
            }
        }
        
        this.endDrag();
    }

    clearAllDragOverStates() {
        document.querySelectorAll('.drag-over').forEach(el => {
            el.classList.remove('drag-over');
        });
    }

    setupDropZone(element, targetLocation, slotIndex = null) {
        element.addEventListener('dragover', (e) => {
            e.preventDefault();
            element.classList.add('drag-over');
        });

        element.addEventListener('dragleave', () => {
            element.classList.remove('drag-over');
        });

        element.addEventListener('drop', (e) => {
            e.preventDefault();
            element.classList.remove('drag-over');
            this.handleDrop(slotIndex, targetLocation);
        });

        // Click on empty slot to auto-fill with lowest minutes player
        if (targetLocation === 'pitch' && slotIndex !== null) {
            element.addEventListener('click', (e) => {
                // Skip if we just removed a player
                if (this.justRemovedPlayer) return;
                // Only if slot is empty (no player card clicked)
                if (e.target === element || e.target.classList.contains('player-slot')) {
                    const lineup = this.getCurrentLineup();
                    if (lineup[slotIndex] === null) {
                        this.fillEmptySlot(slotIndex);
                    }
                }
            });
        }
    }

    handleDrop(targetSlotIndex, targetLocation) {
        if (!this.dragState.draggingPlayer) return;

        const { draggingPlayer, sourceLocation, sourceSlot } = this.dragState;
        const lineup = [...this.getCurrentLineup()];

        // Prevent dropping on the same slot
        if (targetLocation === 'pitch' && sourceLocation === 'pitch' && sourceSlot === targetSlotIndex) {
            return;
        }

        if (targetLocation === 'pitch') {
            const playerInTarget = lineup[targetSlotIndex];

            // Simple swap: put target player where source was, put source player at target
            if (sourceLocation === 'pitch' && sourceSlot !== null) {
                lineup[sourceSlot] = playerInTarget;
            }
            lineup[targetSlotIndex] = draggingPlayer;
            
            // Track minutes and record substitution in live mode (only for bench to pitch moves)
            if (sourceLocation === 'bench' && this.state.mode === MODES.LIVE) {
                if (playerInTarget) {
                    this.finalizePlayerMinutes(playerInTarget);
                    this.recordSubstitution(draggingPlayer, playerInTarget);
                }
                this.startPlayerMinutes(draggingPlayer);
            }
        } else if (targetLocation === 'bench') {
            if (sourceLocation === 'pitch' && sourceSlot !== null) {
                this.finalizePlayerMinutes(draggingPlayer);
                lineup[sourceSlot] = null;
                // Unpin position in plan mode
                if (this.state.mode === 'plan') {
                    this.unpinPosition(this.state.selectedPlanInterval, sourceSlot);
                }
            }
        }

        this.setCurrentLineup(lineup);
        this.renderPitch();
        this.renderBench();
        this.renderStats();
        
        // Update subs badge in live mode after manual changes
        if (this.state.mode === MODES.LIVE) {
            this.updateSubsIconBadge();
        }
    }

    handleDropOnBenchPlayer(benchPlayerId) {
        if (!this.dragState.draggingPlayer) return;
        
        const { draggingPlayer, sourceLocation, sourceSlot } = this.dragState;
        
        // Only handle pitch -> bench player swaps
        if (sourceLocation !== 'pitch' || sourceSlot === null) return;
        
        // Track minutes for the swap
        this.finalizePlayerMinutes(draggingPlayer);
        this.startPlayerMinutes(benchPlayerId);
        
        const lineup = [...this.getCurrentLineup()];
        
        // Put the bench player in the pitch slot
        lineup[sourceSlot] = benchPlayerId;
        
        // Record substitution in live mode
        if (this.state.mode === MODES.LIVE) {
            this.recordSubstitution(benchPlayerId, draggingPlayer);
        }
        
        this.setCurrentLineup(lineup);
        
        // Show toast for the swap
        const benchPlayer = this.getPlayerById(benchPlayerId);
        const pitchPlayer = this.getPlayerById(draggingPlayer);
        this.showToast(`${benchPlayer?.name} ↔ ${pitchPlayer?.name}`);
        
        this.renderPitch();
        this.renderBench();
        this.renderStats();
        
        // Update subs badge in live mode after manual changes
        if (this.state.mode === MODES.LIVE) {
            this.updateSubsIconBadge();
        }
    }

    // ==================== RENDERING ====================

    render() {
        this.updateTimerDisplay();
        this.updateIntervalDisplay();
        this.updateScoreDisplay();
        this.setMode(this.state.mode);
        this.renderIntervalTabs();
        this.renderPitch();
        this.renderBench();
        this.renderStats();
        this.renderRoster();
    }

    renderIntervalTabs() {
        this.elements.intervalTabs.innerHTML = '';
        
        for (let i = 1; i <= this.settings.intervalCount; i++) {
            const tab = document.createElement('button');
            tab.className = 'interval-tab' + (i === this.state.selectedPlanInterval ? ' active' : '');
            tab.textContent = `${i}`;
            tab.dataset.interval = i;
            tab.draggable = true;
            
            // Click to select interval
            tab.addEventListener('click', () => this.selectPlanInterval(i));
            
            // Drag to copy lineup
            tab.addEventListener('dragstart', (e) => {
                e.dataTransfer.setData('text/plain', i);
                e.dataTransfer.effectAllowed = 'copy';
                tab.classList.add('dragging');
            });
            
            tab.addEventListener('dragend', () => {
                tab.classList.remove('dragging');
            });
            
            tab.addEventListener('dragover', (e) => {
                e.preventDefault();
                tab.classList.add('drag-over');
            });
            
            tab.addEventListener('dragleave', () => {
                tab.classList.remove('drag-over');
            });
            
            tab.addEventListener('drop', (e) => {
                e.preventDefault();
                tab.classList.remove('drag-over');
                const fromInterval = parseInt(e.dataTransfer.getData('text/plain'));
                const toInterval = i;
                if (fromInterval !== toInterval) {
                    this.copyLineupFromTo(fromInterval, toInterval);
                }
            });
            
            // Touch events for mobile (immediate drag, no delay)
            let touchStartX, touchStartY, isDraggingTab = false;
            const dragThreshold = 10;
            
            tab.addEventListener('touchstart', (e) => {
                touchStartX = e.touches[0].clientX;
                touchStartY = e.touches[0].clientY;
                isDraggingTab = false;
                tab.classList.add('dragging');
            }, { passive: true });
            
            tab.addEventListener('touchmove', (e) => {
                const dx = Math.abs(e.touches[0].clientX - touchStartX);
                const dy = Math.abs(e.touches[0].clientY - touchStartY);
                if (dx > dragThreshold || dy > dragThreshold) {
                    isDraggingTab = true;
                    e.preventDefault();
                    
                    // Highlight drop target
                    const touch = e.touches[0];
                    const target = document.elementFromPoint(touch.clientX, touch.clientY);
                    document.querySelectorAll('.interval-tab').forEach(t => t.classList.remove('drag-over'));
                    if (target?.classList.contains('interval-tab') && target !== tab) {
                        target.classList.add('drag-over');
                    }
                }
            }, { passive: false });
            
            tab.addEventListener('touchend', (e) => {
                tab.classList.remove('dragging');
                document.querySelectorAll('.interval-tab').forEach(t => t.classList.remove('drag-over'));
                
                if (isDraggingTab) {
                    const touch = e.changedTouches[0];
                    const target = document.elementFromPoint(touch.clientX, touch.clientY);
                    if (target?.classList.contains('interval-tab')) {
                        const toInterval = parseInt(target.dataset.interval);
                        if (toInterval !== i) {
                            this.copyLineupFromTo(i, toInterval);
                        }
                    }
                    e.preventDefault();
                }
            });
            
            this.elements.intervalTabs.appendChild(tab);
        }
    }

    renderPitch() {
        const slots = document.querySelectorAll('.player-slot');
        const lineup = this.getCurrentLineup();
        
        slots.forEach((slot) => {
            const index = parseInt(slot.dataset.slot);
            slot.innerHTML = '';
            slot.classList.remove('has-player');
            
            // Also toggle class on parent position-slot for label fading
            const positionSlot = slot.closest('.position-slot');
            if (positionSlot) positionSlot.classList.remove('has-player');
            
            const playerId = lineup[index];
            
            if (playerId !== null) {
                const player = this.getPlayerById(playerId);
                if (player) {
                    slot.classList.add('has-player');
                    if (positionSlot) positionSlot.classList.add('has-player');
                    const playerCard = this.createPlayerCard(player, 'pitch', index);
                    slot.appendChild(playerCard);
                }
            }
        });
    }

    renderBench() {
        this.elements.bench.innerHTML = '';
        
        const benchPlayers = this.getBenchPlayers();
        
        benchPlayers.forEach(player => {
            const playerCard = this.createPlayerCard(player, 'bench');
            this.elements.bench.appendChild(playerCard);
        });
    }

    // Setup drop zones once during initialization
    setupDropZones() {
        // Setup pitch slots as drop zones
        const slots = document.querySelectorAll('.player-slot');
        slots.forEach((slot) => {
            const index = parseInt(slot.dataset.slot);
            this.setupDropZone(slot, 'pitch', index);
        });

        // Setup bench as drop zone
        this.setupDropZone(this.elements.bench, 'bench');
    }

    createPlayerCard(player, location, slotIndex = null) {
        const card = document.createElement('div');
        card.className = 'player-card';
        card.dataset.playerId = player.id;
        
        const minutes = Math.floor(this.getPlayerCurrentMinutes(player.id));
        const plannedMinutes = this.getPlannedMinutes(player.id);
        
        // Show planned minutes in plan mode, actual minutes in live mode
        const displayMinutes = this.state.mode === 'plan' ? plannedMinutes : minutes;
        const minuteLabel = this.state.mode === 'plan' ? `${plannedMinutes}'` : `${minutes}'`;
        
        // Show goal indicator in live mode
        const goals = player.goals || 0;
        const goalIndicator = this.state.mode === 'live' && goals > 0 
            ? `<span class="goal-indicator">${goals > 1 ? '⚽×' + goals : '⚽'}</span>` 
            : '';
        const statsBadge = goalIndicator 
            ? `<span class="player-stats-badge">${goalIndicator}</span>` 
            : '';
        
        // Show pin indicator in plan mode for pinned positions on pitch
        const isPinned = this.state.mode === 'plan' && location === 'pitch' && slotIndex !== null 
            && this.isPositionPinned(this.state.selectedPlanInterval, slotIndex);
        const pinBadge = isPinned ? '<span class="pin-badge">📌</span>' : '';
        
        card.innerHTML = `
            ${statsBadge}
            ${pinBadge}
            <span class="player-name">${player.name}</span>
            <span class="player-minutes">${minuteLabel}</span>
        `;
        
        this.setupDragForPlayer(card, player.id, location, slotIndex);
        
        // Make player cards accept drops (for swapping)
        if (location === 'pitch') {
            card.addEventListener('dragover', (e) => {
                e.preventDefault();
                card.classList.add('drag-over');
            });
            card.addEventListener('dragleave', () => {
                card.classList.remove('drag-over');
            });
            card.addEventListener('drop', (e) => {
                e.preventDefault();
                e.stopPropagation();
                card.classList.remove('drag-over');
                this.handleDrop(slotIndex, 'pitch');
            });
        } else if (location === 'bench') {
            // Bench players can accept drops from pitch players
            card.addEventListener('dragover', (e) => {
                e.preventDefault();
                card.classList.add('drag-over');
            });
            card.addEventListener('dragleave', () => {
                card.classList.remove('drag-over');
            });
            card.addEventListener('drop', (e) => {
                e.preventDefault();
                e.stopPropagation();
                card.classList.remove('drag-over');
                // Swap: put this bench player in the pitch slot, remove pitch player
                this.handleDropOnBenchPlayer(player.id);
            });
        }
        
        return card;
    }

    getPlannedMinutes(playerId) {
        // Calculate how many intervals this player is on the pitch
        const intervalDuration = this.settings.matchDuration / this.settings.intervalCount;
        let totalIntervals = 0;
        
        for (let i = 1; i <= this.settings.intervalCount; i++) {
            if (this.state.intervalLineups[i] && this.state.intervalLineups[i].includes(playerId)) {
                totalIntervals++;
            }
        }
        
        return Math.round(totalIntervals * intervalDuration);
    }

    getIntervalChanges() {
        const changes = [];
        for (let i = 2; i <= this.settings.intervalCount; i++) {
            const prev = this.state.intervalLineups[i - 1] || [];
            const curr = this.state.intervalLineups[i] || [];
            
            const off = prev.filter(id => id && !curr.includes(id))
                .map(id => this.getPlayerById(id)).filter(p => p);
            const on = curr.filter(id => id && !prev.includes(id))
                .map(id => this.getPlayerById(id)).filter(p => p);
            
            if (off.length || on.length) {
                changes.push({ interval: i, off, on });
            }
        }
        return changes;
    }

    renderStats() {
        this.elements.statsTable.innerHTML = '';
        
        // Update heading based on mode
        if (this.elements.statsHeading) {
            this.elements.statsHeading.textContent = this.state.mode === 'plan' ? '📊 Planned Minutes' : '📊 Player Minutes';
        }

        // Render substitution summary (Plan mode only)
        if (this.elements.subsSummary) {
            if (this.state.mode === 'plan') {
                const changes = this.getIntervalChanges();
                if (changes.length === 0) {
                    this.elements.subsSummary.innerHTML = '<div class="no-subs">No substitutions planned</div>';
                } else {
                    const intervalDurationMins = Math.round(this.settings.matchDuration / this.settings.intervalCount);
                    this.elements.subsSummary.innerHTML = changes.map(c => {
                        const timeStr = `${(c.interval - 1) * intervalDurationMins}'`;
                        const subsHtml = c.on.map((player, idx) => `
                            <div class="sub-pair">
                                <span class="sub-in">↑ ${player.name}</span>
                                <span class="sub-out">↓ ${c.off[idx]?.name || ''}</span>
                            </div>
                        `).join('');
                        return `
                            <div class="sub-change match-event event-sub">
                                <span class="event-time">${timeStr}</span>
                                <span class="event-icon">🔄</span>
                                <span class="event-detail event-detail-subs">
                                    ${subsHtml}
                                </span>
                            </div>
                        `;
                    }).join('');
                }
                this.elements.subsSummary.style.display = 'block';
            } else {
                this.elements.subsSummary.style.display = 'none';
            }
        }

        const intervalDuration = this.settings.matchDuration / this.settings.intervalCount;
        
        // Calculate planned or actual minutes for sorting
        const playersWithStats = this.state.players.map(p => ({
            ...p,
            plannedMinutes: this.getPlannedMinutes(p.id),
            displayMinutes: this.state.mode === 'plan' ? this.getPlannedMinutes(p.id) : Math.floor(this.getPlayerCurrentMinutes(p.id))
        }));

        // Sort by display minutes (ascending to show who needs more time)
        const sortedPlayers = playersWithStats.sort((a, b) => a.displayMinutes - b.displayMinutes);
        const avgMinutes = playersWithStats.reduce((sum, p) => sum + p.displayMinutes, 0) / playersWithStats.length;

        sortedPlayers.forEach(player => {
            const row = document.createElement('div');
            row.className = 'stat-row';
            
            const isOnPitch = this.isPlayerOnPitch(player.id);
            
            // Determine minute class for color coding
            let minuteClass = '';
            if (player.displayMinutes < avgMinutes * 0.5) {
                minuteClass = 'very-low';
            } else if (player.displayMinutes < avgMinutes * 0.8) {
                minuteClass = 'low';
            }
            
            // Show interval breakdown in plan mode
            const intervalsOnPitch = this.getIntervalsForPlayer(player.id);
            
            row.innerHTML = `
                <div class="player-info">
                    <span class="player-number-badge">${player.number}</span>
                    <span class="player-name">${player.name}</span>
                    ${isOnPitch ? '<span class="on-pitch">⚽</span>' : ''}
                </div>
                <div class="minutes-info">
                    ${this.state.mode === 'plan' 
                        ? `<span class="intervals">${intervalsOnPitch}</span>` 
                        : ''}
                    <span class="minutes ${minuteClass}">${player.displayMinutes}'</span>
                </div>
            `;
            
            this.elements.statsTable.appendChild(row);
        });
    }

    renderMatchEvents() {
        if (!this.elements.eventsLog) return;
        
        this.elements.eventsLog.innerHTML = '';
        
        if (this.state.matchEvents.length === 0) {
            this.elements.eventsLog.innerHTML = '<div class="no-events">No match events yet</div>';
            return;
        }
        
        // Calculate running score for each goal event
        let runningScoreUs = 0;
        let runningScoreThem = 0;
        const eventsWithScore = this.state.matchEvents.map(event => {
            if (event.type === 'goal') {
                if (event.team === 'us') {
                    runningScoreUs++;
                } else {
                    runningScoreThem++;
                }
                return { ...event, calculatedScore: `${runningScoreUs} - ${runningScoreThem}` };
            }
            return event;
        });
        
        // Group subs by minute, keep goals separate
        const groupedEvents = [];
        let currentSubGroup = null;
        
        eventsWithScore.forEach((event, index) => {
            const minutes = Math.floor(event.time / 60);
            
            if (event.type === 'sub') {
                // Check if we can add to existing sub group (same minute)
                if (currentSubGroup && currentSubGroup.minutes === minutes) {
                    currentSubGroup.subs.push({ ...event, originalIndex: index });
                } else {
                    // Start new sub group
                    if (currentSubGroup) groupedEvents.push(currentSubGroup);
                    currentSubGroup = {
                        type: 'sub-group',
                        minutes: minutes,
                        subs: [{ ...event, originalIndex: index }]
                    };
                }
            } else {
                // Non-sub event - flush any pending sub group first
                if (currentSubGroup) {
                    groupedEvents.push(currentSubGroup);
                    currentSubGroup = null;
                }
                groupedEvents.push({ ...event, originalIndex: index });
            }
        });
        
        // Don't forget the last sub group
        if (currentSubGroup) groupedEvents.push(currentSubGroup);
        
        // Render in reverse order (newest first)
        const reversedEvents = [...groupedEvents].reverse();
        
        reversedEvents.forEach((event) => {
            const eventDiv = document.createElement('div');
            
            if (event.type === 'sub-group') {
                eventDiv.className = 'match-event event-sub';
                const timeStr = this.formatEventTime(event.minutes * 60);
                
                const subsHtml = event.subs.map(sub => `
                    <div class="sub-pair">
                        <span class="sub-in">↑ ${sub.playerIn}</span>
                        <span class="sub-out">↓ ${sub.playerOut}</span>
                    </div>
                `).join('');
                
                eventDiv.innerHTML = `
                    <span class="event-time">${timeStr}</span>
                    <span class="event-icon">🔄</span>
                    <span class="event-detail event-detail-subs">
                        ${subsHtml}
                    </span>
                `;
            } else if (event.type === 'goal') {
                eventDiv.className = 'match-event event-goal';
                const timeStr = this.formatEventTime(event.time);
                const icon = event.team === 'us' ? '⚽' : '🔴';
                const assistText = event.assist ? ` (assist: ${event.assist})` : '';
                
                eventDiv.innerHTML = `
                    <span class="event-time">${timeStr}</span>
                    <span class="event-icon">${icon}</span>
                    <span class="event-detail">
                        <strong>GOAL</strong> - ${event.scorer}${assistText}
                        <span class="event-score">${event.calculatedScore}</span>
                    </span>
                    <button class="event-delete-btn" data-index="${event.originalIndex}">✕</button>
                `;
                
                const deleteBtn = eventDiv.querySelector('.event-delete-btn');
                if (deleteBtn) {
                    deleteBtn.addEventListener('click', () => this.deleteMatchEvent(event.originalIndex));
                }
            }
            
            this.elements.eventsLog.appendChild(eventDiv);
        });
    }

    deleteMatchEvent(index) {
        const event = this.state.matchEvents[index];
        if (!event) return;
        
        if (event.type === 'goal') {
            // Find corresponding goal in goalHistory and remove it
            const goalIndex = this.state.goalHistory.findIndex(g => 
                g.time === event.time && 
                (event.team === 'them' ? g.team === 'them' : g.team === 'us')
            );
            
            if (goalIndex !== -1) {
                const goal = this.state.goalHistory[goalIndex];
                
                // Decrement score
                if (goal.team === 'us') {
                    this.state.scoreUs = Math.max(0, this.state.scoreUs - 1);
                } else {
                    this.state.scoreThem = Math.max(0, this.state.scoreThem - 1);
                }
                
                // Remove goal from player
                if (goal.playerId) {
                    const player = this.getPlayerById(goal.playerId);
                    if (player && player.goals > 0) {
                        player.goals--;
                    }
                }
                
                // Remove assist from player
                if (goal.assistPlayerId) {
                    const assister = this.getPlayerById(goal.assistPlayerId);
                    if (assister && assister.assists > 0) {
                        assister.assists--;
                    }
                }
                
                this.state.goalHistory.splice(goalIndex, 1);
            }
            
            this.updateScoreDisplay();
        }
        
        // Remove the event
        this.state.matchEvents.splice(index, 1);
        this.renderMatchEvents();
        this.saveState();
    }

    getIntervalsForPlayer(playerId) {
        const intervals = [];
        for (let i = 1; i <= this.settings.intervalCount; i++) {
            if (this.state.intervalLineups[i] && this.state.intervalLineups[i].includes(playerId)) {
                intervals.push(i);
            }
        }
        return intervals.join(',') || '-';
    }

    renderRoster() {
        this.elements.rosterList.innerHTML = '';

        this.state.players.forEach(player => {
            const item = document.createElement('div');
            item.className = 'roster-item';
            
            // Build position chips HTML
            const positionChips = Object.entries(POSITIONS).map(([slot, name]) => {
                const slotNum = parseInt(slot);
                const isSelected = player.preferredPositions?.includes(slotNum);
                const priority = isSelected ? player.preferredPositions.indexOf(slotNum) + 1 : null;
                return `<span class="position-chip ${isSelected ? 'selected' : ''}" 
                              data-slot="${slot}" 
                              title="${isSelected ? `Priority ${priority}` : 'Click to add'}">
                    ${name}${isSelected ? `<sub>${priority}</sub>` : ''}
                </span>`;
            }).join('');
            
            item.innerHTML = `
                <div class="roster-item-header">
                    <div class="player-info">
                        <span class="player-number-badge">${player.number}</span>
                        <span>${player.name}</span>
                    </div>
                    <button class="delete-btn" data-player-id="${player.id}">✕</button>
                </div>
                <div class="position-chips">${positionChips}</div>
            `;
            
            item.querySelector('.delete-btn').addEventListener('click', () => {
                if (confirm(`Remove ${player.name} from the squad?`)) {
                    this.removePlayer(player.id);
                }
            });
            
            // Position chip click handlers
            item.querySelectorAll('.position-chip').forEach(chip => {
                chip.addEventListener('click', () => {
                    const slot = parseInt(chip.dataset.slot);
                    this.togglePlayerPosition(player.id, slot);
                });
            });
            
            this.elements.rosterList.appendChild(item);
        });
    }

    /**
     * Toggle a position for a player. If already selected, remove it. 
     * If not selected, add it to the end of their preference list.
     */
    togglePlayerPosition(playerId, slot) {
        const player = this.getPlayerById(playerId);
        if (!player) return;
        
        if (!player.preferredPositions) {
            player.preferredPositions = [];
        }
        
        const idx = player.preferredPositions.indexOf(slot);
        if (idx >= 0) {
            // Remove this position
            player.preferredPositions.splice(idx, 1);
        } else {
            // Add this position (at end = lowest priority)
            player.preferredPositions.push(slot);
        }
        
        this.saveState();
        this.renderRoster();
    }

    // ==================== SHARING ====================

    encodePlan() {
        // Compact format: p=name1,name2|n=num1,num2|l=lineup1;lineup2|d=duration|i=intervals
        // Players: names joined by comma
        // Numbers: player numbers joined by comma
        // Lineups: each interval's player indices (into player array) joined by comma, intervals separated by semicolon
        
        const players = this.state.players;
        const names = players.map(p => encodeURIComponent(p.name)).join(',');
        const numbers = players.map(p => p.number).join(',');
        
        // Build lineups using player array index (not player ID)
        const lineups = [];
        for (let i = 1; i <= this.settings.intervalCount; i++) {
            const lineup = this.state.intervalLineups[i] || [];
            // Convert player IDs to array indices
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
            
            // Decode players
            const names = params.p.split(',').map(n => decodeURIComponent(n));
            const numbers = params.n ? params.n.split(',').map(n => parseInt(n)) : names.map((_, i) => i + 1);
            
            const players = names.map((name, idx) => ({
                id: idx + 1,
                name: name,
                number: numbers[idx] || idx + 1,
                minutesPlayed: 0
            }));
            
            // Decode settings
            const matchDuration = parseInt(params.d) || 60;
            const intervalCount = parseInt(params.i) || 4;
            
            // Decode lineups
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

    sharePlan() {
        const encoded = this.encodePlan();
        const url = `${window.location.origin}${window.location.pathname}#${encoded}`;
        
        navigator.clipboard.writeText(url).then(() => {
            // Show feedback
            const btn = document.getElementById('share-plan-btn');
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

    loadFromUrl() {
        const hash = window.location.hash.slice(1); // Remove #
        if (!hash || hash.length < 10) return false;
        
        const plan = this.decodePlan(hash);
        if (!plan) return false;
        
        // Apply the shared plan
        this.state.players = plan.players;
        this.settings.matchDuration = plan.matchDuration;
        this.settings.intervalCount = plan.intervalCount;
        this.state.intervalLineups = plan.intervalLineups;
        this.state.selectedPlanInterval = 1;
        this.state.currentInterval = 1;
        this.state.lastAppliedSubsInterval = 0;
        
        // Clear URL hash after loading
        history.replaceState(null, '', window.location.pathname);
        
        this.saveState();
        return true;
    }
}

// Initialize the app when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    window.teamSelector = new TeamSelector();
});
