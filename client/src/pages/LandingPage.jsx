import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Users, ArrowRight, CheckCircle, Star, Zap, Shield, TrendingUp, CreditCard } from 'lucide-react';

const plans = [
  { id: 120, name: 'Starter', price: 120, features: ['Basic referral access', 'Community support', 'Earn through referrals'] },
  { id: 500, name: 'Growth', price: 500, features: ['Advanced referral network', 'Priority support', 'Higher earning potential', 'Top-up access'], popular: true },
  { id: 1000, name: 'Premium', price: 1000, features: ['Full platform access', 'VIP support', 'Maximum earnings', 'All top-up benefits', 'Exclusive features'] },
];

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-white">
      <nav className="flex items-center justify-between px-6 py-4 max-w-7xl mx-auto">
        <div className="flex items-center gap-2">
          <Users className="h-8 w-8 text-primary-600" />
          <span className="text-xl font-bold text-gray-900">ReferralHub</span>
        </div>
        <div className="flex items-center gap-3">
          <Link to="/login" className="text-gray-600 hover:text-gray-900 font-medium px-4 py-2">Login</Link>
          <Link to="/register" className="btn-primary">Get Started</Link>
        </div>
      </nav>

      <section className="px-6 py-20 max-w-7xl mx-auto text-center">
        <div className="inline-block bg-primary-100 text-primary-700 px-4 py-1.5 rounded-full text-sm font-medium mb-6">Grow Together</div>
        <h1 className="text-5xl md:text-6xl font-bold text-gray-900 mb-6 leading-tight">Grow Together with<br/><span className="text-primary-600">ReferralHub</span></h1>
        <p className="text-xl text-gray-600 mb-8 max-w-2xl mx-auto">Join our referral network, connect with others, and earn rewards. Simple, transparent, and rewarding.</p>
        <div className="flex items-center justify-center gap-4">
          <Link to="/register" className="btn-primary text-lg px-8 py-3 flex items-center gap-2">Get Started <ArrowRight className="h-5 w-5" /></Link>
          <Link to="/login" className="btn-secondary text-lg px-8 py-3">Login</Link>
        </div>
      </section>

      <section className="px-6 py-20 bg-gray-50">
        <div className="max-w-7xl mx-auto">
          <h2 className="text-3xl font-bold text-center text-gray-900 mb-12">How It Works</h2>
          <div className="grid md:grid-cols-3 gap-8">
            {[
              { icon: CreditCard, title: '1. Register & Pay', desc: 'Sign up, choose a plan, and complete payment to get started.' },
              { icon: Users, title: '2. Refer Friends', desc: 'Share your unique referral code with friends and family.' },
              { icon: TrendingUp, title: '3. Earn Rewards', desc: 'When your referrals join, you earn top-up rewards automatically.' },
            ].map((step, i) => (
              <div key={i} className="bg-white rounded-xl p-8 text-center shadow-sm border border-gray-200">
                <div className="w-14 h-14 bg-primary-100 rounded-xl flex items-center justify-center mx-auto mb-4">
                  <step.icon className="h-7 w-7 text-primary-600" />
                </div>
                <h3 className="text-lg font-semibold text-gray-900 mb-2">{step.title}</h3>
                <p className="text-gray-600">{step.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="px-6 py-20 max-w-7xl mx-auto">
        <h2 className="text-3xl font-bold text-center text-gray-900 mb-4">Choose Your Plan</h2>
        <p className="text-gray-600 text-center mb-12 max-w-xl mx-auto">Select the plan that fits your goals. All plans include referral access and earning potential.</p>
        <div className="grid md:grid-cols-3 gap-8 max-w-5xl mx-auto">
          {plans.map((plan) => (
            <div key={plan.id} className={`rounded-xl p-8 border-2 ${plan.popular ? 'border-primary-600 shadow-lg relative' : 'border-gray-200 shadow-sm'}`}>
              {plan.popular && <div className="absolute -top-3 left-1/2 -translate-x-1/2 bg-primary-600 text-white text-xs font-bold px-3 py-1 rounded-full">Most Popular</div>}
              <h3 className="text-xl font-bold text-gray-900 mb-2">{plan.name}</h3>
              <div className="text-4xl font-bold text-gray-900 mb-6">₹{plan.price}</div>
              <ul className="space-y-3 mb-8">
                {plan.features.map((f, i) => (
                  <li key={i} className="flex items-center gap-2 text-gray-600">
                    <CheckCircle className="h-5 w-5 text-green-500 flex-shrink-0" /> {f}
                  </li>
                ))}
              </ul>
              <Link to={`/register?plan=${plan.id}`} className={`w-full text-center block py-3 rounded-lg font-medium transition-colors ${plan.popular ? 'btn-primary' : 'btn-secondary'}`}>
                Get Started
              </Link>
            </div>
          ))}
        </div>
      </section>

      <footer className="px-6 py-8 bg-gray-900 text-gray-400 text-center text-sm">
        <p>&copy; {new Date().getFullYear()} ReferralHub. All rights reserved.</p>
      </footer>
    </div>
  );
}
