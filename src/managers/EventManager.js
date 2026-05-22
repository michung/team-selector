import { CONFIG, MODES } from '../config.js';

/**
 * Manages match events (goals, substitutions, etc.)
 */
export class EventManager {
    constructor(app) {
        this.app = app;
        this.pendingGoal = null;
    }

    get state() { return this.app.state; }
    get elements() { return this.app.elements; }

    /**
     * Record a goal
     * @param {number|null} playerId - Scorer ID (null for opponent goals)
     * @param {string} team - 'us' or 'them'
     */
    recordGoal(playerId, team = 'us') {
        if (team === 'them' || !playerId) {
            this.finalizeGoal(playerId, null, team);
            return;
        }
        
        // For 'us' goals with a scorer, show assist picker
        this.pendingGoal = { scorerId: playerId, team: team };
        this.showAssistPicker(playerId);
    }

    /**
     * Show the assist picker dialog
     */
    showAssistPicker(scorerId) {
        const overlay = document.getElementById('assist-picker');
        const optionsContainer = document.getElementById('assist-options');
        optionsContainer.innerHTML = '';
        
        const lineup = this.app.getCurrentLineup();
        const players = lineup
            .filter(playerId => playerId && playerId !== scorerId)
            .map(playerId => this.app.getPlayerById(playerId))
            .filter(p => p)
            .sort((a, b) => b.number - a.number);
        
        players.forEach(player => {
            const btn = document.createElement('button');
            btn.className = 'btn assist-player-btn';
            btn.innerHTML = `<span class="assist-number">${player.number}</span> ${player.name}`;
            btn.addEventListener('click', () => this.selectAssist(player.id));
            optionsContainer.appendChild(btn);
        });
        
        overlay.style.pointerEvents = 'none';
        overlay.classList.add('no-touch');
        overlay.style.display = 'flex';
        setTimeout(() => {
            overlay.style.pointerEvents = 'auto';
            overlay.classList.remove('no-touch');
        }, 500);
    }

    /**
     * Select an assist for the pending goal
     */
    selectAssist(assistPlayerId) {
        if (this.pendingGoal) {
            this.finalizeGoal(this.pendingGoal.scorerId, assistPlayerId, this.pendingGoal.team);
            this.pendingGoal = null;
        }
        document.getElementById('assist-picker').style.display = 'none';
    }

    /**
     * Skip assist selection
     */
    skipAssist() {
        if (this.pendingGoal) {
            this.finalizeGoal(this.pendingGoal.scorerId, null, this.pendingGoal.team);
            this.pendingGoal = null;
        }
        this.elements.assistPicker.style.display = 'none';
    }

    /**
     * Finalize and record the goal
     */
    finalizeGoal(playerId, assistPlayerId, team) {
        const goalTime = this.app.timer.getElapsedSeconds();
        
        if (team === 'us') {
            this.state.scoreUs++;
        } else {
            this.state.scoreThem++;
        }
        
        this.app.hapticFeedback(team === 'us' ? CONFIG.HAPTIC_PATTERNS.GOAL_US : CONFIG.HAPTIC_PATTERNS.GOAL_THEM);
        
        this.state.goalHistory.push({
            playerId,
            assistPlayerId,
            time: goalTime,
            team
        });

        // Track goal for player
        let scorerName = team === 'them' ? 'Opponent' : 'Unknown';
        if (playerId) {
            const player = this.app.getPlayerById(playerId);
            if (player) {
                player.goals = (player.goals || 0) + 1;
                scorerName = player.name;
            }
        }

        // Track assist
        let assistName = null;
        if (assistPlayerId) {
            const assister = this.app.getPlayerById(assistPlayerId);
            if (assister) {
                assister.assists = (assister.assists || 0) + 1;
                assistName = assister.name;
            }
        }

        // Add to match events
        this.state.matchEvents.push({
            type: 'goal',
            time: goalTime,
            team,
            scorer: scorerName,
            assist: assistName,
            score: `${this.state.scoreUs} - ${this.state.scoreThem}`
        });

        // Toast with undo
        const goalText = team === 'us' 
            ? `⚽ Goal! ${scorerName}${assistName ? ` (assist: ${assistName})` : ''}`
            : `🔴 Goal - Opponent`;
        this.app.showToast(goalText, 'success', 2000, () => this.undoLastGoal());

        this.app.updateScoreDisplay();
        this.renderMatchEvents();
        this.app.renderPitch();
        this.app.renderBench();
        this.app.saveState();
    }

    /**
     * Undo the last goal
     */
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
            const player = this.app.getPlayerById(lastGoal.playerId);
            if (player && player.goals > 0) {
                player.goals--;
            }
        }

        // Remove assist from player
        if (lastGoal.assistPlayerId) {
            const assister = this.app.getPlayerById(lastGoal.assistPlayerId);
            if (assister && assister.assists > 0) {
                assister.assists--;
            }
        }

        // Remove from match events
        const eventIndex = this.state.matchEvents.findIndex(e => 
            e.type === 'goal' && e.time === lastGoal.time
        );
        if (eventIndex !== -1) {
            this.state.matchEvents.splice(eventIndex, 1);
        }

        this.app.updateScoreDisplay();
        this.renderMatchEvents();
        this.app.renderPitch();
        this.app.renderBench();
        this.app.saveState();
        this.app.showToast('Goal undone');
    }

    /**
     * Record a substitution
     */
    recordSubstitution(playerInId, playerOutId) {
        if (this.state.mode !== MODES.LIVE) return;
        
        const playerIn = this.app.getPlayerById(playerInId);
        const playerOut = this.app.getPlayerById(playerOutId);
        if (!playerIn || !playerOut) return;
        
        this.state.matchEvents.push({
            type: 'sub',
            time: this.app.timer.getElapsedSeconds(),
            playerIn: playerIn.name,
            playerOut: playerOut.name
        });
        this.renderMatchEvents();
    }

    /**
     * Format event time for display
     */
    formatEventTime(seconds) {
        const mins = Math.floor(seconds / 60);
        return `${mins}'`;
    }

    /**
     * Render all match events to the DOM
     */
    renderMatchEvents() {
        if (!this.elements.eventsLog) return;
        
        this.elements.eventsLog.innerHTML = '';
        
        if (this.state.matchEvents.length === 0) {
            this.elements.eventsLog.innerHTML = '<div class="no-events">No match events yet</div>';
            return;
        }
        
        // Calculate running score
        let runningScoreUs = 0;
        let runningScoreThem = 0;
        const eventsWithScore = this.state.matchEvents.map(event => {
            if (event.type === 'goal') {
                if (event.team === 'us') runningScoreUs++;
                else runningScoreThem++;
                return { ...event, calculatedScore: `${runningScoreUs} - ${runningScoreThem}` };
            }
            return event;
        });
        
        // Group subs by minute
        const groupedEvents = this.groupEventsByMinute(eventsWithScore);
        
        // Render in reverse order (newest first)
        [...groupedEvents].reverse().forEach(event => {
            const eventDiv = this.createEventElement(event);
            this.elements.eventsLog.appendChild(eventDiv);
        });
    }

    /**
     * Group consecutive subs into groups by minute
     */
    groupEventsByMinute(events) {
        const grouped = [];
        let currentSubGroup = null;
        
        events.forEach((event, index) => {
            const minutes = Math.floor(event.time / 60);
            
            if (event.type === 'sub') {
                if (currentSubGroup && currentSubGroup.minutes === minutes) {
                    currentSubGroup.subs.push({ ...event, originalIndex: index });
                } else {
                    if (currentSubGroup) grouped.push(currentSubGroup);
                    currentSubGroup = {
                        type: 'sub-group',
                        minutes,
                        subs: [{ ...event, originalIndex: index }]
                    };
                }
            } else {
                if (currentSubGroup) {
                    grouped.push(currentSubGroup);
                    currentSubGroup = null;
                }
                grouped.push({ ...event, originalIndex: index });
            }
        });
        
        if (currentSubGroup) grouped.push(currentSubGroup);
        return grouped;
    }

    /**
     * Create DOM element for an event
     */
    createEventElement(event) {
        const div = document.createElement('div');
        
        if (event.type === 'sub-group') {
            div.className = 'match-event event-sub';
            const timeStr = this.formatEventTime(event.minutes * 60);
            
            const subsHtml = event.subs.map(sub => `
                <div class="sub-pair">
                    <span class="sub-in">↑ ${sub.playerIn}</span>
                    <span class="sub-out">↓ ${sub.playerOut}</span>
                </div>
            `).join('');
            
            div.innerHTML = `
                <span class="event-time">${timeStr}</span>
                <span class="event-icon">🔄</span>
                <span class="event-detail event-detail-subs">${subsHtml}</span>
            `;
        } else if (event.type === 'goal') {
            div.className = 'match-event event-goal';
            const timeStr = this.formatEventTime(event.time);
            const icon = event.team === 'us' ? '⚽' : '🔴';
            const assistText = event.assist ? ` (assist: ${event.assist})` : '';
            
            div.innerHTML = `
                <span class="event-time">${timeStr}</span>
                <span class="event-icon">${icon}</span>
                <span class="event-detail">
                    <strong>GOAL</strong> - ${event.scorer}${assistText}
                    <span class="event-score">${event.calculatedScore || event.score}</span>
                </span>
            `;
        }
        
        return div;
    }
}
