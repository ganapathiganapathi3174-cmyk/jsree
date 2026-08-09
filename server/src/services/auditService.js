import { supabase } from '../db/supabase.js';

export async function logAction(actorId, actorRole, action, targetId, targetType, metadata = {}, ip = null) {
  try {
    const { error } = await supabase
      .from('audit_logs')
      .insert({
        actor_id: actorId,
        actor_role: actorRole,
        action: action,
        target_id: targetId,
        target_type: targetType,
        metadata: metadata,
        ip_address: ip
      });

    if (error) {
      console.error('Audit log error:', error.message);
    }
  } catch (err) {
    console.error('Audit log exception:', err.message);
  }
}
