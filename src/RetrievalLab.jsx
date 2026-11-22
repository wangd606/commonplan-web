import React, { useEffect, useMemo, useState } from 'react';

const RAG_REQUEST_TIMEOUT_MS = Number(import.meta.env.VITE_RAG_REQUEST_TIMEOUT_MS || 420000);

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

function GroundedAnswer({ response }) {
  const [showSources, setShowSources] = useState(false);
  const citationById = new Map(response.citations.map((item) => [item.id, item]));
  const evidenceOnly = response.generation.status === 'evidence_only';
  return <article className="grounded-answer-card">
    <header>
      <div><span className="eyebrow">{evidenceOnly ? 'EVIDENCE PREVIEW' : 'GROUNDED ANSWER'}</span><h3>{evidenceOnly ? 'Retrieved evidence only' : response.generation.insufficient_evidence ? 'Not enough evidence' : 'Answer from your workspace'}</h3></div>
      <div className="generation-badge"><span>{response.generation.provider}</span><strong>{response.generation.timings_ms.total} ms</strong></div>
    </header>
    {evidenceOnly
      ? <p className="grounded-empty">Answer generation is not configured. Review the retrieved evidence below; it has not been presented as an answer.</p>
      : response.generation.insufficient_evidence
        ? <p className="grounded-empty">No authorized evidence was sufficient to produce an answer.</p>
      : <div className="grounded-claims">{response.claims.map((claim, index) => <p key={`${index}-${claim.text}`}><span>{claim.text}</span>{claim.citation_ids.map((id) => <button type="button" key={id} title={citationById.get(id)?.target || id} onClick={() => setShowSources(true)}>[{id}]</button>)}</p>)}</div>}
    {response.agent && <AgentRun agent={response.agent} originalQuery={response.query} />}
    {!!response.citations.length && <div className="grounded-sources">
      <button type="button" onClick={() => setShowSources(!showSources)} aria-expanded={showSources}><span>{evidenceOnly ? 'Retrieved sources' : 'Sources used'}</span><b>{response.citations.length}</b><small>{showSources ? 'Hide evidence' : 'Inspect citations'}</small></button>
      {showSources && <div>{response.citations.map((citation) => <article key={citation.id}><header><b>{citation.id}</b><strong>{citation.target}</strong><span>{citation.source_type}</span></header><p>{citation.excerpt}</p></article>)}</div>}
    </div>}
  </article>;
}

function AgentRun({ agent, originalQuery }) {
  const [expanded, setExpanded] = useState(false);
  const rewritten = agent.final_query && agent.final_query !== originalQuery;
  return <div className="agent-run">
    <button type="button" onClick={() => setExpanded(!expanded)} aria-expanded={expanded}>
      <span><i />Agent run</span>
      <div><b>{agent.model_calls} model calls</b><b>{agent.usage.total_tokens} tokens</b>{agent.rewrites > 0 && <b>{agent.rewrites} rewrite</b>}{agent.answer_retries > 0 && <b>{agent.answer_retries} retry</b>}</div>
      <small>{expanded ? 'Hide trace' : 'Inspect trace'}</small>
    </button>
    {expanded && <div className="agent-run-detail">
      {rewritten && <p><span>Final retrieval query</span><strong>{agent.final_query}</strong></p>}
      <ol>{agent.steps.map((step, index) => <li key={`${index}-${step.node}`}>
        <i>{index + 1}</i><div><strong>{step.node.replaceAll('_', ' ')}</strong><span>{step.decision}</span>{step.detail && <small>{step.detail}</small>}</div>
      </li>)}</ol>
    </div>}
  </div>;
}

export default function RetrievalLab({ request, workspaceId, teams, onStatus }) {
  const [query, setQuery] = useState('');
  const [selectedTeams, setSelectedTeams] = useState([]);
  const [neighborWindow, setNeighborWindow] = useState(1);
  const [includeParent, setIncludeParent] = useState(true);
  const [channel, setChannel] = useState('fused');
  const [result, setResult] = useState(null);
  const [answer, setAnswer] = useState(null);
  const [loadingAction, setLoadingAction] = useState('');
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [requestError, setRequestError] = useState('');

  useEffect(() => {
    if (!loadingAction) {
      setElapsedSeconds(0);
      return undefined;
    }
    const startedAt = Date.now();
    const timer = window.setInterval(() => {
      setElapsedSeconds(Math.floor((Date.now() - startedAt) / 1000));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [loadingAction]);

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

  async function run(event, mode = 'answer') {
    event?.preventDefault();
    if (!query.trim()) return;
    setLoadingAction(mode);
    setRequestError('');
    onStatus('');
    try {
      const endpoint = mode === 'answer' ? 'answer' : 'hybrid-search';
      const payload = await request(`/api/v1/workspaces/${workspaceId}/retrieval/${endpoint}`, {
        method: 'POST',
        timeoutMs: mode === 'answer' ? RAG_REQUEST_TIMEOUT_MS : 120000,
        body: JSON.stringify({
          query: query.trim(),
          team_ids: selectedTeams.length ? selectedTeams : null,
          limit: 10,
          candidate_limit: 40,
          neighbor_window: neighborWindow,
          include_parent: includeParent,
          ...(mode === 'answer' ? { max_citations: 6 } : {}),
        }),
      });
      setResult(mode === 'answer' ? payload.retrieval : payload);
      setAnswer(mode === 'answer' ? payload : null);
      setChannel('fused');
    } catch (error) {
      const message = error.message || 'The retrieval request failed.';
      setRequestError(message);
      onStatus(message);
    } finally {
      setLoadingAction('');
    }
  }

  const timing = result?.pipeline?.timings_ms || {};
  const answerButtonLabel = loadingAction === 'answer'
    ? (elapsedSeconds >= 10 ? `Starting model… ${elapsedSeconds}s` : 'Answering…')
    : 'Ask with citations';
  return <section className="retrieval-lab">
    <div className="retrieval-hero">
      <div><span className="eyebrow">KNOWLEDGE · R4</span><h2>Retrieval Lab</h2><p>Ask a question, inspect the evidence, and verify every grounded claim.</p></div>
      <div className="retrieval-stage"><span>01 Retrieve</span><i /><span>02 Grade</span><i /><span>03 Rewrite</span><i /><span>04 Generate</span><i /><span>05 Verify</span></div>
    </div>

    <form className="retrieval-query" onSubmit={(event) => run(event, 'answer')}>
      <div className="retrieval-query-box"><span aria-hidden="true">⌕</span><textarea value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Ask about issues, projects, comments, or uploaded documents…" rows="2" /><div className="retrieval-actions"><button type="button" className="secondary" disabled={!!loadingAction || !query.trim()} onClick={(event) => run(event, 'retrieve')}>{loadingAction === 'retrieve' ? 'Retrieving…' : 'Inspect retrieval'}</button><button className="primary" disabled={!!loadingAction || !query.trim()}>{answerButtonLabel}</button></div></div>
      <div className="retrieval-examples"><span>Try</span>{EXAMPLES.map((example) => <button type="button" key={example} onClick={() => setQuery(example)}>{example}</button>)}</div>
    </form>

    {loadingAction === 'answer' && <div className="retrieval-request-state" role="status" aria-live="polite">
      <span className="spinner" aria-hidden="true" />
      <div><strong>{elapsedSeconds < 10 ? 'Retrieving and grading evidence…' : 'Starting the generation model…'}</strong><small>{elapsedSeconds < 10 ? 'Searching only the workspace and teams you can access.' : `A scale-to-zero cold start can take several minutes. ${elapsedSeconds}s elapsed.`}</small></div>
    </div>}
    {requestError && <div className="retrieval-request-error" role="alert"><strong>Answer request failed</strong><span>{requestError}</span></div>}

    <div className="retrieval-controls">
      <div><span>Team scope</span><div className="retrieval-team-chips"><button type="button" className={!selectedTeams.length ? 'selected' : ''} onClick={() => setSelectedTeams([])}>All I can access</button>{teams.map((team) => <button type="button" key={team.id} className={selectedTeams.includes(team.id) ? 'selected' : ''} onClick={() => toggleTeam(team.id)}>{team.issue_prefix}</button>)}</div></div>
      <div><span>Neighbor chunks</span><div className="retrieval-number-control">{[0, 1, 2].map((value) => <button type="button" key={value} className={neighborWindow === value ? 'selected' : ''} onClick={() => setNeighborWindow(value)}>{value}</button>)}</div></div>
      <label className="retrieval-parent-toggle"><input type="checkbox" checked={includeParent} onChange={(event) => setIncludeParent(event.target.checked)} /><span><strong>Parent page</strong><small>Include the full source page</small></span></label>
    </div>

    {!result ? <div className="retrieval-welcome"><div className="retrieval-orbit"><span>R</span></div><h3>Ask with verifiable evidence</h3><p>Generate a citation-bound answer or inspect semantic, keyword, fusion, and context stages independently.</p></div> : <>
      {answer && <GroundedAnswer response={answer} />}
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
