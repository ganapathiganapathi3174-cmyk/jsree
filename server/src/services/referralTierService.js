import supabase from '../db/supabase.js';

class ReferralTierService {
  async getAllTiers() {
    const { data, error } = await supabase
      .from('referral_tiers')
      .select('*')
      .order('min_referrals', { ascending: true });
    if (error) throw error;
    return data;
  }

  async getUserTier(userId) {
    const { data: user, error: uErr } = await supabase
      .from('users')
      .select('referral_tier, referred_by')
      .eq('id', userId)
      .single();
    if (uErr) throw uErr;

    const { count, error: cErr } = await supabase
      .from('referrals')
      .select('*', { count: 'exact', head: true })
      .eq('referrer_id', userId)
      .eq('status', 'approved');
    if (cErr) throw cErr;

    const tiers = await this.getAllTiers();
    let currentTier = tiers[0];
    for (const tier of tiers) {
      if (count >= tier.min_referrals) currentTier = tier;
    }

    if (user.referral_tier !== currentTier.name) {
      await supabase
        .from('users')
        .update({ referral_tier: currentTier.name })
        .eq('id', userId);
    }

    return {
      currentTier,
      totalApprovedReferrals: count,
      allTiers: tiers
    };
  }

  async checkAndUpgradeTier(userId) {
    const tierInfo = await this.getUserTier(userId);
    return tierInfo.currentTier;
  }
}

export default new ReferralTierService();
