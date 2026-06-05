import { CONFIG } from '../config.js';

/**
 * Manages automatic lineup generation with balanced playing time
 */
export class AutoLineupManager {
    constructor(app) {
        this.app = app;
    }

    /**
     * Get state and settings via app reference
     */
    get state() { return this.app.state; }
    get settings() { return this.app.settings; }

    /**
     * Auto-generate lineups across all intervals with balanced playing time
     * 
     * Phase 1: Build lineups interval by interval
     * - Interval 1: Build from scratch, prioritizing preferred positions
     * - Intervals 2+: Copy previous, make up to subsPerInterval swaps
     * 
     * Phase 2: Balance tuning
     * - Swap players between intervals to reduce minutes gap
     * - Respects subsPerInterval constraint and position preferences
     */
    generate() {
        const players = this.state.players;
        const intervals = this.settings.intervalCount;
        const pitchSize = CONFIG.SLOTS_COUNT;
        
        if (players.length < pitchSize) {
            this.app.showToast('Need at least 9 players');
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
                if (this.app.isPositionPinned(interval, slot)) {
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
        
        // Phase 1: Build lineups interval by interval
        this.buildLineups(intervals, pitchSize, gkId, availablePlayers, intervalsPlayed, lockedPerInterval);
        
        // Show result message
        this.showResultMessage(intervals, pitchSize, availablePlayers, lockedPlayerIds);
        
        this.app.renderAll();
        this.app.saveState();
    }

    /**
     * Phase 1: Build lineups interval by interval
     */
    buildLineups(intervals, pitchSize, gkId, availablePlayers, intervalsPlayed, lockedPerInterval) {
        for (let interval = 1; interval <= intervals; interval++) {
            const locked = lockedPerInterval[interval];
            let lineup;
            
            if (interval === 1) {
                lineup = this.buildFirstInterval(pitchSize, gkId, availablePlayers, intervalsPlayed, locked);
            } else {
                lineup = this.buildSubsequentInterval(interval, pitchSize, gkId, availablePlayers, intervalsPlayed, locked);
            }
            
            // Update intervals played for non-locked outfield slots
            for (let slot = 1; slot < pitchSize; slot++) {
                if (lineup[slot] && !locked.has(slot)) {
                    intervalsPlayed[lineup[slot]]++;
                }
            }
            
            this.state.intervalLineups[interval] = lineup;
        }
    }

    /**
     * Build the first interval lineup from scratch
     */
    buildFirstInterval(pitchSize, gkId, availablePlayers, intervalsPlayed, locked) {
        const lineup = new Array(pitchSize).fill(null);
        lineup[0] = locked.has(0) ? locked.get(0) : gkId;
        
        // Set locked players
        for (const [slot, playerId] of locked) {
            lineup[slot] = playerId;
        }
        
        const assignedThisInterval = new Set(lineup.filter(id => id !== null));
        
        // Fill open slots with preferred position players (least time first)
        const openSlots = [];
        for (let slot = 1; slot < pitchSize; slot++) {
            if (!locked.has(slot)) openSlots.push(slot);
        }
        
        for (const slot of openSlots) {
            const candidates = availablePlayers
                .filter(p => !assignedThisInterval.has(p.id) && p.preferredPositions?.includes(slot))
                .sort((a, b) => intervalsPlayed[a.id] - intervalsPlayed[b.id] || Math.random() - 0.5);
            
            if (candidates.length > 0) {
                lineup[slot] = candidates[0].id;
                assignedThisInterval.add(candidates[0].id);
            }
        }
        
        // Fill remaining empty slots
        for (const slot of openSlots) {
            if (lineup[slot] !== null) continue;
            const unassigned = availablePlayers
                .filter(p => !assignedThisInterval.has(p.id))
                .sort((a, b) => intervalsPlayed[a.id] - intervalsPlayed[b.id] || Math.random() - 0.5);
            if (unassigned.length > 0) {
                lineup[slot] = unassigned[0].id;
                assignedThisInterval.add(unassigned[0].id);
            }
        }
        
        return lineup;
    }

    /**
     * Build subsequent interval by copying previous and making limited subs
     * Uses bench-first approach: prioritize getting bench players with least time onto the pitch
     */
    buildSubsequentInterval(interval, pitchSize, gkId, availablePlayers, intervalsPlayed, locked) {
        const lineup = [...this.state.intervalLineups[interval - 1]];
        
        // Apply locked positions for this interval
        lineup[0] = locked.has(0) ? locked.get(0) : gkId;
        for (const [slot, playerId] of locked) {
            lineup[slot] = playerId;
        }
        
        // Find bench players (not in current lineup), sorted by least playing time
        const pitchIds = new Set(lineup.filter(id => id !== null));
        const onBench = availablePlayers
            .filter(p => !pitchIds.has(p.id))
            .sort((a, b) => intervalsPlayed[a.id] - intervalsPlayed[b.id] || Math.random() - 0.5);
        
        // Determine sub limit
        const subsLimit = this.settings.subsPerInterval;
        let subsRemaining = Math.min(subsLimit, onBench.length);
        
        // Track which slots have been swapped (can't swap same slot twice)
        const swappedSlots = new Set();
        
        // Bench-first: for each bench player (least time first), find best position to swap into
        for (const sub of onBench) {
            if (subsRemaining <= 0) break;
            
            const subPrefs = sub.preferredPositions || [];
            
            // Find the best slot among this sub's preferred positions
            // (the one where current player has the most minutes)
            let bestSlot = null;
            let bestSlotTime = -1;
            
            // If sub has preferred positions, check those first
            if (subPrefs.length > 0) {
                for (const prefSlot of subPrefs) {
                    if (prefSlot === 0 || locked.has(prefSlot) || swappedSlots.has(prefSlot)) continue;
                    
                    const currentPlayerId = lineup[prefSlot];
                    if (!currentPlayerId) continue;
                    
                    const currentTime = intervalsPlayed[currentPlayerId];
                    if (currentTime > bestSlotTime) {
                        bestSlot = prefSlot;
                        bestSlotTime = currentTime;
                    }
                }
            } else {
                // No preferences - can play anywhere, find slot with highest minutes player
                for (let slot = 1; slot < pitchSize; slot++) {
                    if (locked.has(slot) || swappedSlots.has(slot)) continue;
                    
                    const currentPlayerId = lineup[slot];
                    if (!currentPlayerId) continue;
                    
                    const currentTime = intervalsPlayed[currentPlayerId];
                    if (currentTime > bestSlotTime) {
                        bestSlot = slot;
                        bestSlotTime = currentTime;
                    }
                }
            }
            
            // Make the swap if we found a valid slot
            if (bestSlot !== null) {
                lineup[bestSlot] = sub.id;
                swappedSlots.add(bestSlot);
                subsRemaining--;
            }
        }
        
        return lineup;
    }

    /**
    /**
     * Show result message after generation
     */
    showResultMessage(intervals, pitchSize, availablePlayers, lockedPlayerIds) {
        const lockedCount = lockedPlayerIds.size;
        const intervalDuration = this.settings.matchDuration / intervals;
        const outfieldSlots = pitchSize - 1;
        const totalPlayingSlots = intervals * outfieldSlots;
        const targetIntervals = totalPlayingSlots / availablePlayers.length;
        const avgMinutes = Math.round(targetIntervals * intervalDuration);
        
        const msg = lockedCount > 0 
            ? `Kept ${lockedCount} pinned · ~${avgMinutes} mins for others`
            : `~${targetIntervals.toFixed(1)} intervals · ~${avgMinutes} mins each`;
        this.app.showToast(msg);
    }
}
