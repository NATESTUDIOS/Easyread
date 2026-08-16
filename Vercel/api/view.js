// api/view.js
// EasyRead Article View - Full article viewer with accordions, markdown formatting, bookmarks, and deep dives

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

const GUEST_LIMITS = {
  ARTICLES_PER_DAY: 30,
  QUESTIONS_PER_DAY: 2,
  HAS_DEEP_DIVE_ACCESS: false,
  HAS_CONTEXT_ACCESS: false
};

const CREDIT_COSTS = {
  ASK_QUESTION: 1,
  DEEP_DIVE: 0.5,
  CONTEXT_SUBMIT: 1,
  MAKE_PRIVATE: 2,
  RATING_BONUS: 0.2
};

// ============================================
// COLOR GRADIENTS FOR HERO CARD
// ============================================
const HERO_GRADIENTS = [
  'linear-gradient(135deg, #1e293b, #0f172a)',
  'linear-gradient(135deg, #2c1a1a, #1a1a2e)',
  'linear-gradient(135deg, #1b2838, #101820)',
  'linear-gradient(135deg, #1e3a2a, #0f2017)',
  'linear-gradient(135deg, #2d1b2e, #170d18)',
  'linear-gradient(135deg, #2a2015, #140f0a)'
];

function getGradientForArticle(id) {
  const index = Math.abs(parseInt(id, 10) || 0) % HERO_GRADIENTS.length;
  return HERO_GRADIENTS[index];
}

// ============================================
// GUEST TRACKING
// ============================================
function hashIP(ip) {
  return crypto.createHash('sha256').update(ip + (process.env.IP_SALT || 'easyread-salt')).digest('hex');
}

function getGuestIdentifier(req) {
  const forwarded = req.headers['x-forwarded-for'];
  const ip = forwarded ? forwarded.split(',')[0].trim() : req.socket?.remoteAddress || '127.0.0.1';
  const userAgent = req.headers['user-agent'] || '';
  return hashIP(`${ip}:${userAgent}`);
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
    return res.status(200).end();
  }

  const { method } = req;
  const { action, id, slug } = req.query;

  try {
    switch (method) {
      case 'GET':
        if (id || slug) {
          if (action === 'data') return await getArticleData(req, res);
          return await renderArticlePage(req, res);
        }
        if (action === 'bookmark-status') return await getBookmarkStatus(req, res);
        return res.status(200).send(renderNoArticlePage());
      case 'POST':
        if (action === 'rate') return await submitRating(req, res);
        if (action === 'deep-dive') return await handleDeepDive(req, res);
        if (action === 'bookmark') return await toggleBookmark(req, res);
        return res.status(400).json({ error: 'Invalid action' });
      case 'DELETE':
        if (action === 'bookmark') return await removeBookmark(req, res);
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
// RENDER ARTICLE PAGE
// ============================================
async function renderArticlePage(req, res) {
  const { id, slug } = req.query;
  const user_id = req.headers['x-user-id'] || req.query.user_id;
  const sessionToken = req.headers['x-session-token'] || req.query.session_token;

  try {
    let article;
    if (id) {
      article = await getById('articles', id);
    } else if (slug) {
      const articles = await getByColumn('articles', 'slug', slug);
      article = articles[0] || null;
    }

    if (!article) return res.status(404).send(renderNotFoundPage());

    // Increment views
    const viewCount = (article.view_count || 0) + 1;
    await supabase.from('articles').update({ view_count: viewCount }).eq('article_id', article.article_id);
    article.view_count = viewCount;

    // Fetch explanations
    const { data: explanations } = await supabase
      .from('explanation_views')
      .select(`view_id, title, content, summary, profile_id, view_count, rating_avg, rating_count, profiles:profile_id (profile_id, name, description)`)
      .eq('article_id', article.article_id)
      .order('view_count', { ascending: false });

    // Fetch deep dives
    const { data: deepDives } = await supabase
      .from('deep_dives')
      .select('*')
      .eq('article_id', article.article_id)
      .order('created_at', { ascending: true });

    let userRating = null;
    let isBookmarked = false;
    let userCredits = null;

    if (user_id) {
      const { data: ur } = await supabase
        .from('ratings')
        .select('rating, feedback, view_id')
        .eq('user_id', user_id)
        .in('view_id', explanations?.map(e => e.view_id) || [])
        .maybeSingle();
      userRating = ur;

      const { data: bm } = await supabase
        .from('bookmarks')
        .select('bookmark_id')
        .eq('user_id', user_id)
        .eq('article_id', article.article_id)
        .maybeSingle();
      isBookmarked = !!bm;

      const users = await getByColumn('users', 'user_id', user_id);
      if (users.length > 0) userCredits = users[0].credits;
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
      isBookmarked
    });

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.status(200).send(html);
  } catch (err) {
    return res.status(500).send(renderErrorPage(err.message));
  }
}

// ============================================
// DATA & RATING API ENDPOINTS
// ============================================
async function getArticleData(req, res) {
  const { id, slug } = req.query;
  try {
    let article = id ? await getById('articles', id) : (await getByColumn('articles', 'slug', slug))[0];
    if (!article) return res.status(404).json({ error: 'Article not found' });

    const { data: explanations } = await supabase
      .from('explanation_views')
      .select(`*`)
      .eq('article_id', article.article_id);

    return res.json({ success: true, article, explanations: explanations || [] });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

async function toggleBookmark(req, res) {
  const { article_id } = req.body;
  const user_id = req.headers['x-user-id'] || req.query.user_id;
  if (!user_id) return res.status(401).json({ error: 'Authentication required' });

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
      return res.status(201).json({ success: true, bookmarked: true, bookmark, message: 'Article bookmarked' });
    }
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

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

    if (existing) await deleteRecord('bookmarks', existing.bookmark_id);
    return res.json({ success: true, message: 'Bookmark removed' });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

async function getBookmarkStatus(req, res) {
  const { article_id } = req.query;
  const user_id = req.headers['x-user-id'] || req.query.user_id;
  if (!user_id) return res.json({ isBookmarked: false, isAuthenticated: false });

  try {
    const { data: bm } = await supabase
      .from('bookmarks')
      .select('bookmark_id')
      .eq('user_id', user_id)
      .eq('article_id', parseInt(article_id))
      .maybeSingle();

    return res.json({ isBookmarked: !!bm, isAuthenticated: true });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

async function submitRating(req, res) {
  const { view_id, rating, feedback } = req.body;
  const user_id = req.headers['x-user-id'] || req.query.user_id;
  if (!user_id) return res.status(401).json({ error: 'Authentication required' });

  try {
    // Check if user already rated
    const { data: existing } = await supabase
      .from('ratings')
      .select('rating_id')
      .eq('user_id', user_id)
      .eq('view_id', parseInt(view_id))
      .maybeSingle();

    if (existing) {
      return res.status(409).json({ error: 'You have already rated this explanation.' });
    }

    await insert('ratings', {
      user_id,
      view_id: parseInt(view_id),
      rating,
      feedback: feedback || null,
      created_at: new Date().toISOString()
    });

    const { data: viewData } = await supabase
      .from('explanation_views')
      .select('rating_avg, rating_count')
      .eq('view_id', view_id)
      .single();

    const newCount = (viewData?.rating_count || 0) + 1;
    const newAvg = ((viewData?.rating_avg || 0) * (viewData?.rating_count || 0) + rating) / newCount;

    await supabase.from('explanation_views').update({
      rating_avg: Math.round(newAvg * 100) / 100,
      rating_count: newCount
    }).eq('view_id', view_id);

    const users = await getByColumn('users', 'user_id', user_id);
    if (users.length > 0) {
      await supabase.from('users').update({ credits: users[0].credits + CREDIT_COSTS.RATING_BONUS }).eq('user_id', user_id);
    }

    return res.status(201).json({ success: true, bonus_earned: CREDIT_COSTS.RATING_BONUS });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

async function handleDeepDive(req, res) {
  const { article_id, profile_id, question } = req.body;
  const user_id = req.headers['x-user-id'] || req.query.user_id;
  if (!user_id) return res.status(401).json({ error: 'Authentication required' });

  try {
    const response = await fetch(`${PROCESSOR_URL}/generate-deep-dive`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-admin-key': ADMIN_API_KEY },
      body: JSON.stringify({
        article_id: parseInt(article_id),
        profile_id: parseInt(profile_id),
        question,
        parent_section: 'General',
        user_id
      })
    });
    const data = await response.json();
    return res.json(data);
  } catch (err) {
    return res.status(500).json({ error: err.message });
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
  isBookmarked
}) {
  const title = article.canonical_title || 'Untitled Article';
  const defaultExplanation = explanations?.find(e => e.profile_id === 1) || explanations?.[0];
  const activeProfile = profiles?.find(p => p.profile_id === (defaultExplanation?.profile_id || 1)) || profiles?.[0];
  const readingTime = calculateReadingTime(defaultExplanation?.content || article.base_content);
  const heroGradient = getGradientForArticle(article.article_id);

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=yes, viewport-fit=cover">
  <title>${escapeHtml(title)} | EasyRead</title>
  <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@300;400;500;600;700;800&display=swap" rel="stylesheet">
  <style>${getCSSStyles()}</style>
</head>
<body>
  <div class="progress-bar" id="progressBar"></div>
  <div class="toast" id="toast"></div>

  <!-- Login Modal -->
  <div class="login-overlay" id="loginOverlay">
    <div class="login-modal">
      <button class="modal-close" onclick="closeLoginModal()">✕</button>
      <h3>Sign in to EasyRead</h3>
      <p>Unlock custom explanation personas, interactive deep dives, bookmarks, and ask questions.</p>
      <div style="margin-top: 18px;">
        <a href="/#profile" class="btn-primary">Sign In</a>
      </div>
    </div>
  </div>

  <div class="full-screen-reader">
    <!-- Header -->
    <header class="reader-header">
      <div class="header-left">
        <a href="/" class="brand-link">Easy<span>Read</span></a>
        <span class="header-divider">/</span>
        <span class="header-breadcrumb">Article</span>
      </div>
      <div class="header-right">
        <div class="credits-badge" id="userCreditsBadge" style="${user_id ? 'display: inline-flex;' : 'display: none;'}" title="Credits Balance">
          <span class="lightning-icon">⚡</span>
          <span class="credits-val" id="creditsValueDisplay">${(userCredits || 0).toFixed(1)}</span>
        </div>
      </div>
    </header>

    <!-- Categories & Title -->
    <div class="hero-section">
      <div class="category-tags-list">
        ${(article.categories || ['General']).map(cat => `<span class="category-tag">${escapeHtml(cat)}</span>`).join('')}
      </div>
      <h1 class="hero-title">${escapeHtml(title)}</h1>
    </div>

    <!-- Profile Pills -->
    <div class="profile-pills-wrapper">
      <div class="profile-pills-scroll" id="profilePills">
        ${profiles.map(p => {
          const isActive = p.profile_id === (defaultExplanation?.profile_id || 1);
          return `<button class="profile-pill ${isActive ? 'active' : ''}" data-profile-id="${p.profile_id}" onclick="switchProfile(${p.profile_id}, this)">
            ${getProfileIcon(p.name)}
            <span>${escapeHtml(p.name)}</span>
          </button>`;
        }).join('')}
      </div>
    </div>

    <!-- Simulated Hero Card with Gradient Overlay & Heading -->
    <div class="featured-hero-card" id="featuredHeroCard" style="background: ${heroGradient};">
      <div class="hero-overlay"></div>
      <div class="hero-card-content">
        <span class="hero-badge" id="heroPerspectiveBadge">${escapeHtml(activeProfile?.name || 'Everyday')} Perspective</span>
        <h2 class="hero-card-heading" id="heroCardHeading">${escapeHtml(title)}</h2>
      </div>
    </div>

    <!-- Sign In Notice Banner (Outside Header) -->
    <div class="guest-login-card" id="guestLoginCard" style="${user_id ? 'display: none;' : 'display: flex;'}">
      <div class="guest-card-icon">⚡</div>
      <div class="guest-card-content">
        <h4>Sign in to unlock full features</h4>
        <p>Unlock custom explanation personas, interactive deep dives, bookmarks, and earn bonus read credits.</p>
      </div>
      <a href="/#profile" class="guest-signin-btn">Sign In</a>
    </div>

    <!-- Article Body with Collapsible Accordions -->
    <article class="article-body" id="articleContent">
      <div class="content-shimmer" id="contentShimmer" style="display: none;">
        <div class="shimmer-line line-1"></div>
        <div class="shimmer-line line-2"></div>
        <div class="shimmer-line line-3"></div>
        <div class="shimmer-line line-4"></div>
      </div>
      <div id="articleText">
        ${renderParsedExplanationToHtml(defaultExplanation?.content || article.base_content || '')}
      </div>
    </article>

    <!-- Key Takeaway -->
    ${buildSummaryHTML(article, defaultExplanation)}

    <!-- Inline Deep Dives & Questions Section -->
    <section class="deep-dives-section">
      <div class="section-title-row">
        <h3>Explore Further & Deep Dives</h3>
        <span class="persona-tag" id="deepDivePersonaBadge">${escapeHtml(activeProfile?.name || 'Everyday')}</span>
      </div>

      <div class="deep-dives-list" id="deepDivesList">
        ${deepDives.map(dd => `
          <div class="deep-dive-card">
            <div class="deep-dive-q">
              <span class="q-badge">Q</span>
              <h4>${escapeHtml(dd.question)}</h4>
            </div>
            <div class="deep-dive-a">
              ${renderMarkdownText(dd.answer)}
            </div>
          </div>
        `).join('')}
      </div>

      <div class="deep-dive-ask-card">
        <form id="inlineDeepDiveForm" onsubmit="submitInlineDeepDive(event)">
          <textarea id="inlineDeepDiveInput" placeholder="Ask any question about this topic..." rows="2" required></textarea>
          <div class="ask-card-footer">
            <span class="cost-hint">⚡ 0.5 Credits</span>
            <button type="submit" class="ask-submit-btn">Ask Question</button>
          </div>
        </form>
      </div>
    </section>

    <!-- Metadata -->
    <div class="article-metadata">
      <div class="meta-left">
        <span class="source-badge">Source: ${escapeHtml(article.source_domain || 'EasyRead')}</span>
        <span>·</span>
        <span>${article.created_at ? new Date(article.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : 'Recently'}</span>
      </div>
      <div class="meta-right">
        <span>⏱️ ${readingTime} min read</span>
        <span>·</span>
        <span>👁️ ${article.view_count || 0} views</span>
      </div>
    </div>

    <!-- Floating Glass Footer -->
    <div class="glass-footer">
      <div class="footer-content">
        <div class="link-pill" title="${escapeHtml(article.source_url || '')}">
          <span>🔗 ${escapeHtml(article.source_domain || 'easytoread.vercel.app')}</span>
        </div>
        <div class="glass-actions">
          <button class="glass-icon-btn" onclick="copyCanonicalArticleLink()" title="Copy link" aria-label="Copy link">
            <svg viewBox="0 0 24 24"><path d="M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z"/></svg>
          </button>
          <button class="glass-icon-btn bookmark-btn ${isBookmarked ? 'bookmarked' : ''}" id="bookmarkBtn" onclick="handleBookmarkToggle()" title="Bookmark" aria-label="Bookmark">
            <svg viewBox="0 0 24 24"><path d="${isBookmarked ? 'M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z' : 'M17 3H7c-1.1 0-2 .9-2 2v16l7-3 7 3V5c0-1.1-.9-2-2-2z'}"/></svg>
          </button>
          <button class="glass-icon-btn rate-btn ${userRating ? 'rated' : ''}" id="rateBtn" onclick="openRatingModal()" title="Rate Explanation" aria-label="Rate article">
            <svg viewBox="0 0 24 24"><path d="M12 17.27L18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z"/></svg>
          </button>
        </div>
      </div>
    </div>

    <!-- Rating Modal -->
    <div class="review-overlay" id="reviewModal">
      <div class="review-modal">
        <button class="modal-close" onclick="closeRatingModal()">✕</button>
        <div id="ratingModalContent">
          ${userRating ? `
            <div class="review-submitted-state">
              <div style="font-size: 2rem; margin-bottom: 8px;">⭐</div>
              <h3>Rating Recorded</h3>
              <p>You rated this explanation ${userRating.rating} / 5 stars.</p>
              <button class="btn-primary" style="margin-top: 14px;" onclick="closeRatingModal()">Done</button>
            </div>
          ` : `
            <div class="bonus-incentive-pill"><span>⚡</span> +0.2 Credit Reward</div>
            <h3>Rate this Explanation</h3>
            <p class="sub-text">How clear and intuitive was this version?</p>
            <div class="rating-scale">
              <input type="radio" id="mRate1" name="rating" value="1"><label for="mRate1" title="Confusing">😣</label>
              <input type="radio" id="mRate2" name="rating" value="2"><label for="mRate2" title="Unclear">😕</label>
              <input type="radio" id="mRate3" name="rating" value="3"><label for="mRate3" title="Average">😐</label>
              <input type="radio" id="mRate4" name="rating" value="4"><label for="mRate4" title="Clear">🙂</label>
              <input type="radio" id="mRate5" name="rating" value="5"><label for="mRate5" title="Insightful">🤯</label>
            </div>
            <div class="modal-actions">
              <button class="btn-secondary" onclick="closeRatingModal()">Cancel</button>
              <button class="btn-primary" onclick="submitUserRating()">Submit</button>
            </div>
          `}
        </div>
      </div>
    </div>
  </div>

  <script>
    ${getJavaScript(article, explanations, profiles, deepDives, userRating, user_id, sessionToken, isBookmarked, userCredits)}
  </script>
</body>
</html>`;
}

function buildSummaryHTML(article, defaultExplanation) {
  const summary = defaultExplanation?.summary || article.summary;
  if (!summary) return '';

  return `    <div class="summary-wrapper">
      <div class="summary-content">
        <h4>Key Takeaway</h4>
        <p>${renderMarkdownText(summary)}</p>
      </div>
    </div>\n`;
}

// ============================================
// PARSER & COLLAPSIBLE ACCORDION BUILDER
// ============================================
function renderParsedExplanationToHtml(rawText) {
  if (!rawText) return '<p>No content available.</p>';

  // Clean raw quotes
  let text = rawText.trim();
  if (text.startsWith('"') && text.endsWith('"')) {
    text = text.substring(1, text.length - 1).trim();
  }

  // Split into raw blocks by double newlines
  const blocks = text.split(/\n\s*\n/);
  const sections = [];
  let currentSection = { heading: null, content: [] };

  blocks.forEach((block, index) => {
    const trimmed = block.trim();
    if (!trimmed) return;

    // Check if block starts with heading or question
    const isHeading = trimmed.startsWith('#') || 
                      (/^[A-Z][\w\s,:—–-]+\?$/.test(trimmed) && trimmed.length < 90) ||
                      (/^[A-Z][\w\s]+:\s+[A-Za-z0-9\s]+$/.test(trimmed) && trimmed.length < 80);

    if (isHeading) {
      if (currentSection.content.length > 0 || currentSection.heading) {
        sections.push(currentSection);
      }
      currentSection = {
        heading: trimmed.replace(/^#+\s*/, ''),
        content: []
      };
    } else {
      currentSection.content.push(trimmed);
    }
  });

  if (currentSection.content.length > 0 || currentSection.heading) {
    sections.push(currentSection);
  }

  let html = '';

  sections.forEach((sec, idx) => {
    const isFirst = idx === 0;
    const bodyHtml = sec.content.map(c => formatParagraphOrList(c)).join('');

    if (isFirst) {
      html += `
        <div class="explanation-section first-section">
          ${sec.heading ? `<h2 class="subheading">${escapeHtml(sec.heading)}</h2>` : ''}
          <div class="section-body">${bodyHtml}</div>
        </div>
      `;
    } else {
      html += `
        <div class="accordion-section collapsed" id="acc-sec-${idx}">
          <div class="accordion-header" onclick="toggleSectionAccordion('acc-sec-${idx}')">
            <h3 class="accordion-title">${escapeHtml(sec.heading || `Section ${idx + 1}`)}</h3>
            <span class="accordion-chevron">▾</span>
          </div>
          <div class="accordion-body">
            ${bodyHtml}
          </div>
        </div>
      `;
    }
  });

  return html;
}

function formatParagraphOrList(textBlock) {
  const lines = textBlock.split('\n').map(l => l.trim()).filter(Boolean);
  
  // Check if it's a list
  const isList = lines.every(l => l.startsWith('- ') || l.startsWith('* ') || /^\*\*[^*]+\*\*\s*—/.test(l));

  if (isList) {
    const listItems = lines.map(line => {
      const formatted = renderMarkdownText(line.replace(/^[-*]\s*/, ''));
      return `<li>${formatted}</li>`;
    }).join('');
    return `<ul class="content-list">${listItems}</ul>`;
  }

  return `<p>${renderMarkdownText(textBlock)}</p>`;
}

function renderMarkdownText(text) {
  if (!text) return '';
  return escapeHtml(text)
    .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.*?)\*/g, '<em>$1</em>')
    .replace(/__(.*?)__/g, '<u>$1</u>')
    .replace(/\n/g, '<br/>');
}

// ============================================
// CLIENT JAVASCRIPT
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
let hasUserRated = ${!!userRating};
let userId = "${escapeJs(user_id || '')}";
let sessionToken = "${escapeJs(sessionToken || '')}";

const explanationsData = ${JSON.stringify(explanations || [])};
const profilesData = ${JSON.stringify(profiles || [])};

function syncClientState() {
  const localLoggedIn = localStorage.getItem('easyread-logged-in') === 'true';
  const localUserId = localStorage.getItem('easyread_user_id');
  const localToken = localStorage.getItem('easyread_session_token');
  const localCredits = parseFloat(localStorage.getItem('easyread-credits'));

  if (localLoggedIn && localUserId) {
    isAuthenticated = true;
    userId = localUserId;
    sessionToken = localToken || '';
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

syncClientState();

window.toggleSectionAccordion = function(id) {
  const sec = document.getElementById(id);
  if (sec) sec.classList.toggle('collapsed');
};

function showToast(msg, type = 'info') {
  const t = document.getElementById('toast');
  if (!t) return;
  t.textContent = msg;
  t.className = 'toast show';
  clearTimeout(t._timeout);
  t._timeout = setTimeout(() => t.classList.remove('show'), 2400);
}

window.copyCanonicalArticleLink = function() {
  const canonicalUrl = window.location.origin + '/article/' + (currentArticleSlug || currentArticleId);
  navigator.clipboard.writeText(canonicalUrl).then(() => {
    showToast('Article link copied to clipboard!');
  }).catch(() => {
    showToast('Failed to copy link');
  });
};

window.showLoginModal = function() {
  const modal = document.getElementById('loginOverlay');
  if (modal) modal.classList.add('active');
};

window.closeLoginModal = function() {
  const modal = document.getElementById('loginOverlay');
  if (modal) modal.classList.remove('active');
};

window.openRatingModal = function() {
  if (!isAuthenticated) {
    showLoginModal();
    return;
  }
  const modal = document.getElementById('reviewModal');
  if (modal) modal.classList.add('active');
};

window.closeRatingModal = function() {
  const modal = document.getElementById('reviewModal');
  if (modal) modal.classList.remove('active');
};

window.submitUserRating = async function() {
  if (hasUserRated) {
    showToast('You have already rated this explanation.');
    return;
  }
  const selected = document.querySelector('input[name="rating"]:checked');
  if (!selected) {
    showToast('Please select an emoji to rate');
    return;
  }
  const rating = parseInt(selected.value);

  try {
    const res = await fetch('/api/view?action=rate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-user-id': userId, 'x-session-token': sessionToken },
      body: JSON.stringify({ view_id: currentViewId, rating: rating })
    });
    const data = await res.json();
    if (res.status === 201) {
      hasUserRated = true;
      showToast('Rating submitted! +0.2 Credits');
      document.getElementById('rateBtn')?.classList.add('rated');
      document.getElementById('ratingModalContent').innerHTML = '<div class="review-submitted-state"><div style="font-size:2rem;margin-bottom:8px;">⭐</div><h3>Thank You!</h3><p>Your rating was recorded.</p><button class="btn-primary" style="margin-top:14px;" onclick="closeRatingModal()">Done</button></div>';
      if (data.bonus_earned) {
        currentCredits += data.bonus_earned;
        localStorage.setItem('easyread-credits', currentCredits.toString());
        const display = document.getElementById('creditsValueDisplay');
        if (display) display.textContent = currentCredits.toFixed(1);
      }
    } else {
      showToast(data.error || 'Failed to submit rating');
    }
  } catch (err) {
    showToast('Network error submitting rating');
  }
};

window.handleBookmarkToggle = async function() {
  if (!isAuthenticated) {
    showLoginModal();
    return;
  }
  try {
    const res = await fetch('/api/view?action=bookmark', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-user-id': userId, 'x-session-token': sessionToken },
      body: JSON.stringify({ article_id: currentArticleId })
    });
    const data = await res.json();
    if (data.success) {
      isBookmarked = data.bookmarked;
      const btn = document.getElementById('bookmarkBtn');
      if (btn) {
        btn.classList.toggle('bookmarked', isBookmarked);
        btn.innerHTML = '<svg viewBox="0 0 24 24"><path d="' + (isBookmarked ? 'M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z' : 'M17 3H7c-1.1 0-2 .9-2 2v16l7-3 7 3V5c0-1.1-.9-2-2-2z') + '"/></svg>';
      }
      showToast(data.message);
    }
  } catch (err) {
    showToast('Error updating bookmark');
  }
};

window.switchProfile = function(profileId, btnElem) {
  document.querySelectorAll('.profile-pill').forEach(p => p.classList.remove('active'));
  btnElem.classList.add('active');

  currentProfileId = profileId;
  const profile = profilesData.find(p => p.profile_id === profileId);
  const explanation = explanationsData.find(e => e.profile_id === profileId);

  const badge = document.getElementById('heroPerspectiveBadge');
  const ddBadge = document.getElementById('deepDivePersonaBadge');
  if (profile) {
    if (badge) badge.textContent = profile.name + ' Perspective';
    if (ddBadge) ddBadge.textContent = profile.name;
  }

  const textElem = document.getElementById('articleText');
  const shimmer = document.getElementById('contentShimmer');

  if (textElem) textElem.style.display = 'none';
  if (shimmer) shimmer.style.display = 'block';

  setTimeout(() => {
    if (shimmer) shimmer.style.display = 'none';
    if (textElem) {
      if (explanation) {
        currentViewId = explanation.view_id;
        textElem.innerHTML = renderClientExplanationHtml(explanation.content);
        textElem.style.display = 'block';
      } else {
        textElem.innerHTML = '<div class="no-explanation-box"><p>No tailored explanation generated for this profile yet.</p>' +
          (isAuthenticated ? '<button onclick="generateExplanation(' + profileId + ')" class="btn-primary" style="margin-top:12px;">Generate Now</button>' : '<a href="/#profile" class="guest-signin-btn" style="margin-top:12px;display:inline-block;">Sign in to generate</a>') + '</div>';
        textElem.style.display = 'block';
      }
    }
  }, 220);
};

window.generateExplanation = async function(profileId) {
  if (!isAuthenticated) {
    showLoginModal();
    return;
  }
  showToast('Generating tailored explanation...');
  try {
    const res = await fetch('/api/explanation?action=generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-user-id': userId, 'x-session-token': sessionToken },
      body: JSON.stringify({ article_id: currentArticleId, profile_id: profileId, force: false })
    });
    const data = await res.json();
    if (data.success) {
      showToast('Explanation ready!');
      setTimeout(() => window.location.reload(), 400);
    } else {
      showToast(data.error || 'Failed to generate explanation');
    }
  } catch (err) {
    showToast('Error connecting to explanation engine');
  }
};

window.submitInlineDeepDive = async function(e) {
  e.preventDefault();
  if (!isAuthenticated) {
    showLoginModal();
    return;
  }

  const input = document.getElementById('inlineDeepDiveInput');
  const question = input?.value.trim();
  if (!question || question.length < 4) {
    showToast('Please enter a specific question');
    return;
  }

  input.value = '';
  const list = document.getElementById('deepDivesList');
  const cardId = 'dd-' + Date.now();

  const card = document.createElement('div');
  card.className = 'deep-dive-card';
  card.id = cardId;
  card.innerHTML = \`
    <div class="deep-dive-q">
      <span class="q-badge">Q</span>
      <h4>\${escapeHtml(question)}</h4>
    </div>
    <div class="deep-dive-a" id="\${cardId}-ans">
      <div class="inline-shimmer-box">
        <div class="shimmer-line line-1"></div>
        <div class="shimmer-line line-2"></div>
        <div class="shimmer-line line-3"></div>
      </div>
    </div>
  \`;

  list.appendChild(card);

  try {
    const res = await fetch('/api/view?action=deep-dive', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-user-id': userId, 'x-session-token': sessionToken },
      body: JSON.stringify({ article_id: currentArticleId, profile_id: currentProfileId, question })
    });
    const data = await res.json();
    const ansContainer = document.getElementById(cardId + '-ans');

    if (data.success && data.deep_dive) {
      ansContainer.innerHTML = formatMarkdownClient(data.deep_dive.answer || 'Answer generated.');
      showToast('Deep dive ready!');
      currentCredits = Math.max(0, currentCredits - 0.5);
      localStorage.setItem('easyread-credits', currentCredits.toString());
      const display = document.getElementById('creditsValueDisplay');
      if (display) display.textContent = currentCredits.toFixed(1);
    } else {
      ansContainer.innerHTML = '<p style="color:#ff3b30;">' + (data.error || 'Failed to generate deep dive') + '</p>';
    }
  } catch (err) {
    const ansContainer = document.getElementById(cardId + '-ans');
    if (ansContainer) ansContainer.innerHTML = '<p style="color:#ff3b30;">Network error generating answer.</p>';
  }
};

function renderClientExplanationHtml(content) {
  if (!content) return '<p>No content available.</p>';
  return formatMarkdownClient(content);
}

function formatMarkdownClient(text) {
  if (!text) return '';
  return escapeHtml(text)
    .replace(/\\*\\*(.*?)\\*\\*/g, '<strong>$1</strong>')
    .replace(/\\*(.*?)\\*/g, '<em>$1</em>')
    .replace(/\\n\\n/g, '</p><p>')
    .replace(/\\n/g, '<br/>');
}

function escapeHtml(t) {
  if (!t) return '';
  return String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

window.addEventListener('scroll', () => {
  const scrollTop = window.scrollY;
  const docHeight = document.documentElement.scrollHeight - window.innerHeight;
  const bar = document.getElementById('progressBar');
  if (bar && docHeight > 0) bar.style.width = ((scrollTop / docHeight) * 100) + '%';
});
`;
}

// ============================================
// UTILITY FUNCTIONS
// ============================================
function calculateReadingTime(content) {
  if (!content) return 1;
  const words = content.trim().split(/\s+/).length;
  return Math.max(1, Math.ceil(words / 200));
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
  return String(text).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/'/g, "\\'").replace(/\n/g, '\\n');
}

function getProfileIcon(name) {
  return '<svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93z"/></svg>';
}

function renderNotFoundPage() {
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Not Found</title><link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@700&display=swap" rel="stylesheet"><style>body{font-family:'Plus Jakarta Sans',sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;text-align:center;background:#f6f7f9;margin:0;}h1{font-size:2rem;color:#1c1c1e;}a{color:#f59847;font-weight:700;text-decoration:none;}</style></head><body><div><h1>Article Not Found</h1><p><a href="/">Return to Home</a></p></div></body></html>`;
}

function renderErrorPage(msg) {
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Error</title><link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@700&display=swap" rel="stylesheet"><style>body{font-family:'Plus Jakarta Sans',sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;text-align:center;background:#f6f7f9;margin:0;}h1{font-size:2rem;color:#ff3b30;}p{color:#5c5c60;}</style></head><body><div><h1>Unable to Load Article</h1><p>${escapeHtml(msg)}</p></div></body></html>`;
}

function renderNoArticlePage() {
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>No Article</title><link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@700&display=swap" rel="stylesheet"><style>body{font-family:'Plus Jakarta Sans',sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;text-align:center;background:#f6f7f9;margin:0;}h1{font-size:1.8rem;color:#1c1c1e;}a{background:#f59847;color:#fff;padding:8px 18px;border-radius:18px;text-decoration:none;font-weight:700;}</style></head><body><div><h1>No Article Selected</h1><p style="margin-bottom:1.5rem;color:#5c5c60;">Select an article from the feed to start reading.</p><a href="/">Go to Home</a></div></body></html>`;
}

// ============================================
// STYLES
// ============================================
function getCSSStyles() {
  return `
:root{--bg-color:#f6f7f9;--text-main:#1c1c1e;--text-secondary:#5c5c60;--text-muted:#8e8e93;--card-bg:rgba(242,242,247,0.85);--card-blur:blur(16px);--glass-border:1.5px solid rgba(0,0,0,0.1);--glass-border-subtle:1px solid rgba(0,0,0,0.06);--glass-shadow:0 6px 20px rgba(0,0,0,0.04);--accent-color:#f59847;--accent-hover:#e08735;--input-bg:rgba(0,0,0,0.04)}
@media(prefers-color-scheme:dark){:root{--bg-color:#000000;--text-main:#e8e8ea;--text-secondary:#9a9a9e;--text-muted:#6c6c70;--card-bg:rgba(20,20,22,0.85);--glass-border:1px solid rgba(255,255,255,0.08);--glass-border-subtle:1px solid rgba(255,255,255,0.04);--glass-shadow:0 6px 24px rgba(0,0,0,0.5);--input-bg:rgba(255,255,255,0.06)}}
*{margin:0;padding:0;box-sizing:border-box}
body{background-color:var(--bg-color);color:var(--text-main);font-family:'Plus Jakarta Sans',sans-serif;min-height:100vh;display:flex;justify-content:center;padding:1.4rem 1rem 5.5rem 1rem;transition:background 0.3s ease}
.full-screen-reader{max-width:640px;width:100%}
.progress-bar{position:fixed;top:0;left:0;height:3px;background:var(--accent-color);width:0%;z-index:100;transition:width 0.1s linear}
.reader-header{display:flex;align-items:center;justify-content:space-between;margin-bottom:1.2rem;padding-bottom:0.75rem;border-bottom:1px solid var(--glass-border-subtle)}
.header-left{display:flex;align-items:center;gap:6px}
.brand-link{font-weight:800;color:var(--text-main);text-decoration:none;font-size:1.05rem;letter-spacing:-0.5px}
.brand-link span{color:var(--accent-color)}
.header-divider{color:var(--text-muted);font-size:0.85rem}
.header-breadcrumb{font-size:0.8rem;color:var(--text-secondary);font-weight:600}
.credits-badge{display:inline-flex;align-items:center;gap:4px;background:var(--card-bg);backdrop-filter:var(--card-blur);border:var(--glass-border-subtle);border-radius:16px;padding:0.3rem 0.65rem;font-size:0.75rem;font-weight:700}
.lightning-icon{color:var(--accent-color)}
.category-tags-list{display:flex;gap:5px;flex-wrap:wrap;margin-bottom:0.5rem}
.category-tag{font-size:0.68rem;text-transform:uppercase;letter-spacing:0.8px;color:var(--accent-color);font-weight:700;background:rgba(245,152,71,0.12);padding:0.2rem 0.55rem;border-radius:10px}
.hero-title{font-size:1.75rem;font-weight:800;line-height:1.25;margin-bottom:1rem;color:var(--text-main);letter-spacing:-0.5px}
.profile-pills-wrapper{margin-bottom:1rem;overflow:hidden}
.profile-pills-scroll{display:flex;gap:6px;overflow-x:auto;padding-bottom:4px;scrollbar-width:none}
.profile-pills-scroll::-webkit-scrollbar{display:none}
.profile-pill{flex:0 0 auto;background:var(--card-bg);backdrop-filter:var(--card-blur);border:var(--glass-border-subtle);border-radius:20px;padding:0.4rem 0.85rem;font-size:0.76rem;font-weight:600;color:var(--text-secondary);cursor:pointer;display:inline-flex;align-items:center;gap:5px;transition:all 0.2s}
.profile-pill.active{background:var(--accent-color);color:#fff;border-color:var(--accent-color)}
.featured-hero-card{width:100%;min-height:115px;position:relative;border-radius:16px;overflow:hidden;border:var(--glass-border-subtle);display:flex;align-items:center;padding:1.25rem;margin-bottom:1.25rem}
.hero-overlay{position:absolute;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.35);backdrop-filter:blur(2px)}
.hero-card-content{position:relative;z-index:2;width:100%}
.hero-badge{display:inline-block;font-size:0.65rem;font-weight:700;color:#fff;text-transform:uppercase;letter-spacing:0.8px;background:rgba(0,0,0,0.3);padding:0.15rem 0.55rem;border-radius:12px;margin-bottom:0.3rem}
.hero-card-heading{font-size:1.15rem;font-weight:700;color:#fff;line-height:1.35;text-shadow:0 1px 4px rgba(0,0,0,0.4)}
.guest-login-card{display:flex;align-items:center;gap:12px;background:var(--card-bg);backdrop-filter:var(--card-blur);border:var(--glass-border);border-radius:16px;padding:12px 16px;margin-bottom:1.5rem;box-shadow:var(--glass-shadow)}
.guest-card-icon{font-size:1.3rem;color:var(--accent-color);flex-shrink:0}
.guest-card-content flex:1;
.guest-card-content h4{font-size:0.85rem;font-weight:700;color:var(--text-main);margin-bottom:2px}
.guest-card-content p{font-size:0.72rem;color:var(--text-secondary);line-height:1.35;margin:0}
.guest-signin-btn{background:var(--accent-color);color:#fff;text-decoration:none;font-size:0.75rem;font-weight:700;padding:6px 12px;border-radius:10px;white-space:nowrap}
.article-body p{font-size:0.95rem;line-height:1.68;color:var(--text-secondary);margin-bottom:1rem}
.subheading{font-size:1.25rem;font-weight:700;color:var(--text-main);margin-bottom:0.6rem}
.content-list{padding-left:1.3rem;margin-bottom:1rem;color:var(--text-secondary);line-height:1.65;font-size:0.92rem}
.content-list li{margin-bottom:0.4rem}

/* ACCORDIONS */
.accordion-section{background:var(--card-bg);backdrop-filter:var(--card-blur);border:var(--glass-border-subtle);border-radius:14px;margin-bottom:10px;overflow:hidden;box-shadow:var(--glass-shadow);transition:border-color 0.2s}
.accordion-header{display:flex;align-items:center;justify-content:space-between;padding:12px 16px;cursor:pointer;user-select:none}
.accordion-title{font-size:0.98rem;font-weight:700;color:var(--text-main);line-height:1.35}
.accordion-chevron{font-size:1.1rem;color:var(--text-muted);transition:transform 0.2s}
.accordion-section.collapsed .accordion-chevron{transform:rotate(-90deg)}
.accordion-body{padding:0 16px 14px 16px}
.accordion-section.collapsed .accordion-body{display:none}

.summary-wrapper{margin:1.8rem 0 1.2rem 0}
.summary-content{background:var(--card-bg);backdrop-filter:var(--card-blur);border-radius:14px;padding:14px 16px;border:var(--glass-border-subtle)}
.summary-content h4{font-size:0.72rem;text-transform:uppercase;letter-spacing:1px;color:var(--accent-color);margin-bottom:0.35rem;font-weight:700}
.summary-content p{font-size:0.9rem;line-height:1.55;color:var(--text-secondary);margin:0}

/* DEEP DIVES */
.deep-dives-section{margin-top:2rem;margin-bottom:1.5rem}
.section-title-row{display:flex;align-items:center;justify-content:space-between;margin-bottom:0.8rem}
.section-title-row h3{font-size:1rem;font-weight:700;color:var(--text-main)}
.persona-tag{font-size:0.68rem;font-weight:700;background:rgba(245,152,71,0.12);color:var(--accent-color);padding:0.2rem 0.55rem;border-radius:8px;text-transform:uppercase}
.deep-dives-list{display:flex;flex-direction:column;gap:10px;margin-bottom:1rem}
.deep-dive-card{background:var(--card-bg);backdrop-filter:var(--card-blur);border:var(--glass-border-subtle);border-radius:14px;padding:14px 16px;box-shadow:var(--glass-shadow)}
.deep-dive-q{display:flex;align-items:flex-start;gap:8px;margin-bottom:6px}
.q-badge{width:20px;height:20px;border-radius:6px;background:var(--accent-color);color:#fff;font-size:0.68rem;font-weight:800;display:flex;align-items:center;justify-content:center;flex-shrink:0;margin-top:1px}
.deep-dive-q h4{font-size:0.9rem;font-weight:700;color:var(--text-main);line-height:1.35}
.deep-dive-a{font-size:0.88rem;line-height:1.55;color:var(--text-secondary);padding-left:28px}
.deep-dive-ask-card{background:var(--card-bg);backdrop-filter:var(--card-blur);border:var(--glass-border);border-radius:14px;padding:12px 14px}
.deep-dive-ask-card textarea{width:100%;background:var(--input-bg);border:var(--glass-border-subtle);border-radius:10px;padding:8px 10px;color:var(--text-main);font-family:inherit;font-size:0.85rem;resize:none;outline:none}
.ask-card-footer{display:flex;align-items:center;justify-content:space-between;margin-top:6px}
.cost-hint{font-size:0.72rem;font-weight:700;color:var(--accent-color)}
.ask-submit-btn{background:var(--accent-color);color:#fff;border:none;padding:5px 12px;border-radius:10px;font-size:0.75rem;font-weight:700;cursor:pointer}

/* SHIMMERS */
.shimmer-line{height:10px;border-radius:4px;background:rgba(0,0,0,0.05);position:relative;overflow:hidden;margin-bottom:8px}
@media(prefers-color-scheme:dark){.shimmer-line{background:rgba(255,255,255,0.06)}}
.shimmer-line::after{position:absolute;top:0;right:0;bottom:0;left:0;transform:translateX(-100%);background-image:linear-gradient(90deg,rgba(255,255,255,0) 0%,rgba(255,255,255,0.15) 50%,rgba(255,255,255,0) 100%);animation:shimmerSwipe 1.5s infinite;content:''}
@keyframes shimmerSwipe{100%{transform:translateX(100%)}}
.shimmer-line.line-1{width:90%}
.shimmer-line.line-2{width:75%}
.shimmer-line.line-3{width:60%}
.shimmer-line.line-4{width:80%}

.article-metadata{display:flex;align-items:center;justify-content:space-between;margin:1rem 0 1.5rem;padding:0.75rem 0;border-top:1px solid var(--glass-border-subtle);border-bottom:1px solid var(--glass-border-subtle);font-size:0.75rem;color:var(--text-muted)}
.meta-left,.meta-right{display:flex;align-items:center;gap:6px}
.source-badge{font-weight:600;color:var(--text-main)}
.glass-footer{position:fixed;bottom:14px;left:50%;transform:translateX(-50%);width:92%;max-width:600px;background:var(--card-bg);backdrop-filter:blur(20px);border:var(--glass-border);border-radius:18px;padding:0.5rem 0.85rem;box-shadow:var(--glass-shadow);z-index:100}
.footer-content{display:flex;align-items:center;justify-content:space-between;gap:8px}
.link-pill{background:var(--input-bg);border:var(--glass-border-subtle);border-radius:16px;padding:0.25rem 0.65rem;font-size:0.72rem;color:var(--text-secondary);max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.glass-actions{display:flex;align-items:center;gap:6px}
.glass-icon-btn{background:var(--input-bg);border:var(--glass-border-subtle);border-radius:50%;width:32px;height:32px;display:flex;align-items:center;justify-content:center;cursor:pointer;color:var(--text-secondary);transition:all 0.2s}
.glass-icon-btn svg{width:15px;height:15px;fill:currentColor}
.glass-icon-btn.bookmarked,.glass-icon-btn.rated{color:var(--accent-color);background:rgba(245,152,71,0.15)}
.toast{position:fixed;bottom:70px;left:50%;transform:translateX(-50%) translateY(40px);background:var(--card-bg);backdrop-filter:var(--card-blur);border:var(--glass-border);border-radius:10px;padding:7px 14px;color:var(--text-main);font-size:0.78rem;box-shadow:var(--glass-shadow);z-index:2000;opacity:0;transition:all 0.3s ease;pointer-events:none;font-weight:600}
.toast.show{opacity:1;transform:translateX(-50%) translateY(0)}

.login-overlay,.review-overlay{position:fixed;top:0;left:0;width:100vw;height:100vh;background:rgba(0,0,0,0.4);backdrop-filter:blur(16px);display:none;align-items:center;justify-content:center;z-index:1000;padding:1.2rem;opacity:0;transition:opacity 0.2s}
.login-overlay.active,.review-overlay.active{display:flex;opacity:1}
.login-modal,.review-modal{background:var(--card-bg);backdrop-filter:var(--card-blur);border:var(--glass-border);border-radius:18px;padding:22px 18px;max-width:340px;width:100%;position:relative;text-align:center}
.modal-close{position:absolute;top:12px;right:12px;background:transparent;border:none;font-size:1rem;color:var(--text-muted);cursor:pointer}
.btn-primary{background:var(--accent-color);color:#fff;border:none;padding:0.6rem 1.2rem;border-radius:20px;font-weight:700;font-size:0.8rem;cursor:pointer;text-decoration:none;display:inline-block}
.btn-secondary{background:transparent;border:var(--glass-border-subtle);color:var(--text-secondary);padding:0.6rem 1.2rem;border-radius:20px;font-weight:700;font-size:0.8rem;cursor:pointer}
.modal-actions{display:flex;gap:8px;justify-content:center;margin-top:1rem}
.rating-scale{display:flex;gap:6px;justify-content:center;margin:1rem 0 0.4rem}
.rating-scale label{font-size:1.6rem;cursor:pointer;opacity:0.5;transition:transform 0.2s}
.rating-scale input{display:none}
.rating-scale input:checked+label,.rating-scale label:hover{opacity:1;transform:scale(1.15)}
.bonus-incentive-pill{font-size:0.72rem;font-weight:700;color:var(--accent-color);margin-bottom:0.4rem}
`;
}

export const config = {
  api: {
    bodyParser: {
      sizeLimit: '10mb',
    },
  },
};