import { useState, useEffect } from 'react';
import api from '../../utils/api';
import toast from 'react-hot-toast';
import { ShieldCheck, Save, Loader2, AlertTriangle, RefreshCw } from 'lucide-react';

// Admin-only payment configuration.
//
// receiver_name is the trusted payee name the verification engine compares
// against the name read from a payment screenshot. When it is EMPTY the
// engine fails safe: no screenshot is auto-approved and every payment /
// top-up is routed to manual review. Setting it (with receiver_upi) enables
// auto-approval for matching screenshots.
export default function PaymentSettings() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    receiver_upi: '',
    receiver_name: '',
    payment_window_minutes: 30,
    min_ocr_confidence: 55,
    plans: { 120: 120, 500: 500, 1000: 1000 },
  });

  const load = () => {
    setLoading(true);
    api.get('/config')
      .then(r => {
        const d = r.data.data || {};
        setForm({
          receiver_upi: d.receiver_upi ?? '',
          receiver_name: d.receiver_name ?? '',
          payment_window_minutes: d.payment_window_minutes ?? 30,
          min_ocr_confidence: d.min_ocr_confidence ?? 55,
          plans: d.plans || { 120: 120, 500: 500, 1000: 1000 },
        });
      })
      .catch(() => toast.error('Failed to load payment settings'))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);

  const set = (key, val) => setForm(prev => ({ ...prev, [key]: val }));
  const setPlan = (plan, val) => setForm(prev => ({ ...prev, plans: { ...prev.plans, [plan]: val } }));

  const handleSave = async () => {
    setSaving(true);
    try {
      const plans = {};
      for (const [plan, amount] of Object.entries(form.plans)) {
        plans[plan] = Number(amount);
      }
      await api.put('/config', {
        receiver_upi: form.receiver_upi.trim(),
        receiver_name: form.receiver_name.trim(),
        payment_window_minutes: Number(form.payment_window_minutes),
        min_ocr_confidence: Number(form.min_ocr_confidence),
        plans,
      });
      toast.success('Payment settings saved');
      load();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to save payment settings');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <div className="flex justify-center py-12"><RefreshCw className="w-6 h-6 animate-spin text-gray-500" /></div>;
  }

  const nameMissing = !form.receiver_name.trim();

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-lg bg-primary-50 text-primary-600 flex items-center justify-center"><ShieldCheck className="h-5 w-5" /></div>
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold text-gray-900">Payment Settings</h1>
          <p className="text-sm text-gray-500 mt-0.5">Trusted payee details used to auto-verify payment screenshots</p>
        </div>
      </div>

      <div className="card space-y-5">
        <div>
          <label className="label">Receiver UPI ID</label>
          <input
            className="input-field"
            placeholder="name@bank"
            value={form.receiver_upi}
            onChange={e => set('receiver_upi', e.target.value)}
          />
          <p className="text-xs text-gray-500 mt-1">Every screenshot must show this UPI ID for auto-approval.</p>
        </div>

        <div>
          <label className="label">Receiver Name</label>
          <input
            className="input-field"
            placeholder="e.g. JEYARAJ ALAGAR"
            value={form.receiver_name}
            onChange={e => set('receiver_name', e.target.value)}
          />
          <p className="text-xs text-gray-500 mt-1">
            The payee name shown on the payment screenshot. Must not be a UPI ID.
          </p>
        </div>

        {nameMissing && (
          <div className="flex items-start gap-2 rounded-lg border border-warning-200 bg-warning-50 px-3 py-2.5 text-sm text-warning-700">
            <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
            <span>
              No receiver name is configured. Auto-approval is <strong>disabled</strong> — every payment and top-up
              will be sent to manual review until a name is set.
            </span>
          </div>
        )}

        <div className="grid sm:grid-cols-2 gap-4">
          <div>
            <label className="label">Payment Window (minutes)</label>
            <input
              type="number"
              className="input-field"
              min="5"
              max="180"
              value={form.payment_window_minutes}
              onChange={e => set('payment_window_minutes', e.target.value)}
            />
          </div>
          <div>
            <label className="label">Minimum OCR Confidence</label>
            <input
              type="number"
              className="input-field"
              min="0"
              max="100"
              value={form.min_ocr_confidence}
              onChange={e => set('min_ocr_confidence', e.target.value)}
            />
          </div>
        </div>

        <div>
          <label className="label">Plan Amounts (₹)</label>
          <div className="grid sm:grid-cols-3 gap-3">
            {Object.entries(form.plans).map(([plan, amount]) => (
              <div key={plan}>
                <span className="text-xs text-gray-500">Plan {plan}</span>
                <input
                  type="number"
                  className="input-field"
                  min="1"
                  value={amount}
                  onChange={e => setPlan(plan, e.target.value)}
                />
              </div>
            ))}
          </div>
        </div>

        <div className="flex justify-end">
          <button onClick={handleSave} disabled={saving} className="btn-primary">
            {saving ? <><Loader2 className="h-4 w-4 animate-spin" /> Saving...</> : <><Save className="h-4 w-4" /> Save Settings</>}
          </button>
        </div>
      </div>

      <p className="text-xs text-gray-500">
        Note: screenshot verification reads the image only. It does not confirm that the money actually reached the
        bank — use it as a supporting signal, not proof of settlement.
      </p>
    </div>
  );
}
