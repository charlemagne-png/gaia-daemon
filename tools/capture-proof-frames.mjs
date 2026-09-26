#!/usr/bin/env node
// Headless proof frame capture for quick-links component
// Captures: tokyo-night, apple-dark, apple themes + hover state
// All frames md5-distinct or marked UNVERIFIED

import puppeteer from 'puppeteer';
import { createHash } from 'crypto';
import { readFileSync, writeFileSync } from 'fs';
import { mkdir } from 'fs/promises';

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

const PROOF_URL = 'http://localhost:8899/tools/quick-links-proof.html';
const THEMES = ['tokyo-night', 'apple-dark', 'apple'];
const OUTPUT_DIR = './proof-frames';

async function md5File(path) {
  const content = readFileSync(path);
  return createHash('md5').update(content).digest('hex');
}

async function main() {
  await mkdir(OUTPUT_DIR, { recursive: true });
  
  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  
  const results = [];
  
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1200, height: 800 });
    
    // Capture each theme
    for (const theme of THEMES) {
      const url = `${PROOF_URL}?theme=${theme}`;
      console.log(`Loading ${theme}...`);
      
      await page.goto(url, { waitUntil: 'networkidle0' });
      await page.waitForSelector('.quick-links-container', { timeout: 5000 });
      
      // Wait for any animations to settle
      await sleep(500);
      
      const screenshotPath = `${OUTPUT_DIR}/quick-links-${theme}.png`;
      await page.screenshot({ path: screenshotPath, fullPage: false });
      
      const hash = await md5File(screenshotPath);
      results.push({ theme, path: screenshotPath, md5: hash });
      console.log(`✓ ${theme}: ${hash}`);
    }
    
    // Capture hover state (on apple theme)
    console.log('Capturing hover state...');
    await page.goto(`${PROOF_URL}?theme=apple`, { waitUntil: 'networkidle0' });
    await page.waitForSelector('.quick-links-tile', { timeout: 5000 });
    await sleep(500);
    
    // Hover over first tile
    const firstTile = await page.$('.quick-links-tile');
    if (firstTile) {
      await firstTile.hover();
      await sleep(200); // Let hover transition settle
      
      const screenshotPath = `${OUTPUT_DIR}/quick-links-apple-hover.png`;
      await page.screenshot({ path: screenshotPath, fullPage: false });
      
      const hash = await md5File(screenshotPath);
      results.push({ theme: 'apple-hover', path: screenshotPath, md5: hash });
      console.log(`✓ apple-hover: ${hash}`);
    }
    
    // Check console for errors
    const logs = [];
    page.on('console', msg => {
      if (msg.type() === 'error') {
        logs.push(`ERROR: ${msg.text()}`);
      }
    });
    
    // Verify all MD5s are distinct
    const hashes = results.map(r => r.md5);
    const uniqueHashes = new Set(hashes);
    
    if (hashes.length !== uniqueHashes.size) {
      console.error('⚠ DUPLICATE MD5s detected - frames not distinct!');
      const dupes = hashes.filter((h, i) => hashes.indexOf(h) !== i);
      console.error('Duplicates:', dupes);
    } else {
      console.log('✓ All frames MD5-distinct');
    }
    
    // Write results manifest
    writeFileSync(`${OUTPUT_DIR}/manifest.json`, JSON.stringify(results, null, 2));
    console.log('\nResults:');
    results.forEach(r => console.log(`  ${r.theme}: ${r.path} (${r.md5})`));
    
  } finally {
    await browser.close();
  }
}

main().catch(console.error);
