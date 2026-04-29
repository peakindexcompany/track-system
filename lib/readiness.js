

export const EVENT_GROUP_TAU = {
  "sprints/jumps": 2.20,
  "400/400h/800": 2.30,
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
  return compoundedLoad / avg14DayLoad;
}