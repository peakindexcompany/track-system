"use client";

import Image from "next/image";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { FcGoogle } from "react-icons/fc";
import { FaApple } from "react-icons/fa";
import styles from "./page.module.css";

import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signInWithPopup,
  GoogleAuthProvider,
  OAuthProvider,
} from "firebase/auth";

import {
  doc,
  getDoc,
  setDoc,
  serverTimestamp,
} from "firebase/firestore";

import { auth, db } from "../../lib/firebase";

const googleProvider = new GoogleAuthProvider();
const appleProvider = new OAuthProvider("apple.com");

export default function LoginSignup() {
  const router = useRouter();

  const [isSignup, setIsSignup] = useState(false);

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);

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
    setStatusMessage("No user profile found.");
    return;
  }

  const data = userSnap.data();

  const role = String(
    data.role ||
      data.accountType ||
      data.userType ||
      "athlete"
  )
    .toLowerCase()
    .trim();

  if (role === "coach") {
    router.push("/coach");
    return;
  }

  router.push("/athlete");
};

const handleGoogleLogin = async () => {
  setSubmitting(true);
  setStatusMessage("");

  try {
    const result = await signInWithPopup(auth, googleProvider);

    const user = result.user;

    const userRef = doc(db, "users", user.uid);
    const userSnap = await getDoc(userRef);

    if (!userSnap.exists()) {
      await setDoc(userRef, {
        uid: user.uid,
        email: user.email,
        name: user.displayName || "",
        role: "athlete",
        teamCode: "",
        eventGroup: "",
        createdAt: serverTimestamp(),
      });
    }

    await routeUserByProfile(user);
  } catch (error) {
    console.error(error);
    setStatusMessage(error.message || "Google sign in failed.");
  } finally {
    setSubmitting(false);
  }
};

const handleAppleLogin = async () => {
  setSubmitting(true);
  setStatusMessage("");

  try {
    const result = await signInWithPopup(auth, appleProvider);

    const user = result.user;

    const userRef = doc(db, "users", user.uid);
    const userSnap = await getDoc(userRef);

    if (!userSnap.exists()) {
      await setDoc(userRef, {
        uid: user.uid,
        email: user.email,
        name: user.displayName || "",
        role: "athlete",
        teamCode: "",
        eventGroup: "",
        createdAt: serverTimestamp(),
      });
    }

    await routeUserByProfile(user);
  } catch (error) {
    console.error(error);
    setStatusMessage(error.message || "Apple sign in failed.");
  } finally {
    setSubmitting(false);
  }
};

const generateCoachTeamCode = () =>
  Math.random().toString(36).substring(2, 8).toUpperCase();
const handleSubmit = async (e) => {
  e.preventDefault();

  setSubmitting(true);
  setStatusMessage("");

  try {
    if (isSignup) {
      if (!name.trim()) {
        throw new Error("Please enter your name.");
      }

      if (accountType === "athlete") {
        if (!teamCode.trim()) {
          throw new Error("Please enter your Team Code.");
        }

        if (!eventGroup) {
          throw new Error("Please select your Event Group.");
        }
      }

      const userCredential =
        await createUserWithEmailAndPassword(
          auth,
          email.trim(),
          password
        );

      const user = userCredential.user;

      const finalTeamCode =
        accountType === "coach"
          ? generateCoachTeamCode()
          : teamCode.trim().toUpperCase();

      await setDoc(doc(db, "users", user.uid), {
        uid: user.uid,
        email: user.email,
        name: name.trim(),
        role: accountType,
        teamCode: finalTeamCode,
        eventGroup:
          accountType === "athlete"
            ? eventGroup
            : "",
        createdAt: serverTimestamp(),
      });

      if (accountType === "coach") {
        setStatusMessage(
          `Account created! Your Team Code is ${finalTeamCode}`
        );
      }

      await routeUserByProfile(user);
    } else {
      const userCredential =
        await signInWithEmailAndPassword(
          auth,
          email.trim(),
          password
        );

      await routeUserByProfile(
        userCredential.user
      );
    }
  } catch (error) {
    console.error(error);
    setStatusMessage(
      error.message || "Something went wrong."
    );
  } finally {
    setSubmitting(false);
  }
};

return (
  <main className={styles.page}>
    <div className={styles.card}>
  <div
    style={{
      padding: "20px 32px",
    }}
  >
    <div className={styles.logoContainer}>
      <Image
  src="/peak-index-logo-finalv2.png"
  alt="Peak Index"
  width={400}
height={400}
  className={styles.logo}
  priority
/>
    </div>
        {/* Header */}

        <div
  style={{
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    marginTop: -20,
    marginBottom: 10,
  }}
>

<p
  style={{
    marginTop: -50,
    textAlign: "center",
    color: "#9ca8b8",
    fontSize: 15,
    lineHeight: 1.6,
  }}
>
  Performance readiness, simplified.
</p>
        </div>

        {/* Social Login */}

        <button
          type="button"
          onClick={handleGoogleLogin}
          disabled={submitting}
          className={`${styles.socialButton} ${styles.googleButton}`}

        >
          <FcGoogle size={22} />
          Continue with Google
        </button>

        <button
          type="button"
          onClick={handleAppleLogin}
          disabled={submitting}
          className={`${styles.socialButton} ${styles.appleButton}`}
        >
          <FaApple size={22} />
          Continue with Apple
        </button>

        <div
          style={{
            display: "flex",
            alignItems: "center",
            margin: "30px 0",
          }}
        >
          <div
            style={{
              flex: 1,
              height: 1,
              background: "rgba(255,255,255,0.15)",
            }}
          />

          <span
            style={{
              padding: "0 16px",
              fontSize: 13,
              color: "#9ca3af",
              fontWeight: 700,
            }}
          >
            {isSignup
              ? "OR SIGN UP WITH EMAIL"
              : "OR SIGN IN WITH EMAIL"}
          </span>

          <div
            style={{
              flex: 1,
              height: 1,
              background: "rgba(255,255,255,0.15)",
            }}
          />
        </div>

        {statusMessage && (
          <div
            style={{
              background: "rgba(47,124,255,0.12)",
color: "#ffffff",
border: "1px solid rgba(47,124,255,0.35)",
              padding: "14px 18px",
              borderRadius: 12,
              marginBottom: 20,
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
  placeholder="Full Name"
  value={name}
  onChange={(e) => setName(e.target.value)}
  className={styles.input}
/>

    <div style={{ marginBottom: 18 }}>
      <div
        style={{
          fontWeight: 700,
          marginBottom: 12,
          color: "#ffffff",
        }}
      >
        Choose Account Type
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: 14,
        }}
      >
        <button
          type="button"
          onClick={() => {
            setAccountType("athlete");
            setTeamCode("");
            setEventGroup("");
          }}
          style={{
            padding: 20,
            borderRadius: 16,
            border:
              accountType === "athlete"
                ? "2px solid #2f7cff"
                : "1px solid #d1d5db",
            background:
  accountType === "athlete"
    ? "rgba(47,124,255,0.18)"
    : "rgba(255,255,255,0.05)",
            cursor: "pointer",
            textAlign: "left",
            transition: ".2s",
          }}
        >
          <div
  style={{
    fontWeight: 700,
    marginTop: 10,
    color: "#ffffff",
  }}
>
  Athlete
</div>

          <div
            style={{
              marginTop: 6,
              color: "#b7c2d1",
              fontSize: 13,
            }}
          >
            Join an existing team using your Team Code.
          </div>
        </button>

        <button
          type="button"
          onClick={() => {
            setAccountType("coach");
            setTeamCode("");
            setEventGroup("");
          }}
          style={{
            padding: 20,
            borderRadius: 16,
            border:
  accountType === "coach"
    ? "2px solid #2f7cff"
    : "1px solid rgba(255,255,255,0.15)",
            background:
  accountType === "coach"
    ? "rgba(47,124,255,0.18)"
    : "rgba(255,255,255,0.05)",
            cursor: "pointer",
            textAlign: "left",
            transition: ".2s",
          }}
        >
          

          <div
  style={{
    fontWeight: 700,
    marginTop: 10,
    color: "#ffffff",
  }}
>
  Coach
</div>

          <div
            style={{
              marginTop: 6,
              color: "#b7c2d1",
fontSize: 13,
            }}
          >
            Create and manage your own team.
          </div>
        </button>
      </div>
    </div>

    {accountType === "coach" && (
      <div
        style={{
          marginBottom: 18,
          padding: 16,
          borderRadius: 12,
          background: "rgba(47,124,255,0.12)",
color: "#ffffff",
border: "1px solid rgba(47,124,255,0.35)",
          fontSize: 14,
        }}
      >
        ✓ Your Team Code will be generated automatically after your account is created.
      </div>
    )}

    {accountType === "athlete" && (
      <>
        <input
  type="text"
  placeholder="Team Code"
  value={teamCode}
  onChange={(e) => setTeamCode(e.target.value.toUpperCase())}
  className={styles.input}
/>

        <select
          value={eventGroup}
          onChange={(e) => setEventGroup(e.target.value)}
          className={styles.input}
        >
          <option value="">Select Event Group</option>
          <option value="Sprints/Jumps">Sprints/Jumps</option>
          <option value="400/400H/800">400/400H/800</option>
          <option value="Mid-Distance">Mid-Distance</option>
          <option value="Distance">Distance</option>
          <option value="Throws">Throws</option>
          <option value="Multi">Multi</option>
        </select>
      </>
    )}
  </>
)}
<input
  type="email"
  placeholder="Email Address"
  value={email}
  onChange={(e) => setEmail(e.target.value)}
  className={styles.input}
/>

<div
  style={{
    position: "relative",
    marginBottom: 14,
  }}
>
  <input
    type={showPassword ? "text" : "password"}
    placeholder="Password"
    value={password}
    onChange={(e) => setPassword(e.target.value)}
    className={styles.input}
  />

  <button
    type="button"
    onClick={() => setShowPassword(!showPassword)}
    className={styles.passwordToggle}
  >
    {showPassword ? "Hide" : "Show"}
  </button>
</div>

<button
  type="submit"
  disabled={submitting}
  className={styles.submitButton}
>
  {submitting
    ? "Please wait..."
    : isSignup
    ? "Create Account"
    : "Sign In"}
</button>

<div
  style={{
    marginTop: 24,
    textAlign: "center",
    color: "#b7c2d1",
    fontSize: 15,
  }}
>
  {isSignup
    ? "Already have an account?"
    : "Need an account?"}

  <button
    type="button"
    onClick={() => {
      setIsSignup(!isSignup);
      setStatusMessage("");
    }}
    className={styles.toggleButton}
  >
    {isSignup ? "Sign In" : "Sign Up"}
  </button>
</div>
                </form>

        <div
          style={{
            marginTop: 36,
            paddingTop: 24,
            borderTop: "1px solid rgba(255,255,255,0.1)",
            textAlign: "center",
            color: "#9ca3af",
            fontSize: 13,
          }}
        >
          Peak Index © {new Date().getFullYear()}
        </div>
      </div>
    </div>
  </main>
);
}
