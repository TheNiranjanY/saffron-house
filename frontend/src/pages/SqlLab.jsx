import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  Check,
  Copy,
  Database,
  Play,
  Rows3,
  Search,
  ShieldCheck,
  Sparkles,
  Terminal,
  Timer,
  TriangleAlert,
} from "lucide-react";
import { api, useFetch } from "../lib/api";
import { num } from "../lib/format";
import { cx } from "../lib/utils";
import {
  Badge,
  Button,
  Card,
  CardHeader,
  EmptyState,
  ErrorState,
  LinkButton,
  Loading,
  PageHeader,
  SearchInput,
  Segmented,
} from "../components/UI";

const DB_META = {
  timescale: { label: "TimescaleDB", dialect: "PostgreSQL 17", tone: "teal" },
  mysql: { label: "MySQL", dialect: "MySQL 8.4", tone: "amber" },
};

const STARTER = `SELECT bucket, bills, revenue
  FROM sales_hourly
 WHERE bucket >= now() - INTERVAL '7 days'
 ORDER BY bucket DESC
 LIMIT 24`;

function formatElapsed(ms) {
  if (ms === null || ms === undefined) return "—";
  return ms >= 1000 ? `${(ms / 1000).toFixed(2)} s` : `${ms} ms`;
}

function Cell({ value }) {
  if (value === null || value === undefined) return <span className="sql-null">NULL</span>;
  if (typeof value === "boolean") return <span className="tabular">{String(value)}</span>;
  if (typeof value === "object") return <code className="sql-json">{JSON.stringify(value)}</code>;
  if (typeof value === "number") {
    return (
      <span className="tabular" title={String(value)}>
        {new Intl.NumberFormat("en-IN", { maximumFractionDigits: 4 }).format(value)}
      </span>
    );
  }
  const text = String(value);
  return <span title={text.length > 60 ? text : undefined}>{text}</span>;
}

export default function SqlLab() {
  const catalog = useFetch("/analytics/sql");
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState(null);
  const [db, setDb] = useState("timescale");
  const [sql, setSql] = useState("");
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [running, setRunning] = useState(false);
  const [copied, setCopied] = useState(false);
  const editorRef = useRef(null);
  const initialised = useRef(false);
  const copyTimer = useRef(null);

  const execute = useCallback(async ({ sqlText, dbValue, queryId = null }) => {
    setRunning(true);
    setError(null);
    setResult(null);
    try {
      const data = await api.post(
        "/analytics/sql",
        queryId ? { query_id: queryId } : { db: dbValue, sql: sqlText }
      );
      setResult(data);
    } catch (requestError) {
      setError(requestError);
    } finally {
      setRunning(false);
    }
  }, []);

  useEffect(() => {
    if (!catalog.data || initialised.current) return;
    initialised.current = true;
    const first = catalog.data.queries.find((entry) => entry.db === "timescale") || catalog.data.queries[0];
    if (!first) return;
    setSelectedId(first.id);
    setDb(first.db);
    setSql(first.sql);
    execute({ sqlText: first.sql, dbValue: first.db, queryId: first.id });
  }, [catalog.data, execute]);

  useEffect(() => () => clearTimeout(copyTimer.current), []);

  const queries = catalog.data?.queries || [];
  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) return queries;
    return queries.filter((entry) =>
      [entry.title, entry.concept, entry.description, ...entry.tags].join(" ").toLowerCase().includes(needle)
    );
  }, [queries, search]);

  const groups = [
    { id: "timescale", meta: DB_META.timescale, items: filtered.filter((entry) => entry.db === "timescale") },
    { id: "mysql", meta: DB_META.mysql, items: filtered.filter((entry) => entry.db === "mysql") },
  ].filter((group) => group.items.length > 0);

  const run = () => {
    if (!sql.trim()) {
      setError(new Error("Write a SELECT or WITH query before running."));
      return;
    }
    execute({ sqlText: sql, dbValue: db });
  };

  const handleKeyDown = (event) => {
    if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
      event.preventDefault();
      run();
    }
  };

  const pick = (entry) => {
    setSelectedId(entry.id);
    setDb(entry.db);
    setSql(entry.sql);
    setResult(null);
    setError(null);
    editorRef.current?.focus();
  };

  const copySql = async () => {
    try {
      await navigator.clipboard.writeText(sql);
      setCopied(true);
      clearTimeout(copyTimer.current);
      copyTimer.current = setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopied(false);
    }
  };

  const rows = result?.result.rows || [];
  const columns = result?.result.columns || [];
  const numeric = useMemo(
    () =>
      Object.fromEntries(
        columns.map((column) => {
          const sample = rows.find((row) => row[column] !== null && row[column] !== undefined)?.[column];
          return [column, typeof sample === "number"];
        })
      ),
    [columns, rows]
  );

  return (
    <>
      <PageHeader
        eyebrow="Read-only workspace"
        title="SQL, without the mystery."
        description="The same curated queries the analytics screens rely on, opened up for inspection. Presets load as editable drafts; only SELECT and WITH statements are accepted."
        actions={
          <>
            <LinkButton to="/analytics" variant="outline" icon={ArrowLeft}>
              Analytics
            </LinkButton>
            <Badge tone="neutral">{queries.length ? `${queries.length} curated queries` : "Curated queries"}</Badge>
          </>
        }
      />

      {catalog.error && !catalog.data ? (
        <ErrorState error={catalog.error} onRetry={catalog.refresh} title="The query catalog is unavailable" />
      ) : (
        <div className="sql-layout">
          <Card className="sql-catalog">
            <CardHeader
              title="Query catalog"
              subtitle="Both databases, one editor"
              icon={Database}
              actions={<Badge tone="neutral">{filtered.length}</Badge>}
            />
            <SearchInput
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Filter by concept or tag"
              className="sql-catalog__search"
            />
            <div className="sql-catalog__list">
              {catalog.loading && !catalog.data ? (
                <Loading label="Loading catalog" rows={6} />
              ) : groups.length === 0 ? (
                <div className="sql-catalog__empty">
                  <Search size={18} />
                  <p>No saved query matches “{search}”.</p>
                  <button type="button" className="link" onClick={() => setSearch("")}>
                    Clear filter
                  </button>
                </div>
              ) : (
                groups.map((group) => (
                  <div className="catalog-group" key={group.id}>
                    <div className="catalog-group__head">
                      <span>
                        <Database size={12} /> {group.meta.label}
                      </span>
                      <small>{group.items.length}</small>
                    </div>
                    {group.items.map((entry) => (
                      <button
                        type="button"
                        className={cx("catalog-item", selectedId === entry.id && "is-active")}
                        key={entry.id}
                        onClick={() => pick(entry)}
                        aria-pressed={selectedId === entry.id}
                      >
                        <span className="catalog-item__title">{entry.title}</span>
                        <span className="catalog-item__concept">{entry.concept}</span>
                      </button>
                    ))}
                  </div>
                ))
              )}
            </div>
            <div className="sql-catalog__foot">
              <ShieldCheck size={13} />
              <span>Writes are rejected server-side before execution.</span>
            </div>
          </Card>

          <div className="sql-main">
            <Card className="sql-editor-card">
              <div className="sql-editor__chrome">
                <span className="sql-editor__dots" aria-hidden="true">
                  <i />
                  <i />
                  <i />
                </span>
                <span className="sql-editor__file">query.sql</span>
                <Segmented
                  size="sm"
                  options={[
                    { value: "timescale", label: "TimescaleDB" },
                    { value: "mysql", label: "MySQL" },
                  ]}
                  value={db}
                  onChange={(value) => {
                    setDb(value);
                    setSelectedId(null);
                  }}
                />
              </div>
              <textarea
                ref={editorRef}
                className="sql-editor__input"
                value={sql}
                onChange={(event) => {
                  setSql(event.target.value);
                  setError(null);
                }}
                onKeyDown={handleKeyDown}
                placeholder={STARTER}
                spellCheck={false}
                autoCapitalize="off"
                autoCorrect="off"
                aria-label="SQL editor"
              />
              <div className="sql-editor__footer">
                <div className="sql-editor__hints">
                  <span className="sql-kbd">Ctrl / ⌘ + Enter</span>
                  <span className="sql-readonly">
                    <ShieldCheck size={13} /> Read-only · 8s timeout
                  </span>
                </div>
                <div className="sql-editor__actions">
                  <Button variant="ghost" size="sm" icon={copied ? Check : Copy} onClick={copySql}>
                    {copied ? "Copied" : "Copy"}
                  </Button>
                  <Button icon={Play} loading={running} onClick={run}>
                    Run query
                  </Button>
                </div>
              </div>
            </Card>

            <Card className="sql-result-card">
              <div className="sql-result__head">
                <div>
                  <span className="eyebrow">Result set</span>
                  <h2>{result?.query.title || (running ? "Running query…" : "Awaiting a query")}</h2>
                </div>
                <div className="sql-result__meta">
                  {result ? (
                    <>
                      <Badge tone={DB_META[result.query.db]?.tone || "neutral"}>
                        {DB_META[result.query.db]?.dialect || result.query.db}
                      </Badge>
                      <Badge tone="neutral">
                        <Rows3 size={12} /> {num(result.result.row_count)} rows
                      </Badge>
                      <Badge tone="green">
                        <Timer size={12} /> {formatElapsed(result.result.elapsed_ms)}
                      </Badge>
                      {result.result.truncated ? <Badge tone="amber">First 500 rows</Badge> : null}
                      <Badge tone="green">
                        <ShieldCheck size={12} /> Read-only
                      </Badge>
                    </>
                  ) : (
                    <span className="sql-result__status">{running ? "Executing" : "No result yet"}</span>
                  )}
                </div>
              </div>

              {error ? (
                <div className="sql-error">
                  <span className="sql-error__icon">
                    <TriangleAlert size={19} />
                  </span>
                  <div>
                    <strong>Query rejected</strong>
                    <p>{error.message}</p>
                    <span>
                      The SQL Lab accepts a single <code>SELECT</code> or <code>WITH</code> statement and blocks
                      write keywords, file access and long-running queries.
                    </span>
                  </div>
                </div>
              ) : running ? (
                <div className="sql-running">
                  <Loading label="Executing against the database" rows={5} />
                </div>
              ) : result ? (
                <div className="table-wrap sql-table-wrap">
                  <table className="data-table sql-table">
                    <thead>
                      <tr>
                        <th className="sql-table__index">#</th>
                        {columns.map((column) => (
                          <th key={column} className={numeric[column] ? "num" : undefined}>
                            {column}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((row, index) => (
                        <tr key={index}>
                          <td className="sql-table__index">{index + 1}</td>
                          {columns.map((column) => (
                            <td key={column} className={numeric[column] ? "num" : undefined}>
                              <Cell value={row[column]} />
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {rows.length === 0 ? (
                    <div className="table-empty">The query ran successfully and returned no rows.</div>
                  ) : null}
                </div>
              ) : (
                <EmptyState
                  icon={Sparkles}
                  title="The stage is set"
                  description="Choose a curated query on the left, edit it, then run it with the button or Ctrl/Cmd + Enter."
                  action={
                    <Button variant="outline" icon={Terminal} onClick={run}>
                      Run current draft
                    </Button>
                  }
                />
              )}

              <div className="sql-result__foot">
                <span>
                  <Terminal size={12} /> {db === "timescale" ? "PostgreSQL 17" : "MySQL 8.4"} · read-only session ·
                  500-row display cap
                </span>
                <span className="sql-result__foot-note">
                  Presets are versioned in <code>backend/restaurant/sql_catalog.py</code>
                </span>
              </div>
            </Card>
          </div>
        </div>
      )}
    </>
  );
}
