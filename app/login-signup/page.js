"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { auth, db } from "../../lib/firebase";
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
} from "firebase/auth";
import { doc, setDoc, getDoc } from "firebase/firestore";

export default function LoginSignup() {
  const router = useRouter();

  const [isSignup, setIsSignup] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [accountType, setAccountType] = useState("athlete");
  const [teamCode, setTeamCode] = useState("");
  const [eventGroup, setEventGroup] = useState("");
  const [statusMessage, setStatusMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const routeUserByProfile = async (user) => {
    const userRef = doc(db, "users", user.uid);
    const userSnap = await getDoc(userRef);

    if (!userSnap.exists()) {
      setStatusMessage("No user profile found. Please sign up first.");
      return;
    }

    const data = userSnap.data();
    const role = String(data.role || data.accountType || data.userType || "")
      .toLowerCase()
      .trim();

    if (role === "coach") {
      router.push("/coach");
      return;
    }

    if (role === "athlete") {
      router.push("/athlete");
      return;
    }

    setStatusMessage("User role not found. Please sign up again.");
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setStatusMessage("");
    setSubmitting(true);

    try {
      if (isSignup) {
        if (!name.trim()) {
          setStatusMessage("Enter your name.");
          setSubmitting(false);
          return;
        }

        if (accountType === "athlete" && !teamCode.trim()) {
          setStatusMessage("Enter your team code.");
          setSubmitting(false);
          return;
        }

        if (accountType === "athlete" && !eventGroup) {
          setStatusMessage("Select an event group.");
          setSubmitting(false);
          return;
        }

        const userCredential = await createUserWithEmailAndPassword(
          auth,
          email.trim(),
          password
        );

        const user = userCredential.user;

        const finalTeamCode =
          accountType === "coach"
            ? Math.random().toString(36).substring(2, 8).toUpperCase()
            : teamCode.trim().toUpperCase();
        
        await setDoc(doc(db, "users", user.uid), {
          uid: user.uid,
          email: user.email,
          name: name.trim(),
          role: accountType,
          teamCode: finalTeamCode,
          eventGroup: accountType === "athlete" ? eventGroup : "",
          createdAt: new Date(),
        });

        if (accountType === "coach") {
          setStatusMessage(`Your Team Code: ${finalTeamCode}`);

          setTimeout(async () => {
            await routeUserByProfile(user);
          }, 1200);

          return;
        }

        await routeUserByProfile(user);
      } else {
        const userCredential = await signInWithEmailAndPassword(
          auth,
          email.trim(),
          password
        );

        await routeUserByProfile(userCredential.user);
      }
    } catch (error) {
      console.error(error);
      setStatusMessage(error.message || "Something went wrong.");
    } finally {
      setSubmitting(false);
    }
  };

  const inputStyle = {
    display: "block",
    width: "100%",
    maxWidth: 420,
    marginBottom: 10,
    padding: 10,
    border: "1px solid #d1d5db",
    borderRadius: 10,
    fontSize: 14,
    boxSizing: "border-box",
  };

  const buttonStyle = {
    padding: "10px 16px",
    border: "none",
    borderRadius: 10,
    background: "#111827",
    color: "white",
    cursor: submitting ? "not-allowed" : "pointer",
    opacity: submitting ? 0.7 : 1,
    minHeight: 42,
  };

  return (
    <main
      style={{
        minHeight: "100vh",
        padding: 24,
        fontFamily: "Arial, sans-serif",
        background: "#f9fafb",
      }}
    >
      <div
        style={{
          maxWidth: 520,
          margin: "0 auto",
          background: "white",
          border: "1px solid #e5e7eb",
          borderRadius: 16,
          padding: 24,
          boxShadow: "0 1px 4px rgba(0,0,0,0.08)",
        }}
      >
        <h1 style={{ marginTop: 0 }}>{isSignup ? "Sign Up" : "Login"}</h1>

        {statusMessage && (
          <div
            style={{
              background: "#111827",
              color: "white",
              padding: "10px 14px",
              borderRadius: 10,
              marginBottom: 16,
              fontSize: 14,
            }}
          >
            {statusMessage}
          </div>
        )}

        <form onSubmit={handleSubmit}>
          {isSignup && (
            <>
              <input
                type="text"
                placeholder="Name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                style={inputStyle}
                required
              />

              <select
                value={accountType}
                onChange={(e) => {
                  setAccountType(e.target.value);
                  setTeamCode("");
                  setEventGroup("");
                }}
                style={inputStyle}
              >
                <option value="athlete">Athlete</option>
                <option value="coach">Coach</option>
              </select>

              {accountType === "athlete" && (
                <>
                  <input
                    type="text"
                    placeholder="Team Code"
                    value={teamCode}
                    onChange={(e) => setTeamCode(e.target.value)}
                    style={inputStyle}
                    required
                  />

                  <select
                    value={eventGroup}
                    onChange={(e) => setEventGroup(e.target.value)}
                    style={inputStyle}
                    required
                  >
                    <option value="">Select Event Group</option>
                    <option value="Sprints/Jumps">Sprints/Jumps</option>
                    <option value="400/400h/800">400/400h/800</option>
                    <option value="Throws">Throws</option>
                    <option value="Distance">Distance</option>
                    <option value="Mid-Distance">Mid-Distance</option>
                    <option value="Multi">Multi</option>
                  </select>
                </>
              )}
            </>
          )}

          <input
            type="email"
            placeholder="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            style={inputStyle}
            required
          />

          <input
            type="password"
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            style={inputStyle}
            required
          />

          <button type="submit" disabled={submitting} style={buttonStyle}>
            {submitting
              ? "Please wait..."
              : isSignup
              ? "Create Account"
              : "Login"}
          </button>
        </form>

        <button
          type="button"
          onClick={() => {
            setIsSignup(!isSignup);
            setStatusMessage("");
          }}
          style={{
            marginTop: 18,
            border: "none",
            background: "transparent",
            color: "#2563eb",
            cursor: "pointer",
            padding: 0,
            fontSize: 14,
          }}
        >
          {isSignup
            ? "Already have an account? Login"
            : "Need an account? Sign Up"}
        </button>
      </div>
    </main>
  );
}