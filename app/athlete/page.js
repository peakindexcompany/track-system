"use client";

import { useEffect, useState } from "react";
import styles from "../dashboard.module.css";
import { useRouter } from "next/navigation";
import { auth, db } from "../../lib/firebase";
import { calculateAdjustedLoad } from "../../lib/readiness";
import { onAuthStateChanged, signOut } from "firebase/auth";
import {
  collection,
  addDoc,
  query,
  where,
  serverTimestamp,
  doc,
  getDoc,
  onSnapshot,
  updateDoc,
  deleteDoc,
} from "firebase/firestore";

export default function AthleteDashboard() {
  const router = useRouter();

  const [user, setUser] = useState(null);
  const [athleteProfile, setAthleteProfile] = useState(null);
  const [teamCode, setTeamCode] = useState("");
  const [eventGroup, setEventGroup] = useState("");
  const [loading, setLoading] = useState(true);
  const [statusMessage, setStatusMessage] = useState("");
  const [isMobile, setIsMobile] = useState(false);

  const [activeTab, setActiveTab] = useState("overview");
  const [athleteMenuOpen, setAthleteMenuOpen] = useState(false);
  const [mailboxOpen, setMailboxOpen] = useState(false);

  const [plannedSessions, setPlannedSessions] = useState([]);
  const [selectedSessionId, setSelectedSessionId] = useState("");
  const [plannedRPE, setPlannedRPE] = useState("");

  const [sleepHours, setSleepHours] = useState("");
  const [sleepQuality, setSleepQuality] = useState("");
  const [stress, setStress] = useState("");
  const [soreness, setSoreness] = useState("");
  const [mood, setMood] = useState("");
  const [shouldTrainToday, setShouldTrainToday] = useState("Yes");
  const [workoutCompleted, setWorkoutCompleted] = useState("Yes");
  const [actualRPE, setActualRPE] = useState("");
  const [notes, setNotes] = useState("");

  const [readinessLogs, setReadinessLogs] = useState([]);
  const [editingLogId, setEditingLogId] = useState(null);

  const [seenMailboxIds, setSeenMailboxIds] = useState(() => {
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem("athleteSeenMailboxIds");
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

  const getTodayDateString = () => {
    const today = new Date();
    const year = today.getFullYear();
    const month = String(today.getMonth() + 1).padStart(2, "0");
    const day = String(today.getDate()).padStart(2, "0");

    return `${year}-${month}-${day}`;
  };

  const normalizeEventGroupLabel = (value) => {
    const trimmed = String(value || "").trim();
    if (!trimmed) return "Unassigned";

    const normalized = trimmed.toLowerCase();
    if (normalized === "400/400h/800") {
      return "400/400h";
    }

    return trimmed;
  };

  const formatSessionDate = (session) => {
    return session?.sessionDate || "No Date";
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
          showStatus("Athlete account profile not found. Please log in again.");
          setLoading(false);
          router.push("/");
          return;
        }

        const data = userSnap.data();
        const role = String(data.role || data.accountType || data.userType || "")
          .toLowerCase()
          .trim();

        if (role && role !== "athlete") {
          showStatus("This account is not marked as athlete. Redirecting...");
          setLoading(false);
          router.push("/");
          return;
        }

        const profileTeamCode = data.teamCode || data.teamcode || "";
        const profileEventGroup = data.eventGroup || "";
        const normalizedProfileEventGroup = normalizeEventGroupLabel(profileEventGroup);

        setAthleteProfile(data);
        setTeamCode(profileTeamCode);
        setEventGroup(normalizedProfileEventGroup);

        if (profileTeamCode) {
          const sessionsQuery = query(
            collection(db, "planned_sessions"),
            where("teamCode", "==", profileTeamCode)
          );

          unsubscribeSessions = onSnapshot(sessionsQuery, (snapshot) => {
            const sessionsData = snapshot.docs.map((d) => ({
              id: d.id,
              ...d.data(),
            }));

            const groupSessions = sessionsData.filter((session) => {
              const sessionGroup = normalizeEventGroupLabel(session.sessionGroup || "All");

              return sessionGroup === "All" || sessionGroup === normalizedProfileEventGroup;
            });

            const sortedSessions = sortSessionsNewestFirst(groupSessions);
            setPlannedSessions(sortedSessions);

            if (sortedSessions.length > 0) {
              const todayDate = getTodayDateString();
              const todaySession = sortedSessions.find(
                (session) => session.sessionDate === todayDate
              );

              const fallbackSession = todaySession || sortedSessions[0];

              setSelectedSessionId((current) => {
                const stillExists = sortedSessions.some(
                  (session) => session.id === current
                );

                if (todaySession) {
                  return todaySession.id;
                }

                return stillExists ? current : fallbackSession.id;
              });

              setPlannedRPE(fallbackSession.plannedRPE || "");
            } else {
              setSelectedSessionId("");
              setPlannedRPE("");
            }
          });

          const logsQuery = query(
            collection(db, "readiness_logs"),
            where("userId", "==", currentUser.uid)
          );

          unsubscribeLogs = onSnapshot(logsQuery, (snapshot) => {
            const logsData = snapshot.docs.map((d) => ({
              id: d.id,
              ...d.data(),
            }));

            setReadinessLogs(sortLogsNewestFirst(logsData));
          });
        }
      } catch (error) {
        console.error(error);
        showStatus("Error loading athlete dashboard.");
      }

      setLoading(false);
    });

    return () => {
      unsubscribeAuth();

      if (unsubscribeSessions) unsubscribeSessions();
      if (unsubscribeLogs) unsubscribeLogs();
    };
  }, [router]);

  useEffect(() => {
    if (typeof window !== "undefined") {
      localStorage.setItem("athleteSeenMailboxIds", JSON.stringify(seenMailboxIds));
    }
  }, [seenMailboxIds]);

  const selectedSession = plannedSessions.find(
    (session) => session.id === selectedSessionId
  );

  const handleSelectedSessionChange = (sessionId) => {
    setSelectedSessionId(sessionId);

    const session = plannedSessions.find((s) => s.id === sessionId);

    if (session) {
      setPlannedRPE(session.plannedRPE || "");
    }
  };

  const calculateReadinessRatio = () => {
    const sleep = Number(sleepQuality || 0);
    const stressValue = Number(stress || 0);
    const sorenessValue = Number(soreness || 0);
    const moodValue = Number(mood || 0);

    const recoveryScore = (sleep + moodValue) / 2;
    const strainScore = (stressValue + sorenessValue) / 2;

    if (!recoveryScore) return 0;

    return Number((strainScore / recoveryScore).toFixed(2));
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
    if (value < 0.8) return "Low Strain";
    if (value <= 1.3) return "Ready";
    if (value <= 1.5) return "Caution";
    return "Not Ready";
  };

  const handleSubmitReadiness = async (e) => {
    e.preventDefault();

    if (!athleteProfile || !user) {
      showStatus("Athlete profile not loaded.");
      return;
    }

    if (!selectedSession) {
      showStatus("Select the session you completed.");
      setActiveTab("session");
      return;
    }

    if (!actualRPE) {
      showStatus("Enter yesterday's RPE.");
      return;
    }

    const readinessRatio = calculateReadinessRatio();
    const dailyLoad = calculateAdjustedLoad(
      actualRPE,
      sleepQuality,
      stress,
      soreness,
      mood
    );

    const logData = {
      userId: user.uid,
      name: athleteProfile.name || user.email,
      teamCode,
      eventGroup,
      selectedSessionId,
      sessionType: selectedSession.sessionType || "",
      sessionDate: selectedSession.sessionDate || "",
      sessionGroup: selectedSession.sessionGroup || "All",
      plannedRPE: Number(plannedRPE || 0),
      actualRPE: Number(actualRPE || 0),
      dailyLoad,
      adjustedLoad: dailyLoad,
      sleepHours: Number(sleepHours || 0),
      sleepQuality: Number(sleepQuality || 0),
      stress: Number(stress || 0),
      soreness: Number(soreness || 0),
      mood: Number(mood || 0),
      shouldTrainToday,
      workoutCompleted,
      notes,
      readinessRatio,
      readinessStatus: getReadinessStatus(readinessRatio),
    };

    try {
      if (editingLogId) {
        await updateDoc(doc(db, "readiness_logs", editingLogId), {
          ...logData,
          updatedAt: serverTimestamp(),
        });

        showStatus("Readiness log updated.");
      } else {
        await addDoc(collection(db, "readiness_logs"), {
          ...logData,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });

        showStatus("Readiness saved.");
      }

      setEditingLogId(null);
      setSleepHours("");
      setSleepQuality("");
      setStress("");
      setSoreness("");
      setMood("");
      setActualRPE("");
      setShouldTrainToday("Yes");
      setWorkoutCompleted("Yes");
      setNotes("");
      setActiveTab("history");
    } catch (error) {
      console.error(error);
      showStatus("Error saving readiness log.");
    }
  };

  const handleEditLog = (log) => {
    setEditingLogId(log.id);
    setSelectedSessionId(log.selectedSessionId || "");
    setPlannedRPE(log.plannedRPE || "");
    setActualRPE(log.actualRPE || "");
    setSleepHours(log.sleepHours || "");
    setSleepQuality(log.sleepQuality || "");
    setStress(log.stress || "");
    setSoreness(log.soreness || "");
    setMood(log.mood || "");
    setShouldTrainToday(log.shouldTrainToday || "Yes");
    setWorkoutCompleted(log.workoutCompleted || "Yes");
    setNotes(log.notes || "");
    setActiveTab("log");
  };

  const handleDeleteLog = async (logId) => {
    const confirmDelete = window.confirm("Delete this readiness log?");

    if (!confirmDelete) return;

    try {
      await deleteDoc(doc(db, "readiness_logs", logId));
      showStatus("Readiness log deleted.");
    } catch (error) {
      console.error(error);
      showStatus("Error deleting readiness log.");
    }
  };

  const handleOpenMailbox = () => {
    setMailboxOpen(true);
  };

  const handleCloseMailbox = () => {
    setMailboxOpen(false);
  };

  const markMailboxItemRead = (id) => {
    setSeenMailboxIds((current) =>
      current.includes(id) ? current : [...current, id]
    );
  };

  const plannedSessionMailboxItems = plannedSessions.map((session) => {
    const timestamp = session.updatedAt?.seconds || session.createdAt?.seconds || 0;

    return {
      id: `session-${session.id}-${timestamp}`,
      type: "planned_session",
      title: "Planned Session Update",
      message: `${session.sessionType || "A planned session"} is available or was updated.`,
      sessionId: session.id,
      sessionType: session.sessionType || "N/A",
      sessionDate: session.sessionDate || "N/A",
      sessionGroup: session.sessionGroup || "All",
      plannedRPE: session.plannedRPE || "N/A",
      notes: session.workoutNotes || "None",
      timestamp,
    };
  });

  const coachNoteMailboxItems = readinessLogs
    .filter((log) => log.coachNote)
    .map((log) => {
      const timestamp = log.coachNoteUpdatedAt?.seconds || log.updatedAt?.seconds || 0;

      return {
        id: `coach-note-${log.id}-${timestamp}`,
        type: "coach_note",
        title: "New Coach Message",
        message: `Your coach sent feedback for ${log.sessionType || "a session"}.`,
        logId: log.id,
        sessionType: log.sessionType || "N/A",
        sessionDate: log.sessionDate || "N/A",
        coachNote: log.coachNote || "",
        timestamp,
      };
    });

  const mailboxItems = [...plannedSessionMailboxItems, ...coachNoteMailboxItems].sort(
    (a, b) => b.timestamp - a.timestamp
  );

  const unreadMailboxNewestFirst = mailboxItems.filter(
    (item) => !seenMailboxIds.includes(item.id)
  );

  const athleteDisplayName =
    athleteProfile?.name || user?.displayName || user?.email || "Athlete";

  const todayLog = readinessLogs.find(
    (log) => log.sessionDate === getTodayDateString()
  );

  const recentCoachNotes = readinessLogs
    .filter((log) => log.coachNote)
    .slice(0, 2);

  const cardStyle = {
    border: "1px solid rgba(148, 163, 184, 0.18)",
    borderRadius: 22,
    padding: isMobile ? 18 : 24,
    marginBottom: 18,
    background: "rgba(15, 23, 42, 0.78)",
    color: "#f8fafc",
    boxShadow: "0 20px 60px rgba(0,0,0,0.45)",
    backdropFilter: "blur(18px)",
  };

  const inputStyle = {
    display: "block",
    width: "100%",
    maxWidth: isMobile ? "100%" : 440,
    padding: isMobile ? 12 : 11,
    marginBottom: 6,
    border: "1px solid rgba(148, 163, 184, 0.22)",
    borderRadius: 10,
    fontSize: 14,
    boxSizing: "border-box",
    background: "rgba(15, 23, 42, 0.6)",
    color: "#f8fafc",
  };

  const buttonStyle = {
    padding: "11px 16px",
    border: "1px solid rgba(47, 124, 255, 0.75)",
    borderRadius: 10,
    background: "linear-gradient(135deg, #2F7CFF, #1554D8)",
    color: "white",
    cursor: "pointer",
    marginTop: 8,
    marginRight: isMobile ? 0 : 8,
    width: isMobile ? "100%" : undefined,
    minHeight: 44,
    fontWeight: "bold",
    boxShadow: "0 10px 30px rgba(47,124,255,.35)",
  };

  const secondaryButtonStyle = {
    padding: "10px 14px",
    border: "1px solid rgba(148, 163, 184, 0.28)",
    borderRadius: 10,
    background: "rgba(255, 255, 255, 0.05)",
    color: "#f8fafc",
    cursor: "pointer",
    marginTop: 8,
    marginRight: isMobile ? 0 : 8,
    width: isMobile ? "100%" : undefined,
    minHeight: 44,
    fontWeight: "600",
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
    background: color,
    color: "white",
    padding: "4px 8px",
    borderRadius: 999,
    fontSize: 12,
    fontWeight: "bold",
  });

  const mailboxPanelStyle = {
    position: "fixed",
    top: 0,
    right: mailboxOpen ? 0 : isMobile ? "-100%" : -420,
    width: "100%",
    maxWidth: isMobile ? "100%" : 420,
    height: "100vh",
    background: "rgba(7, 17, 31, 0.96)",
    color: "#f8fafc",
    borderLeft: "1px solid rgba(148, 163, 184, 0.18)",
    zIndex: 60,
    boxShadow: "-8px 0 20px rgba(0,0,0,0.28)",
    padding: isMobile ? 16 : 20,
    overflowY: "auto",
    transition: "right 0.3s cubic-bezier(0.4, 0, 0.2, 1)",
    boxSizing: "border-box",
  };

  const renderMailboxPanel = () => (
    <>
      {mailboxOpen && (
        <div
          onClick={handleCloseMailbox}
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(2, 6, 23, 0.7)",
            zIndex: 50,
          }}
        />
      )}

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
            <h2 style={{ margin: 0, color: "#f8fafc" }}>Mailbox</h2>
            <p style={{ margin: "4px 0 0", color: "#94a3b8" }}>
              {unreadMailboxNewestFirst.length === 0
                ? "All caught up"
                : `${unreadMailboxNewestFirst.length} new notification${
                    unreadMailboxNewestFirst.length === 1 ? "" : "s"
                  }`}
            </p>
          </div>

          <button
            onClick={handleCloseMailbox}
            style={{
              border: "1px solid rgba(148, 163, 184, 0.2)",
              background: "rgba(255,255,255,0.04)",
              color: "#f8fafc",
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

        {unreadMailboxNewestFirst.length === 0 ? (
          <div
            style={{
              border: "1px solid rgba(148,163,184,0.18)",
              borderRadius: 14,
              padding: 14,
              background: "rgba(255,255,255,0.04)",
            }}
          >
            <p style={{ margin: 0, fontWeight: "bold", color: "#f8fafc" }}>All caught up.</p>
            <p style={{ margin: "6px 0 0", color: "#94a3b8" }}>
              No unread notifications.
            </p>
          </div>
        ) : (
          unreadMailboxNewestFirst.map((item) => (
            <div
              key={item.id}
              style={{
                border: "1px solid rgba(148, 163, 184, 0.18)",
                borderRadius: 16,
                padding: 16,
                marginBottom: 12,
                background: "rgba(15, 23, 42, 0.75)",
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

              <p style={{ color: "#cbd5e1", marginTop: 0 }}>{item.message}</p>

              {item.type === "planned_session" && (
                <>
                  <div
                    style={{
                      background: "rgba(255,255,255,0.04)",
                      border: "1px solid rgba(148,163,184,0.18)",
                      borderRadius: 12,
                      padding: 12,
                      marginTop: 10,
                    }}
                  >
                    <p style={{ margin: "0 0 6px", color: "#f8fafc" }}>
                      <strong>Session:</strong> {item.sessionType}
                    </p>
                    <p style={{ margin: "0 0 6px", color: "#e2e8f0" }}>
                      <strong>Date:</strong> {item.sessionDate}
                    </p>
                    <p style={{ margin: "0 0 6px", color: "#e2e8f0" }}>
                      <strong>Group:</strong> {item.sessionGroup}
                    </p>
                    <p style={{ margin: "0 0 6px", color: "#e2e8f0" }}>
                      <strong>Planned RPE:</strong> {item.plannedRPE}
                    </p>
                    <p style={{ margin: 0, whiteSpace: "pre-wrap", color: "#e2e8f0" }}>
                      <strong>Notes:</strong> {item.notes}
                    </p>
                  </div>

                  <button
                    onClick={() => {
                      markMailboxItemRead(item.id);
                      handleSelectedSessionChange(item.sessionId);
                      setActiveTab("session");
                      setMailboxOpen(false);
                    }}
                    style={{
                      ...buttonStyle,
                      width: "100%",
                      marginTop: 10,
                      marginRight: 0,
                    }}
                  >
                    Open Session
                  </button>
                </>
              )}

              {item.type === "coach_note" && (
                <>
                  <div
                    style={{
                      background: "rgba(255,255,255,0.04)",
                      border: "1px solid rgba(148,163,184,0.18)",
                      borderRadius: 12,
                      padding: 12,
                      marginTop: 10,
                    }}
                  >
                    <p style={{ margin: "0 0 6px", color: "#f8fafc" }}>
                      <strong>Session:</strong> {item.sessionType}
                    </p>
                    <p style={{ margin: "0 0 6px", color: "#e2e8f0" }}>
                      <strong>Session Date:</strong> {item.sessionDate}
                    </p>
                    <p style={{ margin: 0, whiteSpace: "pre-wrap", color: "#e2e8f0" }}>
                      <strong>Coach Note:</strong> {item.coachNote}
                    </p>
                  </div>

                  <button
                    onClick={async () => {
                      markMailboxItemRead(item.id);

                      if (item.logId) {
                        await updateDoc(doc(db, "readiness_logs", item.logId), {
                          coachMessageRead: true,
                        });
                      }

                      setActiveTab("history");
                      setMailboxOpen(false);
                    }}
                    style={{
                      ...buttonStyle,
                      width: "100%",
                      marginTop: 10,
                      marginRight: 0,
                    }}
                  >
                    Open Note
                  </button>
                </>
              )}
            </div>
          ))
        )}
      </aside>
    </>
  );

  const getAthleteScatterData = () => {
    return sortLogsNewestFirst(readinessLogs)
      .slice(0, 12)
      .map((log) => {
        const stress = Number(log.stress || 0);
        const sleep = Number(log.sleepQuality || log.sleepHours || 0);
        const readiness = Number(log.readinessRatio || 0);

        if (!Number.isFinite(stress) || !Number.isFinite(sleep) || !Number.isFinite(readiness)) {
          return null;
        }

        return {
          label: log.sessionDate || "Session",
          x: Number(stress.toFixed(1)),
          y: Number(sleep.toFixed(1)),
          readiness: Number(readiness.toFixed(2)),
          color: getReadinessColor(readiness),
        };
      })
      .filter(Boolean);
  };

  const renderScatterPlot = ({ data, title, xLabel, yLabel, fallbackMessage }) => {
    if (!data || data.length === 0) {
      return <div style={{ padding: 12, color: "#94a3b8" }}>{fallbackMessage}</div>;
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
        <p style={{ margin: "0 0 12px", fontWeight: 700, color: "#f8fafc" }}>{title}</p>
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
                <text x={scaleX(point.x) + 10} y={scaleY(point.y) - 8} fill="#e2e8f0" fontSize={isCompact ? 9 : 10} fontWeight="700">
                  {point.label}
                </text>
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

  const renderLineChart = ({ data, title, fallbackMessage }) => {
    if (!data || data.length === 0) {
      return <div style={{ padding: 12, color: "#94a3b8" }}>{fallbackMessage}</div>;
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
        <p style={{ margin: "0 0 12px", fontWeight: 700, color: "#f8fafc" }}>{title}</p>
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
                    <text x={scaleX(index, series.points.length) + 6} y={scaleY(point.value) - 8} fill="#e2e8f0" fontSize={isCompact ? 8 : 9}>{point.label}</text>
                  </g>
                ))}
              </g>
            ))}

            <text x={width / 2} y={height - 10} textAnchor="middle" fill="#9ca8b8" fontSize={isCompact ? 10 : 11}>Recent sessions</text>
            <text x={28} y={height / 2} transform={`rotate(-90 28 ${height / 2})`} fill="#9ca8b8" fontSize={isCompact ? 10 : 11}>Readiness</text>
          </svg>
        </div>
      </div>
    );
  };

  const athleteScatterData = getAthleteScatterData();
  const athleteReadinessTrend = [
    {
      label: "Readiness",
      color: "#2F7CFF",
      points: sortLogsNewestFirst(readinessLogs)
        .slice(0, 8)
        .reverse()
        .map((log) => ({
          label: (log.sessionDate || "").slice(5) || "n/a",
          value: Number(log.readinessRatio || 0),
        }))
        .filter((point) => Number.isFinite(point.value)),
    },
  ];

  const renderOverview = () => (
    <>
      <section style={cardStyle}>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            gap: 12,
            alignItems: "flex-start",
            borderBottom: "1px solid rgba(148, 163, 184, 0.18)",
            paddingBottom: 16,
            marginBottom: 18,
          }}
        >
          <div>
            <h2 style={{ margin: "0 0 6px", fontSize: isMobile ? 26 : 32, color: "#f8fafc" }}>
              Welcome, {athleteDisplayName}!
            </h2>
            <p style={{ margin: 0, color: "#94a3b8", fontSize: 16 }}>
              Here’s your plan for today.
            </p>
          </div>

          <div style={{ textAlign: "right", color: "#cbd5e1", minWidth: 110 }}>
            <p style={{ margin: 0, fontWeight: "bold" }}>
              {new Date().toLocaleDateString([], {
                month: "short",
                day: "numeric",
                year: "numeric",
              })}
            </p>
            <p style={{ margin: "4px 0 0" }}>
              {new Date().toLocaleDateString([], { weekday: "long" })}
            </p>
          </div>
        </div>

        <div style={{ marginBottom: 22 }}>
          <h3 style={{ margin: "0 0 12px", textTransform: "uppercase" }}>
            Today’s Workout
          </h3>

          {plannedSessions.length === 0 ? (
            <div
              style={{
                border: "1px solid rgba(148, 163, 184, 0.18)",
                borderRadius: 12,
                padding: 14,
                background: "rgba(255,255,255,0.04)",
              }}
            >
              <p style={{ margin: 0, color: "#e2e8f0" }}>No planned sessions assigned to your group yet.</p>
            </div>
          ) : (
            <>
              <div
                style={{
                  border: "1px solid #bbf7d0",
                  borderRadius: 12,
                  padding: 14,
                  background: "#f0fdf4",
                  marginBottom: 14,
                  display: "flex",
                  gap: 12,
                  alignItems: "center",
                }}
              >
                <span
                  style={{
                    width: 34,
                    height: 34,
                    borderRadius: "50%",
                    background: "#16a34a",
                    color: "white",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontWeight: "bold",
                  }}
                >
                  ✓
                </span>
                <div>
                  <p style={{ margin: 0, fontWeight: "bold", color: "#166534" }}>
                    Today’s workout assigned.
                  </p>
                  <p style={{ margin: "4px 0 0", color: "#cbd5e1" }}>
                    You’re set to get after it.
                  </p>
                </div>
              </div>

              {selectedSession && (
                <div
                  style={{
                    border: "1px solid rgba(148, 163, 184, 0.18)",
                    borderRadius: 14,
                    padding: 16,
                    background: "rgba(255,255,255,0.04)",
                    display: "grid",
                    gridTemplateColumns: isMobile ? "1fr" : "1fr auto",
                    gap: 14,
                    alignItems: "center",
                  }}
                >
                  <div>
                    <p style={{ margin: "0 0 6px", fontSize: 22, fontWeight: "bold", color: "#f8fafc" }}>
                      {selectedSession.sessionType || "Session"}
                    </p>
                    <p style={{ margin: "0 0 4px", color: "#94a3b8" }}>
                      Group: {selectedSession.sessionGroup || "All"}
                    </p>
                    <p style={{ margin: 0, color: "#94a3b8" }}>
                      Date: {selectedSession.sessionDate || "N/A"} • Planned RPE: {selectedSession.plannedRPE || "N/A"}
                    </p>
                  </div>

                  <button
                    onClick={() => setActiveTab("session")}
                    style={{
                      ...secondaryButtonStyle,
                      color: "#2563eb",
                      borderColor: "#2563eb",
                      width: isMobile ? "100%" : undefined,
                      marginTop: 0,
                    }}
                  >
                    View Workout
                  </button>
                </div>
              )}
            </>
          )}
        </div>

        <div
          style={{
            borderTop: "1px solid rgba(148, 163, 184, 0.18)",
            paddingTop: 18,
            marginTop: 18,
          }}
        >
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              gap: 12,
              marginBottom: 12,
            }}
          >
            <h3 style={{ margin: 0, textTransform: "uppercase" }}>
              Readiness Survey Overview
            </h3>
            {todayLog ? (
              <span style={{ color: "#16a34a", fontWeight: "bold" }}>Submitted ✓</span>
            ) : (
              <span style={{ color: "#dc2626", fontWeight: "bold" }}>Not Submitted</span>
            )}
          </div>

          {todayLog ? (
            <div
              style={{
                display: "grid",
                gridTemplateColumns: isMobile ? "1fr" : "repeat(3, 1fr)",
                gap: 10,
              }}
            >
              <div style={{ border: "1px solid rgba(148, 163, 184, 0.18)", borderRadius: 12, padding: 12, background: "rgba(255,255,255,0.04)" }}>
                <p style={{ margin: 0, color: "#94a3b8", fontSize: 13 }}>Sleep</p>
                <p style={{ margin: "6px 0 0", fontWeight: "bold", color: "#f8fafc" }}>
                  {todayLog.sleepHours || "N/A"} hrs • Quality {todayLog.sleepQuality || "N/A"}/10
                </p>
              </div>

              <div style={{ border: "1px solid rgba(148, 163, 184, 0.18)", borderRadius: 12, padding: 12, background: "rgba(255,255,255,0.04)" }}>
                <p style={{ margin: 0, color: "#94a3b8", fontSize: 13 }}>Body / Mind</p>
                <p style={{ margin: "6px 0 0", fontWeight: "bold", color: "#f8fafc" }}>
                  Stress {todayLog.stress || "N/A"}/10 • Soreness {todayLog.soreness || "N/A"}/10
                </p>
              </div>

              <div style={{ border: "1px solid rgba(148, 163, 184, 0.18)", borderRadius: 12, padding: 12, background: "rgba(255,255,255,0.04)" }}>
                <p style={{ margin: 0, color: "#94a3b8", fontSize: 13 }}>Mood / Training</p>
                <p style={{ margin: "6px 0 0", fontWeight: "bold", color: "#f8fafc" }}>
                  Mood {todayLog.mood || "N/A"}/10 • Should Train: {todayLog.shouldTrainToday || "N/A"}
                </p>
              </div>

              <div style={{ border: "1px solid rgba(148, 163, 184, 0.18)", borderRadius: 12, padding: 12, background: "rgba(255,255,255,0.04)" }}>
                <p style={{ margin: 0, color: "#94a3b8", fontSize: 13 }}>Yesterday's Workout</p>
                <p style={{ margin: "6px 0 0", fontWeight: "bold", color: "#f8fafc" }}>
                  Completed: {todayLog.workoutCompleted || "N/A"} • Actual RPE {todayLog.actualRPE || "N/A"}
                </p>
              </div>


              <div style={{ border: "1px solid rgba(148, 163, 184, 0.18)", borderRadius: 12, padding: 12, background: "rgba(255,255,255,0.04)" }}>
                <p style={{ margin: 0, color: "#94a3b8", fontSize: 13 }}>Notes</p>
                <p style={{ margin: "6px 0 0", fontWeight: "bold", whiteSpace: "pre-wrap", color: "#f8fafc" }}>
                  {todayLog.notes || "None"}
                </p>
              </div>
            </div>
          ) : (
            <div
              style={{
                border: "1px solid rgba(148, 163, 184, 0.18)",
                borderRadius: 12,
                padding: 14,
                background: "rgba(255,255,255,0.04)",
              }}
            >
              <p style={{ margin: 0, color: "#cbd5e1" }}>
                No readiness survey has been submitted for today yet.
              </p>
            </div>
          )}

          <button onClick={() => setActiveTab("log")} style={buttonStyle}>
            {todayLog ? "Update Readiness Survey" : "Complete Readiness Survey"}
          </button>
        </div>
      </section>

      <section style={{ ...cardStyle, marginTop: 18 }}>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            gap: 12,
            marginBottom: 12,
          }}
        >
          <h2 style={{ margin: 0, textTransform: "uppercase", fontSize: 22 }}>
            Stress / Sleep / Readiness
          </h2>
        </div>

        {renderScatterPlot({
          data: athleteScatterData,
          title: "Recent readiness scatter",
          xLabel: "Stress score",
          yLabel: "Sleep score",
          fallbackMessage: "No readiness data available yet.",
        })}
      </section>

      <section style={{ ...cardStyle, marginTop: 18 }}>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            gap: 12,
            marginBottom: 12,
          }}
        >
          <h2 style={{ margin: 0, textTransform: "uppercase", fontSize: 22 }}>
            Readiness Trend
          </h2>
        </div>

        {renderLineChart({
          data: athleteReadinessTrend,
          title: "Recent readiness trend",
          fallbackMessage: "No readiness trend data available yet.",
        })}
      </section>

      <section style={{ ...cardStyle, marginTop: 18 }}>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            gap: 12,
            marginBottom: 12,
          }}
        >
          <h2 style={{ margin: 0, textTransform: "uppercase", fontSize: 22 }}>
            Recent Coach Notes
          </h2>
          <button
            onClick={() => setActiveTab("history")}
            style={{
              border: "none",
              background: "transparent",
              color: "#2563eb",
              fontWeight: "bold",
              cursor: "pointer",
            }}
          >
            View All
          </button>
        </div>

        {recentCoachNotes.length === 0 ? (
          <p style={{ margin: 0, color: "#94a3b8" }}>No recent coach notes yet.</p>
        ) : (
          recentCoachNotes.map((log) => (
            <div
              key={`recent-note-${log.id}`}
              style={{
                border: "1px solid rgba(47,124,255,0.25)",
                borderRadius: 12,
                padding: 14,
                marginBottom: 10,
                background: "rgba(47,124,255,0.08)",
              }}
            >
              <p style={{ margin: "0 0 6px", whiteSpace: "pre-wrap", color: "#f8fafc" }}>
                {log.coachNote}
              </p>
              <p style={{ margin: 0, color: "#94a3b8", fontSize: 13 }}>
                {log.sessionType || "Session"} • {log.sessionDate || "N/A"}
              </p>
            </div>
          ))
        )}
      </section>
    </>
  );

  const renderSessionTab = () => (
    <section style={cardStyle}>
      <h2 style={{ marginTop: 0 }}>Select Session</h2>

      {plannedSessions.length === 0 ? (
        <p>No planned sessions assigned to your group yet.</p>
      ) : (
        <>
          <select
            style={inputStyle}
            value={selectedSessionId}
            onChange={(e) => handleSelectedSessionChange(e.target.value)}
          >
            {plannedSessions.map((s) => (
              <option key={s.id} value={s.id}>
                {formatSessionDate(s)} — {s.sessionType} — {s.sessionGroup || "All"} — RPE {s.plannedRPE}
              </option>
            ))}
          </select>

          {selectedSession && (
            <div
              style={{
                borderTop: "1px solid rgba(148, 163, 184, 0.18)",
                paddingTop: 10,
                marginTop: 10,
              }}
            >
              <p>
                <strong>{selectedSession.sessionType}</strong>
              </p>
              <p>Date: {selectedSession.sessionDate || "N/A"}</p>
              <p>Group: {selectedSession.sessionGroup || "All"}</p>
              <p>Planned RPE: {selectedSession.plannedRPE}</p>
              <p style={{ whiteSpace: "pre-wrap" }}>
                Notes: {selectedSession.workoutNotes || "None"}
              </p>
            </div>
          )}
        </>
      )}
    </section>
  );

  const renderLogTab = () => (
    <section style={cardStyle}>
      <h2 style={{ marginTop: 0 }}>
        {editingLogId ? "Edit Readiness Log" : "Readiness Log"}
      </h2>

      <form onSubmit={handleSubmitReadiness}>
        <select
          style={inputStyle}
          value={selectedSessionId}
          onChange={(e) => handleSelectedSessionChange(e.target.value)}
        >
          <option value="">Select Session</option>
          {plannedSessions.map((session) => (
            <option key={session.id} value={session.id}>
              {formatSessionDate(session)} — {session.sessionType || "Session"} — {session.sessionGroup || "All"} — RPE {session.plannedRPE || "N/A"}
            </option>
          ))}
        </select>

        <input
          style={inputStyle}
          type="number"
          placeholder="Sleep Hours"
          value={sleepHours}
          onChange={(e) => setSleepHours(e.target.value)}
        />

        <input
          style={inputStyle}
          type="number"
          placeholder="Sleep Quality 1-10"
          value={sleepQuality}
          onChange={(e) => setSleepQuality(e.target.value)}
        />

        <input
          style={inputStyle}
          type="number"
          placeholder="Stress 1-10"
          value={stress}
          onChange={(e) => setStress(e.target.value)}
        />

        <input
          style={inputStyle}
          type="number"
          placeholder="Soreness 1-10"
          value={soreness}
          onChange={(e) => setSoreness(e.target.value)}
        />

        <input
          style={inputStyle}
          type="number"
          placeholder="Mood 1-10"
          value={mood}
          onChange={(e) => setMood(e.target.value)}
        />

        <input
          style={inputStyle}
          type="number"
          placeholder="Yesterday's RPE"
          value={actualRPE}
          onChange={(e) => setActualRPE(e.target.value)}
        />

        <select
          style={inputStyle}
          value={shouldTrainToday}
          onChange={(e) => setShouldTrainToday(e.target.value)}
        >
          <option value="Yes">Should Train Today: Yes</option>
          <option value="No">Should Train Today: No</option>
          <option value="Unsure">Should Train Today: Unsure</option>
        </select>

        <select
          style={inputStyle}
          value={workoutCompleted}
          onChange={(e) => setWorkoutCompleted(e.target.value)}
        >
          <option value="Yes">Yesterday's Workout Completed: Yes</option>
          <option value="Modified">Yesterday's Workout Completed: Modified</option>
          <option value="No">Yesterday's Workout Completed: No</option>
        </select>

        <textarea
          style={{
            ...inputStyle,
            minHeight: 100,
            resize: "vertical",
          }}
          placeholder="Notes"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
        />

        <button type="submit" style={buttonStyle}>
          {editingLogId ? "Update Readiness" : "Save Readiness"}
        </button>

        {editingLogId && (
          <button
            type="button"
            onClick={() => {
              setEditingLogId(null);
              setSleepHours("");
              setSleepQuality("");
              setStress("");
              setSoreness("");
              setMood("");
              setActualRPE("");
              setShouldTrainToday("Yes");
              setWorkoutCompleted("Yes");
              setNotes("");
            }}
            style={secondaryButtonStyle}
          >
            Cancel Edit
          </button>
        )}
      </form>
    </section>
  );

  const renderHistoryTab = () => (
    <section style={cardStyle}>
      <h2 style={{ marginTop: 0 }}>History</h2>

      {readinessLogs.length === 0 ? (
        <p>No readiness logs yet.</p>
      ) : (
        readinessLogs.map((log) => {
          const color = getReadinessColor(log.readinessRatio);

          return (
            <div
              key={log.id}
              style={{
                border: `2px solid ${color}`,
                borderRadius: 12,
                padding: 12,
                marginBottom: 12,
                background: "rgba(15, 23, 42, 0.7)",
                wordBreak: "break-word",
              }}
            >
              <p>
                <span style={badgeStyle(color)}>{getReadinessStatus(log.readinessRatio)}</span>
              </p>

              <p>
                <strong>{log.sessionType || "Session"}</strong>
              </p>
              <p>Date: {log.sessionDate || "N/A"}</p>
              <p>Group: {log.sessionGroup || "All"}</p>
              <p>Planned RPE: {log.plannedRPE || "N/A"}</p>
              <p>Actual RPE: {log.actualRPE || "N/A"}</p>
              <p>Should Train Today: {log.shouldTrainToday || "N/A"}</p>
              <p>Yesterday's Workout Completed: {log.workoutCompleted || "N/A"}</p>

              <p style={{ whiteSpace: "pre-wrap" }}>
                Athlete Notes: {log.notes || "None"}
              </p>

              <p style={{ whiteSpace: "pre-wrap" }}>
                <strong>Coach Note:</strong> {log.coachNote || "No coach note yet."}
              </p>

              {log.coachNoteUpdatedAt && (
                <p style={{ color: "#94a3b8", fontSize: 13 }}>
                  Coach Message Sent: {formatTimestamp(log.coachNoteUpdatedAt)}
                </p>
              )}

              <button onClick={() => handleEditLog(log)} style={editButtonStyle}>
                Edit Log
              </button>

              <button onClick={() => handleDeleteLog(log.id)} style={deleteButtonStyle}>
                Delete Log
              </button>
            </div>
          );
        })
      )}
    </section>
  );

  if (loading) {
    return <p style={{ padding: 20 }}>Loading...</p>;
  }

  return (
    <main
      className={styles.dashboardPage}
      style={{
        fontFamily: "Arial, sans-serif",
        minHeight: "100vh",
      }}
    >
      {renderMailboxPanel()}

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

      <div style={{ maxWidth: 920, margin: "0 auto", width: "100%", padding: isMobile ? "6px 12px 4px" : "0 18px 6px", boxSizing: "border-box" }}>
        <div
          style={{
            display: "flex",
            flexDirection: isMobile ? "column" : "row",
            justifyContent: "space-between",
            alignItems: isMobile ? "stretch" : "center",
            gap: isMobile ? 10 : 0,
            marginBottom: 0,
          }}
        >
          <div style={{ position: "relative" }}>
            <button
              type="button"
              onClick={() => setAthleteMenuOpen((current) => !current)}
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
            >
              ☰
            </button>

            {athleteMenuOpen && (
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
                  minWidth: 210,
                  display: "flex",
                  flexDirection: "column",
                  gap: 8,
                  marginTop: 12,
                }}
              >
                {[
                  { key: "overview", label: "Today" },
                  { key: "session", label: "Workouts" },
                  { key: "log", label: "Readiness" },
                  { key: "history", label: "History" },
                ].map((item) => (
                  <button
                    key={item.key}
                    onClick={() => {
                      setActiveTab(item.key);
                      setAthleteMenuOpen(false);
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
                    }}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            )}
          </div>

          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: isMobile ? "space-between" : "flex-start",
              gap: 10,
              width: isMobile ? "100%" : undefined,
            }}
          >
            <button
              onClick={handleOpenMailbox}
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
              }}
              title="Mailbox"
              aria-label="Open mailbox"
            >
              <svg
                width="28"
                height="28"
                viewBox="0 0 24 24"
                fill="none"
                stroke="#f8fafc"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <rect x="3" y="5" width="18" height="14" rx="2" />
                <path d="M3 7l9 6 9-6" />
              </svg>

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

            <button
              onClick={async () => {
                await signOut(auth);
                router.push("/");
              }}
              style={{
                ...buttonStyle,
                background: "#111827",
                borderColor: "#111827",
              }}
            >
              Sign Out
            </button>
          </div>
        </div>
      </div>

      <div style={{ maxWidth: 920, margin: "0 auto", width: "100%", padding: isMobile ? "4px 10px 12px" : "4px 18px 18px", boxSizing: "border-box" }}>

        {activeTab === "overview" && renderOverview()}
        {activeTab === "session" && renderSessionTab()}
        {activeTab === "log" && renderLogTab()}
        {activeTab === "history" && renderHistoryTab()}
      </div>
    </main>
  );
}