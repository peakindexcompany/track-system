import React from "react";
import {
  getReadinessColor,
  getReadinessStatus,
  getReadinessRecommendation,
} from "../../lib/readiness";

export default function CoachPage({ athletes, logs }) {
  function enhanceLogsWithCompoundedReadiness(logs) {
    // Example function to enhance logs with compounded readiness ratio
    return logs.map((currentLog) => {
      const compoundedReadinessRatio = calculateCompoundedReadinessRatio(currentLog);

      return {
        ...currentLog,
        readinessRatio:
          compoundedReadinessRatio !== null
            ? Number(Math.max(0, compoundedReadinessRatio).toFixed(2))
            : Math.max(0, Number(currentLog.readinessRatio || 0)),
      };
    });
  }

  function calculateCompoundedReadinessRatio(log) {
    // Placeholder for actual compounded readiness ratio calculation
    return log.readinessRatio || null;
  }

  function renderAthleteLogCard(log) {
    const safeReadinessRatio = Math.max(0, Number(log.readinessRatio || 0));
    const readinessColor = getReadinessColor(safeReadinessRatio);
    const readinessStatus = getReadinessStatus(safeReadinessRatio);

    return (
      <div key={log.id} style={{ borderColor: readinessColor, borderWidth: 2, borderStyle: "solid", padding: 10, marginBottom: 10 }}>
        <h3>{log.athleteName}</h3>
        <p>
          Readiness Status: <strong>{readinessStatus.label}</strong>
        </p>
        <p>
          Readiness Ratio: <strong>{Number.isFinite(safeReadinessRatio) ? safeReadinessRatio.toFixed(2) : "N/A"}</strong>
        </p>
        <p>
          {getReadinessRecommendation(safeReadinessRatio, log.shouldTrainToday)}
        </p>
      </div>
    );
  }

  const enhancedLogs = enhanceLogsWithCompoundedReadiness(logs);

  return (
    <div>
      <h1>Coach Dashboard</h1>
      {enhancedLogs.map(renderAthleteLogCard)}
    </div>
  );
}