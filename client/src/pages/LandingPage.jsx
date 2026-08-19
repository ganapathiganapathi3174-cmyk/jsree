import { Link } from 'react-router-dom';
import { Users, ArrowRight, CheckCircle, Shield, TrendingUp, CreditCard, Sparkles, MessageSquare } from 'lucide-react';

const plans = [
  { id: 120, name: 'Starter', price: 120, features: ['Basic referral access', 'Community support', 'Earn through referrals'] },
  { id: 500, name: 'Growth', price: 500, features: ['Advanced referral network', 'Priority support', 'Higher earning potential', 'Top-up access'], popular: true },
  { id: 1000, name: 'Premium', price: 1000, features: ['Full platform access', 'VIP support', 'Maximum earnings', 'All top-up benefits', 'Exclusive features'] },
];

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-surface relative">
      <nav className="flex items-center justify-between px-6 py-4 max-w-7xl mx-auto">
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 bg-gradient-to-br from-primary-600 to-primary-700 rounded-lg flex items-center justify-center shadow-sm">
            <Shield className="h-5 w-5 text-white" />
          </div>
          <span className="text-xl font-bold tracking-tight text-gray-900">JSREE</span>
        </div>
        <div className="flex items-center gap-3">
          <Link to="/login" className="text-gray-600 hover:text-gray-900 font-medium px-4 py-2">Login</Link>
          <Link to="/register" className="btn-primary">Get Started</Link>
        </div>
      </nav>

      <section className="px-6 pt-16 pb-20 max-w-7xl mx-auto text-center">
        <div className="inline-flex items-center gap-1.5 bg-primary-50 text-primary-700 px-4 py-1.5 rounded-full text-sm font-medium mb-6 border border-primary-200">
          <Sparkles className="h-3.5 w-3.5" /> Grow Together
        </div>
        <h1 className="text-4xl md:text-6xl font-bold text-gray-900 mb-6 leading-tight tracking-tight">
          Grow Together with<br /><span className="text-primary-600">JSREE</span>
        </h1>
        <p className="text-lg md:text-xl text-gray-600 mb-8 max-w-2xl mx-auto">Join our referral network, connect with others, and earn rewards. Simple, transparent, and rewarding.</p>
        <div className="flex flex-wrap items-center justify-center gap-4">
          <Link to="/register" className="btn-primary h-12 px-8 text-base">Get Started <ArrowRight className="h-5 w-5" /></Link>
          <Link to="/login" className="btn-secondary h-12 px-8 text-base">Login</Link>
        </div>
      </section>

      <section className="px-6 py-16 max-w-7xl mx-auto">
        <h2 className="text-3xl font-bold text-center text-gray-900 mb-12">How It Works</h2>
        <div className="grid md:grid-cols-3 gap-6">
          {[
            { icon: CreditCard, title: '1. Register & Pay', desc: 'Sign up, choose a plan, and complete payment to get started.' },
            { icon: Users, title: '2. Refer Friends', desc: 'Share your unique referral code with friends and family.' },
            { icon: TrendingUp, title: '3. Earn Rewards', desc: 'When your referrals join, you earn top-up rewards automatically.' },
          ].map((step, i) => (
            <div key={i} className="card text-center p-8">
              <div className="w-14 h-14 bg-primary-50 text-primary-600 rounded-xl flex items-center justify-center mx-auto mb-4 border border-primary-100">
                <step.icon className="h-7 w-7" />
              </div>
              <h3 className="text-lg font-semibold text-gray-900 mb-2">{step.title}</h3>
              <p className="text-gray-600">{step.desc}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="px-6 py-16 max-w-7xl mx-auto">
        <h2 className="text-3xl font-bold text-center text-gray-900 mb-4">Choose Your Plan</h2>
        <p className="text-gray-600 text-center mb-12 max-w-xl mx-auto">Select the plan that fits your goals. All plans include referral access and earning potential.</p>
        <div className="grid md:grid-cols-3 gap-6 max-w-5xl mx-auto">
          {plans.map((plan) => (
            <div key={plan.id} className={`card p-8 relative flex flex-col ${plan.popular ? 'border-2 border-primary-600 shadow-card-hover' : ''}`}>
              {plan.popular && <div className="absolute -top-3 left-1/2 -translate-x-1/2 bg-primary-600 text-white text-xs font-bold px-3 py-1 rounded-full shadow-sm">Most Popular</div>}
              <h3 className="text-xl font-bold text-gray-900 mb-2">{plan.name}</h3>
              <div className="text-4xl font-bold text-gray-900 mb-6">₹{plan.price}</div>
              <ul className="space-y-3 mb-8 flex-1">
                {plan.features.map((f, i) => (
                  <li key={i} className="flex items-center gap-2 text-gray-600">
                    <CheckCircle className="h-5 w-5 text-success-600 flex-shrink-0" /> {f}
                  </li>
                ))}
              </ul>
              <Link to={`/register?plan=${plan.id}`} className={`w-full text-center block ${plan.popular ? 'btn-primary' : 'btn-secondary'}`}>
                Get Started
              </Link>
            </div>
          ))}
        </div>
      </section>

      <section className="px-6 pb-20 max-w-7xl mx-auto">
        <div className="card flex flex-col md:flex-row items-center gap-6 p-8 bg-primary-50/50 border-primary-100">
          <div className="w-12 h-12 rounded-xl bg-primary-600 text-white flex items-center justify-center shrink-0"><MessageSquare className="h-6 w-6" /></div>
          <div className="flex-1 text-center md:text-left">
            <h3 className="text-lg font-semibold text-gray-900 mb-1">Questions? We're here to help</h3>
            <p className="text-gray-600">Chat with our team directly from your dashboard after you join.</p>
          </div>
          <Link to="/register" className="btn-primary shrink-0">Join Now</Link>
        </div>
      </section>

      <footer className="px-6 py-8 bg-white border-t border-gray-200 text-gray-500 text-center text-sm">
        <p>&copy; {new Date().getFullYear()} JSREE. All rights reserved.</p>
      </footer>
    </div>
  );
}