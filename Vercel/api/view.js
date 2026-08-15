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
  const index = Math.abs(parseInt(articleId, 10) || 0) % COLOR_PAIRS.length;
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
  return crypto.createHash('sha256').update(ip + (process.env.IP_SALT || 'easyread-salt')).digest('hex');
}

function getGuestIdentifier(req) {
  const forwarded = req.headers['x-forwarded-for'];
  const ip = forwarded ? forwarded.split(',')[0].trim() : req.socket?.remoteAddress || req.connection?.remoteAddress || '127.0.0.1';
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
          if (action === 'data') {
            return await getArticleData(req, res);
          }
          return await renderArticlePage(req, res);
        }
        if (action === 'bookmark-status') {
          return await getBookmarkStatus(req, res);
        }
        if (action === 'guest-status') {
          return await getGuestStatus(req, res);
        }
        return res.status(200).send(renderNoArticlePage());
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
        return res.status(405).json({ error: 'Method not allowed' });
    }
  } catch (error) {
    console.error('View API Error:', error);
    return res.status(500).json({ error: error.message });
  }
}

// ============================================
// RENDER NO ARTICLE PAGE
// ============================================
function renderNoArticlePage() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>EasyRead - Simplified Knowledge</title>
  <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap" rel="stylesheet">
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: 'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, sans-serif;
      background: #f6f7f9;
      min-height: 100vh;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: 2rem;
    }
    .container { max-width: 640px; width: 100%; text-align: center; }
    .logo {
      font-size: 2.5rem;
      font-weight: 800;
      color: #1c1c1e;
      margin-bottom: 0.5rem;
      letter-spacing: -1px;
    }
    .logo span { color: #f59847; }
    .icon-wrapper {
      width: 80px;
      height: 80px;
      margin: 1.5rem auto;
      background: linear-gradient(135deg, #f59847 0%, #e08735 100%);
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      box-shadow: 0 12px 40px rgba(245, 152, 71, 0.25);
    }
    .icon-wrapper svg { width: 40px; height: 40px; fill: white; }
    h1 { font-size: 1.8rem; font-weight: 700; color: #1c1c1e; margin-bottom: 0.5rem; }
    .subtitle { font-size: 1rem; color: #5c5c60; line-height: 1.6; max-width: 480px; margin: 0 auto 2rem; }
    .back-link {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      color: #fff;
      background: #f59847;
      font-weight: 600;
      text-decoration: none;
      padding: 0.8rem 1.8rem;
      border-radius: 30px;
      transition: all 0.2s;
      box-shadow: 0 4px 14px rgba(245, 152, 71, 0.3);
    }
    .back-link:hover { background: #e08735; transform: translateY(-2px); }
  </style>
</head>
<body>
  <div class="container">
    <div class="logo">Easy<span>Read</span></div>
    <div class="icon-wrapper">
      <svg viewBox="0 0 24 24"><path d="M4 6H2v14c0 1.1.9 2 2 2h14v-2H4V6zm16-4H8c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm-1 9H9V9h10v2zm-3 4H9v-2h7v2zm3-8H9V5h10v2z"/></svg>
    </div>
    <h1>No Article Selected</h1>
    <p class="subtitle">Select an article from your library or homepage to start reading simplified, tailored explanations.</p>
    <a href="/" class="back-link">Return to Home</a>
  </div>
</body>
</html>`;
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
      const { data: existing } = await supabase
        .from('reading_history')
        .select('history_id')
        .eq('user_id', user_id)
        .eq('article_id', parseInt(article_id))
        .eq('date', today)
        .maybeSingle();

      if (!existing) {
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
        await supabase
          .from('usage')
          .update({ articles_read: (todayUsage.articles_read || 0) + 1 })
          .eq('usage_id', todayUsage.usage_id);
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

    return res.json({
      success: true,
      isGuest: true,
      limit: limitCheck.limit,
      used: limitCheck.used + 1,
      remaining: limitCheck.remaining - 1
    });
  } catch (error) {
    console.error('Track guest read error:', error);
    return res.status(500).json({ error: error.message });
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

      await supabase
        .from('users')
        .update({ credits: user.credits - CREDIT_COSTS.ASK_QUESTION })
        .eq('user_id', user_id);

      if (todayUsage) {
        await supabase
          .from('usage')
          .update({
            questions: (todayUsage.questions || 0) + 1,
            credits_used: (todayUsage.credits_used || 0) + CREDIT_COSTS.ASK_QUESTION
          })
          .eq('usage_id', todayUsage.usage_id);
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

    return res.json({
      success: true,
      isGuest: true,
      limit: limitCheck.limit,
      used: limitCheck.used + 1,
      remaining: limitCheck.remaining - 1
    });
  } catch (error) {
    console.error('Track guest question error:', error);
    return res.status(500).json({ error: error.message });
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

    return res.json({
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
    return res.status(500).json({ error: error.message });
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

    // Guest vs Auth tracking
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
        await supabase
          .from('usage')
          .update({ articles_read: (todayUsage.articles_read || 0) + 1 })
          .eq('usage_id', todayUsage.usage_id);
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

    // Increment article view count directly
    const currentViewCount = (article.view_count || 0) + 1;
    await supabase
      .from('articles')
      .update({ view_count: currentViewCount })
      .eq('article_id', article.article_id);
    article.view_count = currentViewCount;

    const colorPair = getColorPairForArticle(article.article_id);
    const ogImageUrl = generateOgImageUrl(
      article.canonical_title || 'EasyRead Article',
      colorPair.bg,
      colorPair.text
    );

    // Fetch explanations
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
        profiles:profile_id (profile_id, name, description)
      `)
      .eq('article_id', article.article_id)
      .order('view_count', { ascending: false });

    if (expError) throw expError;

    // Fetch ratings
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
      const readLimitCheck = await checkGuestLimit(guestId, 'read');
      const questionLimitCheck = await checkGuestLimit(guestId, 'question');
      guestLimitInfo = {
        limit: readLimitCheck.limit,
        used: readLimitCheck.used,
        remaining: readLimitCheck.remaining,
        question_remaining: questionLimitCheck.remaining,
        message: readLimitCheck.message
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

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.status(200).send(html);

  } catch (error) {
    console.error('Render article error:', error);
    return res.status(500).send(renderErrorPage(error.message));
  }
}

// ============================================
// GET ARTICLE DATA (JSON)
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
        profiles:profile_id (profile_id, name, description)
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

    const defaultExp = explanations?.find(e => e.profile_id === 1) || explanations?.[0];
    const readingTime = calculateReadingTime(defaultExp?.content || article.base_content);

    return res.json({
      success: true,
      article: {
        ...article,
        reading_time: readingTime,
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
    return res.status(500).json({ error: error.message });
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

      const { count } = await supabase
        .from('bookmarks')
        .select('*', { count: 'exact', head: true })
        .eq('article_id', parseInt(article_id));

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

      const { count } = await supabase
        .from('bookmarks')
        .select('*', { count: 'exact', head: true })
        .eq('article_id', parseInt(article_id));

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
    return res.status(500).json({ error: error.message });
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

    return res.json({
      success: true,
      message: 'Bookmark removed'
    });
  } catch (error) {
    console.error('Remove bookmark error:', error);
    return res.status(500).json({ error: error.message });
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

    return res.json({
      isBookmarked: !!bookmark,
      bookmark_id: bookmark?.bookmark_id,
      created_at: bookmark?.created_at,
      isAuthenticated: true
    });
  } catch (error) {
    console.error('Get bookmark status error:', error);
    return res.status(500).json({ error: error.message });
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
    const { data: existing } = await supabase
      .from('ratings')
      .select('rating_id, rating')
      .eq('user_id', user_id)
      .eq('view_id', view_id)
      .maybeSingle();

    if (existing) {
      return res.status(409).json({
        error: 'Already rated this article',
        rating_id: existing.rating_id,
        rating: existing.rating
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

    await supabase
      .from('explanation_views')
      .update({
        rating_avg: Math.round(newAvg * 100) / 100,
        rating_count: newCount
      })
      .eq('view_id', view_id);

    const users = await getByColumn('users', 'user_id', user_id);
    if (users.length > 0) {
      const user = users[0];
      const bonus = CREDIT_COSTS.RATING_BONUS;

      await supabase
        .from('users')
        .update({ credits: user.credits + bonus })
        .eq('user_id', user_id);

      await insert('credit_transactions', {
        user_id,
        amount: bonus,
        reason: 'Rating bonus',
        balance_after: user.credits + bonus,
        item_id: view_id
      });
    }

    return res.status(201).json({
      success: true,
      message: 'Rating submitted successfully',
      rating_id: ratingRecord.rating_id,
      bonus_earned: CREDIT_COSTS.RATING_BONUS
    });

  } catch (error) {
    console.error('Submit rating error:', error);
    return res.status(500).json({ error: error.message });
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
      .maybeSingle();

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
    if (users.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    const user = users[0];
    if (user.credits < CREDIT_COSTS.DEEP_DIVE) {
      return res.status(402).json({
        error: 'Insufficient credits',
        required: CREDIT_COSTS.DEEP_DIVE,
        available: user.credits
      });
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

    await supabase
      .from('users')
      .update({ credits: user.credits - CREDIT_COSTS.DEEP_DIVE })
      .eq('user_id', user_id);

    if (todayUsage) {
      await supabase
        .from('usage')
        .update({
          deep_dives: (todayUsage.deep_dives || 0) + 1,
          credits_used: (todayUsage.credits_used || 0) + CREDIT_COSTS.DEEP_DIVE
        })
        .eq('usage_id', todayUsage.usage_id);
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

    const { data: deepDive } = await supabase
      .from('deep_dives')
      .select('*')
      .eq('article_id', article_id)
      .eq('profile_id', profile_id)
      .eq('question', question)
      .maybeSingle();

    return res.json({
      success: true,
      cached: false,
      deep_dive: deepDive || data.deep_dive,
      credits_remaining: user.credits - CREDIT_COSTS.DEEP_DIVE,
      message: 'Deep dive generated successfully'
    });

  } catch (error) {
    console.error('Deep dive error:', error);
    return res.status(500).json({ error: error.message });
  }
}

// ============================================
// HTML BUILDERS
// ============================================

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
  const description = article.summary || 'Read this simplified article on EasyRead';

  const defaultExplanation = explanations?.find(e => e.profile_id === 1) || explanations?.[0];
  const activeProfile = profiles?.find(p => p.profile_id === (defaultExplanation?.profile_id || 1)) || profiles?.[0];

  const readingTime = calculateReadingTime(defaultExplanation?.content || article.base_content);
  const imageUrl = ogImageUrl || `https://placehold.co/1200x630/1A1A2E/FFFFFF?text=${encodeURIComponent(title.substring(0, 60))}`;

  let html = `<!DOCTYPE html>
<html lang="en" data-theme="auto">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=yes, viewport-fit=cover">
  <title>${escapeHtml(title)} | EasyRead</title>
  <meta name="description" content="${escapeHtml(description)}">
  <meta property="og:title" content="${escapeHtml(title)} | EasyRead">
  <meta property="og:description" content="${escapeHtml(description)}">
  <meta property="og:image" content="${imageUrl}">
  <meta property="og:url" content="${SITE_URL}/view?id=${article.article_id}">
  <meta property="og:type" content="article">
  <meta property="og:site_name" content="EasyRead">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="${escapeHtml(title)} | EasyRead">
  <meta name="twitter:description" content="${escapeHtml(description)}">
  <meta name="twitter:image" content="${imageUrl}">
  <meta property="article:published_time" content="${article.created_at || ''}">
  <meta property="article:modified_time" content="${article.updated_at || ''}">
  <meta property="article:author" content="EasyRead">
`;

  if (Array.isArray(article.categories)) {
    article.categories.forEach(cat => {
      html += `  <meta property="article:tag" content="${escapeHtml(cat)}">\n`;
    });
  }

  html += `  <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@300;400;500;600;700;800&display=swap" rel="stylesheet">
  <style>${getCSSStyles()}</style>
</head>
<body>
  <div class="progress-bar" id="progressBar"></div>
  <div class="toast" id="toast"></div>

  <!-- Login Modal -->
  <div class="login-overlay" id="loginOverlay">
    <div class="login-modal">
      <button class="login-close" onclick="closeLoginModal()">✕</button>
      <div class="login-modal-content">
        <h2>Sign in to continue</h2>
        <p>Unlock custom explanation profiles, interactive deep dives, bookmarks, and ask personalized questions.</p>
        <div class="login-modal-buttons">
          <a href="${SITE_URL}#login" class="login-btn-primary">Sign In</a>
          <a href="${SITE_URL}#signup" class="login-btn-secondary">Create Account</a>
        </div>
      </div>
    </div>
  </div>

  <div class="full-screen-reader">
    ${buildHeaderHTML(userCredits, user_id, isGuest, guestLimitInfo)}
    ${buildHeroHTML(title, article.categories)}
    ${buildProfilePillsHTML(profiles, defaultExplanation?.profile_id || 1)}
    ${buildGradientCardHTML(activeProfile)}
    ${buildArticleContentHTML(article, explanations)}
    ${buildSummaryHTML(article, defaultExplanation)}
    ${buildMetadataHTML(article, defaultExplanation, readingTime)}
    ${buildFooterHTML(article, user_id, isBookmarked)}
    ${buildReviewModalHTML(userRating, user_id, isGuest)}
    ${buildDeepDiveModalHTML(isGuest)}
  </div>

  <script>
    ${getJavaScript(article, explanations, profiles, userRating, user_id, sessionToken, isBookmarked, isGuest, guestLimitInfo, guestId, userCredits)}
  </script>
</body>
</html>`;

  return html;
}

// ============================================
// HTML COMPONENT BUILDERS
// ============================================

function buildHeaderHTML(userCredits, user_id, isGuest, guestLimitInfo) {
  const isAuthenticated = !!user_id;
  let html = `    <header class="reader-header">
      <div class="category-breadcrumb">
        <a href="/" class="brand-link">Easy<span>Read</span></a>
        <span>›</span>
        <span class="current">Reading</span>
      </div>
      <div class="header-actions">
        <button onclick="window.toggleTheme()" class="glass-icon-btn" title="Toggle theme" aria-label="Toggle theme">
          <svg viewBox="0 0 24 24"><path d="M12 3a9 9 0 1 0 9 9c0-.46-.04-.92-.1-1.36a5.5 5.5 0 0 1-7.64-1.56 5.5 5.5 0 0 1-1.56-7.64A9.02 9.02 0 0 0 12 3z"/></svg>
        </button>
`;

  if (isAuthenticated) {
    html += `        <div class="credits-badge" id="userCreditsBadge" title="Credit Balance">
          <span class="lightning-icon">⚡</span>
          <span class="credits-val" id="creditsValueDisplay">${(userCredits !== null ? userCredits : 50).toFixed(1)}</span>
          <span class="credits-label">credits</span>
        </div>\n`;
  } else {
    if (isGuest && guestLimitInfo) {
      html += `        <div class="guest-badge">Guest · ${guestLimitInfo.remaining} reads left</div>\n`;
    }
    html += `        <a href="${SITE_URL}#login" class="auth-link">Sign In</a>\n`;
  }

  html += `      </div>
    </header>\n`;
  return html;
}

function buildHeroHTML(title, categories) {
  const cats = Array.isArray(categories) && categories.length > 0 ? categories : ['General'];
  let html = `    <header class="hero-section">
      <div class="category-tags-list">
`;
  cats.forEach(cat => {
    html += `        <span class="category-tag">${escapeHtml(cat)}</span>\n`;
  });
  html += `      </div>
      <h1 class="hero-title">${escapeHtml(title)}</h1>
    </header>\n`;
  return html;
}

function buildProfilePillsHTML(profiles, activeProfileId) {
  if (!profiles || profiles.length === 0) {
    return '';
  }

  let html = `    <div class="profile-pills-wrapper">
      <div class="profile-pills-scroll" id="profilePills">
`;

  profiles.forEach(p => {
    const isActive = p.profile_id === activeProfileId;
    const icon = getProfileIcon(p.name);
    html += `        <button class="profile-pill ${isActive ? 'active' : ''}" data-profile-id="${p.profile_id}" onclick="switchProfile(${p.profile_id}, this)">
          ${icon}
          <span>${escapeHtml(p.name)}</span>
        </button>\n`;
  });

  html += `      </div>
    </div>\n`;
  return html;
}

function buildGradientCardHTML(activeProfile) {
  const description = activeProfile?.description || 'Tailored explanations designed for effortless comprehension.';
  return `    <div class="featured-gradient-card" id="gradientCard">
      <div class="gradient-card-overlay"></div>
      <div class="catch-line-content">
        <span class="profile-badge-small" id="cardProfileBadge">${escapeHtml(activeProfile?.name || 'General')} Perspective</span>
        <p class="catch-line-text" id="catchLineText">"${escapeHtml(description)}"</p>
      </div>
    </div>\n`;
}

function buildArticleContentHTML(article, explanations) {
  const defaultExplanation = explanations?.find(e => e.profile_id === 1) || explanations?.[0];
  const content = defaultExplanation?.content || article.base_content || 'No content available.';

  const renderedHTML = renderMarkdownToHtml(content);

  return `    <article class="article-body" id="articleContent">
      <div class="content-shimmer" id="contentShimmer" style="display: none;">
        <div class="shimmer-line line-1"></div>
        <div class="shimmer-line line-2"></div>
        <div class="shimmer-line line-3"></div>
        <div class="shimmer-line line-4"></div>
      </div>
      <div id="articleText">
        ${renderedHTML}
      </div>
    </article>\n`;
}

function buildSummaryHTML(article, defaultExplanation) {
  const summary = defaultExplanation?.summary || article.summary;
  if (!summary) return '';

  return `    <div class="summary-wrapper">
      <div class="summary-content">
        <h4>Key Takeaway</h4>
        <p>${escapeHtml(summary)}</p>
      </div>
    </div>\n`;
}

function buildMetadataHTML(article, defaultExplanation, readingTime) {
  const date = article.created_at ? new Date(article.created_at).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric'
  }) : 'Recently';

  const viewCount = defaultExplanation?.view_count || article.view_count || 0;
  const ratingAvg = defaultExplanation?.rating_avg || 0;
  const ratingCount = defaultExplanation?.rating_count || 0;

  return `    <div class="article-metadata">
      <div class="meta-left">
        <span class="source-badge">Source: ${escapeHtml(article.source_domain || 'EasyRead')}</span>
        <span>·</span>
        <span>${date}</span>
      </div>
      <div class="meta-right">
        <span>⏱️ ${readingTime} min read</span>
        <span>·</span>
        <span>👁️ ${viewCount} views</span>
        ${ratingCount > 0 ? `<span>·</span><span>⭐ ${ratingAvg.toFixed(1)} (${ratingCount})</span>` : ''}
      </div>
    </div>\n`;
}

function buildFooterHTML(article, user_id, isBookmarked) {
  const isAuthenticated = !!user_id;

  return `    <div class="glass-footer">
      <div class="footer-content">
        <div class="link-pill" title="${escapeHtml(article.source_url || '')}">
          <span>🔗 ${escapeHtml(article.source_domain || 'easytoread.vercel.app')}/</span>${escapeHtml((article.slug || 'article').substring(0, 18))}...
        </div>
        <div class="glass-actions">
          <button class="glass-icon-btn" onclick="copyLink()" title="Copy link" aria-label="Copy link">
            <svg viewBox="0 0 24 24"><path d="M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z"/></svg>
          </button>
          <button class="glass-icon-btn" onclick="shareLink()" title="Share" aria-label="Share article">
            <svg viewBox="0 0 24 24"><path d="M18 16.08c-.76 0-1.44.3-1.96.77L8.91 12.7c.05-.23.09-.46.09-.7s-.04-.47-.09-.7l7.05-4.11c.54.5 1.25.81 2.04.81 1.66 0 3-1.34 3-3s-1.34-3-3-3-3 1.34-3 3c0 .24.04.47.09.7L8.04 9.81C7.5 9.31 6.79 9 6 9c-1.66 0-3 1.34-3 3s1.34 3 3 3c.79 0 1.5-.31 2.04-.81l7.12 4.16c-.05.21-.08.43-.08.65 0 1.61 1.31 2.92 2.92 2.92s2.92-1.31 2.92-2.92-1.31-2.92-2.92-2.92z"/></svg>
          </button>
          <button class="glass-icon-btn bookmark-btn ${isBookmarked ? 'bookmarked' : ''}" id="bookmarkBtn" onclick="handleBookmark()" title="${isBookmarked ? 'Remove bookmark' : 'Bookmark'}" aria-label="Bookmark">
            <svg viewBox="0 0 24 24"><path d="${isBookmarked ? 'M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z' : 'M17 3H7c-1.1 0-2 .9-2 2v16l7-3 7 3V5c0-1.1-.9-2-2-2z'}"/></svg>
          </button>
          <button class="glass-icon-btn rate-btn" onclick="openReview()" title="Rate Explanation" aria-label="Rate article">
            <svg viewBox="0 0 24 24"><path d="M12 17.27L18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z"/></svg>
          </button>
          <button class="glass-icon-btn deep-dive-trigger" onclick="${isAuthenticated ? 'openDeepDiveModal()' : 'showLoginModal(\'deep-dive\')'}" title="Deep Dive Questions" aria-label="Deep Dive">
            <svg viewBox="0 0 24 24"><path d="M15.5 14h-.79l-.28-.27C15.41 12.59 16 11.11 16 9.5 16 5.91 13.09 3 9.5 3S3 5.91 3 9.5 5.91 16 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z"/></svg>
          </button>
        </div>
      </div>
    </div>\n`;
}

function buildReviewModalHTML(userRating, user_id, isGuest) {
  const hasRated = !!userRating;
  const isAuthenticated = !!user_id;

  if (!isAuthenticated || isGuest) {
    return `    <div class="review-overlay" id="reviewModal">
      <div class="review-modal">
        <button class="modal-close" onclick="closeReview()">✕</button>
        <div class="login-modal-content">
          <h3>Sign in to rate</h3>
          <p>Sign in to rate explanations, give feedback, and earn bonus read credits!</p>
          <a href="${SITE_URL}#login" class="btn-modal-primary">Sign In</a>
        </div>
      </div>
    </div>\n`;
  }

  if (hasRated) {
    return `    <div class="review-overlay" id="reviewModal">
      <div class="review-modal">
        <button class="modal-close" onclick="closeReview()">✕</button>
        <div class="review-submitted-state">
          <div class="star-big">⭐</div>
          <h3>Feedback Recorded</h3>
          <p>Thank you! Your feedback helps continuously improve our explanations.</p>
          <button class="btn-modal-primary" onclick="closeReview()">Close</button>
        </div>
      </div>
    </div>\n`;
  }

  return `    <div class="review-overlay" id="reviewModal">
      <div class="review-modal" id="reviewModalBody">
        <button class="modal-close" onclick="closeReview()">✕</button>
        <div class="bonus-incentive-pill">
          <span>⚡</span> +0.2 Credit Reward
        </div>
        <h3>Rate this Explanation</h3>
        <p class="sub-text">How clear was this version?</p>
        <div class="rating-scale" id="ratingGroup">
          <input type="radio" id="mRate1" name="rating" value="1" onclick="updateRatingFeedback(1)">
          <label for="mRate1" title="Confusing">😣</label>
          <input type="radio" id="mRate2" name="rating" value="2" onclick="updateRatingFeedback(2)">
          <label for="mRate2" title="Unclear">😕</label>
          <input type="radio" id="mRate3" name="rating" value="3" onclick="updateRatingFeedback(3)">
          <label for="mRate3" title="Average">😐</label>
          <input type="radio" id="mRate4" name="rating" value="4" onclick="updateRatingFeedback(4)">
          <label for="mRate4" title="Clear">🙂</label>
          <input type="radio" id="mRate5" name="rating" value="5" onclick="updateRatingFeedback(5)">
          <label for="mRate5" title="Insightful">🤯</label>
        </div>
        <div class="rating-description" id="ratingDesc">Tap an emoji to rate</div>
        <div class="feedback-options" id="feedbackOptions">
          <p>What could be better?</p>
          <div class="feedback-grid">
            <div class="feedback-chip" onclick="this.classList.toggle('selected')">Too complex</div>
            <div class="feedback-chip" onclick="this.classList.toggle('selected')">Needs better analogies</div>
            <div class="feedback-chip" onclick="this.classList.toggle('selected')">Missing context</div>
            <div class="feedback-chip" onclick="this.classList.toggle('selected')">Too brief</div>
          </div>
        </div>
        <div class="modal-actions">
          <button class="btn-modal-secondary" onclick="closeReview()">Cancel</button>
          <button class="btn-modal-primary" onclick="submitReview()">Submit</button>
        </div>
      </div>
    </div>\n`;
}

function buildDeepDiveModalHTML(isGuest) {
  return `    <div class="deep-dive-overlay" id="deepDiveModal">
      <div class="deep-dive-modal">
        <button class="modal-close" onclick="closeDeepDiveModal()">✕</button>
        <div class="deep-dive-header">
          <div class="deep-dive-icon">🔍</div>
          <h3>Deep Dive Question</h3>
          ${isGuest ? `
            <p>Sign in to ask questions and explore this topic in greater detail.</p>
            <a href="${SITE_URL}#login" class="btn-modal-primary">Sign In</a>
          ` : `
            <p>Ask anything about this topic tailored to your active perspective.</p>
            <form id="deepDiveForm" onsubmit="submitDeepDive(event)">
              <textarea id="deepDiveQuestion" placeholder="What specific concept would you like to explore?" required></textarea>
              <div class="modal-actions">
                <button type="button" class="btn-modal-secondary" onclick="closeDeepDiveModal()">Cancel</button>
                <button type="submit" class="btn-modal-primary">Ask (0.5 Credits)</button>
              </div>
            </form>
          `}
        </div>
      </div>
    </div>\n`;
}

// ============================================
// CLIENT JAVASCRIPT GENERATOR
// ============================================

function getJavaScript(article, explanations, profiles, userRating, user_id, sessionToken, isBookmarked, isGuest, guestLimitInfo, guestId, userCredits) {
  const initialCredits = userCredits !== null ? userCredits : 50;
  const activeExp = explanations?.find(e => e.profile_id === 1) || explanations?.[0];

  return `
let currentThemeSetting = localStorage.getItem("easyread-theme") || "auto";
let currentCredits = ${initialCredits};
let currentViewId = ${activeExp?.view_id || 'null'};
let currentProfileId = ${activeExp?.profile_id || 1};
const currentArticleId = ${article.article_id};
const isAuthenticated = ${!!user_id};
const isGuest = ${isGuest};
let isBookmarked = ${isBookmarked};
const userId = "${escapeJs(user_id || '')}";
const sessionToken = "${escapeJs(sessionToken || '')}";
const guestId = "${escapeJs(guestId || '')}";
let guestRemainingReads = ${guestLimitInfo?.remaining || 0};

const explanationsData = ${JSON.stringify(explanations || [])};
const profilesData = ${JSON.stringify(profiles || [])};

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

function showToast(message, type) {
  type = type || 'info';
  const toast = document.getElementById('toast');
  if (!toast) return;
  toast.textContent = message;
  toast.className = 'toast show toast-' + type;
  clearTimeout(toast._timeout);
  toast._timeout = setTimeout(function() {
    toast.classList.remove('show');
  }, 3000);
}

window.showLoginModal = function() {
  const overlay = document.getElementById('loginOverlay');
  if (overlay) overlay.classList.add('active');
  document.body.style.overflow = 'hidden';
};

window.closeLoginModal = function() {
  const overlay = document.getElementById('loginOverlay');
  if (overlay) overlay.classList.remove('active');
  document.body.style.overflow = '';
};

window.openDeepDiveModal = function() {
  if (!isAuthenticated) {
    showLoginModal();
    return;
  }
  const modal = document.getElementById('deepDiveModal');
  if (modal) modal.classList.add('active');
  document.body.style.overflow = 'hidden';
  setTimeout(function() {
    const input = document.getElementById('deepDiveQuestion');
    if (input) input.focus();
  }, 200);
};

window.closeDeepDiveModal = function() {
  const modal = document.getElementById('deepDiveModal');
  if (modal) modal.classList.remove('active');
  document.body.style.overflow = '';
};

window.openReview = function() {
  const modal = document.getElementById('reviewModal');
  if (modal) modal.classList.add('active');
  document.body.style.overflow = 'hidden';
};

window.closeReview = function() {
  const modal = document.getElementById('reviewModal');
  if (modal) modal.classList.remove('active');
  document.body.style.overflow = '';
};

window.updateRatingFeedback = function(rating) {
  const ratingDesc = document.getElementById('ratingDesc');
  const feedbackOptions = document.getElementById('feedbackOptions');
  const modalBody = document.getElementById('reviewModalBody');
  const map = {
    1: 'Extremely confusing or complicated',
    2: 'Hard to follow',
    3: 'Standard explanation',
    4: 'Clear and insightful',
    5: 'Brilliant explanation!'
  };
  if (ratingDesc) ratingDesc.textContent = map[rating] || 'Select your reaction';
  if (modalBody) modalBody.className = 'review-modal rating-glow-' + rating;
  if (feedbackOptions) {
    if (rating <= 3) feedbackOptions.classList.add('visible');
    else feedbackOptions.classList.remove('visible');
  }
};

window.submitReview = async function() {
  const selected = document.querySelector('input[name="rating"]:checked');
  if (!selected) {
    showToast('Please select a rating', 'error');
    return;
  }
  const rating = parseInt(selected.value);
  const feedbackChips = document.querySelectorAll('.feedback-chip.selected');
  let feedback = [];
  feedbackChips.forEach(c => feedback.push(c.textContent.trim()));

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
        feedback: feedback.join(', ') || null
      })
    });
    const data = await response.json();
    if (response.status === 201) {
      showToast('Rating submitted! +0.2 Credits', 'success');
      if (data.bonus_earned) {
        currentCredits += data.bonus_earned;
        const display = document.getElementById('creditsValueDisplay');
        if (display) display.textContent = currentCredits.toFixed(1);
      }
      closeReview();
    } else {
      showToast(data.error || 'Failed to submit rating', 'error');
    }
  } catch (error) {
    showToast('Network error: ' + error.message, 'error');
  }
};

window.handleBookmark = async function() {
  if (!isAuthenticated) {
    showLoginModal();
    return;
  }
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
      const btn = document.getElementById('bookmarkBtn');
      if (btn) {
        btn.classList.toggle('bookmarked', isBookmarked);
        btn.innerHTML = '<svg viewBox="0 0 24 24"><path d="' + (isBookmarked ? 'M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z' : 'M17 3H7c-1.1 0-2 .9-2 2v16l7-3 7 3V5c0-1.1-.9-2-2-2z') + '"/></svg>';
      }
      showToast(data.message, 'success');
    }
  } catch (error) {
    showToast('Error: ' + error.message, 'error');
  }
};

window.submitDeepDive = async function(e) {
  e.preventDefault();
  const input = document.getElementById('deepDiveQuestion');
  const question = input?.value.trim();
  if (!question || question.length < 4) {
    showToast('Please enter a valid question', 'error');
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
    if (data.success && data.deep_dive) {
      showToast('Deep dive generated!', 'success');
      displayDeepDiveResult(data.deep_dive, question);
    } else {
      showToast(data.error || 'Failed to generate deep dive', 'error');
    }
  } catch (err) {
    showToast('Error: ' + err.message, 'error');
  }
};

function displayDeepDiveResult(deepDive, question) {
  const container = document.createElement('div');
  container.className = 'deep-dive-overlay active';
  container.id = 'deepDiveResultOverlay';

  const modal = document.createElement('div');
  modal.className = 'deep-dive-modal result-modal';

  const closeBtn = document.createElement('button');
  closeBtn.className = 'modal-close';
  closeBtn.textContent = '✕';
  closeBtn.onclick = function() { container.remove(); document.body.style.overflow = ''; };

  const heading = document.createElement('h3');
  heading.textContent = 'Deep Dive Result';
  heading.style.color = 'var(--accent-color)';

  const qElem = document.createElement('p');
  qElem.className = 'sub-text';
  qElem.textContent = 'Q: ' + question;

  const contentBox = document.createElement('div');
  contentBox.className = 'deep-dive-answer-box';
  contentBox.innerHTML = renderMarkdownClient(deepDive.answer || 'No answer available.');

  modal.appendChild(closeBtn);
  modal.appendChild(heading);
  modal.appendChild(qElem);
  modal.appendChild(contentBox);
  container.appendChild(modal);

  document.body.appendChild(container);
  document.body.style.overflow = 'hidden';
}

window.switchProfile = function(profileId, buttonElem) {
  const pills = document.querySelectorAll('.profile-pill');
  pills.forEach(p => p.classList.remove('active'));
  buttonElem.classList.add('active');

  currentProfileId = profileId;
  const profile = profilesData.find(p => p.profile_id === profileId);
  const explanation = explanationsData.find(e => e.profile_id === profileId);

  const cardBadge = document.getElementById('cardProfileBadge');
  const cardText = document.getElementById('catchLineText');

  if (profile) {
    if (cardBadge) cardBadge.textContent = profile.name + ' Perspective';
    if (cardText) cardText.textContent = '"' + (profile.description || 'Simplified analysis.') + '"';
  }

  const textElem = document.getElementById('articleText');
  const shimmerElem = document.getElementById('contentShimmer');

  if (textElem) textElem.style.display = 'none';
  if (shimmerElem) shimmerElem.style.display = 'block';

  setTimeout(function() {
    if (shimmerElem) shimmerElem.style.display = 'none';
    if (textElem) {
      if (explanation) {
        currentViewId = explanation.view_id;
        textElem.innerHTML = renderMarkdownClient(explanation.content);
        textElem.style.display = 'block';
      } else {
        textElem.innerHTML = '<div class="no-explanation-box"><p>No tailored explanation generated for this profile yet.</p>' +
          (isAuthenticated ? '<button onclick="generateExplanation(' + profileId + ')" class="btn-modal-primary" style="margin-top:12px;">Generate Now</button>' : '<a href="${SITE_URL}#login" class="auth-link" style="margin-top:12px;display:inline-block;">Sign in to generate</a>') + '</div>';
        textElem.style.display = 'block';
      }
    }
  }, 250);
};

window.generateExplanation = async function(profileId) {
  if (!isAuthenticated) {
    showLoginModal();
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
        profile_id: profileId,
        force: false
      })
    });
    const data = await response.json();
    if (data.success) {
      showToast('Explanation ready!', 'success');
      setTimeout(function() { window.location.reload(); }, 600);
    } else {
      showToast(data.error || 'Failed to generate', 'error');
    }
  } catch (err) {
    showToast('Error: ' + err.message, 'error');
  }
};

function renderMarkdownClient(content) {
  if (!content) return '<p>No content available.</p>';
  const lines = content.split('\\n');
  let html = '';
  let inList = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) {
      if (inList) { html += '</ul>'; inList = false; }
      continue;
    }
    if (line.startsWith('### ')) {
      if (inList) { html += '</ul>'; inList = false; }
      html += '<h3 class="subheading-h3">' + line.replace('### ', '') + '</h3>';
    } else if (line.startsWith('## ') || line.startsWith('# ')) {
      if (inList) { html += '</ul>'; inList = false; }
      html += '<h2 class="subheading">' + line.replace(/^#+\\s*/, '') + '</h2>';
    } else if (line.startsWith('- ') || line.startsWith('* ')) {
      if (!inList) { html += '<ul class="content-list">'; inList = true; }
      html += '<li>' + line.replace(/^[-*]\\s*/, '') + '</li>';
    } else {
      if (inList) { html += '</ul>'; inList = false; }
      html += '<p>' + line + '</p>';
    }
  }
  if (inList) html += '</ul>';
  return html;
}

window.copyLink = function() {
  navigator.clipboard.writeText(window.location.href).then(function() {
    showToast('Link copied to clipboard!', 'success');
  }).catch(function() {
    showToast('Failed to copy link', 'error');
  });
};

window.shareLink = function() {
  if (navigator.share) {
    navigator.share({
      title: document.title,
      text: 'Read this simplified article on EasyRead!',
      url: window.location.href
    }).catch(function() {});
  } else {
    window.copyLink();
  }
};

window.addEventListener('scroll', function() {
  const scrollTop = window.scrollY;
  const docHeight = document.documentElement.scrollHeight - window.innerHeight;
  const progress = docHeight > 0 ? (scrollTop / docHeight) * 100 : 0;
  const bar = document.getElementById('progressBar');
  if (bar) bar.style.width = progress + '%';
});
`;
}

// ============================================
// UTILITIES & PARSERS
// ============================================

function calculateReadingTime(content, wordsPerMinute = 200) {
  if (!content) return 1;
  const words = content.trim().split(/\s+/).length;
  return Math.max(1, Math.ceil(words / wordsPerMinute));
}

function renderMarkdownToHtml(content) {
  if (!content) return '<p>No content available.</p>';
  const lines = content.split('\n');
  let html = '';
  let inList = false;

  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i].trim();
    if (!rawLine) {
      if (inList) { html += '</ul>\n'; inList = false; }
      continue;
    }

    if (rawLine.startsWith('### ')) {
      if (inList) { html += '</ul>\n'; inList = false; }
      html += `        <h3 class="subheading-h3">${escapeHtml(rawLine.replace('### ', ''))}</h3>\n`;
    } else if (rawLine.startsWith('## ') || rawLine.startsWith('# ')) {
      if (inList) { html += '</ul>\n'; inList = false; }
      html += `        <h2 class="subheading">${escapeHtml(rawLine.replace(/^#+\s*/, ''))}</h2>\n`;
    } else if (rawLine.startsWith('- ') || rawLine.startsWith('* ')) {
      if (!inList) { html += '        <ul class="content-list">\n'; inList = true; }
      html += `          <li>${escapeHtml(rawLine.replace(/^[-*]\s*/, ''))}</li>\n`;
    } else {
      if (inList) { html += '        </ul>\n'; inList = false; }
      html += `        <p>${escapeHtml(rawLine)}</p>\n`;
    }
  }
  if (inList) html += '        </ul>\n';
  return html;
}

function escapeHtml(text) {
  if (!text) return '';
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function escapeJs(text) {
  if (!text) return '';
  return String(text).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');
}

function getProfileIcon(name) {
  const icons = {
    'Everyday Life': '<svg viewBox="0 0 24 24"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93z"/></svg>',
    'Football': '<svg viewBox="0 0 24 24"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8zm-1-13h2v6h-2zm0 8h2v2h-2z"/></svg>',
    'Gaming': '<svg viewBox="0 0 24 24"><path d="M21.58 16.09l-1.09-7.66C20.21 6.46 18.52 5 16.53 5H7.47C5.48 5 3.79 6.46 3.51 8.43l-1.09 7.66C2.2 17.63 3.39 19 4.94 19h14.12c1.55 0 2.74-1.37 2.52-2.91z"/></svg>',
    'Movies & Cinema': '<svg viewBox="0 0 24 24"><path d="M18 4l2 4h-3l-2-4h-2l2 4h-3l-2-4H8l2 4H7L5 4H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V4h-4z"/></svg>',
    'Cooking & Food': '<svg viewBox="0 0 24 24"><path d="M18.06 22.99h1.66c.84 0 1.53-.64 1.63-1.46L23 5.05h-5V1h-2v4.05h-4.97l.27 16.48c.1.82.79 1.46 1.63 1.46h1.66z"/></svg>'
  };
  return icons[name] || '<svg viewBox="0 0 24 24"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2z"/></svg>';
}

// ============================================
// CSS STYLES
// ============================================

function getCSSStyles() {
  return `
:root{--bg-color:#f6f7f9;--bg-glow:radial-gradient(circle at 50% 0%,rgba(255,255,255,0.9) 0%,transparent 70%);--text-main:#1c1c1e;--text-secondary:#5c5c60;--text-muted:#8e8e93;--border-color:rgba(0,0,0,0.12);--border-subtle:rgba(0,0,0,0.08);--card-bg:rgba(242,242,247,0.75);--card-blur:blur(20px);--input-bg:rgba(0,0,0,0.04);--shadow-color:rgba(0,0,0,0.05);--glass-border:1.5px solid rgba(0,0,0,0.12);--glass-border-subtle:1px solid rgba(0,0,0,0.08);--glass-shadow:0 10px 30px rgba(0,0,0,0.05);--accent-color:#f59847;--accent-hover:#e08735;--accent-glow:rgba(245,152,71,0.15);--icon-color:#5c5c60;--gradient-color-1:#ffd3b6;--gradient-color-2:#ffaaa5;--gradient-color-3:#f59847;--gradient-color-4:#d4e5f7}
@media(prefers-color-scheme:dark){:root{--bg-color:#000000;--bg-glow:radial-gradient(circle at 50% 0%,rgba(40,40,42,0.4) 0%,transparent 60%);--text-main:#e8e8ea;--text-secondary:#9a9a9e;--text-muted:#6c6c70;--border-color:#2a2a2a;--border-subtle:rgba(255,255,255,0.06);--card-bg:rgba(18,18,18,0.95);--card-blur:blur(16px);--input-bg:#181818;--shadow-color:rgba(0,0,0,0.8);--glass-border:1px solid rgba(255,255,255,0.08);--glass-border-subtle:1px solid rgba(255,255,255,0.04);--glass-shadow:0 8px 32px rgba(0,0,0,0.6);--accent-color:#f59847;--accent-hover:#e08735;--icon-color:#9aa0a6;--gradient-color-1:#1f130f;--gradient-color-2:#30170a;--gradient-color-3:#c49a45;--gradient-color-4:#12161f}}
[data-theme="dark"]{--bg-color:#000000 !important;--bg-glow:radial-gradient(circle at 50% 0%,rgba(40,40,42,0.4) 0%,transparent 60%) !important;--text-main:#e8e8ea !important;--text-secondary:#9a9a9e !important;--text-muted:#6c6c70 !important;--border-color:#2a2a2a !important;--border-subtle:rgba(255,255,255,0.06) !important;--card-bg:rgba(18,18,18,0.95) !important;--input-bg:#181818 !important;--shadow-color:rgba(0,0,0,0.8) !important;--glass-border:1px solid rgba(255,255,255,0.08) !important;--glass-border-subtle:1px solid rgba(255,255,255,0.04) !important;--glass-shadow:0 8px 32px rgba(0,0,0,0.6) !important;--accent-color:#f59847 !important;--accent-hover:#e08735 !important;--icon-color:#9aa0a6 !important;--gradient-color-1:#1f130f !important;--gradient-color-2:#30170a !important;--gradient-color-3:#c49a45 !important;--gradient-color-4:#12161f !important}
*{margin:0;padding:0;box-sizing:border-box}
body{background-color:var(--bg-color);background-image:var(--bg-glow);background-repeat:no-repeat;background-size:100% 100%;color:var(--text-main);font-family:'Plus Jakarta Sans',-apple-system,BlinkMacSystemFont,sans-serif;min-height:100vh;width:100%;display:flex;justify-content:center;padding:2.5rem 1.5rem 6rem 1.5rem;transition:background-color 0.3s ease,color 0.3s ease}
.full-screen-reader{max-width:760px;width:100%}
.progress-bar{position:fixed;top:0;left:0;height:3px;background:var(--accent-color);width:0%;z-index:100;transition:width 0.1s linear}
.reader-header{display:flex;align-items:center;justify-content:space-between;margin-bottom:1.5rem}
.brand-link{font-weight:800;color:var(--text-main);text-decoration:none;font-size:1.1rem;letter-spacing:-0.5px}
.brand-link span{color:var(--accent-color)}
.category-breadcrumb{font-size:0.85rem;color:var(--text-secondary);display:flex;align-items:center;gap:6px;font-weight:600}
.category-breadcrumb span{color:var(--text-muted)}
.category-breadcrumb .current{color:var(--accent-color)}
.header-actions{display:flex;align-items:center;gap:10px}
.credits-badge{display:inline-flex;align-items:center;gap:6px;background:var(--card-bg);backdrop-filter:var(--card-blur);border:var(--glass-border-subtle);border-radius:20px;padding:0.4rem 0.9rem;font-size:0.8rem;font-weight:700}
.lightning-icon{color:var(--accent-color)}
.guest-badge{font-size:0.75rem;color:var(--text-muted);padding:0.3rem 0.7rem;border:var(--glass-border-subtle);border-radius:14px;background:var(--input-bg)}
.auth-link{color:var(--accent-color);font-weight:600;text-decoration:none;font-size:0.85rem;padding:0.4rem 0.9rem;border:1.5px solid var(--accent-color);border-radius:20px;transition:all 0.2s}
.auth-link:hover{background:var(--accent-color);color:#fff}
.glass-icon-btn{background:var(--input-bg);border:var(--glass-border-subtle);border-radius:50%;width:38px;height:38px;display:flex;align-items:center;justify-content:center;cursor:pointer;color:var(--icon-color);transition:all 0.2s ease}
.glass-icon-btn svg{width:18px;height:18px;fill:currentColor}
.glass-icon-btn:hover{background:var(--accent-color);color:#fff;border-color:var(--accent-color);transform:scale(1.05)}
.glass-icon-btn.bookmarked{color:var(--accent-color);background:rgba(245,152,71,0.15)}
.category-tags-list{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:0.75rem}
.category-tag{font-size:0.75rem;text-transform:uppercase;letter-spacing:0.8px;color:var(--accent-color);font-weight:700;background:rgba(245,152,71,0.12);padding:0.25rem 0.65rem;border-radius:12px}
.hero-title{font-size:2.4rem;font-weight:800;line-height:1.2;margin-bottom:1.5rem;color:var(--text-main);letter-spacing:-1px}
.profile-pills-wrapper{margin-bottom:1.5rem;overflow:hidden}
.profile-pills-scroll{display:flex;gap:8px;overflow-x:auto;padding-bottom:4px;scrollbar-width:none}
.profile-pills-scroll::-webkit-scrollbar{display:none}
.profile-pill{flex:0 0 auto;background:var(--card-bg);backdrop-filter:var(--card-blur);border:var(--glass-border-subtle);border-radius:30px;padding:0.5rem 1.1rem;font-size:0.85rem;font-weight:600;color:var(--text-secondary);cursor:pointer;transition:all 0.2s ease;display:inline-flex;align-items:center;gap:6px}
.profile-pill svg{width:16px;height:16px;fill:currentColor}
.profile-pill:hover{color:var(--text-main);background:var(--input-bg)}
.profile-pill.active{background:var(--accent-color);color:#fff;border-color:var(--accent-color);box-shadow:0 4px 12px var(--accent-glow)}
.featured-gradient-card{width:100%;min-height:180px;position:relative;border-radius:20px;overflow:hidden;border:var(--glass-border-subtle);background:linear-gradient(-45deg,var(--gradient-color-1),var(--gradient-color-2),var(--gradient-color-3),var(--gradient-color-4));background-size:300% 300%;animation:gradientShift 15s ease infinite;display:flex;align-items:center;justify-content:center;padding:2rem;margin-bottom:2rem}
@keyframes gradientShift{0%{background-position:0% 50%}50%{background-position:100% 50%}100%{background-position:0% 50%}}
.gradient-card-overlay{position:absolute;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.2)}
.catch-line-content{position:relative;z-index:2;text-align:center;max-width:560px}
.profile-badge-small{display:inline-block;font-size:0.75rem;font-weight:700;color:rgba(255,255,255,0.9);text-transform:uppercase;letter-spacing:1px;margin-bottom:0.5rem;background:rgba(0,0,0,0.25);padding:0.2rem 0.7rem;border-radius:20px}
.catch-line-text{font-size:1.35rem;font-weight:700;line-height:1.4;color:#fff;text-shadow:0 2px 10px rgba(0,0,0,0.3);letter-spacing:-0.3px}
.article-body p{font-size:1.12rem;line-height:1.75;color:var(--text-secondary);margin-bottom:1.5rem}
.subheading{font-size:1.5rem;font-weight:700;color:var(--text-main);margin-top:2.2rem;margin-bottom:1rem;letter-spacing:-0.5px}
.subheading-h3{font-size:1.25rem;font-weight:600;color:var(--text-main);margin-top:1.8rem;margin-bottom:0.8rem}
.content-list{padding-left:1.5rem;margin-bottom:1.5rem;color:var(--text-secondary);line-height:1.75}
.content-list li{margin-bottom:0.5rem}
.summary-wrapper{margin-top:2.5rem;margin-bottom:1.5rem}
.summary-content{background:var(--card-bg);backdrop-filter:var(--card-blur);border-radius:16px;padding:1.5rem;border:var(--glass-border-subtle)}
.summary-content h4{font-size:0.8rem;text-transform:uppercase;letter-spacing:1px;color:var(--accent-color);margin-bottom:0.5rem;font-weight:700}
.summary-content p{font-size:1rem;line-height:1.6;color:var(--text-secondary);margin:0}
.article-metadata{display:flex;align-items:center;justify-content:space-between;margin:1.5rem 0 2rem;padding:1rem 0;border-top:1px solid var(--border-subtle);border-bottom:1px solid var(--border-subtle);font-size:0.85rem;color:var(--text-muted);flex-wrap:wrap;gap:10px}
.meta-left{display:flex;align-items:center;gap:8px}
.source-badge{font-weight:600;color:var(--text-main)}
.meta-right{display:flex;align-items:center;gap:8px}
.glass-footer{position:fixed;bottom:20px;left:50%;transform:translateX(-50%);width:90%;max-width:720px;background:var(--card-bg);backdrop-filter:var(--card-blur);border:var(--glass-border);border-radius:24px;padding:0.75rem 1.25rem;box-shadow:var(--glass-shadow);z-index:100}
.footer-content{display:flex;align-items:center;justify-content:space-between;gap:10px}
.link-pill{background:var(--input-bg);border:var(--glass-border-subtle);border-radius:30px;padding:0.35rem 0.9rem;font-size:0.8rem;color:var(--text-secondary);max-width:260px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.glass-actions{display:flex;align-items:center;gap:8px}
.toast{position:fixed;bottom:90px;left:50%;transform:translateX(-50%) translateY(50px);background:var(--card-bg);backdrop-filter:var(--card-blur);border:var(--glass-border);border-radius:14px;padding:10px 20px;color:var(--text-main);font-size:0.88rem;box-shadow:var(--glass-shadow);z-index:2000;opacity:0;transition:all 0.3s ease;pointer-events:none;font-weight:600}
.toast.show{opacity:1;transform:translateX(-50%) translateY(0);pointer-events:auto}
.toast.toast-success{border-color:#34c759}
.toast.toast-error{border-color:#ff3b30}
.login-overlay,.deep-dive-overlay,.review-overlay{position:fixed;top:0;left:0;width:100vw;height:100vh;background:rgba(0,0,0,0.5);backdrop-filter:blur(16px);display:none;align-items:center;justify-content:center;z-index:1000;padding:1.5rem;opacity:0;transition:opacity 0.2s ease}
.login-overlay.active,.deep-dive-overlay.active,.review-overlay.active{display:flex;opacity:1}
.login-modal,.deep-dive-modal,.review-modal{background:var(--card-bg);backdrop-filter:var(--card-blur);border:var(--glass-border);border-radius:24px;padding:32px 24px;max-width:440px;width:100%;position:relative;text-align:center;box-shadow:0 20px 40px rgba(0,0,0,0.2)}
.modal-close,.login-close{position:absolute;top:16px;right:16px;background:transparent;border:none;font-size:1.2rem;color:var(--text-muted);cursor:pointer}
.btn-modal-primary{background:var(--accent-color);color:#fff;border:none;padding:0.75rem 1.6rem;border-radius:30px;font-weight:600;cursor:pointer;text-decoration:none;display:inline-block;transition:background 0.2s}
.btn-modal-primary:hover{background:var(--accent-hover)}
.btn-modal-secondary{background:transparent;border:var(--glass-border-subtle);color:var(--text-secondary);padding:0.75rem 1.6rem;border-radius:30px;font-weight:600;cursor:pointer}
.modal-actions{display:flex;gap:10px;justify-content:center;margin-top:1.5rem}
.modal-actions button{flex:1}
.rating-scale{display:flex;gap:10px;justify-content:center;margin:1.5rem 0 0.5rem}
.rating-scale label{font-size:2rem;cursor:pointer;opacity:0.5;transition:transform 0.2s,opacity 0.2s}
.rating-scale input{display:none}
.rating-scale input:checked+label,.rating-scale label:hover{opacity:1;transform:scale(1.2)}
.rating-description{font-size:0.85rem;color:var(--accent-color);font-weight:600;margin-bottom:1rem}
.feedback-options{display:none;margin-top:1rem}
.feedback-options.visible{display:block}
.feedback-grid{display:flex;flex-wrap:wrap;gap:6px;justify-content:center;margin-top:0.5rem}
.feedback-chip{background:var(--input-bg);border:var(--glass-border-subtle);color:var(--text-secondary);padding:6px 12px;border-radius:20px;font-size:12px;cursor:pointer}
.feedback-chip.selected{background:var(--accent-color);color:#fff}
.deep-dive-modal textarea{width:100%;padding:12px;border-radius:12px;border:var(--glass-border-subtle);background:var(--input-bg);color:var(--text-main);font-family:inherit;font-size:0.95rem;resize:vertical;min-height:90px;outline:none;margin-top:1rem}
.deep-dive-answer-box{background:var(--input-bg);border-radius:12px;padding:16px;text-align:left;color:var(--text-main);max-height:60vh;overflow-y:auto;line-height:1.6;font-size:0.95rem;margin-top:1rem}
@media(max-width:600px){body{padding:1.5rem 1rem 5.5rem}.hero-title{font-size:1.8rem}.featured-gradient-card{min-height:140px;padding:1.2rem}.catch-line-text{font-size:1.1rem}.link-pill{max-width:140px}}
`;
}

// ============================================
// ERROR / NOT FOUND PAGES
// ============================================

function renderNotFoundPage() {
  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><title>Article Not Found | EasyRead</title><link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@500;700;800&display=swap" rel="stylesheet"><style>body{font-family:'Plus Jakarta Sans',sans-serif;background:#f6f7f9;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;padding:20px;text-align:center}h1{font-size:3rem;color:#f59847}p{color:#5c5c60;margin:1rem 0 2rem}a{background:#f59847;color:#fff;padding:12px 24px;border-radius:24px;text-decoration:none;font-weight:600}</style></head><body><div><h1>404</h1><p>The requested article could not be found.</p><a href="/">Back to Home</a></div></body></html>`;
}

function renderErrorPage(message) {
  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><title>Error | EasyRead</title><link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@500;700;800&display=swap" rel="stylesheet"><style>body{font-family:'Plus Jakarta Sans',sans-serif;background:#f6f7f9;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;padding:20px;text-align:center}h1{font-size:2rem;color:#ff3b30}p{color:#5c5c60;margin:1rem 0 2rem}a{background:#f59847;color:#fff;padding:12px 24px;border-radius:24px;text-decoration:none;font-weight:600}</style></head><body><div><h1>Unable to Load Article</h1><p>${escapeHtml(message || 'An unexpected error occurred.')}</p><a href="/">Back to Home</a></div></body></html>`;
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