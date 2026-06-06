import { LZString } from '../utils/LZString.js';

/**
 * Manages player ratings and POTM selection
 */
export class RatingManager {
    constructor(app) {
        this.app = app;
    }

    get state() { return this.app.state; }
    get settings() { return this.app.settings; }
    get elements() { return this.app.elements; }

    /**
     * Show the player rating picker overlay
     */
    show() {
        const container = this.elements.ratingPlayers;
        if (!container) return;
        
        // Get current rater's data
        const currentRater = this.state.currentRater || 'manager';
        const ratingsKey = currentRater === 'manager' ? 'managerRatings' : 'assistantRatings';
        const potmKey = currentRater === 'manager' ? 'managerPotm' : 'assistantPotm';
        
        // Initialize default ratings of 6 for all players who don't have a rating yet
        this.state.players.forEach(player => {
            if (this.state[ratingsKey][player.id] === undefined) {
                this.state[ratingsKey][player.id] = 6;
            }
        });
        
        // Update role toggle buttons
        document.querySelectorAll('.rating-role-btn').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.role === currentRater);
        });
        
        // Show/hide POTM hint (only for manager)
        const potmHint = document.getElementById('rating-potm-hint');
        if (potmHint) {
            potmHint.style.display = currentRater === 'manager' ? '' : 'none';
        }
        
        container.innerHTML = '';
        
        // Get all players, sorted by minutes played (descending) - players who played first, then unused subs
        const allPlayers = [...this.state.players]
            .sort((a, b) => (b.minutesPlayed || 0) - (a.minutesPlayed || 0));
        
        allPlayers.forEach(player => {
            const currentRating = this.state[ratingsKey][player.id];
            const isPotm = currentRater === 'manager' && this.state[potmKey] === player.id;
            
            const row = document.createElement('div');
            row.className = `rating-player-row${isPotm ? ' potm-selected' : ''}`;
            row.dataset.playerId = player.id;
            
            // Stats: minutes always shown, goals/assists as text
            const minutes = Math.floor(player.minutesPlayed || 0);
            const stats = [];
            if (player.goals) stats.push(`${player.goals}G`);
            if (player.assists) stats.push(`${player.assists}A`);
            const statsText = `${minutes}' ${stats.join(' ')}`.trim();
            
            // Only show POTM star for manager
            const potmStar = currentRater === 'manager' ? '<span class="rating-potm-star">⭐</span>' : '';
            
            row.innerHTML = `
                ${potmStar}
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
            
            // Click row to select POTM (manager only)
            if (currentRater === 'manager') {
                row.addEventListener('click', (e) => {
                    if (e.target.closest('.rating-stepper-btn')) return;
                    
                    // Toggle POTM selection
                    const wasSelected = this.state[potmKey] === player.id;
                    this.state[potmKey] = wasSelected ? null : player.id;
                    
                    // Update UI
                    container.querySelectorAll('.rating-player-row').forEach(r => {
                        r.classList.toggle('potm-selected', r.dataset.playerId === String(this.state[potmKey]));
                    });
                });
            }
            
            // Stepper buttons
            row.querySelectorAll('.rating-stepper-btn').forEach(btn => {
                btn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    const action = btn.dataset.action;
                    let rating = this.state[ratingsKey][player.id] || 6;
                    
                    if (action === 'inc' && rating < 10) rating++;
                    if (action === 'dec' && rating > 1) rating--;
                    
                    this.state[ratingsKey][player.id] = rating;
                    
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
     * Switch rating role (manager/assistant)
     */
    switchRole(role) {
        this.state.currentRater = role;
        this.show(); // Re-render with new role's data
    }

    /**
     * Hide the rating picker
     */
    hide() {
        this.elements.ratingPicker.style.display = 'none';
    }

    /**
     * Save ratings and close picker
     */
    save() {
        this.app.saveState();
        this.hide();
        // Re-render to show rating badges on player cards
        this.app.renderPitch();
        this.app.renderBench();
        const role = this.state.currentRater === 'assistant' ? 'Assistant' : 'Manager';
        this.app.showToast(`${role} ratings saved!`, 'success');
    }

    /**
     * Generate ratings URL for a specific rater
     */
    generateUrl(rater = 'manager') {
        const ratingsKey = rater === 'manager' ? 'managerRatings' : 'assistantRatings';
        const potmKey = rater === 'manager' ? 'managerPotm' : 'assistantPotm';
        
        // Build compact player stats (only include non-zero values)
        const playerStats = this.state.players.map(p => {
            const stats = { id: p.id };
            if (p.minutesPlayed) stats.m = Math.floor(p.minutesPlayed);
            if (p.goals) stats.g = p.goals;
            if (p.assists) stats.a = p.assists;
            if (p.startedGame) stats.s = 1;
            return stats;
        }).filter(s => s.m || s.g || s.a || s.s);
        
        const data = {
            r: rater === 'manager' ? 'm' : 'a',
            ratings: this.state[ratingsKey],
            potm: this.state[potmKey],
            // Match data
            scoreUs: this.state.scoreUs,
            scoreThem: this.state.scoreThem,
            events: this.state.matchEvents,
            players: playerStats
        };
        
        const json = JSON.stringify(data);
        const encoded = LZString.compress(json);
        
        return `${window.location.origin}${window.location.pathname}?ratings=${encodeURIComponent(encoded)}`;
    }

    /**
     * Share current rater's ratings via URL
     */
    share() {
        const currentRater = this.state.currentRater || 'manager';
        const url = this.generateUrl(currentRater);
        
        navigator.clipboard.writeText(url).then(() => {
            const role = currentRater === 'assistant' ? 'Assistant' : 'Manager';
            this.app.showToast(`${role} ratings link copied!`, 'success');
        }).catch(err => {
            console.error('Failed to copy:', err);
            this.app.showToast('Failed to copy link');
        });
    }

    /**
     * Import ratings from URL parameter
     */
    importFromUrl() {
        const urlParams = new URLSearchParams(window.location.search);
        const ratingsParam = urlParams.get('ratings');
        
        if (!ratingsParam) return false;
        
        try {
            // Try LZ decompress first, fall back to base64 for old links
            let json = LZString.decompress(ratingsParam);
            if (!json) {
                let base64 = ratingsParam.replace(/-/g, '+').replace(/_/g, '/');
                while (base64.length % 4) base64 += '=';
                json = decodeURIComponent(escape(atob(base64)));
            }
            const data = JSON.parse(json);
            
            const isManager = data.r === 'm';
            const ratingsKey = isManager ? 'managerRatings' : 'assistantRatings';
            const potmKey = isManager ? 'managerPotm' : 'assistantPotm';
            
            // Import the other rater's ratings
            this.state[ratingsKey] = data.ratings || {};
            this.state[potmKey] = data.potm || null;
            
            // Import match data if present
            if (data.scoreUs !== undefined) this.state.scoreUs = data.scoreUs;
            if (data.scoreThem !== undefined) this.state.scoreThem = data.scoreThem;
            if (data.events) this.state.matchEvents = data.events;
            
            // Import player stats
            if (data.players) {
                for (const ps of data.players) {
                    const player = this.app.getPlayerById(ps.id);
                    if (player) {
                        if (ps.m) player.minutesPlayed = ps.m;
                        if (ps.g) player.goals = ps.g;
                        if (ps.a) player.assists = ps.a;
                        if (ps.s) player.startedGame = true;
                    }
                }
            }
            
            // Mark match as ended so ratings display
            this.state.matchEnded = true;
            
            // Disable match control buttons since match data was imported
            this.elements.playPauseBtn.disabled = true;
            this.elements.playPauseBtn.textContent = '✓';
            this.elements.stopBtn.disabled = true;
            
            // Switch to the other role for the current user to rate
            this.state.currentRater = isManager ? 'assistant' : 'manager';
            
            // Clear URL params
            history.replaceState(null, '', window.location.pathname);
            
            const role = isManager ? 'Manager' : 'Assistant';
            this.app.showToast(`${role} ratings imported!`, 'success');
            this.app.saveState();
            
            // Refresh UI to show imported data
            this.app.updateScoreDisplay();
            this.app.renderStats();
            this.app.events.renderMatchEvents();
            this.app.renderPitch();
            this.app.renderBench();
            this.app.updateExportButtonVisibility();
            
            return true;
        } catch (e) {
            console.error('Failed to import ratings:', e);
            return false;
        }
    }
}
