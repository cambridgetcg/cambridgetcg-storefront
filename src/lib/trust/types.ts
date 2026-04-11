export type VerificationStatus = "pending" | "verified" | "rejected" | "expired";
export type DisputeStatus = "open" | "under_review" | "awaiting_evidence" | "resolved_buyer" | "resolved_seller" | "resolved_split" | "closed";

export interface UserVerification {
  id: string;
  user_id: string;
  status: VerificationStatus;
  full_legal_name: string;
  date_of_birth: string;
  address_line1: string;
  address_line2: string | null;
  city: string;
  county: string | null;
  postcode: string;
  country: string;
  phone: string | null;
  phone_verified: boolean;
  bank_sort_code: string | null;
  bank_account_number: string | null;
  bank_account_name: string | null;
  admin_notes: string | null;
  verified_at: string | null;
  rejected_reason: string | null;
  created_at: string;
}

export interface TradeDispute {
  id: string;
  trade_id: string;
  raised_by: string;
  reason: string;
  description: string;
  status: DisputeStatus;
  resolution_type: string | null;
  resolution_notes: string | null;
  refund_amount: string | null;
  resolved_at: string | null;
  created_at: string;
  // Joined
  raiser_name?: string | null;
  raiser_email?: string;
  card_name?: string | null;
  trade_price?: string;
  buyer_name?: string | null;
  seller_name?: string | null;
}

export interface DisputeMessage {
  id: string;
  dispute_id: string;
  sender_id: string;
  is_admin: boolean;
  message: string;
  created_at: string;
  sender_name?: string | null;
}

export interface DisputeEvidence {
  id: string;
  dispute_id: string;
  uploaded_by: string;
  url: string;
  label: string | null;
  created_at: string;
}

export interface EscrowPayment {
  id: string;
  trade_id: string;
  type: string;
  stripe_payment_intent: string | null;
  stripe_checkout_session: string | null;
  amount: string;
  status: string;
  paid_at: string | null;
  payout_amount: string | null;
  payout_at: string | null;
  refund_amount: string | null;
  refunded_at: string | null;
  created_at: string;
}

export const DISPUTE_REASONS = [
  { value: "condition_mismatch", label: "Card condition doesn't match listing" },
  { value: "wrong_card", label: "Wrong card received" },
  { value: "counterfeit", label: "Card appears counterfeit" },
  { value: "not_received", label: "Card not received" },
  { value: "damaged_shipping", label: "Card damaged during shipping" },
  { value: "other", label: "Other issue" },
] as const;

export const UK_POSTCODE_REGEX = /^[A-Z]{1,2}\d[A-Z\d]?\s?\d[A-Z]{2}$/i;
