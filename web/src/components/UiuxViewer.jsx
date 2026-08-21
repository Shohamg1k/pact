import React, { useMemo, useState } from 'react';
import { Inspector, Metric, CoverageBar, DetailHead, Section, EmptyAgent } from './Inspector.jsx';
import DiagramIcon from '../tabs/diagramIcons.jsx';

// The UI/UX agent's screens, shown as what they are: a set of flows. Each screen becomes
// a wireframe-ish card whose flow is broken into numbered steps, and the contract ids it
// serves are checked against the contract — so a screen that references an endpoint
// nobody declared shows up here rather than surfacing later as frontend drift.

/** The flow is prose; split it into steps when the model numbered them, which it usually
 * does, and fall back to sentences so a paragraph still reads as a sequence. */
function toSteps(flow = '') {
  const numbered = flow.split(/\s*(?:\d+[.)]\s+)/).map((s) => s.trim()).filter(Boolean);
  if (numbered.length > 1) return numbered;
  const lines = flow.split(/\n+/).map((s) => s.replace(/^[-•*]\s*/, '').trim()).filter(Boolean);
  if (lines.length > 1) return lines;
  return flow.split(/(?<=\.)\s+/).map((s) => s.trim()).filter(Boolean);
}

export default function UiuxViewer({ artifact, contract }) {
  const [sel, setSel] = useState(null);

  const model = useMemo(() => {
    if (!artifact) return null;
    const screens = artifact.screens ?? [];
    const validIds = new Set([
      ...(contract?.features ?? []).map((f) => f.id),
      ...(contract?.apis ?? []).map((a) => a.id),
    ]);
    const apiById = new Map((contract?.apis ?? []).map((a) => [a.id, a]));
    const featureById = new Map((contract?.features ?? []).map((f) => [f.id, f]));
    const cited = new Set(screens.flatMap((s) => s.implements ?? []));
    return {
      screens,
      apiById,
      featureById,
      unknown: contract ? screens.filter((s) => (s.implements ?? []).some((id) => !validIds.has(id))) : [],
      // A feature with no screen is a real hole: it was specified but nobody designed it.
      undesigned: (contract?.features ?? []).filter((f) => !cited.has(f.id)),
      featureTotal: (contract?.features ?? []).length,
    };
  }, [artifact, contract]);

  if (!artifact) return <EmptyAgent role="UI/UX" />;

  const screen = model.screens.find((s) => s.path === sel);

  const detail = screen ? (
    <>
      <DetailHead icon={<DiagramIcon name="browser" size={20} />} title={screen.name} sub={screen.path} />
      <Section title="Flow" count={toSteps(screen.flow).length}>
        <ol className="step-list">
          {toSteps(screen.flow).map((s, i) => <li key={i}>{s}</li>)}
        </ol>
      </Section>
      <Section title="Realises" count={(screen.implements ?? []).length}>
        {(screen.implements ?? []).map((id) => {
          const api = model.apiById.get(id);
          const feat = model.featureById.get(id);
          const known = api || feat;
          return (
            <div key={id} className="dd-edge" style={{ cursor: 'default' }}>
              <span className="dd-dir" style={{ color: known ? 'var(--green)' : 'var(--red)' }}>{known ? '•' : '!'}</span>
              <span className="dd-edge-main">
                <span className="dd-edge-name">{id}</span>
                <span className="dd-edge-meta">
                  {api ? `${api.method} ${api.path}` : feat ? feat.name : 'not found in the contract'}
                </span>
              </span>
            </div>
          );
        })}
      </Section>
    </>
  ) : null;

  return (
    <Inspector
      onCloseDetail={() => setSel(null)}
      detail={detail}
      toolbar={
        <>
          <Metric value={model.screens.length} label="screens" />
          {model.featureTotal > 0 && (
            <Metric
              value={`${model.featureTotal - model.undesigned.length}/${model.featureTotal}`}
              label="features designed"
              tone={model.undesigned.length ? 'warn' : 'ok'}
            />
          )}
          {model.unknown.length > 0 && <Metric value={model.unknown.length} label="screens citing unknown ids" tone="bad" />}
          <span style={{ flex: 1 }} />
          {sel && <button className="btn small ghost" onClick={() => setSel(null)}>Clear</button>}
        </>
      }
    >
      <div className="pad">
        {model.featureTotal > 0 && (
          <CoverageBar covered={model.featureTotal - model.undesigned.length} total={model.featureTotal} label="Features with a screen designed for them" />
        )}
        {model.undesigned.length > 0 && (
          <div className="notice" style={{ marginTop: 12 }}>
            No screen covers: {model.undesigned.map((f) => `${f.id} ${f.name}`).join(' · ')}
          </div>
        )}

        <div className="section-title" style={{ marginTop: 18 }}>Screens</div>
        <div className="screen-grid">
          {model.screens.map((s) => {
            const steps = toSteps(s.flow);
            return (
              <button
                key={s.path}
                className={`screen-card ${sel === s.path ? 'sel' : ''}`}
                onClick={() => setSel(sel === s.path ? null : s.path)}
              >
                {/* A little browser chrome so a screen reads as a screen, not a row. */}
                <div className="screen-chrome">
                  <i /><i /><i />
                  <span className="screen-path">{s.path}</span>
                </div>
                <div className="screen-body">
                  <div className="screen-name">{s.name}</div>
                  <ol className="screen-steps">
                    {steps.slice(0, 4).map((st, i) => <li key={i}>{st.slice(0, 74)}</li>)}
                  </ol>
                  {steps.length > 4 && <div className="hint" style={{ marginTop: 4 }}>+{steps.length - 4} more steps</div>}
                </div>
                <div className="screen-foot">
                  {(s.implements ?? []).map((id) => (
                    <span key={id} className={`chip ${model.apiById.has(id) || model.featureById.has(id) ? '' : 'orphan'}`}>{id}</span>
                  ))}
                </div>
              </button>
            );
          })}
        </div>

        {(artifact.gaps ?? []).length > 0 && (
          <>
            <div className="section-title" style={{ marginTop: 22 }}>Recorded gaps</div>
            {artifact.gaps.map((g, i) => <div key={i} className="notice">{g}</div>)}
          </>
        )}
      </div>
    </Inspector>
  );
}
