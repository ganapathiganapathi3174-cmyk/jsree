import supabase from '../db/supabase.js';

class WalletService {
  async getBalance(userId) {
    const { data, error } = await supabase
      .from('users')
      .select('wallet_balance')
      .eq('id', userId)
      .single();
    if (error) throw error;
    return parseFloat(data.wallet_balance) || 0;
  }

  async credit(userId, amount, description, referenceId = null, referenceType = null) {
    const balance = await this.getBalance(userId);
    const newBalance = balance + parseFloat(amount);

    const { error: balErr } = await supabase
      .from('users')
      .update({ wallet_balance: newBalance })
      .eq('id', userId);
    if (balErr) throw balErr;

    const { data, error } = await supabase
      .from('wallet_transactions')
      .insert({
        user_id: userId,
        type: 'credit',
        amount: parseFloat(amount),
        description,
        reference_id: referenceId,
        reference_type: referenceType,
        balance_after: newBalance
      })
      .select()
      .single();
    if (error) throw error;
    return { transaction: data, newBalance };
  }

  async debit(userId, amount, description, referenceId = null, referenceType = null) {
    const balance = await this.getBalance(userId);
    if (balance < parseFloat(amount)) {
      throw new Error('Insufficient wallet balance');
    }
    const newBalance = balance - parseFloat(amount);

    const { error: balErr } = await supabase
      .from('users')
      .update({ wallet_balance: newBalance })
      .eq('id', userId);
    if (balErr) throw balErr;

    const { data, error } = await supabase
      .from('wallet_transactions')
      .insert({
        user_id: userId,
        type: 'debit',
        amount: parseFloat(amount),
        description,
        reference_id: referenceId,
        reference_type: referenceType,
        balance_after: newBalance
      })
      .select()
      .single();
    if (error) throw error;
    return { transaction: data, newBalance };
  }

  async refund(userId, amount, description, referenceId = null, referenceType = null) {
    return this.credit(userId, amount, description, referenceId, referenceType);
  }

  async getTransactions(userId, { page = 1, limit = 20, type = null } = {}) {
    let query = supabase
      .from('wallet_transactions')
      .select('*', { count: 'exact' })
      .eq('user_id', userId)
      .order('created_at', { ascending: false });

    if (type) query = query.eq('type', type);

    const offset = (page - 1) * limit;
    query = query.range(offset, offset + limit - 1);

    const { data, error, count } = await query;
    if (error) throw error;

    return {
      transactions: data,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total: count,
        totalPages: Math.ceil(count / limit)
      }
    };
  }
}

export default new WalletService();
