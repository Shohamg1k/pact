import React, { useMemo, useState } from 'react';
import { Inspector, Metric, CoverageBar, DetailHead, Section, EmptyAgent } from './Inspector.jsx';
import DiagramIcon from '../tabs/diagramIcons.jsx';

// The Product Manager's output as a product brief: who the users are, what gets built,
// and — the part a raw list hides — whether every persona is actually served and whether
// the priorities are credible. Selecting a persona highlights the features that serve it
// and vice versa, so "who is this for" is answerable by clicking rather than reading.

const PRIORITY = {
  must: { label: 'Must have', tone: 'bad', order: 0 },
  should: { label: 'Should have', tone: 'warn', order: 1 },
  could: { label: 'Could have', tone: '', order: 2 },
};

export default function PMViewer({ artifact }) {
  const [sel, setSel] = useState(null); // {kind:'persona'|'feature', id}

  const model = useMemo(() => {
    if (!artifact) return null;
    const personas = artifact.personas ?? [];
    const features = artifact.features ?? [];
    const servedPersonas = new Set(features.flatMap((f) => f.persona_ids ?? []));
    const byPriority = {};
    for (const f of features) (byPriority[f.priority] ??= []).push(f);
    return {
      personas,
      features,
      // A persona nobody builds for is a real finding, not a cosmetic one.
      unserved: personas.filter((p) => !servedPersonas.has(p.id)),
      orphanFeatures: features.filter((f) => !(f.persona_ids ?? []).length),
      byPriority,
      servedCount: personas.length - personas.filter((p) => !servedPersonas.has(p.id)).length,
    };
  }, [artifact]);

  if (!artifact) return <EmptyAgent role="Product Manager" />;

  const featuresFor = (pid) => model.features.filter((f) => (f.persona_ids ?? []).includes(pid));
  const personasFor = (f) => model.personas.filter((p) => (f.persona_ids ?? []).includes(p.id));

  const lit = (kind, id) => {
    if (!sel) return true;
    if (sel.kind === kind && sel.id === id) return true;
    if (sel.kind === 'persona' && kind === 'feature') {
      return (model.features.find((f) => f.id === id)?.persona_ids ?? []).includes(sel.id);
    }
    if (sel.kind === 'feature' && kind === 'persona') {
      return (model.features.find((f) => f.id === sel.id)?.persona_ids ?? []).includes(id);
    }
    return false;
  };

  const selPersona = sel?.kind === 'persona' ? model.personas.find((p) => p.id === sel.id) : null;
  const selFeature = sel?.kind === 'feature' ? model.features.find((f) => f.id === sel.id) : null;

  const detail = selPersona ? (
    <>
      <DetailHead icon={<DiagramIcon name="user" size={20} />} title={selPersona.name} sub={selPersona.id} />
      <p className="dd-body">{selPersona.description}</p>
      <Section title="Features serving this persona" count={featuresFor(selPersona.id).length}>
        {featuresFor(selPersona.id).length === 0 && (
          <div className="notice bad" style={{ marginTop: 6 }}>
            Nothing in the feature list serves this persona. Either the persona is out of scope, or a feature is missing.
          </div>
        )}
        {featuresFor(selPersona.id).map((f) => (
          <button key={f.id} className="dd-edge" onClick={() => setSel({ kind: 'feature', id: f.id })}>
            <span className="dd-dir" style={{ color: 'var(--accent)' }}>→</span>
            <span className="dd-edge-main">
              <span className="dd-edge-name">{f.name}</span>
              <span className="dd-edge-meta">{f.id} · {PRIORITY[f.priority]?.label ?? f.priority}</span>
            </span>
          </button>
        ))}
      </Section>
    </>
  ) : selFeature ? (
    <>
      <DetailHead icon={<DiagramIcon name="service" size={20} />} title={selFeature.name} sub={`${selFeature.id} · ${PRIORITY[selFeature.priority]?.label ?? selFeature.priority}`} />
      <p className="dd-body">{selFeature.description}</p>
      <Section title="Serves" count={personasFor(selFeature).length}>
        {personasFor(selFeature).length === 0 && (
          <div className="notice bad" style={{ marginTop: 6 }}>
            This feature names no persona, so who it's for is unstated.
          </div>
        )}
        {personasFor(selFeature).map((p) => (
          <button key={p.id} className="dd-edge" onClick={() => setSel({ kind: 'persona', id: p.id })}>
            <span className="dd-dir" style={{ color: 'var(--accent)' }}>←</span>
            <span className="dd-edge-main">
              <span className="dd-edge-name">{p.name}</span>
              <span className="dd-edge-meta">{p.id}</span>
            </span>
          </button>
        ))}
      </Section>
    </>
  ) : null;

  return (
    <Inspector
      onCloseDetail={() => setSel(null)}
      detail={detail}
      toolbar={
        <>
          <Metric value={model.personas.length} label="personas" />
          <Metric value={model.features.length} label="features" />
          <Metric value={model.byPriority.must?.length ?? 0} label="must-have" tone="bad" />
          {model.unserved.length > 0 && <Metric value={model.unserved.length} label="unserved personas" tone="warn" />}
          {model.orphanFeatures.length > 0 && <Metric value={model.orphanFeatures.length} label="features with no persona" tone="warn" />}
          {model.unserved.length === 0 && model.orphanFeatures.length === 0 && <Metric value="✓" label="every persona served" tone="ok" />}
          <span style={{ flex: 1 }} />
          {sel && <button className="btn small ghost" onClick={() => setSel(null)}>Clear</button>}
        </>
      }
    >
      <div className="pad">
        <CoverageBar covered={model.servedCount} total={model.personas.length} label="Personas with at least one feature" />

        <div className="section-title" style={{ marginTop: 20 }}>Personas</div>
        <div className="card-grid">
          {model.personas.map((p) => {
            const n = featuresFor(p.id).length;
            return (
              <button
                key={p.id}
                className={`pick-card ${sel?.kind === 'persona' && sel.id === p.id ? 'sel' : ''} ${lit('persona', p.id) ? '' : 'dim'}`}
                onClick={() => setSel(sel?.kind === 'persona' && sel.id === p.id ? null : { kind: 'persona', id: p.id })}
              >
                <div className="pick-head">
                  <DiagramIcon name="user" size={16} />
                  <span className="pick-title">{p.name}</span>
                  <span className={`badge ${n ? '' : 'warn'}`}>{n}</span>
                </div>
                <div className="pick-body">{p.description}</div>
              </button>
            );
          })}
        </div>

        <div className="section-title" style={{ marginTop: 22 }}>Features by priority</div>
        {['must', 'should', 'could'].map((pri) => {
          const list = model.byPriority[pri] ?? [];
          if (!list.length) return null;
          return (
            <div key={pri} style={{ marginBottom: 16 }}>
              <div className="pri-head">
                <span className={`badge ${PRIORITY[pri].tone}`}>{PRIORITY[pri].label}</span>
                <span className="hint">{list.length}</span>
              </div>
              <div className="card-grid">
                {list.map((f) => (
                  <button
                    key={f.id}
                    className={`pick-card ${sel?.kind === 'feature' && sel.id === f.id ? 'sel' : ''} ${lit('feature', f.id) ? '' : 'dim'}`}
                    onClick={() => setSel(sel?.kind === 'feature' && sel.id === f.id ? null : { kind: 'feature', id: f.id })}
                  >
                    <div className="pick-head">
                      <span className="pick-title">{f.name}</span>
                      <span className="chip">{f.id}</span>
                    </div>
                    <div className="pick-body">{f.description}</div>
                    <div className="implements">
                      {(f.persona_ids ?? []).map((pid) => (
                        <span key={pid} className="chip other">{model.personas.find((p) => p.id === pid)?.name ?? pid}</span>
                      ))}
                    </div>
                  </button>
                ))}
              </div>
            </div>
          );
        })}

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
