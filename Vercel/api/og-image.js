// api/og-image.js
// Premium OG Image Generator for EasyRead Articles

export const config = {
  runtime: 'edge',
};

export default async function handler(req) {
  try {
    const { searchParams } = new URL(req.url);
    
    // Get parameters
    const title = searchParams.get('title') || 'The Future of Artificial Intelligence';
    const description = searchParams.get('description') || 'Exploring how AI is transforming industries and reshaping the way we live, work, and think.';
    const domain = searchParams.get('domain') || 'easytoread.vercel.app';
    const category = searchParams.get('category') || 'Technology';
    const readTime = searchParams.get('readTime') || '5 min read';
    const theme = searchParams.get('theme') || 'dark';
    
    // Truncate text
    const truncateTitle = title.length > 80 ? title.substring(0, 77) + '...' : title;
    const truncateDesc = description.length > 120 ? description.substring(0, 117) + '...' : description;
    
    const svg = generatePremiumTemplate({
      title: truncateTitle,
      description: truncateDesc,
      domain,
      category,
      readTime,
      theme
    });
    
    return new Response(svg, {
      headers: {
        'Content-Type': 'image/svg+xml',
        'Cache-Control': 'public, max-age=3600, s-maxage=3600',
      },
    });
    
  } catch (error) {
    console.error('OG Image error:', error);
    return new Response('Failed to generate', { status: 500 });
  }
}

function generatePremiumTemplate({ title, description, domain, category, readTime, theme }) {
  const isDark = theme !== 'light';
  
  // Color palette
  const colors = isDark ? {
    bg: '#0a0a0f',
    bg2: '#1a1a2e',
    bg3: '#16213e',
    text: '#ffffff',
    textSecondary: 'rgba(255,255,255,0.7)',
    textMuted: 'rgba(255,255,255,0.5)',
    accent: '#f59847',
    accent2: '#ff6b6b',
    accent3: '#4ecdc4',
    border: 'rgba(255,255,255,0.08)',
    cardBg: 'rgba(255,255,255,0.03)',
    badgeBg: 'rgba(245,152,71,0.12)',
    badgeBorder: 'rgba(245,152,71,0.3)',
    glow1: 'rgba(245,152,71,0.08)',
    glow2: 'rgba(78,205,196,0.06)',
    glow3: 'rgba(255,107,107,0.05)',
  } : {
    bg: '#f8f9fa',
    bg2: '#ffffff',
    bg3: '#e9ecef',
    text: '#1a1a1a',
    textSecondary: 'rgba(0,0,0,0.7)',
    textMuted: 'rgba(0,0,0,0.5)',
    accent: '#f59847',
    accent2: '#ff6b6b',
    accent3: '#4ecdc4',
    border: 'rgba(0,0,0,0.08)',
    cardBg: 'rgba(255,255,255,0.8)',
    badgeBg: 'rgba(245,152,71,0.1)',
    badgeBorder: 'rgba(245,152,71,0.3)',
    glow1: 'rgba(245,152,71,0.05)',
    glow2: 'rgba(78,205,196,0.04)',
    glow3: 'rgba(255,107,107,0.03)',
  };
  
  // Wrap title into lines
  const titleLines = wrapText(title, 28);
  const descLines = wrapText(description, 55);
  
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg width="1200" height="630" viewBox="0 0 1200 630" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <!-- Background Gradient -->
    <linearGradient id="bgGrad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" style="stop-color:${colors.bg};stop-opacity:1" />
      <stop offset="50%" style="stop-color:${colors.bg2};stop-opacity:1" />
      <stop offset="100%" style="stop-color:${colors.bg3};stop-opacity:1" />
    </linearGradient>
    
    <!-- Accent Gradient -->
    <linearGradient id="accentGrad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" style="stop-color:${colors.accent};stop-opacity:1" />
      <stop offset="100%" style="stop-color:${colors.accent2};stop-opacity:1" />
    </linearGradient>
    
    <!-- Glow Effects -->
    <radialGradient id="glow1" cx="15%" cy="85%" r="40%">
      <stop offset="0%" style="stop-color:${colors.accent};stop-opacity:0.15" />
      <stop offset="100%" style="stop-color:${colors.accent};stop-opacity:0" />
    </radialGradient>
    
    <radialGradient id="glow2" cx="85%" cy="15%" r="35%">
      <stop offset="0%" style="stop-color:${colors.accent2};stop-opacity:0.1" />
      <stop offset="100%" style="stop-color:${colors.accent2};stop-opacity:0" />
    </radialGradient>
    
    <radialGradient id="glow3" cx="50%" cy="50%" r="50%">
      <stop offset="0%" style="stop-color:${colors.accent3};stop-opacity:0.08" />
      <stop offset="100%" style="stop-color:${colors.accent3};stop-opacity:0" />
    </radialGradient>
    
    <!-- Glass Card Effect -->
    <filter id="glassShadow">
      <feDropShadow dx="0" dy="4" stdDeviation="12" flood-opacity="0.2"/>
    </filter>
    
    <!-- Text Shadow -->
    <filter id="textShadow">
      <feDropShadow dx="0" dy="2" stdDeviation="4" flood-opacity="0.3"/>
    </filter>
  </defs>
  
  <!-- ===== BACKGROUND ===== -->
  <rect width="1200" height="630" fill="url(#bgGrad)"/>
  <rect width="1200" height="630" fill="url(#glow1)"/>
  <rect width="1200" height="630" fill="url(#glow2)"/>
  <rect width="1200" height="630" fill="url(#glow3)"/>
  
  <!-- Decorative Grid Pattern -->
  <g opacity="0.03">
    ${generateGridPattern(colors.accent)}
  </g>
  
  <!-- Floating Circles Decoration -->
  <g opacity="0.4">
    <circle cx="1000" cy="100" r="80" fill="none" stroke="${colors.accent}" stroke-width="1"/>
    <circle cx="1020" cy="120" r="40" fill="none" stroke="${colors.accent2}" stroke-width="1"/>
    <circle cx="150" cy="500" r="60" fill="none" stroke="${colors.accent3}" stroke-width="1"/>
  </g>
  
  <!-- ===== MAIN BORDER ===== -->
  <rect x="24" y="24" width="1152" height="582" rx="28" fill="none" stroke="${colors.border}" stroke-width="1.5"/>
  
  <!-- ===== HEADER SECTION ===== -->
  <g transform="translate(60, 55)">
    <!-- Logo -->
    <g filter="url(#glassShadow)">
      <rect width="44" height="44" rx="12" fill="url(#accentGrad)"/>
      <text x="22" y="30" font-family="'Segoe UI', Arial, sans-serif" font-size="22" font-weight="bold" fill="#ffffff" text-anchor="middle">E</text>
    </g>
    
    <!-- Brand Name -->
    <text x="58" y="30" font-family="'Segoe UI', Arial, sans-serif" font-size="24" font-weight="bold" fill="${colors.text}">
      Easy<span fill="${colors.accent}">Read</span>
    </text>
    
    <!-- Tagline -->
    <text x="58" y="48" font-family="'Segoe UI', Arial, sans-serif" font-size="11" fill="${colors.textMuted}" letter-spacing="2">
      SIMPLIFIED ARTICLES
    </text>
  </g>
  
  <!-- ===== CATEGORY BADGE ===== -->
  <g transform="translate(60, 135)">
    <rect width="${category.length * 12 + 50}" height="36" rx="18" fill="${colors.badgeBg}" stroke="${colors.badgeBorder}" stroke-width="1"/>
    <circle cx="18" cy="18" r="4" fill="${colors.accent}"/>
    <text x="30" y="23" font-family="'Segoe UI', Arial, sans-serif" font-size="13" font-weight="600" fill="${colors.accent}" letter-spacing="1.5">
      ${category.toUpperCase()}
    </text>
  </g>
  
  <!-- ===== TITLE SECTION ===== -->
  <g transform="translate(60, 205)">
    ${titleLines.map((line, i) => `
      <text x="0" y="${i * 62}" font-family="'Segoe UI', Arial, sans-serif" font-size="50" font-weight="bold" fill="${colors.text}" filter="url(#textShadow)">
        ${escapeXml(line)}
      </text>
    `).join('')}
  </g>
  
  <!-- ===== DESCRIPTION SECTION ===== -->
  <g transform="translate(60, ${205 + titleLines.length * 62 + 20})">
    <rect width="3" height="${descLines.length * 28}" rx="1.5" fill="url(#accentGrad)"/>
    ${descLines.map((line, i) => `
      <text x="20" y="${i * 28 + 5}" font-family="'Segoe UI', Arial, sans-serif" font-size="17" fill="${colors.textSecondary}">
        ${escapeXml(line)}
      </text>
    `).join('')}
  </g>
  
  <!-- ===== BOTTOM SECTION ===== -->
  <g transform="translate(60, 560)">
    <!-- Divider -->
    <line x1="0" y1="-15" x2="1080" y2="-15" stroke="${colors.border}" stroke-width="1"/>
    
    <!-- Source Domain -->
    <svg x="0" y="-8" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="${colors.accent}" stroke-width="2">
      <circle cx="12" cy="12" r="10"/>
      <line x1="2" y1="12" x2="22" y2="12"/>
      <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>
    </svg>
    <text x="28" y="5" font-family="'Segoe UI', Arial, sans-serif" font-size="15" fill="${colors.textSecondary}">
      ${escapeXml(domain)}
    </text>
    
    <!-- Reading Time -->
    <svg x="350" y="-8" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="${colors.accent}" stroke-width="2">
      <circle cx="12" cy="12" r="10"/>
      <polyline points="12 6 12 12 16 14"/>
    </svg>
    <text x="378" y="5" font-family="'Segoe UI', Arial, sans-serif" font-size="15" fill="${colors.textSecondary}">
      ${escapeXml(readTime)}
    </text>
    
    <!-- Stats Icon -->
    <svg x="530" y="-8" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="${colors.accent}" stroke-width="2">
      <line x1="18" y1="20" x2="18" y2="10"/>
      <line x1="12" y1="20" x2="12" y2="4"/>
      <line x1="6" y1="20" x2="6" y2="14"/>
    </svg>
    <text x="558" y="5" font-family="'Segoe UI', Arial, sans-serif" font-size="15" fill="${colors.textSecondary}">
      Personalized
    </text>
    
    <!-- Right Side -->
    <text x="1080" y="5" font-family="'Segoe UI', Arial, sans-serif" font-size="15" fill="${colors.textSecondary}" text-anchor="end">
      easytoread.vercel.app
    </text>
  </g>
  
  <!-- Decorative Corner Accent -->
  <path d="M 24 52 Q 24 24 52 24" fill="none" stroke="${colors.accent}" stroke-width="3" opacity="0.5"/>
  <path d="M 1176 578 Q 1176 606 1148 606" fill="none" stroke="${colors.accent}" stroke-width="3" opacity="0.5"/>
</svg>`;
}

// Helper: Wrap text into lines
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
  return lines;
}

// Helper: Generate grid pattern
function generateGridPattern(color) {
  let grid = '';
  for (let x = 0; x < 1200; x += 60) {
    grid += `<line x1="${x}" y1="0" x2="${x}" y2="630" stroke="${color}" stroke-width="0.5"/>`;
  }
  for (let y = 0; y < 630; y += 60) {
    grid += `<line x1="0" y1="${y}" x2="1200" y2="${y}" stroke="${color}" stroke-width="0.5"/>`;
  }
  return grid;
}

// Helper: Escape XML
function escapeXml(text) {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}