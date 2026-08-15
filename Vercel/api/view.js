// api/view.js
// EasyRead Article View - Renders full article page with meta tags, bookmarks, and authentication

import { 
  supabase,
  getById,
  getByColumn,
  insert,
  update,
  deleteRecord
} from '../utils/supabase.js';
import crypto from 'crypto';

// ============================================
// CONSTANTS
// ============================================
const PROCESSOR_URL = process.env.PROCESSOR_URL || 'https://my-fcm-server.onrender.com/api/processor';
const ADMIN_API_KEY = process.env.ADMIN_API_KEY;
const SITE_URL = process.env.SITE_URL || 'https://easytoread.vercel.app';

// Guest limits (hardcoded)
const GUEST_LIMITS = {
  ARTICLES_PER_DAY: 30,
  QUESTIONS_PER_DAY: 2,
  HAS_DEEP_DIVE_ACCESS: false,
  HAS_CONTEXT_ACCESS: false
};

// Credit costs (hardcoded)
const CREDIT_COSTS = {
  ASK_QUESTION: 1,
  DEEP_DIVE: 0.5,
  CONTEXT_SUBMIT: 1,
  MAKE_PRIVATE: 2,
  RATING_BONUS: 0.2
};

const AUTHENTICATED_DAILY_CREDITS = 50;

// ============================================
// COLOR GENERATION SYSTEM
// ============================================

const COLOR_PAIRS = [
  { bg: '0A0A23', text: 'F5F5F5' },
  { bg: '1B1B3A', text: 'F0E6D0' },
  { bg: '2D1B2E', text: 'E8D5B7' },
  { bg: '1A2F2E', text: 'E5E5E5' },
  { bg: '2A2A3E', text: 'E0E0E0' },
  { bg: '3C1E1E', text: 'F2E6D9' },
  { bg: '1E2A3A', text: 'D4E0E8' },
  { bg: '0F1B2D', text: 'F0E68C' },
  { bg: '2B1A3A', text: 'E8D5B7' },
  { bg: '1A2B3C', text: 'E5E5E5' },
  { bg: '4A1A2A', text: 'F5E6D3' },
  { bg: '2C2C2C', text: 'F5F5DC' },
  { bg: '1C2833', text: 'E8E8E8' },
  { bg: '3A1C1C', text: 'F2D7B6' },
  { bg: '1A1A2E', text: 'E6E6FA' },
  { bg: '2C1A1A', text: 'F5DEB3' },
  { bg: '0D1B2A', text: 'F0E6D0' },
  { bg: '2D2D44', text: 'F5E6CC' },
  { bg: '1E3A2A', text: 'E8F0E8' },
  { bg: '3A1A2A', text: 'F5E0D0' },
  { bg: '1A2A3A', text: 'E8E8F0' },
  { bg: '4A2A1A', text: 'F5E8D0' },
  { bg: '0A1A2A', text: 'E0E8F0' },
  { bg: '2A1A3A', text: 'F0E8F5' },
  { bg: '1A3A2A', text: 'E8F0E0' },
  { bg: '3A2A1A', text: 'F0E8D0' }
];

function getColorPairForArticle(articleId) {
  const index = articleId % COLOR_PAIRS.length;
  return COLOR_PAIRS[index];
}

function generateOgImageUrl(title, bgColor, textColor) {
  const encodedTitle = encodeURIComponent(title.substring(0, 60));
  return `https://placehold.co/1200x630/${bgColor}/${textColor}?text=${encodedTitle}`;
}

// ============================================
// GUEST TRACKING HELPERS
// ============================================

function hashIP(ip) {
  return crypto.createHash('sha256').update(ip + process.env.IP_SALT || 'easyread-salt').digest('hex');
}

function getGuestIdentifier(req) {
  const forwarded = req.headers['x-forwarded-for'];
  const ip = forwarded ? forwarded.split(',')[0].trim() : req.socket.remoteAddress || req.connection.remoteAddress;
  const userAgent = req.headers['user-agent'] || '';
  const combined = `${ip}:${userAgent}`;
  return hashIP(combined);
}

async function checkGuestLimit(guestId, actionType) {
  const today = new Date().toISOString().split('T')[0];

  const { data: existing, error } = await supabase
    .from('usage')
    .select('*')
    .eq('user_id', guestId)
    .eq('date', today)
    .maybeSingle();

  if (error && error.code !== 'PGRST116') throw error;

  let usage = existing;
  if (!usage) {
    const { data: newUsage, error: insertError } = await supabase
      .from('usage')
      .insert({
        user_id: guestId,
        date: today,
        questions: 0,
        deep_dives: 0,
        articles_read: 0,
        context_submits: 0,
        credits_used: 0
      })
      .select()
      .single();

    if (insertError) throw insertError;
    usage = newUsage;
  }

  if (actionType === 'read') {
    const readCount = usage.articles_read || 0;
    if (readCount >= GUEST_LIMITS.ARTICLES_PER_DAY) {
      return {
        allowed: false,
        limit: GUEST_LIMITS.ARTICLES_PER_DAY,
        used: readCount,
        remaining: 0,
        message: `Daily article limit reached (${GUEST_LIMITS.ARTICLES_PER_DAY} per day)`
      };
    }
    return {
      allowed: true,
      limit: GUEST_LIMITS.ARTICLES_PER_DAY,
      used: readCount,
      remaining: GUEST_LIMITS.ARTICLES_PER_DAY - readCount,
      usage
    };
  }

  if (actionType === 'question') {
    const questionCount = usage.questions || 0;
    if (questionCount >= GUEST_LIMITS.QUESTIONS_PER_DAY) {
      return {
        allowed: false,
        limit: GUEST_LIMITS.QUESTIONS_PER_DAY,
        used: questionCount,
        remaining: 0,
        message: `Daily question limit reached (${GUEST_LIMITS.QUESTIONS_PER_DAY} per day)`
      };
    }
    return {
      allowed: true,
      limit: GUEST_LIMITS.QUESTIONS_PER_DAY,
      used: questionCount,
      remaining: GUEST_LIMITS.QUESTIONS_PER_DAY - questionCount,
      usage
    };
  }

  if (actionType === 'deep_dive') {
    return {
      allowed: false,
      limit: 0,
      used: 0,
      remaining: 0,
      message: 'Deep dive is only available for registered users'
    };
  }

  if (actionType === 'context_submit') {
    return {
      allowed: false,
      limit: 0,
      used: 0,
      remaining: 0,
      message: 'Context submit is only available for registered users'
    };
  }

  return { allowed: true };
}

async function trackGuestUsage(guestId, actionType) {
  const today = new Date().toISOString().split('T')[0];

  const { data: existing, error } = await supabase
    .from('usage')
    .select('*')
    .eq('user_id', guestId)
    .eq('date', today)
    .maybeSingle();

  if (error && error.code !== 'PGRST116') throw error;

  let usage = existing;
  if (!usage) {
    const { data: newUsage, error: insertError } = await supabase
      .from('usage')
      .insert({
        user_id: guestId,
        date: today,
        questions: 0,
        deep_dives: 0,
        articles_read: 0,
        context_submits: 0,
        credits_used: 0
      })
      .select()
      .single();

    if (insertError) throw insertError;
    usage = newUsage;
  }

  const updateFields = {};
  if (actionType === 'read') {
    updateFields.articles_read = (usage.articles_read || 0) + 1;
  } else if (actionType === 'question') {
    updateFields.questions = (usage.questions || 0) + 1;
  } else if (actionType === 'deep_dive') {
    updateFields.deep_dives = (usage.deep_dives || 0) + 1;
  } else if (actionType === 'context_submit') {
    updateFields.context_submits = (usage.context_submits || 0) + 1;
  }

  const { data: updated, error: updateError } = await supabase
    .from('usage')
    .update(updateFields)
    .eq('usage_id', usage.usage_id)
    .select()
    .single();

  if (updateError) throw updateError;
  return updated;
}

// ============================================
// MAIN HANDLER
// ============================================
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,POST,PUT,DELETE');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version, x-user-id, x-session-token, x-guest-id'
  );

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  const { method } = req;
  const { action, id, slug } = req.query;

  try {
    switch (method) {
      case 'GET':
        if (id || slug) {
          return await renderArticlePage(req, res);
        }
        if (action === 'data' && (id || slug)) {
          return await getArticleData(req, res);
        }
        if (action === 'bookmark-status') {
          return await getBookmarkStatus(req, res);
        }
        if (action === 'guest-status') {
          return await getGuestStatus(req, res);
        }
        return res.status(400).json({ error: 'Invalid request' });
      case 'POST':
        if (action === 'rate') {
          return await submitRating(req, res);
        }
        if (action === 'deep-dive') {
          return await handleDeepDive(req, res);
        }
        if (action === 'bookmark') {
          return await toggleBookmark(req, res);
        }
        if (action === 'track-read') {
          return await trackRead(req, res);
        }
        if (action === 'track-question') {
          return await trackQuestion(req, res);
        }
        return res.status(400).json({ error: 'Invalid action' });
      case 'DELETE':
        if (action === 'bookmark') {
          return await removeBookmark(req, res);
        }
        return res.status(400).json({ error: 'Invalid action' });
      default:
        res.status(405).json({ error: 'Method not allowed' });
    }
  } catch (error) {
    console.error('View API Error:', error);
    res.status(500).json({ error: error.message });
  }
}

// ============================================
// TRACK READ
// ============================================
async function trackRead(req, res) {
  const { article_id } = req.body;
  const user_id = req.headers['x-user-id'] || req.query.user_id;
  const guestId = req.headers['x-guest-id'] || req.query.guest_id;

  if (user_id) {
    try {
      const today = new Date().toISOString().split('T')[0];
      const existing = await supabase
        .from('reading_history')
        .select('history_id')
        .eq('user_id', user_id)
        .eq('article_id', parseInt(article_id))
        .eq('date', today)
        .single();

      if (!existing.data) {
        await insert('reading_history', {
          user_id,
          article_id: parseInt(article_id),
          date: today,
          viewed_at: new Date().toISOString()
        });
      }

      const usageRecords = await getByColumn('usage', 'user_id', user_id);
      const todayUsage = usageRecords.find(u => u.date === today);

      if (todayUsage) {
        const { error: updateError } = await supabase
          .from('usage')
          .update({ articles_read: (todayUsage.articles_read || 0) + 1 })
          .eq('usage_id', todayUsage.usage_id);
        
        if (updateError) throw updateError;
      } else {
        await insert('usage', {
          user_id,
          date: today,
          articles_read: 1,
          questions: 0,
          deep_dives: 0,
          credits_used: 0
        });
      }

      return res.json({ success: true, isAuthenticated: true });
    } catch (error) {
      console.error('Track read error:', error);
      return res.status(500).json({ error: error.message });
    }
  }

  if (!guestId) {
    return res.status(400).json({ error: 'guest_id required for guest tracking' });
  }

  try {
    const limitCheck = await checkGuestLimit(guestId, 'read');
    if (!limitCheck.allowed) {
      return res.status(429).json({
        error: 'Daily limit reached',
        message: limitCheck.message,
        limit: limitCheck.limit,
        used: limitCheck.used,
        remaining: limitCheck.remaining,
        isGuest: true
      });
    }

    await trackGuestUsage(guestId, 'read');

    res.json({
      success: true,
      isGuest: true,
      limit: limitCheck.limit,
      used: limitCheck.used + 1,
      remaining: limitCheck.remaining - 1
    });
  } catch (error) {
    console.error('Track guest read error:', error);
    res.status(500).json({ error: error.message });
  }
}

// ============================================
// TRACK QUESTION
// ============================================
async function trackQuestion(req, res) {
  const { question } = req.body;
  const user_id = req.headers['x-user-id'] || req.query.user_id;
  const guestId = req.headers['x-guest-id'] || req.query.guest_id;

  if (!question) {
    return res.status(400).json({ error: 'Question required' });
  }

  if (user_id) {
    try {
      const users = await getByColumn('users', 'user_id', user_id);
      if (users.length === 0) {
        return res.status(404).json({ error: 'User not found' });
      }

      const user = users[0];
      if (user.credits < CREDIT_COSTS.ASK_QUESTION) {
        return res.status(402).json({
          error: 'Insufficient credits',
          required: CREDIT_COSTS.ASK_QUESTION,
          available: user.credits
        });
      }

      const today = new Date().toISOString().split('T')[0];
      const usageRecords = await getByColumn('usage', 'user_id', user_id);
      const todayUsage = usageRecords.find(u => u.date === today);
      const dailyCreditsUsed = todayUsage ? todayUsage.credits_used : 0;

      if (dailyCreditsUsed + CREDIT_COSTS.ASK_QUESTION > AUTHENTICATED_DAILY_CREDITS) {
        return res.status(429).json({
          error: 'Daily credit limit exceeded',
          limit: AUTHENTICATED_DAILY_CREDITS,
          used: dailyCreditsUsed,
          remaining: AUTHENTICATED_DAILY_CREDITS - dailyCreditsUsed
        });
      }

      const { error: updateUserError } = await supabase
        .from('users')
        .update({ credits: user.credits - CREDIT_COSTS.ASK_QUESTION })
        .eq('user_id', user_id);
      
      if (updateUserError) throw updateUserError;

      if (todayUsage) {
        const { error: updateUsageError } = await supabase
          .from('usage')
          .update({
            questions: (todayUsage.questions || 0) + 1,
            credits_used: (todayUsage.credits_used || 0) + CREDIT_COSTS.ASK_QUESTION
          })
          .eq('usage_id', todayUsage.usage_id);
        
        if (updateUsageError) throw updateUsageError;
      } else {
        await insert('usage', {
          user_id,
          date: today,
          questions: 1,
          credits_used: CREDIT_COSTS.ASK_QUESTION
        });
      }

      await insert('credit_transactions', {
        user_id,
        amount: -CREDIT_COSTS.ASK_QUESTION,
        reason: 'ask_question',
        balance_after: user.credits - CREDIT_COSTS.ASK_QUESTION
      });

      return res.json({
        success: true,
        isAuthenticated: true,
        credits_remaining: user.credits - CREDIT_COSTS.ASK_QUESTION
      });
    } catch (error) {
      console.error('Track question error:', error);
      return res.status(500).json({ error: error.message });
    }
  }

  if (!guestId) {
    return res.status(400).json({ error: 'guest_id required for guest tracking' });
  }

  try {
    const limitCheck = await checkGuestLimit(guestId, 'question');
    if (!limitCheck.allowed) {
      return res.status(429).json({
        error: 'Daily limit reached',
        message: limitCheck.message,
        limit: limitCheck.limit,
        used: limitCheck.used,
        remaining: limitCheck.remaining,
        isGuest: true
      });
    }

    await trackGuestUsage(guestId, 'question');

    res.json({
      success: true,
      isGuest: true,
      limit: limitCheck.limit,
      used: limitCheck.used + 1,
      remaining: limitCheck.remaining - 1
    });
  } catch (error) {
    console.error('Track guest question error:', error);
    res.status(500).json({ error: error.message });
  }
}

// ============================================
// GET GUEST STATUS
// ============================================
async function getGuestStatus(req, res) {
  const guestId = req.headers['x-guest-id'] || req.query.guest_id;

  if (!guestId) {
    return res.status(400).json({ error: 'guest_id required' });
  }

  try {
    const today = new Date().toISOString().split('T')[0];
    const { data: usage, error } = await supabase
      .from('usage')
      .select('*')
      .eq('user_id', guestId)
      .eq('date', today)
      .maybeSingle();

    if (error && error.code !== 'PGRST116') throw error;

    const articlesRead = usage?.articles_read || 0;
    const questionsAsked = usage?.questions || 0;

    res.json({
      isAuthenticated: false,
      limits: {
        articles: {
          max: GUEST_LIMITS.ARTICLES_PER_DAY,
          used: articlesRead,
          remaining: Math.max(0, GUEST_LIMITS.ARTICLES_PER_DAY - articlesRead)
        },
        questions: {
          max: GUEST_LIMITS.QUESTIONS_PER_DAY,
          used: questionsAsked,
          remaining: Math.max(0, GUEST_LIMITS.QUESTIONS_PER_DAY - questionsAsked)
        }
      },
      features: {
        deep_dive: GUEST_LIMITS.HAS_DEEP_DIVE_ACCESS,
        context_setup: GUEST_LIMITS.HAS_CONTEXT_ACCESS,
        bookmarks: false
      }
    });
  } catch (error) {
    console.error('Get guest status error:', error);
    res.status(500).json({ error: error.message });
  }
}

// ============================================
// RENDER FULL ARTICLE PAGE
// ============================================

async function renderArticlePage(req, res) {
  const { id, slug } = req.query;
  const user_id = req.headers['x-user-id'] || req.query.user_id;
  const sessionToken = req.headers['x-session-token'] || req.query.session_token;
  const guestId = req.headers['x-guest-id'] || req.query.guest_id || getGuestIdentifier(req);

  try {
    let article;
    if (id) {
      article = await getById('articles', id);
    } else if (slug) {
      const articles = await getByColumn('articles', 'slug', slug);
      article = articles[0] || null;
    }

    if (!article) {
      return res.status(404).send(renderNotFoundPage());
    }

    // GUEST TRACKING
    if (!user_id && guestId) {
      const limitCheck = await checkGuestLimit(guestId, 'read');
      if (!limitCheck.allowed) {
        return res.status(200).send(buildArticleHTML({
          article,
          explanations: [],
          ratings: [],
          userRating: null,
          userCredits: null,
          profiles: [],
          user_id: null,
          sessionToken: null,
          ogImageUrl: generateOgImageUrl(article.canonical_title || 'EasyRead Article', '1A1A2E', 'FFFFFF'),
          colorPair: { bg: '1A1A2E', text: 'FFFFFF' },
          isBookmarked: false,
          guestLimitReached: true,
          guestLimitInfo: {
            type: 'read',
            limit: limitCheck.limit,
            used: limitCheck.used,
            remaining: limitCheck.remaining,
            message: limitCheck.message
          },
          isGuest: true,
          guestId: guestId
        }));
      }

      await trackGuestUsage(guestId, 'read');
    } else if (user_id) {
      const today = new Date().toISOString().split('T')[0];
      const { data: existing, error: historyError } = await supabase
        .from('reading_history')
        .select('history_id')
        .eq('user_id', user_id)
        .eq('article_id', article.article_id)
        .eq('date', today)
        .maybeSingle();

      if (historyError && historyError.code !== 'PGRST116') throw historyError;

      if (!existing) {
        await insert('reading_history', {
          user_id,
          article_id: article.article_id,
          date: today,
          viewed_at: new Date().toISOString()
        });
      }

      const usageRecords = await getByColumn('usage', 'user_id', user_id);
      const todayUsage = usageRecords.find(u => u.date === today);

      if (todayUsage) {
        const { error: updateError } = await supabase
          .from('usage')
          .update({ articles_read: (todayUsage.articles_read || 0) + 1 })
          .eq('usage_id', todayUsage.usage_id);
        
        if (updateError) throw updateError;
      } else {
        await insert('usage', {
          user_id,
          date: today,
          articles_read: 1,
          questions: 0,
          deep_dives: 0,
          credits_used: 0
        });
      }
    }

    // ✅ FIX: Use direct supabase update instead of the imported update function
    const { error: updateError } = await supabase
      .from('articles')
      .update({ view_count: (article.view_count || 0) + 1 })
      .eq('article_id', article.article_id);

    if (updateError) throw updateError;

    const colorPair = getColorPairForArticle(article.article_id);
    const ogImageUrl = generateOgImageUrl(
      article.canonical_title || 'EasyRead Article',
      colorPair.bg,
      colorPair.text
    );

    const { data: explanations, error: expError } = await supabase
      .from('explanation_views')
      .select(`
        view_id,
        title,
        content,
        summary,
        profile_id,
        view_count,
        rating_avg,
        rating_count,
        profiles:profile_id (name, description)
      `)
      .eq('article_id', article.article_id)
      .order('view_count', { ascending: false });

    if (expError) throw expError;

    const { data: ratings, error: ratingError } = await supabase
      .from('ratings')
      .select('rating, feedback, user_id, created_at')
      .in('view_id', explanations?.map(e => e.view_id) || [])
      .order('created_at', { ascending: false })
      .limit(50);

    if (ratingError) throw ratingError;

    let userRating = null;
    if (user_id && explanations && explanations.length > 0) {
      const { data: ur, error: urError } = await supabase
        .from('ratings')
        .select('rating, feedback, view_id')
        .eq('user_id', user_id)
        .in('view_id', explanations.map(e => e.view_id))
        .maybeSingle();
      
      if (urError && urError.code !== 'PGRST116') throw urError;
      userRating = ur;
    }

    let userCredits = null;
    if (user_id) {
      const users = await getByColumn('users', 'user_id', user_id);
      if (users.length > 0) {
        userCredits = users[0].credits;
      }
    }

    let isBookmarked = false;
    if (user_id) {
      const { data: bookmark, error: bmError } = await supabase
        .from('bookmarks')
        .select('bookmark_id')
        .eq('user_id', user_id)
        .eq('article_id', article.article_id)
        .maybeSingle();
      
      if (bmError && bmError.code !== 'PGRST116') throw bmError;
      isBookmarked = !!bookmark;
    }

    const { data: profiles, error: profileError } = await supabase
      .from('profiles')
      .select('*')
      .eq('status', 'active')
      .order('profile_id', { ascending: true });

    if (profileError) throw profileError;

    let guestLimitInfo = null;
    if (!user_id && guestId) {
      const limitCheck = await checkGuestLimit(guestId, 'read');
      guestLimitInfo = {
        limit: limitCheck.limit,
        used: limitCheck.used,
        remaining: limitCheck.remaining,
        message: limitCheck.message
      };
    }

    const html = buildArticleHTML({
      article,
      explanations: explanations || [],
      ratings: ratings || [],
      userRating,
      userCredits,
      profiles: profiles || [],
      user_id,
      sessionToken,
      ogImageUrl,
      colorPair,
      isBookmarked,
      guestId,
      guestLimitInfo,
      isGuest: !user_id
    });

    res.setHeader('Content-Type', 'text/html');
    res.status(200).send(html);

  } catch (error) {
    console.error('Render article error:', error);
    res.status(500).send(renderErrorPage(error.message));
  }
}

// ============================================
// GET ARTICLE DATA
// ============================================
async function getArticleData(req, res) {
  const { id, slug } = req.query;
  const user_id = req.headers['x-user-id'] || req.query.user_id;
  const guestId = req.headers['x-guest-id'] || req.query.guest_id || getGuestIdentifier(req);

  try {
    let article;
    if (id) {
      article = await getById('articles', id);
    } else if (slug) {
      const articles = await getByColumn('articles', 'slug', slug);
      article = articles[0] || null;
    }

    if (!article) {
      return res.status(404).json({ error: 'Article not found' });
    }

    const colorPair = getColorPairForArticle(article.article_id);
    const ogImageUrl = generateOgImageUrl(
      article.canonical_title || 'EasyRead Article',
      colorPair.bg,
      colorPair.text
    );

    const { data: explanations, error: expError } = await supabase
      .from('explanation_views')
      .select(`
        view_id,
        title,
        content,
        summary,
        profile_id,
        view_count,
        rating_avg,
        rating_count,
        profiles:profile_id (name, description)
      `)
      .eq('article_id', article.article_id);

    if (expError) throw expError;

    const { data: ratings, error: ratingError } = await supabase
      .from('ratings')
      .select('rating, feedback, user_id, created_at')
      .in('view_id', explanations?.map(e => e.view_id) || [])
      .order('created_at', { ascending: false })
      .limit(50);

    if (ratingError) throw ratingError;

    let userRating = null;
    if (user_id && explanations && explanations.length > 0) {
      const { data: ur } = await supabase
        .from('ratings')
        .select('rating, feedback, view_id')
        .eq('user_id', user_id)
        .in('view_id', explanations.map(e => e.view_id))
        .maybeSingle();
      userRating = ur;
    }

    let userCredits = null;
    if (user_id) {
      const users = await getByColumn('users', 'user_id', user_id);
      if (users.length > 0) {
        userCredits = users[0].credits;
      }
    }

    let isBookmarked = false;
    if (user_id) {
      const { data: bookmark } = await supabase
        .from('bookmarks')
        .select('bookmark_id')
        .eq('user_id', user_id)
        .eq('article_id', article.article_id)
        .maybeSingle();
      isBookmarked = !!bookmark;
    }

    let guestLimitInfo = null;
    if (!user_id && guestId) {
      const limitCheck = await checkGuestLimit(guestId, 'read');
      guestLimitInfo = {
        limit: limitCheck.limit,
        used: limitCheck.used,
        remaining: limitCheck.remaining
      };
    }

    res.json({
      success: true,
      article: {
        ...article,
        reading_time: Math.ceil((article.base_content?.split(/\s+/).length || 0) / 200),
        view_count: (article.view_count || 0) + 1,
        og_image: ogImageUrl
      },
      explanations: explanations || [],
      ratings: ratings || [],
      userRating,
      userCredits,
      isBookmarked,
      isGuest: !user_id,
      guestLimitInfo
    });

  } catch (error) {
    console.error('Get article data error:', error);
    res.status(500).json({ error: error.message });
  }
}

// ============================================
// TOGGLE BOOKMARK
// ============================================
async function toggleBookmark(req, res) {
  const { article_id } = req.body;
  const user_id = req.headers['x-user-id'] || req.query.user_id;

  if (!user_id) {
    return res.status(401).json({ 
      error: 'Authentication required',
      redirect: `${SITE_URL}#login`
    });
  }

  if (!article_id) {
    return res.status(400).json({ error: 'article_id required' });
  }

  try {
    const { data: existing, error: checkError } = await supabase
      .from('bookmarks')
      .select('bookmark_id')
      .eq('user_id', user_id)
      .eq('article_id', parseInt(article_id))
      .maybeSingle();

    if (checkError) throw checkError;

    if (existing) {
      await deleteRecord('bookmarks', existing.bookmark_id);

      const { count, error: countError } = await supabase
        .from('bookmarks')
        .select('*', { count: 'exact', head: true })
        .eq('article_id', parseInt(article_id));

      if (countError) throw countError;

      return res.json({
        success: true,
        bookmarked: false,
        bookmark_count: count || 0,
        message: 'Bookmark removed'
      });
    } else {
      const bookmark = await insert('bookmarks', {
        user_id,
        article_id: parseInt(article_id),
        created_at: new Date().toISOString()
      });

      const { count, error: countError } = await supabase
        .from('bookmarks')
        .select('*', { count: 'exact', head: true })
        .eq('article_id', parseInt(article_id));

      if (countError) throw countError;

      return res.status(201).json({
        success: true,
        bookmarked: true,
        bookmark_id: bookmark.bookmark_id,
        bookmark_count: count || 0,
        message: 'Bookmark added'
      });
    }
  } catch (error) {
    console.error('Toggle bookmark error:', error);
    res.status(500).json({ error: error.message });
  }
}

// ============================================
// REMOVE BOOKMARK
// ============================================
async function removeBookmark(req, res) {
  const { article_id } = req.query;
  const user_id = req.headers['x-user-id'] || req.query.user_id;

  if (!user_id) {
    return res.status(401).json({ 
      error: 'Authentication required',
      redirect: `${SITE_URL}#login`
    });
  }

  if (!article_id) {
    return res.status(400).json({ error: 'article_id required' });
  }

  try {
    const { data: existing, error: checkError } = await supabase
      .from('bookmarks')
      .select('bookmark_id')
      .eq('user_id', user_id)
      .eq('article_id', parseInt(article_id))
      .maybeSingle();

    if (checkError) throw checkError;

    if (!existing) {
      return res.status(404).json({ error: 'Bookmark not found' });
    }

    await deleteRecord('bookmarks', existing.bookmark_id);

    res.json({
      success: true,
      message: 'Bookmark removed'
    });
  } catch (error) {
    console.error('Remove bookmark error:', error);
    res.status(500).json({ error: error.message });
  }
}

// ============================================
// GET BOOKMARK STATUS
// ============================================
async function getBookmarkStatus(req, res) {
  const { article_id } = req.query;
  const user_id = req.headers['x-user-id'] || req.query.user_id;

  if (!user_id) {
    return res.json({ isBookmarked: false, isAuthenticated: false });
  }

  if (!article_id) {
    return res.status(400).json({ error: 'article_id required' });
  }

  try {
    const { data: bookmark, error } = await supabase
      .from('bookmarks')
      .select('bookmark_id, created_at')
      .eq('user_id', user_id)
      .eq('article_id', parseInt(article_id))
      .maybeSingle();

    if (error) throw error;

    res.json({
      isBookmarked: !!bookmark,
      bookmark_id: bookmark?.bookmark_id,
      created_at: bookmark?.created_at,
      isAuthenticated: true
    });
  } catch (error) {
    console.error('Get bookmark status error:', error);
    res.status(500).json({ error: error.message });
  }
}

// ============================================
// SUBMIT RATING
// ============================================
async function submitRating(req, res) {
  const { view_id, rating, feedback } = req.body;
  const user_id = req.headers['x-user-id'] || req.query.user_id;

  if (!user_id) {
    return res.status(401).json({ 
      error: 'Authentication required',
      redirect: `${SITE_URL}#login`
    });
  }

  if (!view_id || !rating) {
    return res.status(400).json({ error: 'view_id and rating required' });
  }

  if (rating < 1 || rating > 5) {
    return res.status(400).json({ error: 'Rating must be between 1 and 5' });
  }

  try {
    const existing = await supabase
      .from('ratings')
      .select('rating_id, rating')
      .eq('user_id', user_id)
      .eq('view_id', view_id)
      .single();

    if (existing.data) {
      return res.status(409).json({
        error: 'Already rated this article',
        rating_id: existing.data.rating_id,
        rating: existing.data.rating
      });
    }

    const ratingRecord = await insert('ratings', {
      user_id,
      view_id: parseInt(view_id),
      rating,
      feedback: feedback || null
    });

    const { data: viewData, error: viewError } = await supabase
      .from('explanation_views')
      .select('rating_avg, rating_count')
      .eq('view_id', view_id)
      .single();

    if (viewError) throw viewError;

    const newCount = (viewData.rating_count || 0) + 1;
    const newAvg = ((viewData.rating_avg || 0) * (viewData.rating_count || 0) + rating) / newCount;

    const { error: updateViewError } = await supabase
      .from('explanation_views')
      .update({
        rating_avg: Math.round(newAvg * 100) / 100,
        rating_count: newCount
      })
      .eq('view_id', view_id);

    if (updateViewError) throw updateViewError;

    const users = await getByColumn('users', 'user_id', user_id);
    if (users.length > 0) {
      const user = users[0];
      const bonus = CREDIT_COSTS.RATING_BONUS;
      
      const { error: updateUserError } = await supabase
        .from('users')
        .update({ credits: user.credits + bonus })
        .eq('user_id', user_id);
      
      if (updateUserError) throw updateUserError;

      await insert('credit_transactions', {
        user_id,
        amount: bonus,
        reason: 'Rating bonus',
        balance_after: user.credits + bonus,
        item_id: view_id
      });
    }

    res.status(201).json({
      success: true,
      message: 'Rating submitted successfully',
      rating_id: ratingRecord.rating_id,
      bonus_earned: CREDIT_COSTS.RATING_BONUS
    });

  } catch (error) {
    console.error('Submit rating error:', error);
    res.status(500).json({ error: error.message });
  }
}

// ============================================
// HANDLE DEEP DIVE
// ============================================
async function handleDeepDive(req, res) {
  const { article_id, profile_id, question } = req.body;
  const user_id = req.headers['x-user-id'] || req.query.user_id;

  if (!user_id) {
    return res.status(401).json({ 
      error: 'Authentication required',
      redirect: `${SITE_URL}#login`
    });
  }

  if (!article_id || !profile_id || !question) {
    return res.status(400).json({ error: 'article_id, profile_id, and question required' });
  }

  try {
    const { data: existing, error: checkError } = await supabase
      .from('deep_dives')
      .select('*')
      .eq('article_id', article_id)
      .eq('profile_id', profile_id)
      .eq('question', question)
      .single();

    if (checkError && checkError.code !== 'PGRST116') throw checkError;

    if (existing) {
      return res.json({
        success: true,
        cached: true,
        deep_dive: existing,
        message: 'Deep dive retrieved from cache'
      });
    }

    const users = await getByColumn('users', 'user_id', user_id);
    if (users.length > 0) {
      const user = users[0];
      if (user.credits < CREDIT_COSTS.DEEP_DIVE) {
        return res.status(402).json({
          error: 'Insufficient credits',
          required: CREDIT_COSTS.DEEP_DIVE,
          available: user.credits
        });
      }
    }

    const today = new Date().toISOString().split('T')[0];
    const usageRecords = await getByColumn('usage', 'user_id', user_id);
    const todayUsage = usageRecords.find(u => u.date === today);
    const dailyCreditsUsed = todayUsage ? todayUsage.credits_used : 0;

    if (dailyCreditsUsed + CREDIT_COSTS.DEEP_DIVE > AUTHENTICATED_DAILY_CREDITS) {
      return res.status(429).json({
        error: 'Daily credit limit exceeded',
        limit: AUTHENTICATED_DAILY_CREDITS,
        used: dailyCreditsUsed,
        remaining: AUTHENTICATED_DAILY_CREDITS - dailyCreditsUsed
      });
    }

    const response = await fetch(`${PROCESSOR_URL}/generate-deep-dive`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-admin-key': ADMIN_API_KEY
      },
      body: JSON.stringify({
        article_id: parseInt(article_id),
        profile_id: parseInt(profile_id),
        question,
        parent_section: 'General',
        user_id: user_id || null
      }),
      timeout: 60000
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error || `Processor returned ${response.status}`);
    }

    const data = await response.json();

    if (!data.success) {
      throw new Error(data.error || 'Failed to generate deep dive');
    }

    const user = users[0];
    
    const { error: updateUserError } = await supabase
      .from('users')
      .update({ credits: user.credits - CREDIT_COSTS.DEEP_DIVE })
      .eq('user_id', user_id);
    
    if (updateUserError) throw updateUserError;

    if (todayUsage) {
      const { error: updateUsageError } = await supabase
        .from('usage')
        .update({
          deep_dives: (todayUsage.deep_dives || 0) + 1,
          credits_used: (todayUsage.credits_used || 0) + CREDIT_COSTS.DEEP_DIVE
        })
        .eq('usage_id', todayUsage.usage_id);
      
      if (updateUsageError) throw updateUsageError;
    } else {
      await insert('usage', {
        user_id,
        date: today,
        deep_dives: 1,
        credits_used: CREDIT_COSTS.DEEP_DIVE
      });
    }

    await insert('credit_transactions', {
      user_id,
      amount: -CREDIT_COSTS.DEEP_DIVE,
      reason: 'deep_dive',
      balance_after: user.credits - CREDIT_COSTS.DEEP_DIVE,
      item_id: article_id
    });

    const { data: deepDive, error: fetchError } = await supabase
      .from('deep_dives')
      .select('*')
      .eq('article_id', article_id)
      .eq('profile_id', profile_id)
      .eq('question', question)
      .maybeSingle();

    res.json({
      success: true,
      cached: false,
      deep_dive: deepDive || data.deep_dive,
      credits_remaining: user.credits - CREDIT_COSTS.DEEP_DIVE,
      message: 'Deep dive generated successfully'
    });

  } catch (error) {
    console.error('Deep dive error:', error);
    res.status(500).json({ error: error.message });
  }
}

// ============================================
// HTML BUILDERS
// ============================================

// The HTML builders now use string concatenation instead of template literals
// to avoid the Unicode character issues

function buildArticleHTML({ 
  article, 
  explanations, 
  ratings, 
  userRating, 
  userCredits, 
  profiles, 
  user_id,
  sessionToken,
  ogImageUrl,
  colorPair,
  isBookmarked,
  guestId,
  guestLimitInfo,
  isGuest
}) {
  const title = article.canonical_title || 'Untitled Article';
  const description = article.summary || 'Read this article on EasyRead';
  const slug = article.slug || `article-${article.article_id}`;

  const imageUrl = ogImageUrl || `https://placehold.co/1200x630/1A1A2E/FFFFFF?text=${encodeURIComponent(title.substring(0, 60))}`;

  // Use simple string concatenation to avoid Unicode issues
  let html = '<!DOCTYPE html>\n';
  html += '<html lang="en" data-theme="auto">\n';
  html += '<head>\n';
  html += '  <meta charset="UTF-8">\n';
  html += '  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=yes, viewport-fit=cover">\n';
  html += '  <title>' + escapeHtml(title) + ' | EasyRead</title>\n';
  html += '  <meta name="description" content="' + escapeHtml(description) + '">\n';
  html += '  <meta property="og:title" content="' + escapeHtml(title) + ' | EasyRead">\n';
  html += '  <meta property="og:description" content="' + escapeHtml(description) + '">\n';
  html += '  <meta property="og:image" content="' + imageUrl + '">\n';
  html += '  <meta property="og:url" content="' + SITE_URL + '/view?id=' + article.article_id + '">\n';
  html += '  <meta property="og:type" content="article">\n';
  html += '  <meta property="og:site_name" content="EasyRead">\n';
  html += '  <meta name="twitter:card" content="summary_large_image">\n';
  html += '  <meta name="twitter:title" content="' + escapeHtml(title) + ' | EasyRead">\n';
  html += '  <meta name="twitter:description" content="' + escapeHtml(description) + '">\n';
  html += '  <meta name="twitter:image" content="' + imageUrl + '">\n';
  html += '  <meta property="article:published_time" content="' + (article.created_at || '') + '">\n';
  html += '  <meta property="article:modified_time" content="' + (article.updated_at || '') + '">\n';
  html += '  <meta property="article:author" content="EasyRead">\n';
  if (article.categories) {
    article.categories.forEach(cat => {
      html += '  <meta property="article:tag" content="' + escapeHtml(cat) + '">\n';
    });
  }
  html += '  <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@300;400;500;600;700;800&display=swap" rel="stylesheet">\n';
  html += '  <style>' + getCSSStyles() + '</style>\n';
  html += '</head>\n';
  html += '<body>\n';

  // Progress Bar
  html += '  <div class="progress-bar" id="progressBar"></div>\n';
  html += '  <div class="toast" id="toast"></div>\n';

  // Login Modal
  html += '  <div class="login-overlay" id="loginOverlay">\n';
  html += '    <div class="login-modal">\n';
  html += '      <button class="login-close" onclick="closeLoginModal()">✕</button>\n';
  html += '      <div class="login-modal-content">\n';
  html += '        <h2>Sign in to continue</h2>\n';
  html += '        <p>You need to be logged in to bookmark articles, rate content, and access deep dives.</p>\n';
  html += '        <div class="login-modal-buttons">\n';
  html += '          <a href="' + SITE_URL + '#login" class="login-btn-primary">Sign In</a>\n';
  html += '          <a href="' + SITE_URL + '#signup" class="login-btn-secondary">Create Account</a>\n';
  html += '        </div>\n';
  html += '        <p class="login-modal-footer">You will be redirected to the login page.</p>\n';
  html += '      </div>\n';
  html += '    </div>\n';
  html += '  </div>\n';

  html += '  <div class="full-screen-reader">\n';

  // Header
  html += buildHeaderHTML(userCredits, user_id, profiles, isGuest, guestLimitInfo);

  // Guest limit warning
  if (guestLimitInfo && guestLimitInfo.used >= guestLimitInfo.limit) {
    html += '    <div style="background: #ff3b30; color: #fff; padding: 12px 16px; border-radius: 12px; margin-bottom: 1rem; text-align: center; font-weight: 600;">\n';
    html += '      ' + guestLimitInfo.message + '\n';
    html += '    </div>\n';
  }

  // Guest remaining info
  if (isGuest && guestLimitInfo) {
    html += '    <div style="display: flex; gap: 16px; margin-bottom: 1rem; font-size: 0.85rem; color: var(--text-secondary); flex-wrap: wrap;">\n';
    html += '      <span>Articles remaining: ' + guestLimitInfo.remaining + '</span>\n';
    html += '    </div>\n';
  }

  // Hero
  html += buildHeroHTML(title, article.categories);

  // Profile pills
  html += buildProfilePillsHTML(profiles);

  // Gradient card
  html += buildGradientCardHTML();

  // Article content
  html += buildArticleContentHTML(article, explanations);

  // Summary
  html += buildSummaryHTML(article);

  // Metadata
  html += buildMetadataHTML(article);

  // Reader section
  html += buildReaderSectionHTML();

  // Footer
  html += buildFooterHTML(article, user_id, userCredits, isBookmarked, isGuest);

  // Review modal
  html += buildReviewModalHTML(userRating, user_id, isGuest);

  // Deep dive modal
  html += buildDeepDiveModalHTML(isGuest);

  html += '  </div>\n';

  // JavaScript
  html += '  <script>\n';
  html += getJavaScript(article, explanations, userRating, user_id, sessionToken, isBookmarked, isGuest, guestLimitInfo, guestId);
  html += '  </script>\n';

  html += '</body>\n';
  html += '</html>\n';

  return html;
}

// ============================================
// HTML COMPONENT BUILDERS (Using string concatenation)
// ============================================

function buildHeaderHTML(userCredits, user_id, profiles, isGuest, guestLimitInfo) {
  const isAuthenticated = !!user_id;
  let html = '    <header class="reader-header">\n';
  html += '      <div class="category-breadcrumb">\n';
  html += '        <a href="/" style="color: var(--text-secondary); text-decoration: none;">EasyRead</a>\n';
  html += '        <span>›</span>\n';
  html += '        <span class="current">Reading</span>\n';
  html += '      </div>\n';
  html += '      <div class="header-actions" style="display: flex; align-items: center; gap: 8px;">\n';
  html += '        <button onclick="window.toggleTheme()" class="glass-icon-btn" title="Toggle theme">\n';
  html += '          <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor">\n';
  html += '            <path d="M12 3a9 9 0 1 0 9 9c0-.46-.04-.92-.1-1.36a5.5 5.5 0 0 1-7.64-1.56 5.5 5.5 0 0 1-1.56-7.64A9.02 9.02 0 0 0 12 3z"/>\n';
  html += '          </svg>\n';
  html += '        </button>\n';

  if (isAuthenticated) {
    html += '        <div class="credits-badge" id="userCreditsBadge" title="Credit Balance">\n';
    html += '          <span class="lightning-icon">⚡</span>\n';
    html += '          <span class="credits-val" id="creditsValueDisplay">' + (userCredits || 50) + '</span>\n';
    html += '          <span class="credits-label">credits</span>\n';
    html += '        </div>\n';
  } else {
    if (isGuest && guestLimitInfo) {
      html += '        <div class="guest-badge" style="font-size: 0.7rem; color: var(--text-muted); padding: 0.2rem 0.6rem; border: 1px solid var(--border-subtle); border-radius: 12px;">\n';
      html += '          Guest · ' + guestLimitInfo.remaining + ' reads left\n';
      html += '        </div>\n';
    }
    html += '        <a href="' + SITE_URL + '#login" class="auth-link" style="color: var(--accent-color); font-weight: 600; text-decoration: none; font-size: 0.85rem; padding: 0.4rem 0.9rem; border: 1.5px solid var(--accent-color); border-radius: 20px; transition: all 0.2s;">\n';
    html += '          Sign In\n';
    html += '        </a>\n';
  }

  html += '      </div>\n';
  html += '    </header>\n';
  return html;
}

function buildHeroHTML(title, categories) {
  const category = categories?.[0] || 'General';
  let html = '    <header class="hero-section">\n';
  html += '      <div class="category-label" style="font-size: 0.75rem; text-transform: uppercase; letter-spacing: 1px; color: var(--accent-color); font-weight: 700; margin-bottom: 0.5rem;">\n';
  html += '        ' + escapeHtml(category) + '\n';
  html += '      </div>\n';
  html += '      <h1 class="hero-title">' + escapeHtml(title) + '</h1>\n';
  html += '    </header>\n';
  return html;
}

function buildProfilePillsHTML(profiles) {
  if (!profiles || profiles.length === 0) {
    return '    <div class="profile-pills-wrapper">\n      <div class="profile-pills-scroll">\n        <button class="profile-pill active" data-profile="default" onclick="switchProfile(\'default\', this)">\n          Everyday Life\n        </button>\n      </div>\n    </div>\n';
  }

  let html = '    <div class="profile-pills-wrapper">\n';
  html += '      <div class="profile-pills-scroll" id="profilePills">\n';

  profiles.forEach((p, index) => {
    const isActive = p.is_default || index === 0;
    const icon = getProfileIcon(p.name);
    html += '        <button class="profile-pill ' + (isActive ? 'active' : '') + '" data-profile="' + p.profile_id + '" data-profile-name="' + p.name + '" onclick="switchProfile(\'' + p.profile_id + '\', this, \'' + p.name + '\')">\n';
    html += '          ' + icon + '\n';
    html += '          ' + escapeHtml(p.name) + '\n';
    html += '        </button>\n';
  });

  html += '      </div>\n';
  html += '    </div>\n';
  return html;
}

function buildGradientCardHTML() {
  return '    <div class="featured-gradient-card" id="gradientCard">\n' +
         '      <div class="gradient-card-overlay"></div>\n' +
         '      <div class="catch-line-text" id="catchLineText">"Every idea has a story. Let\'s explore it together."</div>\n' +
         '    </div>\n';
}

function buildArticleContentHTML(article, explanations) {
  const defaultExplanation = explanations?.find(e => e.profile_id === 1) || explanations?.[0];
  const content = defaultExplanation?.content || article.base_content || 'No content available.';

  const sections = parseContentIntoSections(content);

  let html = '    <article class="article-body" id="articleContent">\n';
  html += '      <div class="content-shimmer" id="contentShimmer">\n';
  for (let i = 0; i < 8; i++) {
    html += '        <div class="shimmer-line"></div>\n';
  }
  html += '      </div>\n';
  html += '      <div id="articleText" style="display: none;">\n';

  sections.forEach((section, i) => {
    if (section.type === 'heading') {
      html += '        <h2 class="subheading">' + section.content + '</h2>\n';
    } else {
      const isFirst = i === 0;
      html += '        <p class="' + (isFirst ? 'dropcap' : '') + '">' + section.content + '</p>\n';
    }
  });

  html += '      </div>\n';
  html += '    </article>\n';
  return html;
}

function buildSummaryHTML(article) {
  const summary = article.summary || 'No summary available.';
  return '    <div class="summary-wrapper">\n' +
         '      <div class="summary-content">\n' +
         '        <h4>Summary</h4>\n' +
         '        <p>' + escapeHtml(summary) + '</p>\n' +
         '      </div>\n' +
         '    </div>\n';
}

function buildMetadataHTML(article) {
  const date = article.created_at ? new Date(article.created_at).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  }) : 'Recently';

  const wordCount = article.word_count || article.base_content?.split(/\s+/).length || 0;
  const readTime = Math.ceil(wordCount / 200) || 3;

  return '    <div class="article-metadata">\n' +
         '      <div class="meta-left">\n' +
         '        <span class="author-name">EasyRead</span>\n' +
         '        <span>·</span>\n' +
         '        <span>' + date + '</span>\n' +
         '      </div>\n' +
         '      <div class="meta-right">\n' +
         '        ' + readTime + ' min read · ' + (article.view_count || 0) + ' views\n' +
         '      </div>\n' +
         '    </div>\n';
}

function buildReaderSectionHTML() {
  return '    <div class="reader-section">\n' +
         '      <div class="reader-avatars">\n' +
         '        <div class="mini-circle gold">JR</div>\n' +
         '        <div class="mini-circle blue">AK</div>\n' +
         '        <div class="mini-circle green">MS</div>\n' +
         '        <div class="mini-circle purple">TW</div>\n' +
         '      </div>\n' +
         '      <div class="reader-count">\n' +
         '        <strong>1.4k</strong> readers this hour\n' +
         '      </div>\n' +
         '    </div>\n';
}

function buildFooterHTML(article, user_id, userCredits, isBookmarked, isGuest) {
  const isAuthenticated = !!user_id;
  const bookmarkIcon = isBookmarked ? 
    '<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/></svg>' :
    '<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M17 3H7c-1.1 0-2 .9-2 2v16l7-3 7 3V5c0-1.1-.9-2-2-2z"/></svg>';

  let html = '    <div class="glass-footer">\n';
  html += '      <div class="footer-content">\n';
  html += '        <div class="link-pill">\n';
  html += '          <span>🔗 ' + (article.source_domain || 'easytoread.vercel.app') + '/</span>' + (article.slug?.substring(0, 20) || 'article') + '...\n';
  html += '        </div>\n';
  html += '        <div class="glass-actions">\n';
  html += '          <button class="glass-icon-btn" onclick="copyLink()" title="Copy link">\n';
  html += '            <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z"/></svg>\n';
  html += '          </button>\n';
  html += '          <button class="glass-icon-btn" onclick="shareLink()" title="Share">\n';
  html += '            <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M18 16.08c-.76 0-1.44.3-1.96.77L8.91 12.7c.05-.23.09-.46.09-.7s-.04-.47-.09-.7l7.05-4.11c.54.5 1.25.81 2.04.81 1.66 0 3-1.34 3-3s-1.34-3-3-3-3 1.34-3 3c0 .24.04.47.09.7L8.04 9.81C7.5 9.31 6.79 9 6 9c-1.66 0-3 1.34-3 3s1.34 3 3 3c.79 0 1.5-.31 2.04-.81l7.12 4.16c-.05.21-.08.43-.08.65 0 1.61 1.31 2.92 2.92 2.92s2.92-1.31 2.92-2.92-1.31-2.92-2.92-2.92z"/></svg>\n';
  html += '          </button>\n';
  html += '          <button class="glass-icon-btn bookmark-btn ' + (isBookmarked ? 'bookmarked' : '') + '" id="bookmarkBtn" onclick="handleBookmark()" title="' + (isBookmarked ? 'Remove bookmark' : 'Add bookmark') + '">\n';
  html += '            ' + bookmarkIcon + '\n';
  html += '          </button>\n';

  if (isAuthenticated) {
    html += '          <button class="glass-icon-btn" onclick="openDeepDiveModal()" title="Deep Dive">\n';
    html += '            <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/></svg>\n';
    html += '          </button>\n';
  } else {
    html += '          <button class="glass-icon-btn" onclick="showLoginModal(\'deep-dive\')" title="Deep Dive (Login required)">\n';
    html += '            <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/></svg>\n';
    html += '          </button>\n';
  }

  html += '        </div>\n';
  html += '      </div>\n';
  html += '    </div>\n';
  return html;
}

function buildReviewModalHTML(userRating, user_id, isGuest) {
  const hasRated = !!userRating;
  const isAuthenticated = !!user_id;

  if (!isAuthenticated || isGuest) {
    return '    <div class="review-overlay" id="reviewModal">\n' +
           '      <div class="review-modal">\n' +
           '        <button class="modal-close" onclick="closeReview()">✕</button>\n' +
           '        <div class="login-modal-content" style="text-align: center; padding: 20px 0;">\n' +
           '          <h3>Sign in to rate</h3>\n' +
           '          <p style="color: var(--text-secondary); margin: 1rem 0;">Help us improve by rating this article!</p>\n' +
           '          <a href="' + SITE_URL + '#login" class="btn-modal-primary" style="display: inline-block; text-decoration: none; padding: 0.75rem 2rem;">Sign In</a>\n' +
           '        </div>\n' +
           '      </div>\n' +
           '    </div>\n';
  }

  if (hasRated) {
    return '    <div class="review-overlay" id="reviewModal">\n' +
           '      <div class="review-modal">\n' +
           '        <button class="modal-close" onclick="closeReview()">✕</button>\n' +
           '        <div style="text-align: center; padding: 20px 0;">\n' +
           '          <div style="font-size: 3rem; margin-bottom: 0.5rem;">⭐</div>\n' +
           '          <h3 style="margin-bottom: 0.5rem;">You already rated this</h3>\n' +
           '          <p style="color: var(--text-secondary);">Your feedback helps us improve!</p>\n' +
           '          <button class="btn-modal-primary" onclick="closeReview()" style="margin-top: 1rem;">Close</button>\n' +
           '        </div>\n' +
           '      </div>\n' +
           '    </div>\n';
  }

  return '    <div class="review-overlay" id="reviewModal">\n' +
         '      <div class="review-modal" id="reviewModalBody">\n' +
         '        <button class="modal-close" onclick="closeReview()">✕</button>\n' +
         '        <div class="bonus-incentive-pill">\n' +
         '          <span>⚡</span> Get +0.2 Credit Reward\n' +
         '        </div>\n' +
         '        <h3>Share feedback</h3>\n' +
         '        <p class="sub-text">Your ratings help fine-tune our personalized AI translations.</p>\n' +
         '        <div class="review-question">Was this explanation easy to understand?</div>\n' +
         '        <div class="rating-scale" id="ratingGroup">\n' +
         '          <input type="radio" id="mRate1" name="rating" value="1" onclick="updateRatingFeedback(1)">\n' +
         '          <label for="mRate1" title="Confusing">😣</label>\n' +
         '          <input type="radio" id="mRate2" name="rating" value="2" onclick="updateRatingFeedback(2)">\n' +
         '          <label for="mRate2" title="Unclear">😕</label>\n' +
         '          <input type="radio" id="mRate3" name="rating" value="3" onclick="updateRatingFeedback(3)">\n' +
         '          <label for="mRate3" title="Standard">😐</label>\n' +
         '          <input type="radio" id="mRate4" name="rating" value="4" onclick="updateRatingFeedback(4)">\n' +
         '          <label for="mRate4" title="Clear">🙂</label>\n' +
         '          <input type="radio" id="mRate5" name="rating" value="5" onclick="updateRatingFeedback(5)">\n' +
         '          <label for="mRate5" title="Amazing">🤯</label>\n' +
         '        </div>\n' +
         '        <div class="rating-description" id="ratingDesc">Tap your reaction above</div>\n' +
         '        <div class="feedback-options" id="feedbackOptions">\n' +
         '          <p>What could be better?</p>\n' +
         '          <div class="feedback-grid" id="feedbackGrid">\n' +
         '            <div class="feedback-chip" onclick="this.classList.toggle(\'selected\')">Too complicated</div>\n' +
         '            <div class="feedback-chip" onclick="this.classList.toggle(\'selected\')">Too long</div>\n' +
         '            <div class="feedback-chip" onclick="this.classList.toggle(\'selected\')">Needs examples</div>\n' +
         '            <div class="feedback-chip" onclick="this.classList.toggle(\'selected\')">Incorrect analogies</div>\n' +
         '            <div class="feedback-chip" onclick="this.classList.toggle(\'selected\')">Formatting issues</div>\n' +
         '          </div>\n' +
         '        </div>\n' +
         '        <div class="modal-actions">\n' +
         '          <button class="btn-modal-secondary" onclick="closeReview()">Not now</button>\n' +
         '          <button class="btn-modal-primary" onclick="submitReview()">Submit Feedback</button>\n' +
         '        </div>\n' +
         '      </div>\n' +
         '    </div>\n';
}

function buildDeepDiveModalHTML(isGuest) {
  let html = '    <div class="deep-dive-overlay" id="deepDiveModal">\n';
  html += '      <div class="deep-dive-modal">\n';
  html += '        <button class="modal-close" onclick="closeDeepDiveModal()">✕</button>\n';
  html += '        <div style="text-align: center;">\n';
  html += '          <div style="font-size: 2.5rem; margin-bottom: 0.5rem;">🔍</div>\n';
  html += '          <h3>Deep Dive</h3>\n';

  if (isGuest) {
    html += '          <p style="color: var(--text-secondary); margin: 0.5rem 0 1.5rem;">Sign in to unlock deep dive questions!</p>\n';
    html += '          <a href="' + SITE_URL + '#login" class="btn-modal-primary" style="display: inline-block; text-decoration: none; padding: 0.75rem 2rem;">Sign In</a>\n';
  } else {
    html += '          <p style="color: var(--text-secondary); margin: 0.5rem 0 1.5rem;">Ask a question to explore this topic deeper.</p>\n';
    html += '          <form id="deepDiveForm" onsubmit="submitDeepDive(event)">\n';
    html += '            <textarea id="deepDiveQuestion" placeholder="What would you like to know more about?" style="width: 100%; padding: 12px 16px; border-radius: 12px; border: var(--glass-border); background: var(--input-bg); color: var(--text-main); font-family: inherit; font-size: 1rem; resize: vertical; min-height: 80px; margin-bottom: 1rem; outline: none;"></textarea>\n';
    html += '            <div style="display: flex; gap: 10px;">\n';
    html += '              <button type="button" class="btn-modal-secondary" onclick="closeDeepDiveModal()">Cancel</button>\n';
    html += '              <button type="submit" class="btn-modal-primary" style="flex: 1;">Ask Question</button>\n';
    html += '            </div>\n';
    html += '            <p style="font-size: 0.8rem; color: var(--text-muted); margin-top: 0.8rem;">Cost: 0.5 credits</p>\n';
    html += '          </form>\n';
  }

  html += '        </div>\n';
  html += '      </div>\n';
  html += '    </div>\n';
  return html;
}

// ============================================
// HELPER FUNCTIONS
// ============================================

function escapeHtml(text) {
  if (!text) return '';
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function getProfileIcon(name) {
  const icons = {
    'Everyday Life': '<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93z"/></svg>',
    'Football': '<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93z"/></svg>',
    'Gaming': '<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M21.58 16.09l-1.09-7.66C20.21 6.46 18.52 5 16.53 5H7.47C5.48 5 3.79 6.46 3.51 8.43l-1.09 7.66C2.2 17.63 3.39 19 4.94 19h14.12c1.55 0 2.74-1.37 2.52-2.91z"/></svg>',
    'Movies & Cinema': '<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M4 6H2v14c0 1.1.9 2 2 2h14v-2H4V6zm16-4H8c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm-8 12.5v-9l6 4.5-6 4.5z"/></svg>',
    'Cooking & Food': '<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M18.06 22.99h1.66c.84 0 1.53-.64 1.63-1.46L23 5.05h-5V1h-2v4.05h-4.97l.27 16.48c.1.82.79 1.46 1.63 1.46h1.66zM10 12.04h8V14h-8v-1.96z"/></svg>'
  };
  return icons[name] || '<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2z"/></svg>';
}

function parseContentIntoSections(content) {
  if (!content) return [{ type: 'paragraph', content: 'No content available.' }];

  const lines = content.split('\n').filter(line => line.trim());
  const sections = [];

  for (const line of lines) {
    if (line.startsWith('## ')) {
      sections.push({ type: 'heading', content: line.replace('## ', '') });
    } else if (line.startsWith('# ')) {
      sections.push({ type: 'heading', content: line.replace('# ', '') });
    } else if (line.trim()) {
      sections.push({ type: 'paragraph', content: line.trim() });
    }
  }

  return sections.length > 0 ? sections : [{ type: 'paragraph', content: content }];
}

// ============================================
// JAVASCRIPT FOR THE FRONTEND (Fixed)
// ============================================

function getJavaScript(article, explanations, userRating, user_id, sessionToken, isBookmarked, isGuest, guestLimitInfo, guestId) {
  const isAuthenticated = !!user_id;
  const hasRated = !!userRating;
  const explanationViews = explanations?.map(e => e.view_id) || [];
  const bookmarked = isBookmarked || false;

  // Use string concatenation to avoid template literal issues
  let js = '';

  // State
  js += 'let currentThemeSetting = localStorage.getItem("easyread-theme") || "auto";\n';
  js += 'let currentCredits = parseFloat(localStorage.getItem("easyread-credits")) || ' + (userCredits || 50) + ';\n';
  js += 'let modalTriggered = false;\n';
  js += 'let currentViewId = ' + (explanations?.[0]?.view_id || null) + ';\n';
  js += 'let currentProfileId = ' + (explanations?.[0]?.profile_id || 1) + ';\n';
  js += 'let currentArticleId = ' + article.article_id + ';\n';
  js += 'let isAuthenticated = ' + isAuthenticated + ';\n';
  js += 'let isGuest = ' + isGuest + ';\n';
  js += 'let hasRated = ' + hasRated + ';\n';
  js += 'let isBookmarked = ' + bookmarked + ';\n';
  js += 'let explanationViewIds = ' + JSON.stringify(explanationViews) + ';\n';
  js += 'let sessionToken = "' + (sessionToken || '') + '";\n';
  js += 'let userId = "' + (user_id || '') + '";\n';
  js += 'let guestId = "' + (guestId || '') + '";\n';
  js += 'let guestRemainingReads = ' + (guestLimitInfo?.remaining || 0) + ';\n';
  js += 'let guestRemainingQuestions = ' + (guestLimitInfo?.remaining || 0) + ';\n';

  // Theme management
  js += `
function applyTheme(theme) {
  currentThemeSetting = theme;
  if (theme === 'dark') {
    document.documentElement.setAttribute('data-theme', 'dark');
  } else if (theme === 'light') {
    document.documentElement.setAttribute('data-theme', 'light');
  } else {
    document.documentElement.removeAttribute('data-theme');
  }
}

applyTheme(currentThemeSetting);

window.toggleTheme = function() {
  if (currentThemeSetting === 'auto') {
    const isDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    applyTheme(isDark ? 'light' : 'dark');
  } else if (currentThemeSetting === 'dark') {
    applyTheme('light');
  } else {
    applyTheme('auto');
  }
  localStorage.setItem('easyread-theme', currentThemeSetting);
};
`;

  // Toast
  js += `
function showToast(message, type) {
  type = type || 'info';
  const toast = document.getElementById('toast');
  toast.textContent = message;
  toast.className = 'toast show';
  if (type === 'success') {
    toast.style.borderColor = '#34c759';
  } else if (type === 'error') {
    toast.style.borderColor = '#ff3b30';
  } else if (type === 'warning') {
    toast.style.borderColor = '#f59847';
  } else {
    toast.style.borderColor = 'var(--accent-color)';
  }
  clearTimeout(toast._timeout);
  toast._timeout = setTimeout(function() {
    toast.classList.remove('show');
  }, 3000);
}
`;

  // Login Modal
  js += `
window.showLoginModal = function(action) {
  const overlay = document.getElementById('loginOverlay');
  if (overlay) overlay.classList.add('active');
  document.body.style.overflow = 'hidden';
};

window.closeLoginModal = function() {
  const overlay = document.getElementById('loginOverlay');
  if (overlay) overlay.classList.remove('active');
  document.body.style.overflow = '';
};

document.addEventListener('click', function(e) {
  const overlay = document.getElementById('loginOverlay');
  if (e.target === overlay) {
    closeLoginModal();
  }
});
`;

  // Guest tracking
  js += `
async function trackGuestRead() {
  if (!isGuest || !guestId) return;
  try {
    const response = await fetch('/api/view?action=track-read', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-guest-id': guestId
      },
      body: JSON.stringify({ article_id: currentArticleId })
    });
    const data = await response.json();
    if (response.status === 429) {
      showToast(data.message || 'Daily limit reached', 'warning');
      document.querySelectorAll('.article-body a, .article-body button').forEach(function(el) {
        el.style.pointerEvents = 'none';
        el.style.opacity = '0.5';
      });
    } else if (data.success) {
      guestRemainingReads = data.remaining;
      updateGuestBadge();
    }
  } catch (error) {
    console.error('Guest tracking error:', error);
  }
}

function updateGuestBadge() {
  const badge = document.querySelector('.guest-badge');
  if (badge) {
    badge.textContent = "Guest · " + guestRemainingReads + " reads left";
  }
}
`;

  // Bookmark
  js += `
window.handleBookmark = async function() {
  if (!isAuthenticated) {
    showLoginModal('bookmark');
    return;
  }
  const btn = document.getElementById('bookmarkBtn');
  try {
    const response = await fetch('/api/view?action=bookmark', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-user-id': userId,
        'x-session-token': sessionToken
      },
      body: JSON.stringify({ article_id: currentArticleId })
    });
    const data = await response.json();
    if (data.success) {
      isBookmarked = data.bookmarked;
      updateBookmarkUI();
      showToast(data.message, 'success');
    } else {
      showToast(data.error || 'Failed to toggle bookmark', 'error');
    }
  } catch (error) {
    showToast('Error: ' + error.message, 'error');
  }
};

function updateBookmarkUI() {
  const btn = document.getElementById('bookmarkBtn');
  if (isBookmarked) {
    btn.classList.add('bookmarked');
    btn.innerHTML = '<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/></svg>';
    btn.title = 'Remove bookmark';
  } else {
    btn.classList.remove('bookmarked');
    btn.innerHTML = '<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M17 3H7c-1.1 0-2 .9-2 2v16l7-3 7 3V5c0-1.1-.9-2-2-2z"/></svg>';
    btn.title = 'Add bookmark';
  }
}
`;

  // Deep Dive
  js += `
window.openDeepDiveModal = function() {
  if (!isAuthenticated) {
    showLoginModal('deep-dive');
    return;
  }
  const modal = document.getElementById('deepDiveModal');
  if (modal) modal.classList.add('active');
  document.body.style.overflow = 'hidden';
  setTimeout(function() {
    const input = document.getElementById('deepDiveQuestion');
    if (input) input.focus();
  }, 300);
};

window.closeDeepDiveModal = function() {
  const modal = document.getElementById('deepDiveModal');
  if (modal) modal.classList.remove('active');
  document.body.style.overflow = '';
  const form = document.getElementById('deepDiveForm');
  if (form) form.reset();
};

window.submitDeepDive = async function(e) {
  e.preventDefault();
  if (!isAuthenticated) {
    showLoginModal('deep-dive');
    return;
  }
  const input = document.getElementById('deepDiveQuestion');
  const question = input.value.trim();
  if (!question || question.length < 5) {
    showToast('Please ask a more specific question', 'error');
    return;
  }
  closeDeepDiveModal();
  showToast('Generating deep dive...', 'info');
  try {
    const response = await fetch('/api/view?action=deep-dive', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-user-id': userId,
        'x-session-token': sessionToken
      },
      body: JSON.stringify({
        article_id: currentArticleId,
        profile_id: currentProfileId,
        question: question
      })
    });
    const data = await response.json();
    if (data.success) {
      showToast('Deep dive generated!', 'success');
      displayDeepDive(data.deep_dive, question);
    } else {
      showToast(data.error || 'Failed to generate deep dive', 'error');
    }
  } catch (error) {
    showToast('Error: ' + error.message, 'error');
  }
};

function displayDeepDive(deepDive, question) {
  const overlay = document.createElement('div');
  overlay.style.cssText = 'position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.5); backdrop-filter: blur(10px); z-index: 999; display: flex; align-items: center; justify-content: center; padding: 20px;';
  overlay.innerHTML = '<div style="background: var(--card-bg); backdrop-filter: var(--card-blur); border: var(--glass-border); border-radius: 20px; max-width: 600px; width: 100%; max-height: 80vh; overflow-y: auto; padding: 30px; position: relative;"><button onclick="this.closest(\'div[style]\').remove()" style="position: absolute; top: 15px; right: 20px; background: transparent; border: none; font-size: 24px; color: var(--text-secondary); cursor: pointer;">✕</button><h3 style="color: var(--accent-color); margin-bottom: 8px;">Deep Dive</h3><p style="font-size: 0.9rem; color: var(--text-secondary); margin-bottom: 16px;">Question: "' + escapeJs(question) + '"</p><div style="background: var(--input-bg); border-radius: 12px; padding: 20px; color: var(--text-main); line-height: 1.6; white-space: pre-wrap;">' + (deepDive.answer || 'No answer available.') + '</div><button onclick="this.closest(\'div[style]\').remove()" style="margin-top: 20px; background: var(--accent-color); color: #fff; border: none; padding: 12px 24px; border-radius: 12px; font-weight: 600; cursor: pointer; width: 100%;">Close</button></div>';
  document.body.appendChild(overlay);
}
`;

  // Review Modal
  js += `
window.openReview = function() {
  const modal = document.getElementById('reviewModal');
  if (modal) modal.classList.add('active');
  document.body.style.overflow = 'hidden';
};

window.closeReview = function() {
  const modal = document.getElementById('reviewModal');
  if (modal) {
    modal.classList.remove('active');
    document.body.style.overflow = '';
    const modalBody = document.getElementById('reviewModalBody');
    if (modalBody) modalBody.className = 'review-modal';
  }
};

window.updateRatingFeedback = function(rating) {
  const ratingDesc = document.getElementById('ratingDesc');
  const feedbackOptions = document.getElementById('feedbackOptions');
  const modalBody = document.getElementById('reviewModalBody');
  var ratingTextMap = {
    1: 'Extremely confusing or complicated.',
    2: 'Slightly difficult to follow.',
    3: 'Average, standard explanation.',
    4: 'Clear and very easy to follow!',
    5: 'Incredible explanation! Mind blown.'
  };
  if (ratingDesc) ratingDesc.textContent = ratingTextMap[rating] || 'Select how clear this text was';
  if (modalBody) {
    modalBody.className = 'review-modal rating-glow-' + rating;
  }
  if (feedbackOptions) {
    if (rating <= 3) {
      feedbackOptions.classList.add('visible');
    } else {
      feedbackOptions.classList.remove('visible');
    }
  }
};

window.submitReview = async function() {
  const selectedRating = document.querySelector('input[name="rating"]:checked');
  if (!selectedRating) {
    showToast('Please select a rating first', 'error');
    return;
  }
  const rating = parseInt(selectedRating.value);
  const feedbackChips = document.querySelectorAll('.feedback-chip.selected');
  var feedback = '';
  feedbackChips.forEach(function(el) {
    if (feedback) feedback = feedback + ', ';
    feedback = feedback + el.textContent;
  });
  try {
    const response = await fetch('/api/view?action=rate', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-user-id': userId,
        'x-session-token': sessionToken
      },
      body: JSON.stringify({
        view_id: currentViewId,
        rating: rating,
        feedback: feedback || null
      })
    });
    const data = await response.json();
    if (response.status === 201) {
      showToast('Review submitted! +0.2 Credits Awarded', 'success');
      hasRated = true;
      if (data.bonus_earned) {
        currentCredits = currentCredits + data.bonus_earned;
        updateCreditsDisplay(currentCredits);
      }
      closeReview();
    } else if (response.status === 409) {
      showToast('You have already rated this article', 'info');
      closeReview();
    } else {
      showToast(data.error || 'Failed to submit review', 'error');
    }
  } catch (error) {
    showToast('Error: ' + error.message, 'error');
  }
};
`;

  // Credits and other helpers
  js += `
function updateCreditsDisplay(credits) {
  currentCredits = credits;
  const display = document.getElementById('creditsValueDisplay');
  if (display) display.textContent = credits.toFixed(1);
  localStorage.setItem('easyread-credits', credits.toString());
}

function loadContent() {
  const shimmer = document.getElementById('contentShimmer');
  const text = document.getElementById('articleText');
  setTimeout(function() {
    if (shimmer) shimmer.style.display = 'none';
    if (text) {
      text.style.display = 'block';
      const paragraphs = text.querySelectorAll('p');
      paragraphs.forEach(function(p, index) {
        p.style.opacity = '0';
        p.style.animation = 'fadeInContent 0.6s ease forwards';
        p.style.animationDelay = (index + 1) * 0.1 + 's';
      });
      const headings = text.querySelectorAll('.subheading');
      headings.forEach(function(h, index) {
        h.style.opacity = '0';
        h.style.animation = 'fadeInContent 0.6s ease forwards';
        h.style.animationDelay = (paragraphs.length + index + 1) * 0.1 + 's';
      });
    }
  }, 800);
}

window.switchProfile = function(profileId, element, profileName) {
  const pills = document.querySelectorAll('.profile-pill');
  pills.forEach(function(p) { p.classList.remove('active'); });
  element.classList.add('active');
  currentProfileId = profileId;
  const text = document.getElementById('articleText');
  const shimmer = document.getElementById('contentShimmer');
  const catchLineText = document.getElementById('catchLineText');
  if (text) text.style.display = 'none';
  if (shimmer) shimmer.style.display = 'block';
  if (catchLineText) {
    catchLineText.style.opacity = '0';
    catchLineText.style.transform = 'translateY(10px)';
  }
  const explanation = ' + JSON.stringify(explanations || []) + '.find(function(e) { return e.profile_id == profileId; });
  setTimeout(function() {
    const contentArea = document.getElementById('articleContent');
    if (explanation) {
      const sections = parseContent(explanation.content);
      var html = '';
      sections.forEach(function(s) {
        if (s.type === 'heading') {
          html = html + '<h2 class="subheading">' + s.content + '</h2>';
        } else {
          html = html + '<p>' + s.content + '</p>';
        }
      });
      contentArea.innerHTML = '<div class="content-shimmer" id="contentShimmer" style="display: none;"></div><div id="articleText" style="display: block;">' + html + '</div>';
      if (catchLineText) {
        var catchLines = {
          '1': '"Every idea connects to everyday life."',
          '2': '"Football tactics meet market strategy."',
          '3': '"Level up your understanding."',
          '4': '"Every story has a plot twist."',
          '5': '"Cook up some knowledge."'
        };
        catchLineText.textContent = catchLines[profileId] || '"Knowledge is the best currency."';
        catchLineText.style.opacity = '1';
        catchLineText.style.transform = 'translateY(0)';
      }
      const newText = contentArea.querySelector('#articleText');
      if (newText) {
        const paragraphs = newText.querySelectorAll('p');
        paragraphs.forEach(function(p, index) {
          p.style.opacity = '0';
          p.style.animation = 'fadeInContent 0.6s ease forwards';
          p.style.animationDelay = (index + 1) * 0.1 + 's';
        });
        const headings = newText.querySelectorAll('.subheading');
        headings.forEach(function(h, index) {
          h.style.opacity = '0';
          h.style.animation = 'fadeInContent 0.6s ease forwards';
          h.style.animationDelay = (paragraphs.length + index + 1) * 0.1 + 's';
        });
      }
      currentViewId = explanation.view_id;
      showToast('Switched to ' + profileName + ' profile', 'info');
    } else {
      showToast('No explanation available for this profile yet.', 'warning');
      contentArea.innerHTML = '<div class="content-shimmer" id="contentShimmer" style="display: none;"></div><div id="articleText" style="display: block;"><p>No explanation available for this profile. ' + (isAuthenticated ? '<button onclick="generateExplanation(\'' + profileId + '\')" style="background: var(--accent-color); color: #fff; border: none; padding: 8px 16px; border-radius: 8px; cursor: pointer; font-weight: 600; margin-left: 8px;">Generate Now</button>' : '<a href=\"' + SITE_URL + '#login\" style="color: var(--accent-color); font-weight: 600; text-decoration: none; margin-left: 8px;">Sign in to generate</a>') + '</p></div>';
    }
  }, 800);
};

window.generateExplanation = async function(profileId) {
  if (!isAuthenticated) {
    showLoginModal('explanation');
    return;
  }
  showToast('Generating explanation...', 'info');
  try {
    const response = await fetch('/api/explanation?action=generate', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-user-id': userId,
        'x-session-token': sessionToken
      },
      body: JSON.stringify({
        article_id: currentArticleId,
        profile_id: parseInt(profileId),
        force: false
      })
    });
    const data = await response.json();
    if (data.success) {
      showToast('Explanation generated successfully!', 'success');
      setTimeout(function() { window.location.reload(); }, 1000);
    } else {
      showToast('Failed to generate explanation: ' + (data.error || 'Unknown error'), 'error');
    }
  } catch (error) {
    showToast('Error: ' + error.message, 'error');
  }
};

function parseContent(content) {
  if (!content) return [{ type: 'paragraph', content: 'No content available.' }];
  var lines = content.split('\\n').filter(function(line) { return line.trim(); });
  var sections = [];
  for (var i = 0; i < lines.length; i++) {
    var line = lines[i];
    if (line.startsWith('## ')) {
      sections.push({ type: 'heading', content: line.replace('## ', '') });
    } else if (line.startsWith('# ')) {
      sections.push({ type: 'heading', content: line.replace('# ', '') });
    } else if (line.trim()) {
      sections.push({ type: 'paragraph', content: line.trim() });
    }
  }
  return sections.length > 0 ? sections : [{ type: 'paragraph', content: content }];
}

function escapeJs(text) {
  if (!text) return '';
  return text.replace(/"/g, '\\"').replace(/\\n/g, '\\\\n');
}
`;

  // Copy & Share
  js += `
window.copyLink = function() {
  const url = window.location.href;
  navigator.clipboard.writeText(url).then(function() {
    showToast('Link copied to clipboard!', 'success');
  }).catch(function() {
    var dummy = document.createElement('input');
    document.body.appendChild(dummy);
    dummy.value = url;
    dummy.select();
    document.execCommand('copy');
    document.body.removeChild(dummy);
    showToast('Link copied to clipboard!', 'success');
  });
};

window.shareLink = function() {
  if (navigator.share) {
    navigator.share({
      title: document.title,
      text: 'Check out this article on EasyRead!',
      url: window.location.href
    }).catch(function() {});
  } else {
    window.copyLink();
  }
};
`;

  // Progress Bar
  js += `
window.addEventListener('scroll', function() {
  var scrollTop = window.scrollY;
  var docHeight = document.documentElement.scrollHeight - window.innerHeight;
  var progress = docHeight > 0 ? (scrollTop / docHeight) * 100 : 0;
  var bar = document.getElementById('progressBar');
  if (bar) bar.style.width = progress + '%';
});
`;

  // Init
  js += `
document.addEventListener('DOMContentLoaded', function() {
  loadContent();
  var display = document.getElementById('creditsValueDisplay');
  if (display) display.textContent = currentCredits.toFixed(1);
  if (hasRated) {
    modalTriggered = true;
  }
  updateBookmarkUI();
  if (isGuest && guestId) {
    trackGuestRead();
  }
});
`;

  return js;
}

// ============================================
// CSS STYLES (Compressed to avoid issues)
// ============================================

function getCSSStyles() {
  return `
:root{--bg-color:#f6f7f9;--bg-glow:radial-gradient(circle at 50% 0%,rgba(255,255,255,0.9) 0%,transparent 70%);--text-main:#1c1c1e;--text-secondary:#5c5c60;--text-muted:#8e8e93;--border-color:rgba(0,0,0,0.12);--border-subtle:rgba(0,0,0,0.08);--card-bg:rgba(242,242,247,0.75);--card-blur:blur(20px);--input-bg:rgba(0,0,0,0.04);--shadow-color:rgba(0,0,0,0.05);--glass-border:1.5px solid rgba(0,0,0,0.12);--glass-border-subtle:1px solid rgba(0,0,0,0.08);--glass-shadow:0 10px 30px rgba(0,0,0,0.05);--accent-color:#f59847;--accent-hover:#e08735;--accent-glow:rgba(245,152,71,0.15);--icon-color:#5c5c60;--gradient-color-1:#ffd3b6;--gradient-color-2:#ffaaa5;--gradient-color-3:#f59847;--gradient-color-4:#d4e5f7;--shimmer-color:rgba(255,255,255,0.4)}
@media(prefers-color-scheme:dark){:root{--bg-color:#000000;--bg-glow:radial-gradient(circle at 50% 0%,rgba(40,40,42,0.4) 0%,transparent 60%);--text-main:#e8e8ea;--text-secondary:#9a9a9e;--text-muted:#6c6c70;--border-color:#2a2a2a;--border-subtle:rgba(255,255,255,0.06);--card-bg:rgba(18,18,18,0.95);--card-blur:blur(16px);--input-bg:#181818;--shadow-color:rgba(0,0,0,0.8);--glass-border:1px solid rgba(255,255,255,0.08);--glass-border-subtle:1px solid rgba(255,255,255,0.04);--glass-shadow:0 8px 32px rgba(0,0,0,0.6);--accent-color:#f59847;--accent-hover:#e08735;--icon-color:#9aa0a6;--gradient-color-1:#1f130f;--gradient-color-2:#30170a;--gradient-color-3:#c49a45;--gradient-color-4:#12161f;--shimmer-color:rgba(255,255,255,0.1)}}
[data-theme="dark"]{--bg-color:#000000 !important;--bg-glow:radial-gradient(circle at 50% 0%,rgba(40,40,42,0.4) 0%,transparent 60%) !important;--text-main:#e8e8ea !important;--text-secondary:#9a9a9e !important;--text-muted:#6c6c70 !important;--border-color:#2a2a2a !important;--border-subtle:rgba(255,255,255,0.06) !important;--card-bg:rgba(18,18,18,0.95) !important;--input-bg:#181818 !important;--shadow-color:rgba(0,0,0,0.8) !important;--glass-border:1px solid rgba(255,255,255,0.08) !important;--glass-border-subtle:1px solid rgba(255,255,255,0.04) !important;--glass-shadow:0 8px 32px rgba(0,0,0,0.6) !important;--accent-color:#f59847 !important;--accent-hover:#e08735 !important;--icon-color:#9aa0a6 !important;--gradient-color-1:#1f130f !important;--gradient-color-2:#30170a !important;--gradient-color-3:#c49a45 !important;--gradient-color-4:#12161f !important;--shimmer-color:rgba(255,255,255,0.1) !important}
*{margin:0;padding:0;box-sizing:border-box}
body{background-color:var(--bg-color);background-image:url("data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noiseFilter'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.65' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noiseFilter)' opacity='0.03'/%3E%3C/svg%3E"),var(--bg-glow);background-repeat:no-repeat,no-repeat;background-size:auto,100% 100%;background-position:center,center;color:var(--text-main);font-family:'Plus Jakarta Sans',-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;font-style:normal;min-height:100vh;width:100%;display:flex;justify-content:center;padding:3rem 1.5rem 6rem 1.5rem;transition:background-color 0.4s ease,color 0.4s ease}
.full-screen-reader{max-width:780px;width:100%}
.progress-bar{position:fixed;top:0;left:0;height:4px;background:var(--accent-color);width:0%;z-index:100;transition:width 0.1s linear}
.reader-header{display:flex;align-items:center;justify-content:space-between;margin-bottom:1rem;width:100%}
.category-breadcrumb{font-size:0.85rem;color:var(--text-secondary);display:flex;align-items:center;gap:6px;font-weight:600}
.category-breadcrumb span{color:var(--text-muted)}
.category-breadcrumb .current{color:var(--accent-color)}
.credits-badge{display:inline-flex;align-items:center;gap:6px;background:var(--card-bg);backdrop-filter:var(--card-blur);-webkit-backdrop-filter:var(--card-blur);border:var(--glass-border-subtle);border-radius:20px;padding:0.4rem 0.9rem;font-size:0.8rem;font-weight:700;box-shadow:var(--glass-shadow);transition:transform 0.2s,background-color 0.2s;cursor:pointer}
.credits-badge:hover{transform:scale(1.02);border-color:var(--accent-color)}
.credits-badge .lightning-icon{color:var(--accent-color);font-size:0.9rem;animation:pulse-glow 2s infinite ease-in-out}
@keyframes pulse-glow{0%,100%{transform:scale(1);opacity:1}50%{transform:scale(1.2);opacity:0.8}}
.guest-badge{font-size:0.7rem;color:var(--text-muted);padding:0.2rem 0.6rem;border:1px solid var(--border-subtle);border-radius:12px}
.auth-link{color:var(--accent-color);font-weight:600;text-decoration:none;font-size:0.85rem;padding:0.4rem 0.9rem;border:1.5px solid var(--accent-color);border-radius:20px;transition:all 0.2s}
.auth-link:hover{background:var(--accent-color);color:#fff}
.glass-icon-btn{background:rgba(255,255,255,0.05);backdrop-filter:blur(4px);border:var(--glass-border-subtle);border-radius:50%;width:38px;height:38px;display:flex;align-items:center;justify-content:center;cursor:pointer;color:var(--icon-color);transition:all 0.2s ease}
.glass-icon-btn:hover{background:var(--accent-color);color:#fff;border-color:var(--accent-color);transform:scale(1.05)}
.glass-icon-btn svg{width:18px;height:18px;fill:currentColor}
.glass-icon-btn.bookmarked{color:var(--accent-color)}
.glass-icon-btn.bookmarked:hover{color:#fff}
.hero-title{font-size:2.8rem;font-weight:800;line-height:1.1;margin-bottom:0.5rem;color:var(--text-main);letter-spacing:-1.5px}
.hero-title .accent{color:var(--accent-color)}
.profile-pills-wrapper{margin-bottom:1.5rem;overflow:hidden;position:relative}
.profile-pills-scroll{display:flex;gap:10px;overflow-x:auto;padding-bottom:4px;scroll-snap-type:x mandatory;-webkit-overflow-scrolling:touch;scrollbar-width:none}
.profile-pills-scroll::-webkit-scrollbar{display:none}
.profile-pill{flex:0 0 auto;scroll-snap-align:start;background:var(--card-bg);backdrop-filter:var(--card-blur);-webkit-backdrop-filter:var(--card-blur);border:var(--glass-border-subtle);border-radius:40px;padding:0.55rem 1.2rem;font-size:0.9rem;font-weight:600;color:var(--text-secondary);cursor:pointer;transition:all 0.2s ease;white-space:nowrap;user-select:none;display:inline-flex;align-items:center;gap:8px}
.profile-pill svg{width:18px;height:18px;fill:currentColor;flex-shrink:0}
.profile-pill:hover{background:var(--card-bg-hover);color:var(--text-main);transform:translateY(-2px)}
.profile-pill.active{background:var(--accent-color);color:#fff;border-color:var(--accent-color);box-shadow:0 4px 12px var(--accent-glow)}
.featured-gradient-card{width:100%;min-height:250px;position:relative;border-radius:20px;overflow:hidden;border:var(--glass-border-subtle);background:linear-gradient(-45deg,var(--gradient-color-1),var(--gradient-color-2),var(--gradient-color-3),var(--gradient-color-4));background-size:300% 300%;animation:gradientShift 15s ease infinite;display:flex;align-items:center;justify-content:center;padding:2.2rem;margin-bottom:2rem;box-shadow:var(--glass-shadow)}
@keyframes gradientShift{0%{background-position:0% 50%}50%{background-position:100% 50%}100%{background-position:0% 50%}}
.gradient-card-overlay{position:absolute;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.15);z-index:1}
.catch-line-text{font-size:1.55rem;font-weight:800;line-height:1.4;color:#fff;text-shadow:0 4px 15px rgba(0,0,0,0.3);text-align:center;max-width:580px;z-index:2;transition:opacity 0.4s cubic-bezier(0.4,0,0.2,1),transform 0.4s cubic-bezier(0.4,0,0.2,1);letter-spacing:-0.5px}
.article-body p{font-size:1.15rem;line-height:1.65;color:var(--text-secondary);margin-bottom:1.5rem;opacity:0;animation:fadeInContent 0.6s ease forwards}
.article-body p:nth-child(1){animation-delay:0.1s}
.article-body p:nth-child(2){animation-delay:0.2s}
.article-body p:nth-child(3){animation-delay:0.3s}
.article-body p:nth-child(4){animation-delay:0.4s}
@keyframes fadeInContent{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:translateY(0)}}
.article-body .dropcap::first-letter{font-size:4rem;float:left;line-height:0.8;margin-right:12px;color:var(--accent-color);font-weight:800;margin-top:4px}
.subheading{font-size:1.6rem;font-weight:700;color:var(--text-main);margin-top:2.5rem;margin-bottom:1rem;letter-spacing:-0.5px}
.highlight-text{color:var(--accent-color);font-weight:700}
.content-shimmer .shimmer-line{height:20px;background:var(--shimmer-bg);background-size:200% 100%;animation:shimmer 1.5s infinite;border-radius:8px;margin-bottom:16px}
.content-shimmer .shimmer-line:nth-child(1){width:95%;height:24px}
.content-shimmer .shimmer-line:nth-child(2){width:88%;height:24px}
.content-shimmer .shimmer-line:nth-child(3){width:92%;height:24px}
.content-shimmer .shimmer-line:nth-child(4){width:75%;height:24px;margin-bottom:32px}
.content-shimmer .shimmer-line:nth-child(5){width:60%;height:32px;margin-bottom:16px}
.content-shimmer .shimmer-line:nth-child(6){width:90%;height:24px}
.content-shimmer .shimmer-line:nth-child(7){width:85%;height:24px}
.content-shimmer .shimmer-line:nth-child(8){width:70%;height:24px}
@keyframes shimmer{0%{background-position:200% 0}100%{background-position:-200% 0}}
.summary-wrapper{margin-top:2.5rem;margin-bottom:1rem;border-top:1px solid var(--border-subtle);padding-top:1.5rem}
.summary-content{background:var(--card-bg);backdrop-filter:var(--card-blur);-webkit-backdrop-filter:var(--card-blur);border-radius:18px;padding:1.5rem;border:var(--glass-border-subtle);box-shadow:var(--glass-shadow)}
.summary-content h4{font-size:0.75rem;text-transform:uppercase;letter-spacing:1px;color:var(--text-muted);margin-bottom:0.5rem;font-weight:700}
.summary-content p{font-size:1rem;line-height:1.5;color:var(--text-secondary);margin:0;font-style:italic}
.article-metadata{display:flex;align-items:center;justify-content:space-between;margin-top:1.5rem;margin-bottom:2.5rem;padding:1rem 0;border-top:1px solid var(--border-subtle);border-bottom:1px solid var(--border-subtle);font-size:0.9rem;color:var(--text-secondary);font-weight:500}
.article-metadata .meta-left{display:flex;align-items:center;gap:12px}
.article-metadata .author-name{font-weight:700;color:var(--text-main)}
.article-metadata .meta-right{color:var(--text-muted)}
.reader-section{display:flex;align-items:center;gap:16px;margin-bottom:3rem;padding:0.8rem 1rem 0.8rem 1.5rem;background:var(--card-bg);backdrop-filter:var(--card-blur);-webkit-backdrop-filter:var(--card-blur);border-radius:60px;width:fit-content;border:var(--glass-border-subtle);box-shadow:var(--glass-shadow);transition:all 0.3s ease}
.reader-avatars{display:flex}
.mini-circle{width:32px;height:32px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:0.75rem;font-weight:700;color:#fff;margin-right:-8px;border:2px solid var(--bg-color);position:relative;transition:transform 0.2s ease}
.mini-circle:hover{transform:scale(1.15);z-index:1}
.mini-circle.gold{background:var(--accent-color)}
.mini-circle.blue{background:#1a73e8}
.mini-circle.green{background:#34a853}
.mini-circle.purple{background:#9c27b0}
.mini-circle.orange{background:#fbbc04}
.reader-count{font-size:0.9rem;color:var(--text-secondary);padding-left:12px;font-weight:500}
.reader-count strong{color:var(--text-main);font-weight:700}
.glass-footer{position:fixed;bottom:20px;left:50%;transform:translateX(-50%);width:90%;max-width:720px;background:var(--card-bg);backdrop-filter:var(--card-blur);-webkit-backdrop-filter:var(--card-blur);border:var(--glass-border);border-radius:24px;padding:0.8rem 1.5rem;display:flex;justify-content:space-between;align-items:center;box-shadow:var(--glass-shadow);z-index:100;gap:0.8rem;transition:all 0.3s ease}
.footer-content{display:flex;align-items:center;justify-content:space-between;width:100%;gap:12px}
.link-pill{display:inline-flex;align-items:center;background:var(--input-bg);border:var(--glass-border-subtle);border-radius:40px;padding:0.35rem 1.1rem;max-width:180px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-size:0.85rem;color:var(--text-secondary);flex-shrink:1;min-width:0;font-weight:600}
.link-pill span{color:var(--text-muted);font-weight:500}
@media(min-width:600px){.link-pill{max-width:280px}}
.glass-actions{display:flex;align-items:center;gap:8px;flex-shrink:0}
.toast{position:fixed;bottom:100px;left:50%;transform:translateX(-50%) translateY(100px);background:var(--card-bg);backdrop-filter:var(--card-blur);-webkit-backdrop-filter:var(--card-blur);border:var(--glass-border);border-radius:16px;padding:12px 24px;color:var(--text-main);font-size:0.9rem;box-shadow:var(--glass-shadow);z-index:2000;opacity:0;transition:all 0.4s cubic-bezier(0.34,1.56,0.64,1);pointer-events:none;font-weight:600}
.toast.show{opacity:1;transform:translateX(-50%) translateY(0);pointer-events:auto}
.login-overlay{position:fixed;top:0;left:0;width:100vw;height:100vh;background:rgba(0,0,0,0.25);backdrop-filter:blur(25px) saturate(180%);-webkit-backdrop-filter:blur(25px) saturate(180%);display:none;align-items:center;justify-content:center;z-index:1000;padding:1.5rem;opacity:0;transition:opacity 0.3s cubic-bezier(0.25,0.8,0.25,1)}
[data-theme="dark"] .login-overlay{background:rgba(0,0,0,0.55)}
.login-overlay.active{display:flex;opacity:1}
.login-modal{background:var(--card-bg);backdrop-filter:var(--card-blur);-webkit-backdrop-filter:var(--card-blur);border:var(--glass-border);border-radius:28px;padding:40px 32px 32px;max-width:420px;width:100%;box-shadow:0 24px 48px rgba(0,0,0,0.15);position:relative;transform:scale(0.9) translateY(15px);transition:transform 0.4s cubic-bezier(0.25,0.8,0.25,1),box-shadow 0.3s ease;text-align:center}
[data-theme="dark"] .login-modal{box-shadow:0 24px 48px rgba(0,0,0,0.55)}
.login-overlay.active .login-modal{transform:scale(1) translateY(0)}
.login-close{position:absolute;top:16px;right:18px;background:transparent;border:none;font-size:1.4rem;color:var(--text-muted);cursor:pointer;transition:color 0.2s,transform 0.2s;display:flex;align-items:center;justify-content:center;width:32px;height:32px;border-radius:50%}
.login-close:hover{color:var(--text-main);background:var(--input-bg);transform:rotate(90deg)}
.login-modal h2{font-size:1.5rem;font-weight:800;color:var(--text-main);margin-bottom:0.5rem}
.login-modal p{color:var(--text-secondary);margin-bottom:1.5rem;font-size:0.95rem;line-height:1.5}
.login-modal-buttons{display:flex;gap:12px;justify-content:center;flex-wrap:wrap}
.login-btn-primary{background:var(--accent-color);color:#fff;border:none;padding:0.75rem 2rem;border-radius:30px;font-weight:600;cursor:pointer;text-decoration:none;transition:background 0.2s;box-shadow:0 4px 12px var(--accent-glow);display:inline-block}
.login-btn-primary:hover{background:var(--accent-hover)}
.login-btn-secondary{background:transparent;border:var(--glass-border-subtle);color:var(--text-secondary);padding:0.75rem 2rem;border-radius:30px;font-weight:600;cursor:pointer;text-decoration:none;transition:all 0.2s;display:inline-block}
.login-btn-secondary:hover{background:var(--input-bg);color:var(--text-main)}
.login-modal-footer{margin-top:1rem;font-size:0.8rem !important;color:var(--text-muted) !important}
.deep-dive-overlay{position:fixed;top:0;left:0;width:100vw;height:100vh;background:rgba(0,0,0,0.25);backdrop-filter:blur(25px) saturate(180%);-webkit-backdrop-filter:blur(25px) saturate(180%);display:none;align-items:center;justify-content:center;z-index:1000;padding:1.5rem;opacity:0;transition:opacity 0.3s cubic-bezier(0.25,0.8,0.25,1)}
[data-theme="dark"] .deep-dive-overlay{background:rgba(0,0,0,0.55)}
.deep-dive-overlay.active{display:flex;opacity:1}
.deep-dive-modal{background:var(--card-bg);backdrop-filter:var(--card-blur);-webkit-backdrop-filter:var(--card-blur);border:var(--glass-border);border-radius:28px;padding:40px 32px 32px;max-width:480px;width:100%;box-shadow:0 24px 48px rgba(0,0,0,0.15);position:relative;transform:scale(0.9) translateY(15px);transition:transform 0.4s cubic-bezier(0.25,0.8,0.25,1),box-shadow 0.3s ease}
[data-theme="dark"] .deep-dive-modal{box-shadow:0 24px 48px rgba(0,0,0,0.55)}
.deep-dive-overlay.active .deep-dive-modal{transform:scale(1) translateY(0)}
.review-overlay{position:fixed;top:0;left:0;width:100vw;height:100vh;background:rgba(0,0,0,0.25);backdrop-filter:blur(25px) saturate(180%);-webkit-backdrop-filter:blur(25px) saturate(180%);display:none;align-items:center;justify-content:center;z-index:1000;padding:1.5rem;opacity:0;transition:opacity 0.3s cubic-bezier(0.25,0.8,0.25,1)}
[data-theme="dark"] .review-overlay{background:rgba(0,0,0,0.55)}
.review-overlay.active{display:flex;opacity:1}
.review-modal{background:var(--card-bg);backdrop-filter:var(--card-blur);-webkit-backdrop-filter:var(--card-blur);border:var(--glass-border);border-radius:28px;padding:36px 24px 28px 24px;max-width:410px;width:100%;box-shadow:0 24px 48px rgba(0,0,0,0.15);position:relative;transform:scale(0.9) translateY(15px);transition:transform 0.4s cubic-bezier(0.25,0.8,0.25,1),box-shadow 0.3s ease;text-align:center}
[data-theme="dark"] .review-modal{box-shadow:0 24px 48px rgba(0,0,0,0.55)}
.review-overlay.active .review-modal{transform:scale(1) translateY(0)}
.bonus-incentive-pill{display:inline-flex;align-items:center;gap:5px;background:rgba(245,152,71,0.1);border:1px solid rgba(245,152,71,0.25);border-radius:30px;padding:6px 14px;font-size:0.75rem;font-weight:700;color:var(--accent-color);margin-bottom:1.2rem;text-transform:uppercase;letter-spacing:0.5px}
.modal-close{position:absolute;top:18px;right:20px;background:transparent;border:none;font-size:1.4rem;color:var(--text-muted);cursor:pointer;transition:color 0.2s,transform 0.2s;display:flex;align-items:center;justify-content:center;width:32px;height:32px;border-radius:50%}
.modal-close:hover{color:var(--text-main);background:var(--input-bg);transform:rotate(90deg)}
.review-modal h3{font-size:1.4rem;font-weight:800;color:var(--text-main);margin-bottom:0.4rem;letter-spacing:-0.5px}
.review-modal .sub-text{font-size:0.9rem;color:var(--text-secondary);margin-bottom:1.5rem;font-weight:500}
.review-question{font-size:1.1rem;color:var(--text-main);margin-bottom:1.2rem;font-weight:700}
.rating-scale{display:flex;gap:14px;margin-bottom:0.8rem;justify-content:center}
.rating-scale label{cursor:pointer;font-size:2.3rem;transition:transform 0.3s cubic-bezier(0.175,0.885,0.32,1.275),opacity 0.2s;opacity:0.55;user-select:none}
.rating-scale input[type="radio"]{display:none}
.rating-scale input[type="radio"]:checked+label{transform:scale(1.35);opacity:1}
.rating-scale label:hover{transform:scale(1.2);opacity:0.9}
.rating-description{font-size:0.85rem;color:var(--accent-color);font-weight:700;margin-bottom:1.5rem;min-height:18px;transition:color 0.2s}
.rating-glow-1{box-shadow:0 20px 40px rgba(255,59,48,0.15) !important}
.rating-glow-2{box-shadow:0 20px 40px rgba(255,149,0,0.15) !important}
.rating-glow-3{box-shadow:0 20px 40px rgba(142,142,147,0.15) !important}
.rating-glow-4{box-shadow:0 20px 40px rgba(52,199,89,0.15) !important}
.rating-glow-5{box-shadow:0 20px 40px var(--accent-glow) !important}
.feedback-options{display:none;margin-top:1rem;text-align:left;max-height:0;overflow:hidden;transition:max-height 0.4s cubic-bezier(0.4,0,0.2,1)}
.feedback-options.visible{display:block;max-height:200px}
.feedback-options p{font-size:0.85rem;color:var(--text-secondary);margin-bottom:0.8rem;font-weight:700;text-align:center;text-transform:uppercase;letter-spacing:0.5px}
.feedback-grid{display:flex;flex-wrap:wrap;gap:8px;justify-content:center}
.feedback-chip{background:var(--input-bg);border:var(--glass-border-subtle);color:var(--text-secondary);padding:8px 14px;border-radius:40px;font-size:12px;font-weight:600;cursor:pointer;transition:all 0.2s cubic-bezier(0.25,0.8,0.25,1);user-select:none}
.feedback-chip:hover{background:rgba(255,255,255,0.08);color:var(--text-main);transform:scale(1.02)}
.feedback-chip.selected{background:var(--accent-color);color:#fff;border-color:var(--accent-color);box-shadow:0 4px 10px var(--accent-glow);transform:scale(0.98)}
.modal-actions{display:flex;gap:10px;margin-top:2rem;justify-content:center;width:100%}
.btn-modal-secondary{background:transparent;border:var(--glass-border-subtle);color:var(--text-secondary);padding:0.75rem 1.5rem;border-radius:30px;font-weight:600;cursor:pointer;transition:all 0.2s;flex:1}
.btn-modal-secondary:hover{background:var(--input-bg);color:var(--text-main)}
.btn-modal-primary{background:var(--accent-color);color:#fff;border:none;padding:0.75rem 1.5rem;border-radius:30px;font-weight:600;cursor:pointer;transition:background 0.2s;box-shadow:0 4px 12px var(--accent-glow);flex:1}
.btn-modal-primary:hover{background:var(--accent-hover)}
@media(max-width:600px){body{padding:2rem 1rem 6rem 1rem}.hero-title{font-size:2rem}.featured-gradient-card{min-height:180px;padding:1.5rem}.catch-line-text{font-size:1.25rem}.glass-footer{bottom:10px;width:95%;border-radius:20px;padding:0.6rem 1rem}.footer-content{gap:8px}.link-pill{max-width:110px;font-size:0.75rem;padding:0.2rem 0.8rem}.glass-icon-btn{width:34px;height:34px}.glass-icon-btn svg{width:16px;height:16px}.review-modal{padding:24px 20px;margin:1rem}.login-modal{padding:30px 20px 24px}.deep-dive-modal{padding:30px 20px 24px}}
`;
}

// ============================================
// ERROR / NOT FOUND PAGES
// ============================================

function renderNotFoundPage() {
  return '<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>Article Not Found | EasyRead</title><link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;600;700;800&display=swap" rel="stylesheet"><style>body{font-family:"Plus Jakarta Sans",sans-serif;background:#f6f7f9;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;padding:20px}.container{text-align:center;max-width:500px}h1{font-size:4rem;color:#f59847;margin:0}h2{font-size:1.5rem;color:#1c1c1e;margin:0.5rem 0}p{color:#5c5c60;margin:1rem 0 2rem}a{display:inline-block;background:#f59847;color:#fff;padding:12px 28px;border-radius:12px;text-decoration:none;font-weight:600;transition:background 0.2s}a:hover{background:#e08735}</style></head><body><div class="container"><h1>404</h1><h2>Article Not Found</h2><p>The article you\'re looking for doesn\'t exist or has been moved.</p><a href="/">← Back to Home</a></div></body></html>';
}

function renderErrorPage(message) {
  const escaped = escapeHtml(message || 'Unknown error');
  return '<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>Something Went Wrong | EasyRead</title><link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;600;700;800&display=swap" rel="stylesheet"><style>body{font-family:"Plus Jakarta Sans",sans-serif;background:#f6f7f9;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;padding:20px}.container{text-align:center;max-width:500px}.emoji{font-size:4rem}h2{font-size:1.5rem;color:#1c1c1e;margin:0.5rem 0}p{color:#5c5c60;margin:1rem 0 2rem}.error-detail{background:#fff;border-radius:12px;padding:16px;font-size:0.85rem;color:#ff3b30;border:1px solid #ff3b30;margin-bottom:2rem;word-break:break-word}a{display:inline-block;background:#f59847;color:#fff;padding:12px 28px;border-radius:12px;text-decoration:none;font-weight:600;transition:background 0.2s}a:hover{background:#e08735}</style></head><body><div class="container"><div class="emoji">😵</div><h2>Something Went Wrong</h2><p>We\'re having trouble loading this article. Please try again later.</p><div class="error-detail">' + escaped + '</div><a href="/">← Back to Home</a></div></body></html>';
}

// ============================================
// EXPORTS
// ============================================
export const config = {
  api: {
    bodyParser: {
      sizeLimit: '10mb',
    },
  },
};