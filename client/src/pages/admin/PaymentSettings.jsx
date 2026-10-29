import { useState, useEffect } from 'react';
import api from '../../utils/api';
import toast from 'react-hot-toast';
import { Save, Loader2, AlertTriangle } from 'lucide-react';
import PageHeader from '../../components/PageHeader';
import FormField from '../../components/FormField';
import LoadingSpinner from '../../components/LoadingSpinner';

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
    return <LoadingSpinner />;
  }

  const nameMissing = !form.receiver_name.trim();

  return (
    <div className="space-y-6">
      <PageHeader
        title="Payment Settings"
        description="Trusted payee details used to auto-verify payment screenshots"
      />

      <div className="card space-y-5">
        <h2 className="text-base font-semibold text-ink">Trusted payee</h2>
        <FormField
          label="Receiver UPI ID"
          htmlFor="pay-settings-upi"
          hint="Every screenshot must show this UPI ID for auto-approval."
        >
          <input
            id="pay-settings-upi"
            className="input-field"
            placeholder="name@bank"
            value={form.receiver_upi}
            onChange={e => set('receiver_upi', e.target.value)}
          />
        </FormField>

        <FormField
          label="Receiver Name"
          htmlFor="pay-settings-name"
          hint="The payee name shown on the payment screenshot. Must not be a UPI ID."
        >
          <input
            id="pay-settings-name"
            className="input-field"
            placeholder="e.g. JEYARAJ ALAGAR"
            value={form.receiver_name}
            onChange={e => set('receiver_name', e.target.value)}
          />
        </FormField>

        {nameMissing && (
          <div className="callout callout-warning" role="status">
            <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" aria-hidden="true" />
            <span>
              No receiver name is configured. Auto-approval is <strong>disabled</strong> — every payment and top-up
              will be sent to manual review until a name is set.
            </span>
          </div>
        )}
      </div>

      <div className="card space-y-5">
        <h2 className="text-base font-semibold text-ink">Verification</h2>
        <div className="grid sm:grid-cols-2 gap-4">
          <FormField label="Payment Window (minutes)" htmlFor="pay-settings-window">
            <input
              id="pay-settings-window"
              type="number"
              className="input-field"
              min="5"
              max="180"
              value={form.payment_window_minutes}
              onChange={e => set('payment_window_minutes', e.target.value)}
            />
          </FormField>
          <FormField label="Minimum OCR Confidence" htmlFor="pay-settings-ocr">
            <input
              id="pay-settings-ocr"
              type="number"
              className="input-field"
              min="0"
              max="100"
              value={form.min_ocr_confidence}
              onChange={e => set('min_ocr_confidence', e.target.value)}
            />
          </FormField>
        </div>
      </div>

      <div className="card space-y-5">
        <h2 className="text-base font-semibold text-ink">Plan amounts (₹)</h2>
        <div className="grid sm:grid-cols-3 gap-3">
          {Object.entries(form.plans).map(([plan, amount]) => (
            <FormField label={`Plan ${plan}`} htmlFor={`pay-settings-plan-${plan}`} key={plan}>
              <input
                id={`pay-settings-plan-${plan}`}
                type="number"
                className="input-field"
                min="1"
                value={amount}
                onChange={e => setPlan(plan, e.target.value)}
              />
            </FormField>
          ))}
        </div>
        <div className="divider" />
        <div className="flex justify-end">
          <button onClick={handleSave} disabled={saving} className="btn btn-primary">
            {saving ? <><Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> Saving...</> : <><Save className="h-4 w-4" aria-hidden="true" /> Save Settings</>}
          </button>
        </div>
      </div>

      <p className="text-xs text-ink-faint">
        Note: screenshot verification reads the image only. It does not confirm that the money actually reached the
        bank — use it as a supporting signal, not proof of settlement.
      </p>
    </div>
  );
}
