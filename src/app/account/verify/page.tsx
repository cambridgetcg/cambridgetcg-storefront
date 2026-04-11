"use client";

import { useEffect, useState } from "react";
import { UK_POSTCODE_REGEX } from "@/lib/trust/types";
import type { UserVerification } from "@/lib/trust/types";

export default function VerifyPage() {
  const [verification, setVerification] = useState<UserVerification | null>(null);
  const [loading, setLoading] = useState(true);
  const [loggedIn, setLoggedIn] = useState<boolean | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState("");

  // Form fields
  const [fullName, setFullName] = useState("");
  const [dob, setDob] = useState("");
  const [addressLine1, setAddressLine1] = useState("");
  const [addressLine2, setAddressLine2] = useState("");
  const [city, setCity] = useState("");
  const [county, setCounty] = useState("");
  const [postcode, setPostcode] = useState("");
  const [phone, setPhone] = useState("");
  const [sortCode, setSortCode] = useState("");
  const [accountNumber, setAccountNumber] = useState("");
  const [accountName, setAccountName] = useState("");

  useEffect(() => {
    fetch("/api/auth/session")
      .then((r) => r.json())
      .then((data) => setLoggedIn(!!data?.user?.email))
      .catch(() => setLoggedIn(false));
  }, []);

  useEffect(() => {
    if (loggedIn === false) {
      setLoading(false);
      return;
    }
    if (loggedIn === null) return;

    fetch("/api/trust/verify")
      .then((r) => {
        if (!r.ok) return null;
        return r.json();
      })
      .then((data) => {
        if (data?.verification) {
          setVerification(data.verification);
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [loggedIn]);

  function validateAge(dateStr: string): boolean {
    const birth = new Date(dateStr);
    const today = new Date();
    let age = today.getFullYear() - birth.getFullYear();
    const monthDiff = today.getMonth() - birth.getMonth();
    if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birth.getDate())) {
      age--;
    }
    return age >= 18;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setSuccess(false);

    if (!validateAge(dob)) {
      setError("You must be at least 18 years old.");
      return;
    }

    if (!UK_POSTCODE_REGEX.test(postcode)) {
      setError("Please enter a valid UK postcode.");
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch("/api/trust/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          full_legal_name: fullName,
          date_of_birth: dob,
          address_line1: addressLine1,
          address_line2: addressLine2 || null,
          city,
          county: county || null,
          postcode: postcode.toUpperCase(),
          phone: phone || null,
          bank_sort_code: sortCode || null,
          bank_account_number: accountNumber || null,
          bank_account_name: accountName || null,
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error || "Failed to submit verification.");
      }

      setSuccess(true);
      // Refresh verification status
      const refreshRes = await fetch("/api/trust/verify");
      if (refreshRes.ok) {
        const refreshData = await refreshRes.json();
        if (refreshData?.verification) setVerification(refreshData.verification);
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="h-8 bg-neutral-800 rounded w-48 animate-pulse" />
        <div className="h-64 bg-neutral-900 rounded-xl animate-pulse" />
      </div>
    );
  }

  if (loggedIn === false) {
    return (
      <div className="bg-neutral-900 rounded-xl p-8 text-center">
        <p className="text-neutral-400 mb-3">You need to be signed in to verify your identity.</p>
        <a href="/login" className="text-amber-400 hover:underline text-sm font-medium">
          Sign in
        </a>
      </div>
    );
  }

  const status = verification?.status;

  // Already verified
  if (status === "verified") {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-bold text-white">Verification</h1>
        <div className="bg-neutral-900 rounded-xl p-6">
          <div className="flex items-center gap-3 mb-4">
            <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-semibold bg-emerald-500/15 text-emerald-400 border border-emerald-500/30">
              <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
              </svg>
              Verified
            </span>
          </div>
          <p className="text-neutral-400 text-sm">
            Your identity was verified on{" "}
            <span className="text-white">
              {verification?.verified_at
                ? new Date(verification.verified_at).toLocaleDateString("en-GB", {
                    day: "numeric",
                    month: "long",
                    year: "numeric",
                  })
                : "N/A"}
            </span>
            . You can participate in P2P trades.
          </p>
        </div>
      </div>
    );
  }

  // Pending review
  if (status === "pending") {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-bold text-white">Verification</h1>
        <div className="bg-neutral-900 rounded-xl p-6">
          <div className="flex items-center gap-3 mb-4">
            <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-semibold bg-amber-500/15 text-amber-400 border border-amber-500/30">
              <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
              Under Review
            </span>
          </div>
          <p className="text-neutral-400 text-sm">
            Your verification is being reviewed. This usually takes 1-2 business days.
            We will notify you by email once it is complete.
          </p>
        </div>
      </div>
    );
  }

  // Show form (no verification, or rejected)
  const showRejection = status === "rejected";

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-white">Verification</h1>

      {showRejection && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-4">
          <div className="flex items-center gap-2 mb-2">
            <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-semibold bg-red-500/15 text-red-400 border border-red-500/30">
              Rejected
            </span>
          </div>
          {verification?.rejected_reason && (
            <p className="text-red-300 text-sm">
              Reason: {verification.rejected_reason}
            </p>
          )}
          <p className="text-neutral-400 text-sm mt-2">
            You can resubmit your verification below.
          </p>
        </div>
      )}

      {success && (
        <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-xl p-4">
          <p className="text-emerald-400 text-sm font-medium">
            Verification submitted! We will review within 1-2 business days.
          </p>
        </div>
      )}

      {/* Info box */}
      <div className="bg-amber-500/5 border border-amber-500/20 rounded-xl p-4">
        <p className="text-amber-200/80 text-sm">
          UK residents only. We verify your identity to protect both buyers and sellers in P2P trades.
          Your information is encrypted and never shared.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Personal details */}
        <div className="bg-neutral-900 rounded-xl p-6 space-y-4">
          <h2 className="text-sm font-bold text-white uppercase tracking-wide">Personal Details</h2>

          <div>
            <label className="block text-xs text-neutral-500 mb-1">Full legal name *</label>
            <input
              type="text"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              required
              className="w-full px-3 py-2.5 bg-neutral-800 border border-neutral-700 rounded-lg text-white text-sm focus:outline-none focus:border-amber-500/50 transition"
              placeholder="As it appears on your ID"
            />
          </div>

          <div>
            <label className="block text-xs text-neutral-500 mb-1">Date of birth *</label>
            <input
              type="date"
              value={dob}
              onChange={(e) => setDob(e.target.value)}
              required
              className="w-full px-3 py-2.5 bg-neutral-800 border border-neutral-700 rounded-lg text-white text-sm focus:outline-none focus:border-amber-500/50 transition"
            />
          </div>
        </div>

        {/* UK Address */}
        <div className="bg-neutral-900 rounded-xl p-6 space-y-4">
          <h2 className="text-sm font-bold text-white uppercase tracking-wide">UK Address</h2>

          <div>
            <label className="block text-xs text-neutral-500 mb-1">Address line 1 *</label>
            <input
              type="text"
              value={addressLine1}
              onChange={(e) => setAddressLine1(e.target.value)}
              required
              className="w-full px-3 py-2.5 bg-neutral-800 border border-neutral-700 rounded-lg text-white text-sm focus:outline-none focus:border-amber-500/50 transition"
            />
          </div>

          <div>
            <label className="block text-xs text-neutral-500 mb-1">Address line 2</label>
            <input
              type="text"
              value={addressLine2}
              onChange={(e) => setAddressLine2(e.target.value)}
              className="w-full px-3 py-2.5 bg-neutral-800 border border-neutral-700 rounded-lg text-white text-sm focus:outline-none focus:border-amber-500/50 transition"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs text-neutral-500 mb-1">City *</label>
              <input
                type="text"
                value={city}
                onChange={(e) => setCity(e.target.value)}
                required
                className="w-full px-3 py-2.5 bg-neutral-800 border border-neutral-700 rounded-lg text-white text-sm focus:outline-none focus:border-amber-500/50 transition"
              />
            </div>
            <div>
              <label className="block text-xs text-neutral-500 mb-1">County</label>
              <input
                type="text"
                value={county}
                onChange={(e) => setCounty(e.target.value)}
                className="w-full px-3 py-2.5 bg-neutral-800 border border-neutral-700 rounded-lg text-white text-sm focus:outline-none focus:border-amber-500/50 transition"
              />
            </div>
          </div>

          <div className="max-w-[200px]">
            <label className="block text-xs text-neutral-500 mb-1">Postcode *</label>
            <input
              type="text"
              value={postcode}
              onChange={(e) => setPostcode(e.target.value)}
              required
              className="w-full px-3 py-2.5 bg-neutral-800 border border-neutral-700 rounded-lg text-white text-sm focus:outline-none focus:border-amber-500/50 transition uppercase"
              placeholder="SW1A 1AA"
            />
          </div>

          <div>
            <label className="block text-xs text-neutral-500 mb-1">Phone (optional)</label>
            <input
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              className="w-full px-3 py-2.5 bg-neutral-800 border border-neutral-700 rounded-lg text-white text-sm focus:outline-none focus:border-amber-500/50 transition"
              placeholder="+44"
            />
          </div>
        </div>

        {/* Bank details */}
        <div className="bg-neutral-900 rounded-xl p-6 space-y-4">
          <div>
            <h2 className="text-sm font-bold text-white uppercase tracking-wide">Bank Details</h2>
            <p className="text-xs text-neutral-500 mt-1">
              For receiving seller payouts. Optional — you can add this later.
            </p>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs text-neutral-500 mb-1">Sort code</label>
              <input
                type="text"
                value={sortCode}
                onChange={(e) => setSortCode(e.target.value)}
                className="w-full px-3 py-2.5 bg-neutral-800 border border-neutral-700 rounded-lg text-white text-sm focus:outline-none focus:border-amber-500/50 transition"
                placeholder="00-00-00"
              />
            </div>
            <div>
              <label className="block text-xs text-neutral-500 mb-1">Account number</label>
              <input
                type="text"
                value={accountNumber}
                onChange={(e) => setAccountNumber(e.target.value)}
                className="w-full px-3 py-2.5 bg-neutral-800 border border-neutral-700 rounded-lg text-white text-sm focus:outline-none focus:border-amber-500/50 transition"
                placeholder="12345678"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs text-neutral-500 mb-1">Account name</label>
            <input
              type="text"
              value={accountName}
              onChange={(e) => setAccountName(e.target.value)}
              className="w-full px-3 py-2.5 bg-neutral-800 border border-neutral-700 rounded-lg text-white text-sm focus:outline-none focus:border-amber-500/50 transition"
              placeholder="Name on your bank account"
            />
          </div>
        </div>

        {error && (
          <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-4">
            <p className="text-red-400 text-sm">{error}</p>
          </div>
        )}

        <button
          type="submit"
          disabled={submitting}
          className="w-full py-3 rounded-lg font-bold text-sm bg-amber-500 text-black hover:bg-amber-400 transition disabled:opacity-50"
        >
          {submitting ? "Submitting..." : showRejection ? "Resubmit Verification" : "Submit Verification"}
        </button>
      </form>
    </div>
  );
}
