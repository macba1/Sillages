import { Navbar } from '../components/layout/Navbar';

export default function Billing() {
  return (
    <div className="min-h-screen bg-[#F7F1EC]">
      <Navbar />
      <main className="max-w-2xl mx-auto px-6 pt-24 pb-20">

        <div className="mb-10 pb-10 border-b border-[#E8DDD6]">
          <h1 className="text-[#3A2332] text-2xl font-semibold tracking-tight">Billing</h1>
          <p className="text-[#7A6B63] text-sm mt-1">Subscription and payment details.</p>
        </div>

        <div className="border border-[#E8DDD6] bg-white px-8 py-8">
          <p className="text-xs font-semibold uppercase tracking-widest text-[#D8B07A] mb-3">Beta</p>
          <p className="text-[#3A2332] font-semibold text-base tracking-tight mb-2">
            Sillages is free during beta.
          </p>
          <p className="text-[#7A6B63] text-sm leading-relaxed">
            Pricing starts at $9/month when we launch. You have full access to everything — no credit card required.
          </p>
        </div>

      </main>
    </div>
  );
}
