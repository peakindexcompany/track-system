"use client";

import { useEffect, useState } from "react";
import styles from "../dashboard.module.css";
import { useRouter } from "next/navigation";
import { auth, db } from "../../lib/firebase";
import {
  calculateAdjustedLoad,
  calculateCompoundedLoad,
  calculateReadinessRatio,
  calculateAthleteReadinessSeries,
} from "../../lib/readiness";
import { onAuthStateChanged, signOut } from "firebase/auth";
import {
  collection,
  addDoc,
  getDocs,
  query,
  where,
  serverTimestamp,
  doc,
  getDoc,
  deleteDoc,
  updateDoc,
  onSnapshot,
} from "firebase/firestore";

const sortSessionsNewestFirst = (sessions) => {
  return [...sessions].sort((a, b) => {
    const dateA = a.sessionDate ? new Date(a.sessionDate) : new Date(0);
    const dateB = b.sessionDate ? new Date(b.sessionDate) : new Date(0);
    return dateB - dateA;
  });
};

const sortLogsNewestFirst = (logs) => {
  return [...logs].sort((a, b) => {
    const dateA = a.createdAt?.toDate ? a.createdAt.toDate() : new Date(0);
    const dateB = b.createdAt?.toDate ? b.createdAt.toDate() : new Date(0);
    return dateB - dateA;
  });
};

const getLogDateValue = (log) => {
  if (log.sessionDate) {
    return new Date(`${log.sessionDate}T12:00:00`);
  }

  if (log.createdAt?.toDate) {
    return log.createdAt.toDate();
  }

  if (log.createdAt) {
    return new Date(log.createdAt);
  }

  return null;
};

const getSessionDuration = (log) => {
  return Number(
    log.duration ||
      log.sessionDuration ||
      log.durationMinutes ||
      log.minutes ||
      60
  );
};

const enhanceLogsWithCompoundedReadiness = (logs) => {
  const grouped = {};

  logs.forEach((log) => {
    const key = log.userId || log.name || log.id;
    if (!grouped[key]) {
      grouped[key] = [];
    }
    grouped[key].push(log);
  });

  const enhancedLogsById = {};

  Object.values(grouped).forEach((athleteLogsGroup) => {
    const sortedOldestFirst = [...athleteLogsGroup].sort((a, b) => {
      const dateA = getLogDateValue(a) || new Date(0);
      const dateB = getLogDateValue(b) || new Date(0);
      return dateA - dateB;
    });

    const modelReadyLogs = sortedOldestFirst.map((log) => ({
      ...log,
      stress: Number(log.stress || 6),
      soreness: Number(log.soreness || 6),
      sleep: Number(log.sleepQuality || log.sleep || 6),
      mood: Number(log.mood || 6),
      coachRpe: Number(log.plannedRPE || log.coachRPE || 6),
      athleteRpe: Number(log.actualRPE || log.athleteRPE || 6),
    }));

    const athleteReadinessSeries = calculateAthleteReadinessSeries(modelReadyLogs);
    const athleteReadinessById = {};

    athleteReadinessSeries.forEach((entry) => {
      if (entry.id) {
        athleteReadinessById[entry.id] = entry;
      }
    });

    sortedOldestFirst.forEach((currentLog) => {
      const currentDate = getLogDateValue(currentLog);
      const modelEntry = athleteReadinessById[currentLog.id] || {};

      if (!currentDate) {
        enhancedLogsById[currentLog.id] = currentLog;
        return;
      }

      const eventGroup =
        currentLog.eventGroup || sortedOldestFirst[0]?.eventGroup || "Mid-Distance";

      const logsBeforeOrOnCurrentDate = sortedOldestFirst.filter((log) => {
        const logDate = getLogDateValue(log);
        return logDate && logDate <= currentDate;
      });

      const adjustedLogs = logsBeforeOrOnCurrentDate.map((log) => {
        const logDate = getLogDateValue(log);
        const daysAgo = Math.max(
          0,
          Math.round((currentDate - logDate) / (1000 * 60 * 60 * 24))
        );

        return {
          ...log,
          daysAgo,
          adjustedLoad: calculateAdjustedLoad(
            log.actualRPE,
            log.sleepQuality,
            log.stress,
            log.soreness,
            log.mood
          ),
        };
      });

      const recentLoadEntries = adjustedLogs.filter((log) => log.daysAgo <= 7);
      const baselineLoadEntries = adjustedLogs.filter((log) => log.daysAgo <= 14);

      const compoundedLoad = calculateCompoundedLoad(recentLoadEntries, eventGroup);
      const avg14DayLoad =
        baselineLoadEntries.length > 0
          ? baselineLoadEntries.reduce(
              (sum, log) => sum + Number(log.adjustedLoad || 0),
              0
            ) / baselineLoadEntries.length
          : null;

      const compoundedReadinessRatio = calculateReadinessRatio(
        compoundedLoad,
        avg14DayLoad
      );

      enhancedLogsById[currentLog.id] = {
        ...currentLog,
        phi:
          modelEntry.phi !== undefined && modelEntry.phi !== null
            ? Number(modelEntry.phi.toFixed(1))
            : null,
        athV:
          modelEntry.athV !== undefined && modelEntry.athV !== null
            ? Number(modelEntry.athV.toFixed(1))
            : null,
        athV3DayAvg:
          modelEntry.athV3DayAvg !== undefined && modelEntry.athV3DayAvg !== null
            ? Number(modelEntry.athV3DayAvg.toFixed(1))
            : null,
        athV7DayAvg:
          modelEntry.athV7DayAvg !== undefined && modelEntry.athV7DayAvg !== null
            ? Number(modelEntry.athV7DayAvg.toFixed(1))
            : null,
        athV14DayAvg:
          modelEntry.athV14DayAvg !== undefined && modelEntry.athV14DayAvg !== null
            ? Number(modelEntry.athV14DayAvg.toFixed(1))
            : null,
        athV21DayAvg:
          modelEntry.athV21DayAvg !== undefined && modelEntry.athV21DayAvg !== null
            ? Number(modelEntry.athV21DayAvg.toFixed(1))
            : null,
        adjustedLoad: Number(
          calculateAdjustedLoad(
            currentLog.actualRPE,
            currentLog.sleepQuality,
            currentLog.stress,
            currentLog.soreness,
            currentLog.mood
          ).toFixed(1)
        ),
        compoundedLoad: Number(compoundedLoad.toFixed(1)),
        avg14DayLoad: avg14DayLoad ? Number(avg14DayLoad.toFixed(1)) : null,
        readinessRatio:
          modelEntry.athV !== undefined && modelEntry.athV !== null
            ? Number((modelEntry.athV / 100).toFixed(2))
            : compoundedReadinessRatio !== null
            ? Number(Math.max(0, compoundedReadinessRatio).toFixed(2))
            : Math.max(0, Number(currentLog.readinessRatio || 0)),
        readinessModel: "Athlete Variability",
      };
    });
  });

  return logs.map((log) => enhancedLogsById[log.id] || log);
};

export default function CoachDashboard() {
  const router = useRouter();
  const [isMobile, setIsMobile] = useState(false);

  const [user, setUser] = useState(null);
  const [coachProfile, setCoachProfile] = useState(null);
  const [teamCode, setTeamCode] = useState("");
  const [loading, setLoading] = useState(true);
  const [statusMessage, setStatusMessage] = useState("");

  const [activeTab, setActiveTab] = useState("overview");
  const [coachMenuOpen, setCoachMenuOpen] = useState(false);
  const [mailboxOpen, setMailboxOpen] = useState(false);
  const [groupMessageOpen, setGroupMessageOpen] = useState(false);
  const [selectedGroupForMessage, setSelectedGroupForMessage] = useState("");
  const [groupMessage, setGroupMessage] = useState("");

  const [sessionType, setSessionType] = useState("");
  const [sessionGroup, setSessionGroup] = useState("All");
  const [sessionDate, setSessionDate] = useState("");
  const [plannedRPE, setPlannedRPE] = useState("");
  const [workoutNotes, setWorkoutNotes] = useState("");
  const [editingSessionId, setEditingSessionId] = useState(null);

  const [plannedSessions, setPlannedSessions] = useState([]);
  const [athleteLogs, setAthleteLogs] = useState([]);
  const [coachNotes, setCoachNotes] = useState({});

  const [filterName, setFilterName] = useState("");
  const [filterEventGroup, setFilterEventGroup] = useState("All");
  const [filterAlertStatus, setFilterAlertStatus] = useState("All");
  const [showMissedWorkoutList, setShowMissedWorkoutList] = useState(false);

  const [seenMailboxIds, setSeenMailboxIds] = useState(() => {
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem("coachSeenMailboxIds");
      return saved ? JSON.parse(saved) : [];
    }

    return [];
  });

  useEffect(() => {
    const updateIsMobile = () => {
      if (typeof window !== "undefined") {
        setIsMobile(window.innerWidth <= 768);
      }
    };

    updateIsMobile();
    window.addEventListener("resize", updateIsMobile);

    return () => window.removeEventListener("resize", updateIsMobile);
  }, []);

  const showStatus = (message) => {
    setStatusMessage(message);

    setTimeout(() => {
      setStatusMessage("");
    }, 2500);
  };

  useEffect(() => {
    let unsubscribeSessions = null;
    let unsubscribeLogs = null;

    const unsubscribeAuth = onAuthStateChanged(auth, async (currentUser) => {
      if (!currentUser) {
        router.push("/");
        return;
      }

      setUser(currentUser);

      try {
        const userRef = doc(db, "users", currentUser.uid);
        const userSnap = await getDoc(userRef);

        if (!userSnap.exists()) {
          showStatus("Coach account profile not found. Please log in again.");
          setLoading(false);
          router.push("/");
          return;
        }

        const data = userSnap.data();

        const roleFields = [
          data.role,
          data.accountType,
          data.userType,
          data.type,
          data.accountRole,
        ]
          .filter(Boolean)
          .map((value) => String(value).toLowerCase().trim());

        const profileTeamCode =
          data.teamCode ||
          data.teamcode ||
          data.team_code ||
          data.institutionCode ||
          data.generatedTeamCode ||
          data.coachTeamCode ||
          data.schoolCode ||
          data.code ||
          "";

        const hasCoachRole = roleFields.some((role) => role.includes("coach"));
        const hasAthleteRole = roleFields.some((role) => role.includes("athlete"));
        const isCoachProfile = hasCoachRole || data.isCoach === true || !hasAthleteRole;

        if (!isCoachProfile) {
          showStatus("This account is not marked as coach. Redirecting...");
          setLoading(false);
          router.push("/");
          return;
        }

        setCoachProfile(data);
        setTeamCode(profileTeamCode);

        const loadTeamData = (code) => {
          if (!code) return;

          const sessionsQuery = query(
            collection(db, "planned_sessions"),
            where("teamCode", "==", code)
          );

          unsubscribeSessions = onSnapshot(sessionsQuery, (snapshot) => {
            const sessionsData = snapshot.docs.map((d) => ({
              id: d.id,
              ...d.data(),
            }));

            setPlannedSessions(sortSessionsNewestFirst(sessionsData));
          });

          const logsQuery = query(
            collection(db, "readiness_logs"),
            where("teamCode", "==", code)
          );

          unsubscribeLogs = onSnapshot(logsQuery, (snapshot) => {
            const logsData = snapshot.docs.map((d) => ({
              id: d.id,
              ...d.data(),
            }));

            const sortedLogs = sortLogsNewestFirst(logsData);
            const enhancedLogs = enhanceLogsWithCompoundedReadiness(sortedLogs);
            setAthleteLogs(enhancedLogs);

            const notesObject = {};
            enhancedLogs.forEach((log) => {
              notesObject[log.id] = log.coachNote || "";
            });

            setCoachNotes(notesObject);
          });
        };

        if (profileTeamCode) {
          loadTeamData(profileTeamCode);
        } else {
          const coachSessionsQuery = query(
            collection(db, "planned_sessions"),
            where("coachId", "==", currentUser.uid)
          );

          unsubscribeSessions = onSnapshot(coachSessionsQuery, (snapshot) => {
            const sessionsData = snapshot.docs.map((d) => ({
              id: d.id,
              ...d.data(),
            }));

            const sortedSessions = sortSessionsNewestFirst(sessionsData);
            setPlannedSessions(sortedSessions);

            const derivedTeamCode = sortedSessions.find((s) => s.teamCode)?.teamCode || "";

            if (derivedTeamCode) {
              setTeamCode(derivedTeamCode);

              if (!unsubscribeLogs) {
                const logsQuery = query(
                  collection(db, "readiness_logs"),
                  where("teamCode", "==", derivedTeamCode)
                );

                unsubscribeLogs = onSnapshot(logsQuery, (logsSnapshot) => {
                  const logsData = logsSnapshot.docs.map((d) => ({
                    id: d.id,
                    ...d.data(),
                  }));

                  const sortedLogs = sortLogsNewestFirst(logsData);
                  const enhancedLogs = enhanceLogsWithCompoundedReadiness(sortedLogs);
                  setAthleteLogs(enhancedLogs);

                  const notesObject = {};
                  enhancedLogs.forEach((log) => {
                    notesObject[log.id] = log.coachNote || "";
                  });

                  setCoachNotes(notesObject);
                });
              }
            }
          });
        }
      } catch (error) {
        console.error(error);
        showStatus("Error loading coach profile.");
      }

      setLoading(false);
    });

    return () => {
      unsubscribeAuth();

      if (unsubscribeSessions) {
        unsubscribeSessions();
      }

      if (unsubscribeLogs) {
        unsubscribeLogs();
      }
    };
  }, [router]);

  const isAlertLog = (log) => {
    return (
      log.shouldTrainToday === "No" ||
      log.shouldTrainToday === "Unsure" ||
      log.workoutCompleted === "No" ||
      log.workoutCompleted === "Modified" ||
      Number(log.readinessRatio) > 1.3
    );
  };

  const coachMailboxItems = athleteLogs
    .filter((log) => isAlertLog(log))
    .map((log) => {
      const timestamp =
        log.updatedAt?.seconds ||
        log.createdAt?.seconds ||
        0;

      return {
        id: `coach-alert-${log.id}-${timestamp}`,
        athleteName: log.name || "Unnamed Athlete",
        title: `${log.name || "Unnamed Athlete"} needs attention`,
        message:
          log.shouldTrainToday === "No" || log.shouldTrainToday === "Unsure"
            ? `${log.name || "Unnamed Athlete"} marked ${
                log.shouldTrainToday
              } for ${log.sessionType || "their session"}.`
            : `${log.name || "Unnamed Athlete"} has entered an at-risk readiness zone.`,
        log,
        timestamp,
      };
    });

  const unreadMailboxItems = coachMailboxItems.filter(
    (item) => !seenMailboxIds.includes(item.id)
  );

  const unreadMailboxNewestFirst = [...unreadMailboxItems].sort(
    (a, b) => (b.timestamp || 0) - (a.timestamp || 0)
  );
    const markMailboxItemRead = (itemId) => {
    const updatedSeenIds = [...new Set([...seenMailboxIds, itemId])];
    setSeenMailboxIds(updatedSeenIds);

    if (typeof window !== "undefined") {
      localStorage.setItem(
        "coachSeenMailboxIds",
        JSON.stringify(updatedSeenIds)
      );
    }
  };

  const markAllMailboxRead = () => {
    const allIds = coachMailboxItems.map((item) => item.id);
    setSeenMailboxIds(allIds);

    if (typeof window !== "undefined") {
      localStorage.setItem("coachSeenMailboxIds", JSON.stringify(allIds));
    }
  };

  const handleOpenMailbox = () => {
    setMailboxOpen(true);
  };

  const handleCloseMailbox = () => {
    setMailboxOpen(false);
  };

  const handleSavePlannedSession = async () => {
    if (!coachProfile || !teamCode) {
      showStatus("Coach profile not loaded.");
      return;
    }

    if (!sessionType || !plannedRPE || !sessionDate) {
      showStatus("Enter session type, date, and planned RPE.");
      return;
    }

    if (editingSessionId) {
      await updateDoc(doc(db, "planned_sessions", editingSessionId), {
        sessionType,
        sessionDate,
        plannedRPE: Number(plannedRPE),
        workoutNotes,
        sessionGroup,
        updatedAt: serverTimestamp(),
      });

      showStatus("Session updated.");
    } else {
      await addDoc(collection(db, "planned_sessions"), {
        coachId: user.uid,
        teamCode,
        sessionType,
        sessionDate,
        plannedRPE: Number(plannedRPE),
        workoutNotes,
        sessionGroup,
        createdAt: serverTimestamp(),
      });

      showStatus("Session saved.");
    }

    setEditingSessionId(null);
    setSessionType("");
    setSessionDate("");
    setPlannedRPE("");
    setWorkoutNotes("");
  };

  const handleEditSession = (session) => {
    setEditingSessionId(session.id);
    setSessionType(session.sessionType || "");
    setSessionDate(session.sessionDate || "");
    setPlannedRPE(session.plannedRPE || "");
    setWorkoutNotes(session.workoutNotes || "");
    setSessionGroup(session.sessionGroup || "All");
    setActiveTab("planning");
  };

  const handleCancelEdit = () => {
    setEditingSessionId(null);
    setSessionType("");
    setSessionDate("");
    setPlannedRPE("");
    setWorkoutNotes("");
  };

  const handleDeleteSession = async (sessionId) => {
    const confirmDelete = window.confirm(
      "Delete this planned session? This will not delete athlete logs already connected to it."
    );

    if (!confirmDelete) return;

    try {
      await deleteDoc(doc(db, "planned_sessions", sessionId));
      showStatus("Session deleted.");
    } catch (error) {
      console.error(error);
      showStatus("Error deleting session.");
    }
  };

  const handleSendMessage = async (logId) => {
    const message = coachNotes[logId] || "";

    if (!message.trim()) {
      showStatus("Write a message before sending.");
      return;
    }

    try {
      await updateDoc(doc(db, "readiness_logs", logId), {
        coachNote: message,
        coachNoteUpdatedAt: serverTimestamp(),
        coachMessageRead: false,
      });

      showStatus("Message sent to athlete.");
    } catch (error) {
      console.error(error);
      showStatus("Error sending message.");
    }
  };

  const getGroupMessageRecipients = () => {
    if (!selectedGroupForMessage) return [];

    const latestLogsByAthlete = {};

    sortLogsNewestFirst(athleteLogs)
      .filter((log) => log.eventGroup === selectedGroupForMessage)
      .forEach((log) => {
        const key = log.userId || log.name || log.id;

        if (!latestLogsByAthlete[key]) {
          latestLogsByAthlete[key] = log;
        }
      });

    return Object.values(latestLogsByAthlete);
  };

  const handleSendGroupMessage = async () => {
    if (!selectedGroupForMessage) {
      showStatus("Select a group first.");
      return;
    }

    if (!groupMessage.trim()) {
      showStatus("Write a group message before sending.");
      return;
    }
    const latestLogs = getGroupMessageRecipients();

    if (latestLogs.length === 0) {
      showStatus("No athletes with logs found for this group.");
      return;
    }

    try {
      await Promise.all(
        latestLogs.map((log) =>
          updateDoc(doc(db, "readiness_logs", log.id), {
            coachNote: groupMessage,
            coachNoteUpdatedAt: serverTimestamp(),
            coachMessageRead: false,
          })
        )
      );

      showStatus(
        `Message sent to ${latestLogs.length} athlete${
          latestLogs.length === 1 ? "" : "s"
        }.`
      );

      setGroupMessage("");
      setSelectedGroupForMessage("");
      setGroupMessageOpen(false);
    } catch (error) {
      console.error(error);
      showStatus("Error sending group message.");
    }
  };

  const handleDeleteAthleteLog = async (logId) => {
    const confirmDelete = window.confirm("Delete this athlete readiness log?");

    if (!confirmDelete) return;

    try {
      await deleteDoc(doc(db, "readiness_logs", logId));
      showStatus("Readiness log deleted.");
    } catch (error) {
      console.error(error);
      showStatus("Error deleting readiness log.");
    }
  };

  const getReadinessColor = (ratio) => {
    const value = Number(ratio);

    if (value < 0.8) return "#2563eb";
    if (value >= 0.8 && value <= 1.3) return "#16a34a";
    if (value > 1.3 && value <= 1.5) return "#f97316";
    if (value > 1.5) return "#dc2626";

    return "#111827";
  };

  const groupPalette = [
    "#38bdf8",
    "#f59e0b",
    "#a78bfa",
    "#34d399",
    "#f43f5e",
    "#facc15",
    "#60a5fa",
    "#f472b6",
    "#4ade80",
    "#fb7185",
    "#818cf8",
    "#22d3ee",
  ];

  const getGroupColor = (index) => groupPalette[index % groupPalette.length];

  const normalizeEventGroupLabel = (value) => {
    const trimmed = String(value || "").trim();
    if (!trimmed) return "Unassigned";

    const normalized = trimmed.toLowerCase();
    if (normalized === "400/400h/800" || normalized === "400/400h/800" || normalized === "400/400h/800") {
      return "400/400h";
    }

    return trimmed;
  };

  const renderGroupLegend = (data) => (
    <div style={{ marginTop: 0, borderLeft: "1px solid rgba(148,163,184,0.18)", paddingLeft: 12, minWidth: 180 }}>
      <p style={{ margin: "0 0 6px", fontSize: 11, fontWeight: 700, color: "#cbd5e1", textTransform: "uppercase", letterSpacing: "0.08em" }}>
        Group colors
      </p>
      <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
        {data.map((item) => (
          <div key={item.label} style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
            <span
              style={{
                width: 10,
                height: 10,
                borderRadius: "50%",
                background: item.color,
                border: "1px solid rgba(255,255,255,0.4)",
                flexShrink: 0,
              }}
            />
            <span style={{ color: "#f8fafc", fontSize: 12, fontWeight: 600 }}>{item.label}</span>
          </div>
        ))}
      </div>
    </div>
  );

  const getReadinessStatus = (ratio) => {
    const value = Number(ratio);

    if (value === 0) return "Not Enough Data";
    if (value <= 1.3) return "Ready";
    if (value <= 1.5) return "Caution";
    return "Not Ready";
  };

  const getReadinessRecommendation = (ratio, shouldTrainToday) => {
    const value = Number(ratio);

    if (shouldTrainToday === "No") {
      return "Coach Suggestion: Check in before training. Consider recovery or a modified session.";
    }

    if (shouldTrainToday === "Unsure") {
      return "Coach Suggestion: Talk with the athlete before the workout and consider reducing load.";
    }

    if (value < 0.8) {
      return "Coach Suggestion: Low strain. Proceed as planned unless athlete feedback says otherwise.";
    }

    if (value >= 0.8 && value <= 1.3) {
      return "Coach Suggestion: Ready. Proceed with the planned session.";
    }

    if (value > 1.3 && value <= 1.5) {
      return "Coach Suggestion: Caution. Consider reducing volume or intensity.";
    }

    if (value > 1.5) {
      return "Coach Suggestion: High risk. Recommend recovery, reduced load, or modified training.";
    }

    return "Coach Suggestion: Not enough data. Use athlete feedback.";
  };

  // --- BEGIN: Trend helpers ---
  const getSafeReadinessRatio = (ratio) => {
    const v = Number(ratio);
    if (!Number.isFinite(v)) return 0;
    return Math.max(0, v);
  };

  const getAthleteLogsForTrend = (log) => {
    const key = log.userId || log.name || log.id;
    return sortLogsNewestFirst(
      athleteLogs.filter((e) => (e.userId || e.name || e.id) === key)
    );
  };

  const getReadinessTrend = (logs, days = 3) => {
    if (!logs || logs.length < days * 2) {
      return { label: "Not enough data", symbol: "—", color: "#6b7280" };
    }
    const recent = logs.slice(0, days);
    const prev = logs.slice(days, days * 2);
    const avg = (arr) => arr.reduce((s, x) => s + getSafeReadinessRatio(x.readinessRatio), 0) / arr.length;
    const r = avg(recent);
    const p = avg(prev);
    const d = r - p;
    if (d > 0.05) return { label: "Increasing strain", symbol: "↑", color: "#d97706" };
    if (d < -0.05) return { label: "Recovering", symbol: "↓", color: "#2563eb" };
    return { label: "Stable", symbol: "→", color: "#16a34a" };
  };
  // --- END: Trend helpers ---

  const getLogDate = (log) => {
    if (!log.createdAt) return null;
    if (log.createdAt.toDate) return log.createdAt.toDate();
    return new Date(log.createdAt);
  };

  const formatTimestamp = (timestamp) => {
    if (!timestamp) return "N/A";

    const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);

    return date.toLocaleString([], {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  };

  const getAverageForDays = (logs, days) => {
    const now = new Date();
    const cutoff = new Date();
    cutoff.setDate(now.getDate() - days);

    const recentLogs = logs.filter((log) => {
      const date = getLogDate(log);
      return date && date >= cutoff;
    });

    if (recentLogs.length === 0) return null;

    const total = recentLogs.reduce(
      (sum, log) => sum + getSafeReadinessRatio(log.readinessRatio),
      0
    );

    return Number((total / recentLogs.length).toFixed(2));
  };

  const getAthleteAverages = () => {
    const grouped = {};

    athleteLogs.forEach((log) => {
      const name = log.name || "Unnamed Athlete";

      if (!grouped[name]) {
        grouped[name] = [];
      }

      grouped[name].push(log);
    });

    return Object.keys(grouped).map((name) => {
      const logs = grouped[name];

      const threeDayAvg = getAverageForDays(logs, 3);
      const sevenDayAvg = getAverageForDays(logs, 7);
      const fourteenDayAvg = getAverageForDays(logs, 14);

      let trend = "Not enough data";

      if (threeDayAvg !== null && fourteenDayAvg !== null) {
        if (threeDayAvg > fourteenDayAvg + 0.15) {
          trend = "Trending higher strain";
        } else if (threeDayAvg < fourteenDayAvg - 0.15) {
          trend = "Trending lower strain";
        } else {
          trend = "Stable";
        }
      }

      return {
        name,
        eventGroup: logs[0]?.eventGroup || "N/A",
        threeDayAvg,
        sevenDayAvg,
        fourteenDayAvg,
        trend,
      };
    });
  };

  const getUniqueEventGroups = () => {
    const groups = athleteLogs
      .map((log) => normalizeEventGroupLabel(log.eventGroup))
      .filter((group) => group && group.trim() !== "" && group !== "Unassigned");

    return ["All", ...Array.from(new Set(groups))];
  };

  const getAtRiskAthletes = () => {
    const grouped = {};

    athleteLogs.forEach((log) => {
      const key = log.userId || log.name || log.id;

      if (!grouped[key]) {
        grouped[key] = [];
      }

      grouped[key].push(log);
    });

    return Object.values(grouped)
      .map((logs) => sortLogsNewestFirst(logs))
      .map((logs) => {
        const latest = logs[0];

        return {
          name: latest?.name || "Unnamed Athlete",
          eventGroup: latest?.eventGroup || "N/A",
          ratio: Number(latest?.readinessRatio || 0),
          shouldTrain: latest?.shouldTrainToday || "N/A",
          sessionType: latest?.sessionType || "N/A",
          logs: logs.slice(0, 7),
        };
      })
      .filter(
        (athlete) =>
          athlete.ratio > 1.3 ||
          athlete.shouldTrain === "No" ||
          athlete.shouldTrain === "Unsure"
      );
  };

  const renderTrendDots = (logs) => {
    return logs.map((log, index) => {
      const color = getReadinessColor(log.readinessRatio);

      return (
        <span
          key={`${log.id || index}-trend-dot`}
          title={`${log.sessionDate || "Log"}: ${log.readinessRatio || "N/A"}`}
          style={{
            display: "inline-block",
            width: 9,
            height: 9,
            borderRadius: "50%",
            background: color,
            marginRight: 5,
          }}
        />
      );
    });
  };

  const isTodayLog = (log) => {
    const date = getLogDate(log);
    if (!date) return false;

    const today = new Date();

    return (
      date.getFullYear() === today.getFullYear() &&
      date.getMonth() === today.getMonth() &&
      date.getDate() === today.getDate()
    );
  };

  const getDailySummary = () => {
    const todayLogs = athleteLogs.filter((log) => isTodayLog(log));

    const noOrUnsureCount = todayLogs.filter(
      (log) => log.shouldTrainToday === "No" || log.shouldTrainToday === "Unsure"
    ).length;

    const highestRiskLog = todayLogs.reduce((highest, log) => {
      if (!highest) return log;

      return Number(log.readinessRatio || 0) > Number(highest.readinessRatio || 0)
        ? log
        : highest;
    }, null);

    const needsCoachNoteCount = todayLogs.filter(
      (log) => !log.coachNote || String(log.coachNote).trim() === ""
    ).length;

    const now = new Date();
    const weekAgo = new Date();
    weekAgo.setDate(now.getDate() - 7);

    const thisWeekLogs = athleteLogs.filter((log) => {
      const date = getLogDate(log);
      return date && date >= weekAgo && date <= now;
    });

    const missedWorkoutsThisWeek = thisWeekLogs.filter(
      (log) => log.workoutCompleted === "No"
    ).length;

    const modifiedWorkoutsThisWeek = thisWeekLogs.filter(
      (log) => log.workoutCompleted === "Modified"
    ).length;

    const completedWorkoutsThisWeek = thisWeekLogs.filter(
      (log) => log.workoutCompleted === "Yes"
    ).length;

    return {
      loggedTodayCount: todayLogs.length,
      noOrUnsureCount,
      highestRiskLog,
      needsCoachNoteCount,
      missedWorkoutsThisWeek,
      modifiedWorkoutsThisWeek,
      completedWorkoutsThisWeek,
    };
  };

  const getTodaysPlannedSessions = () => {
    const today = new Date();
    const year = today.getFullYear();
    const month = String(today.getMonth() + 1).padStart(2, "0");
    const day = String(today.getDate()).padStart(2, "0");
    const todayString = `${year}-${month}-${day}`;

    return plannedSessions.filter((session) => session.sessionDate === todayString);
  };

  const eventGroupOrder = [
    "Sprints/Jumps",
    "400/400h",
    "Throws",
    "Distance",
    "Mid-Distance",
    "Multi",
  ];

    const applyFilters = (logs) => {
    return logs.filter((log) => {
      const nameMatch = String(log.name || "")
        .toLowerCase()
        .includes(filterName.toLowerCase());

      const eventGroupMatch =
        filterEventGroup === "All" || log.eventGroup === filterEventGroup;

      let alertMatch = true;

      if (filterAlertStatus === "Alerts Only") {
        alertMatch = isAlertLog(log);
      }

      if (filterAlertStatus === "No Alerts") {
        alertMatch = !isAlertLog(log);
      }

      return nameMatch && eventGroupMatch && alertMatch;
    });
  };

  const handleClearFilters = () => {
    setFilterName("");
    setFilterEventGroup("All");
    setFilterAlertStatus("All");
  };

  const scrollToLogsSection = () => {
    requestAnimationFrame(() => {
      const el = document.getElementById("coach-athlete-logs-section");
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    });
  };

  const handleSignOut = async () => {
    await signOut(auth);
    router.push("/");
  };

  const openLogsWithFilters = ({
    name = "",
    eventGroup = "All",
    alertStatus = "All",
  } = {}) => {
    setActiveTab("logs");
    setFilterName(name);
    setFilterEventGroup(eventGroup);
    setFilterAlertStatus(alertStatus);
    requestAnimationFrame(scrollToLogsSection);
  };

  const cardStyle = {
  border: "1px solid rgba(148,163,184,0.18)",
  borderRadius: 22,
  padding: isMobile ? 14 : 20,
  marginBottom: 18,
  background: "rgba(15,23,42,0.75)",
  boxShadow: "none",
  backdropFilter: "none",
  color: "#f8fafc",
};

  const badgeStyle = (color) => ({
    display: "inline-block",
    padding: "6px 10px",
    borderRadius: 999,
    background: color,
    color: "white",
    fontWeight: "bold",
    fontSize: 13,
  });

  const athleteAverages = getAthleteAverages();
  const filteredAthleteLogs = applyFilters(athleteLogs);
  const eventGroupOptions = getUniqueEventGroups();
  const atRiskAthletes = getAtRiskAthletes();
  const dailySummary = getDailySummary();
  const todaysPlannedSessions = getTodaysPlannedSessions();
  const getMissedWorkoutAthletesThisWeek = () => {
    const now = new Date();
    const weekAgo = new Date();
    weekAgo.setDate(now.getDate() - 7);

    const missedLogs = athleteLogs.filter((log) => {
      const date = getLogDate(log);
      return (
        date &&
        date >= weekAgo &&
        date <= now &&
        log.workoutCompleted === "No"
      );
    });

    const grouped = {};

    missedLogs.forEach((log) => {
      const key = log.userId || log.name || log.id;

      if (!grouped[key]) {
        grouped[key] = {
          name: log.name || "Unnamed Athlete",
          eventGroup: log.eventGroup || "N/A",
          count: 0,
          logs: [],
        };
      }

      grouped[key].count += 1;
      grouped[key].logs.push(log);
    });

    return Object.values(grouped).sort((a, b) => b.count - a.count);
  };
  const missedWorkoutAthletesThisWeek = getMissedWorkoutAthletesThisWeek();

  const getCoachTrendNotifications = () => {
    const grouped = {};

    athleteLogs.forEach((log) => {
      const key = log.userId || log.name || log.id;

      if (!grouped[key]) {
        grouped[key] = [];
      }

      grouped[key].push(log);
    });

    const notifications = [];

    Object.values(grouped).forEach((logs) => {
      const sortedLogs = sortLogsNewestFirst(logs);
      const latest = sortedLogs[0];

      if (!latest) return;

      const threeDayAvg = getAverageForDays(sortedLogs, 3);
      const sevenDayAvg = getAverageForDays(sortedLogs, 7);
      const fourteenDayAvg = getAverageForDays(sortedLogs, 14);
      const rpeDifference = Number(latest.actualRPE || 0) - Number(latest.plannedRPE || 0);

      const lastThreeLogs = sortedLogs.slice(0, 3);
      const sleepQualityLogs = lastThreeLogs.filter((log) => Number(log.sleepQuality || 0) > 0);
      const avgSleepQuality =
        sleepQualityLogs.length > 0
          ? sleepQualityLogs.reduce((sum, log) => sum + Number(log.sleepQuality || 0), 0) /
            sleepQualityLogs.length
          : null;

      const baseNotification = {
        athleteName: latest.name || "Unnamed Athlete",
        eventGroup: latest.eventGroup || "N/A",
        sessionType: latest.sessionType || "N/A",
        sessionDate: latest.sessionDate || "N/A",
      };

      if (latest.shouldTrainToday === "No" || latest.shouldTrainToday === "Unsure") {
        notifications.push({
          ...baseNotification,
          type: "Training Readiness",
          severity: "High",
          color: "#dc2626",
          message: `${latest.name || "Unnamed Athlete"} marked ${latest.shouldTrainToday} for training today.`,
        });
      }

      if (latest.workoutCompleted === "No") {
        notifications.push({
          ...baseNotification,
          type: "Missed Workout",
          severity: "High",
          color: "#dc2626",
          message: `${latest.name || "Unnamed Athlete"} did not complete yesterday's workout.`,
        });
      }

      if (latest.workoutCompleted === "Modified") {
        notifications.push({
          ...baseNotification,
          type: "Modified Workout",
          severity: "Medium",
          color: "#d97706",
          message: `${latest.name || "Unnamed Athlete"} modified yesterday's workout.`,
        });
      }

      if (Number(latest.readinessRatio || 0) > 1.3) {
        notifications.push({
          ...baseNotification,
          type: "Readiness Trend",
          severity: "Medium",
          color: "#d97706",
          message: `${latest.name || "Unnamed Athlete"} is above the caution readiness threshold.`,
        });
      }

      if (threeDayAvg !== null && fourteenDayAvg !== null && threeDayAvg > fourteenDayAvg + 0.15) {
        notifications.push({
          ...baseNotification,
          type: "Rising Strain",
          severity: "Medium",
          color: "#d97706",
          message: `${latest.name || "Unnamed Athlete"}'s 3-day readiness average is trending above their 14-day average.`,
        });
      }

      if (sevenDayAvg !== null && fourteenDayAvg !== null && sevenDayAvg > fourteenDayAvg + 0.15) {
        notifications.push({
          ...baseNotification,
          type: "Weekly Strain",
          severity: "Medium",
          color: "#d97706",
          message: `${latest.name || "Unnamed Athlete"}'s 7-day readiness average is trending above their 14-day baseline.`,
        });
      }

      if (rpeDifference >= 2) {
        notifications.push({
          ...baseNotification,
          type: "RPE Spike",
          severity: "Medium",
          color: "#d97706",
          message: `${latest.name || "Unnamed Athlete"}'s actual RPE was ${rpeDifference.toFixed(1)} higher than planned.`,
        });
      }

      if (avgSleepQuality !== null && avgSleepQuality <= 5) {
        notifications.push({
          ...baseNotification,
          type: "Sleep Trend",
          severity: "Low",
          color: "#2563eb",
          message: `${latest.name || "Unnamed Athlete"}'s recent sleep quality is averaging ${avgSleepQuality.toFixed(1)}/10.`,
        });
      }
    });

    const severityOrder = {
      High: 0,
      Medium: 1,
      Low: 2,
    };

    return notifications.sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity]);
  };

  const coachTrendNotifications = getCoachTrendNotifications();

  const getGroupScatterData = () => {
    const grouped = {};

    athleteLogs.forEach((log) => {
      const group = normalizeEventGroupLabel(log.eventGroup || "Unassigned");
      if (!grouped[group]) grouped[group] = [];
      grouped[group].push(log);
    });

    return Object.entries(grouped)
      .sort(([groupA], [groupB]) => groupA.localeCompare(groupB))
      .map(([group, logs], index) => {
        const latest = sortLogsNewestFirst(logs).slice(0, 12);
        const valid = latest.filter(
          (log) =>
            Number.isFinite(Number(log.stress)) &&
            Number.isFinite(Number(log.sleepQuality)) &&
            Number.isFinite(Number(log.readinessRatio))
        );

        if (valid.length === 0) return null;

        const avgStress =
          valid.reduce((sum, log) => sum + Number(log.stress || 0), 0) / valid.length;
        const avgSleep =
          valid.reduce((sum, log) => sum + Number(log.sleepQuality || 0), 0) / valid.length;
        const avgReadiness =
          valid.reduce((sum, log) => sum + Number(log.readinessRatio || 0), 0) / valid.length;

        return {
          label: normalizeEventGroupLabel(group),
          x: Number(avgStress.toFixed(1)),
          y: Number(avgSleep.toFixed(1)),
          readiness: Number(avgReadiness.toFixed(2)),
          color: getGroupColor(index),
        };
      })
      .filter(Boolean)
      .sort((a, b) => b.readiness - a.readiness);
  };

  const renderScatterPlot = ({ data, title, xLabel, yLabel, fallbackMessage }) => {
    if (!data || data.length === 0) {
      return (
        <div style={{ padding: 12, color: "#9ca8b8" }}>
          {fallbackMessage}
        </div>
      );
    }

    const isCompact = isMobile;
    const width = isCompact ? 560 : 680;
    const height = isCompact ? 240 : 280;
    const padding = isCompact ? { top: 20, right: 16, bottom: 44, left: 62 } : { top: 26, right: 20, bottom: 54, left: 74 };
    const xValues = data.map((point) => point.x);
    const yValues = data.map((point) => point.y);
    const xMin = Math.min(0, ...xValues);
    const xMax = Math.max(10, ...xValues);
    const yMin = Math.min(0, ...yValues);
    const yMax = Math.max(10, ...yValues);
    const xRange = xMax - xMin || 1;
    const yRange = yMax - yMin || 1;

    const scaleX = (value) =>
      padding.left + ((value - xMin) / xRange) * (width - padding.left - padding.right);
    const scaleY = (value) =>
      height - padding.bottom - ((value - yMin) / yRange) * (height - padding.top - padding.bottom);

    return (
      <div style={{ marginTop: 12 }}>
        <div style={{ background: "rgba(15, 23, 42, 0.35)", borderRadius: 14, padding: 8 }}>
          <svg width="100%" viewBox={`0 0 ${width} ${height}`} style={{ display: "block", maxHeight: 300 }}>
            {[0, 2.5, 5, 7.5, 10].map((tick) => {
              const x = scaleX(tick);
              const y = scaleY(tick);
              return (
                <g key={`axis-${tick}`}>
                  <line x1={x} y1={padding.top} x2={x} y2={height - padding.bottom} stroke="rgba(148,163,184,0.18)" strokeDasharray="4 4" />
                  <line x1={padding.left} y1={y} x2={width - padding.right} y2={y} stroke="rgba(148,163,184,0.18)" strokeDasharray="4 4" />
                  <text x={x} y={height - 22} textAnchor="middle" fill="#9ca8b8" fontSize={isCompact ? 9 : 10}>{tick.toFixed(1)}</text>
                  <text x={padding.left - 12} y={y + 4} textAnchor="end" fill="#9ca8b8" fontSize={isCompact ? 9 : 10}>{tick.toFixed(1)}</text>
                </g>
              );
            })}

            <line x1={padding.left} y1={height - padding.bottom} x2={width - padding.right} y2={height - padding.bottom} stroke="#94a3b8" />
            <line x1={padding.left} y1={padding.top} x2={padding.left} y2={height - padding.bottom} stroke="#94a3b8" />

            {data.map((point, index) => (
              <g key={`${point.label}-${index}`}>
                <circle
                  cx={scaleX(point.x)}
                  cy={scaleY(point.y)}
                  r={7 + point.readiness / 2}
                  fill={point.color}
                  opacity={0.9}
                  stroke="rgba(255,255,255,0.8)"
                  strokeWidth={1}
                />
              </g>
            ))}

            <text x={width / 2} y={height - 8} textAnchor="middle" fill="#9ca8b8" fontSize={isCompact ? 10 : 11}>
              {xLabel}
            </text>
            <text x={28} y={height / 2} transform={`rotate(-90 28 ${height / 2})`} fill="#9ca8b8" fontSize={isCompact ? 10 : 11}>
              {yLabel}
            </text>
          </svg>
        </div>
      </div>
    );
  };

  const getGroupReadinessTrendData = () => {
    const grouped = {};

    athleteLogs.forEach((log) => {
      const group = normalizeEventGroupLabel(log.eventGroup || "Unassigned");
      if (!grouped[group]) grouped[group] = [];
      grouped[group].push(log);
    });

    return Object.entries(grouped)
      .sort(([groupA], [groupB]) => groupA.localeCompare(groupB))
      .map(([group, logs], index) => {
        const ordered = sortLogsNewestFirst(logs).slice(0, 8).reverse();
        const points = ordered
          .map((log) => ({
            label: (log.sessionDate || "").slice(5) || "n/a",
            value: Number(log.readinessRatio || 0),
          }))
          .filter((point) => Number.isFinite(point.value));

        return {
          label: normalizeEventGroupLabel(group),
          points,
          color: getGroupColor(index),
        };
      })
      .filter((entry) => entry.points.length > 0);
  };

  const renderLineChart = ({ data, title, fallbackMessage }) => {
    if (!data || data.length === 0) {
      return <div style={{ padding: 12, color: "#9ca8b8" }}>{fallbackMessage}</div>;
    }

    const isCompact = isMobile;
    const width = isCompact ? 560 : 680;
    const height = isCompact ? 230 : 270;
    const padding = isCompact ? { top: 24, right: 24, bottom: 44, left: 62 } : { top: 32, right: 30, bottom: 52, left: 74 };
    const allValues = data.flatMap((series) => series.points.map((point) => point.value));
    const minY = Math.min(0, ...allValues);
    const maxY = Math.max(2.2, ...allValues);
    const range = maxY - minY || 1;

    const scaleX = (index, total) =>
      padding.left + (index / Math.max(total - 1, 1)) * (width - padding.left - padding.right);
    const scaleY = (value) =>
      height - padding.bottom - ((value - minY) / range) * (height - padding.top - padding.bottom);

    return (
      <div style={{ marginTop: 12 }}>
        <div style={{ background: "rgba(15, 23, 42, 0.35)", borderRadius: 14, padding: 8 }}>
          <svg width="100%" viewBox={`0 0 ${width} ${height}`} style={{ display: "block", maxHeight: 300 }}>
            {[0, 0.5, 1, 1.5, 2].map((tick) => {
              const y = scaleY(tick);
              return (
                <g key={`line-axis-${tick}`}>
                  <line x1={padding.left} y1={y} x2={width - padding.right} y2={y} stroke="rgba(148,163,184,0.18)" strokeDasharray="4 4" />
                  <text x={padding.left - 12} y={y + 4} textAnchor="end" fill="#9ca8b8" fontSize="10">{tick.toFixed(1)}</text>
                </g>
              );
            })}

            <line x1={padding.left} y1={height - padding.bottom} x2={width - padding.right} y2={height - padding.bottom} stroke="#94a3b8" />
            <line x1={padding.left} y1={padding.top} x2={padding.left} y2={height - padding.bottom} stroke="#94a3b8" />

            {data.map((series) => (
              <g key={series.label}>
                <path
                  d={series.points
                    .map((point, index) => `${index === 0 ? "M" : "L"}${scaleX(index, series.points.length)},${scaleY(point.value)}`)
                    .join(" ")}
                  fill="none"
                  stroke={series.color}
                  strokeWidth="2.8"
                  strokeLinejoin="round"
                  strokeLinecap="round"
                />
                {series.points.map((point, index) => (
                  <g key={`${series.label}-${point.label}-${index}`}>
                    <circle cx={scaleX(index, series.points.length)} cy={scaleY(point.value)} r={4.5} fill={series.color} stroke="#fff" strokeWidth="1" />
                  </g>
                ))}
              </g>
            ))}

            {data.some((series) => series.points.length > 0) && (
              <g>
                <text x={width / 2} y={height - 28} textAnchor="middle" fill="#9ca8b8" fontSize={isCompact ? 10 : 11}>Recent sessions</text>
                {data.flatMap((series) =>
                  series.points.map((point, index) => (
                    <text
                      key={`${series.label}-${point.label}-${index}`}
                      x={scaleX(index, series.points.length)}
                      y={height - 10}
                      textAnchor="middle"
                      fill="#9ca8b8"
                      fontSize={isCompact ? 8 : 9}
                    >
                      {point.label}
                    </text>
                  ))
                )}
              </g>
            )}

            <text x={28} y={height / 2} transform={`rotate(-90 28 ${height / 2})`} fill="#9ca8b8" fontSize={isCompact ? 10 : 11}>Readiness</text>
          </svg>
        </div>
      </div>
    );
  };

  const groupScatterData = getGroupScatterData();
  const groupReadinessTrendData = getGroupReadinessTrendData();

  if (loading) return <p style={{ padding: 20 }}>Loading...</p>;

  const renderEnvelopeIcon = () => (
    <svg
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="M3 7l9 6 9-6" />
    </svg>
  );

  const renderFilters = () => (
    <div className={styles.dashboardCard}>
      <h3 className={styles.dashboardHeadingReset}>Filters</h3>

      <input
        className={styles.dashboardInput}
        placeholder="Search athlete name"
        value={filterName}
        onChange={(e) => setFilterName(e.target.value)}
      />

      <select
        className={styles.dashboardFilterInput}
        style={{ width: isMobile ? "100%" : undefined }}
        value={filterEventGroup}
        onChange={(e) => setFilterEventGroup(e.target.value)}
      >
        {eventGroupOptions.map((group) => (
          <option key={group} value={group}>
            {group}
          </option>
        ))}
      </select>

      <select
        className={styles.dashboardFilterInput}
        style={{ width: isMobile ? "100%" : undefined }}
        value={filterAlertStatus}
        onChange={(e) => setFilterAlertStatus(e.target.value)}
      >
        <option value="All">All Logs</option>
        <option value="Alerts Only">Alerts Only</option>
        <option value="No Alerts">No Alerts</option>
      </select>

      <button onClick={handleClearFilters} className={styles.dashboardButtonSecondary}>
        Clear Filters
      </button>
    </div>
  );

  const renderCoachNoteBox = (log) => (
    <div style={{ marginTop: 12 }}>
      <p>
        <strong>Message to Athlete:</strong>
      </p>

      <textarea
        className={styles.dashboardTextarea}
        placeholder="Send a message or feedback to this athlete..."
        value={coachNotes[log.id] || ""}
        onChange={(e) =>
          setCoachNotes({
            ...coachNotes,
            [log.id]: e.target.value,
          })
        }
      />

      <button
        onClick={() => handleSendMessage(log.id)}
        className={styles.dashboardButtonAccent}
      >
        Send Message
      </button>
    </div>
  );
    const renderAthleteLogCard = (log, showDelete = true) => {
      const safeReadinessRatio = getSafeReadinessRatio(log.readinessRatio);
      const trend = getReadinessTrend(getAthleteLogsForTrend(log), 3);
      const readinessColor = getReadinessColor(safeReadinessRatio);
      const readinessStatus =
        log.readinessStatus || getReadinessStatus(safeReadinessRatio);

      const rpeDifference =
        Number(log.actualRPE || 0) - Number(log.plannedRPE || 0);

      const rpeAdjustment = rpeDifference * 0.2;

      return (
        <div
          key={log.id}
          style={{
            border: `2px solid ${readinessColor}`,
            borderRadius: 14,
            padding: 14,
            marginBottom: 14,
            background: "rgba(255,255,255,0.02)",
          }}
        >
          <p className={styles.dashboardHeadingReset}>
            <span style={badgeStyle(readinessColor)}>{readinessStatus}</span>
          </p>

          <p>
            <strong>{log.name || "Unnamed Athlete"}</strong>
          </p>

          <p>Event Group: {log.eventGroup || "N/A"}</p>
          <p>Session: {log.sessionType || "N/A"}</p>
          <p>Session Date: {log.sessionDate || "N/A"}</p>

          <p style={{ color: readinessColor }}>
            Readiness Ratio: <strong>{Number.isFinite(safeReadinessRatio) ? safeReadinessRatio.toFixed(2) : "N/A"}</strong>
          </p>

          <p>Readiness Model:</p>

          <div className={styles.smallCard}>

            <p style={{ margin: "0 0 6px", fontWeight: "bold" }}>
              Athlete Variability Model
            </p>
            <p style={{ margin: "0 0 4px" }}>Daily Readiness: {log.phi ?? "N/A"}</p>
            <p style={{ margin: "0 0 4px" }}>Athlete Variability: {log.athV ?? "N/A"}</p>
            <p style={{ margin: "0 0 4px" }}>3-Day Avg: {log.athV3DayAvg ?? "N/A"}</p>
            <p style={{ margin: "0 0 4px" }}>7-Day Avg: {log.athV7DayAvg ?? "N/A"}</p>
            <p style={{ margin: "0 0 4px" }}>14-Day Avg: {log.athV14DayAvg ?? "N/A"}</p>
            <p style={{ margin: 0 }}>21-Day Avg: {log.athV21DayAvg ?? "N/A"}</p>
          </div>

          <p style={{ color: trend.color }}>
            Trend: <strong>{trend.symbol} {trend.label}</strong>
          </p>

          <p style={{ color: readinessColor, fontWeight: "bold" }}>
            {getReadinessRecommendation(safeReadinessRatio, log.shouldTrainToday)}
          </p>

          <p>Should Train Today: {log.shouldTrainToday || "N/A"}</p>
          <p>
            Yesterday&apos;s Workout Completed:{" "}
            <strong
              style={{
                color:
                  log.workoutCompleted === "No"
                    ? "#dc2626"
                    : log.workoutCompleted === "Modified"
                    ? "#d97706"
                    : log.workoutCompleted === "Yes"
                    ? "#16a34a"
                    : "#111827",
              }}
            >
              {log.workoutCompleted || "N/A"}
            </strong>
          </p>
          <p>Planned RPE: {log.plannedRPE || "N/A"}</p>
          <p>Yesterday’s RPE: {log.actualRPE || "N/A"}</p>
          <p>RPE Difference: {rpeDifference.toFixed(1)}</p>
          <p>RPE Adjustment: {rpeAdjustment.toFixed(2)}</p>
          <p style={{ whiteSpace: "pre-wrap" }}>
            Athlete Notes: {log.notes || "None"}
          </p>

          {/* Removed Adjusted Load, Compounded Load, and 14-Day Avg Load blocks */}

          {renderCoachNoteBox(log)}

          {log.coachNote && (
            <div className={styles.smallCard}>

              <p style={{ margin: "0 0 6px", color: "#d1d5db" }}>
                <strong>Last message:</strong> {log.coachNote}
              </p>

              <p style={{ margin: "0 0 6px", color: "#9ca8b8", fontSize: 13 }}>
                Sent: {formatTimestamp(log.coachNoteUpdatedAt)}
              </p>

              <span
                style={{
                  display: "inline-block",
                  background: log.coachMessageRead === false ? "#dc2626" : "#16a34a",
                  color: "white",
                  borderRadius: 999,
                  padding: "3px 8px",
                  fontSize: 11,
                  fontWeight: "bold",
                }}
              >
                {log.coachMessageRead === false ? "Unread" : "Read"}
              </span>
            </div>
          )}

          {showDelete && (
            <button
              onClick={() => handleDeleteAthleteLog(log.id)}
              className={styles.dashboardButtonDanger}
            >
              Delete Log
            </button>
          )}
        </div>
      );
    };

  const renderMailboxPanel = () => (
    <>
      <div
        className={styles.dashboardModalOverlay}
        style={{ display: mailboxOpen ? "block" : "none" }}
        onClick={handleCloseMailbox}
      />

      <aside
        className={styles.dashboardDrawerPanel}
        style={{ right: mailboxOpen ? 0 : isMobile ? "-100%" : -420 }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: 16,
          }}
        >
          <div>
            <h2 className={styles.dashboardHeadingReset}>Mailbox</h2>
            <p className={styles.dashboardSubtitle}>
              {unreadMailboxNewestFirst.length} unread notification
              {unreadMailboxNewestFirst.length === 1 ? "" : "s"}
            </p>
          </div>

          <button
            onClick={handleCloseMailbox}
            className={styles.dashboardCloseButton}
          >
            ×
          </button>
        </div>

        {unreadMailboxNewestFirst.length > 0 && (
          <button
            onClick={markAllMailboxRead}
            className={`${styles.dashboardButtonSecondary} ${styles.dashboardButtonFullWidth}`}
          >
            Mark All Read
          </button>
        )}

        {unreadMailboxNewestFirst.length === 0 ? (
          <div className={styles.smallCard}>

            <p style={{ margin: 0, fontWeight: "bold" }}>All caught up.</p>
            <p style={{ margin: "6px 0 0", color: "#6b7280" }}>
              No unread notifications.
            </p>
          </div>
        ) : (
          unreadMailboxNewestFirst.map((item) => (
            <div
              key={item.id}
              style={{
                border: "1px solid rgba(220, 38, 38, 0.3)",
                borderRadius: 16,
                padding: 16,
                marginBottom: 12,
                background: "rgba(220, 38, 38, 0.12)",
                boxShadow: "0 8px 20px rgba(0,0,0,0.25)",
              }}
            >
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  gap: 12,
                  alignItems: "flex-start",
                  marginBottom: 8,
                }}
              >
                <p style={{ margin: 0 }}>
                  <strong>{item.title}</strong>
                </p>

                <span
                  style={{
                    background: "#dc2626",
                    color: "white",
                    borderRadius: 999,
                    padding: "3px 8px",
                    fontSize: 11,
                    fontWeight: "bold",
                    whiteSpace: "nowrap",
                  }}
                >
                  New
                </span>
              </div>

              <p style={{ color: "#d1d5db", marginTop: 0 }}>{item.message}</p>

              <div
                style={{
                  background: "rgba(255,255,255,0.05)",
                  border: "1px solid rgba(220, 38, 38, 0.18)",
                  borderRadius: 12,
                  padding: 12,
                  marginTop: 10,
                }}
              >
                <p style={{ margin: "0 0 6px" }}>
                  <strong>Event Group:</strong> {item.log.eventGroup || "N/A"}
                </p>
                <p style={{ margin: "0 0 6px" }}>
                  <strong>Session:</strong> {item.log.sessionType || "N/A"}
                </p>
                <p style={{ margin: "0 0 6px" }}>
                  <strong>Session Date:</strong> {item.log.sessionDate || "N/A"}
                </p>
                <p style={{ margin: "0 0 6px" }}>
                  <strong>Should Train Today:</strong>{" "}
                  {item.log.shouldTrainToday || "N/A"}
                </p>
                <p style={{ margin: "0 0 6px" }}>
                  <strong>Yesterday&apos;s Workout Completed:</strong>{" "}
                  {item.log.workoutCompleted || "N/A"}
                </p>
                <p style={{ margin: 0 }}>
                  <strong>Readiness Ratio:</strong>{" "}
                  {item.log.readinessRatio || "N/A"}
                </p>
              </div>

              <button
                onClick={() => {
                  markMailboxItemRead(item.id);
                  openLogsWithFilters({ name: item.athleteName, alertStatus: "Alerts Only" });
                  setMailboxOpen(false);
                }}
                className={`${styles.dashboardButton} ${styles.dashboardButtonFullWidth}`}
                style={{ marginTop: 10 }}
              >
                Open Alert
              </button>
            </div>
          ))
        )}
      </aside>
    </>
  );

  return (
  <div className={styles.dashboardPage}>
    
      {renderMailboxPanel()}

      {groupMessageOpen && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(17, 24, 39, 0.35)",
            zIndex: 70,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 16,
          }}
          onClick={() => setGroupMessageOpen(false)}
        >
          <div
            className={styles.dashboardModalContent}
            onClick={(e) => e.stopPropagation()}
            style={{ width: "100%", maxWidth: 520 }}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                gap: 12,
                alignItems: "center",
                marginBottom: 12,
              }}
            >
              <div>
                <h2 className={styles.dashboardHeadingReset}>Message Group</h2>
                <p className={styles.dashboardSubtitle}>
                  Send one message to the latest log for each athlete in this group.
                </p>
              </div>

              <button
                onClick={() => setGroupMessageOpen(false)}
                className={styles.dashboardCloseButton}
              >
                ×
              </button>
            </div>

            <div className={styles.smallCard}>

              <p style={{ margin: "0 0 6px", fontWeight: "bold" }}>
                Group: {selectedGroupForMessage || "None selected"}
              </p>
              <p style={{ margin: 0, color: "#6b7280", fontSize: 13 }}>
                This message will send to <strong>{getGroupMessageRecipients().length}</strong>{" "}
                athlete{getGroupMessageRecipients().length === 1 ? "" : "s"}.
              </p>
            </div>

            <textarea
              className={styles.dashboardTextarea}
              style={{ minHeight: 120 }}
              placeholder="Write a message to this group..."
              value={groupMessage}
              onChange={(e) => setGroupMessage(e.target.value)}
            />

            <div
              style={{
                display: "flex",
                gap: 8,
                flexDirection: isMobile ? "column" : "row",
              }}
            >
              <button onClick={handleSendGroupMessage} className={styles.dashboardButton}>
                Send Group Message
              </button>

              <button
                onClick={() => {
                  setGroupMessage("");
                  setSelectedGroupForMessage("");
                  setGroupMessageOpen(false);
                }}
                className={styles.dashboardButtonSecondary}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {statusMessage && (
        <div
          style={{
            position: "fixed",
            top: 16,
            left: "50%",
            transform: "translateX(-50%)",
            background: "#111827",
            color: "white",
            padding: "10px 14px",
            borderRadius: 999,
            zIndex: 100,
            boxShadow: "0 4px 12px rgba(0,0,0,0.18)",
            fontSize: 14,
            maxWidth: "90%",
            textAlign: "center",
          }}
        >
          {statusMessage}
        </div>
      )}

      <div style={{ maxWidth: 1000, margin: "0 auto", width: "100%", marginBottom: isMobile ? 12 : 20, padding: isMobile ? "0 10px" : 0 }}>
        <div
          style={{
            display: "flex",
            flexDirection: isMobile ? "column" : "row",
            justifyContent: "space-between",
            gap: isMobile ? 10 : 16,
            alignItems: isMobile ? "stretch" : "flex-start",
          }}
        >
          <div style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
            <div style={{ position: "relative" }}>
              <button
                type="button"
                onClick={() => setCoachMenuOpen((current) => !current)}
                style={{
                  border: "1px solid rgba(148,163,184,0.2)",
                  borderRadius: 12,
                  background: "rgba(15,23,42,0.75)",
                  color: "#f8fafc",
                  cursor: "pointer",
                  width: 44,
                  height: 44,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: 24,
                  boxShadow: "0 1px 3px rgba(0,0,0,0.08)",
                }}
                aria-label="Open coach menu"
              >
                ☰
              </button>

              {coachMenuOpen && (
                <div
                  style={{
                    position: "absolute",
                    top: 52,
                    left: 0,
                    background: "rgba(7, 17, 31, 0.98)",
                    border: "1px solid rgba(148,163,184,0.22)",
                    borderRadius: 14,
                    boxShadow: "0 10px 25px rgba(0,0,0,0.18)",
                    padding: 12,
                    zIndex: 40,
                    minWidth: 220,
                    display: "flex",
                    flexDirection: "column",
                    gap: 8,
                    marginTop: 12,
                  }}
                >
                  {[
                    { key: "overview", label: "Overview" },
                    { key: "planning", label: "Planning" },
                    { key: "averages", label: "Team Averages" },
                    { key: "logs", label: "Athlete Logs" },
                  ].map((item) => (
                    <button
                      key={item.key}
                      type="button"
                      onClick={() => {
                        setActiveTab(item.key);
                        setCoachMenuOpen(false);
                      }}
                      style={{
                        display: "block",
                        width: "100%",
                        textAlign: "left",
                        border: "1px solid rgba(148,163,184,0.12)",
                        borderRadius: 10,
                        padding: "12px 14px",
                        background: activeTab === item.key ? "rgba(47,124,255,0.22)" : "rgba(255,255,255,0.06)",
                        color: activeTab === item.key ? "#f8fafc" : "#e2e8f0",
                        cursor: "pointer",
                        marginBottom: 0,
                        fontWeight: activeTab === item.key ? 700 : 500,
                      }}
                    >
                      {item.label}
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div>
  <h1
    style={{
      margin: 0,
      color: "#f8fafc",
      fontSize: isMobile ? 24 : 30,
      fontWeight: 700,
    }}
  >
    Welcome, {coachProfile?.name || "Coach"}
  </h1>

  <p
    style={{
      marginTop: 0,
      marginBottom: 0,
      color: "#94a3b8",
      fontSize: 15,
      lineHeight: 1.2,
    }}
  >
    Team Code:{" "}
    <strong style={{ color: "#f8fafc" }}>
      {teamCode || "Loading..."}
    </strong>
  </p>
</div>
          </div>

          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: isMobile ? "space-between" : "flex-end",
              width: isMobile ? "100%" : undefined,
            }}
          >
            <button
              onClick={handleOpenMailbox}
              title="Mailbox"
              style={{
                position: "relative",
                border: "1px solid rgba(148,163,184,0.2)",
                background: "rgba(15,23,42,0.75)",
                borderRadius: 999,
                width: 58,
                height: 58,
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                marginRight: isMobile ? 0 : 8,
                boxShadow: "0 1px 4px rgba(0,0,0,0.12)",
                color: "#f8fafc",
              }}
            >
              {renderEnvelopeIcon()}

              {unreadMailboxNewestFirst.length > 0 && (
                <span
                  style={{
                    position: "absolute",
                    top: -7,
                    right: -7,
                    background: "#dc2626",
                    color: "white",
                    borderRadius: "999px",
                    padding: "2px 7px",
                    fontSize: 12,
                    fontWeight: "bold",
                    border: "2px solid white",
                  }}
                >
                  {unreadMailboxNewestFirst.length}
                </span>
              )}
            </button>

            <div
              style={{
                position: "relative",
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                marginRight: isMobile ? 0 : 8,
              }}
            >
              <div
                style={{
                  position: "absolute",
                  inset: "-4px",
                  borderRadius: 14,
                  background: "rgba(47, 124, 255, 0.22)",
                  filter: "blur(16px)",
                  zIndex: 0,
                }}
              />
              <button
                onClick={handleSignOut}
                style={{
                  position: "relative",
                  zIndex: 1,
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  padding: "11px 16px",
                  border: "1px solid rgba(148,163,184,0.2)",
                  borderRadius: 10,
                  background: "rgba(15,23,42,0.75)",
                  color: "#f8fafc",
                  cursor: "pointer",
                  minHeight: 44,
                  fontWeight: "700",
                  boxShadow: "0 1px 4px rgba(0,0,0,0.12)",
                }}
              >
                Sign Out
              </button>
            </div>
          </div>
        </div>


        {activeTab === "overview" && (
          <>
            <div className={styles.dashboardCard} style={{ marginTop: isMobile ? 18 : 32, padding: isMobile ? "14px" : undefined }}>
              <div
                style={{
                  display: "flex",
                  flexDirection: isMobile ? "column" : "row",
                  justifyContent: "space-between",
                  gap: isMobile ? 8 : 12,
                  alignItems: isMobile ? "flex-start" : "center",
                  marginBottom: isMobile ? 10 : 12,
                }}
              >
                <div>
                  <h2 className={styles.dashboardHeadingReset}>Today&apos;s Planned Sessions</h2>
                  <p className={styles.dashboardSubtitle}>
                    What is scheduled for today by group.
                  </p>
                </div>

                <span
                  style={{
                    background: todaysPlannedSessions.length > 0 ? "#2563eb" : "#6b7280",
                    color: "white",
                    borderRadius: 999,
                    padding: "4px 10px",
                    fontSize: 12,
                    fontWeight: "bold",
                    whiteSpace: "nowrap",
                  }}
                >
                  {todaysPlannedSessions.length}
                </span>
              </div>

              {todaysPlannedSessions.length === 0 ? (
                <p style={{ marginBottom: 0, color: "#6b7280" }}>
                  No planned sessions are scheduled for today.
                </p>
              ) : (
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: isMobile ? "1fr" : "repeat(3, 1fr)",
                    gap: isMobile ? 8 : 10,
                  }}
                >
                  {todaysPlannedSessions.map((session) => (
                    <div
  key={session.id}
  className={styles.smallCard}
>
                      <p style={{ margin: "0 0 6px", fontWeight: "bold" }}>
                        {session.sessionType || "Session"}
                      </p>
                      <p style={{ margin: "0 0 4px", color: "#6b7280", fontSize: 13 }}>
                        Group: <strong>{session.sessionGroup || "All"}</strong>
                      </p>
                      <p style={{ margin: "0 0 4px", color: "#6b7280", fontSize: 13 }}>
                        Planned RPE: <strong>{session.plannedRPE || "N/A"}</strong>
                      </p>
                      <p
                        style={{
                          margin: "8px 0 0",
                          color: "#374151",
                          fontSize: 13,
                          whiteSpace: "pre-wrap",
                        }}
                      >
                        {session.workoutNotes || "No notes added."}
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div
  className={styles.dashboardCard}
  style={{
    marginTop: 22,
    border:
      atRiskAthletes.length > 0 ||
      unreadMailboxNewestFirst.length > 0 ||
      dailySummary.needsCoachNoteCount > 0
        ? "2px solid #111827"
        : "1px solid rgba(255,255,255,0.12)",
  }}
>
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  gap: 12,
                  alignItems: "center",
                  marginBottom: 12,
                }}
              >
                <div>
                  <h2 className={styles.dashboardHeadingReset}>Today’s Action List</h2>
                  <p className={styles.dashboardSubtitle}>
                    What needs your attention right now.
                  </p>
                </div>

                <span
                  style={{
                    background:
                      atRiskAthletes.length > 0 ||
                      unreadMailboxNewestFirst.length > 0 ||
                      dailySummary.needsCoachNoteCount > 0
                        ? "#111827"
                        : "#16a34a",
                    color: "white",
                    borderRadius: 999,
                    padding: "4px 10px",
                    fontSize: 12,
                    fontWeight: "bold",
                    whiteSpace: "nowrap",
                  }}
                >
                  {atRiskAthletes.length + unreadMailboxNewestFirst.length + dailySummary.needsCoachNoteCount}
                </span>
              </div>

              <div style={{ display: "grid", gap: 22, marginTop: 16 }}>
                <div
                  style={{
                    border: "1px solid rgba(148,163,184,0.18)",
                    borderRadius: 16,
                    padding: 14,
                    background:
                      atRiskAthletes.length > 0
                        ? "rgba(127,29,29,0.25)"
                        : "rgba(15,23,42,0.65)",
                    color: "#f8fafc",
                    boxShadow: "0 10px 30px rgba(0,0,0,0.25)",
                    backdropFilter: "blur(12px)",
                  }}
                >
                  <p className={styles.dashboardSmallMuted}>
                    At-Risk Athletes
                  </p>
                  <p
                    style={{
                      margin: "6px 0 8px",
                      fontSize: 24,
                      fontWeight: "bold",
                      color: atRiskAthletes.length > 0 ? "#dc2626" : "#111827",
                    }}
                  >
                    {atRiskAthletes.length}
                  </p>
                  <button
                    onClick={() => openLogsWithFilters({ alertStatus: "Alerts Only" })}
                    className={`${styles.dashboardButtonSecondary} ${styles.dashboardButtonFullWidth}`}
                  >
                    Review Alerts
                  </button>
                </div>

                <div
                  style={{
                    border: "1px solid rgba(148,163,184,0.18)",
                    borderRadius: 12,
                    padding: 12,
                    background:
                      unreadMailboxNewestFirst.length > 0
                        ? "rgba(255,255,255,0.04)"
                        : "rgba(255,255,255,0.02)",
                  }}
                >
                  <p className={styles.dashboardSmallMuted}>
                    Unread Mailbox
                  </p>
                  <p
                    style={{
                      margin: "6px 0 8px",
                      fontSize: 24,
                      fontWeight: "bold",
                      color:
                        unreadMailboxNewestFirst.length > 0 ? "#dc2626" : "#111827",
                    }}
                  >
                    {unreadMailboxNewestFirst.length}
                  </p>
                  <button
                    onClick={handleOpenMailbox}
                    className={`${styles.dashboardButtonSecondary} ${styles.dashboardButtonFullWidth}`}
                  >
                    Open Mailbox
                  </button>
                </div>

                <div
                  style={{
                    border: "1px solid rgba(148,163,184,0.18)",
                    borderRadius: 12,
                    padding: 12,
                    background:
                      dailySummary.needsCoachNoteCount > 0
                        ? "rgba(245, 224, 209, 0.18)"
                        : "rgba(255,255,255,0.02)",
                  }}
                >
                  <p className={styles.dashboardSmallMuted}>
                    Coach Notes Needed
                  </p>
                  <p
                    style={{
                      margin: "6px 0 8px",
                      fontSize: 24,
                      fontWeight: "bold",
                      color:
                        dailySummary.needsCoachNoteCount > 0 ? "#ea580c" : "#f8fafc",
                    }}
                  >
                    {dailySummary.needsCoachNoteCount}
                  </p>
                  <button
                    onClick={() => openLogsWithFilters()}
                    className={`${styles.dashboardButtonSecondary} ${styles.dashboardButtonFullWidth}`}
                  >
                    Add Notes
                  </button>
                </div>
                </div>

              <div
                style={{
                  className: styles.coachCard,
                  boxSizing: "border-box",
                  marginTop: 24,
                  display: "flex",
                  justifyContent: "space-between",
                  gap: 12,
                  alignItems: "center",
                  marginBottom: 8,
                }}
              >
                <h2 style={{ margin: 0 }}>Daily Summary</h2>

                <span
                  style={{
                    background: dailySummary.noOrUnsureCount > 0 ? "#dc2626" : "#16a34a",
                    color: "white",
                    borderRadius: 999,
                    padding: "4px 10px",
                    fontSize: 12,
                    fontWeight: "bold",
                  }}
                >
                  Today
                </span>
              </div>

              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: isMobile ? "1fr" : "repeat(4, 1fr)",
                  gap: 10,
                  marginTop: 12,
                }}
              >
                <div className={styles.dashboardSummaryCard}>
                  <p className={styles.dashboardSmallMuted}>Logged Today</p>
                  <p style={{ margin: "6px 0 0", fontSize: 22, fontWeight: "bold" }}>
                    {dailySummary.loggedTodayCount}
                  </p>
                </div>

                <div
                  className={styles.dashboardSummaryCard}
                  style={{
                    background: dailySummary.noOrUnsureCount > 0 ? "rgba(255,255,255,0.05)" : undefined,
                  }}
                >
                  <p className={styles.dashboardSmallMuted}>No / Unsure</p>
                  <p style={{ margin: "6px 0 0", fontSize: 22, fontWeight: "bold" }}>
                    {dailySummary.noOrUnsureCount}
                  </p>
                </div>

                <div className={styles.dashboardSummaryCard}>
                  <p className={styles.dashboardSmallMuted}>Highest Risk</p>
                  <p style={{ margin: "6px 0 0", fontWeight: "bold" }}>
                    {dailySummary.highestRiskLog?.name || "N/A"}
                  </p>
                  <p style={{ margin: "4px 0 0", fontSize: 12, color: "#9ca8b8" }}>
                    Ratio: {dailySummary.highestRiskLog?.readinessRatio || "N/A"}
                  </p>
                </div>

                <div
                  className={styles.dashboardSummaryCard}
                  style={{
                    background: dailySummary.needsCoachNoteCount > 0 ? "rgba(251,146,60,0.12)" : undefined,
                  }}
                >
                  <p className={styles.dashboardSmallMuted}>
                    Coach Notes Needed
                  </p>
                  <p style={{ margin: "6px 0 0", fontSize: 22, fontWeight: "bold" }}>
                    {dailySummary.needsCoachNoteCount}
                  </p>
                </div>

                <button
                  type="button"
                  onClick={() => setShowMissedWorkoutList((current) => !current)}
                  style={{
                    textAlign: "left",
                    border: "1px solid rgba(255,255,255,0.18)",
                    borderRadius: 12,
                    padding: 12,
                    background: dailySummary.missedWorkoutsThisWeek > 0 ? "rgba(255,255,255,0.05)" : "rgba(255,255,255,0.04)",
                    cursor: "pointer",
                    fontFamily: "inherit",
                    color: "#f8fafc",
                  }}
                >
                  <p className={styles.dashboardSmallMuted}>
                    Missed This Week
                  </p>
                  <p
                    style={{
                      margin: "6px 0 0",
                      fontSize: 22,
                      fontWeight: "bold",
                      color: dailySummary.missedWorkoutsThisWeek > 0 ? "#dc2626" : "#111827",
                    }}
                  >
                    {dailySummary.missedWorkoutsThisWeek}
                  </p>
                  <p style={{ margin: "6px 0 0", fontSize: 12, color: "#6b7280" }}>
                    {showMissedWorkoutList ? "Hide list" : "View names"}
                  </p>
                </button>

                <div
                  className={styles.dashboardSummaryCard}
                  style={{
                    background: dailySummary.modifiedWorkoutsThisWeek > 0 ? "rgba(249,115,22,0.12)" : undefined,
                  }}
                >
                  <p className={styles.dashboardSmallMuted}>
                    Modified This Week
                  </p>
                  <p
                    style={{
                      margin: "6px 0 0",
                      fontSize: 22,
                      fontWeight: "bold",
                      color: dailySummary.modifiedWorkoutsThisWeek > 0 ? "#f59e0b" : "#f8fafc",
                    }}
                  >
                    {dailySummary.modifiedWorkoutsThisWeek}
                  </p>
                </div>

                <div
                  className={styles.dashboardSummaryCard}
                  style={{
                    background: dailySummary.completedWorkoutsThisWeek > 0 ? "rgba(52,211,153,0.18)" : undefined,
                  }}
                >
                  <p className={styles.dashboardSmallMuted}>
                    Completed This Week
                  </p>
                  <p
                    style={{
                      margin: "6px 0 0",
                      fontSize: 22,
                      fontWeight: "bold",
                      color: dailySummary.completedWorkoutsThisWeek > 0 ? "#22c55e" : "#f8fafc",
                    }}
                  >
                    {dailySummary.completedWorkoutsThisWeek}
                  </p>
                </div>
              </div>
            </div>

            {showMissedWorkoutList && (
              <div
                style={{
                  borderTop: "1px solid rgba(255,255,255,0.12)",
                  marginTop: 14,
                  paddingTop: 14,
                }}
              >
                <h3 style={{ margin: "0 0 10px" }}>Missed Workouts This Week</h3>

                {missedWorkoutAthletesThisWeek.length === 0 ? (
                  <p style={{ margin: 0, color: "#6b7280" }}>
                    No missed workouts this week.
                  </p>
                ) : (
                  missedWorkoutAthletesThisWeek.map((athlete) => (
                    <div
                      key={`${athlete.name}-${athlete.eventGroup}`}
                      style={{
                        border: "1px solid rgba(220, 38, 38, 0.3)",
                        borderRadius: 12,
                        padding: 12,
                        marginBottom: 8,
                        background: "rgba(220, 38, 38, 0.12)",
                      }}
                    >
                      <p style={{ margin: "0 0 4px", fontWeight: "bold" }}>
                        {athlete.name}
                      </p>
                      <p style={{ margin: "0 0 4px", color: "#9ca8b8", fontSize: 13 }}>
                        {athlete.eventGroup}
                      </p>
                      <p style={{ margin: 0, color: "#dc2626", fontWeight: "bold" }}>
                        Missed {athlete.count} time{athlete.count === 1 ? "" : "s"}
                      </p>
                    </div>
                  ))
                )}
              </div>
            )}

            <div className={styles.dashboardCard} style={{ marginTop: 18 }}>
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  gap: 12,
                  alignItems: "flex-start",
                  marginBottom: 12,
                }}
              >
                <div>
                  <h2 className={styles.dashboardHeadingReset}>Group Readiness Overview</h2>
                  <p className={styles.dashboardSubtitle}>
                    Stress, recovery, and recent trend movement by group.
                  </p>
                </div>
                <div style={{ borderLeft: "1px solid rgba(148,163,184,0.18)", paddingLeft: 12, minWidth: 180 }}>
                  <p style={{ margin: "0 0 6px", fontSize: 11, fontWeight: 700, color: "#cbd5e1", textTransform: "uppercase", letterSpacing: "0.08em" }}>
                    Group colors
                  </p>
                  <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                    {groupScatterData.map((item) => (
                      <div key={item.label} style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                        <span
                          style={{
                            width: 10,
                            height: 10,
                            borderRadius: "50%",
                            background: item.color,
                            border: "1px solid rgba(255,255,255,0.4)",
                            flexShrink: 0,
                          }}
                        />
                        <span style={{ color: "#f8fafc", fontSize: 12, fontWeight: 600 }}>{item.label}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              {renderScatterPlot({
                data: groupScatterData,
                title: "",
                xLabel: "Stress score",
                yLabel: "Sleep score",
                fallbackMessage: "No group readiness data available yet.",
              })}

              {renderLineChart({
                data: groupReadinessTrendData,
                title: "",
                fallbackMessage: "No readiness trend data available for groups yet.",
              })}
            </div>

            <div className={styles.dashboardCard} style={{ marginTop: 18 }}>
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  gap: 12,
                  alignItems: "center",
                  marginBottom: 12,
                }}
              >
                <div>
                  <h2 className={styles.dashboardHeadingReset}>Trend Tracking & Notifications</h2>
                  <p className={styles.dashboardSubtitle}>
                    Automatic coach alerts based on recent athlete logs.
                  </p>
                </div>

                <span
                  style={{
                    background: coachTrendNotifications.length > 0 ? "#111827" : "#16a34a",
                    color: "white",
                    borderRadius: 999,
                    padding: "4px 10px",
                    fontSize: 12,
                    fontWeight: "bold",
                    whiteSpace: "nowrap",
                  }}
                >
                  {coachTrendNotifications.length}
                </span>
              </div>

              {coachTrendNotifications.length === 0 ? (
                <p style={{ marginBottom: 0, color: "#6b7280" }}>
                  No trend notifications right now.
                </p>
              ) : (
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: isMobile ? "1fr" : "repeat(2, 1fr)",
                    gap: isMobile ? 8 : 10,
                  }}
                >
                  {coachTrendNotifications.slice(0, 8).map((item, index) => (
                    <div
                      key={`${item.athleteName}-${item.type}-${index}`}
                      onClick={() => openLogsWithFilters({ name: item.athleteName })}
                      role="button"
                      tabIndex={0}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          openLogsWithFilters({ name: item.athleteName });
                        }
                      }}
                      style={{
                        border: `1px solid ${item.color}`,
                        borderRadius: 12,
                        padding: 12,
                        background:
                          item.severity === "High"
                            ? "rgba(220,38,38,0.12)"
                            : item.severity === "Medium"
                            ? "rgba(249,115,22,0.12)"
                            : "rgba(14,165,233,0.12)",
                        cursor: "pointer",
                      }}
                    >
                      <div
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          gap: 8,
                          alignItems: "flex-start",
                          marginBottom: 6,
                        }}
                      >
                        <p style={{ margin: 0, fontWeight: "bold" }}>
                          {item.athleteName}
                        </p>
                        <span
                          style={{
                            background: item.color,
                            color: "white",
                            borderRadius: 999,
                            padding: "3px 8px",
                            fontSize: 11,
                            fontWeight: "bold",
                            whiteSpace: "nowrap",
                          }}
                        >
                          {item.severity}
                        </span>
                      </div>

                      <p style={{ margin: "0 0 4px", color: "#9ca8b8", fontSize: 13 }}>
                        {item.type} • {item.eventGroup}
                      </p>

                      <p style={{ margin: 0, color: "#d1d5db", fontSize: 13 }}>
                        {item.message}
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </>
        )}

        {activeTab === "planning" && (
  <>
    <div className={styles.dashboardCard} style={{ marginTop: isMobile ? 18 : 32, padding: isMobile ? "14px" : undefined }}>
      <h2 className={styles.dashboardHeadingReset}>Plan Session</h2>
      <p className={styles.dashboardSubtitle}>
        Create and manage planned sessions for your athletes.
      </p>

      <input
        className={styles.dashboardInput}
        placeholder="Session type"
        value={sessionType}
        onChange={(e) => setSessionType(e.target.value)}
      />

      <select
        className={styles.dashboardInput}
        value={sessionGroup}
        onChange={(e) => setSessionGroup(e.target.value)}
      >
        <option value="All">All</option>
        {eventGroupOrder.map((group) => (
          <option key={group} value={group}>
            {group}
          </option>
        ))}
      </select>

      <input
        className={styles.dashboardInput}
        type="date"
        value={sessionDate}
        onChange={(e) => setSessionDate(e.target.value)}
      />

      <input
        className={styles.dashboardInput}
        type="number"
        min="1"
        max="10"
        placeholder="Planned RPE"
        value={plannedRPE}
        onChange={(e) => setPlannedRPE(e.target.value)}
      />

      <textarea
        className={styles.dashboardTextarea}
        placeholder="Workout notes"
        value={workoutNotes}
        onChange={(e) => setWorkoutNotes(e.target.value)}
      />

      <button onClick={handleSavePlannedSession} className={styles.dashboardButton}>
        {editingSessionId ? "Update Session" : "Save Session"}
      </button>

      {editingSessionId && (
        <button onClick={handleCancelEdit} className={styles.dashboardButtonSecondary}>
          Cancel Edit
        </button>
      )}
    </div>

<div className={styles.dashboardCard} style={{ marginTop: 16, padding: isMobile ? "14px" : undefined }}>
      <h2 className={styles.dashboardHeadingReset}>Planned Sessions</h2>

      {plannedSessions.length === 0 ? (
        <p>No planned sessions yet.</p>
      ) : (
        plannedSessions.map((session) => (
          <div
            key={session.id}
            className={styles.smallCard}
            style={{ marginBottom: 10 }}
          >
            <p className={styles.dashboardHeadingReset}>
              <strong>{session.sessionType || "Session"}</strong>
            </p>

            <p>Group: {session.sessionGroup || "All"}</p>
            <p>Date: {session.sessionDate || "N/A"}</p>
            <p>Planned RPE: {session.plannedRPE || "N/A"}</p>

            <p style={{ whiteSpace: "pre-wrap" }}>
              Notes: {session.workoutNotes || "None"}
            </p>

            <button
              onClick={() => handleEditSession(session)}
              className={styles.dashboardButtonAccent}
            >
              Edit
            </button>

            <button
              onClick={() => handleDeleteSession(session.id)}
              className={styles.dashboardButtonDanger}
            >
              Delete
            </button>
          </div>
        ))
      )}
    </div>
  </>
)}

        {activeTab === "averages" && (
          <section>
            <div className={styles.dashboardCard} style={{ marginTop: isMobile ? 18 : 32, padding: isMobile ? "14px" : undefined }}>
              <h2 className={styles.dashboardHeadingReset}>Team Averages</h2>
              <p className={styles.dashboardSubtitle}>
                Compare short-term, weekly, and baseline readiness trends.
              </p>

              {athleteAverages.length === 0 ? (
                <p>No athlete averages available yet.</p>
              ) : (
                athleteAverages.map((athlete) => (
                  <div
                    key={`${athlete.name}-${athlete.eventGroup}`}
                    className={styles.smallCard}
                    style={{ marginBottom: 10 }}
                  >
                    <p className={styles.dashboardHeadingReset}>
                      <strong>{athlete.name}</strong>
                    </p>
                    <p>Event Group: {athlete.eventGroup}</p>
                    <p>3-Day Avg: {athlete.threeDayAvg ?? "N/A"}</p>
                    <p>7-Day Avg: {athlete.sevenDayAvg ?? "N/A"}</p>
                    <p>14-Day Avg: {athlete.fourteenDayAvg ?? "N/A"}</p>
                    <p>
                      Trend: <strong>{athlete.trend}</strong>
                    </p>
                  </div>
                ))
              )}
            </div>
          </section>
        )}

        {activeTab === "logs" && (
          <section id="coach-athlete-logs-section" style={{ marginTop: isMobile ? 18 : 32 }}>
            {renderFilters()}

            <div className={styles.dashboardCard} style={{ marginTop: 16, padding: isMobile ? "14px" : undefined }}>
              <h2 className={styles.dashboardHeadingReset}>Athlete Readiness Logs</h2>
              <p className={styles.dashboardSubtitle}>
                Showing {filteredAthleteLogs.length} of {athleteLogs.length} logs
              </p>

              {filteredAthleteLogs.length === 0 ? (
                <p>No logs match your filters.</p>
              ) : (
                filteredAthleteLogs.map((log) => renderAthleteLogCard(log, true))
              )}
            </div>
          </section>
                )}
      </div>
    </div>
  );
}