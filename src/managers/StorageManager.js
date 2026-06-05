import { CONFIG, DEFAULT_STATE, DEFAULT_SETTINGS } from '../config.js';

/**
 * Handles localStorage persistence for app state and settings
 */
export class StorageManager {
    constructor() {
        this.storageKey = CONFIG.STORAGE_KEY;
    }

    /**
     * Load state and settings from localStorage
     * @returns {{ state: object, settings: object }}
     */
    load() {
        let state = { ...DEFAULT_STATE };
        let settings = { ...DEFAULT_SETTINGS };

        try {
            const saved = localStorage.getItem(this.storageKey);
            if (saved) {
                const parsed = JSON.parse(saved);
                settings = { ...DEFAULT_SETTINGS, ...parsed.settings };
                state = { ...DEFAULT_STATE, ...parsed.state };
                
                // Clear stale session data
                state.players.forEach(p => p.onPitchSinceElapsed = undefined);
                
                // Timer shouldn't be running on page load
                state.isRunning = false;
                state.startTime = null;
                
                // Migrate: add preferredPositions to players if missing
                this.migratePlayerPositions(state);
                
                // Migrate: decode any URL-encoded player names
                this.migratePlayerNames(state);
                
                // Migrate: old single ratings to manager ratings
                this.migrateRatings(state);
            }
        } catch (e) {
            console.warn('Failed to load saved state, using defaults:', e);
            localStorage.removeItem(this.storageKey);
            state = { ...DEFAULT_STATE };
            settings = { ...DEFAULT_SETTINGS };
        }

        return { state, settings };
    }

    /**
     * Save state and settings to localStorage
     * @param {object} state 
     * @param {object} settings 
     */
    save(state, settings) {
        try {
            localStorage.setItem(this.storageKey, JSON.stringify({
                settings,
                state
            }));
        } catch (e) {
            console.warn('Failed to save state:', e);
        }
    }

    /**
     * Clear all saved data
     */
    clear() {
        localStorage.removeItem(this.storageKey);
    }

    /**
     * Migrate older saved data to add preferredPositions
     * @param {object} state 
     */
    migratePlayerPositions(state) {
        state.players.forEach((p, idx) => {
            if (!p.preferredPositions) {
                const lineup = state.intervalLineups[1] || [];
                const slot = lineup.indexOf(p.id);
                if (slot >= 0) {
                    p.preferredPositions = [slot];
                } else if (idx < 9) {
                    p.preferredPositions = [idx];
                } else {
                    p.preferredPositions = [];
                }
            }
        });
    }

    /**
     * Migrate: decode any URL-encoded player names (e.g., "Alfie%20B" -> "Alfie B")
     * @param {object} state 
     */
    migratePlayerNames(state) {
        state.players.forEach(p => {
            if (p.name && p.name.includes('%')) {
                try {
                    p.name = decodeURIComponent(p.name);
                } catch (e) {
                    // If decode fails, keep original name
                }
            }
        });
    }

    /**
     * Migrate: old single playerRatings to manager ratings
     * @param {object} state 
     */
    migrateRatings(state) {
        // Migrate old playerRatings to managerRatings
        if (state.playerRatings && Object.keys(state.playerRatings).length > 0) {
            if (!state.managerRatings || Object.keys(state.managerRatings).length === 0) {
                state.managerRatings = { ...state.playerRatings };
            }
            delete state.playerRatings;
        }
        
        // Migrate old playerOfTheMatch to managerPotm
        if (state.playerOfTheMatch) {
            if (!state.managerPotm) {
                state.managerPotm = state.playerOfTheMatch;
            }
            delete state.playerOfTheMatch;
        }
        
        // Ensure new fields exist
        if (!state.managerRatings) state.managerRatings = {};
        if (!state.assistantRatings) state.assistantRatings = {};
        if (!state.currentRater) state.currentRater = 'manager';
    }
}
