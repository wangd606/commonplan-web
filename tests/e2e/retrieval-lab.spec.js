import { expect, test } from '@playwright/test';


const retrieval = {
  scope: { workspace_id: 'workspace-1', team_ids: ['team-1'], project_id: null, issue_id: null },
  embedding_profile_key: 'model_gateway:commonplan-embedding-v1:qwen@revision:1024',
  vector_results: [{ node_id: 'node-1', source_id: 'issue-1', source_type: 'issue', content: 'Google login callback failed.', method: 'vector', score: 0.91, workspace_id: 'workspace-1', team_id: 'team-1', project_id: null, issue_id: 'issue-1', heading_path: null, page_from: null, page_to: null, metadata: {}, citation_target: 'issue:issue-1' }],
  lexical_results: [{ node_id: 'node-1', source_id: 'issue-1', source_type: 'issue', content: 'Google login callback failed.', method: 'lexical', score: 0.34, workspace_id: 'workspace-1', team_id: 'team-1', project_id: null, issue_id: 'issue-1', heading_path: null, page_from: null, page_to: null, metadata: {}, citation_target: 'issue:issue-1' }],
  fused_results: [{ node_id: 'node-1', source_id: 'issue-1', source_type: 'issue', content: 'Google login callback failed.', workspace_id: 'workspace-1', team_id: 'team-1', project_id: null, issue_id: 'issue-1', heading_path: null, page_from: null, page_to: null, metadata: {}, citation_target: 'issue:issue-1', rrf_score: 0.0327, rerank_score: 0.9, final_score: 0.0401, vector_rank: 1, lexical_rank: 1, vector_score: 0.91, lexical_score: 0.34, context: [{ passage_id: 'node-2', relation: 'next', content: 'The redirect URI did not match the Google configuration.', ordinal: 2, heading_path: null, page_from: null, page_to: null }] }],
  pipeline: { fusion: 'rrf-k60', reranker: 'deterministic-coverage-v1', candidate_limit: 40, neighbor_window: 1, include_parent: true, timings_ms: { total: 42.5, embedding: 20.1, vector: 4.2, lexical: 3.1, expansion_rerank: 5.4 } },
};


test('Retrieval Lab renders a citation-bound answer and inspectable R2 evidence', async ({ page }) => {
  await page.route('**/auth/refresh', (route) => route.fulfill({ json: { access_token: 'test-access-token' } }));
  await page.route('**/auth/google/status', (route) => route.fulfill({ json: { configured: false } }));
  await page.route('**/users/me', (route) => route.fulfill({ json: { id: 1, name: 'Retrieval Tester', email: 'tester@example.com' } }));
  await page.route('**/api/v1/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/v1/workspaces') return route.fulfill({ json: [{ id: 'workspace-1', name: 'Demo', my_role: 'owner' }] });
    if (path === '/api/v1/workspaces/workspace-1/teams') return route.fulfill({ json: [{ id: 'team-1', name: 'Core', issue_prefix: 'CORE', my_role: 'lead' }] });
    if (path.endsWith('/retrieval/answer')) return route.fulfill({ json: {
      query: 'Why did Google login fail?',
      answer: 'The callback used a redirect URI that did not match Google configuration. [S1]',
      claims: [{ text: 'The callback used a redirect URI that did not match Google configuration.', citation_ids: ['S1'] }],
      citations: [{ id: 'S1', target: 'issue:issue-1', source_id: 'issue-1', source_type: 'issue', excerpt: 'Google login callback failed because the redirect URI did not match.', heading_path: null, page_from: null, page_to: null }],
      generation: { provider: 'extractive', model: 'deterministic-extractive-v1', grounded: true, insufficient_evidence: false, timings_ms: { retrieval: 42.5, generation: 0.2, total: 42.7 } },
      retrieval,
    } });
    if (path.endsWith('/retrieval/hybrid-search')) return route.fulfill({ json: retrieval });
    if (path.endsWith('/overview')) return route.fulfill({ json: { recent_issues: [] } });
    if (path.endsWith('/cycle-settings')) return route.fulfill({ json: { enabled: false, duration_weeks: 2, upcoming_cycle_count: 3, next_cycle_starts_on: '', rollover_incomplete: true } });
    return route.fulfill({ json: [] });
  });

  await page.goto('/');
  await page.getByRole('button', { name: 'Retrieval Lab' }).click();
  await expect(page.getByRole('heading', { name: 'Retrieval Lab', level: 2 })).toBeVisible();
  await page.getByPlaceholder(/Ask about issues/).fill('Why did Google login fail?');
  await page.getByRole('button', { name: 'Ask with citations' }).click();

  await expect(page.getByRole('heading', { name: 'Answer from your workspace' })).toBeVisible();
  await expect(page.getByText('The callback used a redirect URI')).toBeVisible();
  await page.getByRole('button', { name: '[S1]' }).click();
  await expect(page.getByText('Google login callback failed because')).toBeVisible();
  await expect(page.getByRole('tab', { name: /Fused \+ reranked/ })).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('.retrieval-evidence-row')).toContainText('Vector #1');
  await page.getByRole('button', { name: /Context expansion/ }).click();
  await expect(page.getByText('The redirect URI did not match the Google configuration.', { exact: true })).toBeVisible();
});
