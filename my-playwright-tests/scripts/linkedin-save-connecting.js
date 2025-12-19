import fs from 'fs';
import path from 'path';
import { chromium } from 'playwright';

const EMAIL = process.env.LINKEDIN_EMAIL;
const PASSWORD = process.env.LINKEDIN_PASSWORD;

const SEARCH_QUERY = process.argv[2] || 'cto';
const MAX_RESULTS = 130;

const OUTPUT_FILE = 'linkedin-global-results.csv';
const STORAGE_STATE_PATH = path.resolve(process.env.LINKEDIN_STATE_PATH || 'linkedin-state.json');

const MAX_EMPTY_PAGES = 5;

async function hasValidSession(page) {
  await page.goto('https://www.linkedin.com/feed/', { waitUntil: 'domcontentloaded' });
  const searchInput = page.locator('input[placeholder*="Search"], input[placeholder*="search"]');
  return await searchInput.isVisible({ timeout: 8000 }).catch(() => false);
}

async function login(page) {
  console.log('🔐 Checking stored LinkedIn session...');
  if (await hasValidSession(page)) {
    console.log('🔓 Reusing saved LinkedIn session');
    return;
  }

  console.log('🔐 Stored session unavailable. Logging in with credentials...');
  await page.goto('https://www.linkedin.com/login', { waitUntil: 'domcontentloaded' });

  await page.fill('#username', EMAIL || '');
  await page.fill('#password', PASSWORD || '');
  await page.click('button[type="submit"]');

  await page.waitForURL('**/feed/**', { timeout: 60000 });

  fs.mkdirSync(path.dirname(STORAGE_STATE_PATH), { recursive: true });
  await page.context().storageState({ path: STORAGE_STATE_PATH });

  console.log(`💾 Saved new LinkedIn session to ${STORAGE_STATE_PATH}`);
  console.log('✅ Logged in successfully');
}

async function searchPeople(page, query) {
  console.log(`🔍 Searching for "${query}"...`);
  const url =
    `https://www.linkedin.com/search/results/people/?` +
    `keywords=${encodeURIComponent(query)}` +
    `&origin=FACETED_SEARCH` +
    `&network=%5B"S"%5D` +
    `&geoUrn=%5B"103644278"%5D`;

  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('a[data-view-name="search-result-lockup-title"]', { timeout: 15000 });
  await page.waitForTimeout(1500);
  console.log('✅ Search page loaded');
}

function normalizeProfileUrl(href) {
  if (!href) return '';
  if (href.startsWith('http')) return href;
  return `https://www.linkedin.com${href}`;
}

/**
 * Return ONLY profiles whose relationship button contains "Pending".
 */
async function scrapePendingFromCurrentPage(page, maxToProcess = Infinity) {
  const pendingProfiles = [];
  let processedCount = 0;

  const nameLinks = await page.locator('a[data-view-name="search-result-lockup-title"]').all();

  for (const link of nameLinks) {
    if (processedCount >= maxToProcess) break;

    try {
      const relationshipButtonText = await link.evaluate(node => {
        const container = node.parentElement?.parentElement?.parentElement || null;
        if (!container) return '';
        const rel = container.querySelector('[data-view-name="relationship-building-button"]');
        return (rel?.textContent || '').trim();
      });

      const isPending = relationshipButtonText.toLowerCase().includes('pending');
      if (!isPending) continue;

      const name = ((await link.textContent()) || '').trim();
      const href = await link.getAttribute('href');
      const profileUrl = normalizeProfileUrl(href);

      if (!name || !profileUrl) continue;

      pendingProfiles.push({ name, profileUrl });
      processedCount++;

      console.log(`⏳ Pending: ${name}`);
    } catch {
      // ignore item failures
    }
  }

  return pendingProfiles;
}

async function isNextButtonClickable(page) {
  const nextButton = page.locator('button[data-testid="pagination-controls-next-button-visible"]');
  const visible = await nextButton.isVisible().catch(() => false);
  if (!visible) return false;

  // LinkedIn often keeps it visible but disabled
  const disabled = await nextButton.isDisabled().catch(() => false);
  if (disabled) return false;

  // Extra guard: aria-disabled sometimes used instead
  const ariaDisabled = await nextButton.getAttribute('aria-disabled').catch(() => null);
  if (ariaDisabled === 'true') return false;

  return true;
}

async function scrapePendingResults(page, maxResults) {
  console.log(`📋 Collecting up to ${maxResults} PENDING results...`);

  const results = [];
  const seen = new Set(); // faster than results.some
  let currentPage = 1;
  let emptyPagesInARow = 0;

  while (results.length < maxResults) {
    console.log(`\n📄 Processing page ${currentPage}...`);

    const remaining = maxResults - results.length;
    const pageResults = await scrapePendingFromCurrentPage(page, remaining);

    let newAddedThisPage = 0;
    for (const r of pageResults) {
      if (results.length >= maxResults) break;
      if (r.profileUrl && !seen.has(r.profileUrl)) {
        seen.add(r.profileUrl);
        results.push(r);
        newAddedThisPage++;
        console.log(`✅ Added (${results.length}/${maxResults}): ${r.name}`);
      }
    }

    // Stop if we couldn't add anything for a few pages in a row
    if (newAddedThisPage === 0) {
      emptyPagesInARow++;
      console.log(`ℹ️ No NEW pending on this page (${emptyPagesInARow}/${MAX_EMPTY_PAGES})`);
      if (emptyPagesInARow >= MAX_EMPTY_PAGES) {
        console.log('🛑 Stopping: too many pages with no new pending profiles.');
        break;
      }
    } else {
      emptyPagesInARow = 0;
    }

    if (results.length >= maxResults) {
      console.log('🛑 Reached MAX_RESULTS.');
      break;
    }

    const canGoNext = await isNextButtonClickable(page);
    if (!canGoNext) {
      console.log('✓ Reached end of results (next disabled/not visible).');
      break;
    }

    console.log('⏭️  Going to next page...');
    const nextButton = page.locator('button[data-testid="pagination-controls-next-button-visible"]');
    await nextButton.click();

    await page.waitForTimeout(1500);
    await page.waitForSelector('a[data-view-name="search-result-lockup-title"]', { timeout: 10000 });

    currentPage++;
  }

  return results;
}

function loadExistingProfileUrls(filename) {
  if (!fs.existsSync(filename)) return new Set();

  const content = fs.readFileSync(filename, 'utf8');
  const lines = content.split('\n').slice(1);

  const urls = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    const match = trimmed.match(/^"([^"]*)","([^"]*)"$/);
    if (match && match[2]) urls.push(match[2]);
  }

  return new Set(urls);
}

function saveToCSV(results, filename) {
  if (!results.length) return;

  const header = 'Name,Profile URL\n';
  const rows = results
    .map(r => `"${(r.name || '').replace(/"/g, '""')}","${r.profileUrl || ''}"`)
    .join('\n');

  const fileExists = fs.existsSync(filename);
  const fileHasContent = fileExists ? fs.statSync(filename).size > 0 : false;

  const dataToAppend = fileHasContent ? `\n${rows}` : `${header}${rows}`;
  fs.appendFileSync(filename, dataToAppend);

  console.log(`\n💾 ${fileHasContent ? 'Appended' : 'Saved'} ${results.length} PENDING results to ${filename}`);
}

(async () => {
  const browser = await chromium.launch({
    headless: false,
    slowMo: 100,
  });

  const hasStoredState = fs.existsSync(STORAGE_STATE_PATH);
  const contextOptions = hasStoredState ? { storageState: STORAGE_STATE_PATH } : {};
  const context = await browser.newContext(contextOptions);
  const page = await context.newPage();

  try {
    await login(page);
    await searchPeople(page, SEARCH_QUERY);

    const pendingResults = await scrapePendingResults(page, MAX_RESULTS);

    const existingUrls = loadExistingProfileUrls(OUTPUT_FILE);
    const newResults = pendingResults.filter(r => r.profileUrl && !existingUrls.has(r.profileUrl));

    if (newResults.length > 0) {
      saveToCSV(newResults, OUTPUT_FILE);
    } else {
      console.log('ℹ️ No new PENDING profiles to save (all already in CSV)');
    }

    if (pendingResults.length === 0) {
      console.log('⚠️  No PENDING profiles found');
    }
  } catch (error) {
    console.error('❌ Error:', error && error.message ? error.message : error);
  } finally {
    await context.close();
    await browser.close();
  }
})();
