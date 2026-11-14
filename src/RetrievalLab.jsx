import React, { useMemo, useState } from 'react';

const EXAMPLES = [
  'Why did Google login fail?',
  'Which issues are blocked by another issue?',
  '登录回调失败的原因是什么？',
];

function score(value) {
  if (value == null) return '—';
  return Number(value).toFixed(value < 0.1 ? 4 : 3);
}

function ResultCard({ row, channel, rank }) {
  const [expanded, setExpanded] = useState(false);
  const contexts = row.context || [];
  return <article className="retrieval-result-card">
    <header>
      <div className="retrieval-rank">{rank}</div>
      <div className="retrieval-result-title">
        <div><span className={`source-kind source-${row.source_type}`}>{row.source_type}</span><strong>{row.citation_target}</strong></div>
        <span>{row.heading_path || (row.page_from ? `Page ${row.page_from}` : 'Indexed knowledge')}</span>
      </div>
      <div className="retrieval-primary-score"><strong>{score(channel === 'fused' ? row.final_score : row.score)}</strong><span>{channel === 'fused' ? 'final' : channel}</span></div>
    </header>
    <p className="retrieval-excerpt">{row.content}</p>
    {channel === 'fused' && <div className="retrieval-evidence-row">
      <span><i className="evidence-dot vector" />Vector <b>{row.vector_rank ? `#${row.vector_rank}` : '—'}</b><small>{score(row.vector_score)}</small></span>
      <span><i className="evidence-dot lexical" />Lexical <b>{row.lexical_rank ? `#${row.lexical_rank}` : '—'}</b><small>{score(row.lexical_score)}</small></span>
      <span>RRF <b>{score(row.rrf_score)}</b></span>
      <span>Relevance <b>{Math.round((row.rerank_score || 0) * 100)}%</b></span>
    </div>}
    {contexts.length > 0 && <div className="retrieval-context">
      <button type="button" onClick={() => setExpanded(!expanded)} aria-expanded={expanded}><span>Context expansion</span><b>{contexts.length}</b><small>{expanded ? 'Hide' : 'Inspect'}</small></button>
      {expanded && <div className="retrieval-context-list">{contexts.map((passage) => <article key={`${passage.relation}-${passage.passage_id}`}><span>{passage.relation.replace('_', ' ')}</span><p>{passage.content}</p></article>)}</div>}
    </div>}
  </article>;
}

export default function RetrievalLab({ request, workspaceId, teams, onStatus }) {
  const [query, setQuery] = useState('');
  const [selectedTeams, setSelectedTeams] = useState([]);
  const [neighborWindow, setNeighborWindow] = useState(1);
  const [includeParent, setIncludeParent] = useState(true);
  const [channel, setChannel] = useState('fused');
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);

  const rows = useMemo(() => {
    if (!result) return [];
    if (channel === 'vector') return result.vector_results;
    if (channel === 'lexical') return result.lexical_results;
    return result.fused_results;
  }, [channel, result]);

  function toggleTeam(teamId) {
    setSelectedTeams((current) => current.includes(teamId)
      ? current.filter((id) => id !== teamId)
      : [...current, teamId]);
  }

  async function search(event) {
    event?.preventDefault();
    if (!query.trim()) return;
    setLoading(true);
    onStatus('');
    try {
      const payload = await request(`/api/v1/workspaces/${workspaceId}/retrieval/hybrid-search`, {
        method: 'POST',
        timeoutMs: 120000,
        body: JSON.stringify({
          query: query.trim(),
          team_ids: selectedTeams.length ? selectedTeams : null,
          limit: 10,
          candidate_limit: 40,
          neighbor_window: neighborWindow,
          include_parent: includeParent,
        }),
      });
      setResult(payload);
      setChannel('fused');
    } catch (error) {
      onStatus(error.message);
    } finally {
      setLoading(false);
    }
  }

  const timing = result?.pipeline?.timings_ms || {};
  return <section className="retrieval-lab">
    <div className="retrieval-hero">
      <div><span className="eyebrow">KNOWLEDGE · R2</span><h2>Retrieval Lab</h2><p>Inspect how CommonPlan finds evidence before an AI answer is generated.</p></div>
      <div className="retrieval-stage"><span>01 Retrieve</span><i /><span>02 Fuse</span><i /><span>03 Expand</span><i /><span>04 Rerank</span></div>
    </div>

    <form className="retrieval-query" onSubmit={search}>
      <div className="retrieval-query-box"><span aria-hidden="true">⌕</span><textarea value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Ask about issues, projects, comments, or uploaded documents…" rows="2" /><button className="primary" disabled={loading || !query.trim()}>{loading ? 'Searching…' : 'Run retrieval'}</button></div>
      <div className="retrieval-examples"><span>Try</span>{EXAMPLES.map((example) => <button type="button" key={example} onClick={() => setQuery(example)}>{example}</button>)}</div>
    </form>

    <div className="retrieval-controls">
      <div><span>Team scope</span><div className="retrieval-team-chips"><button type="button" className={!selectedTeams.length ? 'selected' : ''} onClick={() => setSelectedTeams([])}>All I can access</button>{teams.map((team) => <button type="button" key={team.id} className={selectedTeams.includes(team.id) ? 'selected' : ''} onClick={() => toggleTeam(team.id)}>{team.issue_prefix}</button>)}</div></div>
      <div><span>Neighbor chunks</span><div className="retrieval-number-control">{[0, 1, 2].map((value) => <button type="button" key={value} className={neighborWindow === value ? 'selected' : ''} onClick={() => setNeighborWindow(value)}>{value}</button>)}</div></div>
      <label className="retrieval-parent-toggle"><input type="checkbox" checked={includeParent} onChange={(event) => setIncludeParent(event.target.checked)} /><span><strong>Parent page</strong><small>Include the full source page</small></span></label>
    </div>

    {!result ? <div className="retrieval-welcome"><div className="retrieval-orbit"><span>R</span></div><h3>See retrieval before generation</h3><p>Run a query to compare semantic and keyword candidates, then inspect exactly why the fused ranking changed.</p></div> : <>
      <div className="retrieval-run-summary">
        <div><span>Total</span><strong>{timing.total ?? 0}<small>ms</small></strong></div>
        <div><span>Embedding</span><strong>{timing.embedding ?? 0}<small>ms</small></strong></div>
        <div><span>Vector DB</span><strong>{timing.vector ?? 0}<small>ms</small></strong></div>
        <div><span>Fusion + context</span><strong>{timing.expansion_rerank ?? 0}<small>ms</small></strong></div>
        <div className="retrieval-profile"><span>Profile</span><code>{result.embedding_profile_key?.split(':').slice(-2).join(':') || 'lexical only'}</code></div>
      </div>
      <div className="retrieval-results-header">
        <div className="retrieval-tabs" role="tablist">{[
          ['fused', 'Fused + reranked', result.fused_results.length],
          ['vector', 'Vector', result.vector_results.length],
          ['lexical', 'Lexical', result.lexical_results.length],
        ].map(([value, label, count]) => <button type="button" role="tab" aria-selected={channel === value} className={channel === value ? 'selected' : ''} key={value} onClick={() => setChannel(value)}><span>{label}</span><b>{count}</b></button>)}</div>
        <span>{result.scope.team_ids.length} team{result.scope.team_ids.length === 1 ? '' : 's'} searched</span>
      </div>
      <div className="retrieval-result-list">{rows.map((row, index) => <ResultCard key={`${channel}-${row.node_id}`} row={row} channel={channel} rank={index + 1} />)}{!rows.length && <div className="retrieval-no-results"><strong>No evidence found</strong><span>Try a broader phrase or search all accessible teams.</span></div>}</div>
    </>}
  </section>;
}
