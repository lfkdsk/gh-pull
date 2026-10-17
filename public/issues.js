import { element } from './ui.js';
import { html, render, nothing, repeat } from './vendor/lit-html.js';
import { githubUrl, iconTemplate as icon } from './templates.js';

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
    reposition: position,
    get isOpen() { return isOpen(); },
    get pullId() { return isOpen() ? trigger?.closest('.pr-row')?.dataset.prId : null; },
    close() { if (isOpen()) panel.hidePopover(); },
    button(pr) {
      const count = pr.closingIssueCount ?? pr.closingIssues?.length ?? 0;
      const content = () => {
        render(html`<h2 id="closing-issues-title">Closing issues (${count})</h2><ul class="issue-list">
          ${repeat(pr.closingIssues ?? [], issue => `${issue.repo}#${issue.number}`, issue => {
            const closed = issue.state === 'CLOSED';
            return html`<li><span class=${`issue-symbol ${closed ? 'issue-closed' : 'issue-open'}`}>${icon(closed ? 'issue-closed' : 'issue')}</span>
              <a class="issue-link" href=${githubUrl(issue.url)} target="_blank" rel="noopener noreferrer"
                aria-label=${`${issue.title} · ${closed ? 'Closed' : 'Open'} · ${issue.repo} #${issue.number} (opens in a new tab)`}>
                <span class="issue-title">${issue.title}</span><span class="issue-detail">${closed ? 'Closed' : 'Open'} · ${issue.repo} #${issue.number}</span></a></li>`;
          })}</ul>${pr.closingIssuesTruncated || count > (pr.closingIssues?.length ?? 0) ? html`<a class="issue-more" href=${githubUrl(pr.url)} target="_blank" rel="noopener noreferrer">View all linked issues on GitHub ↗</a>` : nothing}`, panel);
      };
      if (isOpen() && trigger?.closest('.pr-row')?.dataset.prId === pr.id) { content(); position(); }
      if (!count) return nothing;
      const title = `Closes ${count} ${count === 1 ? 'issue' : 'issues'}`;
      return html`<button class="issue-count" type="button" title=${title} aria-label=${`${title} · ${pr.repo} #${pr.number}`}
        aria-haspopup="dialog" aria-controls=${panel.id} .popoverTargetElement=${panel}
        @click=${event => {
          const button = event.currentTarget;
          if (trigger !== button && isOpen()) panel.hidePopover();
          trigger?.setAttribute('aria-expanded', 'false'); trigger = button;
          content();
        }} aria-expanded=${String(isOpen() && trigger?.closest('.pr-row')?.dataset.prId === pr.id)}>${icon('issue', 14)}${count}</button>`;
    },
  };
}
