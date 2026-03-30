import { useEffect, useMemo, useState } from "react";
import {
  fetchHealth,
  fetchSources,
  importCSV,
  registerPostgres,
  runQuery,
} from "./api";
import type { QueryMode, RunQueryResponse, SourceConfig } from "./types";

const defaultSQL = "SELECT COUNT(*) AS total_rows FROM sales";

type ConnectionMode = "csv" | "postgres";

export default function App() {
  const [health, setHealth] = useState("Checking backend...");
  const [error, setError] = useState("");
  const [sources, setSources] = useState<SourceConfig[]>([]);
  const [selectedGroupId, setSelectedGroupId] = useState<string>("");
  const [selectedTableId, setSelectedTableId] = useState<string>("");
  const [sourceMenuOpen, setSourceMenuOpen] = useState(false);
  const [connectionOpen, setConnectionOpen] = useState(false);
  const [connectionMode, setConnectionMode] = useState<ConnectionMode>("csv");
  const [queryMode, setQueryMode] = useState<QueryMode>("compare");
  const [accuracyTarget, setAccuracyTarget] = useState(0.9);
  const [sql, setSQL] = useState(defaultSQL);
  const [queryResult, setQueryResult] = useState<RunQueryResponse | null>(null);
  const [csvForm, setCSVForm] = useState({
    name: "CSV Dataset",
    file_path: "",
    stratify_columns: "region",
    sample_rate: 0.1,
  });
  const [pgForm, setPGForm] = useState({
    name: "Postgres Database",
    postgres_dsn: "",
    primary_key: "id",
    watermark_column: "updated_at",
    poll_interval_seconds: 15,
    stratify_columns: "region",
    sample_rate: 0.1,
  });

  async function loadData() {
    try {
      setError("");
      const [healthPayload, sourcePayload] = await Promise.all([fetchHealth(), fetchSources()]);
      setHealth(
        healthPayload.ok
          ? `Backend ready - ${healthPayload.source_count} tables`
          : "Backend unavailable"
      );
      setSources(sourcePayload);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      setHealth("Backend unavailable");
      setError(message);
    }
  }

  useEffect(() => {
    loadData();
  }, []);

  const sourceGroups = useMemo(() => {
    const grouped = new Map<
      string,
      {
        id: string;
        name: string;
        kind: SourceConfig["kind"];
        tables: SourceConfig[];
      }
    >();

    for (const source of sources) {
      const groupId = source.source_group || source.id;
      const existing = grouped.get(groupId);
      if (existing) {
        existing.tables.push(source);
        continue;
      }
      grouped.set(groupId, {
        id: groupId,
        name: source.name,
        kind: source.kind,
        tables: [source],
      });
    }

    return Array.from(grouped.values()).map((group) => ({
      ...group,
      tables: group.tables.sort((a, b) =>
        displayTableName(a).localeCompare(displayTableName(b))
      ),
    }));
  }, [sources]);

  useEffect(() => {
    if (sourceGroups.length === 0) {
      setSelectedGroupId("");
      setSelectedTableId("");
      return;
    }

    if (!selectedGroupId || !sourceGroups.some((group) => group.id === selectedGroupId)) {
      const firstGroup = sourceGroups[0];
      setSelectedGroupId(firstGroup.id);
      setSelectedTableId(firstGroup.tables[0]?.id ?? "");
      return;
    }

    const currentGroup = sourceGroups.find((group) => group.id === selectedGroupId);
    if (!currentGroup) {
      return;
    }
    if (!selectedTableId || !currentGroup.tables.some((table) => table.id === selectedTableId)) {
      setSelectedTableId(currentGroup.tables[0]?.id ?? "");
    }
  }, [selectedGroupId, selectedTableId, sourceGroups]);

  const selectedGroup =
    sourceGroups.find((group) => group.id === selectedGroupId) ?? sourceGroups[0] ?? null;
  const visibleTables = selectedGroup?.tables ?? [];
  const selectedTable =
    visibleTables.find((table) => table.id === selectedTableId) ?? visibleTables[0] ?? null;

  useEffect(() => {
    if (selectedTable) {
      setSQL(`SELECT COUNT(*) AS total_rows FROM ${selectedTable.table_name}`);
    }
  }, [selectedTable?.id]);

  async function submitCSV() {
    try {
      setError("");
      const created = await importCSV({
        ...csvForm,
        stratify_columns: splitColumns(csvForm.stratify_columns),
      });
      setConnectionOpen(false);
      await loadData();
      const groupId = created.source_group || created.id;
      setSelectedGroupId(groupId);
      setSelectedTableId(created.id);
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
      if (created.length > 0) {
        const groupId = created[0].source_group || created[0].id;
        setSelectedGroupId(groupId);
        setSelectedTableId(created[0].id);
        setSQL(`SELECT COUNT(*) AS total_rows FROM ${created[0].table_name}`);
      }
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

  function focusTable(source: SourceConfig) {
    setSelectedTableId(source.id);
    setSQL(`SELECT COUNT(*) AS total_rows FROM ${source.table_name}`);
  }

  return (
    <div className="console-app">
      <header className="topbar">
        <h1>Approximate Query Engine</h1>
        <div className="topbar-actions">
          <span className="health-chip">{health}</span>
          <div className="source-menu-wrap">
            <button onClick={() => setSourceMenuOpen((open) => !open)}>Sources</button>
            {sourceMenuOpen ? (
              <div className="source-menu">
                {sourceGroups.length === 0 ? (
                  <div className="source-menu-empty">No sources yet</div>
                ) : (
                  sourceGroups.map((group) => (
                    <button
                      key={group.id}
                      className={`source-menu-item ${
                        selectedGroup?.id === group.id ? "active" : ""
                      }`}
                      onClick={() => {
                        setSelectedGroupId(group.id);
                        setSelectedTableId(group.tables[0]?.id ?? "");
                        setSourceMenuOpen(false);
                      }}
                    >
                      {group.name}
                    </button>
                  ))
                )}
                <button
                  className="source-menu-add"
                  onClick={() => {
                    setSourceMenuOpen(false);
                    setConnectionOpen(true);
                  }}
                >
                  Add source
                </button>
              </div>
            ) : null}
          </div>
        </div>
      </header>

      <div className="workspace">
        <aside className="table-sidebar">
          <div className="sidebar-header">
            <h2>Tables</h2>
          </div>
          <div className="table-list">
            {visibleTables.length === 0 ? (
              <div className="empty-note">No tables loaded yet.</div>
            ) : null}
            {visibleTables.map((table) => (
              <button
                key={table.id}
                className={`table-item ${selectedTable?.id === table.id ? "active" : ""}`}
                onClick={() => focusTable(table)}
              >
                <strong>{displayTableName(table)}</strong>
              </button>
            ))}
          </div>
        </aside>

        <main className="query-stage">
          <section className="editor-panel">
            <div className="editor-toolbar">
              <h2>{selectedTable ? displayTableName(selectedTable) : "Query"}</h2>
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
                  <span>{Math.round(accuracyTarget * 100)}%</span>
                  <input
                    type="range"
                    min="0.5"
                    max="0.99"
                    step="0.01"
                    value={accuracyTarget}
                    onChange={(event) => setAccuracyTarget(Number(event.target.value))}
                  />
                </label>
                <button onClick={submitQuery}>Run</button>
              </div>
            </div>

            <textarea
              className="query-editor"
              value={sql}
              onChange={(event) => setSQL(event.target.value)}
              rows={10}
              spellCheck={false}
            />
          </section>

          <section className="results-panel">
            <div className="results-header">
              <h2>Data</h2>
              {error ? <div className="error-chip">{error}</div> : null}
            </div>

            {!queryResult ? (
              <div className="empty-note">
                <code>SELECT COUNT(*) AS total_rows FROM {selectedTable?.table_name ?? "sales"}</code>
              </div>
            ) : null}

            {queryResult?.exact ? <ResultCard title="Exact" result={queryResult.exact} /> : null}
            {queryResult?.approx ? (
              <ResultCard title="Approximate" result={queryResult.approx} />
            ) : null}
          </section>
        </main>
      </div>

      {connectionOpen ? (
        <div className="connection-overlay" onClick={() => setConnectionOpen(false)}>
          <aside className="connection-drawer" onClick={(event) => event.stopPropagation()}>
            <div className="drawer-header">
              <h2>Sources</h2>
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
                  label="Postgres DSN"
                  value={pgForm.postgres_dsn}
                  onChange={(value) => setPGForm({ ...pgForm, postgres_dsn: value })}
                  placeholder="postgres://user:pass@localhost:5432/dbname"
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
                <Field
                  label="Sample rate"
                  type="number"
                  value={String(pgForm.sample_rate)}
                  onChange={(value) => setPGForm({ ...pgForm, sample_rate: Number(value) })}
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

function displayTableName(source: SourceConfig): string {
  if (source.kind === "postgres") {
    if (source.postgres_schema && source.postgres_schema !== "public") {
      return `${source.postgres_schema}.${source.postgres_table || source.table_name}`;
    }
    return source.postgres_table || source.table_name;
  }
  return source.table_name;
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
