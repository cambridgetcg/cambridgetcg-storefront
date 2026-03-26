import Link from "next/link";

export const metadata = {
  title: "Trade-In Terms — Cambridge TCG",
  description: "Terms and conditions for trading in your cards with Cambridge TCG.",
};

export default function TradeInTermsPage() {
  return (
    <main className="min-h-screen bg-neutral-950">
      <div className="max-w-3xl mx-auto px-4 py-12">
        <Link href="/trade-in" className="text-sm text-neutral-400 hover:text-white transition mb-6 inline-block">
          ← Back to Trade-In
        </Link>

        <h1 className="text-2xl md:text-3xl font-bold text-white mb-8">Trade-In Terms &amp; Conditions</h1>

        <div className="prose prose-invert max-w-none space-y-8 text-neutral-300 text-sm leading-relaxed">
          <section>
            <h2 className="text-lg font-bold text-white mb-3">Card Condition</h2>
            <p>
              All cards submitted must be in <strong>Near Mint (NM)</strong> condition. This means
              cards should have no visible wear, scratches, whitening on edges, creases, or bends.
              Cards that do not meet NM standards may be graded lower, resulting in a reduced payout,
              or returned at the customer&apos;s expense.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-bold text-white mb-3">Price Lock Guarantee</h2>
            <p>
              Once a trade-in is submitted, the quoted prices are <strong>locked for 7 days</strong> from
              the date of submission. Your cards must arrive within this 7-day window for the
              quoted prices to be honoured. After 7 days, prices may be re-evaluated based on
              current market rates.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-bold text-white mb-3">Shipping</h2>
            <p>
              Customers are responsible for shipping costs when sending cards to us. We recommend
              using a tracked and insured delivery service. Cambridge TCG is not responsible for
              cards lost or damaged in transit.
            </p>
            <p className="mt-2">
              For trade-ins with a total payout of <strong>£100 or more</strong>, we will contribute
              <strong> £2.70</strong> towards your shipping costs, added to your final payout.
            </p>
            <p className="mt-2">Ship your cards to:</p>
            <div className="bg-neutral-900 rounded-lg p-4 mt-2 not-prose">
              <p className="text-white text-sm">Cambridge TCG</p>
              <p className="text-white text-sm">PO Box 1637</p>
              <p className="text-white text-sm">CAMBRIDGE</p>
              <p className="text-white text-sm">CB1 0PD</p>
            </div>
          </section>

          <section>
            <h2 className="text-lg font-bold text-white mb-3">Payment</h2>
            <p>Two payment options are available:</p>
            <ul className="list-disc list-inside mt-2 space-y-1">
              <li><strong>Store Credit:</strong> Processed within 1 business day after grading. Credit is applied to your account and can be used for any purchase on cambridgetcg.com.</li>
              <li><strong>Cash (Bank Transfer):</strong> Processed within 2 business days after grading. Funds are sent via bank transfer to the account details you provide.</li>
            </ul>
          </section>

          <section>
            <h2 className="text-lg font-bold text-white mb-3">Cancellation</h2>
            <p>
              You may cancel your trade-in submission at any time before your cards have been received
              and processed by contacting us at{" "}
              <a href="mailto:contact@cambridgetcg.com" className="text-amber-400 hover:underline">
                contact@cambridgetcg.com
              </a>{" "}
              with your reference number.
            </p>
            <p className="mt-2">
              Once cards have been received and grading has begun, cancellation is no longer possible.
              Cards that have been graded but not yet paid out may be returned at the customer&apos;s
              expense upon request.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-bold text-white mb-3">Age Requirement</h2>
            <p>
              You must be <strong>18 years of age or over</strong> to submit a trade-in. By submitting
              a trade-in request, you confirm that you meet this requirement.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-bold text-white mb-3">Record Keeping</h2>
            <p>
              Cambridge TCG maintains records of all trade-in transactions in accordance with UK
              regulations. Records include customer details, card details, quantities, and payment
              information. This data is retained for a minimum of 6 years for accounting and legal
              compliance purposes.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-bold text-white mb-3">Contact</h2>
            <p>
              For questions about trade-ins, contact us at{" "}
              <a href="mailto:contact@cambridgetcg.com" className="text-amber-400 hover:underline">
                contact@cambridgetcg.com
              </a>
              .
            </p>
          </section>
        </div>
      </div>
    </main>
  );
}
