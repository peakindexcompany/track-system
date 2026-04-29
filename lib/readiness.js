export const EVENT_GROUP_TAU = {
  "sprints/jumps": 2.2,
  "400/400h/800": 2.3,
  "mid-distance": 2.55,
  "distance": 3.35,
  "throws": 2.55,
  "multi": 2.45,
};

export function getTauByEventGroup(eventGroup) {
  const key = String(eventGroup || "").toLowerCase().trim();
  return EVENT_GROUP_TAU[key] ?? 2.55;
}

export function calculateAdjustedLoad(duration, actualRpe, plannedRpe) {
  const dailyLoad = Number(duration || 0) * Number(actualRpe || 0);
  const rpeAdjustment =
    (Number(actualRpe || 0) - Number(plannedRpe || 0)) * 0.2;
  const adjustmentFactor = Math.max(0.5, 1 + rpeAdjustment);

  return dailyLoad * adjustmentFactor;
}

export function calculateCompoundedLoad(loadEntries, eventGroup) {
  const tau = getTauByEventGroup(eventGroup);

  const weightedTotals = loadEntries.reduce(
    (totals, entry) => {
      const daysAgo = Number(entry.daysAgo || 0);
      const adjustedLoad = Number(entry.adjustedLoad || 0);
      const weight = Math.exp(-daysAgo / tau);

      return {
        loadTotal: totals.loadTotal + adjustedLoad * weight,
        weightTotal: totals.weightTotal + weight,
      };
    },
    { loadTotal: 0, weightTotal: 0 }
  );

  if (weightedTotals.weightTotal <= 0) return 0;

  return weightedTotals.loadTotal / weightedTotals.weightTotal;
}

export function calculateReadinessRatio(compoundedLoad, avg14DayLoad) {
  if (!avg14DayLoad || avg14DayLoad <= 0) return null;

  const ratio = compoundedLoad / avg14DayLoad;

  return Math.max(0, ratio);
}

export function getReadinessZone(readinessRatio) {
  const ratio = Number(readinessRatio);

  if (!Number.isFinite(ratio)) {
    return {
      label: "No Data",
      color: "#6b7280",
      recommendation: "Not enough data yet.",
    };
  }

  if (ratio < 0.8) {
    return {
      label: "Blue",
      color: "#2563eb",
      recommendation: "Low load / fresh. Good day to train if the athlete feels ready.",
    };
  }

  if (ratio <= 1.3) {
    return {
      label: "Green",
      color: "#16a34a",
      recommendation: "Normal training range. Proceed as planned.",
    };
  }

  if (ratio <= 1.5) {
    return {
      label: "Yellow",
      color: "#d97706",
      recommendation: "Moderate fatigue. Monitor closely or consider adjusting volume.",
    };
  }

  return {
    label: "Red",
    color: "#dc2626",
    recommendation: "High accumulated fatigue. Consider modifying or reducing the session.",
  };
}