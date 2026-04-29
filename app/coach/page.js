"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { auth, db } from "../../lib/firebase";
import {
  calculateAdjustedLoad,
  calculateCompoundedLoad,
  calculateReadinessRatio,
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

      sortedOldestFirst.forEach((currentLog) => {
        const currentDate = getLogDateValue(currentLog);

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
              getSessionDuration(log),
              log.actualRPE,
              log.plannedRPE
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
          adjustedLoad: Number(
            calculateAdjustedLoad(
              getSessionDuration(currentLog),
              currentLog.actualRPE,
              currentLog.plannedRPE
            ).toFixed(1)
          ),
          compoundedLoad: Number(compoundedLoad.toFixed(1)),
          avg14DayLoad: avg14DayLoad ? Number(avg14DayLoad.toFixed(1)) : null,
          readinessRatio:
            compoundedReadinessRatio !== null
              ? Number(Math.max(0, compoundedReadinessRatio).toFixed(2))
              : Math.max(0, Number(currentLog.readinessRatio || 0)),
          readinessModel: "Compounded",
        };
      });
    });

    return logs.map((log) => enhancedLogsById[log.id] || log);
  };

  const fetchCoachData = async (code) => {
    const sessionsQuery = query(
      collection(db, "planned_sessions"),
      where("teamCode", "==", code)
    );

    const sessionsSnap = await getDocs(sessionsQuery);
    const sessionsData = sessionsSnap.docs.map((d) => ({
      id: d.id,
      ...d.data(),
    }));

    setPlannedSessions(sortSessionsNewestFirst(sessionsData));

    const logsQuery = query(
      collection(db, "readiness_logs"),
      where("teamCode", "==", code)
    );

    const logsSnap = await getDocs(logsQuery);
    const logsData = logsSnap.docs.map((d) => ({
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
  };

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
      .map((log) => log.eventGroup)
      .filter((group) => group && group.trim() !== "");

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
    "400/400h/800",
    "Throws",
    "Distance",
    "Mid-Distance",
    "Multi",
  ];

  const getEventGroupSummary = () => {
    return eventGroupOrder.map((group) => {
      const groupLogs = athleteLogs.filter((log) => log.eventGroup === group);

      const athleteNames = Array.from(
        new Set(
          groupLogs
            .map((log) => log.name)
            .filter((name) => name && String(name).trim() !== "")
        )
      );

      return {
        group,
        athleteCount: athleteNames.length,
        logCount: groupLogs.length,
        alertCount: groupLogs.filter((log) => isAlertLog(log)).length,
      };
    });
  };
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

  const cardStyle = {
    border: "1px solid #e5e7eb",
    borderRadius: 14,
    padding: isMobile ? 14 : 16,
    marginBottom: 16,
    background: "white",
    boxShadow: "0 1px 3px rgba(0,0,0,0.08)",
  };

  const inputStyle = {
    display: "block",
    width: "100%",
    maxWidth: isMobile ? "100%" : 430,
    padding: isMobile ? 12 : 10,
    marginBottom: 10,
    border: "1px solid #d1d5db",
    borderRadius: 10,
    fontSize: 14,
    boxSizing: "border-box",
  };

  const filterInputStyle = {
    padding: isMobile ? 12 : 10,
    marginRight: isMobile ? 0 : 8,
    marginBottom: 8,
    border: "1px solid #d1d5db",
    borderRadius: 10,
    fontSize: 14,
    minWidth: isMobile ? "100%" : 180,
    width: isMobile ? "100%" : undefined,
    boxSizing: "border-box",
  };

  const noteInputStyle = {
    display: "block",
    width: "100%",
    maxWidth: 620,
    padding: 10,
    marginTop: 8,
    marginBottom: 8,
    border: "1px solid #d1d5db",
    borderRadius: 10,
    minHeight: 70,
    fontSize: 14,
    boxSizing: "border-box",
  };

  const buttonStyle = {
    padding: "10px 14px",
    border: "none",
    borderRadius: 10,
    background: "#111827",
    color: "white",
    cursor: "pointer",
    marginRight: isMobile ? 0 : 8,
    marginBottom: 8,
    width: isMobile ? "100%" : undefined,
    minHeight: 42,
  };

  const secondaryButtonStyle = {
    padding: "10px 14px",
    border: "1px solid #d1d5db",
    borderRadius: 10,
    background: "white",
    color: "#111827",
    cursor: "pointer",
    marginRight: isMobile ? 0 : 8,
    marginBottom: 8,
    width: isMobile ? "100%" : undefined,
    minHeight: 42,
  };

  const deleteButtonStyle = {
    padding: "8px 12px",
    border: "none",
    borderRadius: 10,
    background: "#dc2626",
    color: "white",
    cursor: "pointer",
    marginTop: 8,
    marginRight: isMobile ? 0 : 8,
    width: isMobile ? "100%" : undefined,
    minHeight: 42,
  };

  const editButtonStyle = {
    padding: "8px 12px",
    border: "none",
    borderRadius: 10,
    background: "#2563eb",
    color: "white",
    cursor: "pointer",
    marginTop: 8,
    marginRight: isMobile ? 0 : 8,
    width: isMobile ? "100%" : undefined,
    minHeight: 42,
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

  const tabStyle = (tab) => ({
    padding: "10px 14px",
    border: "1px solid #d1d5db",
    borderRadius: 10,
    background: activeTab === tab ? "#111827" : "white",
    color: activeTab === tab ? "white" : "#111827",
    cursor: "pointer",
    marginRight: isMobile ? 0 : 8,
    marginBottom: 8,
    flex: isMobile ? "1 1 100%" : undefined,
    minHeight: 42,
  });

  const mailboxButtonStyle = {
    position: "relative",
    border: "1px solid #d1d5db",
    borderRadius: 999,
    background: "white",
    color: "#111827",
    cursor: "pointer",
    width: 44,
    height: 44,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    marginRight: 10,
    boxShadow: "0 1px 3px rgba(0,0,0,0.08)",
  };

  const mailboxOverlayStyle = {
    position: "fixed",
    inset: 0,
    background: "rgba(17, 24, 39, 0.35)",
    zIndex: 50,
    display: mailboxOpen ? "block" : "none",
  };

  const mailboxPanelStyle = {
    position: "fixed",
    top: 0,
    right: mailboxOpen ? 0 : isMobile ? "-100%" : -420,
    width: "100%",
    maxWidth: isMobile ? "100%" : 420,
    height: "100vh",
    background: "white",
    zIndex: 60,
    boxShadow: "-8px 0 20px rgba(0,0,0,0.16)",
    padding: isMobile ? 16 : 20,
    overflowY: "auto",
    transition: "right 0.3s cubic-bezier(0.4, 0, 0.2, 1)",
    boxSizing: "border-box",
  };

  const athleteAverages = getAthleteAverages();
  const filteredAthleteLogs = applyFilters(athleteLogs);
  const eventGroupOptions = getUniqueEventGroups();
  const atRiskAthletes = getAtRiskAthletes();
  const dailySummary = getDailySummary();
  const todaysPlannedSessions = getTodaysPlannedSessions();
  const eventGroupSummary = getEventGroupSummary();
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
    <div style={cardStyle}>
      <h3 style={{ marginTop: 0 }}>Filters</h3>

      <input
        style={filterInputStyle}
        placeholder="Search athlete name"
        value={filterName}
        onChange={(e) => setFilterName(e.target.value)}
      />

      <select
        style={filterInputStyle}
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
        style={filterInputStyle}
        value={filterAlertStatus}
        onChange={(e) => setFilterAlertStatus(e.target.value)}
      >
        <option value="All">All Logs</option>
        <option value="Alerts Only">Alerts Only</option>
        <option value="No Alerts">No Alerts</option>
      </select>

      <button onClick={handleClearFilters} style={secondaryButtonStyle}>
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
        style={noteInputStyle}
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
        style={editButtonStyle}
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
            background: "#ffffff",
          }}
        >
          <p style={{ marginTop: 0 }}>
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

          <p>
            Readiness Model: <strong>{log.readinessModel || "Standard"}</strong>
          </p>

          <p style={{ color: trend.color }}>
            Trend: <strong>{trend.symbol} {trend.label}</strong>
          </p>

          <p style={{ color: readinessColor, fontWeight: "bold" }}>
            {getReadinessRecommendation(safeReadinessRatio, log.shouldTrainToday)}
          </p>

          <p>Should Train Today: {log.shouldTrainToday || "N/A"}</p>
          <p>
            Yesterday's Workout Completed:{" "}
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
            <div
              style={{
                border: "1px solid #e5e7eb",
                borderRadius: 12,
                padding: 12,
                marginTop: 10,
                background: "#f9fafb",
              }}
            >
              <p style={{ margin: "0 0 6px", color: "#374151" }}>
                <strong>Last message:</strong> {log.coachNote}
              </p>

              <p style={{ margin: "0 0 6px", color: "#6b7280", fontSize: 13 }}>
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
              style={deleteButtonStyle}
            >
              Delete Log
            </button>
          )}
        </div>
      );
    };

  const renderMailboxPanel = () => (
    <>
      <div style={mailboxOverlayStyle} onClick={handleCloseMailbox} />

      <aside style={mailboxPanelStyle}>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: 16,
          }}
        >
          <div>
            <h2 style={{ margin: 0 }}>Mailbox</h2>
            <p style={{ margin: "4px 0 0", color: "#6b7280" }}>
              {unreadMailboxNewestFirst.length} unread notification
              {unreadMailboxNewestFirst.length === 1 ? "" : "s"}
            </p>
          </div>

          <button
            onClick={handleCloseMailbox}
            style={{
              border: "1px solid #d1d5db",
              background: "white",
              borderRadius: 999,
              width: 36,
              height: 36,
              cursor: "pointer",
              fontSize: 18,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            ×
          </button>
        </div>

        {unreadMailboxNewestFirst.length > 0 && (
          <button onClick={markAllMailboxRead} style={secondaryButtonStyle}>
            Mark All Read
          </button>
        )}

        {unreadMailboxNewestFirst.length === 0 ? (
          <div
            style={{
              border: "1px solid #e5e7eb",
              borderRadius: 14,
              padding: 16,
              background: "#f9fafb",
            }}
          >
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
                border: "1px solid #fecaca",
                borderRadius: 16,
                padding: 16,
                marginBottom: 12,
                background: "#fff7f7",
                boxShadow: "0 1px 3px rgba(0,0,0,0.06)",
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

              <p style={{ color: "#374151", marginTop: 0 }}>{item.message}</p>

              <div
                style={{
                  background: "white",
                  border: "1px solid #fee2e2",
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
                  <strong>Yesterday's Workout Completed:</strong>{" "}
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
                  setActiveTab("logs");
                  setFilterName(item.athleteName);
                  setFilterAlertStatus("Alerts Only");
                  setMailboxOpen(false);
                }}
                style={{
                  ...buttonStyle,
                  width: "100%",
                  marginTop: 10,
                }}
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
    <main
      style={{
        padding: isMobile ? 14 : 24,
        fontFamily: "Arial, sans-serif",
        background: "#f9fafb",
        minHeight: "100vh",
      }}
    >
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
            style={{
              background: "white",
              borderRadius: 16,
              padding: 18,
              width: "100%",
              maxWidth: 520,
              boxShadow: "0 12px 28px rgba(0,0,0,0.22)",
            }}
            onClick={(e) => e.stopPropagation()}
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
                <h2 style={{ margin: 0 }}>Message Group</h2>
                <p style={{ margin: "4px 0 0", color: "#6b7280" }}>
                  Send one message to the latest log for each athlete in this group.
                </p>
              </div>

              <button
                onClick={() => setGroupMessageOpen(false)}
                style={{
                  border: "1px solid #d1d5db",
                  background: "white",
                  borderRadius: 999,
                  width: 36,
                  height: 36,
                  cursor: "pointer",
                  fontSize: 18,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                ×
              </button>
            </div>

            <div
              style={{
                border: "1px solid #e5e7eb",
                borderRadius: 12,
                padding: 12,
                background: "#f9fafb",
                marginBottom: 12,
              }}
            >
              <p style={{ margin: "0 0 6px", fontWeight: "bold" }}>
                Group: {selectedGroupForMessage || "None selected"}
              </p>
              <p style={{ margin: 0, color: "#6b7280", fontSize: 13 }}>
                This message will send to <strong>{getGroupMessageRecipients().length}</strong>{" "}
                athlete{getGroupMessageRecipients().length === 1 ? "" : "s"}.
              </p>
            </div>

            <textarea
              style={{
                ...noteInputStyle,
                maxWidth: "100%",
                minHeight: 120,
              }}
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
              <button onClick={handleSendGroupMessage} style={buttonStyle}>
                Send Group Message
              </button>

              <button
                onClick={() => {
                  setGroupMessage("");
                  setSelectedGroupForMessage("");
                  setGroupMessageOpen(false);
                }}
                style={secondaryButtonStyle}
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

      <div style={{ maxWidth: 1000, margin: "0 auto", width: "100%" }}>
        <div
          style={{
            display: "flex",
            flexDirection: isMobile ? "column" : "row",
            justifyContent: "space-between",
            gap: isMobile ? 12 : 16,
            alignItems: isMobile ? "stretch" : "flex-start",
          }}
        >
          <div style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
            <div style={{ position: "relative" }}>
              <button
                type="button"
                onClick={() => setCoachMenuOpen((current) => !current)}
                style={{
                  border: "1px solid #d1d5db",
                  borderRadius: 12,
                  background: "white",
                  color: "#111827",
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
                    background: "white",
                    border: "1px solid #e5e7eb",
                    borderRadius: 14,
                    boxShadow: "0 10px 25px rgba(0,0,0,0.14)",
                    padding: 8,
                    zIndex: 40,
                    minWidth: 210,
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
                        border: "none",
                        borderRadius: 10,
                        padding: "12px 14px",
                        background: activeTab === item.key ? "#111827" : "white",
                        color: activeTab === item.key ? "white" : "#111827",
                        cursor: "pointer",
                        fontSize: 15,
                        fontWeight: activeTab === item.key ? "bold" : "500",
                      }}
                    >
                      {item.label}
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div>
              <h1 style={{ marginBottom: 4 }}>
                Welcome, {coachProfile?.name || "Coach"}
              </h1>
              <p style={{ marginTop: 0, color: "#6b7280" }}>
                Team Code: <strong>{teamCode || "Loading..."}</strong>
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
              style={mailboxButtonStyle}
              title="Mailbox"
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

            <button onClick={handleSignOut} style={buttonStyle}>
              Sign Out
            </button>
          </div>
        </div>


        {activeTab === "overview" && (
          <>
            <div style={cardStyle}>
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
                  <h2 style={{ margin: 0 }}>Today's Planned Sessions</h2>
                  <p style={{ margin: "4px 0 0", color: "#6b7280" }}>
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
                    gap: 10,
                  }}
                >
                  {todaysPlannedSessions.map((session) => (
                    <div
                      key={session.id}
                      style={{
                        border: "1px solid #e5e7eb",
                        borderRadius: 12,
                        padding: 12,
                        background: "#f9fafb",
                      }}
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
              style={{
                ...cardStyle,
                border:
                  atRiskAthletes.length > 0 ||
                  unreadMailboxNewestFirst.length > 0 ||
                  dailySummary.needsCoachNoteCount > 0
                    ? "2px solid #111827"
                    : "1px solid #e5e7eb",
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
                  <h2 style={{ margin: 0 }}>Today’s Action List</h2>
                  <p style={{ margin: "4px 0 0", color: "#6b7280" }}>
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

              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: isMobile ? "1fr" : "repeat(3, 1fr)",
                  gap: 10,
                }}
              >
                <div
                  style={{
                    border: "1px solid #e5e7eb",
                    borderRadius: 12,
                    padding: 12,
                    background: atRiskAthletes.length > 0 ? "#fff7f7" : "#f9fafb",
                  }}
                >
                  <p style={{ margin: 0, fontSize: 12, color: "#6b7280" }}>
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
                    onClick={() => {
                      setActiveTab("logs");
                      setFilterName("");
                      setFilterEventGroup("All");
                      setFilterAlertStatus("Alerts Only");
                      setTimeout(() => scrollToLogsSection(), 50);
                    }}
                    style={{
                      ...secondaryButtonStyle,
                      width: "100%",
                      marginRight: 0,
                    }}
                  >
                    Review Alerts
                  </button>
                </div>

                <div
                  style={{
                    border: "1px solid #e5e7eb",
                    borderRadius: 12,
                    padding: 12,
                    background:
                      unreadMailboxNewestFirst.length > 0 ? "#fff7f7" : "#f9fafb",
                  }}
                >
                  <p style={{ margin: 0, fontSize: 12, color: "#6b7280" }}>
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
                    style={{
                      ...secondaryButtonStyle,
                      width: "100%",
                      marginRight: 0,
                    }}
                  >
                    Open Mailbox
                  </button>
                </div>

                <div
                  style={{
                    border: "1px solid #e5e7eb",
                    borderRadius: 12,
                    padding: 12,
                    background:
                      dailySummary.needsCoachNoteCount > 0 ? "#fff7ed" : "#f9fafb",
                  }}
                >
                  <p style={{ margin: 0, fontSize: 12, color: "#6b7280" }}>
                    Coach Notes Needed
                  </p>
                  <p
                    style={{
                      margin: "6px 0 8px",
                      fontSize: 24,
                      fontWeight: "bold",
                      color:
                        dailySummary.needsCoachNoteCount > 0 ? "#ea580c" : "#111827",
                    }}
                  >
                    {dailySummary.needsCoachNoteCount}
                  </p>
                  <button
                    onClick={() => {
                      setActiveTab("logs");
                      setFilterName("");
                      setFilterEventGroup("All");
                      setFilterAlertStatus("All");
                      setTimeout(() => scrollToLogsSection(), 50);
                    }}
                    style={{
                      ...secondaryButtonStyle,
                      width: "100%",
                      marginRight: 0,
                    }}
                  >
                    Add Notes
                  </button>
                </div>
              </div>
            </div>


            <div style={cardStyle}>
              <div
                style={{
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
                <div style={{ border: "1px solid #e5e7eb", borderRadius: 12, padding: 12 }}>
                  <p style={{ margin: 0, fontSize: 12, color: "#6b7280" }}>Logged Today</p>
                  <p style={{ margin: "6px 0 0", fontSize: 22, fontWeight: "bold" }}>
                    {dailySummary.loggedTodayCount}
                  </p>
                </div>

                <div
                  style={{
                    border: "1px solid #e5e7eb",
                    borderRadius: 12,
                    padding: 12,
                    background: dailySummary.noOrUnsureCount > 0 ? "#fff7f7" : undefined,
                  }}
                >
                  <p style={{ margin: 0, fontSize: 12, color: "#6b7280" }}>No / Unsure</p>
                  <p style={{ margin: "6px 0 0", fontSize: 22, fontWeight: "bold" }}>
                    {dailySummary.noOrUnsureCount}
                  </p>
                </div>

                <div style={{ border: "1px solid #e5e7eb", borderRadius: 12, padding: 12 }}>
                  <p style={{ margin: 0, fontSize: 12, color: "#6b7280" }}>Highest Risk</p>
                  <p style={{ margin: "6px 0 0", fontWeight: "bold" }}>
                    {dailySummary.highestRiskLog?.name || "N/A"}
                  </p>
                  <p style={{ margin: "4px 0 0", fontSize: 12, color: "#6b7280" }}>
                    Ratio: {dailySummary.highestRiskLog?.readinessRatio || "N/A"}
                  </p>
                </div>

                <div
                  style={{
                    border: "1px solid #e5e7eb",
                    borderRadius: 12,
                    padding: 12,
                    background: dailySummary.needsCoachNoteCount > 0 ? "#fff7ed" : undefined,
                  }}
                >
                  <p style={{ margin: 0, fontSize: 12, color: "#6b7280" }}>
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
                    border: "1px solid #e5e7eb",
                    borderRadius: 12,
                    padding: 12,
                    background: dailySummary.missedWorkoutsThisWeek > 0 ? "#fff7f7" : "white",
                    cursor: "pointer",
                    fontFamily: "inherit",
                  }}
                >
                  <p style={{ margin: 0, fontSize: 12, color: "#6b7280" }}>
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
                  style={{
                    border: "1px solid #e5e7eb",
                    borderRadius: 12,
                    padding: 12,
                    background: dailySummary.modifiedWorkoutsThisWeek > 0 ? "#fff7ed" : undefined,
                  }}
                >
                  <p style={{ margin: 0, fontSize: 12, color: "#6b7280" }}>
                    Modified This Week
                  </p>
                  <p
                    style={{
                      margin: "6px 0 0",
                      fontSize: 22,
                      fontWeight: "bold",
                      color: dailySummary.modifiedWorkoutsThisWeek > 0 ? "#d97706" : "#111827",
                    }}
                  >
                    {dailySummary.modifiedWorkoutsThisWeek}
                  </p>
                </div>

                <div
                  style={{
                    border: "1px solid #e5e7eb",
                    borderRadius: 12,
                    padding: 12,
                    background: dailySummary.completedWorkoutsThisWeek > 0 ? "#f0fdf4" : undefined,
                  }}
                >
                  <p style={{ margin: 0, fontSize: 12, color: "#6b7280" }}>
                    Completed This Week
                  </p>
                  <p
                    style={{
                      margin: "6px 0 0",
                      fontSize: 22,
                      fontWeight: "bold",
                      color: dailySummary.completedWorkoutsThisWeek > 0 ? "#16a34a" : "#111827",
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
                  borderTop: "1px solid #e5e7eb",
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
                        border: "1px solid #fecaca",
                        borderRadius: 12,
                        padding: 12,
                        marginBottom: 8,
                        background: "#fff7f7",
                      }}
                    >
                      <p style={{ margin: "0 0 4px", fontWeight: "bold" }}>
                        {athlete.name}
                      </p>
                      <p style={{ margin: "0 0 4px", color: "#6b7280", fontSize: 13 }}>
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

            <div style={cardStyle}>
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
                  <h2 style={{ margin: 0 }}>Trend Tracking & Notifications</h2>
                  <p style={{ margin: "4px 0 0", color: "#6b7280" }}>
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
                    gap: 10,
                  }}
                >
                  {coachTrendNotifications.slice(0, 8).map((item, index) => (
                    <div
                      key={`${item.athleteName}-${item.type}-${index}`}
                      onClick={() => {
                        setActiveTab("logs");
                        setFilterName(item.athleteName);
                        setFilterEventGroup("All");
                        setFilterAlertStatus("All");
                        setTimeout(() => scrollToLogsSection(), 50);
                      }}
                      role="button"
                      tabIndex={0}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          setActiveTab("logs");
                          setFilterName(item.athleteName);
                          setFilterEventGroup("All");
                          setFilterAlertStatus("All");
                          setTimeout(() => scrollToLogsSection(), 50);
                        }
                      }}
                      style={{
                        border: `1px solid ${item.color}`,
                        borderRadius: 12,
                        padding: 12,
                        background:
                          item.severity === "High"
                            ? "#fff7f7"
                            : item.severity === "Medium"
                            ? "#fff7ed"
                            : "#eff6ff",
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

                      <p style={{ margin: "0 0 4px", color: "#6b7280", fontSize: 13 }}>
                        {item.type} • {item.eventGroup}
                      </p>

                      <p style={{ margin: 0, color: "#374151", fontSize: 13 }}>
                        {item.message}
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </main>
  );
}