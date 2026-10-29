import { Link } from 'react-router-dom';
import { Users, ArrowRight, CheckCircle, Shield, TrendingUp, CreditCard, Sparkles, MessageSquare } from 'lucide-react';
import ThemeToggle from '../components/ThemeToggle';
import FallingStarsBackground from '../components/FallingStarsBackground';
import { PLANS } from '../utils/constants';

// Feature copy per tier, aligned 1:1 with PLANS (₹120 / ₹500 / ₹1000).
const PLAN_FEATURES = [
  ['Basic referral access', 'Community support', 'Earn through referrals'],
  ['Advanced referral network', 'Priority support', 'Higher earning potential', 'Top-up access'],
  ['Full platform access', 'VIP support', 'Maximum earnings', 'All top-up benefits', 'Exclusive features'],
];

const steps = [
  { icon: CreditCard, title: '1. Register & Pay', desc: 'Sign up, choose a plan, and complete payment to get started.' },
  { icon: Users, title: '2. Refer Friends', desc: 'Share your unique referral code with friends and family.' },
  { icon: TrendingUp, title: '3. Earn Rewards', desc: 'When your referrals join, you earn top-up rewards automatically.' },
];

export default function LandingPage() {
  return (
    <div className="min-h-screen landing-bg relative">
      <FallingStarsBackground />

      <div className="relative z-10">
        {/* Navigation */}
        <nav className="flex items-center justify-between px-5 sm:px-6 py-4 max-w-6xl mx-auto">
          <Link to="/" className="flex items-center gap-2.5">
            <div className="w-9 h-9 bg-primary-600 rounded-lg flex items-center justify-center">
              <Shield className="h-5 w-5 text-white" aria-hidden="true" />
            </div>
            <span className="text-xl font-bold tracking-tight text-ink">JSREE</span>
          </Link>
          <div className="flex items-center gap-2">
            <ThemeToggle />
            <Link to="/login" className="btn btn-ghost hidden sm:inline-flex">Login</Link>
            <Link to="/register" className="btn btn-primary">Get Started</Link>
          </div>
        </nav>

        {/* Hero */}
        <section className="px-5 sm:px-6 pt-14 sm:pt-20 pb-16 sm:pb-24 max-w-6xl mx-auto text-center">
          <div className="inline-flex items-center gap-1.5 bg-primary-500/10 text-primary-700 dark:text-primary-300 px-4 py-1.5 rounded-full text-sm font-medium mb-6 border border-primary-500/25">
            <Sparkles className="h-3.5 w-3.5" aria-hidden="true" /> Grow Together
          </div>
          <h1 className="text-3xl sm:text-5xl font-bold text-ink mb-6 leading-[1.15] tracking-tight">
            Grow Together with
            <br />
            <span className="text-primary-600 dark:text-primary-400">JSREE</span>
          </h1>
          <p className="text-base sm:text-lg text-ink-muted mb-8 max-w-2xl mx-auto leading-relaxed">
            Join our referral network, connect with others, and earn rewards. Simple, transparent, and rewarding.
          </p>
          <div className="flex flex-wrap items-center justify-center gap-3">
            <Link to="/register" className="btn btn-primary btn-lg">
              Get Started <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </Link>
            <Link to="/login" className="btn btn-secondary btn-lg">Login</Link>
          </div>
        </section>

        {/* How it works */}
        <section className="px-5 sm:px-6 py-14 sm:py-16 max-w-6xl mx-auto">
          <h2 className="text-2xl sm:text-3xl font-bold text-center text-ink mb-10">How It Works</h2>
          <div className="grid md:grid-cols-3 gap-5">
            {steps.map((step, i) => (
              <div key={i} className="card text-center">
                <div className="w-12 h-12 bg-primary-500/10 text-primary-600 dark:text-primary-400 rounded-xl flex items-center justify-center mx-auto mb-4">
                  <step.icon className="h-6 w-6" aria-hidden="true" />
                </div>
                <h3 className="text-base font-semibold text-ink mb-2">{step.title}</h3>
                <p className="text-sm text-ink-muted leading-relaxed">{step.desc}</p>
              </div>
            ))}
          </div>
        </section>

        {/* Plans */}
        <section className="px-5 sm:px-6 py-14 sm:py-16 max-w-6xl mx-auto">
          <h2 className="text-2xl sm:text-3xl font-bold text-center text-ink mb-4">Choose Your Plan</h2>
          <p className="text-ink-muted text-center mb-12 max-w-xl mx-auto text-sm sm:text-base">
            Select the plan that fits your goals. All plans include referral access and earning potential.
          </p>
          <div className="grid md:grid-cols-3 gap-5 max-w-5xl mx-auto">
            {PLANS.map((plan, idx) => {
              const popular = idx === 1;
              return (
                <div
                  key={plan.id}
                  className={`card relative flex flex-col ${popular ? 'border-2 border-primary-600 shadow-card-hover' : ''}`}
                >
                  {popular && (
                    <div className="absolute -top-3 left-1/2 -translate-x-1/2 bg-primary-600 text-white text-[11px] font-bold px-3 py-1 rounded-full">
                      Most Popular
                    </div>
                  )}
                  <h3 className="text-lg font-bold text-ink mb-2">{plan.name}</h3>
                  <div className="text-4xl font-bold text-ink mb-6">₹{plan.amount}</div>
                  <ul className="space-y-2.5 mb-8 flex-1">
                    {PLAN_FEATURES[idx].map((f, i) => (
                      <li key={i} className="flex items-start gap-2 text-sm text-ink-muted">
                        <CheckCircle className="h-[18px] w-[18px] text-success-600 shrink-0 mt-px" aria-hidden="true" />
                        {f}
                      </li>
                    ))}
                  </ul>
                  <Link
                    to={`/register?plan=${plan.id}`}
                    className={`w-full text-center ${popular ? 'btn btn-primary' : 'btn btn-secondary'}`}
                  >
                    Get Started
                  </Link>
                </div>
              );
            })}
          </div>
        </section>

        {/* Help CTA */}
        <section className="px-5 sm:px-6 pb-16 sm:pb-20 max-w-6xl mx-auto">
          <div className="card flex flex-col md:flex-row items-center gap-5">
            <div className="w-12 h-12 rounded-xl bg-primary-600 text-white flex items-center justify-center shrink-0">
              <MessageSquare className="h-6 w-6" aria-hidden="true" />
            </div>
            <div className="flex-1 text-center md:text-left">
              <h3 className="text-base font-semibold text-ink mb-1">Questions? We're here to help</h3>
              <p className="text-sm text-ink-muted">Chat with our team directly from your dashboard after you join.</p>
            </div>
            <Link to="/register" className="btn btn-primary shrink-0">Join Now</Link>
          </div>
        </section>

        {/* Footer */}
        <footer className="border-t border-line py-8 text-ink-faint text-center text-sm bg-surface/50">
          <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
            <span className="font-semibold text-ink-muted">JSREE</span>
            <span aria-hidden="true">·</span>
            <p>&copy; {new Date().getFullYear()} JSREE. All rights reserved.</p>
          </div>
        </footer>
      </div>
    </div>
  );
}
