// api/og-image.js
// EasyRead OG Image - Clean, Minimal, GitHub-style

export const config = {
  runtime: 'edge',
};

export default async function handler(req) {
  try {
    const { searchParams } = new URL(req.url);
    
    const title = searchParams.get('title') || 'Understanding Made Easy';
    const description = searchParams.get('description') || '';
    const domain = searchParams.get('domain') || 'easytoread.vercel.app';
    const category = searchParams.get('category') || 'Article';
    const readTime = searchParams.get('readTime') || '5 min read';
    const theme = searchParams.get('theme') || 'dark';
    
    const svg = generateGitHubStyleOG({
      title: title.substring(0, 70),
      description: description.substring(0, 80),
      domain,
      category,
      readTime,
      theme
    });
    
    return new Response(svg, {
      headers: {
        'Content-Type': 'image/svg+xml',
        'Cache-Control': 'public, max-age=3600, s-maxage=86400',
      },
    });
    
  } catch (error) {
    return new Response('Failed to generate', { status: 500 });
  }
}

function generateGitHubStyleOG({ title, description, domain, category, readTime, theme }) {
  const isDark = theme !== 'light';
  
  // GitHub-style colors - clean, minimal
  const colors = {
    bg: isDark ? '#0d1117' : '#ffffff',
    cardBg: isDark ? '#161b22' : '#f6f8fa',
    border: isDark ? '#30363d' : '#d0d7de',
    text: isDark ? '#c9d1d9' : '#24292f',
    textSecondary: isDark ? '#8b949e' : '#57606a',
    accent: '#f59847',
    accent2: '#ffd700',
    blue: '#58a6ff',
    green: '#3fb950',
  };
  
  const titleLines = wrapText(title, 35);
  
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg width="1200" height="630" viewBox="0 0 1200 630" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="brandGrad" x1="0%" y1="0%" x2="100%" y2="0%">
      <stop offset="0%" style="stop-color:#f59847"/>
      <stop offset="100%" style="stop-color:#ffd700"/>
    </linearGradient>
  </defs>
  
  <!-- Main Background -->
  <rect width="1200" height="630" fill="${colors.bg}"/>
  
  <!-- Subtle border -->
  <rect x="1" y="1" width="1198" height="628" rx="12" fill="none" stroke="${colors.border}" stroke-width="1"/>
  
  <!-- ===== HEADER BAR ===== -->
  <!-- Top bar background -->
  <rect x="0" y="0" width="1200" height="70" fill="${isDark ? '#010409' : '#f6f8fa'}" opacity="0.8"/>
  <line x1="0" y1="70" x2="1200" y2="70" stroke="${colors.border}" stroke-width="1"/>
  
  <!-- EasyRead Logo -->
  <g transform="translate(40, 18)">
    <!-- Book icon -->
    <rect width="34" height="34" rx="9" fill="url(#brandGrad)"/>
    <svg x="7" y="7" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#ffffff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/>
      <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/>
    </svg>
    
    <!-- EasyRead text -->
    <text x="46" y="23" font-family="'Segoe UI', Arial, sans-serif" font-size="20" font-weight="700" fill="${colors.text}">
      Easy<span fill="${colors.accent}">Read</span>
    </text>
  </g>
  
  <!-- Nav items -->
  <g transform="translate(250, 26)" font-family="'Segoe UI', Arial, sans-serif" font-size="14" font-weight="600">
    <text x="0" y="0" fill="${colors.text}">Articles</text>
    <text x="80" y="0" fill="${colors.textSecondary}">Categories</text>
    <text x="175" y="0" fill="${colors.textSecondary}">About</text>
  </g>
  
  <!-- Search bar style -->
  <g transform="translate(880, 20)">
    <rect width="180" height="30" rx="6" fill="${colors.cardBg}" stroke="${colors.border}" stroke-width="1"/>
    <circle cx="15" cy="15" r="5" fill="none" stroke="${colors.textSecondary}" stroke-width="1.5"/>
    <line x1="19" y1="19" x2="24" y2="24" stroke="${colors.textSecondary}" stroke-width="1.5"/>
    <text x="32" y="20" font-family="'Segoe UI', Arial, sans-serif" font-size="12" fill="${colors.textSecondary}">Search</text>
  </g>
  
  <!-- ===== CATEGORY BADGE ===== -->
  <g transform="translate(60, 120)">
    <rect width="${Math.min(category.length * 9 + 45, 180)}" height="32" rx="16" fill="${isDark ? 'rgba(245,152,71,0.1)' : 'rgba(245,152,71,0.08)'}" stroke="rgba(245,152,71,0.3)" stroke-width="1"/>
    <circle cx="16" cy="16" r="4" fill="${colors.accent}"/>
    <text x="28" y="21" font-family="'Segoe UI', Arial, sans-serif" font-size="13" font-weight="600" fill="${colors.accent}">
      ${category.toUpperCase()}
    </text>
  </g>
  
  <!-- ===== TITLE ===== -->
  <g transform="translate(60, 190)">
    ${titleLines.map((line, i) => `
      <text x="0" y="${i * 54}" font-family="'Segoe UI', Arial, sans-serif" font-size="42" font-weight="700" fill="${colors.text}">
        ${escapeXml(line)}
      </text>
    `).join('')}
  </g>
  
  <!-- ===== DESCRIPTION ===== -->
  ${description ? `
  <g transform="translate(60, ${190 + titleLines.length * 54 + 20})">
    <text font-family="'Segoe UI', Arial, sans-serif" font-size="17" fill="${colors.textSecondary}">
      ${escapeXml(description)}
    </text>
  </g>
  ` : ''}
  
  <!-- ===== STATS ROW (GitHub-style) ===== -->
  <g transform="translate(60, 500)">
    <!-- Reading time -->
    <g>
      <circle cx="10" cy="-10" r="8" fill="none" stroke="${colors.textSecondary}" stroke-width="1.5"/>
      <polyline points="10,-14 10,-10 13,-7" fill="none" stroke="${colors.textSecondary}" stroke-width="1.5"/>
      <text x="26" y="-5" font-family="'Segoe UI', Arial, sans-serif" font-size="14" fill="${colors.textSecondary}">
        ${readTime}
      </text>
    </g>
    
    <!-- Source -->
    <g transform="translate(160, 0)">
      <circle cx="10" cy="-10" r="8" fill="none" stroke="${colors.textSecondary}" stroke-width="1.5"/>
      <text x="26" y="-5" font-family="'Segoe UI', Arial, sans-serif" font-size="14" fill="${colors.textSecondary}">
        ${escapeXml(domain)}
      </text>
    </g>
    
    <!-- Perspectives -->
    <g transform="translate(450, 0)">
      <circle cx="10" cy="-10" r="8" fill="none" stroke="${colors.green}" stroke-width="1.5"/>
      <text x="26" y="-5" font-family="'Segoe UI', Arial, sans-serif" font-size="14" fill="${colors.green}">
        5 Perspectives
      </text>
    </g>
  </g>
  
  <!-- ===== FOOTER ===== -->
  <line x1="0" y1="565" x2="1200" y2="565" stroke="${colors.border}" stroke-width="1"/>
  
  <g transform="translate(60, 600)">
    <text font-family="'Segoe UI', Arial, sans-serif" font-size="13" fill="${colors.textSecondary}">
      easytoread.vercel.app
    </text>
    
    <text x="1080" font-family="'Segoe UI', Arial, sans-serif" font-size="13" fill="${colors.textSecondary}" text-anchor="end">
      Your friend who makes you understand anything
    </text>
  </g>
</svg>`;
}

function wrapText(text, maxChars) {
  const words = text.split(' ');
  const lines = [];
  let currentLine = '';
  
  for (const word of words) {
    if ((currentLine + ' ' + word).trim().length <= maxChars) {
      currentLine = (currentLine + ' ' + word).trim();
    } else {
      if (currentLine) lines.push(currentLine);
      currentLine = word;
    }
  }
  
  if (currentLine) lines.push(currentLine);
  return lines.slice(0, 2);
}

function escapeXml(text) {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}