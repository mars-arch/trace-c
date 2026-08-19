import { readFileSync } from "fs";
import { join } from "path";

type CalibrationRow = {
  level: number;
  observed: number;
  expected_null: number;
};

type RawKnownEvent = {
  id: string;
  best_p: number;
  alerted: boolean;
  best_rank?: number;
  best_rank_of_scored_test_windows?: number;
  total_2020_windows?: number;
  total_test_windows?: number;
  best_window?: { date: string; time_from?: string };
};

type RawTopWindow = {
  date: string;
  time_from: string;
  p: number;
  is_alert: boolean;
};

type RawRealReport = {
  calibration_check: CalibrationRow[];
  known_events: RawKnownEvent[];
  alerts_total: number;
  expected_null_alerts: number;
  timeline: { known?: string | null }[];
};

type RawHoldoutReport = {
  calibration_check_precovid: CalibrationRow[];
  calibration_check_full_2020: CalibrationRow[];
  known_events: RawKnownEvent[];
  alerts_total_2020: number;
  expected_null_alerts_2020: number;
  top_ranked: RawTopWindow[];
  timeline: { known?: string | null }[];
};

type RawBaselineEvent = {
  id: string;
  rank: number;
  best_p: number;
  best_window: { date: string; period_from: number };
};

type RawBaselineSegment = {
  calibration: CalibrationRow[];
  calibration_precovid?: CalibrationRow[];
  known_events: RawBaselineEvent[];
};

type RawBaseline = {
  detector: string;
  y2019: RawBaselineSegment;
  y2020: RawBaselineSegment;
};

type RawTraceComparison = {
  detector: string;
  y2019: {
    calibration: CalibrationRow[];
    known_events: { id: string; rank: number; best_p: number }[];
  };
  y2020: {
    calibration_precovid: CalibrationRow[];
    known_events: { id: string; rank: number; best_p: number }[];
  };
};

type RawBaselinesReport = {
  baselines: RawBaseline[];
  trace_c: RawTraceComparison;
};

export type PaperEvent = {
  id: string;
  rank: number;
  p: number;
  alerted: boolean;
  opportunityWindows: number;
  bestDateTime: string | null;
};

export type PaperTopWindow = {
  rank: number;
  date: string;
  time: string;
  p: number;
  alerted: boolean;
  externalInterpretation: "Storm Ellen" | "Storm Alex" | null;
};

export type PaperBaseline = {
  detector: string;
  y2019: RawBaselineSegment;
  y2020: RawBaselineSegment;
};

export type PaperEvidence = {
  trace2019: {
    calibration: CalibrationRow[];
    events: PaperEvent[];
    alerts: number;
    expectedNullAlerts: number;
  };
  trace2020: {
    calibrationPreCovid: CalibrationRow[];
    calibrationFull: CalibrationRow[];
    events: PaperEvent[];
    alerts: number;
    expectedNullAlerts: number;
    topWindows: PaperTopWindow[];
  };
  baselines: PaperBaseline[];
  traceComparison: RawTraceComparison;
};

const EVENT_NAMES: Record<string, string> = {
  "GB-BLACKOUT-2019-08-09": "GB frequency event",
  "STORM-ATIYAH-2019-12-08": "Storm Atiyah",
  "STORM-CIARA-2020-02-09": "Storm Ciara",
  "STORM-DENNIS-2020-02-15": "Storm Dennis",
  "COVID-LOCKDOWN-2020-03-23": "Lockdown transition",
};

const DETECTOR_NAMES: Record<string, string> = {
  conv_ae: "Convolutional autoencoder",
  pca: "PCA reconstruction",
  iforest: "Isolation Forest",
  spectral_residual: "Spectral Residual",
};

const GENERATED_HEADER =
  "% AUTO-GENERATED from committed TRACE-C JSON evidence. DO NOT EDIT BY HAND.\n";

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

function eventFromRaw(
  event: RawKnownEvent,
  opportunityWindows: number,
): PaperEvent {
  const rank = event.best_rank ?? event.best_rank_of_scored_test_windows;
  if (rank == null) throw new Error(`event has no rank: ${event.id}`);
  const bestDateTime = event.best_window
    ? `${event.best_window.date}${event.best_window.time_from ? ` ${event.best_window.time_from}` : ""}`
    : null;
  return {
    id: event.id,
    rank,
    p: event.best_p,
    alerted: event.alerted,
    opportunityWindows,
    bestDateTime,
  };
}

export function loadPaperEvidence(root: string): PaperEvidence {
  const reports = join(root, "data", "reports");
  const real = readJson<RawRealReport>(join(reports, "trace-c-real-report.json"));
  const holdout = readJson<RawHoldoutReport>(join(reports, "trace-c-holdout-report.json"));
  const baselines = readJson<RawBaselinesReport>(join(reports, "baselines-report.json"));

  const countOpportunity = (id: string) =>
    holdout.timeline.filter((window) => window.known === id).length;
  const count2019Opportunity = (id: string) =>
    real.timeline.filter((window) => window.known === id).length;
  const topWindows = holdout.top_ranked.map((window, index): PaperTopWindow => ({
    rank: index + 1,
    date: window.date,
    time: window.time_from,
    p: window.p,
    alerted: window.is_alert,
    externalInterpretation:
      index === 0 && window.date === "2020-08-20"
        ? "Storm Ellen"
        : index === 4 && window.date === "2020-10-03"
          ? "Storm Alex"
          : null,
  }));

  return {
    trace2019: {
      calibration: real.calibration_check,
      events: real.known_events.map((event) =>
        eventFromRaw(event, count2019Opportunity(event.id)),
      ),
      alerts: real.alerts_total,
      expectedNullAlerts: real.expected_null_alerts,
    },
    trace2020: {
      calibrationPreCovid: holdout.calibration_check_precovid,
      calibrationFull: holdout.calibration_check_full_2020,
      events: holdout.known_events.map((event) =>
        eventFromRaw(event, countOpportunity(event.id)),
      ),
      alerts: holdout.alerts_total_2020,
      expectedNullAlerts: holdout.expected_null_alerts_2020,
      topWindows,
    },
    baselines: baselines.baselines,
    traceComparison: baselines.trace_c,
  };
}

function latexEscape(value: string): string {
  return value
    .replaceAll("\\", "\\textbackslash{}")
    .replaceAll("&", "\\&")
    .replaceAll("%", "\\%")
    .replaceAll("$", "\\$")
    .replaceAll("#", "\\#")
    .replaceAll("_", "\\_")
    .replaceAll("{", "\\{")
    .replaceAll("}", "\\}")
    .replaceAll("~", "\\textasciitilde{}")
    .replaceAll("^", "\\textasciicircum{}");
}

function calibrationCell(rows: CalibrationRow[], level: number): string {
  const row = rows.find((candidate) => candidate.level === level);
  if (!row) throw new Error(`missing calibration level ${level}`);
  return `${row.observed}/${row.expected_null.toFixed(1)}`;
}

function eventById(events: PaperEvent[], id: string): PaperEvent {
  const event = events.find((candidate) => candidate.id === id);
  if (!event) throw new Error(`missing event ${id}`);
  return event;
}

export function renderTraceResultsTable(evidence: PaperEvidence): string {
  const eventRows = [
    ...evidence.trace2019.events.map((event) => ({ ...event, segment: "2019 development" })),
    ...evidence.trace2020.events.map((event) => ({ ...event, segment: "2020 frozen hold-out" })),
  ].map((event) => {
    const baseName = EVENT_NAMES[event.id] ?? event.id;
    const name = event.id.startsWith("COVID")
      ? `${baseName} (14 days; best ${event.bestDateTime})`
      : baseName;
    return `${latexEscape(name)} & ${latexEscape(event.segment)} & ${event.rank} & ${event.p.toFixed(6)} & ${event.opportunityWindows} \\\\`;
  });
  const interpretedRows = evidence.trace2020.topWindows
    .filter((window) => window.externalInterpretation)
    .map((window) =>
      `${latexEscape(`${window.externalInterpretation} (post-ranking interpretation)`)} & ${window.rank} & ${window.date} ${window.time} & ${window.p.toFixed(6)} \\\\`,
    );

  return `${GENERATED_HEADER}\\begin{table}[t]
\\centering
\\caption{Empirical rank-p diagnostics. Expected counts are exchangeable-score references, not time-series coverage guarantees.}
\\label{tab:trace-calibration}
\\begin{tabular}{@{}lr@{}}
\\toprule
Segment and threshold & Observed/reference \\\\
\\midrule
2019 development, $p\\leq .05$ & ${calibrationCell(evidence.trace2019.calibration, 0.05)} \\\\
2019 development, $p\\leq .01$ & ${calibrationCell(evidence.trace2019.calibration, 0.01)} \\\\
2020 pre-COVID, $p\\leq .05$ & ${calibrationCell(evidence.trace2020.calibrationPreCovid, 0.05)} \\\\
2020 pre-COVID, $p\\leq .01$ & ${calibrationCell(evidence.trace2020.calibrationPreCovid, 0.01)} \\\\
2020 full year, $p\\leq .05$ & ${calibrationCell(evidence.trace2020.calibrationFull, 0.05)} \\\\
\\bottomrule
\\end{tabular}
\\end{table}

\\begin{table*}[t]
\\centering
\\caption{TRACE-C event-window ranks. Labels are used only for post-hoc evaluation.}
\\label{tab:trace-events}
\\begin{tabular}{@{}llrrr@{}}
\\toprule
Annotation & Segment & Best rank & Best $p$ & Opportunity windows \\\\
\\midrule
${eventRows.join("\n")}
\\bottomrule
\\end{tabular}
\\end{table*}

\\begin{table}[t]
\\centering
\\caption{Externally interpreted, top-ranked 2020 windows. Neither name was a detector annotation and no 2020 window passed the frozen record rule.}
\\label{tab:post-ranked-weather}
\\begin{tabular}{@{}lrrl@{}}
\\toprule
External interpretation & Rank & Timestamp & $p$ \\\\
\\midrule
${interpretedRows.join("\n")}
\\bottomrule
\\end{tabular}
\\end{table}
`;
}

function rawEventRank(segment: RawBaselineSegment, id: string): number {
  const event = segment.known_events.find((candidate) => candidate.id === id);
  if (!event) throw new Error(`missing baseline event ${id}`);
  return event.rank;
}

function rawEventDate(segment: RawBaselineSegment, id: string): string {
  const event = segment.known_events.find((candidate) => candidate.id === id);
  if (!event) throw new Error(`missing baseline event ${id}`);
  return event.best_window.date;
}

export function renderBaselineTable(evidence: PaperEvidence): string {
  const ordered = ["conv_ae", "pca", "iforest", "spectral_residual"].map((id) => {
    const detector = evidence.baselines.find((candidate) => candidate.detector === id);
    if (!detector) throw new Error(`missing detector ${id}`);
    return detector;
  });
  const trace2019 = evidence.traceComparison.y2019.known_events;
  const trace2020 = evidence.traceComparison.y2020.known_events;
  const traceRank = (events: { id: string; rank: number }[], id: string) => {
    const event = events.find((candidate) => candidate.id === id);
    if (!event) throw new Error(`missing TRACE-C comparison event ${id}`);
    return event.rank;
  };
  const lockdownTrace = eventById(
    evidence.trace2020.events,
    "COVID-LOCKDOWN-2020-03-23",
  );
  const rows = [
    `TRACE-C & ${traceRank(trace2019, "GB-BLACKOUT-2019-08-09")} & ${traceRank(trace2019, "STORM-ATIYAH-2019-12-08")} & ${traceRank(trace2020, "STORM-CIARA-2020-02-09")} & ${traceRank(trace2020, "STORM-DENNIS-2020-02-15")} & ${traceRank(trace2020, "COVID-LOCKDOWN-2020-03-23")} (${lockdownTrace.bestDateTime?.slice(0, 10)}) & ${calibrationCell(evidence.traceComparison.y2020.calibration_precovid, 0.05)} \\\\`,
    ...ordered.map((detector) => {
      const lockdownId = "COVID-LOCKDOWN-2020-03-23";
      return `${latexEscape(DETECTOR_NAMES[detector.detector] ?? detector.detector)} & ${rawEventRank(detector.y2019, "GB-BLACKOUT-2019-08-09")} & ${rawEventRank(detector.y2019, "STORM-ATIYAH-2019-12-08")} & ${rawEventRank(detector.y2020, "STORM-CIARA-2020-02-09")} & ${rawEventRank(detector.y2020, "STORM-DENNIS-2020-02-15")} & ${rawEventRank(detector.y2020, lockdownId)} (${rawEventDate(detector.y2020, lockdownId)}) & ${calibrationCell(detector.y2020.calibration_precovid ?? [], 0.05)} \\\\`;
    }),
  ];

  return `${GENERATED_HEADER}\\begin{table*}[t]
\\centering
\\caption{Post-hoc detector comparison. Lower event rank is better. The lockdown column searches a 168-window interval; parenthesized dates show each detector's best window. Protocols are not identical and only TRACE-C was frozen before 2020 inspection.}
\\label{tab:baselines}
\\begin{tabular}{@{}lrrrrrl@{}}
\\toprule
Detector & Blackout & Atiyah & Ciara & Dennis & Lockdown window & Pre-COVID $p\\leq .05$ \\\\
\\midrule
${rows.join("\n")}
\\bottomrule
\\end{tabular}
\\end{table*}
`;
}
