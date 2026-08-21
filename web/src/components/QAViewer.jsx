import React, { useMemo, useState } from 'react';
import { Inspector, Metric, CoverageBar, DetailHead, Section, EmptyAgent } from './Inspector.jsx';
import DiagramIcon from '../tabs/diagramIcons.jsx';

// QA's output as a coverage report, not a list. A list of 46 test cases looks thorough
// and tells you nothing; what matters is which declared endpoints, error codes and
// business rules actually have a test behind them — and, more importantly, which don't.
// The gaps are computed here against the contract rather than trusted from the model.

export default function QAViewer({ artifact, contract }) {
  const [sel, setSel] = useState(null);
  const [filter, setFilter] = useState('all'); // all | covered | gaps

  const model = useMemo(() => {
    if (!artifact) return null;
    const cases = artifact.test_cases ?? [];
    const cited = new Set(cases.flatMap((t) => t.implements ?? []));

    const apis = contract?.apis ?? [];
    const rules = (contract?.business_rules ?? []).map((r) => {
      const m = r.match(/^([A-Za-z]+-\d+)/);
      return { id: m ? m[1] : r.slice(0, 12), text: r };
    });

    const casesFor = (id) => cases.filter((t) => (t.implements ?? []).includes(id));
    const apiRows = apis.map((a) => ({ kind: 'api', id: a.id, label: `${a.method} ${a.path}`, meta: a, cases: casesFor(a.id) }));
    const ruleRows = rules.map((r) => ({ kind: 'rule', id: r.id, label: r.text, meta: r, cases: casesFor(r.id) }));

    // A test that cites an id the contract doesn't have is drift, same as anywhere else.
    const validIds = new Set([...apis.map((a) => a.id), ...rules.map((r) => r.id), ...(contract?.features ?? []).map((f) => f.id), ...(contract?.collections ?? []).map((c) => c.id)]);
    const unknownCitations = contract ? [...cited].filter((id) => !validIds.has(id)) : [];

    // An endpoint declaring a 409 with no test asserting a 409 is the gap worth surfacing.
    const errorGaps = apis.flatMap((a) =>
      (a.errors ?? [])
        .filter((code) => !casesFor(a.id).some((t) => `${t.expected} ${t.description}`.includes(String(code))))
        .map((code) => ({ api: a.id, label: `${a.method} ${a.path}`, code })),
    );

    return {
      cases, apiRows, ruleRows, unknownCitations, errorGaps,
      apiCovered: apiRows.filter((r) => r.cases.length).length,
      ruleCovered: ruleRows.filter((r) => r.cases.length).length,
    };
  }, [artifact, contract]);

  if (!artifact) return <EmptyAgent role="QA" />;

  const rows = [...model.apiRows, ...model.ruleRows].filter((r) =>
    filter === 'all' ? true : filter === 'gaps' ? r.cases.length === 0 : r.cases.length > 0,
  );

  const detail = sel?.kind === 'case'
    ? (() => {
        const t = model.cases.find((c) => c.id === sel.id);
        if (!t) return null;
        return (
          <>
            <DetailHead icon={<DiagramIcon name="search" size={20} />} title={t.id} sub={`${(t.implements ?? []).length} contract reference(s)`} />
            <p className="dd-body">{t.description}</p>
            <Section title="Steps" count={(t.steps ?? []).length}>
              <ol className="step-list">
                {(t.steps ?? []).map((s, i) => <li key={i}>{s}</li>)}
              </ol>
            </Section>
            <Section title="Expected result">
              <p className="dd-body">{t.expected}</p>
            </Section>
            <Section title="Covers">
              <div className="implements">{(t.implements ?? []).map((id) => <span key={id} className="chip">{id}</span>)}</div>
            </Section>
          </>
        );
      })()
    : sel?.kind === 'target'
      ? (() => {
          const r = [...model.apiRows, ...model.ruleRows].find((x) => x.id === sel.id);
          if (!r) return null;
          return (
            <>
              <DetailHead icon={<DiagramIcon name={r.kind === 'api' ? 'api' : 'lock'} size={20} />} title={r.id} sub={r.kind === 'api' ? r.label : 'business rule'} />
              {r.kind === 'rule' && <p className="dd-body">{r.meta.text}</p>}
              {r.kind === 'api' && (r.meta.errors ?? []).length > 0 && (
                <Section title="Declared error codes">
                  <div className="implements">{r.meta.errors.map((c) => <span key={c} className="chip">{c}</span>)}</div>
                </Section>
              )}
              <Section title="Tests covering this" count={r.cases.length}>
                {r.cases.length === 0 && <div className="notice bad" style={{ marginTop: 6 }}>Nothing tests this. It is declared in the contract but unverified.</div>}
                {r.cases.map((t) => (
                  <button key={t.id} className="dd-edge" onClick={() => setSel({ kind: 'case', id: t.id })}>
                    <span className="dd-dir" style={{ color: 'var(--green)' }}>✓</span>
                    <span className="dd-edge-main">
                      <span className="dd-edge-name">{t.id}</span>
                      <span className="dd-edge-meta">{t.description?.slice(0, 70)}</span>
                    </span>
                  </button>
                ))}
              </Section>
            </>
          );
        })()
      : null;

  return (
    <Inspector
      onCloseDetail={() => setSel(null)}
      detail={detail}
      toolbar={
        <>
          <Metric value={model.cases.length} label="test cases" />
          <Metric value={`${model.apiCovered}/${model.apiRows.length}`} label="endpoints covered" tone={model.apiCovered === model.apiRows.length ? 'ok' : 'warn'} />
          <Metric value={`${model.ruleCovered}/${model.ruleRows.length}`} label="rules covered" tone={model.ruleCovered === model.ruleRows.length ? 'ok' : 'warn'} />
          {model.unknownCitations.length > 0 && <Metric value={model.unknownCitations.length} label="unknown ids cited" tone="bad" />}
          <span style={{ flex: 1 }} />
          <div className="tab-row" style={{ margin: 0 }}>
            {['all', 'covered', 'gaps'].map((f) => (
              <button key={f} className={filter === f ? 'active' : ''} onClick={() => setFilter(f)}>{f}</button>
            ))}
          </div>
        </>
      }
    >
      <div className="pad">
        <div className="notice">
          These tests are <strong>generated</strong> from the contract, not yet executed — running them against the live
          server is the runner's job. Coverage below is computed here against the contract, not taken from the model.
        </div>

        {model.unknownCitations.length > 0 && (
          <div className="notice bad">
            {model.unknownCitations.length} test case{model.unknownCitations.length === 1 ? '' : 's'} cite ids that don't
            exist in the contract: {model.unknownCitations.slice(0, 6).join(', ')}
          </div>
        )}

        <div style={{ display: 'grid', gap: 10, marginBottom: 18 }}>
          <CoverageBar covered={model.apiCovered} total={model.apiRows.length} label="Declared endpoints with a test" />
          <CoverageBar covered={model.ruleCovered} total={model.ruleRows.length} label="Business rules with a test" />
        </div>

        {model.errorGaps.length > 0 && (
          <>
            <div className="section-title">Declared error codes with no asserting test ({model.errorGaps.length})</div>
            <div className="implements" style={{ marginBottom: 18 }}>
              {model.errorGaps.slice(0, 14).map((g, i) => (
                <span key={i} className="chip orphan">{g.label} → {g.code}</span>
              ))}
            </div>
          </>
        )}

        <div className="section-title">Coverage by contract item</div>
        <table className="grid">
          <thead><tr><th style={{ width: 92 }}>Item</th><th>What it is</th><th style={{ width: 78 }}>Tests</th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={`${r.kind}-${r.id}`} onClick={() => setSel({ kind: 'target', id: r.id })} style={{ cursor: 'pointer' }}>
                <td><span className="chip">{r.id}</span></td>
                <td className={r.kind === 'api' ? 'mono' : ''}>{r.kind === 'api' ? r.label : r.label.slice(0, 96)}</td>
                <td>
                  {r.cases.length
                    ? <span className="badge ok">{r.cases.length}</span>
                    : <span className="badge bad">none</span>}
                </td>
              </tr>
            ))}
            {rows.length === 0 && <tr><td colSpan={3} className="hint" style={{ padding: 14 }}>Nothing matches this filter.</td></tr>}
          </tbody>
        </table>

        <div className="section-title" style={{ marginTop: 22 }}>All test cases</div>
        <div className="card-grid">
          {model.cases.map((t) => (
            <button key={t.id} className={`pick-card ${sel?.kind === 'case' && sel.id === t.id ? 'sel' : ''}`} onClick={() => setSel({ kind: 'case', id: t.id })}>
              <div className="pick-head">
                <span className="chip">{t.id}</span>
                <span className="pick-title" style={{ fontSize: 12 }}>{t.description?.slice(0, 54)}</span>
              </div>
              <div className="implements">{(t.implements ?? []).slice(0, 4).map((id) => <span key={id} className="chip other">{id}</span>)}</div>
            </button>
          ))}
        </div>
      </div>
    </Inspector>
  );
}
