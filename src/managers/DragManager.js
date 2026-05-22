import { CONFIG, MODES } from '../config.js';

/**
 * Handles all drag and drop functionality
 */
export class DragManager {
    constructor(app) {
        this.app = app;
        this.dragState = {
            draggingPlayer: null,
            sourceSlot: null,
            sourceLocation: null
        };
        this.wasDragging = false;
        this.selectedBenchPlayer = null;
        this.removedPlayersStack = [];
        this._removedPlayersForSub = [];
        this.justAddedPlayer = false;
        this.justRemovedPlayer = false;
        this.longPressJustTriggered = false;
    }

    get state() { return this.app.state; }
    get settings() { return this.app.settings; }

    /**
     * Setup drop zones on pitch slots and bench
     */
    setupDropZones() {
        // Pitch slots
        const slots = document.querySelectorAll('.player-slot');
        slots.forEach((slot) => {
            const index = parseInt(slot.dataset.slot);
            this.setupDropZone(slot, 'pitch', index);
        });

        // Bench
        this.setupDropZone(this.app.elements.bench, 'bench');
    }

    /**
     * Setup a single drop zone
     */
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

        // Click on empty slot to auto-fill
        if (targetLocation === 'pitch' && slotIndex !== null) {
            element.addEventListener('click', (e) => {
                if (this.justRemovedPlayer) return;
                if (e.target === element || e.target.classList.contains('player-slot')) {
                    const lineup = this.app.getCurrentLineup();
                    if (lineup[slotIndex] === null) {
                        this.fillEmptySlot(slotIndex);
                    }
                }
            });
        }
    }

    /**
     * Setup drag events for a player card
     */
    setupDragForPlayer(element, playerId, location, slotIndex = null) {
        let isDragging = false;
        let startX, startY;
        let longPressTimer = null;
        let touchMoved = false;
        let longPressTriggered = false;

        const triggerGoal = () => {
            this.app.recordGoal(playerId, 'us');
            this.app.showScoringAnimation(element);
        };

        const triggerPinToggle = () => {
            if (slotIndex === null) return;
            const interval = this.state.selectedPlanInterval;
            if (this.app.isPositionPinned(interval, slotIndex)) {
                this.app.unpinPosition(interval, slotIndex);
                this.app.showToast('Unpinned');
            } else {
                this.app.pinPosition(interval, slotIndex);
                this.app.showToast('Pinned 📌');
            }
            this.app.renderPitch();
        };

        const startLongPress = () => {
            if (location !== 'pitch') return;
            if (this.state.mode === 'live') {
                longPressTimer = setTimeout(() => {
                    longPressTriggered = true;
                    this.longPressJustTriggered = true;
                    triggerGoal();
                    longPressTimer = null;
                    // Delay reset so click event still sees flag=true
                    setTimeout(() => { 
                        longPressTriggered = false;
                        this.longPressJustTriggered = false;
                    }, 500);
                }, CONFIG.LONG_PRESS_MS);
            } else if (this.state.mode === 'plan') {
                longPressTimer = setTimeout(() => {
                    longPressTriggered = true;
                    this.longPressJustTriggered = true;
                    triggerPinToggle();
                    longPressTimer = null;
                    setTimeout(() => { 
                        longPressTriggered = false;
                        this.longPressJustTriggered = false;
                    }, 500);
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
        
        element.addEventListener('mousedown', () => {
            longPressTriggered = false;
            this.longPressJustTriggered = false;
            startLongPress();
        });
        element.addEventListener('mouseup', () => cancelLongPress());
        element.addEventListener('mouseleave', () => cancelLongPress());
        
        element.addEventListener('dragstart', (e) => {
            cancelLongPress();
            isDragging = true;
            this.startDrag(playerId, location, slotIndex);
            e.dataTransfer.effectAllowed = 'move';
            element.classList.add('dragging');
            
            const dragPreview = this.createDragPreview(playerId);
            e.dataTransfer.setDragImage(dragPreview, 40, 20);
            setTimeout(() => dragPreview.remove(), 0);
        });

        element.addEventListener('dragend', () => {
            element.classList.remove('dragging');
            this.endDrag();
            isDragging = false;
        });

        // Click handler
        element.addEventListener('click', (e) => {
            e.stopPropagation();
            if (isDragging || longPressTriggered || this.wasDragging || this.longPressJustTriggered) return;
            this.handlePlayerTap(playerId, location, slotIndex);
        });

        // Touch events
        element.addEventListener('touchstart', (e) => {
            e.stopPropagation();
            touchMoved = false;
            longPressTriggered = false;
            this.longPressJustTriggered = false;
            startX = e.touches[0].clientX;
            startY = e.touches[0].clientY;
            this.startDrag(playerId, location, slotIndex);
            
            // Add pressed state class (more reliable than :active on touch)
            element.classList.add('pressed');
            
            // Only start long press for goal/pin if:
            // - On pitch
            // - No bench player selected for swap
            // - Not already dragging another player
            if (location === 'pitch' && !this.selectedBenchPlayer && !this.dragState.draggingPlayer) {
                longPressTimer = setTimeout(() => {
                    // Double-check we haven't started moving (touchMoved is set when drag threshold exceeded)
                    if (!touchMoved) {
                        longPressTriggered = true;
                        this.longPressJustTriggered = true;
                        // Remove pressed state before animation to prevent transform conflict
                        element.classList.remove('pressed');
                        if (this.state.mode === 'live') {
                            triggerGoal();
                        } else if (this.state.mode === 'plan') {
                            triggerPinToggle();
                        }
                    }
                }, CONFIG.LONG_PRESS_MS);
            }
        }, { passive: true });

        element.addEventListener('touchmove', (e) => {
            const touch = e.touches[0];
            const dx = Math.abs(touch.clientX - startX);
            const dy = Math.abs(touch.clientY - startY);
            
            // Cancel long press on ANY movement to prevent accidental goals while dragging
            if (dx > 3 || dy > 3) {
                cancelLongPress();
            }
            
            if (dx > CONFIG.DRAG_THRESHOLD || dy > CONFIG.DRAG_THRESHOLD) {
                touchMoved = true;
                e.preventDefault();
                element.classList.add('dragging');
                this.handleTouchMove(touch);
            }
        }, { passive: false });

        element.addEventListener('touchend', (e) => {
            cancelLongPress();
            element.classList.remove('dragging');
            element.classList.remove('pressed');
            
            if (longPressTriggered) {
                e.preventDefault();
                e.stopPropagation();
                // Use class property to reliably block click events
                this.longPressJustTriggered = true;
                setTimeout(() => { 
                    longPressTriggered = false; 
                    this.longPressJustTriggered = false;
                }, 500);
                this.endDrag();
                return;
            }
            
            if (touchMoved) {
                this.handleTouchDrop(e.changedTouches[0], element);
                this.clearAllDragOverStates();
            } else {
                e.stopPropagation();
                e.preventDefault();
                this.handlePlayerTap(playerId, location, slotIndex);
            }
            this.endDrag();
        });

        element.addEventListener('touchcancel', () => {
            cancelLongPress();
            element.classList.remove('dragging');
            element.classList.remove('pressed');
            this.endDrag();
        });
    }

    /**
     * Handle player tap (click without drag)
     */
    handlePlayerTap(playerId, location, slotIndex) {
        if (location === 'pitch') {
            if (this.selectedBenchPlayer) {
                // Swap with selected bench player
                const lineup = [...this.app.getCurrentLineup()];
                const pitchPlayerId = lineup[slotIndex];
                lineup[slotIndex] = this.selectedBenchPlayer;
                this.app.setCurrentLineup(lineup);
                
                const benchPlayer = this.app.getPlayerById(this.selectedBenchPlayer);
                const pitchPlayer = pitchPlayerId ? this.app.getPlayerById(pitchPlayerId) : null;
                this.app.showToast(`${benchPlayer?.name} ↔ ${pitchPlayer?.name || 'empty'}`);
                
                this.app.finalizePlayerMinutes(pitchPlayerId);
                this.app.startPlayerMinutes(this.selectedBenchPlayer);
                
                if (pitchPlayer) {
                    this.app.recordSubstitution(this.selectedBenchPlayer, pitchPlayerId);
                }
                
                this.clearBenchSelection();
                this.app.renderPitch();
                this.app.renderBench();
                this.app.renderStats();
            } else if (this.state.mode === 'live') {
                this.app.showToast('Select a sub first', 'default', 1500);
            } else {
                // Plan mode: remove from pitch
                this.removePlayerFromPitch(slotIndex);
            }
        } else if (location === 'bench') {
            if (this.state.mode === 'live') {
                // Toggle bench player selection
                if (this.selectedBenchPlayer === playerId) {
                    this.clearBenchSelection();
                    this.app.renderBench();
                } else {
                    this.clearBenchSelection();
                    this.selectedBenchPlayer = playerId;
                    const card = document.querySelector(`.player-card[data-player-id="${playerId}"]`);
                    if (card) card.classList.add('selected-for-swap');
                    this.app.showToast('Tap a pitch player to swap', 'default', 1500);
                }
            } else {
                // Plan mode: add to pitch if empty slot
                const lineup = this.app.getCurrentLineup();
                const hasEmptySlot = lineup.some(id => id === null);
                
                if (hasEmptySlot) {
                    this.addBenchPlayerToPitch(playerId);
                } else {
                    // Toggle selection
                    if (this.selectedBenchPlayer === playerId) {
                        this.clearBenchSelection();
                        this.app.renderBench();
                    } else {
                        this.clearBenchSelection();
                        this.selectedBenchPlayer = playerId;
                        const card = document.querySelector(`.player-card[data-player-id="${playerId}"]`);
                        if (card) card.classList.add('selected-for-swap');
                        this.app.showToast('Tap a pitch player to swap', 'default', 1500);
                    }
                }
            }
        }
    }

    /**
     * Clear bench player selection
     */
    clearBenchSelection() {
        this.selectedBenchPlayer = null;
        document.querySelectorAll('.selected-for-swap').forEach(el => {
            el.classList.remove('selected-for-swap');
        });
    }

    /**
     * Start tracking a drag operation
     */
    startDrag(playerId, location, slotIndex) {
        this.wasDragging = true;
        this.dragState = {
            draggingPlayer: playerId,
            sourceLocation: location,
            sourceSlot: slotIndex
        };
    }

    /**
     * End drag operation
     */
    endDrag() {
        this.clearAllDragOverStates();
        this.dragState = {
            draggingPlayer: null,
            sourceSlot: null,
            sourceLocation: null
        };
        setTimeout(() => { this.wasDragging = false; }, 100);
    }

    /**
     * Handle drop on target
     */
    handleDrop(targetSlotIndex, targetLocation) {
        if (!this.dragState.draggingPlayer) return;

        const { draggingPlayer, sourceLocation, sourceSlot } = this.dragState;
        const lineup = [...this.app.getCurrentLineup()];

        if (targetLocation === 'pitch' && sourceLocation === 'pitch' && sourceSlot === targetSlotIndex) {
            return;
        }

        if (targetLocation === 'pitch') {
            const playerInTarget = lineup[targetSlotIndex];

            if (sourceLocation === 'pitch' && sourceSlot !== null) {
                lineup[sourceSlot] = playerInTarget;
            }
            lineup[targetSlotIndex] = draggingPlayer;
            
            if (sourceLocation === 'bench' && this.state.mode === MODES.LIVE) {
                if (playerInTarget) {
                    this.app.finalizePlayerMinutes(playerInTarget);
                    this.app.recordSubstitution(draggingPlayer, playerInTarget);
                }
                this.app.startPlayerMinutes(draggingPlayer);
            }
        } else if (targetLocation === 'bench') {
            if (sourceLocation === 'pitch' && sourceSlot !== null) {
                this.app.finalizePlayerMinutes(draggingPlayer);
                lineup[sourceSlot] = null;
                if (this.state.mode === 'plan') {
                    this.app.unpinPosition(this.state.selectedPlanInterval, sourceSlot);
                }
            }
        }

        this.app.setCurrentLineup(lineup);
        this.app.renderPitch();
        this.app.renderBench();
        this.app.renderStats();
        
        if (this.state.mode === MODES.LIVE) {
            this.app.updateSubsIconBadge();
        }
    }

    /**
     * Handle drop on bench player (swap)
     */
    handleDropOnBenchPlayer(benchPlayerId) {
        if (!this.dragState.draggingPlayer) return;
        
        const { draggingPlayer, sourceLocation, sourceSlot } = this.dragState;
        
        if (sourceLocation !== 'pitch' || sourceSlot === null) return;
        
        this.app.finalizePlayerMinutes(draggingPlayer);
        this.app.startPlayerMinutes(benchPlayerId);
        
        const lineup = [...this.app.getCurrentLineup()];
        lineup[sourceSlot] = benchPlayerId;
        
        if (this.state.mode === MODES.LIVE) {
            this.app.recordSubstitution(benchPlayerId, draggingPlayer);
        }
        
        this.app.setCurrentLineup(lineup);
        
        const benchPlayer = this.app.getPlayerById(benchPlayerId);
        const pitchPlayer = this.app.getPlayerById(draggingPlayer);
        this.app.showToast(`${benchPlayer?.name} ↔ ${pitchPlayer?.name}`);
        
        this.app.renderPitch();
        this.app.renderBench();
        this.app.renderStats();
        
        if (this.state.mode === MODES.LIVE) {
            this.app.updateSubsIconBadge();
        }
    }

    /**
     * Add bench player to first available pitch slot
     */
    addBenchPlayerToPitch(playerId) {
        if (this.justAddedPlayer) return;
        this.justAddedPlayer = true;
        
        const lineup = this.app.getCurrentLineup();
        const slotFillOrder = this.app.slotFillOrder;
        
        for (const slotIndex of slotFillOrder) {
            if (lineup[slotIndex] === null) {
                const newLineup = [...lineup];
                newLineup[slotIndex] = playerId;
                this.app.setCurrentLineup(newLineup);
                
                const player = this.app.getPlayerById(playerId);
                const { POSITIONS } = this.app.constructor;
                this.app.showToast(`${player?.name} → ${POSITIONS?.[slotIndex] || 'pitch'}`);
                
                this.app.startPlayerMinutes(playerId);
                
                if (this.state.mode === MODES.LIVE && this._removedPlayersForSub.length > 0) {
                    const removedPlayer = this._removedPlayersForSub.shift();
                    this.app.recordSubstitution(playerId, removedPlayer.id);
                }
                
                this.app.renderPitch();
                this.app.renderBench();
                this.app.renderStats();
                setTimeout(() => { this.justAddedPlayer = false; }, 100);
                return;
            }
        }
        this.justAddedPlayer = false;
    }

    /**
     * Remove player from pitch slot
     */
    removePlayerFromPitch(slotIndex) {
        this.justRemovedPlayer = true;
        const lineup = [...this.app.getCurrentLineup()];
        const removedPlayerId = lineup[slotIndex];
        const removedPlayer = removedPlayerId ? this.app.getPlayerById(removedPlayerId) : null;
        
        if (removedPlayerId) {
            this.app.finalizePlayerMinutes(removedPlayerId);
            this.removedPlayersStack.push(removedPlayerId);
            
            if (this.state.mode === 'live' && removedPlayer) {
                this._removedPlayersForSub.push({
                    id: removedPlayerId,
                    name: removedPlayer.name,
                    time: this.app.getElapsedSeconds()
                });
            }
        }
        
        lineup[slotIndex] = null;
        
        if (this.state.mode === 'plan') {
            this.app.unpinPosition(this.state.selectedPlanInterval, slotIndex);
        }
        
        this.app.setCurrentLineup(lineup);
        this.app.renderPitch();
        this.app.renderBench();
        this.app.renderStats();
        
        setTimeout(() => { this.justRemovedPlayer = false; }, 100);
    }

    /**
     * Fill empty slot with removed player
     */
    fillEmptySlot(slotIndex) {
        const lineup = this.app.getCurrentLineup();
        if (lineup[slotIndex] !== null) return;
        
        let playerToAdd = null;
        while (this.removedPlayersStack.length > 0) {
            const candidate = this.removedPlayersStack.pop();
            if (!this.app.isPlayerOnPitch(candidate)) {
                playerToAdd = candidate;
                break;
            }
        }
        
        if (!playerToAdd) return;
        
        const newLineup = [...lineup];
        newLineup[slotIndex] = playerToAdd;
        this.app.setCurrentLineup(newLineup);
        this.app.renderPitch();
        this.app.renderBench();
        this.app.renderStats();
    }

    /**
     * Handle touch move for mobile drag
     */
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

    /**
     * Handle touch drop
     */
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

    /**
     * Clear all drag-over states
     */
    clearAllDragOverStates() {
        document.querySelectorAll('.drag-over').forEach(el => {
            el.classList.remove('drag-over');
        });
    }

    /**
     * Create drag preview element
     */
    createDragPreview(playerId) {
        const dragPreview = document.createElement('div');
        dragPreview.className = 'drag-preview';
        const player = this.app.getPlayerById(playerId);
        dragPreview.textContent = player ? player.name : '';
        document.body.appendChild(dragPreview);
        return dragPreview;
    }
}
