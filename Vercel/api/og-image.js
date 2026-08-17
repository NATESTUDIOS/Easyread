// api/og-image.js
// EasyRead OG Image Generator - "Your friend who can make you understand anything"

export const config = {
  runtime: 'edge', // Edge runtime for speed
};

export default async function handler(req) {
  try {
    const { searchParams } = new URL(req.url);
    
    // Get parameters
    const title = searchParams.get('title') || 'Understanding Made Easy';
    const description = searchParams.get('description') || 'Your friend who can make you understand anything';
    const domain = searchParams.get('domain') || 'easytoread.vercel.app';
    const category = searchParams.get('category') || 'Learning';
    const readTime = searchParams.get('readTime') || '5 min read';
    const personas = searchParams.get('personas') || '5'; // Number of perspectives
    const theme = searchParams.get('theme') || 'dark';
    
    // Truncate long text
    const truncateTitle = title.length > 90 ? title.substring(0, 87) + '...' : title;
    const truncateDesc = description.length > 110 ? description.substring(0, 107) + '...' : description;
    
    const svg = generateEasyReadOG({
      title: truncateTitle,
      description: truncateDesc,
      domain,
      category,
      readTime,
      personas,
      theme
    });
    
    return new Response(svg, {
      headers: {
        'Content-Type': 'image/svg+xml',
        'Cache-Control': 'public, max-age=3600, s-maxage=86400',
        'CDN-Cache-Control': 'public, max-age=86400',
      },
    });
    
  } catch (error) {
    console.error('OG Image error:', error);
    return new Response('Failed to generate image', { status: 500 });
  }
}

function generateEasyReadOG({ title, description, domain, category, readTime, personas, theme }) {
  const isDark = theme !== 'light';
  
  const colors = {
    bg1: isDark ? '#0a0a0f' : '#f8f9fa',
    bg2: isDark ? '#1a1a2e' : '#ffffff',
    bg3: isDark ? '#16213e' : '#e9ecef',
    text: isDark ? '#ffffff' : '#1a1a1a',
    textSecondary: isDark ? 'rgba(255,255,255,0.75)' : 'rgba(0,0,0,0.65)',
    textMuted: isDark ? 'rgba(255,255,255,0.5)' : 'rgba(0,0,0,0.4)',
    accent: '#f59847',
    accent2: '#ff6b6b',
    accent3: '#ffd93d',
    border: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)',
    badgeBg: 'rgba(245,152,71,0.12)',
    badgeBorder: 'rgba(245,152,71,0.35)',
    cardBg: isDark ? 'rgba(255,255,255,0.03)' : 'rgba(255,255,255,0.8)',
  };
  
  // Wrap text
  const titleLines = wrapText(title, 25);
  const descLines = wrapText(description, 55);
  
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg width="1200" height="630" viewBox="0 0 1200 630" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="bgGrad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" style="stop-color:${colors.bg1}"/>
      <stop offset="50%" style="stop-color:${colors.bg2}"/>
      <stop offset="100%" style="stop-color:${colors.bg3}"/>
    </linearGradient>
    
    <linearGradient id="brandGrad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" style="stop-color:#f59847"/>
      <stop offset="100%" style="stop-color:#ff6b6b"/>
    </linearGradient>
    
    <radialGradient id="glow1" cx="20%" cy="80%" r="45%">
      <stop offset="0%" style="stop-color:#f59847;stop-opacity:0.12"/>
      <stop offset="100%" style="stop-color:#f59847;stop-opacity:0"/>
    </radialGradient>
    
    <radialGradient id="glow2" cx="80%" cy="20%" r="40%">
      <stop offset="0%" style="stop-color:#ffd93d;stop-opacity:0.08"/>
      <stop offset="100%" style="stop-color:#ffd93d;stop-opacity:0"/>
    </radialGradient>
    
    <filter id="shadow" x="-10%" y="-10%" width="120%" height="120%">
      <feDropShadow dx="0" dy="3" stdDeviation="6" flood-opacity="0.25"/>
    </filter>
    
    <filter id="textGlow">
      <feDropShadow dx="0" dy="1" stdDeviation="3" flood-opacity="0.3"/>
    </filter>
  </defs>
  
  <!-- Background -->
  <rect width="1200" height="630" fill="url(#bgGrad)"/>
  <rect width="1200" height="630" fill="url(#glow1)"/>
  <rect width="1200" height="630" fill="url(#glow2)"/>
  
  <!-- Subtle pattern -->
  <g opacity="${isDark ? '0.04' : '0.03'}">
    ${generatePattern(colors.accent)}
  </g>
  
  <!-- Main border -->
  <rect x="24" y="24" width="1152" height="582" rx="24" fill="none" stroke="${colors.border}" stroke-width="1.5"/>
  
  <!-- Corner accents -->
  <path d="M 24 48 Q 24 24 48 24" fill="none" stroke="${colors.accent}" stroke-width="2.5" opacity="0.6"/>
  <path d="M 1176 582 Q 1176 606 1152 606" fill="none" stroke="${colors.accent}" stroke-width="2.5" opacity="0.6"/>
  
  <!-- ===== HEADER ===== -->
  <g transform="translate(60, 55)">
    <!-- Logo icon - Book with spark -->
    <g filter="url(#shadow)">
      <rect width="46" height="46" rx="13" fill="url(#brandGrad)"/>
      <svg x="9" y="9" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#ffffff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/>
        <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/>
        <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" fill="#ffffff" stroke="none" opacity="0.3"/>
      </svg>
    </g>
    
    <!-- Brand name -->
    <text x="60" y="28" font-family="'Segoe UI', Arial, sans-serif" font-size="26" font-weight="bold" fill="${colors.text}">
      Easy<span fill="${colors.accent}">Read</span>
    </text>
    
    <!-- Tagline -->
    <text x="60" y="46" font-family="'Segoe UI', Arial, sans-serif" font-size="11" fill="${colors.textMuted}" letter-spacing="0.5">
      Your friend who can make you understand anything
    </text>
  </g>
  
  <!-- ===== CATEGORY BADGE ===== -->
  <g transform="translate(60, 130)">
    <rect width="${Math.min(category.length * 12 + 55, 250)}" height="38" rx="19" fill="${colors.badgeBg}" stroke="${colors.badgeBorder}" stroke-width="1.5"/>
    <circle cx="19" cy="19" r="4" fill="${colors.accent}"/>
    <text x="32" y="24" font-family="'Segoe UI', Arial, sans-serif" font-size="14" font-weight="600" fill="${colors.accent}" letter-spacing="1.2">
      ${category.toUpperCase()}
    </text>
    
    <!-- Personas count -->
    <g transform="translate(${Math.min(category.length * 12 + 75, 270)}, 0)">
      <rect width="120" height="38" rx="19" fill="rgba(255,217,61,0.1)" stroke="rgba(255,217,61,0.3)" stroke-width="1.5"/>
      <text x="60" y="24" font-family="'Segoe UI', Arial, sans-serif" font-size="14" font-weight="600" fill="#ffd93d" text-anchor="middle">
        ${personas} Perspectives
      </text>
    </g>
  </g>
  
  <!-- ===== TITLE ===== -->
  <g transform="translate(60, 210)">
    ${titleLines.map((line, i) => `
      <text x="0" y="${i * 60}" font-family="'Segoe UI', Arial, sans-serif" font-size="48" font-weight="bold" fill="${colors.text}" filter="url(#textGlow)">
        ${escapeXml(line)}
      </text>
    `).join('')}
  </g>
  
  <!-- ===== DESCRIPTION ===== -->
  <g transform="translate(60, ${210 + titleLines.length * 60 + 20})">
    <!-- Accent line -->
    <rect width="4" height="${descLines.length * 28 + 10}" rx="2" fill="url(#brandGrad)"/>
    
    ${descLines.map((line, i) => `
      <text x="22" y="${i * 28 + 22}" font-family="'Segoe UI', Arial, sans-serif" font-size="17" fill="${colors.textSecondary}">
        ${escapeXml(line)}
      </text>
    `).join('')}
  </g>
  
  <!-- ===== BOTTOM INFO BAR ===== -->
  <g transform="translate(60, 565)">
    <line x1="0" y1="-20" x2="1080" y2="-20" stroke="${colors.border}" stroke-width="1"/>
    
    <!-- Source -->
    <svg x="0" y="-8" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="${colors.accent}" stroke-width="2">
      <circle cx="12" cy="12" r="10"/>
      <line x1="2" y1="12" x2="22" y2="12"/>
      <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>
    </svg>
    <text x="28" y="6" font-family="'Segoe UI', Arial, sans-serif" font-size="15" fill="${colors.textSecondary}">
      ${escapeXml(domain)}
    </text>
    
    <!-- Reading time -->
    <svg x="320" y="-8" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="${colors.accent}" stroke-width="2">
      <circle cx="12" cy="12" r="10"/>
      <polyline points="12 6 12 12 16 14"/>
    </svg>
    <text x="348" y="6" font-family="'Segoe UI', Arial, sans-serif" font-size="15" fill="${colors.textSecondary}">
      ${escapeXml(readTime)}
    </text>
    
    <!-- EasyRead signature -->
    <text x="1080" y="6" font-family="'Segoe UI', Arial, sans-serif" font-size="15" font-weight="600" fill="${colors.accent}" text-anchor="end">
      easytoread.vercel.app
    </text>
  </g>
  
  <!-- Decorative sparkle -->
  <g opacity="0.3">
    <circle cx="1050" cy="110" r="3" fill="${colors.accent3}"/>
    <circle cx="1100" cy="140" r="2" fill="${colors.accent}"/>
    <circle cx="1000" cy="160" r="2.5" fill="${colors.accent2}"/>
  </g>
</svg>`;
}

// Helper: Wrap text
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
  return lines.slice(0, 3); // Max 3 lines
}

// Helper: Generate pattern
function generatePattern(color) {
  let circles = '';
  for (let i = 0; i < 40; i++) {
    const x = (i * 37) % 1200;
    const y = (i * 53) % 630;
    const r = 15 + (i * 7) % 45;
    circles += `<circle cx="${x}" cy="${y}" r="${r}" fill="none" stroke="${color}" stroke-width="0.5"/>`;
  }
  return circles;
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