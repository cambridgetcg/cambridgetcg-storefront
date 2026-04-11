"use client";

import { useState, useEffect, useCallback } from "react";
import type { UserVerification, VerificationStatus } from "@/lib/trust/types";

const STATUS_COLORS: Record<VerificationStatus, string> = {
  pending: "bg-amber-500/20 text-amber-400",
  verified: "bg-emerald-500/20 text-emerald-400",
  rejected: "bg-red-500/20 text-red-400",
  expired: "bg-neutral-500/20 text-neutral-400",
};

function maskValue(value: string | null): string {
  if (!value) return "---";
  if (value.length <= 4) return value;
  return "****" + value.slice(-4);
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function computeAge(dob: string): number {
  const birth = new Date(dob);
  const now = new Date();
  let age = now.getFullYear() - birth.getFullYear();
  const m = now.getMonth() - birth.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < birth.getDate())) age--;
  return age;
}

export default function AdminVerificationsPage() {
  const [authed, setAuthed] = useState(false);
  const [password, setPassword] = useState("");
  const [loginError, setLoginError] = useState("");
  const [verifications, setVerifications] = useState<UserVerification[]>([]);
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [filter, setFilter] = useState<"all" | "pending">("all");
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [rejectReasons, setRejectReasons] = useState<Record<string, string>>({});
  const [adminNotes, setAdminNotes] = useState<Record<string, string>>({});

  const fetchVerifications = useCallback(async (pendingOnly = false) => {
    setLoading(true);
    try {
      const url = pendingOnly
        ? "/api/trust/verify?admin=true&pending=true"
        : "/api/trust/verify?admin=true";
      const res = await fetch(url);
      if (res.status === 401) {
        setAuthed(false);
        return;
      }
      const data = await res.json();
      setVerifications(data.verifications || []);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetch("/api/trust/verify?admin=true")
      .then((res) => {
        if (res.ok) {
          setAuthed(true);
          return res.json();
        }
        return null;
      })
      .then((data) => {
        if (data?.verifications) setVerifications(data.verifications);
      });
  }, []);

  useEffect(() => {
    if (authed) fetchVerifications(filter === "pending");
  }, [filter, authed, fetchVerifications]);

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setLoginError("");
    try {
      const res = await fetch("/api/admin/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      if (!res.ok) {
        setLoginError("Wrong password.");
        return;
      }
      setAuthed(true);
      setPassword("");
      fetchVerifications();
    } catch {
      setLoginError("Network error.");
    }
  }

  async function handleApprove(userId: string) {
    setActionLoading(userId);
    try {
      const res = await fetch("/api/trust/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "approve",
          userId,
          notes: adminNotes[userId] || null,
        }),
      });
      if (res.ok) {
        setVerifications((prev) =>
          prev.map((v) =>
            v.user_id === userId
              ? { ...v, status: "verified" as VerificationStatus, verified_at: new Date().toISOString(), admin_notes: adminNotes[userId] || v.admin_notes }
              : v
          )
        );
      }
    } catch {
      // ignore
    } finally {
      setActionLoading(null);
    }
  }

  async function handleReject(userId: string) {
    const reason = rejectReasons[userId];
    if (!reason?.trim()) return;
    setActionLoading(userId);
    try {
      const res = await fetch("/api/trust/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "reject", userId, reason }),
      });
      if (res.ok) {
        setVerifications((prev) =>
          prev.map((v) =>
            v.user_id === userId
              ? { ...v, status: "rejected" as VerificationStatus, rejected_reason: reason }
              : v
          )
        );
      }
    } catch {
      // ignore
    } finally {
      setActionLoading(null);
    }
  }

  // ── Login Screen ──
  if (!authed) {
    return (
      <main className="min-h-screen bg-neutral-950 flex items-center justify-center">
        <form onSubmit={handleLogin} className="w-full max-w-sm px-4">
          <h1 className="text-2xl font-bold text-white text-center mb-8">Admin</h1>
          <input
            type="password"
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoFocus
            className="w-full px-4 py-3 bg-neutral-900 border border-neutral-800 rounded-lg text-white placeholder-neutral-500 focus:outline-none focus:ring-2 focus:ring-amber-500/50 mb-4"
          />
          {loginError && (
            <p className="text-sm text-red-400 mb-4">{loginError}</p>
          )}
          <button
            type="submit"
            className="w-full py-3 bg-amber-500 text-black font-bold rounded-lg hover:bg-amber-400 transition"
          >
            Log In
          </button>
        </form>
      </main>
    );
  }

  // ── Stats ──
  const total = verifications.length;
  const pendingCount = verifications.filter((v) => v.status === "pending").length;
  const verifiedCount = verifications.filter((v) => v.status === "verified").length;
  const rejectedCount = verifications.filter((v) => v.status === "rejected").length;

  return (
    <main className="min-h-screen bg-neutral-950">
      <div className="max-w-6xl mx-auto px-4 py-8">
        <div className="flex items-center justify-between mb-8">
          <h1 className="text-2xl font-bold text-white">Verification Reviews</h1>
          <button
            onClick={() => fetchVerifications(filter === "pending")}
            disabled={loading}
            className="px-4 py-2 bg-neutral-800 text-white text-sm rounded-lg hover:bg-neutral-700 transition disabled:opacity-50"
          >
            {loading ? "Loading..." : "Refresh"}
          </button>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
          <div className="bg-neutral-900 rounded-xl p-4">
            <p className="text-xs text-neutral-500 uppercase tracking-wide">Total</p>
            <p className="text-2xl font-bold text-white mt-1">{total}</p>
          </div>
          <div className="bg-neutral-900 rounded-xl p-4">
            <p className="text-xs text-neutral-500 uppercase tracking-wide">Pending</p>
            <p className="text-2xl font-bold text-amber-400 mt-1">{pendingCount}</p>
          </div>
          <div className="bg-neutral-900 rounded-xl p-4">
            <p className="text-xs text-neutral-500 uppercase tracking-wide">Verified</p>
            <p className="text-2xl font-bold text-emerald-400 mt-1">{verifiedCount}</p>
          </div>
          <div className="bg-neutral-900 rounded-xl p-4">
            <p className="text-xs text-neutral-500 uppercase tracking-wide">Rejected</p>
            <p className="text-2xl font-bold text-red-400 mt-1">{rejectedCount}</p>
          </div>
        </div>

        {/* Filter */}
        <div className="flex gap-2 mb-6">
          {(["all", "pending"] as const).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`text-sm px-4 py-2 rounded-lg transition ${
                filter === f
                  ? "bg-amber-500 text-black font-bold"
                  : "bg-neutral-800 text-neutral-400 hover:bg-neutral-700"
              }`}
            >
              {f === "all" ? "All" : "Pending"}
            </button>
          ))}
        </div>

        {/* List */}
        {verifications.length === 0 && !loading && (
          <p className="text-neutral-500 text-center py-12">No verifications found.</p>
        )}

        <div className="space-y-3">
          {verifications.map((v) => (
            <div key={v.id} className="bg-neutral-900 rounded-xl overflow-hidden">
              {/* Row */}
              <button
                onClick={() => setExpanded(expanded === v.id ? null : v.id)}
                className="w-full px-4 py-4 flex items-center gap-4 text-left hover:bg-neutral-800/50 transition"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-3 flex-wrap">
                    <span className="text-sm font-bold text-white">{v.full_legal_name}</span>
                    <span
                      className={`text-xs font-medium px-2 py-0.5 rounded-full ${STATUS_COLORS[v.status]}`}
                    >
                      {v.status}
                    </span>
                  </div>
                  <p className="text-sm text-neutral-400 mt-1">
                    {v.postcode}
                  </p>
                </div>
                <div className="text-right shrink-0">
                  <p className="text-xs text-neutral-500">{formatDate(v.created_at)}</p>
                </div>
                <span className="text-neutral-600 text-sm">
                  {expanded === v.id ? "\u25B2" : "\u25BC"}
                </span>
              </button>

              {/* Expanded detail */}
              {expanded === v.id && (
                <div className="px-4 pb-4 border-t border-neutral-800">
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-4 mt-4 mb-4 text-sm">
                    <div>
                      <span className="text-neutral-500">Full Address</span>
                      <p className="text-white">
                        {v.address_line1}
                        {v.address_line2 ? `, ${v.address_line2}` : ""}
                        <br />
                        {v.city}
                        {v.county ? `, ${v.county}` : ""}, {v.postcode}
                        <br />
                        {v.country}
                      </p>
                    </div>
                    <div>
                      <span className="text-neutral-500">Date of Birth</span>
                      <p className="text-white">{formatDate(v.date_of_birth)}</p>
                      <span className="text-neutral-500 mt-2 block">Age</span>
                      <p className="text-white">{computeAge(v.date_of_birth)}</p>
                    </div>
                    <div>
                      <span className="text-neutral-500">Phone</span>
                      <p className="text-white">
                        {v.phone || "---"}
                        {v.phone_verified && (
                          <span className="ml-2 text-xs text-emerald-400">verified</span>
                        )}
                      </p>
                    </div>
                  </div>

                  {/* Bank details (masked) */}
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-4 mb-4 text-sm">
                    <div>
                      <span className="text-neutral-500">Sort Code</span>
                      <p className="text-white font-mono">{maskValue(v.bank_sort_code)}</p>
                    </div>
                    <div>
                      <span className="text-neutral-500">Account Number</span>
                      <p className="text-white font-mono">{maskValue(v.bank_account_number)}</p>
                    </div>
                    <div>
                      <span className="text-neutral-500">Account Name</span>
                      <p className="text-white">{v.bank_account_name || "---"}</p>
                    </div>
                  </div>

                  {v.rejected_reason && (
                    <div className="mb-4">
                      <span className="text-xs text-neutral-500">Rejection Reason</span>
                      <p className="text-sm text-red-400 mt-1">{v.rejected_reason}</p>
                    </div>
                  )}

                  {v.admin_notes && (
                    <div className="mb-4">
                      <span className="text-xs text-neutral-500">Admin Notes</span>
                      <p className="text-sm text-neutral-300 mt-1">{v.admin_notes}</p>
                    </div>
                  )}

                  {/* Actions for pending */}
                  {v.status === "pending" && (
                    <div className="border-t border-neutral-800 pt-4 space-y-3">
                      {/* Admin notes */}
                      <div>
                        <label className="text-xs text-neutral-500 block mb-1">Admin Notes</label>
                        <textarea
                          value={adminNotes[v.user_id] ?? ""}
                          onChange={(e) =>
                            setAdminNotes((prev) => ({ ...prev, [v.user_id]: e.target.value }))
                          }
                          rows={2}
                          placeholder="Optional notes..."
                          className="w-full px-3 py-2 bg-neutral-800 border border-neutral-700 rounded-lg text-white text-sm placeholder-neutral-500 focus:outline-none focus:ring-2 focus:ring-amber-500/50 resize-none"
                        />
                      </div>

                      <div className="flex items-end gap-3 flex-wrap">
                        {/* Approve */}
                        <button
                          onClick={() => handleApprove(v.user_id)}
                          disabled={actionLoading === v.user_id}
                          className="px-4 py-2 bg-emerald-600 text-white text-sm font-bold rounded-lg hover:bg-emerald-500 transition disabled:opacity-50"
                        >
                          {actionLoading === v.user_id ? "..." : "Approve"}
                        </button>

                        {/* Reject */}
                        <div className="flex items-end gap-2 flex-1 min-w-[200px]">
                          <input
                            type="text"
                            value={rejectReasons[v.user_id] ?? ""}
                            onChange={(e) =>
                              setRejectReasons((prev) => ({
                                ...prev,
                                [v.user_id]: e.target.value,
                              }))
                            }
                            placeholder="Rejection reason..."
                            className="flex-1 px-3 py-2 bg-neutral-800 border border-neutral-700 rounded-lg text-white text-sm placeholder-neutral-500 focus:outline-none focus:ring-2 focus:ring-red-500/50"
                          />
                          <button
                            onClick={() => handleReject(v.user_id)}
                            disabled={
                              actionLoading === v.user_id ||
                              !rejectReasons[v.user_id]?.trim()
                            }
                            className="px-4 py-2 bg-red-600 text-white text-sm font-bold rounded-lg hover:bg-red-500 transition disabled:opacity-50"
                          >
                            Reject
                          </button>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </main>
  );
}
