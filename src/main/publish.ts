import { REPO } from './github';

const API = 'https://api.github.com';

export async function ghApi(
  token: string,
  path: string,
  init: RequestInit = {},
): Promise<any> {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'Content-Type': 'application/json',
      'X-GitHub-Api-Version': '2022-11-28',
      ...(init.headers || {}),
    },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`GitHub API ${res.status}: ${text.slice(0, 200)}`);
  }
  return res.json();
}

export type CommitFile = {
  path: string;
  /** utf-8 text, or base64 string for binary files (.glb/.gif/images). */
  content?: string;
  encoding?: 'utf-8' | 'base64';
  /** true → delete this path instead of writing it. */
  del?: boolean;
};

/** Commit one or more file writes/deletions atomically to the default branch. */
export async function commitFiles(
  token: string,
  files: CommitFile[],
  message: string,
): Promise<string> {
  const { owner, repo, branch } = REPO;

  // 1. Current branch head + its tree.
  const ref = await ghApi(token, `/repos/${owner}/${repo}/git/ref/heads/${branch}`);
  const headSha: string = ref.object.sha;
  const headCommit = await ghApi(token, `/repos/${owner}/${repo}/git/commits/${headSha}`);
  const baseTreeSha: string = headCommit.tree.sha;

  // 2. Upload blobs (deletions are tree entries with sha: null).
  const treeItems = [];
  for (const f of files) {
    if (f.del) {
      treeItems.push({ path: f.path, mode: '100644', type: 'blob', sha: null });
      continue;
    }
    const blob = await ghApi(token, `/repos/${owner}/${repo}/git/blobs`, {
      method: 'POST',
      body: JSON.stringify({ content: f.content, encoding: f.encoding }),
    });
    treeItems.push({ path: f.path, mode: '100644', type: 'blob', sha: blob.sha });
  }

  // 3. New tree on top of the base tree.
  const tree = await ghApi(token, `/repos/${owner}/${repo}/git/trees`, {
    method: 'POST',
    body: JSON.stringify({ base_tree: baseTreeSha, tree: treeItems }),
  });

  // 4. New commit.
  const commit = await ghApi(token, `/repos/${owner}/${repo}/git/commits`, {
    method: 'POST',
    body: JSON.stringify({ message, tree: tree.sha, parents: [headSha] }),
  });

  // 5. Move the branch to the new commit.
  await ghApi(token, `/repos/${owner}/${repo}/git/refs/heads/${branch}`, {
    method: 'PATCH',
    body: JSON.stringify({ sha: commit.sha }),
  });

  return commit.sha as string;
}
