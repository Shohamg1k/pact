import React from 'react';

export default function QAViewer({ artifact }) {
  if (!artifact) return <div className="empty-state">qa hasn't run yet.</div>;
  return (
    <div>
      <div className="hash-row">
        <span className="badge mono">{artifact.test_cases.length} test cases generated</span>
        <span className="badge">not yet run — needs runner.js (feat/runner-connectors)</span>
      </div>
      <table className="trace-table" style={{ marginTop: 10 }}>
        <thead>
          <tr>
            <th>id</th>
            <th>implements</th>
            <th>description</th>
            <th>steps</th>
            <th>expected</th>
          </tr>
        </thead>
        <tbody>
          {artifact.test_cases.map((tc) => (
            <tr key={tc.id}>
              <td className="mono">{tc.id}</td>
              <td>
                {tc.implements.map((id) => (
                  <span key={id} className="chip">
                    {id}
                  </span>
                ))}
              </td>
              <td>{tc.description}</td>
              <td>
                <ul style={{ margin: 0, paddingLeft: 16 }}>
                  {tc.steps.map((s, i) => (
                    <li key={i}>{s}</li>
                  ))}
                </ul>
              </td>
              <td>{tc.expected}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {artifact.gaps?.length > 0 && <div className="gap-banner">{artifact.gaps.join(' · ')}</div>}
    </div>
  );
}
