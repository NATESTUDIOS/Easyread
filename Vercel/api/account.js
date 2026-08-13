// api/account.js
// EasyRead Account Management - Vercel API

import { 
  supabase,
  getById, 
  getByColumn, 
  insert, 
  update, 
  deleteRecord,
  exists,
  count
} from '../utils/supabase.js';

import bcrypt from 'bcryptjs';

// ============================================
// CONSTANTS - Hardcoded credit costs
// ============================================

const CREDIT_COSTS = {
  ASK_QUESTION: 1,
  DEEP_DIVE: 0.5,
  CONTEXT_SUBMIT: 1,
  MAKE_PRIVATE: 2,
  RATING_BONUS: 0.2
};

const DAILY_LIMITS = {
  UNAUTHENTICATED_ARTICLES: 30,
  UNAUTHENTICATED_QUESTIONS: 2,
  AUTHENTICATED_CREDITS: 50
};

// ============================================
// MAIN HANDLER
// ============================================

export default async function handler(req, res) {
  // CORS headers
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version, x-api-key, x-user-id, x-admin-key'
  );

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const { method } = req;
  const { action } = req.query;

  try {
    switch (method) {
      case 'GET':
        return await handleGet(req, res, action);
      case 'POST':
        return await handlePost(req, res, action);
      case 'PUT':
        return await handlePut(req, res, action);
      case 'DELETE':
        return await handleDelete(req, res, action);
      default:
        return res.status(405).json({ error: 'Method not allowed' });
    }
  } catch (error) {
    console.error('API Error:', error);
    return res.status(500).json({ error: error.message });
  }
}

// ============================================
// GET HANDLER
// ============================================

async function handleGet(req, res, action) {
  const { user_id, anonymous_id } = req.query;

  // Get user profile
  if (!action || action === 'profile') {
    return await getProfile(req, res, user_id);
  }

  // Get user credits
  if (action === 'credits') {
    return await getCredits(req, res, user_id);
  }

  // Get user usage
  if (action === 'usage') {
    return await getUsage(req, res, user_id);
  }

  // Get user preferences
  if (action === 'preferences') {
    return await getPreferences(req, res, user_id);
  }

  // Get anonymous user status
  if (action === 'anonymous-status') {
    return await getAnonymousStatus(req, res, anonymous_id);
  }

  return res.status(400).json({ error: 'Invalid action' });
}

// ============================================
// POST HANDLER
// ============================================

async function handlePost(req, res, action) {
  const { user_id } = req.query;

  // Sign up
  if (action === 'signup') {
    return await signup(req, res);
  }

  // Login
  if (action === 'login') {
    return await login(req, res);
  }

  // Logout
  if (action === 'logout') {
    return await logout(req, res);
  }

  // Use credits
  if (action === 'use-credits') {
    return await useCredits(req, res, user_id);
  }

  // Add credits (admin only)
  if (action === 'add-credits') {
    return await addCredits(req, res, user_id);
  }

  // Set preference
  if (action === 'set-preference') {
    return await setPreference(req, res, user_id);
  }

  // Track usage (anonymous or authenticated)
  if (action === 'track-usage') {
    return await trackUsage(req, res, user_id);
  }

  // Rate an article
  if (action === 'rate') {
    return await rateArticle(req, res, user_id);
  }

  return res.status(400).json({ error: 'Invalid action' });
}

// ============================================
// PUT HANDLER
// ============================================

async function handlePut(req, res, action) {
  const { user_id } = req.query;

  // Update profile
  if (action === 'profile') {
    return await updateProfile(req, res, user_id);
  }

  // Update password
  if (action === 'password') {
    return await updatePassword(req, res, user_id);
  }

  // Reset credits (admin only)
  if (action === 'reset-credits') {
    return await resetCredits(req, res, user_id);
  }

  return res.status(400).json({ error: 'Invalid action' });
}

// ============================================
// DELETE HANDLER
// ============================================

async function handleDelete(req, res, action) {
  const { user_id } = req.query;

  // Delete account
  if (action === 'account') {
    return await deleteAccount(req, res, user_id);
  }

  return res.status(400).json({ error: 'Invalid action' });
}

// ============================================
// ===== IMPLEMENTATION FUNCTIONS =====
// ============================================

// ============================================
// 🆕 SIGNUP
// ============================================

async function signup(req, res) {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password required' });
  }

  // Validate email
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    return res.status(400).json({ error: 'Invalid email format' });
  }

  // Validate password
  if (password.length < 8) {
    return res.status(400).json({ error: 'Password must be at least 8 characters' });
  }

  try {
    // Check if user exists
    const existing = await getByColumn('users', 'email', email);
    if (existing.length > 0) {
      return res.status(409).json({ error: 'User already exists' });
    }

    // Hash password
    const salt = await bcrypt.genSalt(10);
    const password_hash = await bcrypt.hash(password, salt);

    // Generate user_id (er01, er02, etc)
    const userCount = await count('users');
    const user_id = `er${String(userCount + 1).padStart(2, '0')}`;

    // Create user
    const user = await insert('users', {
      user_id,
      email,
      password_hash,
      credits: 50 // Starting credits
    });

    // Create initial usage record for today
    const today = new Date().toISOString().split('T')[0];
    await insert('usage', {
      user_id: user.user_id,
      date: today,
      questions: 0,
      deep_dives: 0,
      articles_read: 0,
      credits_used: 0
    });

    // Generate session token (simple - use JWT in production)
    const sessionToken = Buffer.from(`${user_id}:${Date.now()}`).toString('base64');

    return res.status(201).json({
      success: true,
      message: 'User created successfully',
      user: {
        user_id: user.user_id,
        email: user.email,
        credits: user.credits,
        created_at: user.created_at
      },
      session_token: sessionToken
    });

  } catch (error) {
    console.error('Signup error:', error);
    return res.status(500).json({ error: 'Failed to create user' });
  }
}

// ============================================
// 🔐 LOGIN
// ============================================

async function login(req, res) {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password required' });
  }

  try {
    const users = await getByColumn('users', 'email', email);

    if (users.length === 0) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const user = users[0];
    const validPassword = await bcrypt.compare(password, user.password_hash);

    if (!validPassword) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    // Generate session token
    const sessionToken = Buffer.from(`${user.user_id}:${Date.now()}`).toString('base64');

    return res.json({
      success: true,
      user: {
        user_id: user.user_id,
        email: user.email,
        credits: user.credits,
        preferred_profile_id: user.preferred_profile_id,
        created_at: user.created_at
      },
      session_token: sessionToken
    });

  } catch (error) {
    console.error('Login error:', error);
    return res.status(500).json({ error: 'Failed to login' });
  }
}

// ============================================
// 🚪 LOGOUT
// ============================================

async function logout(req, res) {
  // With stateless auth, just tell the client to clear the token
  return res.json({
    success: true,
    message: 'Logged out successfully'
  });
}

// ============================================
// 👤 GET PROFILE
// ============================================

async function getProfile(req, res, user_id) {
  if (!user_id) {
    return res.status(400).json({ error: 'user_id required' });
  }

  try {
    const users = await getByColumn('users', 'user_id', user_id);

    if (users.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    const user = users[0];
    return res.json({
      user_id: user.user_id,
      email: user.email,
      credits: user.credits,
      preferred_profile_id: user.preferred_profile_id,
      created_at: user.created_at,
      updated_at: user.updated_at
    });

  } catch (error) {
    console.error('Get profile error:', error);
    return res.status(500).json({ error: 'Failed to get profile' });
  }
}

// ============================================
// 💰 GET CREDITS
// ============================================

async function getCredits(req, res, user_id) {
  if (!user_id) {
    return res.status(400).json({ error: 'user_id required' });
  }

  try {
    const users = await getByColumn('users', 'user_id', user_id);

    if (users.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    const user = users[0];
    
    // Get today's usage
    const today = new Date().toISOString().split('T')[0];
    const usageRecords = await getByColumn('usage', 'user_id', user_id);
    const todayUsage = usageRecords.find(u => u.date === today) || {
      questions: 0,
      deep_dives: 0,
      articles_read: 0,
      credits_used: 0
    };

    return res.json({
      user_id: user.user_id,
      credits: user.credits,
      daily_credits_used: todayUsage.credits_used || 0,
      daily_credits_limit: DAILY_LIMITS.AUTHENTICATED_CREDITS,
      credits_remaining: user.credits - (todayUsage.credits_used || 0),
      costs: CREDIT_COSTS
    });

  } catch (error) {
    console.error('Get credits error:', error);
    return res.status(500).json({ error: 'Failed to get credits' });
  }
}

// ============================================
// 📊 GET USAGE
// ============================================

async function getUsage(req, res, user_id) {
  if (!user_id) {
    return res.status(400).json({ error: 'user_id required' });
  }

  try {
    const { start_date, end_date, limit = 30 } = req.query;
    
    let query = supabase
      .from('usage')
      .select('*')
      .eq('user_id', user_id)
      .order('date', { ascending: false })
      .limit(parseInt(limit));

    if (start_date) {
      query = query.gte('date', start_date);
    }
    if (end_date) {
      query = query.lte('date', end_date);
    }

    const { data, error } = await query;
    if (error) throw error;

    // Get transaction history
    const { data: transactions, error: txError } = await supabase
      .from('credit_transactions')
      .select('*')
      .eq('user_id', user_id)
      .order('created_at', { ascending: false })
      .limit(50);

    if (txError) throw txError;

    return res.json({
      user_id,
      usage: data || [],
      transactions: transactions || [],
      summary: {
        total_questions: data?.reduce((sum, u) => sum + (u.questions || 0), 0) || 0,
        total_deep_dives: data?.reduce((sum, u) => sum + (u.deep_dives || 0), 0) || 0,
        total_articles_read: data?.reduce((sum, u) => sum + (u.articles_read || 0), 0) || 0,
        total_credits_used: data?.reduce((sum, u) => sum + (u.credits_used || 0), 0) || 0
      }
    });

  } catch (error) {
    console.error('Get usage error:', error);
    return res.status(500).json({ error: 'Failed to get usage' });
  }
}

// ============================================
// ⚙️ GET PREFERENCES
// ============================================

async function getPreferences(req, res, user_id) {
  if (!user_id) {
    return res.status(400).json({ error: 'user_id required' });
  }

  try {
    const users = await getByColumn('users', 'user_id', user_id);

    if (users.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    const user = users[0];
    
    // Get all profiles
    const { data: profiles, error } = await supabase
      .from('profiles')
      .select('profile_id, name, description')
      .eq('status', 'active')
      .order('name');

    if (error) throw error;

    return res.json({
      user_id: user.user_id,
      preferred_profile_id: user.preferred_profile_id,
      available_profiles: profiles || [],
      default_profile: profiles?.find(p => p.profile_id === 1) || null
    });

  } catch (error) {
    console.error('Get preferences error:', error);
    return res.status(500).json({ error: 'Failed to get preferences' });
  }
}

// ============================================
// 👤 UPDATE PROFILE
// ============================================

async function updateProfile(req, res, user_id) {
  if (!user_id) {
    return res.status(400).json({ error: 'user_id required' });
  }

  const { email, preferred_profile_id } = req.body;

  try {
    const updateData = {};
    
    if (email) {
      // Check if email is taken
      const existing = await getByColumn('users', 'email', email);
      if (existing.length > 0 && existing[0].user_id !== user_id) {
        return res.status(409).json({ error: 'Email already taken' });
      }
      updateData.email = email;
    }
    
    if (preferred_profile_id !== undefined) {
      // Verify profile exists
      const profile = await getById('profiles', preferred_profile_id);
      if (!profile) {
        return res.status(404).json({ error: 'Profile not found' });
      }
      updateData.preferred_profile_id = preferred_profile_id;
    }

    const user = await update('users', user_id, updateData);

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    return res.json({
      success: true,
      message: 'Profile updated successfully',
      user: {
        user_id: user.user_id,
        email: user.email,
        preferred_profile_id: user.preferred_profile_id
      }
    });

  } catch (error) {
    console.error('Update profile error:', error);
    return res.status(500).json({ error: 'Failed to update profile' });
  }
}

// ============================================
// 🔑 UPDATE PASSWORD
// ============================================

async function updatePassword(req, res, user_id) {
  if (!user_id) {
    return res.status(400).json({ error: 'user_id required' });
  }

  const { current_password, new_password } = req.body;

  if (!current_password || !new_password) {
    return res.status(400).json({ error: 'Current and new password required' });
  }

  if (new_password.length < 8) {
    return res.status(400).json({ error: 'New password must be at least 8 characters' });
  }

  try {
    const users = await getByColumn('users', 'user_id', user_id);

    if (users.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    const user = users[0];
    const validPassword = await bcrypt.compare(current_password, user.password_hash);

    if (!validPassword) {
      return res.status(401).json({ error: 'Current password is incorrect' });
    }

    // Hash new password
    const salt = await bcrypt.genSalt(10);
    const password_hash = await bcrypt.hash(new_password, salt);

    await update('users', user_id, { password_hash });

    return res.json({
      success: true,
      message: 'Password updated successfully'
    });

  } catch (error) {
    console.error('Update password error:', error);
    return res.status(500).json({ error: 'Failed to update password' });
  }
}

// ============================================
// 💳 USE CREDITS
// ============================================

async function useCredits(req, res, user_id) {
  const { action_type, amount, item_id, metadata } = req.body;

  if (!user_id) {
    return res.status(400).json({ error: 'user_id required' });
  }

  if (!action_type || !amount) {
    return res.status(400).json({ error: 'action_type and amount required' });
  }

  try {
    // Get user
    const users = await getByColumn('users', 'user_id', user_id);
    if (users.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    const user = users[0];

    // Check if user has enough credits
    if (user.credits < amount) {
      return res.status(402).json({ 
        error: 'Insufficient credits',
        available: user.credits,
        required: amount
      });
    }

    // Check daily limit
    const today = new Date().toISOString().split('T')[0];
    const usageRecords = await getByColumn('usage', 'user_id', user_id);
    const todayUsage = usageRecords.find(u => u.date === today);

    const dailyCreditsUsed = todayUsage ? todayUsage.credits_used : 0;
    if (dailyCreditsUsed + amount > DAILY_LIMITS.AUTHENTICATED_CREDITS) {
      return res.status(429).json({
        error: 'Daily credit limit exceeded',
        limit: DAILY_LIMITS.AUTHENTICATED_CREDITS,
        used: dailyCreditsUsed,
        remaining: DAILY_LIMITS.AUTHENTICATED_CREDITS - dailyCreditsUsed
      });
    }

    // Deduct credits
    const newCredits = user.credits - amount;
    const updated = await update('users', user_id, { credits: newCredits });

    // Update usage
    if (todayUsage) {
      const updateFields = {
        credits_used: (todayUsage.credits_used || 0) + amount
      };
      
      if (action_type === 'question') {
        updateFields.questions = (todayUsage.questions || 0) + 1;
      } else if (action_type === 'deep_dive') {
        updateFields.deep_dives = (todayUsage.deep_dives || 0) + 1;
      } else if (action_type === 'context_submit') {
        updateFields.context_submits = (todayUsage.context_submits || 0) + 1;
      }
      
      await update('usage', todayUsage.usage_id, updateFields);
    } else {
      const usageData = {
        user_id,
        date: today,
        credits_used: amount,
        questions: action_type === 'question' ? 1 : 0,
        deep_dives: action_type === 'deep_dive' ? 1 : 0,
        context_submits: action_type === 'context_submit' ? 1 : 0,
        articles_read: 0
      };
      await insert('usage', usageData);
    }

    // Log transaction
    await insert('credit_transactions', {
      user_id,
      amount: -amount,
      reason: `${action_type} - ${metadata || 'Usage'}`,
      balance_after: newCredits,
      item_id: item_id || null
    });

    return res.json({
      success: true,
      message: `${amount} credits used for ${action_type}`,
      credits_remaining: newCredits,
      daily_credits_used: dailyCreditsUsed + amount,
      daily_credits_limit: DAILY_LIMITS.AUTHENTICATED_CREDITS
    });

  } catch (error) {
    console.error('Use credits error:', error);
    return res.status(500).json({ error: 'Failed to use credits' });
  }
}

// ============================================
// ➕ ADD CREDITS (Admin only)
// ============================================

async function addCredits(req, res, user_id) {
  const adminKey = req.headers['x-admin-key'];
  
  if (adminKey !== process.env.ADMIN_API_KEY) {
    return res.status(403).json({ error: 'Unauthorized' });
  }

  const { amount, reason } = req.body;

  if (!user_id || !amount) {
    return res.status(400).json({ error: 'user_id and amount required' });
  }

  try {
    const users = await getByColumn('users', 'user_id', user_id);
    if (users.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    const user = users[0];
    const newCredits = user.credits + amount;
    const updated = await update('users', user_id, { credits: newCredits });

    // Log transaction
    await insert('credit_transactions', {
      user_id,
      amount: amount,
      reason: reason || 'Admin adjustment',
      balance_after: newCredits
    });

    return res.json({
      success: true,
      message: `${amount} credits added`,
      user_id,
      new_balance: newCredits
    });

  } catch (error) {
    console.error('Add credits error:', error);
    return res.status(500).json({ error: 'Failed to add credits' });
  }
}

// ============================================
// 🔄 RESET CREDITS (Admin only)
// ============================================

async function resetCredits(req, res, user_id) {
  const adminKey = req.headers['x-admin-key'];
  
  if (adminKey !== process.env.ADMIN_API_KEY) {
    return res.status(403).json({ error: 'Unauthorized' });
  }

  const { amount = 50 } = req.body;

  if (!user_id) {
    return res.status(400).json({ error: 'user_id required' });
  }

  try {
    const updated = await update('users', user_id, { credits: amount });

    if (!updated) {
      return res.status(404).json({ error: 'User not found' });
    }

    await insert('credit_transactions', {
      user_id,
      amount: amount,
      reason: 'Credit reset by admin',
      balance_after: amount
    });

    return res.json({
      success: true,
      message: 'Credits reset successfully',
      user_id,
      new_balance: amount
    });

  } catch (error) {
    console.error('Reset credits error:', error);
    return res.status(500).json({ error: 'Failed to reset credits' });
  }
}

// ============================================
// ⭐ RATE ARTICLE
// ============================================

async function rateArticle(req, res, user_id) {
  const { view_id, rating, feedback } = req.body;

  if (!view_id || !rating) {
    return res.status(400).json({ error: 'view_id and rating required' });
  }

  if (rating < 1 || rating > 5) {
    return res.status(400).json({ error: 'Rating must be between 1 and 5' });
  }

  try {
    // Check if user already rated this
    const existing = await getByColumn('ratings', 'user_id', user_id);
    const existingRating = existing.find(r => r.view_id === parseInt(view_id));

    if (existingRating) {
      return res.status(409).json({ 
        error: 'Already rated this article',
        rating_id: existingRating.rating_id,
        rating: existingRating.rating
      });
    }

    // Insert rating
    const ratingRecord = await insert('ratings', {
      user_id: user_id || null,
      view_id: parseInt(view_id),
      rating,
      feedback: feedback || null
    });

    // Update explanation view average rating
    const { data: viewData, error: viewError } = await supabase
      .from('explanation_views')
      .select('rating_avg, rating_count')
      .eq('view_id', view_id)
      .single();

    if (viewError) throw viewError;

    const newCount = (viewData.rating_count || 0) + 1;
    const newAvg = ((viewData.rating_avg || 0) * (viewData.rating_count || 0) + rating) / newCount;

    await update('explanation_views', view_id, {
      rating_avg: Math.round(newAvg * 100) / 100,
      rating_count: newCount
    });

    // Add credit bonus for rating
    if (user_id) {
      const users = await getByColumn('users', 'user_id', user_id);
      if (users.length > 0) {
        const user = users[0];
        const bonus = CREDIT_COSTS.RATING_BONUS;
        await update('users', user_id, { 
          credits: user.credits + bonus 
        });

        await insert('credit_transactions', {
          user_id,
          amount: bonus,
          reason: 'Rating bonus',
          balance_after: user.credits + bonus,
          item_id: view_id
        });
      }
    }

    return res.status(201).json({
      success: true,
      message: 'Rating submitted successfully',
      rating_id: ratingRecord.rating_id,
      bonus_earned: user_id ? CREDIT_COSTS.RATING_BONUS : 0
    });

  } catch (error) {
    console.error('Rate article error:', error);
    return res.status(500).json({ error: 'Failed to submit rating' });
  }
}

// ============================================
// 👤 SET PREFERENCE
// ============================================

async function setPreference(req, res, user_id) {
  if (!user_id) {
    return res.status(400).json({ error: 'user_id required' });
  }

  const { preference_type, value } = req.body;

  if (!preference_type || value === undefined) {
    return res.status(400).json({ error: 'preference_type and value required' });
  }

  try {
    // Check if user exists
    const users = await getByColumn('users', 'user_id', user_id);
    if (users.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    let updateData = {};
    
    if (preference_type === 'profile') {
      // Check if profile exists
      const profile = await getById('profiles', parseInt(value));
      if (!profile) {
        return res.status(404).json({ error: 'Profile not found' });
      }
      updateData.preferred_profile_id = parseInt(value);
    } else {
      return res.status(400).json({ error: 'Invalid preference type' });
    }

    const updated = await update('users', user_id, updateData);

    return res.json({
      success: true,
      message: 'Preference updated',
      preference_type,
      value: updated.preferred_profile_id
    });

  } catch (error) {
    console.error('Set preference error:', error);
    return res.status(500).json({ error: 'Failed to set preference' });
  }
}

// ============================================
// 📊 TRACK USAGE (for anonymous users)
// ============================================

async function trackUsage(req, res, user_id) {
  const { anonymous_id, action_type } = req.body;

  const identifier = user_id || anonymous_id;

  if (!identifier) {
    return res.status(400).json({ error: 'user_id or anonymous_id required' });
  }

  if (!action_type) {
    return res.status(400).json({ error: 'action_type required' });
  }

  try {
    const today = new Date().toISOString().split('T')[0];
    
    // Get or create usage record
    let usageRecords = await getByColumn('usage', 'user_id', identifier);
    let todayUsage = usageRecords.find(u => u.date === today);

    const updateFields = {};
    
    if (action_type === 'read') {
      updateFields.articles_read = (todayUsage?.articles_read || 0) + 1;
    } else if (action_type === 'question') {
      updateFields.questions = (todayUsage?.questions || 0) + 1;
    } else if (action_type === 'deep_dive') {
      updateFields.deep_dives = (todayUsage?.deep_dives || 0) + 1;
    } else {
      return res.status(400).json({ error: 'Invalid action_type' });
    }

    if (todayUsage) {
      await update('usage', todayUsage.usage_id, updateFields);
    } else {
      await insert('usage', {
        user_id: identifier,
        date: today,
        questions: action_type === 'question' ? 1 : 0,
        deep_dives: action_type === 'deep_dive' ? 1 : 0,
        articles_read: action_type === 'read' ? 1 : 0,
        credits_used: 0
      });
    }

    // Get updated usage
    const updatedUsage = await getByColumn('usage', 'user_id', identifier);
    const todayUpdated = updatedUsage.find(u => u.date === today);

    // Check limits for anonymous users
    let isLimited = false;
    let limitMessage = '';
    let limitRemaining = 0;

    if (!user_id) {
      if (action_type === 'read' && (todayUpdated?.articles_read || 0) > DAILY_LIMITS.UNAUTHENTICATED_ARTICLES) {
        isLimited = true;
        limitMessage = `Daily article limit reached (${DAILY_LIMITS.UNAUTHENTICATED_ARTICLES} per day)`;
        limitRemaining = 0;
      } else if (action_type === 'question' && (todayUpdated?.questions || 0) > DAILY_LIMITS.UNAUTHENTICATED_QUESTIONS) {
        isLimited = true;
        limitMessage = `Daily question limit reached (${DAILY_LIMITS.UNAUTHENTICATED_QUESTIONS} per day)`;
        limitRemaining = 0;
      } else {
        const remaining = action_type === 'read' 
          ? DAILY_LIMITS.UNAUTHENTICATED_ARTICLES - (todayUpdated?.articles_read || 0)
          : DAILY_LIMITS.UNAUTHENTICATED_QUESTIONS - (todayUpdated?.questions || 0);
        limitRemaining = Math.max(0, remaining);
      }
    }

    return res.json({
      success: true,
      identifier,
      is_authenticated: !!user_id,
      action_type,
      usage: todayUpdated,
      limits: {
        max: user_id ? DAILY_LIMITS.AUTHENTICATED_CREDITS : 
              action_type === 'read' ? DAILY_LIMITS.UNAUTHENTICATED_ARTICLES : 
              DAILY_LIMITS.UNAUTHENTICATED_QUESTIONS,
        used: user_id ? (todayUpdated?.credits_used || 0) :
              action_type === 'read' ? (todayUpdated?.articles_read || 0) :
              (todayUpdated?.questions || 0),
        remaining: limitRemaining,
        is_limited: isLimited,
        message: limitMessage
      }
    });

  } catch (error) {
    console.error('Track usage error:', error);
    return res.status(500).json({ error: 'Failed to track usage' });
  }
}

// ============================================
// 👤 ANONYMOUS USER STATUS
// ============================================

async function getAnonymousStatus(req, res, anonymous_id) {
  if (!anonymous_id) {
    return res.status(400).json({ error: 'anonymous_id required' });
  }

  try {
    const today = new Date().toISOString().split('T')[0];
    const usageRecords = await getByColumn('usage', 'user_id', anonymous_id);
    const todayUsage = usageRecords.find(u => u.date === today);

    return res.json({
      anonymous_id,
      is_authenticated: false,
      limits: {
        articles: {
          max: DAILY_LIMITS.UNAUTHENTICATED_ARTICLES,
          used: todayUsage?.articles_read || 0,
          remaining: Math.max(0, DAILY_LIMITS.UNAUTHENTICATED_ARTICLES - (todayUsage?.articles_read || 0))
        },
        questions: {
          max: DAILY_LIMITS.UNAUTHENTICATED_QUESTIONS,
          used: todayUsage?.questions || 0,
          remaining: Math.max(0, DAILY_LIMITS.UNAUTHENTICATED_QUESTIONS - (todayUsage?.questions || 0))
        }
      },
      has_deep_dive_access: false,
      has_context_access: false
    });

  } catch (error) {
    console.error('Get anonymous status error:', error);
    return res.status(500).json({ error: 'Failed to get anonymous status' });
  }
}

// ============================================
// 🗑️ DELETE ACCOUNT
// ============================================

async function deleteAccount(req, res, user_id) {
  if (!user_id) {
    return res.status(400).json({ error: 'user_id required' });
  }

  const { password } = req.body;

  if (!password) {
    return res.status(400).json({ error: 'Password required for confirmation' });
  }

  try {
    const users = await getByColumn('users', 'user_id', user_id);

    if (users.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    const user = users[0];
    const validPassword = await bcrypt.compare(password, user.password_hash);

    if (!validPassword) {
      return res.status(401).json({ error: 'Invalid password' });
    }

    // Delete user (cascade will handle related tables if foreign keys set)
    await deleteRecord('users', user_id);

    return res.json({
      success: true,
      message: 'Account deleted successfully'
    });

  } catch (error) {
    console.error('Delete account error:', error);
    return res.status(500).json({ error: 'Failed to delete account' });
  }
}

// ============================================
// 📦 EXPORTS
// ============================================

export const config = {
  api: {
    bodyParser: {
      sizeLimit: '10mb',
    },
  },
};

export const constants = {
  CREDIT_COSTS,
  DAILY_LIMITS
};