import { CONFIG } from '../config.js';

/**
 * Manages substitution logic for planned and live match subs
 */
export class SubsManager {
    constructor(app) {
        this.app = app;
    }

    /**
     * Get state and settings via app reference
     */
    get state() { return this.app.state; }
    get settings() { return this.app.settings; }

    /**
     * Calculate all interval changes (who's coming on/off at each interval)
     * @returns {Array<{interval: number, off: Array, on: Array}>}
     */
    getIntervalChanges() {
        const changes = [];
        for (let i = 2; i <= this.settings.intervalCount; i++) {
            const prev = this.state.intervalLineups[i - 1] || [];
            const curr = this.state.intervalLineups[i] || [];
            
            // Players leaving: in prev but not in curr
            const off = prev.filter(id => id && !curr.includes(id))
                .map(id => this.app.getPlayerById(id)).filter(p => p);
            // Players joining: in curr but not in prev
            const on = curr.filter(id => id && !prev.includes(id))
                .map(id => this.app.getPlayerById(id)).filter(p => p);
            
            if (off.length || on.length) {
                changes.push({ interval: i, off, on });
            }
        }
        return changes;
    }

    /**
     * Get info about the next interval's planned subs
     * @returns {{playersOn: string[], playersOff: string[], nextInterval: number|null, subsCount: number}}
     */
    getNextIntervalSubs() {
        const nextInterval = (this.state.lastAppliedSubsInterval || 1) + 1;
        
        if (nextInterval > this.settings.intervalCount) {
            return { playersOn: [], playersOff: [], nextInterval: null, subsCount: 0 };
        }
        
        const allChanges = this.getIntervalChanges();
        const change = allChanges.find(c => c.interval === nextInterval);
        
        if (!change) {
            return { playersOn: [], playersOff: [], nextInterval, subsCount: 0 };
        }
        
        // Count only valid subs (player on is on bench, player off is on pitch)
        const benchIds = this.app.getBenchPlayers().map(p => p.id);
        const pitchIds = this.state.liveLineup || [];
        
        let validSubsCount = 0;
        const maxLen = Math.min(change.on.length, change.off.length);
        for (let i = 0; i < maxLen; i++) {
            const onPlayer = change.on[i];
            const offPlayer = change.off[i];
            if (onPlayer && offPlayer && 
                benchIds.includes(onPlayer.id) && 
                pitchIds.includes(offPlayer.id)) {
                validSubsCount++;
            }
        }
        
        return {
            playersOn: change.on.map(p => p.name),
            playersOff: change.off.map(p => p.name),
            nextInterval,
            subsCount: validSubsCount
        };
    }

    /**
     * Apply the planned subs for the next interval
     * Called when user holds the subs button in live mode
     */
    applyPlannedSubs() {
        const nextInterval = (this.state.lastAppliedSubsInterval || 1) + 1;
        
        if (nextInterval > this.settings.intervalCount) {
            this.app.showToast('No more intervals');
            return;
        }
        
        const prevPlanned = this.state.intervalLineups[nextInterval - 1] || [];
        const nextPlanned = this.state.intervalLineups[nextInterval] || [];
        
        // Find who's actually LEAVING (in prev but not in next)
        const playersLeaving = prevPlanned.filter(id => id && !nextPlanned.includes(id));
        // Find who's actually JOINING (in next but not in prev)  
        const playersJoining = nextPlanned.filter(id => id && !prevPlanned.includes(id));
        
        // Get current bench and pitch for validation
        const benchIds = this.app.getBenchPlayers().map(p => p.id);
        const currentLiveLineup = [...this.state.liveLineup];
        
        // Filter to only valid subs (player on is on bench, player off is on pitch)
        const validSubs = [];
        const skippedSubs = [];
        const subsCount = Math.min(playersLeaving.length, playersJoining.length);
        
        for (let i = 0; i < subsCount; i++) {
            const playerOff = playersLeaving[i];
            const playerOn = playersJoining[i];
            
            const isOnBench = benchIds.includes(playerOn);
            const isOffPitch = currentLiveLineup.includes(playerOff);
            
            if (isOnBench && isOffPitch) {
                validSubs.push({ playerOn, playerOff });
            } else {
                const onName = this.app.getPlayerById(playerOn)?.name || 'Unknown';
                const offName = this.app.getPlayerById(playerOff)?.name || 'Unknown';
                skippedSubs.push(`${onName}↔${offName}`);
            }
        }
        
        // Apply valid subs
        for (const { playerOn, playerOff } of validSubs) {
            const pitchIdx = this.state.liveLineup.indexOf(playerOff);
            if (pitchIdx !== -1) {
                this.app.finalizePlayerMinutes(playerOff);
                this.app.startPlayerMinutes(playerOn);
                this.app.recordSubstitution(playerOn, playerOff);
                this.state.liveLineup[pitchIdx] = playerOn;
            }
        }
        
        this.state.lastAppliedSubsInterval = nextInterval;
        this.app.saveState();
        this.app.renderPitch();
        this.app.renderBench();
        // Stats updated by timer on minute boundary in live mode
        this.updateBadge();
        
        // Show toast
        if (validSubs.length > 0) {
            const swapNames = validSubs.map(({ playerOn, playerOff }) => {
                const onName = this.app.getPlayerById(playerOn)?.name;
                const offName = this.app.getPlayerById(playerOff)?.name;
                return `${onName}↔${offName}`;
            });
            let msg = `Int ${nextInterval}: ${swapNames.join(', ')}`;
            if (skippedSubs.length > 0) {
                msg += ` (skipped: ${skippedSubs.join(', ')})`;
            }
            this.app.showToast(msg);
        } else if (skippedSubs.length > 0) {
            this.app.showToast(`Int ${nextInterval}: Skipped ${skippedSubs.join(', ')}`);
        } else {
            this.app.showToast(`Interval ${nextInterval}: No subs needed`);
        }
    }

    /**
     * Perform a single manual substitution from the popup
     */
    performManualSub(playerOnId, playerOffId, btn, popup, overlay) {
        // Check if player on is actually on bench
        const benchIds = this.app.getBenchPlayers().map(p => p.id);
        if (!benchIds.includes(playerOnId)) {
            this.app.showToast('Player not on bench');
            return;
        }
        
        // Check if player off is actually on pitch
        const pitchIdx = this.state.liveLineup.indexOf(playerOffId);
        if (pitchIdx === -1) {
            this.app.showToast('Player not on pitch');
            return;
        }
        
        // Finalize minutes for player going off, start for player coming on
        this.app.finalizePlayerMinutes(playerOffId);
        this.app.startPlayerMinutes(playerOnId);
        
        // Record the substitution
        this.app.recordSubstitution(playerOnId, playerOffId);
        
        // Update the live lineup
        this.state.liveLineup[pitchIdx] = playerOnId;
        
        this.app.saveState();
        this.app.renderPitch();
        this.app.renderBench();
        // Stats updated by timer on minute boundary in live mode
        this.updateBadge();
        
        // Update button to show it's done
        btn.textContent = '✓';
        btn.disabled = true;
        btn.classList.add('done');
        
        // Show toast
        const onName = this.app.getPlayerById(playerOnId)?.name;
        const offName = this.app.getPlayerById(playerOffId)?.name;
        this.app.showToast(`${onName} ↔ ${offName}`);
    }

    /**
     * Update the subs icon badge count
     */
    updateBadge() {
        const badge = this.app.elements.subsBadge;
        const icon = this.app.elements.subsIcon;
        if (!badge || !icon) return;
        
        const { subsCount, nextInterval } = this.getNextIntervalSubs();
        
        if (subsCount > 0 && nextInterval) {
            badge.textContent = subsCount;
            badge.classList.add('visible');
        } else {
            badge.classList.remove('visible');
        }
    }

    /**
     * Show the subs popup with all planned changes
     */
    /**
     * Check if an interval has any actionable subs (valid and not past)
     */
    hasActionableSubs(change) {
        const isPast = change.interval <= (this.state.lastAppliedSubsInterval || 0);
        if (isPast) return false;
        
        const benchIds = this.app.getBenchPlayers().map(p => p.id);
        const pitchIds = this.state.liveLineup || [];
        
        const maxLen = Math.min(change.on.length, change.off.length);
        for (let i = 0; i < maxLen; i++) {
            const onPlayer = change.on[i];
            const offPlayer = change.off[i];
            if (onPlayer && offPlayer &&
                benchIds.includes(onPlayer.id) &&
                pitchIds.includes(offPlayer.id)) {
                return true;
            }
        }
        return false;
    }

    showPopup() {
        // Remove any existing popup
        document.querySelector('.subs-popup')?.remove();
        document.querySelector('.subs-popup-overlay')?.remove();
        
        const allChanges = this.getIntervalChanges();
        
        if (allChanges.length === 0) {
            this.showEmptyPopup();
            return;
        }
        
        const intervalDurationMins = Math.round(this.settings.matchDuration / this.settings.intervalCount);
        const elapsedMins = this.app.getElapsedSeconds() / 60;
        
        // Find the interval that matches current game time
        // Select the interval where (interval-1) * duration <= elapsed < interval * duration
        // i.e. if interval 2 is at 3', select it when game time is 3:00 - 5:59
        let defaultIndex = allChanges.findIndex(c => {
            const intervalStartMins = (c.interval - 1) * intervalDurationMins;
            const intervalEndMins = c.interval * intervalDurationMins;
            return elapsedMins >= intervalStartMins && elapsedMins < intervalEndMins;
        });
        
        // If no match (before first interval or after all), find best fallback
        if (defaultIndex === -1) {
            // If elapsed is past all intervals, show the last one
            // If elapsed is before first change, show the first one
            const firstIntervalStart = (allChanges[0].interval - 1) * intervalDurationMins;
            if (elapsedMins < firstIntervalStart) {
                defaultIndex = 0;
            } else {
                defaultIndex = allChanges.length - 1;
            }
        }
        
        // If selected interval has no actionable subs, try to find the next one that does
        if (!this.hasActionableSubs(allChanges[defaultIndex])) {
            for (let i = defaultIndex + 1; i < allChanges.length; i++) {
                if (this.hasActionableSubs(allChanges[i])) {
                    defaultIndex = i;
                    break;
                }
            }
        }
        
        // Build slides for each interval
        const slidesHtml = this.buildSlidesHtml(allChanges, intervalDurationMins, defaultIndex);
        const dotsHtml = this.buildDotsHtml(allChanges, defaultIndex);
        
        // Create popup
        const overlay = document.createElement('div');
        overlay.className = 'subs-popup-overlay';
        document.body.appendChild(overlay);
        
        const popup = document.createElement('div');
        popup.className = 'subs-popup';
        popup.innerHTML = `
            <div class="subs-slider">${slidesHtml}</div>
            ${dotsHtml}
        `;
        
        const pitchContainer = document.querySelector('.pitch-container');
        pitchContainer.appendChild(popup);
        
        // Set up slider navigation
        if (allChanges.length > 1) {
            this.setupSliderNavigation(popup, defaultIndex);
        }
        
        // Set up manual sub trigger buttons
        popup.querySelectorAll('.sub-trigger-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation(); // Don't close popup
                const onId = parseInt(btn.dataset.on);
                const offId = parseInt(btn.dataset.off);
                this.performManualSub(onId, offId, btn, popup, overlay);
            });
        });
        
        // Close on overlay click
        overlay.addEventListener('click', () => {
            popup.remove();
            overlay.remove();
        });
        
        // Close on popup click (but not on buttons, navigation dots, or slider during swipe)
        popup.addEventListener('click', (e) => {
            if (!e.target.closest('.sub-trigger-btn') && 
                !e.target.closest('.subs-dot') &&
                !e.target.closest('.subs-slider')) {
                popup.remove();
                overlay.remove();
            }
        });
    }

    /**
     * Show empty popup when no subs are planned
     */
    showEmptyPopup() {
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
        
        popup.addEventListener('click', () => {
            popup.remove();
            overlay.remove();
        });
    }

    /**
     * Build HTML for popup slides
     */
    buildSlidesHtml(allChanges, intervalDurationMins, defaultIndex) {
        // Get current bench and pitch players for validation
        const benchIds = this.app.getBenchPlayers().map(p => p.id);
        const pitchIds = this.state.liveLineup || [];
        
        return allChanges.map((c, idx) => {
            const timeStr = `${(c.interval - 1) * intervalDurationMins}'`;
            const maxLen = Math.max(c.on.length, c.off.length);
            const isPast = c.interval <= (this.state.lastAppliedSubsInterval || 0);
            
            let pairsHtml = '';
            for (let i = 0; i < maxLen; i++) {
                const onPlayer = c.on[i];
                const offPlayer = c.off[i];
                
                // Check if sub is valid: player on must be on bench, player off must be on pitch
                const isOnBench = onPlayer && benchIds.includes(onPlayer.id);
                const isOffPitch = offPlayer && pitchIds.includes(offPlayer.id);
                const isValid = isOnBench && isOffPitch;
                const canSub = onPlayer && offPlayer && !isPast;
                
                // Add classes for invalid subs
                const onClass = !isOnBench && onPlayer ? 'invalid' : '';
                const offClass = !isOffPitch && offPlayer ? 'invalid' : '';
                
                pairsHtml += `
                    <div class="sub-change ${isPast ? 'past' : ''} ${!isValid && !isPast ? 'unavailable' : ''}">
                        <span class="sub-in ${onClass}">↑ ${onPlayer?.name || ''}</span>
                        <span class="sub-out ${offClass}">↓ ${offPlayer?.name || ''}</span>
                        ${canSub ? `<button class="sub-trigger-btn ${!isValid ? 'disabled' : ''}" data-on="${onPlayer.id}" data-off="${offPlayer.id}" ${!isValid ? 'disabled' : ''}>Sub</button>` : ''}
                    </div>
                `;
            }
            
            return `
                <div class="subs-slide ${idx === defaultIndex ? 'active' : ''}" data-interval="${c.interval}">
                    <div class="subs-header">Interval ${c.interval} <span class="subs-time">${timeStr}</span></div>
                    ${pairsHtml}
                </div>
            `;
        }).join('');
    }

    /**
     * Build HTML for popup dots navigation
     */
    buildDotsHtml(allChanges, defaultIndex) {
        if (allChanges.length <= 1) return '';
        
        return `<div class="subs-dots">${allChanges.map((c, idx) => {
            const isPast = c.interval <= (this.state.lastAppliedSubsInterval || 0);
            return `<span class="subs-dot ${idx === defaultIndex ? 'active' : ''} ${isPast ? 'past' : ''}" data-index="${idx}"></span>`;
        }).join('')}</div>`;
    }

    /**
     * Set up touch/mouse navigation for popup slider
     */
    setupSliderNavigation(popup, defaultIndex) {
        let currentSlide = defaultIndex;
        let startX = 0;
        let startY = 0;
        let isDragging = false;
        let isHorizontalSwipe = null;
        
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
            startY = e.touches[0].clientY;
            isDragging = true;
            isHorizontalSwipe = null;
        }, { passive: true });
        
        slider.addEventListener('touchmove', (e) => {
            if (!isDragging) return;
            
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
        
        slider.addEventListener('touchend', (e) => {
            if (!isDragging) return;
            isDragging = false;
            
            const endX = e.changedTouches[0].clientX;
            const diff = startX - endX;
            
            // Only process horizontal swipes with 30px threshold
            if (isHorizontalSwipe && Math.abs(diff) > 30) {
                e.preventDefault();
                e.stopPropagation();
                if (diff > 0) goToSlide(currentSlide + 1);
                else goToSlide(currentSlide - 1);
            }
            
            isHorizontalSwipe = null;
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
            
            if (Math.abs(diff) > 30) {
                if (diff > 0) goToSlide(currentSlide + 1);
                else goToSlide(currentSlide - 1);
            }
        });
        
        // Dot clicks
        dots.forEach(dot => {
            dot.addEventListener('click', (e) => {
                e.stopPropagation();
                goToSlide(parseInt(dot.dataset.index));
            });
        });
    }
}
