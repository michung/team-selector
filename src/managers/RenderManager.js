import { CONFIG, MODES, POSITIONS } from '../config.js';

/**
 * Handles all UI rendering for the application
 */
export class RenderManager {
    constructor(app) {
        this.app = app;
    }

    get state() { return this.app.state; }
    get settings() { return this.app.settings; }
    get elements() { return this.app.elements; }

    /**
     * Render the pitch with current lineup
     */
    renderPitch() {
        const slots = document.querySelectorAll('.player-slot');
        
        // Use direct state access for reliable rendering
        let lineup;
        if (this.app.state.mode === 'live') {
            lineup = this.app.state.liveLineup || this.app.state.intervalLineups[1] || [];
        } else {
            lineup = this.app.state.intervalLineups[this.app.state.selectedPlanInterval] || [];
        }
        
        slots.forEach((slot) => {
            const index = parseInt(slot.dataset.slot);
            slot.innerHTML = '';
            slot.classList.remove('has-player');
            
            const positionSlot = slot.closest('.position-slot');
            if (positionSlot) positionSlot.classList.remove('has-player');
            
            const playerId = lineup[index];
            
            if (playerId !== null) {
                const player = this.app.getPlayerById(playerId);
                if (player) {
                    slot.classList.add('has-player');
                    if (positionSlot) positionSlot.classList.add('has-player');
                    const playerCard = this.createPlayerCard(player, 'pitch', index);
                    slot.appendChild(playerCard);
                }
            }
        });
    }

    /**
     * Render the bench with available players
     */
    renderBench() {
        this.elements.bench.innerHTML = '';
        const benchPlayers = this.app.getBenchPlayers();
        
        benchPlayers.forEach(player => {
            const playerCard = this.createPlayerCard(player, 'bench');
            this.elements.bench.appendChild(playerCard);
        });
    }

    /**
     * Render the stats table
     */
    renderStats() {
        this.elements.statsTable.innerHTML = '';
        
        if (this.elements.statsHeading) {
            this.elements.statsHeading.textContent = this.state.mode === 'plan' 
                ? '📊 Planned Minutes' 
                : '📊 Player Minutes';
        }

        // Render subs summary in plan mode
        this.renderSubsSummary();

        const playersWithStats = this.state.players.map(p => ({
            ...p,
            plannedMinutes: this.getPlannedMinutes(p.id),
            displayMinutes: this.state.mode === 'plan' 
                ? this.getPlannedMinutes(p.id) 
                : Math.floor(this.app.getPlayerCurrentMinutes(p.id))
        }));

        const sortedPlayers = playersWithStats.sort((a, b) => a.displayMinutes - b.displayMinutes);
        const avgMinutes = playersWithStats.reduce((sum, p) => sum + p.displayMinutes, 0) / playersWithStats.length;

        sortedPlayers.forEach(player => {
            const row = this.createStatRow(player, avgMinutes);
            this.elements.statsTable.appendChild(row);
        });
    }

    /**
     * Render subs summary for plan mode
     */
    renderSubsSummary() {
        if (!this.elements.subsSummary) return;
        
        if (this.state.mode === 'plan') {
            const changes = this.app.getIntervalChanges();
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
                            <span class="event-detail event-detail-subs">${subsHtml}</span>
                        </div>
                    `;
                }).join('');
            }
            this.elements.subsSummary.style.display = 'block';
        } else {
            this.elements.subsSummary.style.display = 'none';
        }
    }

    /**
     * Render interval tabs for plan mode
     */
    renderIntervalTabs() {
        this.elements.intervalTabs.innerHTML = '';
        
        for (let i = 1; i <= this.settings.intervalCount; i++) {
            const tab = document.createElement('button');
            tab.className = `interval-tab ${i === this.state.selectedPlanInterval ? 'active' : ''}`;
            tab.dataset.interval = i;
            tab.draggable = true;
            tab.textContent = i;
            
            tab.addEventListener('click', () => this.app.selectInterval(i));
            
            // Drag to copy lineup (desktop)
            tab.addEventListener('dragstart', (e) => {
                e.dataTransfer.setData('interval', i.toString());
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
                const sourceInterval = parseInt(e.dataTransfer.getData('interval'));
                if (sourceInterval && sourceInterval !== i) {
                    this.app.copyLineup(sourceInterval, i);
                }
            });
            
            // Touch support for copying intervals (shorter hold = 300ms)
            let touchTimer = null;
            let touchStartX = 0;
            let touchStartY = 0;
            let draggingInterval = null;
            
            tab.addEventListener('touchstart', (e) => {
                touchStartX = e.touches[0].clientX;
                touchStartY = e.touches[0].clientY;
                touchTimer = setTimeout(() => {
                    draggingInterval = i;
                    tab.classList.add('dragging');
                    this.app.hapticFeedback([30]);
                    this.app.showToast(`Drag to copy interval ${i}`, 'default', 1500);
                }, 300); // Shorter than normal long press
            }, { passive: true });
            
            tab.addEventListener('touchmove', (e) => {
                const dx = Math.abs(e.touches[0].clientX - touchStartX);
                const dy = Math.abs(e.touches[0].clientY - touchStartY);
                if (dx > 5 || dy > 5) {
                    clearTimeout(touchTimer);
                }
            }, { passive: true });
            
            tab.addEventListener('touchend', (e) => {
                clearTimeout(touchTimer);
                tab.classList.remove('dragging');
                
                if (draggingInterval !== null) {
                    // Find which tab we're over
                    const touch = e.changedTouches[0];
                    const targetEl = document.elementFromPoint(touch.clientX, touch.clientY);
                    const targetTab = targetEl?.closest('.interval-tab');
                    if (targetTab) {
                        const targetInterval = parseInt(targetTab.dataset.interval);
                        if (targetInterval && targetInterval !== draggingInterval) {
                            this.app.copyLineup(draggingInterval, targetInterval);
                        }
                    }
                    draggingInterval = null;
                }
            });
            
            tab.addEventListener('touchcancel', () => {
                clearTimeout(touchTimer);
                tab.classList.remove('dragging');
                draggingInterval = null;
            });
            
            this.elements.intervalTabs.appendChild(tab);
        }
    }

    /**
     * Render roster management section
     */
    renderRoster() {
        const rosterList = document.getElementById('roster-list');
        if (!rosterList) return;
        
        rosterList.innerHTML = '';
        
        this.state.players.forEach(player => {
            const item = this.createRosterItem(player);
            rosterList.appendChild(item);
        });
    }

    /**
     * Create a player card element
     */
    createPlayerCard(player, location, slotIndex = null) {
        const card = document.createElement('div');
        card.className = 'player-card';
        card.dataset.playerId = player.id;
        card.draggable = true;
        
        // Use getDisplayMinutes for live mode to properly cap at half duration (no added time counting)
        const currentElapsed = this.app.getElapsedSeconds();
        const minutes = this.app.getDisplayMinutes(player, currentElapsed);
        const plannedMinutes = this.getPlannedMinutes(player.id);
        
        const displayMinutes = this.state.mode === 'plan' ? plannedMinutes : minutes;
        const minuteLabel = `${displayMinutes}'`;
        
        // Goal indicator in live mode
        const goals = player.goals || 0;
        const goalIndicator = this.state.mode === 'live' && goals > 0 
            ? `<span class="goal-indicator">${goals > 1 ? '⚽×' + goals : '⚽'}</span>` 
            : '';
        const statsBadge = goalIndicator 
            ? `<span class="player-stats-badge">${goalIndicator}</span>` 
            : '';
        
        // Pin indicator in plan mode
        const isPinned = this.state.mode === 'plan' && location === 'pitch' && slotIndex !== null 
            && this.app.isPositionPinned(this.state.selectedPlanInterval, slotIndex);
        const pinBadge = isPinned ? '<span class="pin-badge">📌</span>' : '';
        
        // Player rating badge (average of both raters, only show if match ended AND in live mode AND both ratings exist)
        const showRatings = this.state.matchEnded && this.state.mode === 'live';
        const managerRating = this.state.managerRatings?.[player.id];
        const assistantRating = this.state.assistantRatings?.[player.id];
        const hasBothRatings = managerRating !== undefined && assistantRating !== undefined;
        
        // Calculate average (only when both exist)
        let avgRating = null;
        if (hasBothRatings) {
            avgRating = ((managerRating + assistantRating) / 2).toFixed(1);
        }
        
        // POTM: only show manager's selection
        const isPotm = showRatings && this.state.managerPotm === player.id;
        
        const ratingBadge = showRatings && hasBothRatings && !isPotm
            ? `<span class="player-rating-badge ${avgRating >= 8 ? 'rating-high' : avgRating <= 4 ? 'rating-low' : ''}">${avgRating}</span>` 
            : '';
        
        // Player of the Match star badge with rating inside
        const potmBadge = isPotm ? `<span class="player-potm-badge">${avgRating || ''}</span>` : '';
        
        card.innerHTML = `
            ${statsBadge}
            ${pinBadge}
            ${ratingBadge}
            ${potmBadge}
            <span class="player-name">${player.name}</span>
            <span class="player-minutes">${minuteLabel}</span>
        `;
        
        this.app.setupDragForPlayer(card, player.id, location, slotIndex);
        
        // Setup drop handling for player cards
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
                this.app.handleDrop(slotIndex, 'pitch');
            });
        } else if (location === 'bench') {
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
                this.app.handleDropOnBenchPlayer(player.id);
            });
        }
        
        return card;
    }

    /**
     * Create a stat row element
     */
    createStatRow(player, avgMinutes) {
        const row = document.createElement('div');
        row.className = 'stat-row';
        
        const isOnPitch = this.app.isPlayerOnPitch(player.id);
        
        let minuteClass = '';
        if (player.displayMinutes < avgMinutes * 0.5) {
            minuteClass = 'very-low';
        } else if (player.displayMinutes < avgMinutes * 0.8) {
            minuteClass = 'low';
        }
        
        const intervalsOnPitch = this.app.getIntervalsForPlayer(player.id);
        
        row.innerHTML = `
            <div class="player-info">
                <span class="player-number-badge">${player.number}</span>
                <span class="player-name">${player.name}</span>
                ${isOnPitch ? '<span class="on-pitch">⚽</span>' : ''}
            </div>
            <div class="minutes-info">
                ${this.state.mode === 'plan' ? `<span class="intervals">${intervalsOnPitch}</span>` : ''}
                <span class="minutes ${minuteClass}">${player.displayMinutes}'</span>
            </div>
        `;
        
        return row;
    }

    /**
     * Create roster item for squad management
     */
    createRosterItem(player) {
        const item = document.createElement('div');
        item.className = 'roster-item';
        
        const positionChips = Object.entries(POSITIONS).map(([slot, name]) => {
            const slotNum = parseInt(slot);
            const prefs = player.preferredPositions || [];
            const priority = prefs.indexOf(slotNum);
            const isSelected = priority !== -1;
            
            return `<span class="position-chip ${isSelected ? 'selected' : ''}" 
                          data-slot="${slotNum}" 
                          title="${isSelected ? `Priority ${priority + 1}` : 'Click to add'}">
                ${name}${isSelected ? `<sub>${priority + 1}</sub>` : ''}
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
        
        // Setup position chip clicks
        item.querySelectorAll('.position-chip').forEach(chip => {
            chip.addEventListener('click', () => {
                const slot = parseInt(chip.dataset.slot);
                this.app.togglePlayerPosition(player.id, slot);
            });
        });
        
        // Delete button
        item.querySelector('.delete-btn').addEventListener('click', () => {
            this.app.deletePlayer(player.id);
        });
        
        return item;
    }

    /**
     * Calculate planned minutes for a player
     */
    getPlannedMinutes(playerId) {
        const intervalDuration = this.settings.matchDuration / this.settings.intervalCount;
        let totalIntervals = 0;
        
        for (let i = 1; i <= this.settings.intervalCount; i++) {
            if (this.state.intervalLineups[i] && this.state.intervalLineups[i].includes(playerId)) {
                totalIntervals++;
            }
        }
        
        return Math.round(totalIntervals * intervalDuration);
    }

    /**
     * Update score display
     */
    updateScoreDisplay() {
        document.getElementById('score-us').textContent = this.state.scoreUs;
        document.getElementById('score-them').textContent = this.state.scoreThem;
    }

    /**
     * Update timer display
     */
    updateTimerDisplay() {
        this.app.timer.updateDisplay();
    }
}
