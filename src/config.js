// Configuration constants
export const CONFIG = {
    VERSION: '1.0.0',
    STORAGE_KEY: 'teamSelectorState',
    LONG_PRESS_MS: 500,
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
export const MODES = { PLAN: 'plan', LIVE: 'live' };
export const TEAMS = { US: 'us', THEM: 'them' };
export const LOCATIONS = { PITCH: 'pitch', BENCH: 'bench' };

// Position slot mapping (index -> position name)
export const POSITIONS = {
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
export const DEFAULT_STATE = {
    mode: 'plan',
    isRunning: false,
    startTime: null,
    pausedElapsedMs: 0,
    lastTickTime: null,
    halfTimeShown: false,
    fullTimeShown: false,
    matchStarted: false,
    matchEnded: false,
    halfTimeTaken: false,
    secondHalfStarted: false,
    currentInterval: 1,
    lastAppliedSubsInterval: 0,
    selectedPlanInterval: 1,
    players: [],
    intervalLineups: {},
    pinnedPositions: {},
    liveLineup: null,
    lastIntervalTime: 0,
    scoreUs: 0,
    scoreThem: 0,
    goalHistory: [],
    matchEvents: [],
    speedMultiplier: 1,
    managerRatings: {},
    assistantRatings: {},
    managerPotm: null,
    assistantPotm: null,
    currentRater: 'manager'
};

export const DEFAULT_SETTINGS = {
    matchDuration: CONFIG.DEFAULT_MATCH_DURATION,
    intervalCount: 4,
    playersOnPitch: CONFIG.SLOTS_COUNT,
    subsPerInterval: 0,  // 0 to max bench size
    opponentName: '',
    matchDate: '',
    isHome: true,
    debugMode: false
};

// Slot fill order: top to bottom, left to right (FW, LW, LCM, RCM, RW, LB, CB, RB, GK)
export const SLOT_FILL_ORDER = [8, 4, 5, 6, 7, 1, 2, 3, 0];
