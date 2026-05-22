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
        
        return {
            playersOn: change.on.map(p => p.name),
            playersOff: change.off.map(p => p.name),
            nextInterval,
            subsCount: change.on.length
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
        
        // Record actual substitutions (players leaving/joining, not position swaps)
        const subsCount = Math.min(playersLeaving.length, playersJoining.length);
        for (let i = 0; i < subsCount; i++) {
            const playerOff = playersLeaving[i];
            const playerOn = playersJoining[i];
            this.app.finalizePlayerMinutes(playerOff);
            this.app.startPlayerMinutes(playerOn);
            this.app.recordSubstitution(playerOn, playerOff);
        }
        
        // Apply the full planned lineup for this interval
        this.state.liveLineup = [...nextPlanned];
        this.state.lastAppliedSubsInterval = nextInterval;
        this.app.saveState();
        this.app.renderPitch();
        this.app.renderBench();
        this.app.renderStats();
        this.updateBadge();
        
        // Show toast
        if (subsCount > 0) {
            const swapNames = playersJoining.map((id, i) => {
                const onName = this.app.getPlayerById(id)?.name;
                const offName = this.app.getPlayerById(playersLeaving[i])?.name;
                return `${onName}↔${offName}`;
            });
            this.app.showToast(`Int ${nextInterval}: ${swapNames.join(', ')}`);
        } else {
            this.app.showToast(`Interval ${nextInterval}: No subs needed`);
        }
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
    showPopup() {
        // Remove any existing popup
        document.querySelector('.subs-popup')?.remove();
        document.querySelector('.subs-popup-overlay')?.remove();
        
        const allChanges = this.getIntervalChanges();
        
        if (allChanges.length === 0) {
            this.showEmptyPopup();
            return;
        }
        
        // Find the default slide (first upcoming interval that hasn't been applied)
        const nextUnapplied = (this.state.lastAppliedSubsInterval || 1) + 1;
        let defaultIndex = allChanges.findIndex(c => c.interval >= nextUnapplied);
        if (defaultIndex === -1) defaultIndex = allChanges.length - 1;
        
        const intervalDurationMins = Math.round(this.settings.matchDuration / this.settings.intervalCount);
        
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
        
        // Close on overlay click
        overlay.addEventListener('click', () => {
            popup.remove();
            overlay.remove();
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
    }

    /**
     * Build HTML for popup slides
     */
    buildSlidesHtml(allChanges, intervalDurationMins, defaultIndex) {
        return allChanges.map((c, idx) => {
            const timeStr = `${(c.interval - 1) * intervalDurationMins}'`;
            const maxLen = Math.max(c.on.length, c.off.length);
            const isPast = c.interval <= (this.state.lastAppliedSubsInterval || 0);
            
            let pairsHtml = '';
            for (let i = 0; i < maxLen; i++) {
                const onPlayer = c.on[i];
                const offPlayer = c.off[i];
                pairsHtml += `
                    <div class="sub-change ${isPast ? 'past' : ''}">
                        <span class="sub-in">↑ ${onPlayer?.name || ''}</span>
                        <span class="sub-out">↓ ${offPlayer?.name || ''}</span>
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
}
