import test from 'node:test';
import assert from 'node:assert/strict';
import { browserFixture } from './browser-fixture.mjs';

async function fixture(t) {
  const f = await browserFixture(t, { list: async () => ({ items: [] }) });
  await f.page.route(f.origin + '/', route => route.fulfill({ contentType: 'text/html',
    headers: { 'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'none'; style-src-attr 'none'" },
    body: '<!doctype html><html><head><title>Template checks</title></head><body></body></html>',
  }));
  await f.page.clock.install();
  await f.page.goto(f.origin);
  return f;
}

test('author hues use CSSOM on initial render, changes and removal under strict CSP', async t => {
  const { page, errors } = await fixture(t);
  const hues = await page.evaluate(async () => {
    const { render } = await import('/vendor/lit-html.js');
    const { usernameLink } = await import('/templates.js');
    const host = document.body.appendChild(document.createElement('div'));
    const values = [];
    for (const hue of [120, 240, undefined]) {
      render(usernameLink('alice', 'badge author', hue), host);
      values.push(getComputedStyle(host.querySelector('a')).getPropertyValue('--author-hue').trim());
    }
    return values;
  });
  assert.deepEqual(hues, ['120', '240', '']);
  assert.deepEqual(errors, []);
});

test('clipboard feedback keeps Lit icon expressions mounted and updateable', async t => {
  const { page, errors } = await fixture(t);
  await page.evaluate(async () => {
    const { html, render } = await import('/vendor/lit-html.js');
    const { copyFeedback, iconTemplate } = await import('/templates.js');
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: async () => {} } });
    const host = document.body.appendChild(document.createElement('div'));
    window.draw = name => render(html`<div class="pr-row"><button title="Copy" ${copyFeedback('text', 'Copied', 'Copy')}>
      <span class="copy-symbol">${iconTemplate(name)}</span><span class="copy-feedback-symbol" hidden></span>
      </button><span role="status"></span></div>`, host);
    window.draw('copy');
    window.symbol = host.querySelector('.copy-symbol');
    window.marker = window.symbol.firstChild;
  });
  await page.click('button');
  await page.waitForFunction(() => document.querySelector('.copy-feedback-symbol').textContent === '✓');
  await page.evaluate(() => window.draw('edit'));
  assert.equal(await page.evaluate(() => window.symbol.firstChild === window.marker && window.marker.isConnected && window.symbol.hidden), true);
  assert.equal(await page.locator('.copy-symbol svg path').getAttribute('d'), 'M10 3l3 3M2 11l-1 4 4-1L14 5a2.12 2.12 0 0 0-3-3Z');
  await page.clock.fastForward(2000);
  assert.equal(await page.locator('.copy-symbol').evaluate(el => el.hidden), false);
  assert.equal(await page.locator('.copy-feedback-symbol').evaluate(el => el.hidden), true);
  assert.equal(await page.locator('button').getAttribute('title'), 'Copy');
  assert.deepEqual(errors, []);
});
