import { element, icon } from './ui.js';

function githubLink(text, url, className) {
  const link = element('a', text, className);
  try {
    const parsed = new URL(url);
    if (parsed.protocol === 'https:' && parsed.hostname === 'github.com') link.href = parsed.href;
  } catch { /* Render malformed upstream links as plain text. */ }
  link.target = '_blank'; link.rel = 'noopener noreferrer';
  return link;
}

// One native popover is shared by all rows: outside click, Escape, and keyboard
// focus restoration are handled by the browser, without per-row global listeners.
export function createIssuePopover({ onClose = () => {} } = {}) {
  const panel = element('div', undefined, 'issue-popover');
  panel.id = 'closing-issues'; panel.popover = 'auto';
  panel.setAttribute('role', 'dialog'); panel.setAttribute('aria-labelledby', 'closing-issues-title');
  document.body.append(panel);
  let trigger;
  const isOpen = () => panel.matches(':popover-open');
  function position() {
    if ((!isOpen() && !panel.classList.contains('measuring')) || !trigger?.isConnected) return;
    const rect = trigger.getBoundingClientRect();
    const width = panel.offsetWidth, height = panel.offsetHeight;
    panel.style.left = `${Math.max(8, Math.min(rect.left, innerWidth - width - 8))}px`;
    const below = rect.bottom + 6;
    panel.style.top = `${Math.max(8, Math.min(below + height <= innerHeight - 8 ? below : rect.top - height - 6, innerHeight - height - 8))}px`;
  }
  panel.addEventListener('beforetoggle', event => {
    const opening = event.newState === 'open';
    if (opening) {
      // Measure invisibly before the native popover becomes visible. The queued
      // toggle event runs too late and can expose a frame at the old position.
      panel.classList.add('measuring');
      position();
      panel.classList.remove('measuring');
      panel.scrollTop = 0;
    }
    trigger?.setAttribute('aria-expanded', String(opening));
  });
  panel.addEventListener('toggle', event => { if (event.newState === 'closed') onClose(); });
  window.addEventListener('resize', position);
  window.addEventListener('scroll', position, true);
  return {
    get isOpen() { return isOpen(); },
    get pullId() { return isOpen() ? trigger?.closest('.pr-row')?.dataset.prId : null; },
    close() { if (isOpen()) panel.hidePopover(); },
    button(pr) {
      const count = pr.closingIssueCount ?? pr.closingIssues?.length ?? 0;
      if (!count) return null;
      const button = element('button', undefined, 'issue-count');
      button.type = 'button';
      button.title = `Closes ${count} ${count === 1 ? 'issue' : 'issues'}`;
      button.setAttribute('aria-label', `${button.title} · ${pr.repo} #${pr.number}`);
      button.setAttribute('aria-haspopup', 'dialog');
      button.setAttribute('aria-controls', panel.id); button.setAttribute('aria-expanded', 'false');
      button.popoverTargetElement = panel;
      button.append(icon('issue', 14), document.createTextNode(String(count)));
      button.addEventListener('click', () => {
        // Switching directly between buttons should open the new list, not toggle it shut.
        if (trigger !== button && isOpen()) panel.hidePopover();
        trigger?.setAttribute('aria-expanded', 'false'); trigger = button;
        const heading = element('h2', `Closing issues (${count})`); heading.id = 'closing-issues-title';
        const list = element('ul', undefined, 'issue-list');
        for (const issue of pr.closingIssues ?? []) {
          const row = element('li');
          const closed = issue.state === 'CLOSED';
          const symbol = element('span', undefined, `issue-symbol ${closed ? 'issue-closed' : 'issue-open'}`);
          symbol.append(icon(closed ? 'issue-closed' : 'issue'));
          const link = githubLink(undefined, issue.url, 'issue-link');
          link.append(element('span', issue.title, 'issue-title'),
            element('span', `${closed ? 'Closed' : 'Open'} · ${issue.repo} #${issue.number}`, 'issue-detail'));
          link.setAttribute('aria-label', `${issue.title} · ${closed ? 'Closed' : 'Open'} · ${issue.repo} #${issue.number} (opens in a new tab)`);
          row.append(symbol, link); list.append(row);
        }
        panel.replaceChildren(heading, list);
        if (pr.closingIssuesTruncated || count > (pr.closingIssues?.length ?? 0)) {
          panel.append(githubLink('View all linked issues on GitHub ↗', pr.url, 'issue-more'));
        }
      });
      return button;
    },
  };
}
