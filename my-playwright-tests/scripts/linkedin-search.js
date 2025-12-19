import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { chromium } from 'playwright';

const EMAIL = process.env.LINKEDIN_EMAIL;
const PASSWORD = process.env.LINKEDIN_PASSWORD;
const SEARCH_QUERY = 'cto';
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DEFAULT_RESULTS_DIR = path.resolve(__dirname, '..');
const MAX_RESULTS = 1;
const TODAY_DATE = new Date().toISOString().split('T')[0];
const RESULTS_DIR = path.resolve(process.env.LINKEDIN_RESULTS_DIR || DEFAULT_RESULTS_DIR);

const OUTPUT_FILE = 'linkedin-global-results.csv';

const RUN_OUTPUT_FILE = process.env.LINKEDIN_RUN_FILE
  ? path.resolve(process.env.LINKEDIN_RUN_FILE)
  : path.join(RESULTS_DIR, `linkedin-results-${TODAY_DATE}.csv`);

const CONNECT_WITH_EMAIL_FILE = process.env.LINKEDIN_CONNECT_WITH_EMAIL_FILE
  ? path.resolve(process.env.LINKEDIN_CONNECT_WITH_EMAIL_FILE)
  : path.join(RESULTS_DIR, 'linkedin-connect-with-email.csv');

const STORAGE_STATE_PATH = path.resolve(process.env.LINKEDIN_STATE_PATH || 'linkedin-state.json');

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
  await page.goto('https://www.linkedin.com/login');

  await page.fill('#username', EMAIL);
  await page.fill('#password', PASSWORD);
  await page.click('button[type="submit"]');

  await page.waitForURL('**/feed/**', { timeout: 60000 });
  fs.mkdirSync(path.dirname(STORAGE_STATE_PATH), { recursive: true });
  await page.context().storageState({ path: STORAGE_STATE_PATH });
  console.log(`💾 Saved new LinkedIn session to ${STORAGE_STATE_PATH}`);
  console.log('✅ Logged in successfully');
}

async function searchPeople(page, query) {
  console.log(`🔍 Searching for "${query}"...`);
  const url = `https://www.linkedin.com/search/results/people/?keywords=${encodeURIComponent(
    query,
  )}&origin=FACETED_SEARCH&network=%5B"S"%5D&geoUrn=%5B"103644278"%5D`;
  await page.goto(url);

  await page.waitForSelector('[data-view-name="search-result-lockup-title"]', { timeout: 15000 });
  await page.waitForTimeout(2000);
  console.log('✅ Search page loaded');
}

// 🔴 Helper to close the invite dialog / overlay if it’s still open
async function closeInviteDialogIfOpen(page) {
  try {
    // Try common close/dismiss buttons first
    const closeButton = page.locator(
      'button[aria-label="Dismiss"], button[aria-label="Cancel"], button[aria-label="Close"]',
    );

    const hasCloseButton = await closeButton.first().isVisible({ timeout: 1000 }).catch(() => false);
    if (hasCloseButton) {
      await closeButton.first().click({ timeout: 2000 }).catch(() => {});
      await page.waitForTimeout(500);
      return;
    }

    // Fallback: ESC to close modal
    await page.keyboard.press('Escape').catch(() => {});
    await page.waitForTimeout(500);
  } catch {
    // swallow any errors, we don't want to crash scraping because close failed
  }
}

async function scrapeCurrentPage(
  page,
  maxToProcess = Infinity,
  seenProfiles = new Set(),
  failedProfiles = [],
) {
  const pageResults = [];
  let processedCount = 0;

  const nameLinks = await page.locator('a[data-view-name="search-result-lockup-title"]').all();

  for (const link of nameLinks) {
    if (processedCount >= maxToProcess) break;

    try {
      const name = await link.textContent();
      const url = await link.getAttribute('href');

      if (!name || !name.trim()) continue;

      const cleanName = name.trim();
      const profileUrl = url && url.startsWith('http') ? url : `https://www.linkedin.com${url}`;
      if (!profileUrl) continue;

      if (seenProfiles.has(profileUrl)) {
        continue;
      }

      const relationshipButtonText = await link.evaluate(node => {
        const targetContainer =
          node.parentElement &&
          node.parentElement.parentElement &&
          node.parentElement.parentElement.parentElement;
        if (!targetContainer) return '';
        const relationshipButton = targetContainer.querySelector(
          '[data-view-name="relationship-building-button"]',
        );
        return relationshipButton ? relationshipButton.textContent.trim() : '';
      });

      console.log('relationship-building-button text:', relationshipButtonText || 'Not found');

      // 🔹 New: separate "pending" vs "following"
      const lowerText = (relationshipButtonText || '').toLowerCase();
      const isPending = lowerText.includes('pending');
      const isFollowing = lowerText.includes('follow');

      // 🔸 Do NOT save "Following" profiles in any file
      if (isFollowing) {
        console.log('⏭️  Skipping follow-only profile (will not be saved anywhere)');
        seenProfiles.add(profileUrl); // mark as seen so we don't reprocess
        processedCount++;
        continue; // completely skip invite + saving
      }

      // For now, "Pending" means we skip sending invite but still can save to results
      const shouldSkipConnection = isPending;

      if (shouldSkipConnection) {
        console.log('⏭️  Skipping pending profile (no new invite)');
      }

      let isFailedSendForThisProfile = false;

      if (relationshipButtonText && !shouldSkipConnection) {
        const clickedRelationshipButton = await link.evaluate(node => {
          const targetContainer =
            node.parentElement &&
            node.parentElement.parentElement &&
            node.parentElement.parentElement.parentElement;
          if (!targetContainer) return false;
          const relationshipButton = targetContainer.querySelector(
            '[data-view-name="relationship-building-button"]',
          );
          if (!relationshipButton) return false;
          const clickable = relationshipButton.querySelector('a,button');
          if (!clickable) return false;
          clickable.click();
          return true;
        });
        console.log('relationship-building-button clicked:', clickedRelationshipButton);

        if (clickedRelationshipButton) {
          let messageFilled = false;
          let sendClicked = false;

          try {
            const addNoteButton = page.locator('button[aria-label="Add a note"]');
            await addNoteButton.first().waitFor({ state: 'visible', timeout: 5000 });
            await addNoteButton.first().click();
            console.log('"Add a note" button clicked');

            const messageBox = page.locator('#custom-message');
            await messageBox.waitFor({ state: 'visible', timeout: 5000 });
            await messageBox.fill(
              "Hi! I'm exploring my next remote contract role. I'm a Lead Full-Stack Engineer (Python + TypeScript) with 15+ years of experience at Shutterstock, Adidas, Pearson, and HP. I'd love to see if there's an opportunity on your team.",
            );
            console.log('Custom message filled');
            messageFilled = true;

            const sendInvitationButton = page.locator('button[aria-label="Send invitation"]');
            await sendInvitationButton.first().waitFor({ state: 'visible', timeout: 5000 });
            await sendInvitationButton.first().click();
            sendClicked = true;
            console.log('"Send invitation" button clicked');

            await page.waitForTimeout(10000);
            console.log('Waited 10 seconds after sending invitation');
          } catch (error) {
            console.log(
              '"Add a note" and/or "Send invitation" flow failed, will track as failed if message was written',
            );

            if (messageFilled && !sendClicked) {
              failedProfiles.push({ name: cleanName, profileUrl });
              isFailedSendForThisProfile = true;
              console.log(`❗ Added to failed-send list: ${cleanName} (${profileUrl})`);
            }
          } finally {
            // Always try to close the modal so it doesn't block pagination
            await closeInviteDialogIfOpen(page);
          }
        }
      }

      // If send failed after message: ONLY in failedProfiles (not in normal results)
      if (!isFailedSendForThisProfile) {
        pageResults.push({ name: cleanName, profileUrl });
      }

      // In all cases (pending / following / success / fail) mark as seen
      seenProfiles.add(profileUrl);
      processedCount++;
    } catch (error) {
      continue;
    }
  }

  return pageResults;
}

async function scrapeResults(page, maxResults, seenProfiles = new Set(), failedProfiles = []) {
  console.log(`📋 Collecting up to ${maxResults} new results...`);
  const results = [];
  let currentPage = 1;

  while (results.length < maxResults) {
    console.log(`\n📄 Processing page ${currentPage}...`);

    const pageResults = await scrapeCurrentPage(
      page,
      maxResults - results.length,
      seenProfiles,
      failedProfiles,
    );

    for (const result of pageResults) {
      if (results.length >= maxResults) break;

      results.push(result);
      console.log(`👤 ${results.length}. ${result.name}`);
    }

    const nextButton = page.locator('button[data-testid="pagination-controls-next-button-visible"]');
    const isNextVisible = await nextButton.isVisible().catch(() => false);

    if (!isNextVisible || results.length >= maxResults) {
      if (!isNextVisible) {
        console.log('✓ Reached end of available search results');
      } else {
        console.log('✓ Collected enough new results');
      }
      break;
    }

    console.log(
      pageResults.length === 0
        ? '⏭️  No new results on this page, moving on...'
        : '⏭️  Going to next page...',
    );

    // Extra safety: close any leftover dialog before clicking "Next"
    await closeInviteDialogIfOpen(page);

    await nextButton.click();
    await page.waitForTimeout(2000);
    await page.waitForSelector('[data-view-name="search-result-lockup-title"]', { timeout: 10000 });

    currentPage++;
  }

  return results;
}

function loadExistingProfiles() {
  const profiles = new Set();
  const directory = path.dirname(OUTPUT_FILE);

  let files = [];
  try {
    files = fs
      .readdirSync(directory)
      .filter(file => /^linkedin-results.*\.csv$/i.test(file));
  } catch (error) {
    console.warn(`⚠️  Could not read directory ${directory}: ${error.message}`);
    return { profiles, files: [] };
  }

  for (const file of files) {
    const filePath = path.join(directory, file);

    try {
      const raw = fs.readFileSync(filePath, 'utf-8').trim();
      if (!raw) continue;

      const lines = raw.split('\n').slice(1);

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        const delimiterIndex = trimmed.lastIndexOf('","');
        if (delimiterIndex === -1) continue;
        const urlSegment = trimmed.slice(delimiterIndex + 2).replace(/^"|"$/g, '');
        if (urlSegment) profiles.add(urlSegment);
      }
    } catch (error) {
      console.warn(`⚠️  Skipping ${file}: ${error.message}`);
    }
  }

  return { profiles, files };
}

function saveToCSV(results, filename) {
  if (!results.length) return;

  const header = 'Name,Profile URL\n';
  const rows = results
    .map(r => `"${r.name.replace(/"/g, '""')}","${r.profileUrl}"`)
    .join('\n');

  const fileExists = fs.existsSync(filename);
  const fileHasContent = fileExists ? fs.statSync(filename).size > 0 : false;
  const dataToAppend = fileHasContent ? `\n${rows}` : `${header}${rows}`;
  fs.mkdirSync(path.dirname(filename), { recursive: true });
  fs.appendFileSync(filename, dataToAppend);
  console.log(
    `\n💾 ${fileHasContent ? 'Appended' : 'Saved'} ${results.length} results to ${filename}`,
  );
}

function saveRunSnapshot(results, filename) {
  if (!results.length) return;

  const header = 'Name,Profile URL\n';
  const rows = results
    .map(r => `"${r.name.replace(/"/g, '""')}","${r.profileUrl}"`)
    .join('\n');

  const fileExists = fs.existsSync(filename);
  const fileHasContent = fileExists ? fs.statSync(filename).size > 0 : false;

  const dataToAppend = fileHasContent ? `\n${rows}` : `${header}${rows}`;

  fs.mkdirSync(path.dirname(filename), { recursive: true });
  fs.appendFileSync(filename, dataToAppend);

  console.log(
    `🆕 ${fileHasContent ? 'Appended' : 'Saved'} ${results.length} results to run snapshot ${filename}`,
  );
}

function saveFailedContacts(results, filename) {
  if (!results.length) return;

  const header = 'Name,Profile URL\n';
  const rows = results
    .map(r => `"${r.name.replace(/"/g, '""')}","${r.profileUrl}"`)
    .join('\n');

  const fileExists = fs.existsSync(filename);
  const fileHasContent = fileExists ? fs.statSync(filename).size > 0 : false;

  const dataToAppend = fileHasContent ? `\n${rows}` : `${header}${rows}`;

  fs.mkdirSync(path.dirname(filename), { recursive: true });
  fs.appendFileSync(filename, dataToAppend);

  console.log(
    `❗ ${fileHasContent ? 'Appended' : 'Saved'} ${results.length} failed-send contacts to ${filename}`,
  );
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

    const { profiles: existingProfiles, files: existingFiles } = loadExistingProfiles();
    if (existingFiles.length > 0) {
      console.log(
        `📁 Loaded ${existingProfiles.size} profiles from ${existingFiles.length} existing file${
          existingFiles.length > 1 ? 's' : ''
        }`,
      );
    }

    const failedSendProfiles = [];
    const results = await scrapeResults(page, MAX_RESULTS, existingProfiles, failedSendProfiles);

    if (results.length > 0) {
      // ✅ Only successful / normal results
      saveToCSV(results, OUTPUT_FILE);
      if (RUN_OUTPUT_FILE !== OUTPUT_FILE) {
        saveRunSnapshot(results, RUN_OUTPUT_FILE);
      }
    } else {
      console.log('⚠️  No results found');
    }

    if (failedSendProfiles.length > 0) {
      // ✅ Contacts where message was filled but send failed → ONLY here
      saveFailedContacts(failedSendProfiles, CONNECT_WITH_EMAIL_FILE);
    }
  } catch (error) {
    console.error('❌ Error:', error.message);
  } finally {
    await context.close();
    await browser.close();
  }
})();
