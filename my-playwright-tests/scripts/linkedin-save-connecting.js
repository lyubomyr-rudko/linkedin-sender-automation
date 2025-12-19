// import fs from 'fs';
// import path from 'path';
// import { chromium } from 'playwright';

// const EMAIL = process.env.LINKEDIN_EMAIL;
// const PASSWORD = process.env.LINKEDIN_PASSWORD;
// const SEARCH_QUERY = process.argv[2] || 'cto';
// const MAX_RESULTS = 120;
// const OUTPUT_FILE = 'linkedin-results.csv';
// const STORAGE_STATE_PATH = path.resolve(process.env.LINKEDIN_STATE_PATH || 'linkedin-state.json');

// async function hasValidSession(page) {
//   await page.goto('https://www.linkedin.com/feed/', { waitUntil: 'domcontentloaded' });
//   const searchInput = page.locator('input[placeholder*="Search"], input[placeholder*="search"]');
//   return await searchInput.isVisible({ timeout: 8000 }).catch(() => false);
// }

// async function login(page) {
//   console.log('🔐 Checking stored LinkedIn session...');
//   if (await hasValidSession(page)) {
//     console.log('🔓 Reusing saved LinkedIn session');
//     return;
//   }

//   console.log('🔐 Stored session unavailable. Logging in with credentials...');
//   await page.goto('https://www.linkedin.com/login');
  
//   await page.fill('#username', EMAIL);
//   await page.fill('#password', PASSWORD);
//   await page.click('button[type="submit"]');
  
//   await page.waitForURL('**/feed/**', { timeout: 60000 });
//   fs.mkdirSync(path.dirname(STORAGE_STATE_PATH), { recursive: true });
//   await page.context().storageState({ path: STORAGE_STATE_PATH });
//   console.log(`💾 Saved new LinkedIn session to ${STORAGE_STATE_PATH}`);
//   console.log('✅ Logged in successfully');
// }

// async function searchPeople(page, query) {
//   console.log(`🔍 Searching for "${query}"...`);
//   const url = `https://www.linkedin.com/search/results/people/?keywords=${encodeURIComponent(query)}&origin=FACETED_SEARCH&network=%5B"S"%5D&geoUrn=%5B"103644278"%5D`;
//   await page.goto(url);
  
//   await page.waitForSelector('[data-view-name="search-result-lockup-title"]', { timeout: 15000 });
//   await page.waitForTimeout(2000);
//   console.log('✅ Search page loaded');
// }

// async function scrapeCurrentPage(page, maxToProcess = Infinity, pendingProfiles = []) {
//   const pageResults = [];
//   let processedCount = 0;
  
//   const nameLinks = await page.locator('a[data-view-name="search-result-lockup-title"]').all();
  
//   for (const link of nameLinks) {
//     if (processedCount >= maxToProcess) break;
//     try {
//       const relationshipButtonText = await link.evaluate(node => {
//         const targetContainer = node.parentElement && node.parentElement.parentElement && node.parentElement.parentElement.parentElement;
//         if (!targetContainer) return '';
//         const relationshipButton = targetContainer.querySelector('[data-view-name="relationship-building-button"]');
//         return relationshipButton ? relationshipButton.textContent.trim() : '';
//       });
//       console.log('relationship-building-button text:', relationshipButtonText || 'Not found');
//       const shouldSkipConnection = relationshipButtonText.toLowerCase().includes('pending') || relationshipButtonText.toLowerCase().includes('follow');
//       if (shouldSkipConnection) {
//         console.log('⏭️  Skipping pending or follow-only profile');
//       }

//       if (relationshipButtonText && !shouldSkipConnection) {
//         const clickedRelationshipButton = await link.evaluate(node => {
//           const targetContainer = node.parentElement && node.parentElement.parentElement && node.parentElement.parentElement.parentElement;
//           if (!targetContainer) return false;
//           const relationshipButton = targetContainer.querySelector('[data-view-name="relationship-building-button"]');
//           if (!relationshipButton) return false;
//           const clickable = relationshipButton.querySelector('a,button');
//           if (!clickable) return false;
//           clickable.click();
//           return true;
//         });
//         console.log('relationship-building-button clicked:', clickedRelationshipButton);

//         if (clickedRelationshipButton) {
//           try {
//             const addNoteButton = page.locator('button[aria-label="Add a note"]');
//             await addNoteButton.first().waitFor({ state: 'visible', timeout: 5000 });
//             await addNoteButton.first().click();
//             console.log('"Add a note" button clicked');

//             const messageBox = page.locator('#custom-message');
//             await messageBox.waitFor({ state: 'visible', timeout: 5000 });
//             await messageBox.fill("Hi! I'm exploring my next remote contract role. I'm a Lead Full-Stack Engineer (Python + TypeScript) with 15+ years of experience at Shutterstock, Adidas, Pearson, and HP. I'd love to see if there's an opportunity on your team.");
//             console.log('Custom message filled');

//             const sendInvitationButton = page.locator('button[aria-label="Send invitation"]');
//             await sendInvitationButton.first().waitFor({ state: 'visible', timeout: 5000 });
//             await sendInvitationButton.first().click();
//             console.log('"Send invitation" button clicked');
//             await page.waitForTimeout(10000);
//             console.log('Waited 10 seconds after sending invitation');
//           } catch (error) {
//             console.log('"Add a note" button not found or not clickable');
//           }
//         }
//       }

//       const name = await link.textContent();
//       const url = await link.getAttribute('href');
      
//       if (name && name.trim()) {
//         const cleanName = name.trim();
//         const profileUrl = url && url.startsWith('http') ? url : `https://www.linkedin.com${url}`;

//         if (shouldSkipConnection && !pendingProfiles.some(p => p.profileUrl === profileUrl)) {
//           pendingProfiles.push({ name: cleanName, profileUrl });
//         }

//         pageResults.push({ name: cleanName, profileUrl });
//         processedCount++;
//       }
//     } catch (error) {
//       continue;
//     }
//   }
  
//   return pageResults;
// }

// async function scrapeResults(page, maxResults) {
//   console.log(`📋 Collecting up to ${maxResults} results...`);
//   const results = [];
//   const pendingResults = [];
//   let currentPage = 1;
  
//   while (results.length < maxResults) {
//     console.log(`\n📄 Processing page ${currentPage}...`);
    
//     const pageResults = await scrapeCurrentPage(page, maxResults - results.length, pendingResults);
    
//     for (const result of pageResults) {
//       if (results.length >= maxResults) break;
      
//       if (!results.some(r => r.profileUrl === result.profileUrl)) {
//         results.push(result);
//         console.log(`👤 ${results.length}. ${result.name}`);
//       }
//     }
    
//     if (pageResults.length === 0) {
//       console.log('No results found on this page');
//       break;
//     }
    
//     const nextButton = page.locator('button[data-testid="pagination-controls-next-button-visible"]');
//     const isNextVisible = await nextButton.isVisible().catch(() => false);
    
//     if (!isNextVisible || results.length >= maxResults) {
//       console.log('✓ Reached end of results or collected enough');
//       break;
//     }
    
//     console.log('⏭️  Going to next page...');
//     await nextButton.click();
//     await page.waitForTimeout(2000);
//     await page.waitForSelector('[data-view-name="search-result-lockup-title"]', { timeout: 10000 });
    
//     currentPage++;
//   }
  
//   return { results, pendingResults };
// }

// function loadExistingProfileUrls(filename) {
//   if (!fs.existsSync(filename)) {
//     return new Set();
//   }

//   const content = fs.readFileSync(filename, 'utf8');
//   const lines = content.split('\n').slice(1);

//   const urls = [];

//   for (const line of lines) {
//     const trimmed = line.trim();
//     if (!trimmed) continue;

//     const match = trimmed.match(/^"([^"]*)","([^"]*)"$/);
//     if (match && match[2]) {
//       urls.push(match[2]);
//     }
//   }

//   return new Set(urls);
// }

// function saveToCSV(results, filename) {
//   if (!results.length) return;

//   const header = 'Name,Profile URL\n';
//   const rows = results
//     .map(r => `"${(r.name || '').replace(/"/g, '""')}","${r.profileUrl || ''}"`)
//     .join('\n');

//   const fileExists = fs.existsSync(filename);
//   const fileHasContent = fileExists ? fs.statSync(filename).size > 0 : false;
//   const dataToAppend = fileHasContent ? `\n${rows}` : `${header}${rows}`;

//   fs.appendFileSync(filename, dataToAppend);
//   console.log(`\n💾 ${fileHasContent ? 'Appended' : 'Saved'} ${results.length} results to ${filename}`);
// }

// (async () => {
//   const browser = await chromium.launch({ 
//     headless: false,
//     slowMo: 100
//   });
//   const hasStoredState = fs.existsSync(STORAGE_STATE_PATH);
//   const contextOptions = hasStoredState ? { storageState: STORAGE_STATE_PATH } : {};
//   const context = await browser.newContext(contextOptions);
//   const page = await context.newPage();
  
//       try {
//     await login(page);
//     await searchPeople(page, SEARCH_QUERY);
//     const { results, pendingResults } = await scrapeResults(page, MAX_RESULTS);

//     const allResults = [...results];

//     for (const p of pendingResults) {
//       if (!allResults.some(r => r.profileUrl === p.profileUrl)) {
//         allResults.push(p);
//       }
//     }

//     const existingUrls = loadExistingProfileUrls(OUTPUT_FILE);

//     const newResults = allResults.filter(
//       r => r.profileUrl && !existingUrls.has(r.profileUrl)
//     );

//     if (newResults.length > 0) {
//       saveToCSV(newResults, OUTPUT_FILE);
//     } else {
//       console.log('ℹ️ No new profiles to save (all already in CSV)');
//     }

//     if (results.length === 0 && pendingResults.length === 0) {
//       console.log('⚠️  No results found');
//     }
//   } catch (error) {
//     console.error('❌ Error:', error.message);
//   } finally {
//     await context.close();
//     await browser.close();
//   }
// })();


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
