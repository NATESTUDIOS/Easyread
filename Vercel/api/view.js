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

// ============================================
// CONSTANTS
// ============================================
const PROCESSOR_URL = process.env.PROCESSOR_URL || 'https://my-fcm-server.onrender.com/api/processor';
const ADMIN_API_KEY = process.env.ADMIN_API_KEY;
const SITE_URL = process.env.SITE_URL || 'https://easytoread.vercel.app';

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
// MAIN HANDLER
// ============================================
export default async function handler(req, res) {
  // Handle CORS
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,POST,PUT,DELETE');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version, x-user-id, x-session-token'
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
// RENDER FULL ARTICLE PAGE
// ============================================
async function renderArticlePage(req, res) {
  const { id, slug } = req.query;
  const user_id = req.headers['x-user-id'] || req.query.user_id;
  const sessionToken = req.headers['x-session-token'] || req.query.session_token;

  try {
    // Fetch article
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

    // Get color pair for this article
    const colorPair = getColorPairForArticle(article.article_id);
    const ogImageUrl = generateOgImageUrl(
      article.canonical_title || 'EasyRead Article',
      colorPair.bg,
      colorPair.text
    );

    // Increment view count
    await update('articles', article.article_id, {
      view_count: (article.view_count || 0) + 1
    });

    // Track reading history if user is authenticated
    if (user_id) {
      const today = new Date().toISOString().split('T')[0];
      const existing = await supabase
        .from('reading_history')
        .select('history_id')
        .eq('user_id', user_id)
        .eq('article_id', article.article_id)
        .eq('date', today)
        .single();

      if (!existing.data) {
        await insert('reading_history', {
          user_id,
          article_id: article.article_id,
          date: today,
          viewed_at: new Date().toISOString()
        });
      }
    }

    // Get explanations for this article
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

    // Get ratings
    const { data: ratings, error: ratingError } = await supabase
      .from('ratings')
      .select('rating, feedback, user_id, created_at')
      .in('view_id', explanations?.map(e => e.view_id) || [])
      .order('created_at', { ascending: false })
      .limit(50);

    if (ratingError) throw ratingError;

    // Get user's rating
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

    // Get user's credits
    let userCredits = null;
    if (user_id) {
      const users = await getByColumn('users', 'user_id', user_id);
      if (users.length > 0) {
        userCredits = users[0].credits;
      }
    }

    // Get bookmark status
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

    // Get all profiles
    const { data: profiles, error: profileError } = await supabase
      .from('profiles')
      .select('*')
      .eq('status', 'active')
      .order('profile_id', { ascending: true });

    if (profileError) throw profileError;

    // Build the HTML page
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
      isBookmarked
    });

    res.setHeader('Content-Type', 'text/html');
    res.status(200).send(html);

  } catch (error) {
    console.error('Render article error:', error);
    res.status(500).send(renderErrorPage(error.message));
  }
}

// ============================================
// GET ARTICLE DATA (JSON)
// ============================================
async function getArticleData(req, res) {
  const { id, slug } = req.query;
  const user_id = req.headers['x-user-id'] || req.query.user_id;

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

    // Get explanations
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

    // Get ratings
    const { data: ratings, error: ratingError } = await supabase
      .from('ratings')
      .select('rating, feedback, user_id, created_at')
      .in('view_id', explanations?.map(e => e.view_id) || [])
      .order('created_at', { ascending: false })
      .limit(50);

    if (ratingError) throw ratingError;

    // Get user rating
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

    // Get user credits
    let userCredits = null;
    if (user_id) {
      const users = await getByColumn('users', 'user_id', user_id);
      if (users.length > 0) {
        userCredits = users[0].credits;
      }
    }

    // Get bookmark status
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
      isBookmarked
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
    // Check if bookmark exists
    const { data: existing, error: checkError } = await supabase
      .from('bookmarks')
      .select('bookmark_id')
      .eq('user_id', user_id)
      .eq('article_id', parseInt(article_id))
      .maybeSingle();

    if (checkError) throw checkError;

    if (existing) {
      // Remove bookmark
      await deleteRecord('bookmarks', existing.bookmark_id);
      
      // Get updated count
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
      // Add bookmark
      const bookmark = await insert('bookmarks', {
        user_id,
        article_id: parseInt(article_id),
        created_at: new Date().toISOString()
      });

      // Get updated count
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
    // Check if user already rated this
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

    // Insert rating
    const ratingRecord = await insert('ratings', {
      user_id,
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
    const users = await getByColumn('users', 'user_id', user_id);
    if (users.length > 0) {
      const user = users[0];
      const bonus = 0.2;
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

    res.status(201).json({
      success: true,
      message: 'Rating submitted successfully',
      rating_id: ratingRecord.rating_id,
      bonus_earned: 0.2
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
    // Check if deep dive already exists
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

    // Check user credits
    const users = await getByColumn('users', 'user_id', user_id);
    if (users.length > 0) {
      const user = users[0];
      if (user.credits < 0.5) {
        return res.status(402).json({
          error: 'Insufficient credits',
          required: 0.5,
          available: user.credits
        });
      }
    }

    // Call Render's processor API for deep dive
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

    // Deduct credits if user
    if (user_id && !data.cached) {
      const users = await getByColumn('users', 'user_id', user_id);
      if (users.length > 0) {
        const user = users[0];
        await update('users', user_id, { 
          credits: user.credits - 0.5 
        });

        await insert('credit_transactions', {
          user_id,
          amount: -0.5,
          reason: 'deep_dive',
          balance_after: user.credits - 0.5,
          item_id: article_id
        });
      }
    }

    // Get the generated deep dive from database
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
  isBookmarked 
}) {
  const title = article.canonical_title || 'Untitled Article';
  const description = article.summary || 'Read this article on EasyRead';
  const slug = article.slug || `article-${article.article_id}`;
  
  const imageUrl = ogImageUrl || `https://placehold.co/1200x630/1A1A2E/FFFFFF?text=${encodeURIComponent(title.substring(0, 60))}`;

  // Build meta tags
  const metaTags = `
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=yes, viewport-fit=cover">
    
    <title>${escapeHtml(title)} | EasyRead</title>
    <meta name="description" content="${escapeHtml(description)}">
    
    <!-- Open Graph -->
    <meta property="og:title" content="${escapeHtml(title)} | EasyRead">
    <meta property="og:description" content="${escapeHtml(description)}">
    <meta property="og:image" content="${imageUrl}">
    <meta property="og:url" content="${SITE_URL}/view?id=${article.article_id}">
    <meta property="og:type" content="article">
    <meta property="og:site_name" content="EasyRead">
    
    <!-- Twitter Card -->
    <meta name="twitter:card" content="summary_large_image">
    <meta name="twitter:title" content="${escapeHtml(title)} | EasyRead">
    <meta name="twitter:description" content="${escapeHtml(description)}">
    <meta name="twitter:image" content="${imageUrl}">
    
    <!-- Article Meta -->
    <meta property="article:published_time" content="${article.created_at || ''}">
    <meta property="article:modified_time" content="${article.updated_at || ''}">
    <meta property="article:author" content="EasyRead">
    ${article.categories?.map(cat => `<meta property="article:tag" content="${escapeHtml(cat)}">`).join('\n')}
    
    <!-- Schema.org -->
    <script type="application/ld+json">
    {
      "@context": "https://schema.org",
      "@type": "Article",
      "headline": "${escapeHtml(title)}",
      "description": "${escapeHtml(description)}",
      "image": "${imageUrl}",
      "datePublished": "${article.created_at || ''}",
      "dateModified": "${article.updated_at || ''}",
      "author": {
        "@type": "Organization",
        "name": "EasyRead"
      }
    }
    </script>
  `;

  return `
<!DOCTYPE html>
<html lang="en" data-theme="auto">
<head>
  ${metaTags}
  
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@300;400;500;600;700;800&display=swap" rel="stylesheet">
  
  <style>
    ${getCSSStyles()}
  </style>
</head>
<body>
  <!-- Progress Bar -->
  <div class="progress-bar" id="progressBar"></div>
  
  <!-- Toast -->
  <div class="toast" id="toast"></div>

  <!-- Login Modal Overlay -->
  <div class="login-overlay" id="loginOverlay">
    <div class="login-modal">
      <button class="login-close" onclick="closeLoginModal()">✕</button>
      <div class="login-modal-content">
        <h2>🔐 Sign in to continue</h2>
        <p>You need to be logged in to bookmark articles, rate content, and access deep dives.</p>
        <div class="login-modal-buttons">
          <a href="${SITE_URL}#login" class="login-btn-primary">Sign In</a>
          <a href="${SITE_URL}#signup" class="login-btn-secondary">Create Account</a>
        </div>
        <p class="login-modal-footer">You'll be redirected to the login page.</p>
      </div>
    </div>
  </div>

  <div class="full-screen-reader">
    ${buildHeaderHTML(userCredits, user_id, profiles)}
    ${buildHeroHTML(title, article.categories)}
    ${buildProfilePillsHTML(profiles)}
    ${buildGradientCardHTML()}
    ${buildArticleContentHTML(article, explanations)}
    ${buildSummaryHTML(article)}
    ${buildMetadataHTML(article)}
    ${buildReaderSectionHTML()}
    ${buildFooterHTML(article, user_id, userCredits, isBookmarked)}
    ${buildReviewModalHTML(userRating, user_id)}
    ${buildDeepDiveModalHTML()}
  </div>

  <script>
    ${getJavaScript(article, explanations, userRating, user_id, sessionToken, isBookmarked)}
  </script>
</body>
</html>
  `;
}

// ============================================
// HTML COMPONENT BUILDERS
// ============================================

function buildHeaderHTML(userCredits, user_id, profiles) {
  const isAuthenticated = !!user_id;
  return `
    <header class="reader-header">
      <div class="category-breadcrumb">
        <a href="/" style="color: var(--text-secondary); text-decoration: none;">EasyRead</a>
        <span>›</span>
        <span class="current">Reading</span>
      </div>
      
      <div class="header-actions" style="display: flex; align-items: center; gap: 8px;">
        <button onclick="window.toggleTheme()" class="glass-icon-btn" title="Toggle theme">
          <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor">
            <path d="M12 3a9 9 0 1 0 9 9c0-.46-.04-.92-.1-1.36a5.5 5.5 0 0 1-7.64-1.56 5.5 5.5 0 0 1-1.56-7.64A9.02 9.02 0 0 0 12 3z"/>
          </svg>
        </button>
        
        ${isAuthenticated ? `
          <div class="credits-badge" id="userCreditsBadge" title="Credit Balance">
            <span class="lightning-icon">⚡</span>
            <span class="credits-val" id="creditsValueDisplay">${userCredits || 50}</span>
            <span class="credits-label">credits</span>
          </div>
        ` : `
          <a href="${SITE_URL}#login" class="auth-link" style="color: var(--accent-color); font-weight: 600; text-decoration: none; font-size: 0.85rem; padding: 0.4rem 0.9rem; border: 1.5px solid var(--accent-color); border-radius: 20px; transition: all 0.2s;">
            Sign In
          </a>
        `}
      </div>
    </header>
  `;
}

function buildHeroHTML(title, categories) {
  const category = categories?.[0] || 'General';
  return `
    <header class="hero-section">
      <div class="category-label" style="font-size: 0.75rem; text-transform: uppercase; letter-spacing: 1px; color: var(--accent-color); font-weight: 700; margin-bottom: 0.5rem;">
        ${escapeHtml(category)}
      </div>
      <h1 class="hero-title">${escapeHtml(title)}</h1>
    </header>
  `;
}

function buildProfilePillsHTML(profiles) {
  if (!profiles || profiles.length === 0) {
    return `
      <div class="profile-pills-wrapper">
        <div class="profile-pills-scroll">
          <button class="profile-pill active" data-profile="default" onclick="switchProfile('default', this)">
            Everyday Life
          </button>
        </div>
      </div>
    `;
  }

  const profileHTML = profiles.map((p, index) => {
    const isActive = p.is_default || index === 0;
    const icon = getProfileIcon(p.name);
    return `
      <button class="profile-pill ${isActive ? 'active' : ''}" data-profile="${p.profile_id}" data-profile-name="${p.name}" onclick="switchProfile('${p.profile_id}', this, '${p.name}')">
        ${icon}
        ${escapeHtml(p.name)}
      </button>
    `;
  }).join('');

  return `
    <div class="profile-pills-wrapper">
      <div class="profile-pills-scroll" id="profilePills">
        ${profileHTML}
      </div>
    </div>
  `;
}

function buildGradientCardHTML() {
  return `
    <div class="featured-gradient-card" id="gradientCard">
      <div class="gradient-card-overlay"></div>
      <div class="catch-line-text" id="catchLineText">“Every idea has a story. Let's explore it together.”</div>
    </div>
  `;
}

function buildArticleContentHTML(article, explanations) {
  const defaultExplanation = explanations?.find(e => e.profile_id === 1) || explanations?.[0];
  const content = defaultExplanation?.content || article.base_content || 'No content available.';
  
  const sections = parseContentIntoSections(content);
  
  const shimmerHTML = `
    <div class="content-shimmer" id="contentShimmer">
      <div class="shimmer-line"></div>
      <div class="shimmer-line"></div>
      <div class="shimmer-line"></div>
      <div class="shimmer-line"></div>
      <div class="shimmer-line"></div>
      <div class="shimmer-line"></div>
    </div>
  `;

  const contentHTML = `
    <div id="articleText" style="display: none;">
      ${sections.map((section, i) => {
        if (section.type === 'heading') {
          return `<h2 class="subheading">${section.content}</h2>`;
        }
        const isFirst = i === 0;
        return `<p class="${isFirst ? 'dropcap' : ''}">${section.content}</p>`;
      }).join('')}
    </div>
  `;

  return `
    <article class="article-body" id="articleContent">
      ${shimmerHTML}
      ${contentHTML}
    </article>
  `;
}

function buildSummaryHTML(article) {
  const summary = article.summary || 'No summary available.';
  return `
    <div class="summary-wrapper">
      <div class="summary-content">
        <h4>Summary</h4>
        <p>${escapeHtml(summary)}</p>
      </div>
    </div>
  `;
}

function buildMetadataHTML(article) {
  const date = article.created_at ? new Date(article.created_at).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  }) : 'Recently';
  
  const wordCount = article.word_count || article.base_content?.split(/\s+/).length || 0;
  const readTime = Math.ceil(wordCount / 200) || 3;

  return `
    <div class="article-metadata">
      <div class="meta-left">
        <span class="author-name">EasyRead</span>
        <span>·</span>
        <span>${date}</span>
      </div>
      <div class="meta-right">
        ${readTime} min read · ${article.view_count || 0} views
      </div>
    </div>
  `;
}

function buildReaderSectionHTML() {
  return `
    <div class="reader-section">
      <div class="reader-avatars">
        <div class="mini-circle gold">JR</div>
        <div class="mini-circle blue">AK</div>
        <div class="mini-circle green">MS</div>
        <div class="mini-circle purple">TW</div>
      </div>
      <div class="reader-count">
        <strong>1.4k</strong> readers this hour
      </div>
    </div>
  `;
}

function buildFooterHTML(article, user_id, userCredits, isBookmarked) {
  const isAuthenticated = !!user_id;
  const bookmarkIcon = isBookmarked ? `
    <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor">
      <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/>
    </svg>
  ` : `
    <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor">
      <path d="M17 3H7c-1.1 0-2 .9-2 2v16l7-3 7 3V5c0-1.1-.9-2-2-2z"/>
    </svg>
  `;

  return `
    <div class="glass-footer">
      <div class="footer-content">
        <div class="link-pill">
          <span>🔗 ${article.source_domain || 'easytoread.vercel.app'}/</span>${article.slug?.substring(0, 20) || 'article'}...
        </div>
        
        <div class="glass-actions">
          <button class="glass-icon-btn" onclick="copyLink()" title="Copy link">
            <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor">
              <path d="M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z"/>
            </svg>
          </button>
          
          <button class="glass-icon-btn" onclick="shareLink()" title="Share">
            <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor">
              <path d="M18 16.08c-.76 0-1.44.3-1.96.77L8.91 12.7c.05-.23.09-.46.09-.7s-.04-.47-.09-.7l7.05-4.11c.54.5 1.25.81 2.04.81 1.66 0 3-1.34 3-3s-1.34-3-3-3-3 1.34-3 3c0 .24.04.47.09.7L8.04 9.81C7.5 9.31 6.79 9 6 9c-1.66 0-3 1.34-3 3s1.34 3 3 3c.79 0 1.5-.31 2.04-.81l7.12 4.16c-.05.21-.08.43-.08.65 0 1.61 1.31 2.92 2.92 2.92s2.92-1.31 2.92-2.92-1.31-2.92-2.92-2.92z"/>
            </svg>
          </button>

          <button class="glass-icon-btn bookmark-btn ${isBookmarked ? 'bookmarked' : ''}" id="bookmarkBtn" onclick="handleBookmark()" title="${isBookmarked ? 'Remove bookmark' : 'Add bookmark'}">
            ${bookmarkIcon}
          </button>
          
          ${isAuthenticated ? `
            <button class="glass-icon-btn" onclick="openDeepDiveModal()" title="Deep Dive">
              <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor">
                <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/>
              </svg>
            </button>
          ` : `
            <button class="glass-icon-btn" onclick="showLoginModal('deep-dive')" title="Deep Dive (Login required)">
              <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor">
                <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/>
              </svg>
            </button>
          `}
        </div>
      </div>
    </div>
  `;
}

function buildReviewModalHTML(userRating, user_id) {
  const hasRated = !!userRating;
  const isAuthenticated = !!user_id;
  
  if (!isAuthenticated) {
    return `
      <div class="review-overlay" id="reviewModal">
        <div class="review-modal">
          <button class="modal-close" onclick="closeReview()">✕</button>
          <div class="login-modal-content" style="text-align: center; padding: 20px 0;">
            <h3>🔐 Sign in to rate</h3>
            <p style="color: var(--text-secondary); margin: 1rem 0;">Help us improve by rating this article!</p>
            <a href="${SITE_URL}#login" class="btn-modal-primary" style="display: inline-block; text-decoration: none; padding: 0.75rem 2rem;">Sign In</a>
          </div>
        </div>
      </div>
    `;
  }
  
  if (hasRated) {
    return `
      <div class="review-overlay" id="reviewModal">
        <div class="review-modal">
          <button class="modal-close" onclick="closeReview()">✕</button>
          <div style="text-align: center; padding: 20px 0;">
            <div style="font-size: 3rem; margin-bottom: 0.5rem;">⭐</div>
            <h3 style="margin-bottom: 0.5rem;">You already rated this</h3>
            <p style="color: var(--text-secondary);">Your feedback helps us improve!</p>
            <button class="btn-modal-primary" onclick="closeReview()" style="margin-top: 1rem;">Close</button>
          </div>
        </div>
      </div>
    `;
  }

  return `
    <div class="review-overlay" id="reviewModal">
      <div class="review-modal" id="reviewModalBody">
        <button class="modal-close" onclick="closeReview()">✕</button>
        
        <div class="bonus-incentive-pill">
          <span>⚡</span> Get +0.2 Credit Reward
        </div>
        
        <h3>Share feedback</h3>
        <p class="sub-text">Your ratings help fine-tune our personalized AI translations.</p>
        
        <div class="review-question">Was this explanation easy to understand?</div>
        
        <div class="rating-scale" id="ratingGroup">
          <input type="radio" id="mRate1" name="rating" value="1" onclick="updateRatingFeedback(1)">
          <label for="mRate1" title="Confusing">😣</label>
          
          <input type="radio" id="mRate2" name="rating" value="2" onclick="updateRatingFeedback(2)">
          <label for="mRate2" title="Unclear">😕</label>
          
          <input type="radio" id="mRate3" name="rating" value="3" onclick="updateRatingFeedback(3)">
          <label for="mRate3" title="Standard">😐</label>
          
          <input type="radio" id="mRate4" name="rating" value="4" onclick="updateRatingFeedback(4)">
          <label for="mRate4" title="Clear">🙂</label>
          
          <input type="radio" id="mRate5" name="rating" value="5" onclick="updateRatingFeedback(5)">
          <label for="mRate5" title="Amazing">🤯</label>
        </div>
        
        <div class="rating-description" id="ratingDesc">Tap your reaction above</div>

        <div class="feedback-options" id="feedbackOptions">
          <p>What could be better?</p>
          <div class="feedback-grid" id="feedbackGrid">
            <div class="feedback-chip" onclick="this.classList.toggle('selected')">Too complicated</div>
            <div class="feedback-chip" onclick="this.classList.toggle('selected')">Too long</div>
            <div class="feedback-chip" onclick="this.classList.toggle('selected')">Needs examples</div>
            <div class="feedback-chip" onclick="this.classList.toggle('selected')">Incorrect analogies</div>
            <div class="feedback-chip" onclick="this.classList.toggle('selected')">Formatting issues</div>
          </div>
        </div>
        
        <div class="modal-actions">
          <button class="btn-modal-secondary" onclick="closeReview()">Not now</button>
          <button class="btn-modal-primary" onclick="submitReview()">Submit Feedback</button>
        </div>
      </div>
    </div>
  `;
}

function buildDeepDiveModalHTML() {
  return `
    <div class="deep-dive-overlay" id="deepDiveModal">
      <div class="deep-dive-modal">
        <button class="modal-close" onclick="closeDeepDiveModal()">✕</button>
        <div style="text-align: center;">
          <div style="font-size: 2.5rem; margin-bottom: 0.5rem;">🔍</div>
          <h3>Deep Dive</h3>
          <p style="color: var(--text-secondary); margin: 0.5rem 0 1.5rem;">Ask a question to explore this topic deeper.</p>
          <form id="deepDiveForm" onsubmit="submitDeepDive(event)">
            <textarea id="deepDiveQuestion" placeholder="What would you like to know more about?" style="
              width: 100%;
              padding: 12px 16px;
              border-radius: 12px;
              border: var(--glass-border);
              background: var(--input-bg);
              color: var(--text-main);
              font-family: inherit;
              font-size: 1rem;
              resize: vertical;
              min-height: 80px;
              margin-bottom: 1rem;
              outline: none;
            "></textarea>
            <div style="display: flex; gap: 10px;">
              <button type="button" class="btn-modal-secondary" onclick="closeDeepDiveModal()">Cancel</button>
              <button type="submit" class="btn-modal-primary" style="flex: 1;">Ask Question</button>
            </div>
            <p style="font-size: 0.8rem; color: var(--text-muted); margin-top: 0.8rem;">Cost: 0.5 credits</p>
          </form>
        </div>
      </div>
    </div>
  `;
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
    'Everyday Life': `<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93z"/></svg>`,
    'Football': `<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93z"/></svg>`,
    'Gaming': `<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M21.58 16.09l-1.09-7.66C20.21 6.46 18.52 5 16.53 5H7.47C5.48 5 3.79 6.46 3.51 8.43l-1.09 7.66C2.2 17.63 3.39 19 4.94 19h14.12c1.55 0 2.74-1.37 2.52-2.91z"/></svg>`,
    'Movies & Cinema': `<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M4 6H2v14c0 1.1.9 2 2 2h14v-2H4V6zm16-4H8c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm-8 12.5v-9l6 4.5-6 4.5z"/></svg>`,
    'Cooking & Food': `<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M18.06 22.99h1.66c.84 0 1.53-.64 1.63-1.46L23 5.05h-5V1h-2v4.05h-4.97l.27 16.48c.1.82.79 1.46 1.63 1.46h1.66zM10 12.04h8V14h-8v-1.96z"/></svg>`
  };
  return icons[name] || `<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2z"/></svg>`;
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
// JAVASCRIPT FOR THE FRONTEND
// ============================================

function getJavaScript(article, explanations, userRating, user_id, sessionToken, isBookmarked) {
  const isAuthenticated = !!user_id;
  const hasRated = !!userRating;
  const explanationViews = explanations?.map(e => e.view_id) || [];
  const bookmarked = isBookmarked || false;
  
  return `
    // ============================================
    // STATE
    // ============================================
    let currentThemeSetting = localStorage.getItem('easyread-theme') || 'auto';
    let currentCredits = parseFloat(localStorage.getItem('easyread-credits')) || ${userCredits || 50};
    let modalTriggered = false;
    let currentViewId = ${explanations?.[0]?.view_id || null};
    let currentProfileId = ${explanations?.[0]?.profile_id || 1};
    let currentArticleId = ${article.article_id};
    let isAuthenticated = ${isAuthenticated};
    let hasRated = ${hasRated};
    let isBookmarked = ${bookmarked};
    let explanationViewIds = ${JSON.stringify(explanationViews)};
    let sessionToken = '${sessionToken || ''}';
    let userId = '${user_id || ''}';
    
    // ============================================
    // THEME MANAGEMENT
    // ============================================
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
    
    // ============================================
    // LOGIN MODAL
    // ============================================
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
    
    // Close login modal on background click
    document.addEventListener('click', function(e) {
      const overlay = document.getElementById('loginOverlay');
      if (e.target === overlay) {
        closeLoginModal();
      }
    });
    
    // ============================================
    // TOAST NOTIFICATION
    // ============================================
    function showToast(message, type = 'info') {
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
      toast._timeout = setTimeout(() => {
        toast.classList.remove('show');
      }, 3000);
    }
    
    // ============================================
    // CREDITS DISPLAY
    // ============================================
    function updateCreditsDisplay(credits) {
      currentCredits = credits;
      const display = document.getElementById('creditsValueDisplay');
      if (display) display.textContent = credits.toFixed(1);
      localStorage.setItem('easyread-credits', credits.toString());
    }
    
    // ============================================
    // PROGRESS BAR
    // ============================================
    window.addEventListener('scroll', () => {
      const scrollTop = window.scrollY;
      const docHeight = document.documentElement.scrollHeight - window.innerHeight;
      const progress = docHeight > 0 ? (scrollTop / docHeight) * 100 : 0;
      const bar = document.getElementById('progressBar');
      if (bar) bar.style.width = progress + '%';
    });
    
    // ============================================
    // CONTENT LOADING WITH SHIMMER
    // ============================================
    function loadContent() {
      const shimmer = document.getElementById('contentShimmer');
      const text = document.getElementById('articleText');
      
      setTimeout(() => {
        if (shimmer) shimmer.style.display = 'none';
        if (text) {
          text.style.display = 'block';
          const paragraphs = text.querySelectorAll('p');
          paragraphs.forEach((p, index) => {
            p.style.opacity = '0';
            p.style.animation = 'fadeInContent 0.6s ease forwards';
            p.style.animationDelay = (index + 1) * 0.1 + 's';
          });
          const headings = text.querySelectorAll('.subheading');
          headings.forEach((h, index) => {
            h.style.opacity = '0';
            h.style.animation = 'fadeInContent 0.6s ease forwards';
            h.style.animationDelay = (paragraphs.length + index + 1) * 0.1 + 's';
          });
        }
      }, 800);
    }
    
    // ============================================
    // PROFILE SWITCHER
    // ============================================
    window.switchProfile = function(profileId, element, profileName) {
      const pills = document.querySelectorAll('.profile-pill');
      pills.forEach(p => p.classList.remove('active'));
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
      
      const explanation = ${JSON.stringify(explanations || [])}.find(e => e.profile_id == profileId);
      
      setTimeout(() => {
        const contentArea = document.getElementById('articleContent');
        
        if (explanation) {
          const sections = parseContent(explanation.content);
          const html = sections.map(s => {
            if (s.type === 'heading') {
              return '<h2 class="subheading">' + s.content + '</h2>';
            }
            return '<p>' + s.content + '</p>';
          }).join('');
          
          contentArea.innerHTML = \`
            <div class="content-shimmer" id="contentShimmer" style="display: none;"></div>
            <div id="articleText" style="display: block;">
              \${html}
            </div>
          \`;
          
          if (catchLineText) {
            const catchLines = {
              '1': '“Every idea connects to everyday life.”',
              '2': '“Football tactics meet market strategy.”',
              '3': '“Level up your understanding.”',
              '4': '“Every story has a plot twist.”',
              '5': '“Cook up some knowledge.”'
            };
            catchLineText.textContent = catchLines[profileId] || '“Knowledge is the best currency.”';
            catchLineText.style.opacity = '1';
            catchLineText.style.transform = 'translateY(0)';
          }
          
          const newText = contentArea.querySelector('#articleText');
          if (newText) {
            const paragraphs = newText.querySelectorAll('p');
            paragraphs.forEach((p, index) => {
              p.style.opacity = '0';
              p.style.animation = 'fadeInContent 0.6s ease forwards';
              p.style.animationDelay = (index + 1) * 0.1 + 's';
            });
            const headings = newText.querySelectorAll('.subheading');
            headings.forEach((h, index) => {
              h.style.opacity = '0';
              h.style.animation = 'fadeInContent 0.6s ease forwards';
              h.style.animationDelay = (paragraphs.length + index + 1) * 0.1 + 's';
            });
          }
          
          currentViewId = explanation.view_id;
          showToast('Switched to ' + profileName + ' profile 🔄', 'info');
        } else {
          showToast('No explanation available for this profile yet.', 'warning');
          contentArea.innerHTML = \`
            <div class="content-shimmer" id="contentShimmer" style="display: none;"></div>
            <div id="articleText" style="display: block;">
              <p>No explanation available for this profile. 
                ${isAuthenticated ? \`<button onclick="generateExplanation('\${profileId}')" style="background: var(--accent-color); color: #fff; border: none; padding: 8px 16px; border-radius: 8px; cursor: pointer; font-weight: 600; margin-left: 8px;">Generate Now</button>\` : \`<a href="${SITE_URL}#login" style="color: var(--accent-color); font-weight: 600; text-decoration: none; margin-left: 8px;">Sign in to generate</a>\`}
              </p>
            </div>
          \`;
        }
      }, 800);
    };
    
    // ============================================
    // GENERATE EXPLANATION
    // ============================================
    window.generateExplanation = async function(profileId) {
      if (!isAuthenticated) {
        showLoginModal('explanation');
        return;
      }
      
      showToast('Generating explanation... ⏳', 'info');
      
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
          showToast('Explanation generated successfully! ✨', 'success');
          setTimeout(() => window.location.reload(), 1000);
        } else {
          showToast('Failed to generate explanation: ' + (data.error || 'Unknown error'), 'error');
        }
      } catch (error) {
        showToast('Error: ' + error.message, 'error');
      }
    };
    
    // ============================================
    // BOOKMARK
    // ============================================
    window.handleBookmark = async function() {
      if (!isAuthenticated) {
        showLoginModal('bookmark');
        return;
      }
      
      const btn = document.getElementById('bookmarkBtn');
      const wasBookmarked = isBookmarked;
      
      try {
        const response = await fetch('/api/view?action=bookmark', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-user-id': userId,
            'x-session-token': sessionToken
          },
          body: JSON.stringify({
            article_id: currentArticleId
          })
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
        btn.innerHTML = \`
          <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor">
            <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/>
          </svg>
        \`;
        btn.title = 'Remove bookmark';
      } else {
        btn.classList.remove('bookmarked');
        btn.innerHTML = \`
          <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor">
            <path d="M17 3H7c-1.1 0-2 .9-2 2v16l7-3 7 3V5c0-1.1-.9-2-2-2z"/>
          </svg>
        \`;
        btn.title = 'Add bookmark';
      }
    }
    
    // ============================================
    // DEEP DIVE MODAL
    // ============================================
    window.openDeepDiveModal = function() {
      if (!isAuthenticated) {
        showLoginModal('deep-dive');
        return;
      }
      const modal = document.getElementById('deepDiveModal');
      if (modal) modal.classList.add('active');
      document.body.style.overflow = 'hidden';
      setTimeout(() => {
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
    
    // Close deep dive modal on background click
    document.addEventListener('click', function(e) {
      const modal = document.getElementById('deepDiveModal');
      if (e.target === modal) {
        closeDeepDiveModal();
      }
    });
    
    window.submitDeepDive = async function(e) {
      e.preventDefault();
      
      const input = document.getElementById('deepDiveQuestion');
      const question = input.value.trim();
      
      if (!question || question.length < 5) {
        showToast('Please ask a more specific question 📝', 'error');
        return;
      }
      
      closeDeepDiveModal();
      showToast('Generating deep dive... ⏳', 'info');
      
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
          showToast('Deep dive generated! 🎯', 'success');
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
      overlay.style.cssText = \`
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background: rgba(0,0,0,0.5);
        backdrop-filter: blur(10px);
        z-index: 999;
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 20px;
      \`;
      
      overlay.innerHTML = \`
        <div style="
          background: var(--card-bg);
          backdrop-filter: var(--card-blur);
          border: var(--glass-border);
          border-radius: 20px;
          max-width: 600px;
          width: 100%;
          max-height: 80vh;
          overflow-y: auto;
          padding: 30px;
          position: relative;
        ">
          <button onclick="this.closest('div[style]').remove()" style="
            position: absolute;
            top: 15px;
            right: 20px;
            background: transparent;
            border: none;
            font-size: 24px;
            color: var(--text-secondary);
            cursor: pointer;
          ">✕</button>
          
          <h3 style="color: var(--accent-color); margin-bottom: 8px;">🔍 Deep Dive</h3>
          <p style="font-size: 0.9rem; color: var(--text-secondary); margin-bottom: 16px;">
            Question: "${escapeHtml(question)}"
          </p>
          <div style="
            background: var(--input-bg);
            border-radius: 12px;
            padding: 20px;
            color: var(--text-main);
            line-height: 1.6;
            white-space: pre-wrap;
          ">
            ${deepDive.answer || 'No answer available.'}
          </div>
          <button onclick="this.closest('div[style]').remove()" style="
            margin-top: 20px;
            background: var(--accent-color);
            color: #fff;
            border: none;
            padding: 12px 24px;
            border-radius: 12px;
            font-weight: 600;
            cursor: pointer;
            width: 100%;
          ">Close</button>
        </div>
      \`;
      
      document.body.appendChild(overlay);
    }
    
    // ============================================
    // REVIEW MODAL
    // ============================================
    window.addEventListener('scroll', () => {
      const scrollY = window.scrollY;
      const windowHeight = window.innerHeight;
      const docHeight = document.documentElement.scrollHeight;
      
      if (scrollY + windowHeight >= docHeight - 200 && !modalTriggered && !hasRated && isAuthenticated) {
        modalTriggered = true;
        setTimeout(() => {
          openReview();
        }, 600);
      }
      
      if (scrollY + windowHeight < docHeight - 450) {
        modalTriggered = false;
      }
    });
    
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
      
      const ratingTextMap = {
        1: 'Extremely confusing or complicated. 😣',
        2: 'Slightly difficult to follow. 😕',
        3: 'Average, standard explanation. 😐',
        4: 'Clear and very easy to follow! 🙂',
        5: 'Incredible explanation! Mind blown. 🤯'
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
        showToast('Please select a rating first ⭐', 'error');
        return;
      }
      
      const rating = parseInt(selectedRating.value);
      const feedbackChips = document.querySelectorAll('.feedback-chip.selected');
      const feedback = Array.from(feedbackChips).map(el => el.textContent).join(', ');
      
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
          showToast('Review submitted! +0.2 Credits Awarded ⚡', 'success');
          hasRated = true;
          
          if (data.bonus_earned) {
            updateCreditsDisplay(currentCredits + data.bonus_earned);
          }
          
          closeReview();
        } else if (response.status === 409) {
          showToast('You have already rated this article ⭐', 'info');
          closeReview();
        } else {
          showToast(data.error || 'Failed to submit review', 'error');
        }
      } catch (error) {
        showToast('Error: ' + error.message, 'error');
      }
    };
    
    // ============================================
    // COPY & SHARE
    // ============================================
    window.copyLink = function() {
      const url = window.location.href;
      navigator.clipboard.writeText(url).then(() => {
        showToast('Link copied to clipboard! 📋', 'success');
      }).catch(() => {
        const dummy = document.createElement('input');
        document.body.appendChild(dummy);
        dummy.value = url;
        dummy.select();
        document.execCommand('copy');
        document.body.removeChild(dummy);
        showToast('Link copied to clipboard! 📋', 'success');
      });
    };
    
    window.shareLink = function() {
      if (navigator.share) {
        navigator.share({
          title: document.title,
          text: 'Check out this article on EasyRead!',
          url: window.location.href
        }).catch(() => {});
      } else {
        window.copyLink();
      }
    };
    
    // ============================================
    // PARSE CONTENT HELPER
    // ============================================
    function parseContent(content) {
      if (!content) return [{ type: 'paragraph', content: 'No content available.' }];
      
      const lines = content.split('\\n').filter(line => line.trim());
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
    
    function escapeHtml(text) {
      if (!text) return '';
      return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
    }
    
    // ============================================
    // INIT
    // ============================================
    document.addEventListener('DOMContentLoaded', function() {
      loadContent();
      
      const display = document.getElementById('creditsValueDisplay');
      if (display) display.textContent = currentCredits.toFixed(1);
      
      if (hasRated) {
        modalTriggered = true;
      }
      
      // Initialize bookmark UI
      updateBookmarkUI();
    });
  `;
}

// ============================================
// CSS STYLES
// ============================================

function getCSSStyles() {
  return `
    :root {
      --bg-color: #f6f7f9;
      --bg-glow: radial-gradient(circle at 50% 0%, rgba(255,255,255,0.9) 0%, transparent 70%);
      --text-main: #1c1c1e;
      --text-secondary: #5c5c60;
      --text-muted: #8e8e93;
      --border-color: rgba(0,0,0,0.12);
      --border-subtle: rgba(0,0,0,0.08);
      --card-bg: rgba(242,242,247,0.75);
      --card-blur: blur(20px);
      --input-bg: rgba(0,0,0,0.04);
      --shadow-color: rgba(0,0,0,0.05);
      --glass-border: 1.5px solid rgba(0,0,0,0.12);
      --glass-border-subtle: 1px solid rgba(0,0,0,0.08);
      --glass-shadow: 0 10px 30px rgba(0,0,0,0.05);
      --accent-color: #f59847;
      --accent-hover: #e08735;
      --accent-glow: rgba(245,152,71,0.15);
      --icon-color: #5c5c60;
      --gradient-color-1: #ffd3b6;
      --gradient-color-2: #ffaaa5;
      --gradient-color-3: #f59847;
      --gradient-color-4: #d4e5f7;
      --shimmer-color: rgba(255,255,255,0.4);
    }
    
    @media (prefers-color-scheme: dark) {
      :root {
        --bg-color: #000000;
        --bg-glow: radial-gradient(circle at 50% 0%, rgba(40,40,42,0.4) 0%, transparent 60%);
        --text-main: #e8e8ea;
        --text-secondary: #9a9a9e;
        --text-muted: #6c6c70;
        --border-color: #2a2a2a;
        --border-subtle: rgba(255,255,255,0.06);
        --card-bg: rgba(18,18,18,0.95);
        --card-blur: blur(16px);
        --input-bg: #181818;
        --shadow-color: rgba(0,0,0,0.8);
        --glass-border: 1px solid rgba(255,255,255,0.08);
        --glass-border-subtle: 1px solid rgba(255,255,255,0.04);
        --glass-shadow: 0 8px 32px rgba(0,0,0,0.6);
        --accent-color: #f59847;
        --accent-hover: #e08735;
        --icon-color: #9aa0a6;
        --gradient-color-1: #1f130f;
        --gradient-color-2: #30170a;
        --gradient-color-3: #c49a45;
        --gradient-color-4: #12161f;
        --shimmer-color: rgba(255,255,255,0.1);
      }
    }
    
    [data-theme="dark"] {
      --bg-color: #000000 !important;
      --bg-glow: radial-gradient(circle at 50% 0%, rgba(40,40,42,0.4) 0%, transparent 60%) !important;
      --text-main: #e8e8ea !important;
      --text-secondary: #9a9a9e !important;
      --text-muted: #6c6c70 !important;
      --border-color: #2a2a2a !important;
      --border-subtle: rgba(255,255,255,0.06) !important;
      --card-bg: rgba(18,18,18,0.95) !important;
      --input-bg: #181818 !important;
      --shadow-color: rgba(0,0,0,0.8) !important;
      --glass-border: 1px solid rgba(255,255,255,0.08) !important;
      --glass-border-subtle: 1px solid rgba(255,255,255,0.04) !important;
      --glass-shadow: 0 8px 32px rgba(0,0,0,0.6) !important;
      --accent-color: #f59847 !important;
      --accent-hover: #e08735 !important;
      --icon-color: #9aa0a6 !important;
      --gradient-color-1: #1f130f !important;
      --gradient-color-2: #30170a !important;
      --gradient-color-3: #c49a45 !important;
      --gradient-color-4: #12161f !important;
      --shimmer-color: rgba(255,255,255,0.1) !important;
    }
    
    * { margin: 0; padding: 0; box-sizing: border-box; }
    
    body {
      background-color: var(--bg-color);
      background-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noiseFilter'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.65' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noiseFilter)' opacity='0.03'/%3E%3C/svg%3E"),
                        var(--bg-glow);
      background-repeat: no-repeat, no-repeat;
      background-size: auto, 100% 100%;
      background-position: center, center;
      color: var(--text-main);
      font-family: 'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      font-style: normal;
      min-height: 100vh;
      width: 100%;
      display: flex;
      justify-content: center;
      padding: 3rem 1.5rem 6rem 1.5rem;
      transition: background-color 0.4s ease, color 0.4s ease;
    }
    
    .full-screen-reader {
      max-width: 780px;
      width: 100%;
    }
    
    .progress-bar {
      position: fixed;
      top: 0;
      left: 0;
      height: 4px;
      background: var(--accent-color);
      width: 0%;
      z-index: 100;
      transition: width 0.1s linear;
    }
    
    .reader-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 1rem;
      width: 100%;
    }
    
    .category-breadcrumb {
      font-size: 0.85rem;
      color: var(--text-secondary);
      display: flex;
      align-items: center;
      gap: 6px;
      font-weight: 600;
    }
    .category-breadcrumb span { color: var(--text-muted); }
    .category-breadcrumb .current { color: var(--accent-color); }
    
    .credits-badge {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      background: var(--card-bg);
      backdrop-filter: var(--card-blur);
      -webkit-backdrop-filter: var(--card-blur);
      border: var(--glass-border-subtle);
      border-radius: 20px;
      padding: 0.4rem 0.9rem;
      font-size: 0.8rem;
      font-weight: 700;
      box-shadow: var(--glass-shadow);
      transition: transform 0.2s, background-color 0.2s;
      cursor: pointer;
    }
    .credits-badge:hover {
      transform: scale(1.02);
      border-color: var(--accent-color);
    }
    .credits-badge .lightning-icon {
      color: var(--accent-color);
      font-size: 0.9rem;
      animation: pulse-glow 2s infinite ease-in-out;
    }
    @keyframes pulse-glow {
      0%, 100% { transform: scale(1); opacity: 1; }
      50% { transform: scale(1.2); opacity: 0.8; }
    }
    
    .auth-link {
      color: var(--accent-color);
      font-weight: 600;
      text-decoration: none;
      font-size: 0.85rem;
      padding: 0.4rem 0.9rem;
      border: 1.5px solid var(--accent-color);
      border-radius: 20px;
      transition: all 0.2s;
    }
    .auth-link:hover {
      background: var(--accent-color);
      color: #fff;
    }
    
    .glass-icon-btn {
      background: rgba(255,255,255,0.05);
      backdrop-filter: blur(4px);
      border: var(--glass-border-subtle);
      border-radius: 50%;
      width: 38px;
      height: 38px;
      display: flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      color: var(--icon-color);
      transition: all 0.2s ease;
    }
    .glass-icon-btn:hover {
      background: var(--accent-color);
      color: #fff;
      border-color: var(--accent-color);
      transform: scale(1.05);
    }
    .glass-icon-btn svg { width: 18px; height: 18px; fill: currentColor; }
    .glass-icon-btn.bookmarked { color: var(--accent-color); }
    .glass-icon-btn.bookmarked:hover { color: #fff; }
    
    .hero-title {
      font-size: 2.8rem;
      font-weight: 800;
      line-height: 1.1;
      margin-bottom: 0.5rem;
      color: var(--text-main);
      letter-spacing: -1.5px;
    }
    .hero-title .accent { color: var(--accent-color); }
    
    .profile-pills-wrapper {
      margin-bottom: 1.5rem;
      overflow: hidden;
      position: relative;
    }
    .profile-pills-scroll {
      display: flex;
      gap: 10px;
      overflow-x: auto;
      padding-bottom: 4px;
      scroll-snap-type: x mandatory;
      -webkit-overflow-scrolling: touch;
      scrollbar-width: none;
    }
    .profile-pills-scroll::-webkit-scrollbar { display: none; }
    .profile-pill {
      flex: 0 0 auto;
      scroll-snap-align: start;
      background: var(--card-bg);
      backdrop-filter: var(--card-blur);
      -webkit-backdrop-filter: var(--card-blur);
      border: var(--glass-border-subtle);
      border-radius: 40px;
      padding: 0.55rem 1.2rem;
      font-size: 0.9rem;
      font-weight: 600;
      color: var(--text-secondary);
      cursor: pointer;
      transition: all 0.2s ease;
      white-space: nowrap;
      user-select: none;
      display: inline-flex;
      align-items: center;
      gap: 8px;
    }
    .profile-pill svg {
      width: 18px;
      height: 18px;
      fill: currentColor;
      flex-shrink: 0;
    }
    .profile-pill:hover {
      background: var(--card-bg-hover);
      color: var(--text-main);
      transform: translateY(-2px);
    }
    .profile-pill.active {
      background: var(--accent-color);
      color: #fff;
      border-color: var(--accent-color);
      box-shadow: 0 4px 12px var(--accent-glow);
    }
    
    .featured-gradient-card {
      width: 100%;
      min-height: 250px;
      position: relative;
      border-radius: 20px;
      overflow: hidden;
      border: var(--glass-border-subtle);
      background: linear-gradient(-45deg, var(--gradient-color-1), var(--gradient-color-2), var(--gradient-color-3), var(--gradient-color-4));
      background-size: 300% 300%;
      animation: gradientShift 15s ease infinite;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 2.2rem;
      margin-bottom: 2rem;
      box-shadow: var(--glass-shadow);
    }
    @keyframes gradientShift {
      0% { background-position: 0% 50%; }
      50% { background-position: 100% 50%; }
      100% { background-position: 0% 50%; }
    }
    .gradient-card-overlay {
      position: absolute;
      top: 0; left: 0; width: 100%; height: 100%;
      background: rgba(0,0,0,0.15);
      z-index: 1;
    }
    .catch-line-text {
      font-size: 1.55rem;
      font-weight: 800;
      line-height: 1.4;
      color: #ffffff;
      text-shadow: 0 4px 15px rgba(0,0,0,0.3);
      text-align: center;
      max-width: 580px;
      z-index: 2;
      transition: opacity 0.4s cubic-bezier(0.4,0,0.2,1), transform 0.4s cubic-bezier(0.4,0,0.2,1);
      letter-spacing: -0.5px;
    }
    
    .article-body p {
      font-size: 1.15rem;
      line-height: 1.65;
      color: var(--text-secondary);
      margin-bottom: 1.5rem;
      opacity: 0;
      animation: fadeInContent 0.6s ease forwards;
    }
    .article-body p:nth-child(1) { animation-delay: 0.1s; }
    .article-body p:nth-child(2) { animation-delay: 0.2s; }
    .article-body p:nth-child(3) { animation-delay: 0.3s; }
    .article-body p:nth-child(4) { animation-delay: 0.4s; }
    @keyframes fadeInContent {
      from { opacity: 0; transform: translateY(10px); }
      to { opacity: 1; transform: translateY(0); }
    }
    .article-body .dropcap::first-letter {
      font-size: 4rem;
      float: left;
      line-height: 0.8;
      margin-right: 12px;
      color: var(--accent-color);
      font-weight: 800;
      margin-top: 4px;
    }
    .subheading {
      font-size: 1.6rem;
      font-weight: 700;
      color: var(--text-main);
      margin-top: 2.5rem;
      margin-bottom: 1rem;
      letter-spacing: -0.5px;
    }
    .highlight-text { color: var(--accent-color); font-weight: 700; }
    
    .content-shimmer .shimmer-line {
      height: 20px;
      background: var(--shimmer-bg);
      background-size: 200% 100%;
      animation: shimmer 1.5s infinite;
      border-radius: 8px;
      margin-bottom: 16px;
    }
    .content-shimmer .shimmer-line:nth-child(1) { width: 95%; height: 24px; }
    .content-shimmer .shimmer-line:nth-child(2) { width: 88%; height: 24px; }
    .content-shimmer .shimmer-line:nth-child(3) { width: 92%; height: 24px; }
    .content-shimmer .shimmer-line:nth-child(4) { width: 75%; height: 24px; margin-bottom: 32px; }
    .content-shimmer .shimmer-line:nth-child(5) { width: 60%; height: 32px; margin-bottom: 16px; }
    .content-shimmer .shimmer-line:nth-child(6) { width: 90%; height: 24px; }
    .content-shimmer .shimmer-line:nth-child(7) { width: 85%; height: 24px; }
    .content-shimmer .shimmer-line:nth-child(8) { width: 70%; height: 24px; }
    
    @keyframes shimmer {
      0% { background-position: 200% 0; }
      100% { background-position: -200% 0; }
    }
    
    .summary-wrapper {
      margin-top: 2.5rem;
      margin-bottom: 1rem;
      border-top: 1px solid var(--border-subtle);
      padding-top: 1.5rem;
    }
    .summary-content {
      background: var(--card-bg);
      backdrop-filter: var(--card-blur);
      -webkit-backdrop-filter: var(--card-blur);
      border-radius: 18px;
      padding: 1.5rem;
      border: var(--glass-border-subtle);
      box-shadow: var(--glass-shadow);
    }
    .summary-content h4 {
      font-size: 0.75rem;
      text-transform: uppercase;
      letter-spacing: 1px;
      color: var(--text-muted);
      margin-bottom: 0.5rem;
      font-weight: 700;
    }
    .summary-content p {
      font-size: 1rem;
      line-height: 1.5;
      color: var(--text-secondary);
      margin: 0;
      font-style: italic;
    }
    
    .article-metadata {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-top: 1.5rem;
      margin-bottom: 2.5rem;
      padding: 1rem 0;
      border-top: 1px solid var(--border-subtle);
      border-bottom: 1px solid var(--border-subtle);
      font-size: 0.9rem;
      color: var(--text-secondary);
      font-weight: 500;
    }
    .article-metadata .meta-left { display: flex; align-items: center; gap: 12px; }
    .article-metadata .author-name { font-weight: 700; color: var(--text-main); }
    .article-metadata .meta-right { color: var(--text-muted); }
    
    .reader-section {
      display: flex;
      align-items: center;
      gap: 16px;
      margin-bottom: 3rem;
      padding: 0.8rem 1rem 0.8rem 1.5rem;
      background: var(--card-bg);
      backdrop-filter: var(--card-blur);
      -webkit-backdrop-filter: var(--card-blur);
      border-radius: 60px;
      width: fit-content;
      border: var(--glass-border-subtle);
      box-shadow: var(--glass-shadow);
      transition: all 0.3s ease;
    }
    .reader-avatars { display: flex; }
    .mini-circle {
      width: 32px; height: 32px; border-radius: 50%;
      display: flex; align-items: center; justify-content: center;
      font-size: 0.75rem; font-weight: 700; color: white;
      margin-right: -8px; border: 2px solid var(--bg-color);
      position: relative;
      transition: transform 0.2s ease;
    }
    .mini-circle:hover { transform: scale(1.15); z-index: 1; }
    .mini-circle.gold { background: var(--accent-color); }
    .mini-circle.blue { background: #1a73e8; }
    .mini-circle.green { background: #34a853; }
    .mini-circle.purple { background: #9c27b0; }
    .mini-circle.orange { background: #fbbc04; }
    .reader-count { font-size: 0.9rem; color: var(--text-secondary); padding-left: 12px; font-weight: 500; }
    .reader-count strong { color: var(--text-main); font-weight: 700; }
    
    .glass-footer {
      position: fixed;
      bottom: 20px;
      left: 50%;
      transform: translateX(-50%);
      width: 90%;
      max-width: 720px;
      background: var(--card-bg);
      backdrop-filter: var(--card-blur);
      -webkit-backdrop-filter: var(--card-blur);
      border: var(--glass-border);
      border-radius: 24px;
      padding: 0.8rem 1.5rem;
      display: flex;
      justify-content: space-between;
      align-items: center;
      box-shadow: var(--glass-shadow);
      z-index: 100;
      gap: 0.8rem;
      transition: all 0.3s ease;
    }
    .footer-content {
      display: flex;
      align-items: center;
      justify-content: space-between;
      width: 100%;
      gap: 12px;
    }
    .link-pill {
      display: inline-flex;
      align-items: center;
      background: var(--input-bg);
      border: var(--glass-border-subtle);
      border-radius: 40px;
      padding: 0.35rem 1.1rem;
      max-width: 180px;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      font-size: 0.85rem;
      color: var(--text-secondary);
      flex-shrink: 1;
      min-width: 0;
      font-weight: 600;
    }
    .link-pill span { color: var(--text-muted); font-weight: 500; }
    @media (min-width: 600px) { .link-pill { max-width: 280px; } }
    .glass-actions {
      display: flex;
      align-items: center;
      gap: 8px;
      flex-shrink: 0;
    }
    
    .toast {
      position: fixed;
      bottom: 100px;
      left: 50%;
      transform: translateX(-50%) translateY(100px);
      background: var(--card-bg);
      backdrop-filter: var(--card-blur);
      -webkit-backdrop-filter: var(--card-blur);
      border: var(--glass-border);
      border-radius: 16px;
      padding: 12px 24px;
      color: var(--text-main);
      font-size: 0.9rem;
      box-shadow: var(--glass-shadow);
      z-index: 2000;
      opacity: 0;
      transition: all 0.4s cubic-bezier(0.34,1.56,0.64,1);
      pointer-events: none;
      font-weight: 600;
    }
    .toast.show {
      opacity: 1;
      transform: translateX(-50%) translateY(0);
      pointer-events: auto;
    }
    
    /* Login Modal */
    .login-overlay {
      position: fixed;
      top: 0; left: 0;
      width: 100vw; height: 100vh;
      background: rgba(0,0,0,0.25);
      backdrop-filter: blur(25px) saturate(180%);
      -webkit-backdrop-filter: blur(25px) saturate(180%);
      display: none;
      align-items: center;
      justify-content: center;
      z-index: 1000;
      padding: 1.5rem;
      opacity: 0;
      transition: opacity 0.3s cubic-bezier(0.25,0.8,0.25,1);
    }
    [data-theme="dark"] .login-overlay {
      background: rgba(0,0,0,0.55);
    }
    .login-overlay.active {
      display: flex;
      opacity: 1;
    }
    .login-modal {
      background: var(--card-bg);
      backdrop-filter: var(--card-blur);
      -webkit-backdrop-filter: var(--card-blur);
      border: var(--glass-border);
      border-radius: 28px;
      padding: 40px 32px 32px;
      max-width: 420px;
      width: 100%;
      box-shadow: 0 24px 48px rgba(0,0,0,0.15);
      position: relative;
      transform: scale(0.9) translateY(15px);
      transition: transform 0.4s cubic-bezier(0.25,0.8,0.25,1), box-shadow 0.3s ease;
      text-align: center;
    }
    [data-theme="dark"] .login-modal {
      box-shadow: 0 24px 48px rgba(0,0,0,0.55);
    }
    .login-overlay.active .login-modal {
      transform: scale(1) translateY(0);
    }
    .login-close {
      position: absolute; top: 16px; right: 18px;
      background: transparent; border: none; font-size: 1.4rem;
      color: var(--text-muted); cursor: pointer; transition: color 0.2s, transform 0.2s;
      display: flex; align-items: center; justify-content: center;
      width: 32px; height: 32px; border-radius: 50%;
    }
    .login-close:hover {
      color: var(--text-main);
      background: var(--input-bg);
      transform: rotate(90deg);
    }
    .login-modal h2 { font-size: 1.5rem; font-weight: 800; color: var(--text-main); margin-bottom: 0.5rem; }
    .login-modal p { color: var(--text-secondary); margin-bottom: 1.5rem; font-size: 0.95rem; line-height: 1.5; }
    .login-modal-buttons {
      display: flex;
      gap: 12px;
      justify-content: center;
      flex-wrap: wrap;
    }
    .login-btn-primary {
      background: var(--accent-color);
      color: #fff;
      border: none;
      padding: 0.75rem 2rem;
      border-radius: 30px;
      font-weight: 600;
      cursor: pointer;
      text-decoration: none;
      transition: background 0.2s;
      box-shadow: 0 4px 12px var(--accent-glow);
      display: inline-block;
    }
    .login-btn-primary:hover { background: var(--accent-hover); }
    .login-btn-secondary {
      background: transparent;
      border: var(--glass-border-subtle);
      color: var(--text-secondary);
      padding: 0.75rem 2rem;
      border-radius: 30px;
      font-weight: 600;
      cursor: pointer;
      text-decoration: none;
      transition: all 0.2s;
      display: inline-block;
    }
    .login-btn-secondary:hover { background: var(--input-bg); color: var(--text-main); }
    .login-modal-footer {
      margin-top: 1rem;
      font-size: 0.8rem !important;
      color: var(--text-muted) !important;
    }
    
    /* Deep Dive Modal */
    .deep-dive-overlay {
      position: fixed;
      top: 0; left: 0;
      width: 100vw; height: 100vh;
      background: rgba(0,0,0,0.25);
      backdrop-filter: blur(25px) saturate(180%);
      -webkit-backdrop-filter: blur(25px) saturate(180%);
      display: none;
      align-items: center;
      justify-content: center;
      z-index: 1000;
      padding: 1.5rem;
      opacity: 0;
      transition: opacity 0.3s cubic-bezier(0.25,0.8,0.25,1);
    }
    [data-theme="dark"] .deep-dive-overlay {
      background: rgba(0,0,0,0.55);
    }
    .deep-dive-overlay.active {
      display: flex;
      opacity: 1;
    }
    .deep-dive-modal {
      background: var(--card-bg);
      backdrop-filter: var(--card-blur);
      -webkit-backdrop-filter: var(--card-blur);
      border: var(--glass-border);
      border-radius: 28px;
      padding: 40px 32px 32px;
      max-width: 480px;
      width: 100%;
      box-shadow: 0 24px 48px rgba(0,0,0,0.15);
      position: relative;
      transform: scale(0.9) translateY(15px);
      transition: transform 0.4s cubic-bezier(0.25,0.8,0.25,1), box-shadow 0.3s ease;
    }
    [data-theme="dark"] .deep-dive-modal {
      box-shadow: 0 24px 48px rgba(0,0,0,0.55);
    }
    .deep-dive-overlay.active .deep-dive-modal {
      transform: scale(1) translateY(0);
    }
    
    .review-overlay {
      position: fixed;
      top: 0; left: 0;
      width: 100vw; height: 100vh;
      background: rgba(0,0,0,0.25);
      backdrop-filter: blur(25px) saturate(180%);
      -webkit-backdrop-filter: blur(25px) saturate(180%);
      display: none;
      align-items: center;
      justify-content: center;
      z-index: 1000;
      padding: 1.5rem;
      opacity: 0;
      transition: opacity 0.3s cubic-bezier(0.25,0.8,0.25,1);
    }
    [data-theme="dark"] .review-overlay {
      background: rgba(0,0,0,0.55);
    }
    .review-overlay.active {
      display: flex;
      opacity: 1;
    }
    .review-modal {
      background: var(--card-bg);
      backdrop-filter: var(--card-blur);
      -webkit-backdrop-filter: var(--card-blur);
      border: var(--glass-border);
      border-radius: 28px;
      padding: 36px 24px 28px 24px;
      max-width: 410px;
      width: 100%;
      box-shadow: 0 24px 48px rgba(0,0,0,0.15);
      position: relative;
      transform: scale(0.9) translateY(15px);
      transition: transform 0.4s cubic-bezier(0.25,0.8,0.25,1), box-shadow 0.3s ease;
      text-align: center;
    }
    [data-theme="dark"] .review-modal {
      box-shadow: 0 24px 48px rgba(0,0,0,0.55);
    }
    .review-overlay.active .review-modal {
      transform: scale(1) translateY(0);
    }
    .bonus-incentive-pill {
      display: inline-flex;
      align-items: center;
      gap: 5px;
      background: rgba(245,152,71,0.1);
      border: 1px solid rgba(245,152,71,0.25);
      border-radius: 30px;
      padding: 6px 14px;
      font-size: 0.75rem;
      font-weight: 700;
      color: var(--accent-color);
      margin-bottom: 1.2rem;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }
    .modal-close {
      position: absolute; top: 18px; right: 20px;
      background: transparent; border: none; font-size: 1.4rem;
      color: var(--text-muted); cursor: pointer; transition: color 0.2s, transform 0.2s;
      display: flex; align-items: center; justify-content: center;
      width: 32px; height: 32px; border-radius: 50%;
    }
    .modal-close:hover {
      color: var(--text-main);
      background: var(--input-bg);
      transform: rotate(90deg);
    }
    .review-modal h3 { font-size: 1.4rem; font-weight: 800; color: var(--text-main); margin-bottom: 0.4rem; letter-spacing: -0.5px; }
    .review-modal .sub-text { font-size: 0.9rem; color: var(--text-secondary); margin-bottom: 1.5rem; font-weight: 500; }
    .review-question { font-size: 1.1rem; color: var(--text-main); margin-bottom: 1.2rem; font-weight: 700; }
    .rating-scale {
      display: flex;
      gap: 14px;
      margin-bottom: 0.8rem;
      justify-content: center;
    }
    .rating-scale label {
      cursor: pointer;
      font-size: 2.3rem;
      transition: transform 0.3s cubic-bezier(0.175,0.885,0.32,1.275), opacity 0.2s;
      opacity: 0.55;
      user-select: none;
    }
    .rating-scale input[type="radio"] { display: none; }
    .rating-scale input[type="radio"]:checked + label {
      transform: scale(1.35);
      opacity: 1;
    }
    .rating-scale label:hover {
      transform: scale(1.2);
      opacity: 0.9;
    }
    .rating-description {
      font-size: 0.85rem;
      color: var(--accent-color);
      font-weight: 700;
      margin-bottom: 1.5rem;
      min-height: 18px;
      transition: color 0.2s;
    }
    .rating-glow-1 { box-shadow: 0 20px 40px rgba(255,59,48,0.15) !important; }
    .rating-glow-2 { box-shadow: 0 20px 40px rgba(255,149,0,0.15) !important; }
    .rating-glow-3 { box-shadow: 0 20px 40px rgba(142,142,147,0.15) !important; }
    .rating-glow-4 { box-shadow: 0 20px 40px rgba(52,199,89,0.15) !important; }
    .rating-glow-5 { box-shadow: 0 20px 40px var(--accent-glow) !important; }
    .feedback-options {
      display: none;
      margin-top: 1rem;
      text-align: left;
      max-height: 0;
      overflow: hidden;
      transition: max-height 0.4s cubic-bezier(0.4,0,0.2,1);
    }
    .feedback-options.visible {
      display: block;
      max-height: 200px;
    }
    .feedback-options p { font-size: 0.85rem; color: var(--text-secondary); margin-bottom: 0.8rem; font-weight: 700; text-align: center; text-transform: uppercase; letter-spacing: 0.5px;}
    .feedback-grid {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      justify-content: center;
    }
    .feedback-chip {
      background: var(--input-bg);
      border: var(--glass-border-subtle);
      color: var(--text-secondary);
      padding: 8px 14px;
      border-radius: 40px;
      font-size: 12px;
      font-weight: 600;
      cursor: pointer;
      transition: all 0.2s cubic-bezier(0.25,0.8,0.25,1);
      user-select: none;
    }
    .feedback-chip:hover {
      background: rgba(255,255,255,0.08);
      color: var(--text-main);
      transform: scale(1.02);
    }
    .feedback-chip.selected {
      background: var(--accent-color);
      color: #fff;
      border-color: var(--accent-color);
      box-shadow: 0 4px 10px var(--accent-glow);
      transform: scale(0.98);
    }
    .modal-actions {
      display: flex; gap: 10px; margin-top: 2rem; justify-content: center;
      width: 100%;
    }
    .btn-modal-secondary {
      background: transparent;
      border: var(--glass-border-subtle);
      color: var(--text-secondary);
      padding: 0.75rem 1.5rem; border-radius: 30px; font-weight: 600; cursor: pointer;
      transition: all 0.2s;
      flex: 1;
    }
    .btn-modal-secondary:hover { background: var(--input-bg); color: var(--text-main); }
    .btn-modal-primary {
      background: var(--accent-color); color: #fff; border: none;
      padding: 0.75rem 1.5rem; border-radius: 30px; font-weight: 600; cursor: pointer;
      transition: background 0.2s;
      box-shadow: 0 4px 12px var(--accent-glow);
      flex: 1;
    }
    .btn-modal-primary:hover { background: var(--accent-hover); }
    
    @media (max-width: 600px) {
      body { padding: 2rem 1rem 6rem 1rem; }
      .hero-title { font-size: 2rem; }
      .featured-gradient-card { min-height: 180px; padding: 1.5rem; }
      .catch-line-text { font-size: 1.25rem; }
      .glass-footer { bottom: 10px; width: 95%; border-radius: 20px; padding: 0.6rem 1rem; }
      .footer-content { gap: 8px; }
      .link-pill { max-width: 110px; font-size: 0.75rem; padding: 0.2rem 0.8rem; }
      .glass-icon-btn { width: 34px; height: 34px; }
      .glass-icon-btn svg { width: 16px; height: 16px; }
      .review-modal { padding: 24px 20px; margin: 1rem; }
      .login-modal { padding: 30px 20px 24px; }
      .deep-dive-modal { padding: 30px 20px 24px; }
    }
  `;
}

// ============================================
// ERROR / NOT FOUND PAGES
// ============================================

function renderNotFoundPage() {
  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Article Not Found | EasyRead</title>
  <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;600;700;800&display=swap" rel="stylesheet">
  <style>
    body {
      font-family: 'Plus Jakarta Sans', sans-serif;
      background: #f6f7f9;
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 100vh;
      margin: 0;
      padding: 20px;
    }
    .container {
      text-align: center;
      max-width: 500px;
    }
    h1 { font-size: 4rem; color: #f59847; margin: 0; }
    h2 { font-size: 1.5rem; color: #1c1c1e; margin: 0.5rem 0; }
    p { color: #5c5c60; margin: 1rem 0 2rem; }
    a {
      display: inline-block;
      background: #f59847;
      color: #fff;
      padding: 12px 28px;
      border-radius: 12px;
      text-decoration: none;
      font-weight: 600;
      transition: background 0.2s;
    }
    a:hover { background: #e08735; }
  </style>
</head>
<body>
  <div class="container">
    <h1>404</h1>
    <h2>Article Not Found</h2>
    <p>The article you're looking for doesn't exist or has been moved.</p>
    <a href="/">← Back to Home</a>
  </div>
</body>
</html>
  `;
}

function renderErrorPage(message) {
  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Something Went Wrong | EasyRead</title>
  <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;600;700;800&display=swap" rel="stylesheet">
  <style>
    body {
      font-family: 'Plus Jakarta Sans', sans-serif;
      background: #f6f7f9;
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 100vh;
      margin: 0;
      padding: 20px;
    }
    .container {
      text-align: center;
      max-width: 500px;
    }
    .emoji { font-size: 4rem; }
    h2 { font-size: 1.5rem; color: #1c1c1e; margin: 0.5rem 0; }
    p { color: #5c5c60; margin: 1rem 0 2rem; }
    .error-detail {
      background: #fff;
      border-radius: 12px;
      padding: 16px;
      font-size: 0.85rem;
      color: #ff3b30;
      border: 1px solid #ff3b30;
      margin-bottom: 2rem;
      word-break: break-word;
    }
    a {
      display: inline-block;
      background: #f59847;
      color: #fff;
      padding: 12px 28px;
      border-radius: 12px;
      text-decoration: none;
      font-weight: 600;
      transition: background 0.2s;
    }
    a:hover { background: #e08735; }
  </style>
</head>
<body>
  <div class="container">
    <div class="emoji">😵</div>
    <h2>Something Went Wrong</h2>
    <p>We're having trouble loading this article. Please try again later.</p>
    <div class="error-detail">${escapeHtml(message || 'Unknown error')}</div>
    <a href="/">← Back to Home</a>
  </div>
</body>
</html>
  `;
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