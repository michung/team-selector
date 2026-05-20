// Team Selector App - 9-a-side Football Team Management (3-4-1 Formation)

class TeamSelector {
    constructor() {
        // Default settings
        this.settings = {
            matchDuration: 60, // minutes
            intervalCount: 4,
            playersOnPitch: 9
        };

        // Game state
        this.state = {
            mode: 'plan', // 'plan' or 'live'
            isRunning: false,
            elapsedSeconds: 0,
            currentInterval: 1,
            selectedPlanInterval: 1,
            players: [],
            // Store lineups for each interval: { 1: [player IDs], 2: [...], etc }
            intervalLineups: {},
            lastIntervalTime: 0,
            // Score tracking
            scoreUs: 0,
            scoreThem: 0,
            goalHistory: [], // Array of { playerId, time, team: 'us'|'them' }
            // Match events log
            matchEvents: [], // Array of { type: 'goal'|'sub', time, details }
            // Testing
            speedMultiplier: 1 // 1x, 5x, or 10x for testing
        };

        // Drag state
        this.dragState = {
            draggingPlayer: null,
            sourceSlot: null,
            sourceLocation: null // 'pitch' or 'bench'
        };

        // Flag to prevent auto-fill after removal
        this.justRemovedPlayer = false;
        this.justAddedPlayer = false;
        this.lastRemovedPlayer = null; // Track last removed player for undo

        // Slot fill order: top to bottom, left to right
        // FW, LW, LCM, RCM, RW, LB, CB, RB, GK
        this.slotFillOrder = [8, 4, 5, 6, 7, 1, 2, 3, 0];

        // Timer
        this.timerInterval = null;

        this.init();
    }

    init() {
        // Dev mode: clear localStorage if ?clear is in URL
        if (window.location.search.includes('clear')) {
            localStorage.removeItem('teamSelectorState');
            // Remove ?clear from URL without reload
            history.replaceState(null, '', window.location.pathname + window.location.hash);
        }
        
        // If shared plan in URL, clear localStorage first so it takes precedence
        const hash = window.location.hash.slice(1);
        if (hash && hash.includes('p=') && hash.includes('l=')) {
            localStorage.removeItem('teamSelectorState');
        }
        
        this.loadState();
        // Check for shared plan in URL (overrides saved state)
        if (window.location.hash) {
            this.loadFromUrl();
        }
        this.initializeIntervalLineups();
        this.setupEventListeners();
        this.setupDropZones(); // Setup drop zones once
        this.render();
    }

    // ==================== STATE MANAGEMENT ====================

    loadState() {
        const saved = localStorage.getItem('teamSelectorState');
        if (saved) {
            const parsed = JSON.parse(saved);
            this.settings = { ...this.settings, ...parsed.settings };
            this.state = { ...this.state, ...parsed.state };
        }

        // Ensure new state properties have default values
        if (!this.state.speedMultiplier) this.state.speedMultiplier = 1;
        if (!this.state.scoreUs) this.state.scoreUs = 0;
        if (!this.state.scoreThem) this.state.scoreThem = 0;
        if (!this.state.goalHistory) this.state.goalHistory = [];
        if (!this.state.matchEvents) this.state.matchEvents = [];

        // Load sample players if none exist
        if (this.state.players.length === 0) {
            this.loadSamplePlayers();
        }
    }

    saveState() {
        localStorage.setItem('teamSelectorState', JSON.stringify({
            settings: this.settings,
            state: this.state
        }));
    }

    initializeIntervalLineups() {
        // Initialize lineups for each interval if not already set
        for (let i = 1; i <= this.settings.intervalCount; i++) {
            if (!this.state.intervalLineups[i]) {
                // Copy from previous interval or use first 9 players
                if (i === 1) {
                    this.state.intervalLineups[i] = this.state.players
                        .slice(0, 9)
                        .map(p => p.id);
                    // Pad with nulls if not enough players
                    while (this.state.intervalLineups[i].length < 9) {
                        this.state.intervalLineups[i].push(null);
                    }
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
        this.renderIntervalTabs();
        this.renderPitch();
        this.renderBench();
        this.renderStats();
    }

    loadSamplePlayers() {
        // Default lineup: GK, LB, CB, RB, LW, CM, CM, RW, FW
        // Slot order: 0=GK, 1=LB, 2=CB, 3=RB, 4=LW, 5=CM, 6=CM, 7=RW, 8=FW
        const defaultSquad = [
            { name: 'Felix', number: 1 },      // GK - slot 0
            { name: 'Chester', number: 2 },   // LB - slot 1
            { name: 'Elliott', number: 3 },   // CB - slot 2
            { name: 'Lucas', number: 4 },     // RB - slot 3
            { name: 'Stuart', number: 5 },    // LW - slot 4
            { name: 'Jaxson', number: 6 },    // CM - slot 5
            { name: 'Dylan', number: 7 },     // CM - slot 6
            { name: 'Alfie S', number: 8 },   // RW - slot 7
            { name: 'Ollie', number: 9 },     // FW - slot 8
            // Substitutes
            { name: 'Leo', number: 10 },
            { name: 'Sophie', number: 11 },
            { name: 'Alfie B', number: 12 },
            { name: 'Jude', number: 13 }
        ];

        defaultSquad.forEach((player, index) => {
            this.state.players.push({
                id: index + 1,
                name: player.name,
                number: player.number,
                minutesPlayed: 0
            });
        });

        this.saveState();
    }

    getCurrentLineup() {
        if (this.state.mode === 'plan') {
            return this.state.intervalLineups[this.state.selectedPlanInterval] || Array(9).fill(null);
        }
        return this.state.intervalLineups[this.state.currentInterval] || Array(9).fill(null);
    }

    setCurrentLineup(lineup) {
        if (this.state.mode === 'plan') {
            this.state.intervalLineups[this.state.selectedPlanInterval] = lineup;
        } else {
            this.state.intervalLineups[this.state.currentInterval] = lineup;
        }
        this.saveState();
    }

    // ==================== EVENT LISTENERS ====================

    setupEventListeners() {
        // Mode tabs
        document.getElementById('plan-mode-btn').addEventListener('click', () => this.setMode('plan'));
        document.getElementById('live-mode-btn').addEventListener('click', () => this.setMode('live'));

        // Settings toggle
        document.getElementById('toggle-settings').addEventListener('click', () => {
            const content = document.getElementById('settings-content');
            const isVisible = content.style.display !== 'none';
            content.style.display = isVisible ? 'none' : 'block';
            // Close squad if opening settings
            if (!isVisible) document.getElementById('squad-content').style.display = 'none';
        });

        // Squad toggle
        document.getElementById('toggle-squad').addEventListener('click', () => {
            const content = document.getElementById('squad-content');
            const isVisible = content.style.display !== 'none';
            content.style.display = isVisible ? 'none' : 'block';
            // Close settings if opening squad
            if (!isVisible) document.getElementById('settings-content').style.display = 'none';
        });

        // Settings inputs
        document.getElementById('match-duration').addEventListener('change', (e) => {
            this.settings.matchDuration = parseInt(e.target.value) || 60;
            this.updateIntervalDisplay();
            this.saveState();
        });

        // Interval count (Plan mode) - stepper buttons
        document.getElementById('interval-dec').addEventListener('click', () => {
            const newCount = Math.max(1, this.settings.intervalCount - 1);
            this.updateIntervalCount(newCount);
            document.getElementById('interval-count').textContent = newCount;
        });
        document.getElementById('interval-inc').addEventListener('click', () => {
            const newCount = Math.min(6, this.settings.intervalCount + 1);
            this.updateIntervalCount(newCount);
            document.getElementById('interval-count').textContent = newCount;
        });

        // Timer controls
        document.getElementById('start-btn').addEventListener('click', () => this.startTimer());
        document.getElementById('pause-btn').addEventListener('click', () => this.pauseTimer());
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
        document.getElementById('share-plan-btn').addEventListener('click', () => this.sharePlan());

        // Copy from previous interval button
        document.getElementById('copy-prev-btn').addEventListener('click', () => this.copyFromPreviousInterval());

        // Set initial values
        document.getElementById('match-duration').value = this.settings.matchDuration;
        document.getElementById('interval-count').textContent = this.settings.intervalCount;
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
        
        overlay.style.display = 'flex';
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
        document.getElementById('assist-picker').style.display = 'none';
    }

    finalizeGoal(playerId, assistPlayerId, team) {
        if (team === 'us') {
            this.state.scoreUs++;
        } else {
            this.state.scoreThem++;
        }
        
        // Haptic feedback for goals
        if ('vibrate' in navigator) {
            if (team === 'us') {
                navigator.vibrate([100, 50, 100]); // Double pulse for our goal
            } else {
                navigator.vibrate(100); // Single pulse for opponent goal
            }
        }
        
        this.state.goalHistory.push({
            playerId: playerId,
            assistPlayerId: assistPlayerId,
            time: this.state.elapsedSeconds,
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
            time: this.state.elapsedSeconds,
            team: team,
            scorer: scorerName,
            assist: assistName,
            score: `${this.state.scoreUs} - ${this.state.scoreThem}`
        });

        this.updateScoreDisplay();
        this.renderMatchEvents();
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
        this.saveState();
    }

    updateScoreDisplay() {
        document.getElementById('score-us').textContent = this.state.scoreUs;
        document.getElementById('score-them').textContent = this.state.scoreThem;
    }

    // ==================== TIMER FUNCTIONS ====================

    toggleSpeed() {
        const speeds = [1, 5, 10];
        const currentIndex = speeds.indexOf(this.state.speedMultiplier);
        this.state.speedMultiplier = speeds[(currentIndex + 1) % speeds.length];
        
        // Restart timer with new speed if running
        if (this.state.isRunning) {
            clearInterval(this.timerInterval);
            this.startTimerInterval();
        }
        
        this.updateTimerDisplay();
        this.saveState();
    }

    startTimerInterval() {
        const interval = 1000 / this.state.speedMultiplier;
        this.timerInterval = setInterval(() => {
            this.state.elapsedSeconds++;
            this.updateTimerDisplay();
            this.updatePlayerMinutes();
            this.checkIntervalChange();
            this.saveState();
        }, interval);
    }

    startTimer() {
        if (this.state.isRunning) return;

        this.state.isRunning = true;
        document.getElementById('start-btn').disabled = true;
        document.getElementById('pause-btn').disabled = false;

        this.startTimerInterval();
    }

    pauseTimer() {
        if (!this.state.isRunning) return;

        this.state.isRunning = false;
        document.getElementById('start-btn').disabled = false;
        document.getElementById('pause-btn').disabled = true;

        clearInterval(this.timerInterval);
        this.saveState();
    }

    // ==================== MODE SWITCHING ====================

    setMode(mode) {
        this.state.mode = mode;
        
        // Update UI
        document.getElementById('plan-mode-btn').classList.toggle('active', mode === 'plan');
        document.getElementById('live-mode-btn').classList.toggle('active', mode === 'live');
        document.getElementById('plan-controls').style.display = mode === 'plan' ? 'block' : 'none';
        document.getElementById('live-controls').style.display = mode === 'live' ? 'block' : 'none';
        document.getElementById('share-plan-btn').style.display = mode === 'plan' ? 'inline-block' : 'none';
        document.getElementById('timer-buttons').style.display = mode === 'live' ? 'flex' : 'none';
        
        // Show live hint overlay when switching to live mode
        if (mode === 'live') {
            const overlay = document.getElementById('live-hint-overlay');
            overlay.classList.remove('hidden');
            setTimeout(() => overlay.classList.add('hidden'), 3000);
        }
        
        // Toggle stats vs events section
        document.getElementById('stats-section').style.display = mode === 'plan' ? 'block' : 'none';
        document.getElementById('events-section').style.display = mode === 'live' ? 'block' : 'none';
        
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
        this.renderIntervalTabs();
        this.renderPitch();
        this.renderBench();
        this.saveState();
    }

    copyFromPreviousInterval() {
        const current = this.state.selectedPlanInterval;
        if (current > 1) {
            this.state.intervalLineups[current] = [...this.state.intervalLineups[current - 1]];
            this.renderPitch();
            this.renderBench();
            this.saveState();
        }
    }

    updateTimerDisplay() {
        const minutes = Math.floor(this.state.elapsedSeconds / 60);
        const seconds = this.state.elapsedSeconds % 60;
        const timeStr = `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
        const speedStr = this.state.speedMultiplier > 1 ? ` (${this.state.speedMultiplier}x)` : '';
        document.getElementById('current-time').textContent = timeStr + speedStr;
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
        const expectedInterval = Math.floor(this.state.elapsedSeconds / intervalDuration) + 1;
        
        if (expectedInterval > this.state.currentInterval && 
            this.state.currentInterval < this.settings.intervalCount) {
            this.triggerIntervalChange(expectedInterval);
        }
    }

    triggerIntervalChange(newInterval) {
        this.state.currentInterval = newInterval;
        this.updateIntervalDisplay();
        this.showIntervalNotification();
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
        const notification = document.createElement('div');
        notification.className = 'interval-indicator';
        notification.innerHTML = `
            <h2>🔄 Interval ${this.state.currentInterval}</h2>
            <p>Time to make substitutions!</p>
        `;
        document.body.appendChild(notification);

        setTimeout(() => {
            notification.remove();
        }, 3000);
    }

    resetMatch() {
        if (confirm('Reset the match? This will reset the timer, scores, and player minutes.')) {
            this.pauseTimer();
            this.state.elapsedSeconds = 0;
            this.state.currentInterval = 1;
            this.state.scoreUs = 0;
            this.state.scoreThem = 0;
            this.state.goalHistory = [];
            this.state.matchEvents = [];
            this.state.players.forEach(p => {
                p.minutesPlayed = 0;
                p.goals = 0;
            });
            this.updateTimerDisplay();
            this.updateIntervalDisplay();
            this.updateScoreDisplay();
            this.renderStats();
            this.renderMatchEvents();
            this.renderPitch();
            this.renderBench();
            this.saveState();
        }
    }

    // ==================== PLAYER MANAGEMENT ====================

    addPlayer() {
        const input = document.getElementById('new-player-name');
        const name = input.value.trim();

        if (!name) return;

        const maxNumber = this.state.players.reduce((max, p) => Math.max(max, p.number), 0);
        const maxId = this.state.players.reduce((max, p) => Math.max(max, p.id), 0);

        this.state.players.push({
            id: maxId + 1,
            name: name,
            number: maxNumber + 1,
            minutesPlayed: 0
        });

        input.value = '';
        this.saveState();
        this.renderRoster();
        this.renderBench();
        this.renderStats();
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
        // Add a second to each player on pitch (use live interval)
        const currentLineup = this.state.intervalLineups[this.state.currentInterval] || [];
        currentLineup.forEach(playerId => {
            if (playerId !== null) {
                const player = this.getPlayerById(playerId);
                if (player) {
                    player.minutesPlayed += 1/60; // Convert seconds to minutes
                }
            }
        });

        // Update display every 10 seconds
        if (this.state.elapsedSeconds % 10 === 0) {
            this.renderStats();
            this.renderPitch();
            this.renderBench();
        }
    }

    // ==================== DRAG AND DROP ====================

    setupDragForPlayer(element, playerId, location, slotIndex = null) {
        let isDragging = false;
        let startX, startY;
        const dragThreshold = 10;
        let longPressTimer = null;
        const longPressDuration = 1000; // ms to trigger goal

        // Long press handler for goals (only in live mode, only on pitch)
        const startLongPress = () => {
            if (this.state.mode !== 'live' || location !== 'pitch') return;
            longPressTimer = setTimeout(() => {
                this.recordGoal(playerId, 'us');
                element.classList.add('scoring');
                setTimeout(() => element.classList.remove('scoring'), 500);
                longPressTimer = null;
            }, longPressDuration);
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
            const dragPreview = document.createElement('div');
            dragPreview.className = 'drag-preview';
            const player = this.getPlayerById(playerId);
            dragPreview.textContent = player ? player.name : '';
            document.body.appendChild(dragPreview);
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
            e.stopPropagation(); // Prevent triggering slot click
            if (isDragging) return;
            if (location === 'pitch') {
                this.removePlayerFromPitch(slotIndex);
            } else if (location === 'bench') {
                this.addBenchPlayerToPitch(playerId);
            }
        });

        // Touch events for mobile
        let touchMoved = false;
        let longPressTriggered = false;
        
        element.addEventListener('touchstart', (e) => {
            touchMoved = false;
            longPressTriggered = false;
            startX = e.touches[0].clientX;
            startY = e.touches[0].clientY;
            this.startDrag(playerId, location, slotIndex);
            
            // Start long press timer for goals
            if (this.state.mode === 'live' && location === 'pitch') {
                longPressTimer = setTimeout(() => {
                    longPressTriggered = true;
                    this.recordGoal(playerId, 'us');
                    element.classList.add('scoring');
                    setTimeout(() => element.classList.remove('scoring'), 500);
                }, longPressDuration);
            }
        }, { passive: true });

        element.addEventListener('touchmove', (e) => {
            const touch = e.touches[0];
            const dx = Math.abs(touch.clientX - startX);
            const dy = Math.abs(touch.clientY - startY);
            
            if (dx > dragThreshold || dy > dragThreshold) {
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
                // Goal was recorded, don't do anything else
                this.endDrag();
                return;
            }
            
            if (touchMoved) {
                const touch = e.changedTouches[0];
                // Hide the dragging element to find what's underneath
                element.style.display = 'none';
                const targetElement = document.elementFromPoint(touch.clientX, touch.clientY);
                element.style.display = '';
                
                if (targetElement) {
                    const targetSlot = targetElement.closest('.player-slot');
                    const targetBench = targetElement.closest('.bench');
                    const targetCard = targetElement.closest('.player-card');
                    
                    if (targetSlot) {
                        const targetSlotIndex = parseInt(targetSlot.dataset.slot);
                        this.handleDrop(targetSlotIndex, 'pitch');
                    } else if (targetBench) {
                        this.handleDrop(null, 'bench');
                    } else if (targetCard) {
                        // Dropped on another player card - find its slot
                        const parentSlot = targetCard.closest('.player-slot');
                        if (parentSlot) {
                            const targetSlotIndex = parseInt(parentSlot.dataset.slot);
                            this.handleDrop(targetSlotIndex, 'pitch');
                        }
                    }
                }
                this.clearAllDragOverStates();
            } else {
                // Tap - remove from pitch or add bench player to pitch
                e.stopPropagation();
                if (location === 'pitch') {
                    this.removePlayerFromPitch(slotIndex);
                } else if (location === 'bench') {
                    this.addBenchPlayerToPitch(playerId);
                }
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
        this.lastRemovedPlayer = lineup[slotIndex]; // Store removed player for undo
        lineup[slotIndex] = null;
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
        
        // Use last removed player if available and still on bench
        let playerToAdd = null;
        if (this.lastRemovedPlayer && !this.isPlayerOnPitch(this.lastRemovedPlayer)) {
            playerToAdd = this.lastRemovedPlayer;
        }
        
        if (!playerToAdd) return;
        
        const newLineup = [...lineup];
        newLineup[slotIndex] = playerToAdd;
        this.setCurrentLineup(newLineup);
        this.lastRemovedPlayer = null; // Clear after use
        this.renderPitch();
        this.renderBench();
        this.renderStats();
    }

    startDrag(playerId, location, slotIndex) {
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
            
            // Record substitution in live mode (only for bench to pitch moves)
            if (sourceLocation === 'bench' && this.state.mode === 'live' && playerInTarget) {
                const playerIn = this.getPlayerById(draggingPlayer);
                const playerOut = this.getPlayerById(playerInTarget);
                
                this.state.matchEvents.push({
                    type: 'sub',
                    time: this.state.elapsedSeconds,
                    playerIn: playerIn ? playerIn.name : 'Unknown',
                    playerOut: playerOut ? playerOut.name : 'Empty slot'
                });
                this.renderMatchEvents();
            }
        } else if (targetLocation === 'bench') {
            if (sourceLocation === 'pitch' && sourceSlot !== null) {
                lineup[sourceSlot] = null;
            }
        }

        this.setCurrentLineup(lineup);
        this.renderPitch();
        this.renderBench();
    }

    handleDropOnBenchPlayer(benchPlayerId) {
        if (!this.dragState.draggingPlayer) return;
        
        const { draggingPlayer, sourceLocation, sourceSlot } = this.dragState;
        
        // Only handle pitch -> bench player swaps
        if (sourceLocation !== 'pitch' || sourceSlot === null) return;
        
        const lineup = [...this.getCurrentLineup()];
        
        // Put the bench player in the pitch slot
        lineup[sourceSlot] = benchPlayerId;
        
        // Record substitution in live mode
        if (this.state.mode === 'live') {
            const playerIn = this.getPlayerById(benchPlayerId);
            const playerOut = this.getPlayerById(draggingPlayer);
            
            this.state.matchEvents.push({
                type: 'sub',
                time: this.state.elapsedSeconds,
                playerIn: playerIn ? playerIn.name : 'Unknown',
                playerOut: playerOut ? playerOut.name : 'Unknown'
            });
            this.renderMatchEvents();
        }
        
        this.setCurrentLineup(lineup);
        this.renderPitch();
        this.renderBench();
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
        const container = document.getElementById('interval-tabs');
        container.innerHTML = '';
        
        for (let i = 1; i <= this.settings.intervalCount; i++) {
            const tab = document.createElement('button');
            tab.className = 'interval-tab' + (i === this.state.selectedPlanInterval ? ' active' : '');
            tab.textContent = `${i}`;
            tab.addEventListener('click', () => this.selectPlanInterval(i));
            container.appendChild(tab);
        }

        // Show/hide copy previous button
        const copyBtn = document.getElementById('copy-prev-btn');
        copyBtn.style.display = this.state.selectedPlanInterval > 1 ? 'inline-block' : 'none';
    }

    renderPitch() {
        const slots = document.querySelectorAll('.player-slot');
        const lineup = this.getCurrentLineup();
        
        slots.forEach((slot) => {
            const index = parseInt(slot.dataset.slot);
            slot.innerHTML = '';
            slot.classList.remove('has-player');
            
            const playerId = lineup[index];
            
            if (playerId !== null) {
                const player = this.getPlayerById(playerId);
                if (player) {
                    slot.classList.add('has-player');
                    const playerCard = this.createPlayerCard(player, 'pitch', index);
                    slot.appendChild(playerCard);
                }
            }
        });
    }

    renderBench() {
        const bench = document.getElementById('bench');
        bench.innerHTML = '';
        
        const benchPlayers = this.getBenchPlayers();
        
        benchPlayers.forEach(player => {
            const playerCard = this.createPlayerCard(player, 'bench');
            bench.appendChild(playerCard);
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
        const bench = document.getElementById('bench');
        this.setupDropZone(bench, 'bench');
    }

    createPlayerCard(player, location, slotIndex = null) {
        const card = document.createElement('div');
        card.className = 'player-card';
        card.dataset.playerId = player.id;
        
        const minutes = Math.floor(player.minutesPlayed);
        const plannedMinutes = this.getPlannedMinutes(player.id);
        
        // Show planned minutes in plan mode, actual minutes in live mode
        const displayMinutes = this.state.mode === 'plan' ? plannedMinutes : minutes;
        const minuteLabel = this.state.mode === 'plan' ? `${plannedMinutes}'` : `${minutes}'`;
        
        card.innerHTML = `
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
        const statsTable = document.getElementById('stats-table');
        const statsHeading = document.getElementById('stats-heading');
        statsTable.innerHTML = '';
        
        // Update heading based on mode
        if (statsHeading) {
            statsHeading.textContent = this.state.mode === 'plan' ? '📊 Planned Minutes' : '📊 Player Minutes';
        }

        // Render substitution summary (Plan mode only)
        const subsSummary = document.getElementById('subs-summary');
        if (subsSummary) {
            if (this.state.mode === 'plan') {
                const changes = this.getIntervalChanges();
                if (changes.length === 0) {
                    subsSummary.innerHTML = '<div class="no-subs">No substitutions planned</div>';
                } else {
                    subsSummary.innerHTML = changes.map(c => `
                        <div class="sub-change">
                            <span class="sub-interval">Int ${c.interval}:</span>
                            ${c.on.map(p => `<span class="sub-on">↑ ${p.name}</span>`).join('')}
                            ${c.off.map(p => `<span class="sub-off">↓ ${p.name}</span>`).join('')}
                        </div>
                    `).join('');
                }
                subsSummary.style.display = 'block';
            } else {
                subsSummary.style.display = 'none';
            }
        }

        const intervalDuration = this.settings.matchDuration / this.settings.intervalCount;
        
        // Calculate planned or actual minutes for sorting
        const playersWithStats = this.state.players.map(p => ({
            ...p,
            plannedMinutes: this.getPlannedMinutes(p.id),
            displayMinutes: this.state.mode === 'plan' ? this.getPlannedMinutes(p.id) : Math.floor(p.minutesPlayed)
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
            
            statsTable.appendChild(row);
        });
    }

    renderMatchEvents() {
        const eventsLog = document.getElementById('events-log');
        if (!eventsLog) return;
        
        eventsLog.innerHTML = '';
        
        if (this.state.matchEvents.length === 0) {
            eventsLog.innerHTML = '<div class="no-events">No match events yet</div>';
            return;
        }
        
        // Show events in reverse order (newest first)
        const events = [...this.state.matchEvents].reverse();
        
        events.forEach((event, reversedIndex) => {
            const originalIndex = this.state.matchEvents.length - 1 - reversedIndex;
            const eventDiv = document.createElement('div');
            eventDiv.className = `match-event event-${event.type}`;
            
            const minutes = Math.floor(event.time / 60);
            const timeStr = `${minutes}'`;
            
            if (event.type === 'goal') {
                const icon = event.team === 'us' ? '⚽' : '🔴';
                const assistText = event.assist ? ` (assist: ${event.assist})` : '';
                eventDiv.innerHTML = `
                    <span class="event-time">${timeStr}</span>
                    <span class="event-icon">${icon}</span>
                    <span class="event-detail">
                        <strong>GOAL</strong> - ${event.scorer}${assistText}
                        <span class="event-score">${event.score}</span>
                    </span>
                    <button class="event-delete-btn" data-index="${originalIndex}">✕</button>
                `;
            } else if (event.type === 'sub') {
                eventDiv.innerHTML = `
                    <span class="event-time">${timeStr}</span>
                    <span class="event-icon">🔄</span>
                    <span class="event-detail">
                        <span class="sub-in">↑ ${event.playerIn}</span>
                        <span class="sub-out">↓ ${event.playerOut}</span>
                    </span>
                    <button class="event-delete-btn" data-index="${originalIndex}">✕</button>
                `;
            }
            
            // Add delete handler
            const deleteBtn = eventDiv.querySelector('.event-delete-btn');
            if (deleteBtn) {
                deleteBtn.addEventListener('click', () => this.deleteMatchEvent(originalIndex));
            }
            
            eventsLog.appendChild(eventDiv);
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
        const rosterList = document.getElementById('roster-list');
        rosterList.innerHTML = '';

        this.state.players.forEach(player => {
            const item = document.createElement('div');
            item.className = 'roster-item';
            
            item.innerHTML = `
                <div class="player-info">
                    <span class="player-number-badge">${player.number}</span>
                    <span>${player.name}</span>
                </div>
                <button class="delete-btn" data-player-id="${player.id}">✕</button>
            `;
            
            item.querySelector('.delete-btn').addEventListener('click', () => {
                if (confirm(`Remove ${player.name} from the squad?`)) {
                    this.removePlayer(player.id);
                }
            });
            
            rosterList.appendChild(item);
        });
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
