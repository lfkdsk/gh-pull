import { element, icon, clipboardFeedback } from './ui.js';
import { labels, relativeTime } from './model.js';

export function renderRow(node, gutter, ctx) {
  const { viewedStore, markViewed, viewerLogin, draftChanges, merges, titleEdits, changeDraftStatus, badge, usernameBadge, repositoryLink, render, focusTitleControl, createMergeAction, issuePopover, titleEditor } = ctx;
  const { pr } = node;
  const entry = element('li', undefined, 'dependency-node');
  if (gutter) {
    const gutter = element('div', undefined, 'dependency-gutter');
    gutter.setAttribute('aria-hidden', 'true');
    entry.append(gutter);
  }
  const row = element('div', undefined, 'pr-row');
  row.dataset.prId = pr.id;
  const hasUpdates = viewedStore.hasUpdates(pr);
  row.classList.toggle('has-updates', hasUpdates);
  const onOpen = event => {
    if ((event.type === 'click' && event.button === 0) || (event.type === 'auxclick' && event.button === 1)) {
      if (event.target.closest('a[data-view-pr][href]')) markViewed(pr);
    }
  };
  row.addEventListener('click', onOpen);
  row.addEventListener('auxclick', onOpen);
  const title = element('a', pr.title, 'pr-title');
  // Only navigate to GitHub, even if an upstream response is malformed.
  try { const url = new URL(pr.url); if (url.protocol === 'https:' && url.hostname === 'github.com') title.href = url.href; } catch { /* No unsafe link. */ }
  title.target = '_blank'; title.rel = 'noopener noreferrer';
  title.dataset.viewPr = '';
  title.setAttribute('aria-label', `${hasUpdates ? 'New updates: ' : ''}${pr.title} (opens in a new tab)`);
  const line = element('div', undefined, 'title-line');
  if (node.parent) {
    const relation = element('span', `Merges into #${node.parent.pr.number}: ${node.parent.pr.title}`, 'sr-only');
    line.append(relation);
  }
  const feedback = element('span', undefined, 'sr-only');
  feedback.setAttribute('role', 'status');
  if (['OPEN', 'DRAFT'].includes(pr.status) && pr.author.toLowerCase() === viewerLogin.toLowerCase()) {
    const pending = draftChanges.get(pr.id)?.saving ?? false;
    const status = element('button', pending ? 'Updating…' : labels[pr.status], `badge ${pr.status.toLowerCase()} draft-action`);
    status.type = 'button'; status.disabled = pending || Boolean(merges.get(pr.id)?.saving);
    status.title = pr.status === 'OPEN' ? 'Convert to draft' : 'Mark ready for review';
    status.setAttribute('aria-label', pr.status === 'OPEN' ? `Convert ${pr.title} to draft` : `Mark ${pr.title} ready for review`);
    status.addEventListener('click', () => changeDraftStatus(pr));
    line.append(status);
  } else line.append(badge(labels[pr.status], pr.status));
  if (title.hasAttribute('href')) {
    const copy = element('button', undefined, 'copy-link icon-button');
    copy.type = 'button';
    copy.title = 'Copy PR link';
    copy.setAttribute('aria-label', `Copy link to ${pr.title}`);
    copy.append(icon('copy'));
    clipboardFeedback(copy, { text: title.href, feedback, success: 'PR link copied' });
    const actions = element('span', undefined, 'pr-links');
    actions.append(copy);
    const files = element('a', undefined, 'pr-files icon-button');
    const url = new URL(title.href);
    url.pathname = `${url.pathname.replace(/\/$/, '')}/files`;
    url.search = ''; url.hash = '';
    files.href = url.href;
    files.target = '_blank'; files.rel = 'noopener noreferrer';
    files.dataset.viewPr = '';
    files.title = 'View code changes (opens in a new tab)';
    files.setAttribute('aria-label', `View code changes for ${pr.title} (opens in a new tab)`);
    files.append(icon('files'));
    if (Number.isInteger(pr.changedFiles) && pr.changedFiles >= 0) {
      files.append(element('span', String(pr.changedFiles), 'file-count'));
      files.setAttribute('aria-label', `View code changes for ${pr.title}, ${pr.changedFiles} ${pr.changedFiles === 1 ? 'file' : 'files'} changed (opens in a new tab)`);
    }
    actions.append(files);
    line.append(actions);
  }
  line.append(title);
  if (pr.author.toLowerCase() === viewerLogin.toLowerCase()) {
    const edit = element('button', undefined, 'edit-title icon-button');
    edit.type = 'button'; edit.title = 'Edit PR title';
    edit.setAttribute('aria-label', `Edit title of ${pr.title}`);
    edit.disabled = Boolean(titleEdits.get(pr.id)?.saving || merges.get(pr.id)?.saving);
    edit.append(icon('edit'));
    edit.addEventListener('click', () => {
      if (!titleEdits.has(pr.id)) titleEdits.set(pr.id, { value: pr.title, expectedTitle: pr.title, saving: false, error: '' });
      render(); focusTitleControl(pr.id, '.title-editor input');
    });
    line.append(edit);
  }
  const mergeAction = createMergeAction(pr, title.getAttribute('href'));
  if (mergeAction) line.append(mergeAction);
  const meta = element('div', undefined, 'meta');
  let checks = badge(labels[pr.checks] ?? pr.checks, pr.checks);
  if (pr.checks === 'PENDING' && pr.checkCounts?.total > 0) {
    checks.textContent += ` · ${pr.checkCounts.passed}/${pr.checkCounts.total}`;
    checks.title = `${pr.checkCounts.passed} passed of ${pr.checkCounts.total} checks`;
    checks.setAttribute('aria-label', `Checks pending: ${checks.title}`);
  }
  if (pr.checks === 'FAILURE' && title.hasAttribute('href')) {
    checks = element('a', labels[pr.checks], 'badge failure');
    const url = new URL(title.href);
    url.pathname = `${url.pathname.replace(/\/$/, '')}/checks`;
    url.search = ''; url.hash = '';
    checks.href = url.href;
    checks.target = '_blank'; checks.rel = 'noopener noreferrer';
    checks.dataset.viewPr = '';
    checks.title = 'View checks (opens in a new tab)';
    checks.setAttribute('aria-label', `Checks failed: view checks for ${pr.title} (opens in a new tab)`);
  }
  const author = usernameBadge(pr.author);
  const repo = element('span', undefined, 'badge');
  repo.append(repositoryLink(pr.repo), document.createTextNode(` #${pr.number}`));
  meta.append(repo, author, checks);
  const dependency = node.mergedParent ?? node.externalParent ?? (node.lane > 3 ? node.parent?.pr : null);
  if (dependency) {
    const state = dependency.status === 'MERGED' ? 'merged' : dependency.status === 'CLOSED' ? 'closed' : node.externalParent ? 'not loaded' : '';
    const chip = element('span', `↑ #${dependency.number}${state ? ` · ${state}` : ''}`, 'dependency-chip');
    chip.title = state === 'merged' ? 'Parent PR has already merged; it is no longer an active dependency'
      : state === 'closed' ? 'Parent PR was closed without merging'
      : node.externalParent ? 'Parent PR is outside this group’s loaded open results' : 'Parent PR is beyond the four visible lanes';
    meta.append(chip);
  } else if (node.unloadedBase) {
    const chip = element('span', '↑ base not loaded', 'dependency-chip');
    chip.title = `Base branch: ${pr.baseBranch}. Its parent PR could not be identified in the loaded results or GitHub lookup.`;
    meta.append(chip);
  }
  if (pr.branch) {
    const branch = element('button', undefined, 'branch-copy');
    branch.type = 'button';
    branch.title = `Copy branch name: ${pr.branch}`;
    branch.setAttribute('aria-label', branch.title);
    const symbol = element('span', undefined, 'branch-copy-symbol');
    symbol.setAttribute('aria-hidden', 'true'); symbol.append(icon('copy', 14));
    branch.append(element('span', pr.branch, 'branch-name'), symbol);
    clipboardFeedback(branch, { text: pr.branch, symbol, feedback, success: 'Branch name copied' });
    meta.append(branch);
  }
  if (pr.review !== 'NONE') {
    const review = { APPROVED: 'Approved', CHANGES_REQUESTED: 'Changes requested', REVIEW_REQUIRED: 'Review required', REVIEW_BYPASS_AVAILABLE: 'Review bypass available' };
    const reviewBadge = badge(review[pr.review] ?? pr.review, pr.review);
    if (pr.review === 'REVIEW_BYPASS_AVAILABLE') reviewBadge.title = 'GitHub requires reviews for this branch, but your account can bypass branch protections.';
    meta.append(reviewBadge);
  }
  const age = relativeTime(pr.updatedAt);
  const time = element('time', undefined, 'updated-time');
  time.dateTime = pr.updatedAt;
  time.title = `Updated ${new Date(pr.updatedAt).toLocaleString()}`;
  time.setAttribute('aria-label', `Updated ${age}`);
  time.append(icon('clock', 14), document.createTextNode(age));
  const diffCounts = element('span', undefined, 'diff-counts');
  diffCounts.title = `${pr.additions} additions, ${pr.deletions} deletions`;
  diffCounts.setAttribute('aria-label', diffCounts.title);
  diffCounts.append(element('span', String(pr.additions), 'additions success'), element('span', String(pr.deletions), 'deletions failure'));
  meta.append(time, diffCounts);
  if (Number.isInteger(pr.commentCount) && pr.commentCount >= 0) {
    const comments = element('span', undefined, 'comment-count');
    comments.title = `${pr.commentCount} ${pr.commentCount === 1 ? 'comment' : 'comments'}`;
    comments.setAttribute('aria-label', comments.title);
    comments.append(icon('comment', 14), document.createTextNode(String(pr.commentCount)));
    meta.append(comments);
  }
  const issues = issuePopover.button(pr);
  if (issues) meta.append(issues);
  for (const label of pr.labels) meta.append(badge(label, 'label'));
  const content = element('div', undefined, 'pr-content');
  content.append(line);
  if (merges.get(pr.id)?.error) {
    const error = element('p', merges.get(pr.id).error, 'draft-error error-message');
    error.setAttribute('role', 'alert'); content.append(error);
  }
  if (draftChanges.get(pr.id)?.error) {
    const error = element('p', draftChanges.get(pr.id).error, 'draft-error error-message');
    error.setAttribute('role', 'alert'); content.append(error);
  }
  if (titleEdits.has(pr.id) && pr.author.toLowerCase() === viewerLogin.toLowerCase()) content.append(titleEditor(pr));
  content.append(meta, feedback);
  const reviewers = element('div', undefined, 'reviewers');
  reviewers.setAttribute('role', 'group');
  reviewers.setAttribute('aria-label', 'Reviewers');
  const reviewStates = {
    REQUESTED: ['Awaiting review', 'review_required', '◷'],
    APPROVED: ['Approved', 'approved', '✓'],
    CHANGES_REQUESTED: ['Changes requested', 'changes_requested', '!'],
    COMMENTED: ['Commented', 'commented', '⋯'],
    DISMISSED: ['Review dismissed', 'dismissed', '−'],
  };
  for (const reviewer of pr.reviewers ?? []) {
    const [description, kind, symbol] = reviewStates[reviewer.state] ?? [reviewer.state, 'none', '·'];
    const person = element('span', undefined, 'reviewer');
    person.title = `${reviewer.name}: ${description}`;
    person.setAttribute('aria-label', `${reviewer.name}: ${description}`);
    const status = badge(symbol, kind);
    status.classList.add('review-status');
    status.setAttribute('aria-hidden', 'true');
    person.append(usernameBadge(reviewer.name), status);
    reviewers.append(person);
  }
  if (pr.reviewersTruncated && title.hasAttribute('href')) {
    const all = element('a', 'View all on GitHub');
    all.href = title.href; all.target = '_blank'; all.rel = 'noopener noreferrer';
    all.dataset.viewPr = '';
    reviewers.append(all);
  }
  row.append(content);
  if (pr.reviewers?.length || pr.reviewersTruncated) row.append(reviewers);
  entry.append(row);
  return entry;
}
