const DATABASE_URL = process.env.DATABASE_URL;

interface QueryResult {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  rows: any[];
}

async function query(sql: string, params: unknown[] = []): Promise<QueryResult> {
  // Dynamic import to avoid bundling pg on the client
  const { default: pg } = await import("pg");
  const pool = new pg.Pool({ connectionString: DATABASE_URL });
  try {
    const result = await pool.query(sql, params);
    return { rows: result.rows };
  } finally {
    await pool.end();
  }
}

export interface SubmissionRow {
  id: number;
  reference: string;
  status: string;
  customer_name: string;
  customer_email: string;
  customer_phone: string | null;
  payment_method: string;
  bank_sort_code: string | null;
  bank_account_number: string | null;
  delivery_method: string;
  is_over_18: boolean;
  notes: string | null;
  quoted_cash_total: string | null;
  quoted_credit_total: string | null;
  final_total: string | null;
  tracking_number: string | null;
  payment_reference: string | null;
  quote_expires_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface ItemRow {
  id: number;
  submission_id: number;
  sku: string;
  card_number: string | null;
  name: string | null;
  set_code: string | null;
  quantity: number;
  quoted_cash_price: string | null;
  quoted_credit_price: string | null;
  accepted_qty: number | null;
  condition_grade: string | null;
  final_unit_price: string | null;
}

export async function generateReference(): Promise<string> {
  const today = new Date();
  const dateStr =
    today.getFullYear().toString() +
    String(today.getMonth() + 1).padStart(2, "0") +
    String(today.getDate()).padStart(2, "0");
  const prefix = `TI-${dateStr}-`;

  // Get the max sequence for today
  const result = await query(
    `SELECT reference FROM tradein_submissions WHERE reference LIKE $1 ORDER BY reference DESC LIMIT 1`,
    [prefix + "%"]
  );

  let seq = 1;
  if (result.rows.length > 0) {
    const lastRef = result.rows[0].reference as string;
    const lastSeq = parseInt(lastRef.slice(-4), 10);
    seq = lastSeq + 1;
  }

  return prefix + String(seq).padStart(4, "0");
}

export async function createSubmission(data: {
  reference: string;
  customerName: string;
  customerEmail: string;
  customerPhone?: string;
  paymentMethod: string;
  bankSortCode?: string;
  bankAccountNumber?: string;
  deliveryMethod: string;
  isOver18: boolean;
  notes?: string;
  cashTotal: number;
  creditTotal: number;
  expiresAt: Date;
  items: {
    sku: string;
    card_number: string;
    name: string;
    set_code: string | null;
    quantity: number;
    cash_price: number;
    credit_price: number;
  }[];
}): Promise<SubmissionRow> {
  const { default: pg } = await import("pg");
  const pool = new pg.Pool({ connectionString: DATABASE_URL });
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const subResult = await client.query(
      `INSERT INTO tradein_submissions
        (reference, customer_name, customer_email, customer_phone, payment_method,
         bank_sort_code, bank_account_number, delivery_method, is_over_18, notes,
         quoted_cash_total, quoted_credit_total, quote_expires_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
       RETURNING *`,
      [
        data.reference,
        data.customerName,
        data.customerEmail,
        data.customerPhone || null,
        data.paymentMethod,
        data.bankSortCode || null,
        data.bankAccountNumber || null,
        data.deliveryMethod,
        data.isOver18,
        data.notes || null,
        data.cashTotal.toFixed(2),
        data.creditTotal.toFixed(2),
        data.expiresAt.toISOString(),
      ]
    );

    const submission = subResult.rows[0] as SubmissionRow;

    for (const item of data.items) {
      await client.query(
        `INSERT INTO tradein_items
          (submission_id, sku, card_number, name, set_code, quantity, quoted_cash_price, quoted_credit_price)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [
          submission.id,
          item.sku,
          item.card_number,
          item.name,
          item.set_code,
          item.quantity,
          item.cash_price.toFixed(2),
          item.credit_price.toFixed(2),
        ]
      );
    }

    await client.query("COMMIT");
    return submission;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

export async function getSubmission(
  reference: string,
  email: string
): Promise<{ submission: SubmissionRow; items: ItemRow[] } | null> {
  const subResult = await query(
    `SELECT * FROM tradein_submissions WHERE reference = $1 AND customer_email = $2`,
    [reference, email.toLowerCase()]
  );

  if (subResult.rows.length === 0) return null;
  const submission = subResult.rows[0] as SubmissionRow;

  const itemsResult = await query(
    `SELECT * FROM tradein_items WHERE submission_id = $1 ORDER BY id`,
    [submission.id]
  );

  return { submission, items: itemsResult.rows as ItemRow[] };
}

export async function getSubmissionByRef(
  reference: string
): Promise<{ submission: SubmissionRow; items: ItemRow[] } | null> {
  const subResult = await query(
    `SELECT * FROM tradein_submissions WHERE reference = $1`,
    [reference]
  );

  if (subResult.rows.length === 0) return null;
  const submission = subResult.rows[0] as SubmissionRow;

  const itemsResult = await query(
    `SELECT * FROM tradein_items WHERE submission_id = $1 ORDER BY id`,
    [submission.id]
  );

  return { submission, items: itemsResult.rows as ItemRow[] };
}
