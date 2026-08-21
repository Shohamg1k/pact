import React, { useEffect, useState } from 'react';
import { getContractTests } from '../api.js';

// One row per API/business-rule, run live against the booted preview — the answer to
// "does it actually work, feature by feature" rather than a single aggregate "N/M
// passing" number. Built against gates/contracttests.js's real output shape:
// {total, passed, failed, results:[{apiId, method, path, kind, description,
// expectedStatus|declaredErrors, actualStatus, pass, error?}]}.
export default function ContractTestsViewer({ chatId, refreshKey }) {
  const [report, setReport] = useState(undefined); // undefined = loading, null = 404 (no report yet)

  useEffect(() => {
    let cancelled = false;
    setReport(undefined);
    getContractTests(chatId).then((r) => {
      if (cancelled) return;
      setReport(r.ok === false ? null : r);
    });
    return () => {
      cancelled = true;
    };
  }, [chatId, refreshKey]);

  if (report === undefined) return <div className="empty-state">loading…</div>;
  if (report === null) {
    return (
      <div className="gap-notice">
        No contract-test report yet — this fills in the moment the Backend agent's
        generated server boots and each API/business-rule is exercised live.
      </div>
    );
  }

  const byFeatureGroup = groupByApi(report.results ?? []);

  return (
    <div>
      <div className="cov-summary" style={{ marginBottom: 12 }}>
        <span className={`badge ${report.failed === 0 ? 'ok' : 'bad'}`} style={{ fontSize: 13 }}>
          {report.passed}/{report.total} passing
        </span>
        <span className="hint" style={{ marginLeft: 8 }}>
          run live against the booted server — not a static check
        </span>
      </div>

      {byFeatureGroup.map(([apiId, tests]) => {
        const allPass = tests.every((t) => t.pass);
        return (
          <div key={apiId} className="ct-group" style={{ marginBottom: 10 }}>
            <div className="ct-group-head">
              <span className={`badge ${allPass ? 'ok' : 'bad'}`}>{allPass ? '✓' : '✗'}</span>
              <span className="mono" style={{ fontWeight: 600 }}>
                {tests[0]?.method} {tests[0]?.path}
              </span>
              <span className="hint" style={{ marginLeft: 6 }}>{apiId}</span>
            </div>
            {tests.map((t) => (
              <div key={t.id} className={`ct-row ${t.pass ? '' : 'ct-row-fail'}`}>
                <span className={`badge small ${t.pass ? 'ok' : 'bad'}`}>{t.pass ? 'pass' : 'fail'}</span>
                <span style={{ flex: 1 }}>{t.description}</span>
                <span className="mono hint">
                  {t.error ? t.error : `→ ${t.actualStatus ?? 'no response'}`}
                </span>
              </div>
            ))}
          </div>
        );
      })}

      {byFeatureGroup.length === 0 && (
        <div className="hint">No testable rules were derivable from this contract.</div>
      )}
    </div>
  );
}

function groupByApi(results) {
  const map = new Map();
  for (const r of results) {
    if (!map.has(r.apiId)) map.set(r.apiId, []);
    map.get(r.apiId).push(r);
  }
  return [...map.entries()];
}
