import { chromium } from 'playwright';

async function main() {
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext();
  const page = await context.newPage();

  await page.goto('https://www.linkedin.com/login');

  console.log('Log in manually, then wait until you see the feed page.');
  console.log('Then press Enter in the terminal...');

  process.stdin.resume();
  process.stdin.on('data', async () => {
    await page.waitForURL('**/feed/**', { timeout: 120000 });

    await context.storageState({ path: 'linkedin-state.json' });
    console.log('✅ Saved LinkedIn storage state to linkedin-state.json');

    await browser.close();
    process.exit(0);
  });
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
