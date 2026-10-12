import { createViewedStore, createLatestRequest, mergePullPages } from './state.js';
import { element, icon, clipboardFeedback } from './ui.js';
import { assignNameColors, NAME_COLOR_COUNT, groupPulls, labels, relativeTime } from './model.js';
import { queryFromParams, queryPresets, setQueryPreset, normalizeQuery, queryError } from './query.js';

const $ = id => document.getElementById(id);
const params = new URLSearchParams(location.search);
if ([...$('group').options].some(option => option.value === params.get('group'))) $('group').value = params.get('group');
let appliedQuery = queryFromParams(params);
if (!queryError(appliedQuery)) appliedQuery = normalizeQuery(appliedQuery);
let items = [], total = 0, cursor = null, more = false, limited = false, loading = false;
const loads = createLatestRequest();
const refreshInterval = 60_000;
let nextRefreshAt = Date.now() + refreshInterval;
let authMode = 'local', authenticated = false;
let readinessTimer, readinessController;

function scheduleMergeReadiness(attempt = 0) {
  clearTimeout(readinessTimer);
  readinessController?.abort();
  if (!authenticated || attempt >= 5 || !items.some(pr => pr.mergePending && pr.status === 'OPEN')) return;
  const version = loads.revision;
  readinessTimer = setTimeout(async () => {
    if (loading || titleEdits.size || [...draftChanges.values(), ...merges.values()].some(change => change.saving)) {
      scheduleMergeReadiness(attempt);
      return;
    }
    const pending = items.filter(pr => pr.mergePending && pr.status === 'OPEN').slice(0, 50);
    const query = new URLSearchParams(pending.map(pr => ['id', pr.id]));
    const requestController = new AbortController();
    readinessController = requestController;
    try {
      const response = await apiFetch(`/api/pulls/readiness?${query}`, { signal: requestController.signal });
      if (!response.ok) throw new Error('Could not check merge readiness.');
      const data = await response.json();
      if (version !== loads.revision || requestController.signal.aborted || !authenticated) return;
      for (const update of data.items) {
        const pr = items.find(item => item.id === update.id);
        // Never offer a merge against a commit that is not the displayed version.
        if (pr?.status === 'OPEN' && pr.headOid === update.headOid) Object.assign(pr, update);
      }
      if (!titleEdits.size) render();
    } catch { /* Normal refresh remains available if this short retry fails. */ }
    if (version === loads.revision && !requestController.signal.aborted) scheduleMergeReadiness(attempt + 1);
  }, 2000);
}

async function apiFetch(url, options) {
  const response = await fetch(url, options);
  if (response.status === 401 && authMode === 'github-app') {
    authenticated = false;
    items = []; titleEdits.clear(); draftChanges.clear(); merges.clear();
    $('results').replaceChildren();
    $('dashboard').hidden = true;
    location.replace('/?auth_error=expired');
  }
  return response;
}

function updateRefreshButton() {
  $('refresh').disabled = loading;
  const seconds = Math.max(0, Math.ceil((nextRefreshAt - Date.now()) / 1000));
  $('refresh-countdown').textContent = loading ? '…' : String(seconds);
  const label = loading ? 'Refreshing…' : `Refresh (auto refresh in ${seconds}s)`;
  $('refresh').title = label;
  $('refresh').setAttribute('aria-label', label);
  $('refresh').setAttribute('aria-busy', String(loading));
}
const collapsed = new Set();
const titleEdits = new Map();
const draftChanges = new Map();
const merges = new Map();
let viewerLogin = '';
const nameColorKey = 'gh-pull.name-colors.v1';
let nameColors = assignNameColors([]);
try { nameColors = assignNameColors([], JSON.parse(localStorage.getItem(nameColorKey))); } catch { /* Session colors still work if storage is unavailable. */ }
const viewedStore = createViewedStore({
  getItem: key => localStorage.getItem(key),
  setItem: (key, value) => localStorage.setItem(key, value),
});

function updateSummary() {
  $('summary').textContent = `${items.length} loaded · ${total} total${loading ? ' · Loading…' : ''}${limited ? ' · GitHub search returns at most 1,000 results. Narrow your query to see more specific results.' : ''}`;
}

function updateTitleBrightness() {
  const byId = new Map(items.map(pr => [pr.id, pr]));
  for (const row of $('results').querySelectorAll('.pr-row')) {
    const pr = byId.get(row.dataset.prId);
    const hasUpdates = pr && viewedStore.hasUpdates(pr);
    row.classList.toggle('has-updates', Boolean(hasUpdates));
    if (pr) row.querySelector('.pr-title').setAttribute('aria-label', `${hasUpdates ? 'New updates: ' : ''}${pr.title} (opens in a new tab)`);
  }
  updateSummary();
}

function markViewed(pr) {
  if (viewedStore.mark(pr)) updateTitleBrightness();
}

window.addEventListener('storage', event => {
  if (viewedStore.storageChanged(event.key)) updateTitleBrightness();
});

function badge(text, kind) { return element('span', text, `badge ${kind.toLowerCase()}`); }

function usernameLink(username, className = '') {
  // Team names and the missing-author placeholder are not user profiles.
  if (username === 'deleted-user' || !/^[a-z\d](?:[a-z\d-]*[a-z\d])?$/i.test(username)) return element('span', username, className);
  const link = element('a', username, `${className} username-link`.trim());
  link.href = `https://github.com/${encodeURIComponent(username)}`;
  link.target = '_blank'; link.rel = 'noopener noreferrer';
  link.setAttribute('aria-label', `${username}'s GitHub profile (opens in a new tab)`);
  return link;
}

function usernameBadge(username) {
  const name = usernameLink(username, 'badge author');
  name.style.setProperty('--author-hue', nameColors[username.toLowerCase()] * 360 / NAME_COLOR_COUNT);
  return name;
}

function repositoryLink(repo) {
  const link = element('a', repo, 'repo-link');
  link.href = `https://github.com/${repo.split('/').map(encodeURIComponent).join('/')}`;
  link.target = '_blank'; link.rel = 'noopener noreferrer';
  link.setAttribute('aria-label', `${repo} repository (opens in a new tab)`);
  return link;
}

const changeMessages = {
  title: { failure: 'Could not update the title. Please retry.', timeout: 'The save timed out. Retry to check and save the title.' },
  status: { failure: 'Could not change the PR status. Please retry.', timeout: 'Status change timed out. Click the status badge to retry or refresh to check its status.' },
  merge: { failure: 'Merge failed. Refresh to check its status.', timeout: 'Merge timed out. Refresh to check whether GitHub merged it.' },
};

// All mutations share pending/error handling and mark only the confirmed version
// as read. Action callbacks handle the few differences in visible state and focus.
async function changePull(pr, changes, { action, input = {}, apply, message, onSuccess, onError }) {
  const change = changes.get(pr.id) ?? {};
  if (change.saving) return;
  change.saving = true; change.error = '';
  changes.set(pr.id, change); render();
  const messages = changeMessages[action] ?? changeMessages.status;
  try {
    const response = await apiFetch(`/api/pulls/${action}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: pr.id, ...input }), signal: AbortSignal.timeout(65_000),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || messages.failure);
    apply(items.find(item => item.id === pr.id), data);
    changes.delete(pr.id); render();
    markViewed({ id: pr.id, updatedAt: data.updatedAt });
    $('summary').append(document.createTextNode(` · ${message}`));
    onSuccess?.();
  } catch (error) {
    change.saving = false;
    change.error = error.name === 'TimeoutError' ? messages.timeout : error.message;
    render(); onError?.();
  }
}

async function mergePull(pr) {
  if (authMode === 'github-app' && !pr.mergeAccess?.allowed) return;
  await changePull(pr, merges, {
    action: 'merge', input: { headOid: pr.headOid, mergeMethod: pr.mergeMethod },
    message: `Merged ${pr.repo} #${pr.number}`,
    apply(current, data) {
      if (!current) return;
      Object.assign(current, data);
      if (queryPresets(appliedQuery).state === 'open') {
        items = items.filter(item => item.id !== pr.id);
        total = Math.max(0, total - 1);
      }
    },
  });
}

async function changeDraftStatus(pr) {
  const toDraft = pr.status === 'OPEN';
  await changePull(pr, draftChanges, {
    action: toDraft ? 'draft' : 'ready',
    message: toDraft ? 'PR converted to draft' : 'PR ready for review',
    apply(current, data) {
      if (current) Object.assign(current, { status: data.status, updatedAt: data.updatedAt, review: data.review, canMerge: false, mergePending: !toDraft });
    },
    onSuccess: scheduleMergeReadiness,
  });
}

function focusTitleControl(id, selector) {
  [...$('results').querySelectorAll('.pr-row')].find(row => row.dataset.prId === id)?.querySelector(selector)?.focus();
}

function titleEditor(pr) {
  const draft = titleEdits.get(pr.id);
  const form = element('form', undefined, 'title-editor');
  form.setAttribute('aria-label', `Edit title of ${pr.repo} #${pr.number}`);
  const input = element('input');
  input.type = 'text'; input.value = draft.value; input.required = true; input.maxLength = 256;
  input.setAttribute('aria-label', 'Pull request title');
  input.disabled = draft.saving;
  const save = element('button', draft.saving ? 'Saving…' : 'Save');
  save.type = 'submit';
  save.disabled = draft.saving || !draft.value.trim() || draft.value.trim() === draft.expectedTitle;
  const cancel = element('button', 'Cancel');
  cancel.type = 'button'; cancel.disabled = draft.saving;
  const close = () => {
    if (draft.saving) return;
    titleEdits.delete(pr.id); render(); focusTitleControl(pr.id, '.edit-title');
  };
  cancel.addEventListener('click', close);
  input.addEventListener('input', () => {
    draft.value = input.value;
    save.disabled = !input.value.trim() || input.value.trim() === draft.expectedTitle;
  });
  form.addEventListener('keydown', event => { if (event.key === 'Escape') { event.preventDefault(); close(); } });
  form.append(input, save, cancel);
  if (draft.error) {
    const error = element('p', draft.error, 'title-error error-message');
    error.setAttribute('role', 'alert'); form.append(error);
  }
  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (draft.saving || !draft.value.trim() || draft.value.trim() === draft.expectedTitle) return;
    await changePull(pr, titleEdits, {
      action: 'title', input: { title: draft.value.trim(), expectedTitle: draft.expectedTitle },
      message: 'Title updated',
      apply(current, data) {
        if (current) Object.assign(current, { title: data.title, updatedAt: data.updatedAt });
      },
      onSuccess: () => focusTitleControl(pr.id, '.edit-title'),
      onError: () => focusTitleControl(pr.id, '.title-editor input'),
    });
  });
  return form;
}

function render() {
  const { count, groups } = groupPulls(items, { group: $('group').value, sort: 'query' });
  updateSummary();
  const fragment = document.createDocumentFragment();
  for (const [name, prs] of groups) {
    const section = element('details', undefined, 'pr-group');
    const key = `${$('group').value}:${name}`;
    section.open = !collapsed.has(key);
    section.addEventListener('toggle', () => section.open ? collapsed.delete(key) : collapsed.add(key));
    const heading = element('summary');
    if ($('group').value === 'repo') heading.append(repositoryLink(name), document.createTextNode(` (${prs.length})`));
    else if ($('group').value === 'author') heading.append(usernameLink(name), document.createTextNode(` (${prs.length})`));
    else heading.textContent = `${labels[name] ?? name} (${prs.length})`;
    section.append(heading);
    const list = element('ul', undefined, 'pr-list');
    for (const pr of prs) {
      const row = element('li', undefined, 'pr-row');
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
      if (pr.status === 'OPEN' && pr.canMerge && pr.author.toLowerCase() === viewerLogin.toLowerCase()) {
        const method = { MERGE: 'Merge', SQUASH: 'Squash and merge', REBASE: 'Rebase and merge' }[pr.mergeMethod];
        const merge = element('button', merges.get(pr.id)?.saving ? 'Merging…' : method, 'badge open merge-action');
        merge.type = 'button';
        merge.setAttribute('aria-label', `${method} ${pr.repo} #${pr.number}`);
        const blockedAccess = authMode === 'github-app' && !pr.mergeAccess?.allowed;
        merge.disabled = blockedAccess || Boolean(merges.get(pr.id)?.saving || draftChanges.get(pr.id)?.saving || titleEdits.has(pr.id));
        merge.addEventListener('click', () => mergePull(pr));
        if (blockedAccess) {
          const message = pr.mergeAccess?.message || 'Could not verify app access. Refresh to try again.';
          const control = element('span', undefined, 'merge-access-blocked');
          control.setAttribute('role', 'group');
          control.title = message;
          control.tabIndex = 0;
          control.setAttribute('aria-label', `${method} unavailable. ${message}`);
          control.append(merge); line.append(control);
          if (pr.mergeAccess?.url) {
            const install = element('a', pr.mergeAccess.action, 'merge-access-link');
            install.href = pr.mergeAccess.url;
            install.target = '_blank'; install.rel = 'noopener noreferrer';
            install.title = 'Complete setup on GitHub, then refresh this page. Organization access may require owner approval.';
            line.append(install);
          }
        } else line.append(merge);
      }
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
        const review = { APPROVED: 'Approved', CHANGES_REQUESTED: 'Changes requested', REVIEW_REQUIRED: 'Review required' };
        meta.append(badge(review[pr.review] ?? pr.review, pr.review));
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
      list.append(row);
    }
    section.append(list); fragment.append(section);
  }
  if (!count && !loading) fragment.append(element('p', 'No pull requests found for this query.', 'empty'));
  $('results').replaceChildren(fragment);
  $('results').setAttribute('aria-busy', String(loading));
  $('more').hidden = !more; $('more').disabled = loading;
  updateRefreshButton();
}

async function load({ append = false, refresh = false } = {}) {
  if (!authenticated || !queryEditor) return;
  if (queryError(appliedQuery)) {
    updateQueryControls();
    $('summary').textContent = 'Enter a valid query to load pull requests.';
    nextRefreshAt = Date.now() + refreshInterval;
    updateRefreshButton();
    return;
  }
  clearTimeout(readinessTimer); readinessController?.abort();
  const request = loads.start();
  if (!append && !refresh) { items = []; total = 0; cursor = null; more = false; limited = false; }
  loading = true; $('error').hidden = true;
  if (refresh) {
    // Keep the current rows mounted until fresh data is ready.
    updateSummary();
    updateRefreshButton();
    $('results').setAttribute('aria-busy', 'true');
    $('more').disabled = true;
  } else render();
  const query = new URLSearchParams({ q: appliedQuery });
  if (append && cursor) query.set('cursor', cursor);
  if (refresh) query.set('refresh', '1');
  try {
    const response = await apiFetch(`/api/pulls?${query}`, { signal: request.signal });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Could not load pull requests.');
    if (!loads.isCurrent(request)) return;
    if (viewedStore.selectAccount(data.viewer)) {
      titleEdits.clear();
      draftChanges.clear();
      merges.clear();
    }
    viewerLogin = data.viewer;
    items = mergePullPages(items, data.items, append);
    nameColors = assignNameColors(items.flatMap(pr => [pr.author, ...(pr.reviewers ?? []).map(reviewer => reviewer.name)]), nameColors);
    try { localStorage.setItem(nameColorKey, JSON.stringify(nameColors)); } catch { /* Keep assignments stable for this session. */ }
    total = data.total; cursor = data.pageInfo.endCursor; more = data.pageInfo.hasNextPage;
    limited = data.limited;
    if (limited && items.length >= 1000) more = false;
    $('updated').textContent = `Fetched ${new Date().toLocaleTimeString()}.`;
  } catch (error) {
    if (!loads.isCurrent(request) || error.name === 'AbortError') return;
    $('error').replaceChildren(element('span', error.message + ' '));
    const retry = element('button', 'Retry'); retry.type = 'button';
    retry.addEventListener('click', () => load({ append, refresh: true }));
    $('error').append(retry); $('error').hidden = false;
  } finally {
    if (loads.isCurrent(request)) {
      loading = false;
      nextRefreshAt = Date.now() + refreshInterval;
      render();
      scheduleMergeReadiness();
    }
  }
}

function saveFilters() {
  const query = new URLSearchParams({ q: appliedQuery, group: $('group').value });
  history.replaceState(null, '', `?${query}`);
}
let queryEditor;
async function initializeQueryEditor() {
  if (queryEditor) return;
  const { createQueryEditor } = await import('./query-editor.js');
  queryEditor = createQueryEditor({
    parent: $('query-editor'), value: appliedQuery, getItems: () => items,
    onChange: updateQueryControls, onSubmit: applyQuery,
  });
  updateQueryControls();
}
function updateQueryControls() {
  const value = queryEditor.value;
  for (const [control, preset] of Object.entries(queryPresets(value))) $(control).value = preset;
  const error = queryError(value);
  const hint = value !== appliedQuery ? 'Unapplied changes · Enter to search' : 'Enter to search';
  if ($('query-hint').textContent !== hint) $('query-hint').textContent = hint;
  const feedback = error || '';
  if ($('query-feedback').textContent !== feedback) $('query-feedback').textContent = feedback;
  $('query-help').hidden = Boolean(error);
  $('query-feedback').hidden = !error;
  $('query-feedback').classList.toggle('query-error', Boolean(error));
  $('query-editor').classList.toggle('invalid', Boolean(error));
  $('query-submit').disabled = Boolean(error);
}
function applyQuery() {
  if (queryError(queryEditor.value)) { updateQueryControls(); return; }
  const next = normalizeQuery(queryEditor.value);
  const changed = next !== appliedQuery;
  appliedQuery = next;
  queryEditor.setValue(next);
  updateQueryControls(); saveFilters();
  load({ refresh: !changed });
}
$('filters').addEventListener('submit', event => { event.preventDefault(); applyQuery(); });
for (const id of ['scope', 'state', 'sort']) $(id).addEventListener('change', () => {
  queryEditor.setValue(setQueryPreset(queryEditor.value, id, $(id).value));
  applyQuery();
});
$('group').addEventListener('change', () => { saveFilters(); render(); });
$('refresh').addEventListener('click', () => load({ refresh: true }));
$('more').addEventListener('click', () => load({ append: true }));
setInterval(() => {
  if (!authenticated) return;
  if (!loading && Date.now() >= nextRefreshAt) load({ refresh: true });
  else updateRefreshButton();
}, 1000);

async function initializeSession() {
  $('session-retry').hidden = true;
  $('session-status').hidden = false;
  $('session-status').textContent = 'Connecting…';
  try {
    const response = await fetch('/api/session');
    if (!response.ok) throw new Error('Could not connect. Please retry.');
    const session = await response.json();
    const version = $('deployed-version');
    version.replaceChildren();
    version.hidden = !session.version;
    if (session.version) {
      const commit = element(session.version.url ? 'a' : 'span', session.version.sha.slice(0, 7));
      commit.title = `Deployed commit: ${session.version.sha}`;
      if (session.version.url) {
        commit.href = session.version.url;
        commit.target = '_blank'; commit.rel = 'noopener noreferrer';
      }
      const separator = element('span', ' | ');
      separator.setAttribute('aria-hidden', 'true');
      version.append('version ', commit, separator);
    }
    authMode = session.mode;
    authenticated = session.authenticated;
    $('signin').hidden = authenticated;
    $('dashboard').hidden = true;
    $('links-hint').hidden = !authenticated;
    $('refresh').hidden = !authenticated;
    $('logout').hidden = authMode !== 'github-app' || !authenticated;
    $('install').hidden = authMode !== 'github-app' || !authenticated || !session.installUrl;
    if (session.installUrl) $('install').href = session.installUrl;
    const notices = { state: 'Sign-in expired or could not be verified. Please try again.', denied: 'GitHub authorization was cancelled. Sign in when you are ready.', exchange: 'Could not complete GitHub sign-in. Please try again.', expired: 'Your session expired or authorization was revoked. Please sign in again.' };
    const notice = notices[params.get('auth_error')];
    $('auth-notice').hidden = !notice;
    if (notice) $('auth-notice').textContent = notice;
    $('session-status').hidden = true;
    if (authenticated) {
      await initializeQueryEditor();
      $('dashboard').hidden = false;
      await load();
    }
  } catch {
    authenticated = false;
    $('dashboard').hidden = true;
    $('refresh').hidden = true;
    $('session-status').hidden = false;
    $('session-status').textContent = 'Could not connect. Please retry.';
    $('session-retry').hidden = false;
  }
}
$('session-retry').addEventListener('click', initializeSession);
$('logout').addEventListener('click', async () => {
  $('logout').disabled = true;
  try {
    const response = await fetch('/auth/logout', { method: 'POST' });
    if (!response.ok) throw new Error();
    authenticated = false;
    loads.cancel();
    location.replace('/');
  } catch {
    $('auth-notice').textContent = 'Could not sign out. Please retry.';
    $('auth-notice').hidden = false;
    $('logout').disabled = false;
  }
});
initializeSession();
