import { test, expect } from '@playwright/test';

test.describe('Team Selector App', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/?v=' + Date.now());
    await page.waitForTimeout(500);
  });

  test('page loads correctly', async ({ page }) => {
    await expect(page).toHaveTitle(/Team Selector/);
    await expect(page.locator('.pitch .player-card')).toHaveCount(9);
  });

  test('bench has players', async ({ page }) => {
    const benchCount = await page.locator('.bench .player-card').count();
    expect(benchCount).toBeGreaterThan(0);
  });

  test('mode switching works', async ({ page }) => {
    // Switch to Plan
    await page.click('button:has-text("Plan")');
    await page.waitForTimeout(300);
    await expect(page.locator('.interval-tab')).toBeVisible();
    
    // Switch to Live
    await page.click('button:has-text("Live")');
    await page.waitForTimeout(300);
    await expect(page.locator('.timer-controls')).toBeVisible();
  });

  test('timer start/pause works', async ({ page }) => {
    await page.click('button:has-text("Live")');
    await page.waitForTimeout(200);
    
    // Start timer
    await page.click('button:has-text("▶")');
    await page.waitForTimeout(300);
    
    let isRunning = await page.evaluate(() => window.app?.state?.isRunning);
    expect(isRunning).toBe(true);
    
    // Pause timer
    await page.click('button:has-text("⏸")');
    await page.waitForTimeout(300);
    
    isRunning = await page.evaluate(() => window.app?.state?.isRunning);
    expect(isRunning).toBe(false);
  });

  test('kick off event recorded on first start', async ({ page }) => {
    await page.click('button:has-text("Live")');
    await page.click('button:has-text("▶")');
    await page.waitForTimeout(300);
    
    const hasKickOff = await page.evaluate(() => 
      window.app?.state?.matchEvents?.some(e => e.type === 'kickoff')
    );
    expect(hasKickOff).toBe(true);
  });

  test('matchStarted flag set on start', async ({ page }) => {
    await page.click('button:has-text("Live")');
    await page.click('button:has-text("▶")');
    await page.waitForTimeout(300);
    
    const matchStarted = await page.evaluate(() => window.app?.state?.matchStarted);
    expect(matchStarted).toBe(true);
  });

  test('isMatchActive returns correct values', async ({ page }) => {
    await page.click('button:has-text("Live")');
    
    // Before start - should be false
    let isActive = await page.evaluate(() => window.app?.isMatchActive());
    expect(isActive).toBe(false);
    
    // After start - should be true
    await page.click('button:has-text("▶")');
    await page.waitForTimeout(300);
    isActive = await page.evaluate(() => window.app?.isMatchActive());
    expect(isActive).toBe(true);
    
    // After stop - should be false
    await page.click('button:has-text("⏹")');
    await page.waitForTimeout(300);
    isActive = await page.evaluate(() => window.app?.isMatchActive());
    expect(isActive).toBe(false);
  });

  test('full time event on stop', async ({ page }) => {
    await page.click('button:has-text("Live")');
    await page.click('button:has-text("▶")');
    await page.waitForTimeout(500);
    await page.click('button:has-text("⏹")');
    await page.waitForTimeout(300);
    
    const hasFullTime = await page.evaluate(() => 
      window.app?.state?.matchEvents?.some(e => e.type === 'fulltime')
    );
    expect(hasFullTime).toBe(true);
  });

  test('matchEnded flag set on stop', async ({ page }) => {
    await page.click('button:has-text("Live")');
    await page.click('button:has-text("▶")');
    await page.waitForTimeout(300);
    await page.click('button:has-text("⏹")');
    await page.waitForTimeout(300);
    
    const matchEnded = await page.evaluate(() => window.app?.state?.matchEnded);
    expect(matchEnded).toBe(true);
  });

  test('bench player selection for swap', async ({ page }) => {
    await page.click('button:has-text("Live")');
    await page.click('button:has-text("▶")');
    await page.waitForTimeout(300);
    
    // Select bench player
    await page.locator('.bench .player-card').first().click();
    await page.waitForTimeout(300);
    await expect(page.locator('.bench .player-card.selected-for-swap')).toHaveCount(1);
    
    // Deselect by clicking again
    await page.locator('.bench .player-card.selected-for-swap').click();
    await page.waitForTimeout(200);
    await expect(page.locator('.bench .player-card.selected-for-swap')).toHaveCount(0);
  });

  test('swap players between bench and pitch', async ({ page }) => {
    await page.click('button:has-text("Live")');
    await page.click('button:has-text("▶")');
    await page.waitForTimeout(300);
    
    // Get initial bench player name
    const benchPlayerName = await page.locator('.bench .player-card .player-name').first().textContent();
    
    // Select bench player
    await page.locator('.bench .player-card').first().click();
    await page.waitForTimeout(200);
    
    // Click pitch player to swap
    await page.locator('.pitch .player-card').first().click();
    await page.waitForTimeout(500);
    
    // Bench player should now be on pitch
    const pitchHasPlayer = await page.locator(`.pitch .player-card:has-text("${benchPlayerName}")`).count();
    expect(pitchHasPlayer).toBe(1);
  });

  test('subs icon visible in live mode', async ({ page }) => {
    await page.click('button:has-text("Live")');
    await page.waitForTimeout(300);
    
    await expect(page.locator('.subs-icon.visible')).toBeVisible();
  });

  test('score display exists and works', async ({ page }) => {
    await expect(page.locator('#score-us')).toBeVisible();
    await expect(page.locator('#score-them')).toBeVisible();
    
    const scoreUs = await page.locator('#score-us').textContent();
    const scoreThem = await page.locator('#score-them').textContent();
    
    expect(scoreUs).not.toBeNull();
    expect(scoreThem).not.toBeNull();
  });

  test('opponent goal via tap on Them score', async ({ page }) => {
    await page.click('button:has-text("Live")');
    await page.click('button:has-text("▶")');
    await page.waitForTimeout(300);
    
    const initialScore = await page.evaluate(() => window.app?.state?.scoreThem);
    
    // Tap on "Them" score area
    await page.locator('#score-them').click();
    await page.waitForTimeout(500);
    
    const newScore = await page.evaluate(() => window.app?.state?.scoreThem);
    expect(newScore).toBe(initialScore + 1);
  });

  test('player minutes display updates', async ({ page }) => {
    await page.click('button:has-text("Live")');
    await page.click('button:has-text("▶")');
    
    await page.waitForTimeout(1500);
    
    const minsText = await page.locator('.pitch .player-card .player-minutes').first().textContent();
    expect(minsText).toContain("'");
  });

  test('player cards not fully re-rendered during timer', async ({ page }) => {
    await page.click('button:has-text("Live")');
    await page.click('button:has-text("▶")');
    
    // Add a data attribute to track if element is replaced
    await page.evaluate(() => {
      document.querySelector('.pitch .player-card').dataset.testMarker = 'original';
    });
    
    await page.waitForTimeout(1000);
    
    // Check if marker still exists (element wasn't replaced)
    const markerExists = await page.evaluate(() => 
      document.querySelector('.pitch .player-card').dataset.testMarker === 'original'
    );
    expect(markerExists).toBe(true);
  });

  test('settings panel toggles', async ({ page }) => {
    await page.click('button:has-text("Settings")');
    await page.waitForTimeout(300);
    await expect(page.locator('.settings-section')).toBeVisible();
    
    await page.click('button:has-text("Settings")');
    await page.waitForTimeout(300);
    await expect(page.locator('.settings-section')).not.toBeVisible();
  });

  test('squad panel toggles', async ({ page }) => {
    await page.click('button:has-text("Squad")');
    await page.waitForTimeout(300);
    await expect(page.locator('.roster-section')).toBeVisible();
  });

  test('interval tabs work in plan mode', async ({ page }) => {
    await page.click('button:has-text("Plan")');
    await page.waitForTimeout(300);
    
    const tabs = page.locator('.interval-tab');
    const tabCount = await tabs.count();
    expect(tabCount).toBeGreaterThan(0);
    
    // Click second tab if exists
    if (tabCount > 1) {
      await tabs.nth(1).click();
      await page.waitForTimeout(200);
      
      const selectedInterval = await page.evaluate(() => window.app?.state?.selectedPlanInterval);
      expect(selectedInterval).toBe(2);
    }
  });

  test('match events section displays events', async ({ page }) => {
    await page.click('button:has-text("Live")');
    await page.click('button:has-text("▶")');
    await page.waitForTimeout(500);
    
    // Should have at least kick off event
    const events = await page.locator('.match-event').count();
    expect(events).toBeGreaterThan(0);
  });
});
