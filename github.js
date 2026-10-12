import { ApiError, createGraphQLClient } from './github-client.js';
import { mergeOptions, normalizePullRequest } from './pull-request.js';

// Preserve the service API used by the server and existing integrations.
export { ApiError } from './github-client.js';
export { mergeOptions, reviewersFor } from './pull-request.js';
const mergeFields = `headRefOid mergeable mergeStateStatus mergeQueue { id } stackEntry { id }
  repository { nameWithOwner viewerPermission viewerDefaultMergeMethod mergeCommitAllowed squashMergeAllowed rebaseMergeAllowed }`;

export function validateMerge(input) {
  const { id } = validateDraftUpdate(input);
  if (!/^[a-f0-9]{40}$/i.test(input.headOid ?? '') || !['MERGE', 'SQUASH', 'REBASE'].includes(input.mergeMethod)) {
    throw new ApiError('Provide the displayed commit and merge method.', 400);
  }
  return { id, headOid: input.headOid, mergeMethod: input.mergeMethod };
}

const fields = `id number title url state isDraft createdAt updatedAt headRefName
  author { login } repository { nameWithOwner }
  ${mergeFields}
  additions deletions changedFiles totalCommentsCount reviewDecision
  reviewRequests(first: 100) {
    pageInfo { hasNextPage }
    nodes { requestedReviewer {
      ... on Actor { login }
      ... on Team { slug organization { login } }
      ... on EnterpriseTeam { name }
    } }
  }
  latestReviews(first: 100) {
    pageInfo { hasNextPage }
    nodes { author { login } state }
  }
  labels(first: 10) { nodes { name } }
  commits(last: 1) { nodes { commit { statusCheckRollup {
    state
    contexts {
      totalCount
      checkRunCountsByState { state count }
      statusContextCountsByState { state count }
    }
  } } } }`;

export function validateTitleUpdate(input) {
  if (!input || typeof input.id !== 'string' || !input.id.trim() || input.id.length > 200 ||
      typeof input.title !== 'string' || !input.title.trim() || input.title.trim().length > 256 ||
      /[\r\n]/.test(input.title) || typeof input.expectedTitle !== 'string') {
    throw new ApiError('Provide a PR ID, its current title, and a new single-line title (1–256 characters).', 400);
  }
  return { id: input.id, title: input.title.trim(), expectedTitle: input.expectedTitle };
}

export function validateDraftUpdate(input) {
  if (!input || typeof input.id !== 'string' || !input.id.trim() || input.id.length > 200) {
    throw new ApiError('Provide a valid pull request ID.', 400);
  }
  return { id: input.id };
}

export function createGitHub(options = {}) {
  const { getMergeAccess } = options;
  const graphql = createGraphQLClient(options);

  async function ownedPullRequest(id, selection, deniedMessage) {
    const data = await graphql(`query($id: ID!) {
      viewer { login }
      node(id: $id) { __typename ... on PullRequest { ${selection} } }
    }`, { id });
    const pr = data.node;
    if (pr?.__typename !== 'PullRequest') throw new ApiError('Pull request not found.', 404);
    if (!pr.author?.login || pr.author.login.toLowerCase() !== data.viewer.login.toLowerCase()) {
      throw new ApiError(deniedMessage, 403);
    }
    return { pr, viewer: data.viewer.login };
  }

  async function withMergeAccess(items) {
    if (!getMergeAccess) return items;
    const repos = [...new Set(items.filter(pr => pr.canMerge || pr.mergePending).map(pr => pr.repo))];
    const access = await getMergeAccess(repos);
    return items.map(pr => access.has(pr.repo) ? { ...pr, mergeAccess: access.get(pr.repo) } : pr);
  }
  async function list({ scope = 'authored', state = 'open', cursor = null, query: customQuery } = {}) {
    const states = { open: ['OPEN'], closed: ['CLOSED'], merged: ['MERGED'], all: ['OPEN', 'CLOSED', 'MERGED'] }[state];
    if (!states || !['authored', 'involved', 'review'].includes(scope)) throw new ApiError('Invalid filter.', 400);
    let data, connection;
    if (customQuery === undefined && scope === 'authored') {
      data = await graphql(`query($cursor: String, $states: [PullRequestState!]) {
        viewer { login pullRequests(first: 50, after: $cursor, states: $states,
          orderBy: {field: UPDATED_AT, direction: DESC}) {
          totalCount pageInfo { hasNextPage endCursor } nodes { ${fields} }
        } }
      }`, { cursor, states });
      connection = data.viewer.pullRequests;
    } else {
      const qualifier = scope === 'involved' ? 'involves:@me' : 'review-requested:@me';
      const query = customQuery ?? `is:pr ${qualifier} ${state === 'all' ? '' : `is:${state}`} sort:updated-desc`;
      data = await graphql(`query($cursor: String, $query: String!) {
        viewer { login }
        search(type: ISSUE, query: $query, first: 50, after: $cursor) {
          issueCount pageInfo { hasNextPage endCursor } nodes { ... on PullRequest { ${fields} } }
        }
      }`, { cursor, query });
      connection = data.search;
    }
    return {
      viewer: data.viewer.login,
      total: connection.totalCount ?? connection.issueCount,
      limited: connection.issueCount > 1000,
      pageInfo: connection.pageInfo,
      items: await withMergeAccess(connection.nodes.filter(pr => pr?.id).map(pr => normalizePullRequest(pr, data.viewer.login))),
    };
  }

  list.mergeReadiness = async ids => {
    const data = await graphql(`query($ids: [ID!]!) {
      viewer { login }
      nodes(ids: $ids) { ... on PullRequest {
        id state isDraft author { login } reviewDecision ${mergeFields}
        commits(last: 1) { nodes { commit { statusCheckRollup { state } } } }
      } }
    }`, { ids });
    return { items: await withMergeAccess(data.nodes.filter(pr => pr?.id).map(pr => ({ id: pr.id, repo: pr.repository?.nameWithOwner, ...mergeOptions(pr, data.viewer.login) }))) };
  };

  list.merge = async input => {
    const { id, headOid, mergeMethod } = validateMerge(input);
    const { pr, viewer } = await ownedPullRequest(id, fields, 'You can only merge your own pull requests.');
    const readiness = mergeOptions(pr, viewer);
    if (!readiness.canMerge) throw new ApiError('This PR is no longer ready to merge. Refresh to see its current status.', 409);
    if (pr.headRefOid !== headOid) throw new ApiError('New commits were pushed. Refresh and review the changes before merging.', 409);
    if (readiness.mergeMethod !== mergeMethod) throw new ApiError('The preferred merge method changed. Refresh before merging.', 409);
    if (getMergeAccess) {
      const access = (await getMergeAccess([pr.repository.nameWithOwner])).get(pr.repository.nameWithOwner);
      if (!access?.allowed) throw new ApiError(access?.message || 'Could not verify app access. Refresh to try again.', 403);
    }
    const data = await graphql(`mutation($input: MergePullRequestInput!) {
      mergePullRequest(input: $input) { pullRequest { id state updatedAt } }
    }`, { input: { pullRequestId: id, expectedHeadOid: headOid, mergeMethod } });
    const merged = data.mergePullRequest?.pullRequest;
    if (merged?.state !== 'MERGED') throw new ApiError('GitHub did not confirm the merge. Refresh to check its status.');
    return { id: merged.id, status: 'MERGED', updatedAt: merged.updatedAt, canMerge: false };
  };

  list.updateTitle = async input => {
    const { id, title, expectedTitle } = validateTitleUpdate(input);
    const { pr } = await ownedPullRequest(id, 'id title updatedAt author { login }', 'You can only edit titles of your own pull requests.');
    // An unchanged retry is safe if the first mutation succeeded but its response was lost.
    if (pr.title === title) return { id: pr.id, title: pr.title, updatedAt: pr.updatedAt };
    if (pr.title !== expectedTitle) throw new ApiError('The title changed on GitHub. Cancel this edit and refresh before editing again.', 409);
    const data = await graphql(`mutation($input: UpdatePullRequestInput!) {
      updatePullRequest(input: $input) { pullRequest { id title updatedAt } }
    }`, { input: { pullRequestId: id, title } });
    if (!data.updatePullRequest?.pullRequest) throw new ApiError('GitHub did not confirm the title update. Refresh to check its current title.');
    return data.updatePullRequest.pullRequest;
  };
  async function setDraftState(input, draft) {
    const { id } = validateDraftUpdate(input);
    const draftFields = 'id state isDraft updatedAt reviewDecision';
    let { pr } = await ownedPullRequest(id, `${draftFields} author { login }`, 'You can only change the draft status of your own pull requests.');
    if (pr.state !== 'OPEN') throw new ApiError('Only open pull requests can change draft status. Refresh to see the latest status.', 409);
    if (pr.isDraft !== draft) {
      const mutation = draft ? 'convertPullRequestToDraft' : 'markPullRequestReadyForReview';
      const inputType = draft ? 'ConvertPullRequestToDraftInput' : 'MarkPullRequestReadyForReviewInput';
      const data = await graphql(`mutation($input: ${inputType}!) {
        ${mutation}(input: $input) { pullRequest { ${draftFields} } }
      }`, { input: { pullRequestId: id } });
      pr = data[mutation]?.pullRequest;
      if (pr?.isDraft !== draft || pr.state !== 'OPEN') throw new ApiError('GitHub did not confirm the status change. Refresh to check its status.');
    }
    return { id: pr.id, status: draft ? 'DRAFT' : 'OPEN', updatedAt: pr.updatedAt, review: pr.reviewDecision || 'NONE' };
  }
  list.convertToDraft = input => setDraftState(input, true);
  list.markReadyForReview = input => setDraftState(input, false);
  return list;
}
