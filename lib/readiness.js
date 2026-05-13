export const EVENT_GROUP_TAU = {
  "sprints/jumps": 2.2,
  "400/400h/800": 2.3,
  "mid-distance": 2.55,
  "distance": 3.35,
  "throws": 2.55,
  "multi": 2.45,
};

export const READINESS_MODEL_CONSTANTS = {
  TAU_DAY: 1.42,
  TAU_RPE: 4.0,
  RPE_CENTER: 13.0,
};

export function getTauByEventGroup(eventGroup) {
  const key = String(eventGroup || "").toLowerCase().trim();
  return EVENT_GROUP_TAU[key] ?? 2.55;
}

export function clampNumber(value, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) return min;
  return Math.min(max, Math.max(min, number));
}

export function dayWeights(deltaDays) {
  const days = Number(deltaDays || 1);
  const { TAU_DAY } = READINESS_MODEL_CONSTANTS;

  return Math.exp(-((days - 1) ** 2) / (2 * TAU_DAY ** 2));
}

export function rpeWeights(athleteRpe) {
  const rpe = Number(athleteRpe || 0);
  const { TAU_RPE, RPE_CENTER } = READINESS_MODEL_CONSTANTS;

  return Math.exp(-((rpe - RPE_CENTER) ** 2) / (2 * TAU_RPE ** 2));
}

export function calculateMemoryWeight(deltaDays, athleteRpe) {
  return dayWeights(deltaDays) * rpeWeights(athleteRpe);
}

export function normalizeScore(value) {
  const score = clampNumber(value, 6, 20);

  return (score - 6) / 14;
}

export function calculateSigma(stress, soreness, sleep, mood) {
  const normalizedStress = normalizeScore(stress);
  const normalizedSoreness = normalizeScore(soreness);
  const normalizedSleep = normalizeScore(sleep);
  const normalizedMood = normalizeScore(mood);

  return (
    0.3 * normalizedSleep +
    0.2 * (1 - normalizedStress) +
    0.2 * (1 - normalizedSoreness) +
    0.3 * normalizedMood
  );
}

export function calculatePhi({
  stress,
  soreness,
  sleep,
  mood,
  coachRpe,
  athleteRpe,
}) {
  const sigma = calculateSigma(stress, soreness, sleep, mood);
  const perceivedEffortError = Math.tanh((Number(coachRpe || 0) - Number(athleteRpe || 0)) / 5);

  return 100 * sigma * (1 + 0.25 * perceivedEffortError);
}

export function calculateAthleteVariability(currentEntry, previousEntries = []) {
  if (!currentEntry) return null;

  const phiCurrent = calculatePhi(currentEntry);
  const recentEntries = previousEntries.slice(-2).reverse();

  if (recentEntries.length < 2) {
    return null;
  }

  const weightedHistory = recentEntries.reduce(
    (totals, entry, index) => {
      const daysAgo = index + 1;
      const phi = calculatePhi(entry);
      const weight = calculateMemoryWeight(daysAgo, entry.athleteRpe);

      return {
        phiTotal: totals.phiTotal + phi * weight,
        weightTotal: totals.weightTotal + weight,
      };
    },
    { phiTotal: 0, weightTotal: 0 }
  );

  if (weightedHistory.weightTotal <= 0) return phiCurrent;

  const historyScore = weightedHistory.phiTotal / weightedHistory.weightTotal;

  return 0.5 * phiCurrent + 0.5 * historyScore;
}

export function calculateRollingAverage(values, windowSize) {
  const validValues = values.filter((value) => Number.isFinite(Number(value)));

  if (validValues.length < windowSize) return null;

  const recentValues = validValues.slice(-windowSize);
  const total = recentValues.reduce((sum, value) => sum + Number(value), 0);

  return total / windowSize;
}

export function calculateAthleteReadinessSeries(entries = []) {
  return entries.map((entry, index) => {
    const previousEntries = entries.slice(0, index);
    const phi = calculatePhi(entry);
    const athV = calculateAthleteVariability(entry, previousEntries);
    const previousAthVValues = entries
      .slice(0, index)
      .map((previousEntry, previousIndex) =>
        calculateAthleteVariability(previousEntry, entries.slice(0, previousIndex))
      );
    const athVValuesThroughCurrent = [...previousAthVValues, athV];

    return {
      ...entry,
      phi,
      athV,
      athV3DayAvg: calculateRollingAverage(athVValuesThroughCurrent, 3),
      athV7DayAvg: calculateRollingAverage(athVValuesThroughCurrent, 7),
      athV14DayAvg: calculateRollingAverage(athVValuesThroughCurrent, 14),
      athV21DayAvg: calculateRollingAverage(athVValuesThroughCurrent, 21),
    };
  });
}

export function calculateAdjustedLoad(actualRpe, sleepQuality, stress, soreness, mood) {
  const questionnaireTotal =
    Number(sleepQuality || 0) +
    Number(stress || 0) +
    Number(soreness || 0) +
    Number(mood || 0);

  const questionnaireAvg = questionnaireTotal / 4;

  return Number(actualRpe || 0) * questionnaireAvg;
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