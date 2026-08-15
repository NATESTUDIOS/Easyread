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
  <title>EasyRead - Simplified Knowledge</title>
  <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@600;800&display=swap" rel="stylesheet">
  <style>
    body { font-family: 'Plus Jakarta Sans', sans-serif; background: #f6f7f9; min-height: 100vh; display: flex; align-items: center; justify-content: center; text-align: center; padding: 2rem; margin:0; }
    h1 { font-size: 1.8rem; color: #1c1c1e; margin-bottom: 0.5rem; }
    p { color: #5c5c60; margin-bottom: 1.5rem; }
    a { background: #f59847; color: #fff; padding: 10px 22px; border-radius: 20px; text-decoration: none; font-weight: 700; }
  </style>
</head>
<body>
  <div>
    <h1>No Article Selected</h1>
    <p>Select an article from your feed to view tailored explanations.</p>
    <a href="/">Return Home</a>
  </div>
</body>
</html>`;
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
      if (limitCheck.allowed) {
        await trackGuestUsage(guestId, 'read');
      }
    } else if (user_id) {
      const today = new Date().toISOString().split('T')[0];
      const { data: existing } = await supabase
        .from('reading_history')
        .select('history_id')
        .eq('user_id', user_id)
        .eq('article_id', article.article_id)
        .eq('date', today)
        .maybeSingle();

      if (!existing) {
        await insert('reading_history', {
          user_id,
          article_id: article.article_id,
          date: today,
          viewed_at: new Date().toISOString()
        });
      }
    }

    // Increment article view count
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
    const { data: explanations } = await supabase
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

    // Fetch existing deep dives for this article
    const { data: deepDives } = await supabase
      .from('deep_dives')
      .select('*')
      .eq('article_id', article.article_id)
      .order('created_at', { ascending: true });

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
      if (users.length > 0) userCredits = users[0].credits;
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

    const { data: profiles } = await supabase
      .from('profiles')
      .select('*')
      .eq('status', 'active')
      .order('profile_id', { ascending: true });

    const html = buildArticleHTML({
      article,
      explanations: explanations || [],
      deepDives: deepDives || [],
      userRating,
      userCredits,
      profiles: profiles || [],
      user_id,
      sessionToken,
      ogImageUrl,
      isBookmarked
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

    const { data: explanations } = await supabase
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

    const defaultExp = explanations?.find(e => e.profile_id === 1) || explanations?.[0];
    const readingTime = calculateReadingTime(defaultExp?.content || article.base_content);

    return res.json({
      success: true,
      article: { ...article, reading_time: readingTime },
      explanations: explanations || []
    });

  } catch (error) {
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
    return res.status(401).json({ error: 'Authentication required' });
  }

  try {
    const { data: existing } = await supabase
      .from('bookmarks')
      .select('bookmark_id')
      .eq('user_id', user_id)
      .eq('article_id', parseInt(article_id))
      .maybeSingle();

    if (existing) {
      await deleteRecord('bookmarks', existing.bookmark_id);
      return res.json({ success: true, bookmarked: false, message: 'Bookmark removed' });
    } else {
      const bookmark = await insert('bookmarks', {
        user_id,
        article_id: parseInt(article_id),
        created_at: new Date().toISOString()
      });
      return res.status(201).json({ success: true, bookmarked: true, bookmark_id: bookmark.bookmark_id, message: 'Bookmark added' });
    }
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}

// ============================================
// REMOVE BOOKMARK
// ============================================
async function removeBookmark(req, res) {
  const { article_id } = req.query;
  const user_id = req.headers['x-user-id'] || req.query.user_id;

  if (!user_id) return res.status(401).json({ error: 'Authentication required' });

  try {
    const { data: existing } = await supabase
      .from('bookmarks')
      .select('bookmark_id')
      .eq('user_id', user_id)
      .eq('article_id', parseInt(article_id))
      .maybeSingle();

    if (!existing) return res.status(404).json({ error: 'Bookmark not found' });
    await deleteRecord('bookmarks', existing.bookmark_id);

    return res.json({ success: true, message: 'Bookmark removed' });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}

// ============================================
// GET BOOKMARK STATUS
// ============================================
async function getBookmarkStatus(req, res) {
  const { article_id } = req.query;
  const user_id = req.headers['x-user-id'] || req.query.user_id;

  if (!user_id) return res.json({ isBookmarked: false, isAuthenticated: false });

  try {
    const { data: bookmark } = await supabase
      .from('bookmarks')
      .select('bookmark_id')
      .eq('user_id', user_id)
      .eq('article_id', parseInt(article_id))
      .maybeSingle();

    return res.json({ isBookmarked: !!bookmark, isAuthenticated: true });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}

// ============================================
// SUBMIT RATING
// ============================================
async function submitRating(req, res) {
  const { view_id, rating } = req.body;
  const user_id = req.headers['x-user-id'] || req.query.user_id;

  if (!user_id) return res.status(401).json({ error: 'Authentication required' });

  try {
    await insert('ratings', {
      user_id,
      view_id: parseInt(view_id),
      rating
    });

    const { data: viewData } = await supabase
      .from('explanation_views')
      .select('rating_avg, rating_count')
      .eq('view_id', view_id)
      .single();

    const newCount = (viewData?.rating_count || 0) + 1;
    const newAvg = ((viewData?.rating_avg || 0) * (viewData?.rating_count || 0) + rating) / newCount;

    await supabase
      .from('explanation_views')
      .update({ rating_avg: Math.round(newAvg * 100) / 100, rating_count: newCount })
      .eq('view_id', view_id);

    const users = await getByColumn('users', 'user_id', user_id);
    if (users.length > 0) {
      const user = users[0];
      await supabase.from('users').update({ credits: user.credits + CREDIT_COSTS.RATING_BONUS }).eq('user_id', user_id);
    }

    return res.status(201).json({ success: true, bonus_earned: CREDIT_COSTS.RATING_BONUS });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}

// ============================================
// HANDLE DEEP DIVE (Direct Render Delegation)
// ============================================
async function handleDeepDive(req, res) {
  const { article_id, profile_id, question } = req.body;
  const user_id = req.headers['x-user-id'] || req.query.user_id;

  if (!user_id) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  try {
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
        user_id: user_id
      })
    });

    const data = await response.json();
    return res.json(data);
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}

// ============================================
// HTML BUILDERS
// ============================================

function buildArticleHTML({ 
  article, 
  explanations, 
  deepDives,
  userRating, 
  userCredits, 
  profiles, 
  user_id,
  sessionToken,
  ogImageUrl,
  isBookmarked
}) {
  const title = article.canonical_title || 'Untitled Article';
  const description = article.summary || 'Read this simplified article on EasyRead';

  const defaultExplanation = explanations?.find(e => e.profile_id === 1) || explanations?.[0];
  const activeProfile = profiles?.find(p => p.profile_id === (defaultExplanation?.profile_id || 1)) || profiles?.[0];
  const readingTime = calculateReadingTime(defaultExplanation?.content || article.base_content);
  const imageUrl = ogImageUrl || `https://placehold.co/1200x630/1A1A2E/FFFFFF?text=${encodeURIComponent(title.substring(0, 60))}`;

  let html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=yes, viewport-fit=cover">
  <title>${escapeHtml(title)} | EasyRead</title>
  <meta name="description" content="${escapeHtml(description)}">
  <meta property="og:title" content="${escapeHtml(title)} | EasyRead">
  <meta property="og:description" content="${escapeHtml(description)}">
  <meta property="og:image" content="${imageUrl}">
  <meta property="og:url" content="${SITE_URL}/article/${article.slug || article.article_id}">
  <meta property="og:type" content="article">
  <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@300;400;500;600;700;800&display=swap" rel="stylesheet">
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
        <h2>Sign in to EasyRead</h2>
        <p>Unlock custom explanation profiles, interactive deep dives, bookmarks, and ask personalized questions.</p>
        <div class="login-modal-buttons">
          <a href="/#profile" class="login-btn-primary">Sign In</a>
        </div>
      </div>
    </div>
  </div>

  <div class="full-screen-reader">
    ${buildHeaderHTML(userCredits, user_id)}
    ${buildHeroHTML(title, article.categories)}
    ${buildProfilePillsHTML(profiles, defaultExplanation?.profile_id || 1)}
    ${buildGradientCardHTML(activeProfile)}
    ${buildLoginCalloutBannerHTML(user_id)}
    ${buildArticleContentHTML(article, explanations)}
    ${buildSummaryHTML(article, defaultExplanation)}
    ${buildInlineDeepDivesSectionHTML(deepDives, activeProfile, user_id)}
    ${buildMetadataHTML(article, defaultExplanation, readingTime)}
    ${buildFooterHTML(article, user_id, isBookmarked)}
    ${buildReviewModalHTML(userRating)}
  </div>

  <script>
    ${getJavaScript(article, explanations, profiles, deepDives, userRating, user_id, sessionToken, isBookmarked, userCredits)}
  </script>
</body>
</html>`;

  return html;
}

// ============================================
// CLEAN REDESIGNED HEADER
// ============================================

function buildHeaderHTML(userCredits, user_id) {
  return `    <header class="reader-header">
      <div class="header-left">
        <a href="/" class="brand-link">Easy<span>Read</span></a>
        <span class="header-divider">/</span>
        <span class="header-breadcrumb">Article</span>
      </div>
      <div class="header-right">
        <div class="credits-badge" id="userCreditsBadge" style="${user_id ? 'display: inline-flex;' : 'display: none;'}" title="Credits Balance">
          <span class="lightning-icon">⚡</span>
          <span class="credits-val" id="creditsValueDisplay">${(userCredits !== null && userCredits !== undefined ? userCredits : 0).toFixed(1)}</span>
        </div>
      </div>
    </header>\n`;
}

function buildLoginCalloutBannerHTML(user_id) {
  return `    <div class="guest-login-card" id="guestLoginCard" style="${user_id ? 'display: none;' : 'display: flex;'}">
      <div class="guest-card-icon">⚡</div>
      <div class="guest-card-content">
        <h4>Sign in to unlock full features</h4>
        <p>Unlock custom explanation personas, interactive deep dives, bookmarks, and earn bonus read credits.</p>
      </div>
      <a href="/#profile" class="guest-signin-btn">Sign In</a>
    </div>\n`;
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
  if (!profiles || profiles.length === 0) return '';

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

// ============================================
// INLINE DEEP DIVES & QUESTIONS SECTION
// ============================================

function buildInlineDeepDivesSectionHTML(deepDives, activeProfile, user_id) {
  let itemsHtml = '';
  if (Array.isArray(deepDives) && deepDives.length > 0) {
    deepDives.forEach(dd => {
      itemsHtml += `
        <div class="deep-dive-card">
          <div class="deep-dive-q">
            <span class="q-badge">Q</span>
            <h4>${escapeHtml(dd.question)}</h4>
          </div>
          <div class="deep-dive-a">
            ${renderMarkdownToHtml(dd.answer)}
          </div>
        </div>
      `;
    });
  }

  return `    <section class="deep-dives-section" id="deepDivesSection">
      <div class="section-title-row">
        <h3>Explore Further & Deep Dives</h3>
        <span class="persona-tag" id="deepDivePersonaBadge">${escapeHtml(activeProfile?.name || 'Everyday')}</span>
      </div>

      <div class="deep-dives-list" id="deepDivesList">
        ${itemsHtml}
      </div>

      <div class="deep-dive-ask-card">
        <form id="inlineDeepDiveForm" onsubmit="submitInlineDeepDive(event)">
          <textarea id="inlineDeepDiveInput" placeholder="Ask any specific question about this topic..." rows="2" required></textarea>
          <div class="ask-card-footer">
            <span class="cost-hint">⚡ 0.5 Credits</span>
            <button type="submit" class="ask-submit-btn" id="inlineAskBtn">
              Ask Question
            </button>
          </div>
        </form>
      </div>
    </section>\n`;
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
  return `    <div class="glass-footer">
      <div class="footer-content">
        <div class="link-pill" title="${escapeHtml(article.source_url || '')}">
          <span>🔗 ${escapeHtml(article.source_domain || 'easytoread.vercel.app')}</span>
        </div>
        <div class="glass-actions">
          <button class="glass-icon-btn" onclick="copyArticleLink()" title="Copy link" aria-label="Copy link">
            <svg viewBox="0 0 24 24"><path d="M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z"/></svg>
          </button>
          <button class="glass-icon-btn bookmark-btn ${isBookmarked ? 'bookmarked' : ''}" id="bookmarkBtn" onclick="handleBookmark()" title="Bookmark" aria-label="Bookmark">
            <svg viewBox="0 0 24 24"><path d="${isBookmarked ? 'M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z' : 'M17 3H7c-1.1 0-2 .9-2 2v16l7-3 7 3V5c0-1.1-.9-2-2-2z'}"/></svg>
          </button>
          <button class="glass-icon-btn rate-btn" onclick="openReview()" title="Rate Explanation" aria-label="Rate article">
            <svg viewBox="0 0 24 24"><path d="M12 17.27L18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z"/></svg>
          </button>
        </div>
      </div>
    </div>\n`;
}

function buildReviewModalHTML(userRating) {
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
        <div class="modal-actions">
          <button class="btn-modal-secondary" onclick="closeReview()">Cancel</button>
          <button class="btn-modal-primary" onclick="submitReview()">Submit</button>
        </div>
      </div>
    </div>\n`;
}

// ============================================
// CLIENT JAVASCRIPT GENERATOR
// ============================================

function getJavaScript(article, explanations, profiles, deepDives, userRating, user_id, sessionToken, isBookmarked, userCredits) {
  const activeExp = explanations?.find(e => e.profile_id === 1) || explanations?.[0];

  return `
let currentCredits = ${userCredits || 0};
let currentViewId = ${activeExp?.view_id || 'null'};
let currentProfileId = ${activeExp?.profile_id || 1};
const currentArticleId = ${article.article_id};
const currentArticleSlug = "${escapeJs(article.slug || '')}";
let isAuthenticated = ${!!user_id};
let isBookmarked = ${isBookmarked};
let userId = "${escapeJs(user_id || '')}";
let sessionToken = "${escapeJs(sessionToken || '')}";

const explanationsData = ${JSON.stringify(explanations || [])};
const profilesData = ${JSON.stringify(profiles || [])};

function syncClientAuthState() {
  const localLoggedIn = localStorage.getItem('easyread-logged-in') === 'true';
  const localUserId = localStorage.getItem('easyread_user_id');
  const localSessionToken = localStorage.getItem('easyread_session_token');
  const localCredits = parseFloat(localStorage.getItem('easyread-credits'));

  if (localLoggedIn && localUserId) {
    isAuthenticated = true;
    userId = localUserId;
    sessionToken = localSessionToken || '';
    if (!isNaN(localCredits)) currentCredits = localCredits;

    const guestCard = document.getElementById('guestLoginCard');
    if (guestCard) guestCard.style.display = 'none';

    const creditsBadge = document.getElementById('userCreditsBadge');
    if (creditsBadge) {
      creditsBadge.style.display = 'inline-flex';
      const display = document.getElementById('creditsValueDisplay');
      if (display) display.textContent = currentCredits.toFixed(1);
    }
  }
}

syncClientAuthState();

function showToast(message, type) {
  type = type || 'info';
  const toast = document.getElementById('toast');
  if (!toast) return;
  toast.textContent = message;
  toast.className = 'toast show toast-' + type;
  clearTimeout(toast._timeout);
  toast._timeout = setTimeout(() => toast.classList.remove('show'), 2500);
}

window.copyArticleLink = function() {
  const canonicalUrl = window.location.origin + '/article/' + (currentArticleSlug || currentArticleId);
  navigator.clipboard.writeText(canonicalUrl).then(() => {
    showToast('Article link copied to clipboard!', 'success');
  }).catch(() => {
    showToast('Failed to copy link', 'error');
  });
};

window.showLoginModal = function() {
  const overlay = document.getElementById('loginOverlay');
  if (overlay) overlay.classList.add('active');
};

window.closeLoginModal = function() {
  const overlay = document.getElementById('loginOverlay');
  if (overlay) overlay.classList.remove('active');
};

window.openReview = function() {
  if (!isAuthenticated) {
    showLoginModal();
    return;
  }
  const modal = document.getElementById('reviewModal');
  if (modal) modal.classList.add('active');
};

window.closeReview = function() {
  const modal = document.getElementById('reviewModal');
  if (modal) modal.classList.remove('active');
};

window.updateRatingFeedback = function(rating) {
  const ratingDesc = document.getElementById('ratingDesc');
  const map = {
    1: 'Needs clearer analogies',
    2: 'A bit confusing',
    3: 'Average explanation',
    4: 'Clear and insightful',
    5: 'Brilliant explanation!'
  };
  if (ratingDesc) ratingDesc.textContent = map[rating] || 'Select your reaction';
};

window.submitReview = async function() {
  const selected = document.querySelector('input[name="rating"]:checked');
  if (!selected) {
    showToast('Please select a rating', 'error');
    return;
  }
  const rating = parseInt(selected.value);

  try {
    const response = await fetch('/api/view?action=rate', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-user-id': userId,
        'x-session-token': sessionToken
      },
      body: JSON.stringify({ view_id: currentViewId, rating: rating })
    });
    const data = await response.json();
    if (response.status === 201) {
      showToast('Rating submitted! +0.2 Credits', 'success');
      if (data.bonus_earned) {
        currentCredits += data.bonus_earned;
        localStorage.setItem('easyread-credits', currentCredits.toString());
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

// ============================================
// NON-BLOCKING INLINE DEEP DIVE SUBMISSION
// ============================================
window.submitInlineDeepDive = async function(e) {
  e.preventDefault();
  if (!isAuthenticated) {
    showLoginModal();
    return;
  }

  const input = document.getElementById('inlineDeepDiveInput');
  const question = input?.value.trim();
  if (!question || question.length < 4) {
    showToast('Please enter a specific question', 'error');
    return;
  }

  input.value = '';

  const list = document.getElementById('deepDivesList');
  const cardId = 'dd-card-' + Date.now();
  
  // Create cut-out card with live shimmer state
  const newCard = document.createElement('div');
  newCard.className = 'deep-dive-card loading-card';
  newCard.id = cardId;
  newCard.innerHTML = \`
    <div class="deep-dive-q">
      <span class="q-badge">Q</span>
      <h4>\${escapeHtml(question)}</h4>
    </div>
    <div class="deep-dive-a" id="\${cardId}-answer">
      <div class="inline-shimmer-box">
        <div class="shimmer-line line-1"></div>
        <div class="shimmer-line line-2"></div>
        <div class="shimmer-line line-3"></div>
      </div>
    </div>
  \`;

  list.appendChild(newCard);

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
    const answerContainer = document.getElementById(cardId + '-answer');
    
    if (data.success && data.deep_dive) {
      newCard.classList.remove('loading-card');
      answerContainer.innerHTML = renderMarkdownClient(data.deep_dive.answer || 'Answer generated.');
      showToast('Deep dive ready!', 'success');

      currentCredits = Math.max(0, currentCredits - 0.5);
      localStorage.setItem('easyread-credits', currentCredits.toString());
      const display = document.getElementById('creditsValueDisplay');
      if (display) display.textContent = currentCredits.toFixed(1);
    } else {
      answerContainer.innerHTML = '<p class="error-text">' + (data.error || 'Failed to generate answer') + '</p>';
    }
  } catch (err) {
    const answerContainer = document.getElementById(cardId + '-answer');
    if (answerContainer) {
      answerContainer.innerHTML = '<p class="error-text">Network error generating answer. Please try again.</p>';
    }
  }
};

window.switchProfile = function(profileId, buttonElem) {
  document.querySelectorAll('.profile-pill').forEach(p => p.classList.remove('active'));
  buttonElem.classList.add('active');

  currentProfileId = profileId;
  const profile = profilesData.find(p => p.profile_id === profileId);
  const explanation = explanationsData.find(e => e.profile_id === profileId);

  const cardBadge = document.getElementById('cardProfileBadge');
  const cardText = document.getElementById('catchLineText');
  const ddBadge = document.getElementById('deepDivePersonaBadge');

  if (profile) {
    if (cardBadge) cardBadge.textContent = profile.name + ' Perspective';
    if (cardText) cardText.textContent = '"' + (profile.description || 'Simplified analysis.') + '"';
    if (ddBadge) ddBadge.textContent = profile.name;
  }

  const textElem = document.getElementById('articleText');
  const shimmerElem = document.getElementById('contentShimmer');

  if (textElem) textElem.style.display = 'none';
  if (shimmerElem) shimmerElem.style.display = 'block';

  setTimeout(() => {
    if (shimmerElem) shimmerElem.style.display = 'none';
    if (textElem) {
      if (explanation) {
        currentViewId = explanation.view_id;
        textElem.innerHTML = renderMarkdownClient(explanation.content);
        textElem.style.display = 'block';
      } else {
        textElem.innerHTML = '<div class="no-explanation-box"><p>No explanation generated for this profile yet.</p>' +
          (isAuthenticated ? '<button onclick="generateExplanation(' + profileId + ')" class="btn-modal-primary" style="margin-top:12px;">Generate Now</button>' : '<a href="/#profile" class="guest-signin-btn" style="margin-top:12px;display:inline-block;">Sign in to generate</a>') + '</div>';
        textElem.style.display = 'block';
      }
    }
  }, 200);
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
      setTimeout(() => window.location.reload(), 500);
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

function escapeHtml(text) {
  if (!text) return '';
  return String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
}

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
:root{--bg-color:#f6f7f9;--bg-glow:radial-gradient(circle at 50% 0%,rgba(255,255,255,0.9) 0%,transparent 70%);--text-main:#1c1c1e;--text-secondary:#5c5c60;--text-muted:#8e8e93;--border-color:rgba(0,0,0,0.1);--border-subtle:rgba(0,0,0,0.06);--card-bg:rgba(242,242,247,0.8);--card-blur:blur(16px);--input-bg:rgba(0,0,0,0.04);--shadow-color:rgba(0,0,0,0.04);--glass-border:1.5px solid rgba(0,0,0,0.1);--glass-border-subtle:1px solid rgba(0,0,0,0.06);--glass-shadow:0 8px 24px rgba(0,0,0,0.04);--accent-color:#f59847;--accent-hover:#e08735;--accent-glow:rgba(245,152,71,0.15);--icon-color:#5c5c60;--gradient-color-1:#ffd3b6;--gradient-color-2:#ffaaa5;--gradient-color-3:#f59847;--gradient-color-4:#d4e5f7}
@media(prefers-color-scheme:dark){:root{--bg-color:#000000;--bg-glow:radial-gradient(circle at 50% 0%,rgba(40,40,42,0.4) 0%,transparent 60%);--text-main:#e8e8ea;--text-secondary:#9a9a9e;--text-muted:#6c6c70;--border-color:#2a2a2a;--border-subtle:rgba(255,255,255,0.06);--card-bg:rgba(18,18,18,0.9);--card-blur:blur(16px);--input-bg:#181818;--shadow-color:rgba(0,0,0,0.8);--glass-border:1px solid rgba(255,255,255,0.08);--glass-border-subtle:1px solid rgba(255,255,255,0.04);--glass-shadow:0 8px 32px rgba(0,0,0,0.6);--accent-color:#f59847;--accent-hover:#e08735;--icon-color:#9aa0a6;--gradient-color-1:#1f130f;--gradient-color-2:#30170a;--gradient-color-3:#c49a45;--gradient-color-4:#12161f}}
*{margin:0;padding:0;box-sizing:border-box}
body{background-color:var(--bg-color);background-image:var(--bg-glow);background-repeat:no-repeat;background-size:100% 100%;color:var(--text-main);font-family:'Plus Jakarta Sans',-apple-system,BlinkMacSystemFont,sans-serif;min-height:100vh;width:100%;display:flex;justify-content:center;padding:1.5rem 1.25rem 5.5rem 1.25rem;transition:background 0.3s ease}
.full-screen-reader{max-width:680px;width:100%}
.progress-bar{position:fixed;top:0;left:0;height:3px;background:var(--accent-color);width:0%;z-index:100;transition:width 0.1s linear}
.reader-header{display:flex;align-items:center;justify-content:space-between;margin-bottom:1.5rem;padding-bottom:0.8rem;border-bottom:1px solid var(--border-subtle)}
.header-left{display:flex;align-items:center;gap:8px}
.brand-link{font-weight:800;color:var(--text-main);text-decoration:none;font-size:1.1rem;letter-spacing:-0.5px}
.brand-link span{color:var(--accent-color)}
.header-divider{color:var(--text-muted);font-size:0.9rem}
.header-breadcrumb{font-size:0.85rem;color:var(--text-secondary);font-weight:600}
.header-right{display:flex;align-items:center;gap:8px}
.credits-badge{display:inline-flex;align-items:center;gap:5px;background:var(--card-bg);backdrop-filter:var(--card-blur);border:var(--glass-border-subtle);border-radius:20px;padding:0.35rem 0.75rem;font-size:0.78rem;font-weight:700}
.lightning-icon{color:var(--accent-color)}
.guest-login-card{display:flex;align-items:center;gap:14px;background:var(--card-bg);backdrop-filter:var(--card-blur);border:var(--glass-border);border-radius:18px;padding:14px 18px;margin-bottom:1.8rem;box-shadow:var(--glass-shadow)}
.guest-card-icon{font-size:1.4rem;color:var(--accent-color);flex-shrink:0}
.guest-card-content{flex:1}
.guest-card-content h4{font-size:0.88rem;font-weight:700;color:var(--text-main);margin-bottom:2px}
.guest-card-content p{font-size:0.75rem;color:var(--text-secondary);line-height:1.4;margin:0}
.guest-signin-btn{background:var(--accent-color);color:#fff;text-decoration:none;font-size:0.78rem;font-weight:700;padding:7px 14px;border-radius:12px;white-space:nowrap;transition:background 0.2s}
.guest-signin-btn:hover{background:var(--accent-hover)}
.category-tags-list{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:0.6rem}
.category-tag{font-size:0.72rem;text-transform:uppercase;letter-spacing:0.8px;color:var(--accent-color);font-weight:700;background:rgba(245,152,71,0.12);padding:0.2rem 0.6rem;border-radius:10px}
.hero-title{font-size:1.9rem;font-weight:800;line-height:1.25;margin-bottom:1.2rem;color:var(--text-main);letter-spacing:-0.5px}
.profile-pills-wrapper{margin-bottom:1.2rem;overflow:hidden}
.profile-pills-scroll{display:flex;gap:6px;overflow-x:auto;padding-bottom:4px;scrollbar-width:none}
.profile-pills-scroll::-webkit-scrollbar{display:none}
.profile-pill{flex:0 0 auto;background:var(--card-bg);backdrop-filter:var(--card-blur);border:var(--glass-border-subtle);border-radius:24px;padding:0.45rem 0.95rem;font-size:0.8rem;font-weight:600;color:var(--text-secondary);cursor:pointer;transition:all 0.2s ease;display:inline-flex;align-items:center;gap:6px}
.profile-pill svg{width:14px;height:14px;fill:currentColor}
.profile-pill:hover{color:var(--text-main);background:var(--input-bg)}
.profile-pill.active{background:var(--accent-color);color:#fff;border-color:var(--accent-color)}
.featured-gradient-card{width:100%;min-height:130px;position:relative;border-radius:18px;overflow:hidden;border:var(--glass-border-subtle);background:linear-gradient(-45deg,var(--gradient-color-1),var(--gradient-color-2),var(--gradient-color-3),var(--gradient-color-4));background-size:300% 300%;animation:gradientShift 15s ease infinite;display:flex;align-items:center;justify-content:center;padding:1.4rem;margin-bottom:1.5rem}
@keyframes gradientShift{0%{background-position:0% 50%}50%{background-position:100% 50%}100%{background-position:0% 50%}}
.gradient-card-overlay{position:absolute;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.2)}
.catch-line-content{position:relative;z-index:2;text-align:center;max-width:520px}
.profile-badge-small{display:inline-block;font-size:0.68rem;font-weight:700;color:rgba(255,255,255,0.9);text-transform:uppercase;letter-spacing:1px;margin-bottom:0.35rem;background:rgba(0,0,0,0.25);padding:0.15rem 0.6rem;border-radius:14px}
.catch-line-text{font-size:1.15rem;font-weight:700;line-height:1.4;color:#fff;text-shadow:0 2px 8px rgba(0,0,0,0.3)}
.article-body p{font-size:1.02rem;line-height:1.7;color:var(--text-secondary);margin-bottom:1.25rem}
.subheading{font-size:1.35rem;font-weight:700;color:var(--text-main);margin-top:1.8rem;margin-bottom:0.8rem;letter-spacing:-0.3px}
.subheading-h3{font-size:1.15rem;font-weight:600;color:var(--text-main);margin-top:1.4rem;margin-bottom:0.6rem}
.content-list{padding-left:1.4rem;margin-bottom:1.25rem;color:var(--text-secondary);line-height:1.7}
.summary-wrapper{margin-top:2rem;margin-bottom:1.5rem}
.summary-content{background:var(--card-bg);backdrop-filter:var(--card-blur);border-radius:16px;padding:1.25rem;border:var(--glass-border-subtle)}
.summary-content h4{font-size:0.75rem;text-transform:uppercase;letter-spacing:1px;color:var(--accent-color);margin-bottom:0.4rem;font-weight:700}
.summary-content p{font-size:0.95rem;line-height:1.55;color:var(--text-secondary);margin:0}

/* INLINE DEEP DIVES */
.deep-dives-section{margin-top:2.2rem;margin-bottom:1.8rem}
.section-title-row{display:flex;align-items:center;justify-content:space-between;margin-bottom:1rem}
.section-title-row h3{font-size:1.05rem;font-weight:700;color:var(--text-main)}
.persona-tag{font-size:0.7rem;font-weight:700;background:rgba(245,152,71,0.12);color:var(--accent-color);padding:0.2rem 0.6rem;border-radius:10px;text-transform:uppercase}
.deep-dives-list{display:flex;flex-direction:column;gap:12px;margin-bottom:1rem}
.deep-dive-card{background:var(--card-bg);backdrop-filter:var(--card-blur);border:var(--glass-border-subtle);border-radius:16px;padding:16px 18px;box-shadow:var(--glass-shadow);animation:fadeInUp 0.3s ease forwards}
@keyframes fadeInUp{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}}
.deep-dive-q{display:flex;align-items:flex-start;gap:10px;margin-bottom:8px}
.q-badge{width:22px;height:22px;border-radius:6px;background:var(--accent-color);color:#fff;font-size:0.72rem;font-weight:800;display:flex;align-items:center;justify-content:center;flex-shrink:0;margin-top:1px}
.deep-dive-q h4{font-size:0.95rem;font-weight:700;color:var(--text-main);line-height:1.4}
.deep-dive-a{font-size:0.9rem;line-height:1.6;color:var(--text-secondary);padding-left:32px}
.deep-dive-ask-card{background:var(--card-bg);backdrop-filter:var(--card-blur);border:var(--glass-border);border-radius:16px;padding:14px 16px;box-shadow:var(--glass-shadow)}
.deep-dive-ask-card textarea{width:100%;background:var(--input-bg);border:var(--glass-border-subtle);border-radius:12px;padding:10px 12px;color:var(--text-main);font-family:inherit;font-size:0.88rem;resize:none;outline:none;line-height:1.4}
.ask-card-footer{display:flex;align-items:center;justify-content:space-between;margin-top:8px}
.cost-hint{font-size:0.75rem;font-weight:700;color:var(--accent-color)}
.ask-submit-btn{background:var(--accent-color);color:#fff;border:none;padding:6px 14px;border-radius:12px;font-size:0.78rem;font-weight:700;cursor:pointer;transition:background 0.2s}
.ask-submit-btn:hover{background:var(--accent-hover)}
.inline-shimmer-box{display:flex;flex-direction:column;gap:6px;padding:6px 0}
.shimmer-line{height:10px;border-radius:4px;background:rgba(0,0,0,0.05);position:relative;overflow:hidden}
@media(prefers-color-scheme:dark){.shimmer-line{background:rgba(255,255,255,0.06)}}
.shimmer-line::after{position:absolute;top:0;right:0;bottom:0;left:0;transform:translateX(-100%);background-image:linear-gradient(90deg,rgba(255,255,255,0) 0%,rgba(255,255,255,0.15) 50%,rgba(255,255,255,0) 100%);animation:shimmerSwipe 1.5s infinite;content:''}
@keyframes shimmerSwipe{100%{transform:translateX(100%)}}
.shimmer-line.line-1{width:90%}
.shimmer-line.line-2{width:75%}
.shimmer-line.line-3{width:60%}
.error-text{color:#ff3b30;font-size:0.85rem}

.article-metadata{display:flex;align-items:center;justify-content:space-between;margin:1.2rem 0 1.8rem;padding:0.8rem 0;border-top:1px solid var(--border-subtle);border-bottom:1px solid var(--border-subtle);font-size:0.78rem;color:var(--text-muted);flex-wrap:wrap;gap:8px}
.meta-left,.meta-right{display:flex;align-items:center;gap:6px}
.source-badge{font-weight:600;color:var(--text-main)}
.glass-footer{position:fixed;bottom:16px;left:50%;transform:translateX(-50%);width:92%;max-width:640px;background:var(--card-bg);backdrop-filter:blur(20px);border:var(--glass-border);border-radius:20px;padding:0.6rem 1rem;box-shadow:var(--glass-shadow);z-index:100}
.footer-content{display:flex;align-items:center;justify-content:space-between;gap:8px}
.link-pill{background:var(--input-bg);border:var(--glass-border-subtle);border-radius:20px;padding:0.3rem 0.75rem;font-size:0.75rem;color:var(--text-secondary);max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.glass-actions{display:flex;align-items:center;gap:6px}
.glass-icon-btn{background:var(--input-bg);border:var(--glass-border-subtle);border-radius:50%;width:34px;height:34px;display:flex;align-items:center;justify-content:center;cursor:pointer;color:var(--icon-color);transition:all 0.2s}
.glass-icon-btn svg{width:16px;height:16px;fill:currentColor}
.glass-icon-btn:hover{background:var(--accent-color);color:#fff;border-color:var(--accent-color)}
.glass-icon-btn.bookmarked{color:var(--accent-color);background:rgba(245,152,71,0.15)}
.toast{position:fixed;bottom:80px;left:50%;transform:translateX(-50%) translateY(40px);background:var(--card-bg);backdrop-filter:var(--card-blur);border:var(--glass-border);border-radius:12px;padding:8px 16px;color:var(--text-main);font-size:0.82rem;box-shadow:var(--glass-shadow);z-index:2000;opacity:0;transition:all 0.3s ease;pointer-events:none;font-weight:600}
.toast.show{opacity:1;transform:translateX(-50%) translateY(0)}
.login-overlay,.review-overlay{position:fixed;top:0;left:0;width:100vw;height:100vh;background:rgba(0,0,0,0.4);backdrop-filter:blur(16px);display:none;align-items:center;justify-content:center;z-index:1000;padding:1.2rem;opacity:0;transition:opacity 0.2s}
.login-overlay.active,.review-overlay.active{display:flex;opacity:1}
.login-modal,.review-modal{background:var(--card-bg);backdrop-filter:var(--card-blur);border:var(--glass-border);border-radius:20px;padding:24px 20px;max-width:380px;width:100%;position:relative;text-align:center}
.modal-close,.login-close{position:absolute;top:14px;right:14px;background:transparent;border:none;font-size:1.1rem;color:var(--text-muted);cursor:pointer}
.btn-modal-primary{background:var(--accent-color);color:#fff;border:none;padding:0.65rem 1.4rem;border-radius:24px;font-weight:700;font-size:0.85rem;cursor:pointer;text-decoration:none;display:inline-block}
.btn-modal-primary:hover{background:var(--accent-hover)}
.btn-modal-secondary{background:transparent;border:var(--glass-border-subtle);color:var(--text-secondary);padding:0.65rem 1.4rem;border-radius:24px;font-weight:700;font-size:0.85rem;cursor:pointer}
.modal-actions{display:flex;gap:8px;justify-content:center;margin-top:1.2rem}
.rating-scale{display:flex;gap:8px;justify-content:center;margin:1.2rem 0 0.4rem}
.rating-scale label{font-size:1.8rem;cursor:pointer;opacity:0.5;transition:transform 0.2s}
.rating-scale input{display:none}
.rating-scale input:checked+label,.rating-scale label:hover{opacity:1;transform:scale(1.15)}
.rating-description{font-size:0.8rem;color:var(--accent-color);font-weight:600;margin-bottom:0.8rem}
`;
}

// ============================================
// ERROR / NOT FOUND PAGES
// ============================================

function renderNotFoundPage() {
  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><title>Article Not Found | EasyRead</title><link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@600;800&display=swap" rel="stylesheet"><style>body{font-family:'Plus Jakarta Sans',sans-serif;background:#f6f7f9;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;padding:20px;text-align:center}h1{font-size:2.5rem;color:#f59847}p{color:#5c5c60;margin:0.8rem 0 1.5rem}a{background:#f59847;color:#fff;padding:10px 20px;border-radius:20px;text-decoration:none;font-weight:700}</style></head><body><div><h1>404</h1><p>Article not found.</p><a href="/">Return Home</a></div></body></html>`;
}

function renderErrorPage(message) {
  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><title>Error | EasyRead</title><link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@600;800&display=swap" rel="stylesheet"><style>body{font-family:'Plus Jakarta Sans',sans-serif;background:#f6f7f9;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;padding:20px;text-align:center}h1{font-size:2rem;color:#ff3b30}p{color:#5c5c60;margin:0.8rem 0 1.5rem}a{background:#f59847;color:#fff;padding:10px 20px;border-radius:20px;text-decoration:none;font-weight:700}</style></head><body><div><h1>Unable to Load</h1><p>${escapeHtml(message || 'An error occurred.')}</p><a href="/">Return Home</a></div></body></html>`;
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