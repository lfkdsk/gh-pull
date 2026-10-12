import { chromium } from 'playwright';
import { createApp } from '../server.js';

// Tests provide all GitHub behavior. Block every non-fixture browser request.
export async function browserFixture(t, options) {
  const server = createApp(options);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  const browser = await chromium.launch({ executablePath: process.env.CHROME_BIN || undefined });
  t.after(() => browser.close());
  const context = await browser.newContext();
  const page = await context.newPage();
  page.setDefaultTimeout(5000);
  const origin = `http://127.0.0.1:${server.address().port}`;
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => {
    if (/Content Security Policy|Refused to|violates.*directive/i.test(message.text())) errors.push(message.text());
  });
  await page.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
  return { page, origin, errors };
}
