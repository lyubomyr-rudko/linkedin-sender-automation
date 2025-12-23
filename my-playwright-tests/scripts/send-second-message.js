import fs from 'fs';
import path from 'path';
import { chromium } from 'playwright';

const EMAIL = process.env.LINKEDIN_EMAIL || '';
const PASSWORD = process.env.LINKEDIN_PASSWORD || '';
const OUTPUT_FILE = 'linkedin-second-message.csv';

const STORAGE_STATE_PATH = path.resolve(process.env.LINKEDIN_STATE_PATH || 'linkedin-state.json');
const TARGET_SNIPPET = `Hi! I'm exploring my next remote contract role.`;
const SECOND_MESSAGE_TEMPLATE =
  `Thanks for connecting, {FirstName}! Quick question — is your team hiring remote contract engineers right now? ` +
  `I'm a Lead Full-Stack (Python + TypeScript). If not you, who's the best person to talk to?`;
const MAX_SCROLL_PASSES = Number(process.env.LINKEDIN_SCROLL_PASSES || 15);
const MAX_SEND_MESSAGES = Number(process.env.LINKEDIN_MAX_SEND_MESSAGES || 1);
const HEADLESS = process.env.PLAYWRIGHT_HEADLESS !== 'false';

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

async function openMessagingInbox(page) {
  console.log('📨 Opening LinkedIn Messaging inbox...');
  await page.goto('https://www.linkedin.com/messaging/', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('li.msg-conversations-container__convo-item', { timeout: 20000 });
  await page.waitForTimeout(1000);
}

async function* collectMatchingConversations(page, targetSnippet) {
  const seenIds = new Set();
  let idlePasses = 0;

  for (let pass = 0; pass < MAX_SCROLL_PASSES; pass++) {
    const newlyVisible = await page.$$eval(
      'li.msg-conversations-container__convo-item',
      (items, snippetLower) => {
        const results = [];

        for (const item of items) {
          if (!item || item.classList.contains('msg-conversation-card--occluded')) continue;

          const snippetNode = item.querySelector('.msg-conversation-card__message-snippet');
          if (!snippetNode) continue;

          const snippetText = (snippetNode.textContent || '').replace(/\s+/g, ' ').trim();
          if (!snippetText) continue;

          if (!snippetText.toLowerCase().includes(snippetLower)) continue;

          const nameNode = item.querySelector('.msg-conversation-card__participant-names');
          const name = (nameNode?.textContent || '').replace(/\s+/g, ' ').trim();
          if (!name) continue;

          const id = item.getAttribute('id') || `${name}-${snippetText}`;
          results.push({ id, name });
        }

        return results;
      },
      targetSnippet.trim().toLowerCase(),
    );

    let addedThisPass = 0;
    for (const convo of newlyVisible) {
      if (seenIds.has(convo.id)) continue;
      seenIds.add(convo.id);
      addedThisPass++;

      const formattedMessage = formatSecondMessage(convo.name);
      yield { id: convo.id, name: convo.name, message: formattedMessage };
    }

    if (addedThisPass === 0) {
      idlePasses++;
    } else {
      idlePasses = 0;
    }

    const clickedLoadMore = await clickLoadMoreConversations(page);
    const scrolled = await scrollConversationList(page);

    if (!clickedLoadMore && !scrolled) {
      if (idlePasses >= 2) break;
    } else {
      await page.waitForTimeout(1200);
    }
  }
}

function formatSecondMessage(fullName) {
  const firstName = extractFirstName(fullName);
  return SECOND_MESSAGE_TEMPLATE.replace('{FirstName}', firstName || 'there');
}

function extractFirstName(name = '') {
  const cleaned = name.replace(/\s+/g, ' ').trim();
  if (!cleaned) return '';

  const parts = cleaned.split(/[\s,]+/).filter(Boolean);
  if (!parts.length) return '';

  const candidate = parts[0];
  return candidate.replace(/[^A-Za-zÀ-ÖØ-öø-ÿ'-]/g, '');
}

function cssEscape(value) {
  return value.replace(/([ !"#$%&'()*+,./:;<=>?@\[\\\]^`{|}~])/g, '\\$1');
}

async function clickLoadMoreConversations(page) {
  const button = page.locator('button:has-text("Load more conversations")');
  const isVisible = await button.isVisible().catch(() => false);
  if (!isVisible) return false;

  try {
    await button.click();
    await page.waitForTimeout(1200);
    return true;
  } catch {
    return false;
  }
}

async function scrollConversationList(page) {
  const container = page.locator('.msg-conversations-container--inbox-shortcuts');
  if (!(await container.count())) return false;

  try {
    const didScroll = await container.evaluate(el => {
      const list = el.querySelector('.msg-conversations-container__conversations-list') || el;
      if (!list) return false;
      const before = list.scrollTop;
      list.scrollTop = before + list.clientHeight;
      if (list.scrollTop === before) {
        list.scrollTop = list.scrollHeight;
      }
      return list.scrollTop !== before;
    });

    if (didScroll) return true;

    const box = await container.boundingBox();
    if (!box) return false;

    await page.mouse.move(box.x + box.width / 2, box.y + Math.min(40, box.height / 2));
    await page.mouse.wheel(0, box.height);
    return true;
  } catch {
    return false;
  }
}

async function run() {
  const browser = await chromium.launch({
    headless: false,
    slowMo: 100,
  });
  const contextOptions = fs.existsSync(STORAGE_STATE_PATH)
    ? { storageState: STORAGE_STATE_PATH }
    : {};

  const context = await browser.newContext(contextOptions);
  const page = await context.newPage();

  await login(page);
  await openMessagingInbox(page);

  let foundAny = false;
  let sentCount = 0;
  for await (const match of collectMatchingConversations(page, TARGET_SNIPPET)) {
    foundAny = true;
    console.log(`✅ Found a conversation with ${match.name}. Drafting reply...`);
    await openConversationAndDraftMessage(page, match);
    sentCount++;
    if (sentCount >= MAX_SEND_MESSAGES) {
      console.log(`⏹️ Reached MAX_SEND_MESSAGES=${MAX_SEND_MESSAGES}, stopping.`);
      break;
    }
  }

  if (!foundAny) {
    console.log('⚠️ No conversations found with the target snippet.');
  }

  await browser.close();
}

run().catch(error => {
  console.error('❌ Failed to scan conversations:', error);
  process.exit(1);
});

async function openConversationAndDraftMessage(page, match) {
  console.log(`✍️ Opening conversation with ${match.name} to draft message...`);
  const convoLink = page.locator(`li#${cssEscape(match.id)} .msg-conversation-listitem__link`);
  await convoLink.scrollIntoViewIfNeeded().catch(() => {});
  await convoLink.click();

  const editor = page.locator('.msg-form__contenteditable[contenteditable="true"]');
  await editor.waitFor({ state: 'visible', timeout: 15000 });
  await editor.click();
  await editor.fill('');
  await editor.type(match.message, { delay: 15 });
  console.log(`📝 Drafted message in the compose box for ${match.name}.`);
  const sendButton = page.locator('.msg-form__send-button');
  const isVisible = await sendButton.isVisible().catch(() => false);
  if (isVisible) {
    await sendButton.click().catch(() => {});
  }
  await page.waitForTimeout(10000);
}
