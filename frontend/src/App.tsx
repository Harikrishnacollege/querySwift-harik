import { useEffect, useMemo, useState } from "react";
import {
  fetchBenchmarks,
  fetchHealth,
  fetchSources,
  importCSV,
  registerPostgres,
  runBenchmark,
  runQuery,
  startStream,
  stopStream,
  syncSource,
} from "./api";
import type { BenchmarkReport, QueryMode, RunQueryResponse, SourceConfig } from "./types";

const defaultSQL = "SELECT COUNT(*) AS total_rows FROM sales";

type ConnectionMode = "csv" | "postgres";

export default function App() {
  const [health, setHealth] = useState("Checking backend...");
  const [error, setError] = useState("");
  const [sources, setSources] = useState<SourceConfig[]>([]);
  const [benchmarks, setBenchmarks] = useState<BenchmarkReport[]>([]);
  const [selectedSourceId, setSelectedSourceId] = useState<string>("");
  const [connectionOpen, setConnectionOpen] = useState(false);
  const [connectionMode, setConnectionMode] = useState<ConnectionMode>("csv");
  const [queryMode, setQueryMode] = useState<QueryMode>("compare");
  const [accuracyTarget, setAccuracyTarget] = useState(0.9);
  const [sql, setSQL] = useState(defaultSQL);
  const [queryResult, setQueryResult] = useState<RunQueryResponse | null>(null);
  const [csvForm, setCSVForm] = useState({
    name: "CSV Dataset",
    table_name: "sales",
    file_path: "",
    stratify_columns: "region",
    sample_rate: 0.1,
  });
  const [pgForm, setPGForm] = useState({
    name: "Postgres Dataset",
    table_name: "sales",
    postgres_dsn: "",
    postgres_schema: "public",
    postgres_table: "sales",
    primary_key: "id",
    watermark_column: "updated_at",
    poll_interval_seconds: 15,
    stratify_columns: "region",
    sample_rate: 0.1,
  });
  const [benchmarkForm, setBenchmarkForm] = useState({
    name: "Console benchmark",
    queries: defaultSQL,
    iterations: 3,
  });

  async function loadData() {
    try {
      setError("");
      const [healthPayload, sourcePayload, benchmarkPayload] = await Promise.all([
        fetchHealth(),
        fetchSources(),
        fetchBenchmarks(),
      ]);
      const healthLabel = healthPayload.ok
        ? `Backend ready - ${healthPayload.source_count} sources loaded`
        : "Backend unavailable";
      setHealth(healthLabel);
      setSources(sourcePayload);
      setBenchmarks(benchmarkPayload);
      if (!selectedSourceId && sourcePayload.length > 0) {
        const firstSource = sourcePayload[0];
        setSelectedSourceId(firstSource.id);
        setSQL(`SELECT COUNT(*) AS total_rows FROM ${firstSource.table_name}`);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      setHealth("Backend unavailable");
      setError(message);
    }
  }

  useEffect(() => {
    loadData();
    const timer = window.setInterval(loadData, 10000);
    return () => window.clearInterval(timer);
  }, []);

  const selectedSource = useMemo(
    () => sources.find((source) => source.id === selectedSourceId) ?? sources[0] ?? null,
    [selectedSourceId, sources]
  );

  const postgresSources = useMemo(
    () => sources.filter((source) => source.kind === "postgres"),
    [sources]
  );

  async function submitCSV() {
    try {
      setError("");
      const created = await importCSV({
        ...csvForm,
        stratify_columns: splitColumns(csvForm.stratify_columns),
      });
      setConnectionOpen(false);
      await loadData();
      setSelectedSourceId(created.id);
      setSQL(`SELECT COUNT(*) AS total_rows FROM ${created.table_name}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to import CSV");
    }
  }

  async function submitPostgres() {
    try {
      setError("");
      const created = await registerPostgres({
        ...pgForm,
        stratify_columns: splitColumns(pgForm.stratify_columns),
      });
      setConnectionOpen(false);
      await loadData();
      setSelectedSourceId(created.id);
      setSQL(`SELECT COUNT(*) AS total_rows FROM ${created.table_name}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to register Postgres source");
    }
  }

  async function submitQuery() {
    try {
      setError("");
      setQueryResult(await runQuery(sql, queryMode, accuracyTarget));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Query failed");
    }
  }

  async function submitBenchmark() {
    try {
      setError("");
      await runBenchmark({
        name: benchmarkForm.name,
        iterations: benchmarkForm.iterations,
        accuracy_target: accuracyTarget,
        queries: benchmarkForm.queries
          .split("\n")
          .map((query) => query.trim())
          .filter(Boolean),
      });
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Benchmark failed");
    }
  }

  function focusSource(source: SourceConfig) {
    setSelectedSourceId(source.id);
    setSQL(`SELECT COUNT(*) AS total_rows FROM ${source.table_name}`);
  }

  return (
    <div className="console-app">
      <header className="topbar">
        <div>
          <p className="topbar-kicker">Approximate Query Engine</p>
          <h1>Black-box speed, yellow-line clarity</h1>
        </div>
        <div className="topbar-actions">
          <span className="health-chip">{health}</span>
          <button
            className="icon-button"
            aria-label="Load new connection"
            onClick={() => setConnectionOpen(true)}
          >
            +
          </button>
        </div>
      </header>

      <div className="workspace">
        <aside className="table-sidebar">
          <div className="sidebar-header">
            <h2>Tables</h2>
            <span>{sources.length}</span>
          </div>
          <div className="table-list">
            {sources.length === 0 ? (
              <div className="empty-note">No tables yet. Use the + button to add a connection.</div>
            ) : null}
            {sources.map((source) => (
              <button
                key={source.id}
                className={`table-item ${selectedSource?.id === source.id ? "active" : ""}`}
                onClick={() => focusSource(source)}
              >
                <strong>{source.table_name}</strong>
                <span>{source.kind}</span>
                <small>
                  {source.raw_row_count} rows - {source.sampling_method ?? "uniform"}
                </small>
              </button>
            ))}
          </div>
        </aside>

        <main className="query-stage">
          <section className="editor-panel">
            <div className="editor-toolbar">
              <div>
                <p className="panel-kicker">Query Editor</p>
                <h2>{selectedSource ? selectedSource.table_name : "No table selected"}</h2>
              </div>
              <div className="toolbar-controls">
                <label className="compact-field">
                  <span>Mode</span>
                  <select
                    value={queryMode}
                    onChange={(event) => setQueryMode(event.target.value as QueryMode)}
                  >
                    <option value="compare">Compare</option>
                    <option value="exact">Exact</option>
                    <option value="approx">Approx</option>
                  </select>
                </label>
                <label className="compact-field slider-field">
                  <span>Accuracy {Math.round(accuracyTarget * 100)}%</span>
                  <input
                    type="range"
                    min="0.5"
                    max="0.99"
                    step="0.01"
                    value={accuracyTarget}
                    onChange={(event) => setAccuracyTarget(Number(event.target.value))}
                  />
                </label>
                <button onClick={submitQuery}>Run Query</button>
              </div>
            </div>

            <textarea
              className="query-editor"
              value={sql}
              onChange={(event) => setSQL(event.target.value)}
              rows={9}
              spellCheck={false}
            />

            {selectedSource ? (
              <div className="table-meta-row">
                <div className="meta-pill">{selectedSource.kind}</div>
                <div className="meta-pill">
                  sampling: {selectedSource.sampling_method ?? "uniform"}
                </div>
                <div className="meta-pill">
                  sample rate: {Math.round((selectedSource.sample_rate ?? 0) * 100)}%
                </div>
                <div className="meta-pill">{selectedSource.raw_row_count} raw rows</div>
              </div>
            ) : null}
          </section>

          <section className="results-panel">
            <div className="results-header">
              <div>
                <p className="panel-kicker">Data</p>
                <h2>Results</h2>
              </div>
              {error ? <div className="error-chip">{error}</div> : null}
            </div>

            {!queryResult ? (
              <div className="empty-note">
                Results will appear here. Try a query like:
                <code>SELECT COUNT(*) AS total_rows FROM {selectedSource?.table_name ?? "sales"}</code>
              </div>
            ) : null}

            {queryResult?.exact ? <ResultCard title="Exact Result" result={queryResult.exact} /> : null}
            {queryResult?.approx ? (
              <ResultCard title="Approximate Result" result={queryResult.approx} />
            ) : null}
          </section>

          <section className="bottom-panels">
            <section className="mini-panel">
              <div className="mini-header">
                <div>
                  <p className="panel-kicker">Connections</p>
                  <h3>Live Sources</h3>
                </div>
              </div>
              {postgresSources.length === 0 ? (
                <div className="empty-note">No Postgres sources are streaming yet.</div>
              ) : (
                <div className="stream-stack">
                  {postgresSources.map((source) => (
                    <article key={source.id} className="stream-tile">
                      <div>
                        <strong>{source.name}</strong>
                        <p>
                          {source.postgres_schema}.{source.postgres_table} to {source.table_name}
                        </p>
                        <small>
                          last sync:{" "}
                          {source.last_sync_at
                            ? new Date(source.last_sync_at).toLocaleString()
                            : "never"}
                        </small>
                      </div>
                      <div className="stream-tile-actions">
                        <button
                          className="ghost-button"
                          onClick={() => syncSource(source.id).then(loadData).catch(console.error)}
                        >
                          Sync
                        </button>
                        {source.streaming ? (
                          <button
                            className="ghost-button"
                            onClick={() => stopStream(source.id).then(loadData).catch(console.error)}
                          >
                            Stop
                          </button>
                        ) : (
                          <button
                            className="ghost-button"
                            onClick={() => startStream(source.id).then(loadData).catch(console.error)}
                          >
                            Start
                          </button>
                        )}
                      </div>
                    </article>
                  ))}
                </div>
              )}
            </section>

            <section className="mini-panel">
              <div className="mini-header">
                <div>
                  <p className="panel-kicker">Benchmarks</p>
                  <h3>Quick Run</h3>
                </div>
              </div>
              <Field
                label="Report name"
                value={benchmarkForm.name}
                onChange={(value) => setBenchmarkForm({ ...benchmarkForm, name: value })}
              />
              <Field
                label="Iterations"
                type="number"
                value={String(benchmarkForm.iterations)}
                onChange={(value) =>
                  setBenchmarkForm({ ...benchmarkForm, iterations: Number(value) })
                }
              />
              <label>
                Queries
                <textarea
                  rows={4}
                  value={benchmarkForm.queries}
                  onChange={(event) =>
                    setBenchmarkForm({ ...benchmarkForm, queries: event.target.value })
                  }
                />
              </label>
              <button onClick={submitBenchmark}>Run Benchmark</button>
              {benchmarks[0] ? (
                <div className="benchmark-highlight">
                  <strong>{benchmarks[0].name}</strong>
                  <small>
                    latest run - {new Date(benchmarks[0].created_at).toLocaleString()}
                  </small>
                </div>
              ) : null}
            </section>
          </section>
        </main>
      </div>

      {connectionOpen ? (
        <div className="connection-overlay" onClick={() => setConnectionOpen(false)}>
          <aside className="connection-drawer" onClick={(event) => event.stopPropagation()}>
            <div className="drawer-header">
              <div>
                <p className="panel-kicker">New Connection</p>
                <h2>Load a source</h2>
              </div>
              <button className="drawer-close" onClick={() => setConnectionOpen(false)}>
                x
              </button>
            </div>

            <div className="drawer-tabs">
              <button
                className={connectionMode === "csv" ? "active" : ""}
                onClick={() => setConnectionMode("csv")}
              >
                CSV
              </button>
              <button
                className={connectionMode === "postgres" ? "active" : ""}
                onClick={() => setConnectionMode("postgres")}
              >
                Postgres
              </button>
            </div>

            {connectionMode === "csv" ? (
              <div className="drawer-body">
                <Field
                  label="Display name"
                  value={csvForm.name}
                  onChange={(value) => setCSVForm({ ...csvForm, name: value })}
                />
                <Field
                  label="Query table name"
                  value={csvForm.table_name}
                  onChange={(value) => setCSVForm({ ...csvForm, table_name: value })}
                />
                <Field
                  label="CSV file path"
                  value={csvForm.file_path}
                  onChange={(value) => setCSVForm({ ...csvForm, file_path: value })}
                  placeholder="C:\\data\\sales.csv"
                />
                <Field
                  label="Stratify columns"
                  value={csvForm.stratify_columns}
                  onChange={(value) => setCSVForm({ ...csvForm, stratify_columns: value })}
                />
                <Field
                  label="Sample rate"
                  type="number"
                  value={String(csvForm.sample_rate)}
                  onChange={(value) => setCSVForm({ ...csvForm, sample_rate: Number(value) })}
                />
                <button onClick={submitCSV}>Import CSV</button>
              </div>
            ) : (
              <div className="drawer-body">
                <Field
                  label="Display name"
                  value={pgForm.name}
                  onChange={(value) => setPGForm({ ...pgForm, name: value })}
                />
                <Field
                  label="Query table name"
                  value={pgForm.table_name}
                  onChange={(value) => setPGForm({ ...pgForm, table_name: value })}
                />
                <Field
                  label="Postgres DSN"
                  value={pgForm.postgres_dsn}
                  onChange={(value) => setPGForm({ ...pgForm, postgres_dsn: value })}
                  placeholder="postgres://user:pass@localhost:5432/dbname"
                />
                <Field
                  label="Source schema"
                  value={pgForm.postgres_schema}
                  onChange={(value) => setPGForm({ ...pgForm, postgres_schema: value })}
                />
                <Field
                  label="Source table"
                  value={pgForm.postgres_table}
                  onChange={(value) => setPGForm({ ...pgForm, postgres_table: value })}
                />
                <Field
                  label="Primary key"
                  value={pgForm.primary_key}
                  onChange={(value) => setPGForm({ ...pgForm, primary_key: value })}
                />
                <Field
                  label="Watermark column"
                  value={pgForm.watermark_column}
                  onChange={(value) => setPGForm({ ...pgForm, watermark_column: value })}
                />
                <Field
                  label="Poll interval (seconds)"
                  type="number"
                  value={String(pgForm.poll_interval_seconds)}
                  onChange={(value) =>
                    setPGForm({ ...pgForm, poll_interval_seconds: Number(value) })
                  }
                />
                <Field
                  label="Stratify columns"
                  value={pgForm.stratify_columns}
                  onChange={(value) => setPGForm({ ...pgForm, stratify_columns: value })}
                />
                <button onClick={submitPostgres}>Register Postgres</button>
              </div>
            )}
          </aside>
        </div>
      ) : null}
    </div>
  );
}

function splitColumns(value: string): string[] {
  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function Field({
  label,
  value,
  onChange,
  type = "text",
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
  placeholder?: string;
}) {
  return (
    <label>
      {label}
      <input
        type={type}
        value={value}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  );
}

function ResultCard({
  title,
  result,
}: {
  title: string;
  result: NonNullable<RunQueryResponse["exact"]>;
}) {
  return (
    <article className="result-card">
      <div className="result-headline">
        <h3>{title}</h3>
        <div className="result-metrics">
          <span>{result.metric.execution_millis.toFixed(2)} ms</span>
          <span>{result.metric.row_count} rows</span>
          {typeof result.metric.speedup === "number" ? (
            <span>{result.metric.speedup.toFixed(2)}x faster</span>
          ) : null}
          {typeof result.metric.confidence === "number" ? (
            <span>{Math.round(result.metric.confidence * 100)}% confidence</span>
          ) : null}
          {typeof result.metric.estimated_error === "number" ? (
            <span>{result.metric.estimated_error.toFixed(2)}% est. error</span>
          ) : null}
          {typeof result.metric.actual_error === "number" ? (
            <span>{result.metric.actual_error.toFixed(2)}% actual error</span>
          ) : null}
        </div>
      </div>

      <div className="data-grid">
        <table>
          <thead>
            <tr>
              {result.schema.map((column) => (
                <th key={column}>{column}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {result.rows.map((row, index) => (
              <tr key={index}>
                {result.schema.map((column) => (
                  <td key={column}>{String(row[column] ?? "")}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </article>
  );
}
