// api/view.js
// EasyRead Article View - Full article viewer with dynamic personas, accordions, bookmarks, and deep dives

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
// CONSTANTS & CONFIG
// ============================================
const PROCESSOR_URL = process.env.PROCESSOR_URL || 'https://my-fcm-server.onrender.com/api/processor';
const ADMIN_API_KEY = process.env.ADMIN_API_KEY;
const SITE_URL = process.env.SITE_URL || 'https://easytoread.vercel.app';

const CREDIT_COSTS = {
  ASK_QUESTION: 1,
  DEEP_DIVE: 0.5,
  CONTEXT_SUBMIT: 1,
  MAKE_PRIVATE: 2,
  RATING_BONUS: 0.2
};

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
        return res.status(200).send(renderNotFoundPage('No Article Selected', 'Please select an article from the feed to start reading.'));
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
    return res.status(500).send(renderErrorPage(error.message));
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

    if (!article) {
      return res.status(404).send(renderNotFoundPage('Article Not Found', "The explanation you're looking for doesn't exist, has been removed, or the link is incorrect."));
    }

    // Increment views safely
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
// DATA & ACTION ENDPOINTS
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
      return res.status(201).json({ success: true, bookmarked: true, bookmark, message: 'Article saved to bookmarks' });
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
  const { view_id, rating, feedback, reasons } = req.body;
  const user_id = req.headers['x-user-id'] || req.query.user_id;
  if (!user_id) return res.status(401).json({ error: 'Authentication required' });

  try {
    const { data: existing } = await supabase
      .from('ratings')
      .select('rating_id')
      .eq('user_id', user_id)
      .eq('view_id', parseInt(view_id))
      .maybeSingle();

    if (existing) {
      return res.status(409).json({ error: 'You have already rated this explanation view.' });
    }

    const fullFeedback = [
      Array.isArray(reasons) && reasons.length ? `[Tags: ${reasons.join(', ')}]` : '',
      feedback || ''
    ].filter(Boolean).join(' ');

    await insert('ratings', {
      user_id,
      view_id: parseInt(view_id),
      rating,
      feedback: fullFeedback || null,
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
      await supabase.from('users').update({ credits: (users[0].credits || 0) + CREDIT_COSTS.RATING_BONUS }).eq('user_id', user_id);
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
// HTML BUILDER
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
  const title = article.canonical_title || 'Simplified Article';
  const defaultExplanation = explanations?.find(e => e.profile_id === 1) || explanations?.[0];
  const activeProfile = profiles?.find(p => p.profile_id === (defaultExplanation?.profile_id || 1)) || profiles?.[0];
  const readingTime = calculateReadingTime(defaultExplanation?.content || article.base_content);
  const heroGradient = getGradientForArticle(article.article_id);
  const canonicalUrl = `${SITE_URL}/article/${encodeURIComponent(article.slug || article.article_id)}`;
  const cleanSummary = (defaultExplanation?.summary || article.summary || '').replace(/"/g, '&quot;');

  // Profile partitioning for "+ More" modal
  const VISIBLE_PROFILE_COUNT = 4;
  const visibleProfiles = profiles.slice(0, VISIBLE_PROFILE_COUNT);
  const overflowProfiles = profiles.slice(VISIBLE_PROFILE_COUNT);

  return `<!DOCTYPE html>
<html lang="en" data-theme="dark">
<head>
  <!-- ─── PRIMARY OPTIMIZED META TAGS ─── -->
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=5.0, user-scalable=yes, viewport-fit=cover">
  <meta http-equiv="X-UA-Compatible" content="IE=edge">
  
  <title>${escapeHtml(title)} — EasyRead</title>
  <meta name="description" content="${escapeHtml(cleanSummary || 'Read a simplified explanation tailored for intuitive understanding.')}">
  <meta name="keywords" content="${(article.categories || ['reading', 'learning', 'education', 'AI']).join(', ')}">
  <meta name="author" content="EasyRead">
  <meta name="robots" content="index, follow">
  <link rel="canonical" href="${canonicalUrl}">

  <!-- ─── OPEN GRAPH / FACEBOOK ─── -->
  <meta property="og:type" content="article">
  <meta property="og:url" content="${canonicalUrl}">
  <meta property="og:title" content="${escapeHtml(title)} — EasyRead">
  <meta property="og:description" content="${escapeHtml(cleanSummary || 'Read simplified, clear explanations tailored to your perspective.')}">
  <meta property="og:image" content="${SITE_URL}/icons/og-image.png">
  <meta property="og:site_name" content="EasyRead">

  <!-- ─── TWITTER CARD ─── -->
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="${escapeHtml(title)} — EasyRead">
  <meta name="twitter:description" content="${escapeHtml(cleanSummary || 'Read simplified, clear explanations tailored to your perspective.')}">
  <meta name="twitter:image" content="${SITE_URL}/icons/og-image.png">

  <!-- ─── PWA & THEME ─── -->
  <meta name="theme-color" content="#09090b" media="(prefers-color-scheme: dark)">
  <meta name="theme-color" content="#f6f7f9" media="(prefers-color-scheme: light)">
  <meta name="apple-mobile-web-app-capable" content="yes">
  <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
  <meta name="apple-mobile-web-app-title" content="EasyRead">

  <!-- ─── ICONS ─── -->
  <link rel="icon" type="image/png" sizes="32x32" href="/icons/favicon-32.png">
  <link rel="icon" type="image/png" sizes="16x16" href="/icons/favicon-16.png">
  <link rel="apple-touch-icon" href="/icons/icon-192.png">

  <!-- ─── FONTS ─── -->
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@300;400;500;600;700;800&display=swap" rel="stylesheet">

  <style>${getCSSStyles()}</style>
</head>
<body>
  <!-- Reading Progress Bar -->
  <div class="progress-bar" id="progressBar"></div>
  <div class="toast" id="toast"></div>

  <!-- Sign In Prompt Modal -->
  <div class="modal-overlay" id="loginOverlay">
    <div class="glass-modal">
      <button class="modal-close-btn" onclick="closeLoginModal()">✕</button>
      <div class="modal-icon-badge">
        <svg viewBox="0 0 24 24"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>
      </div>
      <h3>Sign in to EasyRead</h3>
      <p>Unlock custom cognitive personas, generate deep dives, save bookmarks, and earn credit rewards.</p>
      <div class="modal-actions-row">
        <button class="btn btn-secondary" onclick="closeLoginModal()">Dismiss</button>
        <a href="/#profile" class="btn btn-primary">Sign In</a>
      </div>
    </div>
  </div>

  <!-- Persona Selection Modal (When > 4 profiles exist) -->
  <div class="modal-overlay" id="personasModal">
    <div class="glass-modal personas-modal-card">
      <button class="modal-close-btn" onclick="closePersonasModal()">✕</button>
      <div class="modal-icon-badge">
        <svg viewBox="0 0 24 24"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
      </div>
      <h3>All Explanatory Personas</h3>
      <p>Choose how you would like this article's complex ideas to be broken down.</p>
      <div class="personas-grid-list">
        ${profiles.map(p => {
          const isSelected = p.profile_id === (defaultExplanation?.profile_id || 1);
          return `
            <div class="persona-selection-card ${isSelected ? 'selected' : ''}" onclick="selectPersonaFromModal(${p.profile_id})">
              <div class="persona-card-top">
                <div class="persona-badge-icon"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg></div>
                <h4>${escapeHtml(p.name)}</h4>
                ${isSelected ? '<span class="selected-pill">Active</span>' : ''}
              </div>
              <p>${escapeHtml(p.description || 'Simplifies concepts into plain language.')}</p>
            </div>
          `;
        }).join('')}
      </div>
    </div>
  </div>

  <div class="full-screen-reader">
    <!-- Top Header -->
    <header class="reader-header">
      <div class="header-left">
        <a href="/" class="brand-link">Easy<span>Read</span></a>
        <span class="header-divider">/</span>
        <span class="header-breadcrumb">Reader</span>
      </div>
      <div class="header-right">
        <div class="credits-badge" id="userCreditsBadge" style="${user_id ? 'display: inline-flex;' : 'display: none;'}" title="Credits Balance">
          <svg viewBox="0 0 24 24"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>
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

    <!-- Explanation Persona Hub -->
    <div class="persona-hub-wrapper glass-card">
      <div class="persona-hub-header">
        <div class="hub-title-group">
          <svg viewBox="0 0 24 24"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/></svg>
          <div>
            <span class="hub-label">Explanatory Persona</span>
            <span class="hub-subtitle">Tap any perspective below to adapt the explanation to your style</span>
          </div>
        </div>
      </div>

      <div class="persona-pills-row">
        <div class="persona-pills-scroll" id="profilePills">
          ${visibleProfiles.map(p => {
            const isActive = p.profile_id === (defaultExplanation?.profile_id || 1);
            return `
              <button class="persona-pill ${isActive ? 'active' : ''}" data-profile-id="${p.profile_id}" onclick="switchProfile(${p.profile_id}, this)">
                <span>${escapeHtml(p.name)}</span>
              </button>
            `;
          }).join('')}
          ${overflowProfiles.length > 0 ? `
            <button class="persona-pill more-pill" onclick="openPersonasModal()">
              <span>+${overflowProfiles.length} More...</span>
            </button>
          ` : ''}
        </div>
      </div>
    </div>

    <!-- Featured Perspective Hero Banner -->
    <div class="featured-hero-card" id="featuredHeroCard" style="background: ${heroGradient};">
      <div class="hero-overlay"></div>
      <div class="hero-card-content">
        <div class="hero-badge-wrap">
          <span class="hero-badge" id="heroPerspectiveBadge">
            <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>
            ${escapeHtml(activeProfile?.name || 'Everyday')} Perspective
          </span>
        </div>
        <h2 class="hero-card-heading" id="heroCardHeading">${escapeHtml(title)}</h2>
      </div>
    </div>

    <!-- Sign In Callout for Guests -->
    <div class="guest-login-card glass-card" id="guestLoginCard" style="${user_id ? 'display: none;' : 'display: flex;'}">
      <div class="guest-card-icon">
        <svg viewBox="0 0 24 24"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>
      </div>
      <div class="guest-card-content">
        <h4>Sign in to unlock full features</h4>
        <p>Unlock custom explanation personas, interactive deep dives, bookmarks, and earn bonus read credits.</p>
      </div>
      <a href="/#profile" class="guest-signin-btn">Sign In</a>
    </div>

    <!-- Article Content (Collapsible Accordions Engine) -->
    <article class="article-body" id="articleContent">
      <div class="content-skeleton-loader" id="contentSkeleton" style="display: none;">
        <div class="skeleton-card-pulse glass-card">
          <div class="skeleton-line" style="width: 40%; height: 18px; margin-bottom: 14px;"></div>
          <div class="skeleton-line" style="width: 100%;"></div>
          <div class="skeleton-line" style="width: 90%;"></div>
          <div class="skeleton-line" style="width: 75%;"></div>
        </div>
        <div class="skeleton-card-pulse glass-card" style="margin-top: 12px;">
          <div class="skeleton-line" style="width: 55%; height: 16px;"></div>
        </div>
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
        <div class="section-title-group">
          <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>
          <h3>Explore Further & Deep Dives</h3>
        </div>
        <span class="persona-tag" id="deepDivePersonaBadge">${escapeHtml(activeProfile?.name || 'Everyday')}</span>
      </div>

      <div class="deep-dives-list" id="deepDivesList">
        ${deepDives.map((dd, index) => `
          <div class="deep-dive-accordion glass-card collapsed" id="dd-item-${index}">
            <div class="dd-header" onclick="toggleDeepDiveAccordion('dd-item-${index}')">
              <div class="dd-title-row">
                <span class="dd-q-icon"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg></span>
                <h4>${escapeHtml(dd.question)}</h4>
              </div>
              <span class="accordion-chevron"><svg viewBox="0 0 24 24"><polyline points="6 9 12 15 18 9"/></svg></span>
            </div>
            <div class="dd-body">
              <div class="dd-answer-text">${renderMarkdownText(dd.answer)}</div>
            </div>
          </div>
        `).join('')}
      </div>

      <div class="deep-dive-ask-card glass-card">
        <form id="inlineDeepDiveForm" onsubmit="submitInlineDeepDive(event)">
          <textarea id="inlineDeepDiveInput" placeholder="Ask any question about this topic to generate a tailored deep dive..." rows="2" required></textarea>
          <div class="ask-card-footer">
            <span class="cost-hint">
              <svg viewBox="0 0 24 24"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>
              0.5 Credits
            </span>
            <button type="submit" class="ask-submit-btn">Ask Question</button>
          </div>
        </form>
      </div>
    </section>

    <!-- Metadata Row -->
    <div class="article-metadata">
      <div class="meta-item">
        <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>
        <span class="source-badge">${escapeHtml(article.source_domain || 'EasyRead')}</span>
      </div>
      <div class="meta-item">
        <svg viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
        <span>${article.created_at ? new Date(article.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : 'Recently'}</span>
      </div>
      <div class="meta-item">
        <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
        <span>${readingTime} min read</span>
      </div>
      <div class="meta-item">
        <svg viewBox="0 0 24 24"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
        <span>${article.view_count || 0} views</span>
      </div>
    </div>

    <!-- Floating Glass Action Dock (Footer) -->
    <div class="floating-action-dock">
      <div class="dock-content glass-card">
        <a href="${escapeHtml(article.source_url || '#')}" target="_blank" rel="noopener noreferrer" class="dock-source-pill" title="${escapeHtml(article.source_url || '')}">
          <svg viewBox="0 0 24 24"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>
          <span>${escapeHtml(article.source_domain || 'easytoread.vercel.app')}</span>
        </a>

        <div class="dock-actions">
          <button class="dock-icon-btn" onclick="copyCanonicalArticleLink()" title="Share / Copy Link" aria-label="Copy link">
            <svg viewBox="0 0 24 24"><path d="M18 16.08c-.76 0-1.44.3-1.96.77L8.91 12.7c.05-.23.09-.46.09-.7s-.04-.47-.09-.7l7.05-4.11c.54.5 1.25.81 2.04.81 1.66 0 3-1.34 3-3s-1.34-3-3-3-3 1.34-3 3c0 .24.04.47.09.7L8.04 9.81C7.5 9.31 6.79 9 6 9c-1.66 0-3 1.34-3 3s1.34 3 3 3c.79 0 1.5-.31 2.04-.81l7.12 4.16c-.05.21-.08.43-.08.65 0 1.61 1.31 2.92 2.92 2.92s2.92-1.31 2.92-2.92-1.31-2.92-2.92-2.92z"/></svg>
          </button>
          <button class="dock-icon-btn bookmark-btn ${isBookmarked ? 'bookmarked' : ''}" id="bookmarkBtn" onclick="handleBookmarkToggle()" title="Save Bookmark" aria-label="Bookmark">
            <svg viewBox="0 0 24 24"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>
          </button>
          <button class="dock-icon-btn rate-btn ${userRating ? 'rated' : ''}" id="rateBtn" onclick="openRatingModal()" title="Rate Explanation" aria-label="Rate article">
            <svg viewBox="0 0 24 24"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>
          </button>
        </div>
      </div>
    </div>

    <!-- Rating Modal -->
    <div class="modal-overlay" id="reviewModal">
      <div class="glass-modal">
        <button class="modal-close-btn" onclick="closeRatingModal()">✕</button>
        <div id="ratingModalContent">
          ${userRating ? `
            <div class="review-submitted-state">
              <div class="modal-icon-badge" style="background:rgba(245,152,71,0.15);">
                <svg viewBox="0 0 24 24" style="stroke:var(--accent-color);"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>
              </div>
              <h3>Rating Recorded</h3>
              <p>You rated this explanation ${userRating.rating} / 5 stars.</p>
              <button class="btn btn-primary" style="margin-top: 16px; width: 100%;" onclick="closeRatingModal()">Done</button>
            </div>
          ` : `
            <div class="modal-icon-badge">
              <svg viewBox="0 0 24 24"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>
            </div>
            <div class="bonus-incentive-pill">
              <svg viewBox="0 0 24 24"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>
              +0.2 Credit Reward
            </div>
            <h3>Rate this Explanation</h3>
            <p class="sub-text">How clear and intuitive was this version?</p>
            
            <div class="rating-scale">
              <input type="radio" id="mRate1" name="rating" value="1" onchange="handleRatingSelection(1)"><label for="mRate1" title="Confusing">😣</label>
              <input type="radio" id="mRate2" name="rating" value="2" onchange="handleRatingSelection(2)"><label for="mRate2" title="Unclear">😕</label>
              <input type="radio" id="mRate3" name="rating" value="3" onchange="handleRatingSelection(3)"><label for="mRate3" title="Average">😐</label>
              <input type="radio" id="mRate4" name="rating" value="4" onchange="handleRatingSelection(4)"><label for="mRate4" title="Clear">🙂</label>
              <input type="radio" id="mRate5" name="rating" value="5" onchange="handleRatingSelection(5)"><label for="mRate5" title="Insightful">🤯</label>
            </div>

            <!-- Dynamic Low Rating Feedback Section -->
            <div class="low-rating-feedback" id="lowRatingFeedback" style="display: none;">
              <span class="feedback-prompt-label">What could be improved?</span>
              <div class="feedback-chips">
                <label class="chip"><input type="checkbox" name="rateReason" value="Too complicated"><span>Too complex</span></label>
                <label class="chip"><input type="checkbox" name="rateReason" value="Too lengthy"><span>Too long</span></label>
                <label class="chip"><input type="checkbox" name="rateReason" value="Missed key points"><span>Incomplete</span></label>
                <label class="chip"><input type="checkbox" name="rateReason" value="Analogy was confusing"><span>Weak analogy</span></label>
              </div>
              <textarea class="feedback-text" id="ratingFeedbackText" placeholder="Additional thoughts (optional)..." rows="2"></textarea>
            </div>

            <div class="modal-actions-row" style="margin-top: 1.2rem;">
              <button class="btn btn-secondary" onclick="closeRatingModal()">Cancel</button>
              <button class="btn btn-primary" onclick="submitUserRating()">Submit Rating</button>
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

  return `
    <div class="summary-wrapper glass-card">
      <div class="summary-content">
        <div class="summary-header">
          <svg viewBox="0 0 24 24"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>
          <h4>Key Takeaway</h4>
        </div>
        <div class="summary-text">${renderMarkdownText(summary)}</div>
      </div>
    </div>
  `;
}

// ============================================
// PARSER & ACCORDION ENGINES
// ============================================
function renderParsedExplanationToHtml(rawText) {
  if (!rawText) return '<p>No explanation content available.</p>';

  let text = rawText.trim();
  if (text.startsWith('"') && text.endsWith('"')) {
    text = text.substring(1, text.length - 1).trim();
  }

  const blocks = text.split(/\n\s*\n/);
  const sections = [];
  let currentSection = { heading: null, content: [] };

  blocks.forEach((block) => {
    const trimmed = block.trim();
    if (!trimmed) return;

    const isHeading = trimmed.startsWith('#') || 
                      (/^[A-Z0-9][\w\s,:—–-]+\?$/.test(trimmed) && trimmed.length < 90) ||
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
        <div class="accordion-section glass-card collapsed" id="acc-sec-${idx}">
          <div class="accordion-header" onclick="toggleSectionAccordion('acc-sec-${idx}')">
            <h3 class="accordion-title">${escapeHtml(sec.heading || `Part ${idx + 1}`)}</h3>
            <span class="accordion-chevron">
              <svg viewBox="0 0 24 24"><polyline points="6 9 12 15 18 9"/></svg>
            </span>
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
// CLIENT-SIDE JAVASCRIPT
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

// ─── SYNC USER STATE & THEME ───
function syncClientState() {
  const localTheme = localStorage.getItem('easyread-theme') || 'auto';
  if (localTheme === 'dark') document.documentElement.setAttribute('data-theme', 'dark');
  else if (localTheme === 'light') document.documentElement.setAttribute('data-theme', 'light');

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

    // Sync live bookmark status
    fetch('/api/view?action=bookmark-status&article_id=' + currentArticleId, {
      headers: { 'x-user-id': userId }
    })
    .then(r => r.json())
    .then(data => {
      if (data && typeof data.isBookmarked === 'boolean') {
        isBookmarked = data.isBookmarked;
        updateBookmarkUI();
      }
    }).catch(() => {});
  }
}

syncClientState();

// ─── ACCORDIONS ───
window.toggleSectionAccordion = function(id) {
  const sec = document.getElementById(id);
  if (sec) sec.classList.toggle('collapsed');
};

window.toggleDeepDiveAccordion = function(id) {
  const sec = document.getElementById(id);
  if (sec) sec.classList.toggle('collapsed');
};

function showToast(msg) {
  const t = document.getElementById('toast');
  if (!t) return;
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(t._timeout);
  t._timeout = setTimeout(() => t.classList.remove('show'), 2400);
}

window.copyCanonicalArticleLink = function() {
  const canonicalUrl = window.location.origin + '/article/' + (currentArticleSlug || currentArticleId);
  if (navigator.share) {
    navigator.share({
      title: "${escapeJs(article.canonical_title || 'EasyRead Article')}",
      text: "Read this simplified explanation on EasyRead",
      url: canonicalUrl
    }).catch(() => {});
  } else {
    navigator.clipboard.writeText(canonicalUrl).then(() => {
      showToast('Article link copied to clipboard!');
    }).catch(() => {
      showToast('Failed to copy link');
    });
  }
};

// ─── MODALS ───
window.showLoginModal = function() {
  const modal = document.getElementById('loginOverlay');
  if (modal) modal.classList.add('active');
};

window.closeLoginModal = function() {
  const modal = document.getElementById('loginOverlay');
  if (modal) modal.classList.remove('active');
};

window.openPersonasModal = function() {
  const modal = document.getElementById('personasModal');
  if (modal) modal.classList.add('active');
};

window.closePersonasModal = function() {
  const modal = document.getElementById('personasModal');
  if (modal) modal.classList.remove('active');
};

window.selectPersonaFromModal = function(profileId) {
  closePersonasModal();
  const targetPill = document.querySelector('.persona-pill[data-profile-id="' + profileId + '"]');
  switchProfile(profileId, targetPill);
};

// ─── RATING ENGINE & AUTO POPUP ───
let hasShownAutoRating = sessionStorage.getItem('rated_prompt_' + currentArticleId) === 'true';
let autoRatingTimer = null;

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

window.handleRatingSelection = function(rating) {
  const lowRatingBox = document.getElementById('lowRatingFeedback');
  if (lowRatingBox) {
    lowRatingBox.style.display = rating <= 3 ? 'block' : 'none';
  }
};

window.submitUserRating = async function() {
  if (hasUserRated) {
    showToast('You have already rated this explanation.');
    return;
  }
  const selected = document.querySelector('input[name="rating"]:checked');
  if (!selected) {
    showToast('Please choose an emoji rating');
    return;
  }
  const rating = parseInt(selected.value);
  const checkedReasons = Array.from(document.querySelectorAll('input[name="rateReason"]:checked')).map(c => c.value);
  const feedbackText = document.getElementById('ratingFeedbackText')?.value.trim();

  try {
    const res = await fetch('/api/view?action=rate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-user-id': userId, 'x-session-token': sessionToken },
      body: JSON.stringify({
        view_id: currentViewId,
        rating: rating,
        reasons: checkedReasons,
        feedback: feedbackText
      })
    });
    const data = await res.json();
    if (res.status === 201) {
      hasUserRated = true;
      sessionStorage.setItem('rated_prompt_' + currentArticleId, 'true');
      showToast('Rating submitted! +0.2 Credits');
      document.getElementById('rateBtn')?.classList.add('rated');
      document.getElementById('ratingModalContent').innerHTML = \`
        <div class="review-submitted-state">
          <div class="modal-icon-badge" style="background:rgba(245,152,71,0.15);">
            <svg viewBox="0 0 24 24" style="stroke:var(--accent-color);"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>
          </div>
          <h3>Thank You!</h3>
          <p>Your feedback helps improve our explanation algorithms.</p>
          <button class="btn btn-primary" style="margin-top:16px; width:100%;" onclick="closeRatingModal()">Done</button>
        </div>
      \`;
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

// ─── BOOKMARK TOGGLE ───
function updateBookmarkUI() {
  const btn = document.getElementById('bookmarkBtn');
  if (btn) btn.classList.toggle('bookmarked', isBookmarked);
}

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
      updateBookmarkUI();
      showToast(data.message);
    }
  } catch (err) {
    showToast('Error updating bookmark');
  }
};

// ─── PARSE & SWITCH PROFILE (ACCORDIONS PRESERVED) ───
window.switchProfile = function(profileId, btnElem) {
  document.querySelectorAll('.persona-pill').forEach(p => p.classList.remove('active'));
  if (btnElem) btnElem.classList.add('active');

  currentProfileId = profileId;
  const profile = profilesData.find(p => p.profile_id === profileId);
  const explanation = explanationsData.find(e => e.profile_id === profileId);

  const badge = document.getElementById('heroPerspectiveBadge');
  const ddBadge = document.getElementById('deepDivePersonaBadge');
  if (profile) {
    if (badge) badge.innerHTML = '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>' + profile.name + ' Perspective';
    if (ddBadge) ddBadge.textContent = profile.name;
  }

  const textElem = document.getElementById('articleText');
  const skeleton = document.getElementById('contentSkeleton');

  if (textElem) textElem.style.display = 'none';
  if (skeleton) skeleton.style.display = 'block';

  setTimeout(() => {
    if (skeleton) skeleton.style.display = 'none';
    if (textElem) {
      if (explanation) {
        currentViewId = explanation.view_id;
        textElem.innerHTML = parseExplanationToHtmlClient(explanation.content);
        textElem.style.display = 'block';
      } else {
        textElem.innerHTML = \`
          <div class="no-explanation-box glass-card">
            <div class="modal-icon-badge"><svg viewBox="0 0 24 24"><path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"/></svg></div>
            <h4>No \${escapeHtml(profile ? profile.name : 'Custom')} Explanation Yet</h4>
            <p>Generate a tailored breakdown tailored to this persona with one tap.</p>
            \${isAuthenticated 
              ? '<button onclick="generateExplanation(' + profileId + ')" class="btn btn-primary" style="margin-top:14px;">Generate Explanation</button>' 
              : '<button onclick="showLoginModal()" class="btn btn-primary" style="margin-top:14px;">Sign In to Generate</button>'}
          </div>
        \`;
        textElem.style.display = 'block';
      }
    }
  }, 240);
};

window.generateExplanation = async function(profileId) {
  if (!isAuthenticated) {
    showLoginModal();
    return;
  }
  const skeleton = document.getElementById('contentSkeleton');
  const textElem = document.getElementById('articleText');
  if (textElem) textElem.style.display = 'none';
  if (skeleton) skeleton.style.display = 'block';

  showToast('Generating tailored perspective...');
  try {
    const res = await fetch('/api/explanation?action=generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-user-id': userId, 'x-session-token': sessionToken },
      body: JSON.stringify({ article_id: currentArticleId, profile_id: profileId, force: false })
    });
    const data = await res.json();
    if (data.success) {
      showToast('Explanation ready!');
      setTimeout(() => window.location.reload(), 450);
    } else {
      if (skeleton) skeleton.style.display = 'none';
      if (textElem) textElem.style.display = 'block';
      showToast(data.error || 'Generation failed');
    }
  } catch (err) {
    if (skeleton) skeleton.style.display = 'none';
    if (textElem) textElem.style.display = 'block';
    showToast('Error communicating with generation engine');
  }
};

// ─── DEEP DIVE ENGINE WITH SHIMMER ───
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
  card.className = 'deep-dive-accordion glass-card';
  card.id = cardId;
  card.innerHTML = \`
    <div class="dd-header" onclick="toggleDeepDiveAccordion('\${cardId}')">
      <div class="dd-title-row">
        <span class="dd-q-icon"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg></span>
        <h4>\${escapeHtml(question)}</h4>
      </div>
      <span class="accordion-chevron"><svg viewBox="0 0 24 24"><polyline points="6 9 12 15 18 9"/></svg></span>
    </div>
    <div class="dd-body">
      <div class="dd-answer-text" id="\${cardId}-ans">
        <div class="skeleton-line" style="width:90%;"></div>
        <div class="skeleton-line" style="width:75%;"></div>
        <div class="skeleton-line" style="width:60%;"></div>
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
      ansContainer.innerHTML = '<p style="color:var(--danger);">' + (data.error || 'Failed to generate deep dive') + '</p>';
    }
  } catch (err) {
    const ansContainer = document.getElementById(cardId + '-ans');
    if (ansContainer) ansContainer.innerHTML = '<p style="color:var(--danger);">Network error generating answer.</p>';
  }
};

// ─── CLIENT-SIDE RICH PARSER ENGINE ───
function parseExplanationToHtmlClient(rawText) {
  if (!rawText) return '<p>No content available.</p>';

  let text = rawText.trim();
  if (text.startsWith('"') && text.endsWith('"')) {
    text = text.substring(1, text.length - 1).trim();
  }

  const blocks = text.split(/\\n\\s*\\n/);
  const sections = [];
  let currentSection = { heading: null, content: [] };

  blocks.forEach(block => {
    const trimmed = block.trim();
    if (!trimmed) return;

    const isHeading = trimmed.startsWith('#') || 
                      (/^[A-Z0-9][\\w\\s,:—–-]+\\?$/.test(trimmed) && trimmed.length < 90) ||
                      (/^[A-Z][\\w\\s]+:\\s+[A-Za-z0-9\\s]+$/.test(trimmed) && trimmed.length < 80);

    if (isHeading) {
      if (currentSection.content.length > 0 || currentSection.heading) {
        sections.push(currentSection);
      }
      currentSection = { heading: trimmed.replace(/^#+\\s*/, ''), content: [] };
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
    const bodyHtml = sec.content.map(c => formatParagraphOrListClient(c)).join('');

    if (isFirst) {
      html += \`
        <div class="explanation-section first-section">
          \${sec.heading ? '<h2 class="subheading">' + escapeHtml(sec.heading) + '</h2>' : ''}
          <div class="section-body">\${bodyHtml}</div>
        </div>
      \`;
    } else {
      html += \`
        <div class="accordion-section glass-card collapsed" id="acc-sec-\${idx}">
          <div class="accordion-header" onclick="toggleSectionAccordion('acc-sec-\${idx}')">
            <h3 class="accordion-title">\${escapeHtml(sec.heading || 'Part ' + (idx + 1))}</h3>
            <span class="accordion-chevron">
              <svg viewBox="0 0 24 24"><polyline points="6 9 12 15 18 9"/></svg>
            </span>
          </div>
          <div class="accordion-body">\${bodyHtml}</div>
        </div>
      \`;
    }
  });

  return html;
}

function formatParagraphOrListClient(textBlock) {
  const lines = textBlock.split('\\n').map(l => l.trim()).filter(Boolean);
  const isList = lines.every(l => l.startsWith('- ') || l.startsWith('* ') || /^\\*\\*[^*]+\\*\\*\\s*—/.test(l));

  if (isList) {
    const listItems = lines.map(line => '<li>' + formatMarkdownClient(line.replace(/^[-*]\\s*/, '')) + '</li>').join('');
    return '<ul class="content-list">' + listItems + '</ul>';
  }
  return '<p>' + formatMarkdownClient(textBlock) + '</p>';
}

function formatMarkdownClient(text) {
  if (!text) return '';
  return escapeHtml(text)
    .replace(/\\*\\*(.*?)\\*\\*/g, '<strong>$1</strong>')
    .replace(/\\*(.*?)\\*/g, '<em>$1</em>')
    .replace(/__(.*?)__/g, '<u>$1</u>')
    .replace(/\\n/g, '<br/>');
}

function escapeHtml(t) {
  if (!t) return '';
  return String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ─── SCROLL PROGRESS & AUTO-RATING TRIGGER ───
window.addEventListener('scroll', () => {
  const scrollTop = window.scrollY;
  const docHeight = document.documentElement.scrollHeight - window.innerHeight;
  const bar = document.getElementById('progressBar');
  if (bar && docHeight > 0) {
    const progress = (scrollTop / docHeight) * 100;
    bar.style.width = progress + '%';

    // Auto-prompt rating modal if user reached bottom and stayed for 10s
    if (progress >= 85 && !hasUserRated && !hasShownAutoRating && isAuthenticated) {
      if (!autoRatingTimer) {
        autoRatingTimer = setTimeout(() => {
          hasShownAutoRating = true;
          sessionStorage.setItem('rated_prompt_' + currentArticleId, 'true');
          openRatingModal();
        }, 10000);
      }
    }
  }
});
`;
}

// ============================================
// UTILITIES & ERROR PAGES
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

function renderNotFoundPage(title, description) {
  return `<!DOCTYPE html>
<html lang="en" data-theme="dark">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(title)} — EasyRead</title>
  <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@500;700;800&display=swap" rel="stylesheet">
  <style>
    :root { --bg:#09090b; --text:#f2f2f5; --sec:#a1a1aa; --accent:#f59847; }
    * { margin:0; padding:0; box-sizing:border-box; }
    body { font-family:'Plus Jakarta Sans',sans-serif; background:var(--bg); color:var(--text); min-height:100vh; display:flex; align-items:center; justify-content:center; padding:24px; text-align:center; }
    .card { background:rgba(20,20,25,0.8); border:1px solid rgba(255,255,255,0.08); border-radius:24px; padding:36px 28px; max-width:400px; width:100%; box-shadow:0 16px 40px rgba(0,0,0,0.6); }
    .icon-wrap { width:64px; height:64px; border-radius:20px; background:rgba(245,152,71,0.12); display:flex; align-items:center; justify-content:center; margin:0 auto 18px; border:1px solid rgba(245,152,71,0.25); }
    .icon-wrap svg { width:32px; height:32px; stroke:var(--accent); fill:none; stroke-width:2; }
    h1 { font-size:1.4rem; font-weight:800; margin-bottom:8px; }
    p { font-size:0.9rem; color:var(--sec); line-height:1.55; margin-bottom:24px; }
    .home-btn { background:var(--accent); color:#fff; text-decoration:none; padding:12px 28px; border-radius:14px; font-weight:700; font-size:0.9rem; display:inline-block; transition:all 0.2s; }
    .home-btn:hover { background:#e08333; }
  </style>
</head>
<body>
  <div class="card">
    <div class="icon-wrap"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg></div>
    <h1>${escapeHtml(title)}</h1>
    <p>${escapeHtml(description)}</p>
    <a href="/" class="home-btn">Return to Feed</a>
  </div>
</body>
</html>`;
}

function renderErrorPage(msg) {
  return renderNotFoundPage('Something Went Wrong', msg || 'We encountered an error while assembling this article.');
}

// ============================================
// STYLESHEET (GLASS DESIGN SYSTEM)
// ============================================
function getCSSStyles() {
  return `
:root {
  --bg-color: #09090b;
  --bg-glow: radial-gradient(circle at 50% 0%, rgba(245, 152, 71, 0.12) 0%, transparent 60%);
  --text-main: #f2f2f5;
  --text-secondary: #a1a1aa;
  --text-muted: #71717a;
  --card-bg: rgba(18, 18, 22, 0.78);
  --card-bg-hover: rgba(26, 26, 32, 0.9);
  --card-blur: blur(24px);
  --glass-border: 1px solid rgba(255, 255, 255, 0.09);
  --glass-border-subtle: 1px solid rgba(255, 255, 255, 0.05);
  --glass-shadow: 0 16px 40px rgba(0, 0, 0, 0.5);
  --mode-bg: rgba(255, 255, 255, 0.06);
  --mode-bg-hover: rgba(255, 255, 255, 0.11);
  --accent-color: #f59847;
  --accent-hover: #e08333;
  --accent-glow: rgba(245, 152, 71, 0.25);
  --accent-light: rgba(245, 152, 71, 0.12);
  --danger: #ef4444;
  --success: #10b981;
}

[data-theme="light"] {
  --bg-color: #f6f7f9;
  --bg-glow: radial-gradient(circle at 50% 0%, rgba(245, 152, 71, 0.08) 0%, transparent 65%);
  --text-main: #111113;
  --text-secondary: #5c5c63;
  --text-muted: #8e8e96;
  --card-bg: rgba(255, 255, 255, 0.85);
  --card-bg-hover: rgba(255, 255, 255, 0.98);
  --glass-border: 1px solid rgba(0, 0, 0, 0.08);
  --glass-border-subtle: 1px solid rgba(0, 0, 0, 0.04);
  --glass-shadow: 0 10px 30px rgba(0, 0, 0, 0.05);
  --mode-bg: rgba(0, 0, 0, 0.04);
  --mode-bg-hover: rgba(0, 0, 0, 0.08);
}

* { margin: 0; padding: 0; box-sizing: border-box; }
*:focus-visible { outline: 2px solid var(--accent-color); outline-offset: 2px; }

body {
  background-color: var(--bg-color);
  background-image: var(--bg-glow);
  background-repeat: no-repeat;
  background-size: 100% 500px;
  color: var(--text-main);
  font-family: 'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  min-height: 100vh;
  display: flex;
  justify-content: center;
  padding: 1.4rem 1rem calc(90px + env(safe-area-inset-bottom)) 1rem;
  -webkit-font-smoothing: antialiased;
  transition: background 0.3s ease, color 0.3s ease;
}

.full-screen-reader { max-width: 660px; width: 100%; }

.progress-bar {
  position: fixed; top: 0; left: 0; height: 3px;
  background: linear-gradient(90deg, var(--accent-color), #ffbd59);
  width: 0%; z-index: 999;
  transition: width 0.1s linear;
}

.glass-card {
  background: var(--card-bg);
  backdrop-filter: var(--card-blur);
  -webkit-backdrop-filter: var(--card-blur);
  border: var(--glass-border);
  border-radius: 20px;
  box-shadow: var(--glass-shadow);
  transition: all 0.2s ease;
}

/* ─── HEADER ─── */
.reader-header {
  display: flex; align-items: center; justify-content: space-between;
  margin-bottom: 1.2rem; padding-bottom: 0.8rem;
  border-bottom: var(--glass-border-subtle);
}
.header-left { display: flex; align-items: center; gap: 8px; }
.brand-link { font-weight: 800; color: var(--text-main); text-decoration: none; font-size: 1.15rem; letter-spacing: -0.04em; }
.brand-link span { color: var(--accent-color); }
.header-divider { color: var(--text-muted); font-size: 0.85rem; }
.header-breadcrumb { font-size: 0.8rem; color: var(--text-secondary); font-weight: 600; text-transform: uppercase; letter-spacing: 0.06em; }

.credits-badge {
  display: inline-flex; align-items: center; gap: 6px;
  background: var(--mode-bg); border: var(--glass-border-subtle);
  border-radius: 16px; padding: 0.3rem 0.7rem; font-size: 0.75rem; font-weight: 700;
}
.credits-badge svg { width: 13px; height: 13px; stroke: var(--accent-color); fill: none; stroke-width: 2.2; }

/* ─── HERO & TITLE ─── */
.category-tags-list { display: flex; gap: 6px; flex-wrap: wrap; margin-bottom: 0.6rem; }
.category-tag {
  font-size: 0.7rem; text-transform: uppercase; letter-spacing: 0.08em;
  color: var(--accent-color); font-weight: 700; background: var(--accent-light);
  padding: 0.25rem 0.65rem; border-radius: 12px; border: 1px solid var(--accent-glow);
}
.hero-title { font-size: 1.85rem; font-weight: 800; line-height: 1.22; margin-bottom: 1.2rem; letter-spacing: -0.03em; }

/* ─── PERSONA HUB ─── */
.persona-hub-wrapper { padding: 14px 16px; margin-bottom: 1.2rem; }
.persona-hub-header { margin-bottom: 10px; }
.hub-title-group { display: flex; align-items: flex-start; gap: 10px; }
.hub-title-group svg { width: 20px; height: 20px; stroke: var(--accent-color); fill: none; stroke-width: 2; flex-shrink: 0; margin-top: 2px; }
.hub-label { display: block; font-size: 0.84rem; font-weight: 700; color: var(--text-main); }
.hub-subtitle { display: block; font-size: 0.74rem; color: var(--text-secondary); margin-top: 1px; }

.persona-pills-scroll { display: flex; gap: 6px; overflow-x: auto; padding: 2px 0 4px; scrollbar-width: none; }
.persona-pills-scroll::-webkit-scrollbar { display: none; }

.persona-pill {
  flex: 0 0 auto; background: var(--mode-bg); border: var(--glass-border-subtle);
  border-radius: 20px; padding: 0.45rem 0.95rem; font-size: 0.76rem; font-weight: 600;
  color: var(--text-secondary); cursor: pointer; transition: all 0.2s ease;
  display: inline-flex; align-items: center; gap: 6px;
}
.persona-pill:hover { background: var(--mode-bg-hover); color: var(--text-main); }
.persona-pill.active { background: var(--accent-color) !important; color: #fff !important; border-color: var(--accent-color) !important; box-shadow: 0 4px 12px var(--accent-glow); }
.persona-pill.more-pill { background: var(--accent-light); color: var(--accent-color); border: 1px solid var(--accent-glow); }

/* ─── FEATURED HERO CARD ─── */
.featured-hero-card {
  width: 100%; min-height: 120px; position: relative; border-radius: 20px;
  overflow: hidden; border: var(--glass-border-subtle); display: flex;
  align-items: center; padding: 1.4rem; margin-bottom: 1.4rem;
}
.hero-overlay { position: absolute; inset: 0; background: rgba(0,0,0,0.45); backdrop-filter: blur(2px); }
.hero-card-content { position: relative; z-index: 2; width: 100%; }
.hero-badge {
  display: inline-flex; align-items: center; gap: 5px; font-size: 0.68rem; font-weight: 700;
  color: #fff; text-transform: uppercase; letter-spacing: 0.08em; background: rgba(0,0,0,0.4);
  padding: 0.2rem 0.65rem; border-radius: 14px; margin-bottom: 0.4rem; border: 1px solid rgba(255,255,255,0.15);
}
.hero-badge svg { width: 12px; height: 12px; stroke: var(--accent-color); fill: none; stroke-width: 2; }
.hero-card-heading { font-size: 1.18rem; font-weight: 700; color: #fff; line-height: 1.35; }

/* ─── GUEST BANNER ─── */
.guest-login-card {
  display: flex; align-items: center; gap: 14px; padding: 14px 18px; margin-bottom: 1.4rem;
}
.guest-card-icon {
  width: 38px; height: 38px; border-radius: 12px; background: var(--accent-light);
  display: flex; align-items: center; justify-content: center; flex-shrink: 0;
  border: 1px solid var(--accent-glow);
}
.guest-card-icon svg { width: 20px; height: 20px; stroke: var(--accent-color); fill: none; stroke-width: 2; }
.guest-card-content { flex: 1; }
.guest-card-content h4 { font-size: 0.88rem; font-weight: 700; color: var(--text-main); margin-bottom: 2px; }
.guest-card-content p { font-size: 0.75rem; color: var(--text-secondary); line-height: 1.4; }
.guest-signin-btn {
  background: var(--accent-color); color: #fff; text-decoration: none; font-size: 0.78rem;
  font-weight: 700; padding: 8px 14px; border-radius: 12px; white-space: nowrap; transition: background 0.2s;
}
.guest-signin-btn:hover { background: var(--accent-hover); }

/* ─── ARTICLE TYPOGRAPHY & ACCORDIONS ─── */
.article-body p { font-size: 0.96rem; line-height: 1.7; color: var(--text-secondary); margin-bottom: 1.1rem; }
.subheading { font-size: 1.3rem; font-weight: 700; color: var(--text-main); margin-bottom: 0.75rem; letter-spacing: -0.02em; }
.content-list { padding-left: 1.3rem; margin-bottom: 1.1rem; color: var(--text-secondary); line-height: 1.68; font-size: 0.94rem; }
.content-list li { margin-bottom: 0.45rem; }

.accordion-section { margin-bottom: 12px; overflow: hidden; }
.accordion-header {
  display: flex; align-items: center; justify-content: space-between;
  padding: 14px 18px; cursor: pointer; user-select: none;
}
.accordion-title { font-size: 1rem; font-weight: 700; color: var(--text-main); line-height: 1.35; }
.accordion-chevron svg { width: 16px; height: 16px; stroke: var(--text-muted); fill: none; stroke-width: 2; transition: transform 0.25s ease; }
.accordion-section.collapsed .accordion-chevron svg { transform: rotate(-90deg); }
.accordion-body { padding: 0 18px 16px 18px; }
.accordion-section.collapsed .accordion-body { display: none; }

/* ─── SUMMARY / KEY TAKEAWAY ─── */
.summary-wrapper { margin: 1.8rem 0 1.4rem; padding: 16px 20px; border-left: 3px solid var(--accent-color); }
.summary-header { display: flex; align-items: center; gap: 8px; margin-bottom: 6px; }
.summary-header svg { width: 16px; height: 16px; stroke: var(--accent-color); fill: none; stroke-width: 2; }
.summary-header h4 { font-size: 0.76rem; text-transform: uppercase; letter-spacing: 0.08em; color: var(--accent-color); font-weight: 800; }
.summary-text { font-size: 0.92rem; line-height: 1.6; color: var(--text-secondary); }

/* ─── DEEP DIVES ─── */
.deep-dives-section { margin-top: 2.2rem; margin-bottom: 1.6rem; }
.section-title-row { display: flex; align-items: center; justify-content: space-between; margin-bottom: 1rem; }
.section-title-group { display: flex; align-items: center; gap: 8px; }
.section-title-group svg { width: 18px; height: 18px; stroke: var(--accent-color); fill: none; stroke-width: 2; }
.section-title-group h3 { font-size: 1.05rem; font-weight: 700; color: var(--text-main); }
.persona-tag {
  font-size: 0.68rem; font-weight: 700; background: var(--accent-light); color: var(--accent-color);
  padding: 0.2rem 0.6rem; border-radius: 10px; text-transform: uppercase; letter-spacing: 0.06em;
}

.deep-dives-list { display: flex; flex-direction: column; gap: 10px; margin-bottom: 1.2rem; }
.deep-dive-accordion { overflow: hidden; }
.dd-header { display: flex; align-items: center; justify-content: space-between; padding: 14px 18px; cursor: pointer; }
.dd-title-row { display: flex; align-items: center; gap: 10px; }
.dd-q-icon svg { width: 18px; height: 18px; stroke: var(--accent-color); fill: none; stroke-width: 2; flex-shrink: 0; }
.dd-title-row h4 { font-size: 0.92rem; font-weight: 700; color: var(--text-main); }
.dd-body { padding: 0 18px 16px 46px; }
.deep-dive-accordion.collapsed .dd-body { display: none; }
.deep-dive-accordion.collapsed .accordion-chevron svg { transform: rotate(-90deg); }
.dd-answer-text { font-size: 0.9rem; line-height: 1.6; color: var(--text-secondary); }

.deep-dive-ask-card { padding: 14px 16px; }
.deep-dive-ask-card textarea {
  width: 100%; background: var(--mode-bg); border: var(--glass-border-subtle);
  border-radius: 12px; padding: 10px 12px; color: var(--text-main); font-family: inherit;
  font-size: 0.88rem; resize: none; outline: none; transition: border-color 0.2s;
}
.deep-dive-ask-card textarea:focus { border-color: var(--accent-color); }
.ask-card-footer { display: flex; align-items: center; justify-content: space-between; margin-top: 8px; }
.cost-hint { display: inline-flex; align-items: center; gap: 4px; font-size: 0.74rem; font-weight: 700; color: var(--accent-color); }
.cost-hint svg { width: 12px; height: 12px; stroke: currentColor; fill: none; stroke-width: 2; }
.ask-submit-btn {
  background: var(--accent-color); color: #fff; border: none; padding: 6px 14px;
  border-radius: 10px; font-size: 0.78rem; font-weight: 700; cursor: pointer; transition: background 0.2s;
}
.ask-submit-btn:hover { background: var(--accent-hover); }

/* ─── SHIMMER SKELETON LOADERS ─── */
.skeleton-card-pulse { padding: 20px; }
.skeleton-line {
  height: 12px; border-radius: 6px; background: rgba(255,255,255,0.04);
  position: relative; overflow: hidden; margin-bottom: 10px;
}
.skeleton-line::after {
  position: absolute; inset: 0; transform: translateX(-100%);
  background-image: linear-gradient(90deg, rgba(255,255,255,0) 0%, rgba(255,255,255,0.1) 50%, rgba(255,255,255,0) 100%);
  animation: shimmerSwipe 1.5s infinite; content: '';
}
@keyframes shimmerSwipe { 100% { transform: translateX(100%); } }

/* ─── METADATA ROW ─── */
.article-metadata {
  display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap;
  gap: 12px; margin: 1.4rem 0 2rem; padding: 12px 0; border-top: var(--glass-border-subtle);
  border-bottom: var(--glass-border-subtle); font-size: 0.78rem; color: var(--text-muted);
}
.meta-item { display: inline-flex; align-items: center; gap: 6px; }
.meta-item svg { width: 14px; height: 14px; stroke: currentColor; fill: none; stroke-width: 2; }
.source-badge { font-weight: 600; color: var(--text-main); }

/* ─── FLOATING ACTION DOCK ─── */
.floating-action-dock {
  position: fixed; bottom: calc(14px + env(safe-area-inset-bottom)); left: 50%;
  transform: translateX(-50%); width: calc(100% - 28px); max-width: 600px; z-index: 100;
}
.dock-content {
  padding: 6px 10px; display: flex; align-items: center; justify-content: space-between;
  border-radius: 22px; backdrop-filter: blur(28px) saturate(180%);
  -webkit-backdrop-filter: blur(28px) saturate(180%);
}
.dock-source-pill {
  display: inline-flex; align-items: center; gap: 6px; background: var(--mode-bg);
  border: var(--glass-border-subtle); border-radius: 14px; padding: 6px 12px;
  font-size: 0.75rem; color: var(--text-secondary); text-decoration: none;
  max-width: 220px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.dock-source-pill svg { width: 13px; height: 13px; stroke: currentColor; fill: none; stroke-width: 2; flex-shrink: 0; }
.dock-source-pill:hover { color: var(--text-main); }

.dock-actions { display: flex; align-items: center; gap: 6px; }
.dock-icon-btn {
  background: var(--mode-bg); border: var(--glass-border-subtle); border-radius: 50%;
  width: 36px; height: 36px; display: flex; align-items: center; justify-content: center;
  cursor: pointer; color: var(--text-secondary); transition: all 0.2s ease;
}
.dock-icon-btn svg { width: 16px; height: 16px; stroke: currentColor; fill: none; stroke-width: 2; }
.dock-icon-btn:hover { background: var(--mode-bg-hover); color: var(--text-main); }
.dock-icon-btn.bookmarked { color: var(--accent-color); background: var(--accent-light); border-color: var(--accent-glow); }
.dock-icon-btn.bookmarked svg { fill: var(--accent-color); }
.dock-icon-btn.rated { color: var(--accent-color); background: var(--accent-light); border-color: var(--accent-glow); }
.dock-icon-btn.rated svg { fill: var(--accent-color); }

/* ─── TOAST NOTIFICATION ─── */
.toast {
  position: fixed; bottom: calc(76px + env(safe-area-inset-bottom)); left: 50%;
  transform: translateX(-50%) translateY(30px); background: var(--card-bg);
  backdrop-filter: var(--card-blur); border: var(--glass-border); border-radius: 14px;
  padding: 10px 18px; color: var(--text-main); font-size: 0.82rem; font-weight: 600;
  box-shadow: var(--glass-shadow); z-index: 2000; opacity: 0;
  transition: all 0.3s cubic-bezier(0.16, 1, 0.3, 1); pointer-events: none;
}
.toast.show { opacity: 1; transform: translateX(-50%) translateY(0); }

/* ─── GLASS MODALS ─── */
.modal-overlay {
  position: fixed; inset: 0; background: rgba(0,0,0,0.65);
  backdrop-filter: blur(20px); -webkit-backdrop-filter: blur(20px);
  display: flex; align-items: center; justify-content: center;
  z-index: 3000; padding: 20px; opacity: 0; pointer-events: none;
  transition: opacity 0.3s ease;
}
.modal-overlay.active { opacity: 1; pointer-events: auto; }

.glass-modal {
  background: var(--card-bg); backdrop-filter: var(--card-blur);
  -webkit-backdrop-filter: var(--card-blur); border: var(--glass-border);
  border-radius: 26px; padding: 28px 24px; max-width: 380px; width: 100%;
  text-align: center; position: relative; box-shadow: var(--glass-shadow);
  transform: scale(0.94) translateY(12px);
  transition: transform 0.35s cubic-bezier(0.16, 1, 0.3, 1);
}
.modal-overlay.active .glass-modal { transform: scale(1) translateY(0); }

.modal-close-btn {
  position: absolute; top: 16px; right: 16px; width: 30px; height: 30px;
  border-radius: 50%; background: var(--mode-bg); border: var(--glass-border-subtle);
  color: var(--text-muted); font-size: 0.9rem; cursor: pointer;
  display: flex; align-items: center; justify-content: center;
}
.modal-close-btn:hover { color: var(--text-main); }

.modal-icon-badge {
  width: 52px; height: 52px; border-radius: 16px; background: var(--accent-light);
  display: flex; align-items: center; justify-content: center; margin: 0 auto 14px;
  border: 1px solid var(--accent-glow);
}
.modal-icon-badge svg { width: 26px; height: 26px; stroke: var(--accent-color); fill: none; stroke-width: 2; }

.glass-modal h3 { font-size: 1.15rem; font-weight: 700; color: var(--text-main); margin-bottom: 6px; }
.glass-modal p { font-size: 0.86rem; color: var(--text-secondary); line-height: 1.55; }

.modal-actions-row { display: flex; gap: 10px; justify-content: center; margin-top: 1.2rem; }
.btn {
  padding: 10px 18px; border-radius: 14px; font-weight: 700; font-size: 0.85rem;
  cursor: pointer; text-decoration: none; display: inline-flex; align-items: center;
  justify-content: center; border: none; font-family: inherit; transition: all 0.2s;
}
.btn-primary { background: var(--accent-color); color: #fff; }
.btn-primary:hover { background: var(--accent-hover); }
.btn-secondary { background: var(--mode-bg); color: var(--text-secondary); border: var(--glass-border-subtle); }
.btn-secondary:hover { background: var(--mode-bg-hover); color: var(--text-main); }

/* ─── PERSONAS GRID IN MODAL ─── */
.personas-modal-card { max-width: 480px; text-align: left; max-height: 80vh; overflow-y: auto; }
.personas-grid-list { display: flex; flex-direction: column; gap: 10px; margin-top: 16px; }
.persona-selection-card {
  padding: 14px 16px; border-radius: 16px; background: var(--mode-bg);
  border: var(--glass-border-subtle); cursor: pointer; transition: all 0.2s;
}
.persona-selection-card:hover { background: var(--mode-bg-hover); border-color: var(--accent-color); }
.persona-selection-card.selected { border-color: var(--accent-color); background: var(--accent-light); }
.persona-card-top { display: flex; align-items: center; gap: 10px; margin-bottom: 4px; }
.persona-badge-icon svg { width: 16px; height: 16px; stroke: var(--accent-color); fill: none; stroke-width: 2; }
.persona-card-top h4 { font-size: 0.92rem; font-weight: 700; color: var(--text-main); flex: 1; }
.selected-pill { font-size: 0.65rem; font-weight: 700; background: var(--accent-color); color: #fff; padding: 2px 8px; border-radius: 10px; text-transform: uppercase; }
.persona-selection-card p { font-size: 0.78rem; color: var(--text-secondary); line-height: 1.4; }

/* ─── RATING SCALE & LOW RATING FEEDBACK ─── */
.rating-scale { display: flex; gap: 8px; justify-content: center; margin: 1.2rem 0 0.8rem; }
.rating-scale label { font-size: 1.8rem; cursor: pointer; opacity: 0.45; transition: transform 0.2s, opacity 0.2s; }
.rating-scale input { display: none; }
.rating-scale input:checked + label, .rating-scale label:hover { opacity: 1; transform: scale(1.2); }

.low-rating-feedback {
  margin-top: 14px; text-align: left; padding: 12px 14px;
  background: var(--mode-bg); border-radius: 14px; border: var(--glass-border-subtle);
}
.feedback-prompt-label { display: block; font-size: 0.75rem; font-weight: 700; color: var(--text-secondary); margin-bottom: 8px; }
.feedback-chips { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 8px; }
.chip input { display: none; }
.chip span {
  display: inline-block; padding: 4px 10px; border-radius: 12px; font-size: 0.72rem;
  font-weight: 600; background: var(--card-bg); border: var(--glass-border-subtle);
  color: var(--text-secondary); cursor: pointer; transition: all 0.2s;
}
.chip input:checked + span { background: var(--accent-color); color: #fff; border-color: var(--accent-color); }
.feedback-text {
  width: 100%; background: var(--card-bg); border: var(--glass-border-subtle);
  border-radius: 10px; padding: 8px 10px; color: var(--text-main); font-family: inherit;
  font-size: 0.8rem; resize: none; outline: none;
}
.bonus-incentive-pill {
  display: inline-flex; align-items: center; gap: 4px; font-size: 0.75rem;
  font-weight: 700; color: var(--accent-color); margin-bottom: 6px;
}
.bonus-incentive-pill svg { width: 13px; height: 13px; stroke: currentColor; fill: none; stroke-width: 2; }

.no-explanation-box { padding: 24px; text-align: center; margin: 12px 0; }
.no-explanation-box h4 { font-size: 1rem; font-weight: 700; color: var(--text-main); margin-bottom: 4px; }
.no-explanation-box p { font-size: 0.84rem; color: var(--text-secondary); }
`;
}

export const config = {
  api: {
    bodyParser: {
      sizeLimit: '10mb',
    },
  },
};