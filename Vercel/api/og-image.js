// api/og-image.js
// EasyRead OG Image - Premium Glass Design with Rich Gradients

export const config = {
  runtime: 'edge',
};

export default async function handler(req) {
  try {
    const { searchParams } = new URL(req.url);
    
    const title = searchParams.get('title') || 'Understanding Made Easy';
    const description = searchParams.get('description') || 'Explained in a way only you understand';
    const domain = searchParams.get('domain') || 'easytoread.vercel.app';
    const category = searchParams.get('category') || 'Learning';
    const readTime = searchParams.get('readTime') || '5 min read';
    const views = searchParams.get('views') || '1.2k';
    const theme = searchParams.get('theme') || 'dark';
    
    const svg = generatePremiumOG({
      title: title.substring(0, 80),
      description: description.substring(0, 100),
      domain,
      category,
      readTime,
      views,
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

function generatePremiumOG({ title, description, domain, category, readTime, views, theme }) {
  const isDark = theme !== 'light';
  
  // Rich gradient palettes
  const gradients = [
    { bg: ['#0f0c29', '#302b63', '#24243e'], accent: '#f59847', accent2: '#ffd700' },
    { bg: ['#1a1a2e', '#16213e', '#0f3460'], accent: '#4ecdc4', accent2: '#45b7d1' },
    { bg: ['#2c1a1a', '#1a1a2e', '#16213e'], accent: '#ff6b6b', accent2: '#f59847' },
    { bg: ['#1b2838', '#101820', '#0f3460'], accent: '#5ee7df', accent2: '#b490ca' },
    { bg: ['#1e3a2a', '#0f2017', '#16213e'], accent: '#7ee8a2', accent2: '#4ecdc4' },
    { bg: ['#2d1b2e', '#170d18', '#1a1a2e'], accent: '#e0aaff', accent2: '#f59847' },
  ];
  
  const hash = title.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
  const grad = gradients[hash % gradients.length];
  
  const titleLines = wrapText(title, 28);
  
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg width="1200" height="630" viewBox="0 0 1200 630" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <!-- Rich background gradient -->
    <linearGradient id="bgGrad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" style="stop-color:${grad.bg[0]}"/>
      <stop offset="50%" style="stop-color:${grad.bg[1]}"/>
      <stop offset="100%" style="stop-color:${grad.bg[2]}"/>
    </linearGradient>
    
    <!-- Accent gradient -->
    <linearGradient id="accentGrad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" style="stop-color:${grad.accent}"/>
      <stop offset="100%" style="stop-color:${grad.accent2}"/>
    </linearGradient>
    
    <!-- Glass card gradient -->
    <linearGradient id="glassGrad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" style="stop-color:rgba(255,255,255,0.08)"/>
      <stop offset="100%" style="stop-color:rgba(255,255,255,0.02)"/>
    </linearGradient>
    
    <!-- Glow effects -->
    <radialGradient id="glow1" cx="10%" cy="90%" r="40%">
      <stop offset="0%" style="stop-color:${grad.accent};stop-opacity:0.15"/>
      <stop offset="100%" style="stop-color:${grad.accent};stop-opacity:0"/>
    </radialGradient>
    
    <radialGradient id="glow2" cx="90%" cy="10%" r="35%">
      <stop offset="0%" style="stop-color:${grad.accent2};stop-opacity:0.12"/>
      <stop offset="100%" style="stop-color:${grad.accent2};stop-opacity:0"/>
    </radialGradient>
    
    <radialGradient id="glow3" cx="50%" cy="50%" r="50%">
      <stop offset="0%" style="stop-color:#ffffff;stop-opacity:0.03"/>
      <stop offset="100%" style="stop-color:#ffffff;stop-opacity:0"/>
    </radialGradient>
    
    <!-- Shadows -->
    <filter id="softShadow">
      <feDropShadow dx="0" dy="4" stdDeviation="16" flood-color="#000000" flood-opacity="0.3"/>
    </filter>
    
    <filter id="textShadow">
      <feDropShadow dx="0" dy="1" stdDeviation="3" flood-color="#000000" flood-opacity="0.2"/>
    </filter>
    
    <filter id="glassBlur">
      <feGaussianBlur stdDeviation="2"/>
    </filter>
  </defs>
  
  <!-- Background layers -->
  <rect width="1200" height="630" fill="url(#bgGrad)"/>
  <rect width="1200" height="630" fill="url(#glow1)"/>
  <rect width="1200" height="630" fill="url(#glow2)"/>
  <rect width="1200" height="630" fill="url(#glow3)"/>
  
  <!-- Decorative gradient orbs -->
  <circle cx="100" cy="530" r="180" fill="${grad.accent}" opacity="0.08"/>
  <circle cx="1100" cy="100" r="150" fill="${grad.accent2}" opacity="0.06"/>
  <circle cx="600" cy="315" r="250" fill="none" stroke="${grad.accent}" stroke-width="1" opacity="0.05"/>
  
  <!-- Subtle grid pattern -->
  <g opacity="0.02">
    ${generateGrid()}
  </g>
  
  <!-- Main Glass Card -->
  <g filter="url(#softShadow)">
    <rect x="50" y="35" width="1100" height="560" rx="32" fill="url(#glassGrad)" stroke="rgba(255,255,255,0.1)" stroke-width="1.5"/>
    
    <!-- Inner highlight -->
    <rect x="52" y="37" width="1096" height="556" rx="30" fill="none" stroke="rgba(255,255,255,0.04)" stroke-width="1"/>
  </g>
  
  <!-- ===== HEADER ===== -->
  <g transform="translate(90, 80)">
    <!-- Logo -->
    <g filter="url(#softShadow)">
      <rect width="52" height="52" rx="16" fill="url(#accentGrad)"/>
      <svg x="13" y="13" width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#ffffff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/>
        <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/>
        <path d="M9.5 7h5M9.5 11h5" stroke-width="1.5"/>
      </svg>
    </g>
    
    <!-- Brand Name -->
    <text x="68" y="30" font-family="'Plus Jakarta Sans', 'Segoe UI', Arial, sans-serif" font-size="24" font-weight="800" fill="#ffffff">
      Easy<span fill="${grad.accent}">Read</span>
    </text>
    
    <!-- Tagline -->
    <text x="68" y="48" font-family="'Segoe UI', Arial, sans-serif" font-size="11" fill="rgba(255,255,255,0.45)" letter-spacing="1.2">
      YOUR FRIEND WHO MAKES YOU UNDERSTAND
    </text>
  </g>
  
  <!-- Category Badge -->
  <g transform="translate(90, 155)">
    <rect width="${Math.min(category.length * 11 + 50, 220)}" height="36" rx="18" fill="rgba(255,255,255,0.05)" stroke="${grad.accent}" stroke-opacity="0.3" stroke-width="1.5"/>
    <circle cx="18" cy="18" r="4" fill="${grad.accent}"/>
    <text x="30" y="23" font-family="'Segoe UI', Arial, sans-serif" font-size="13" font-weight="600" fill="${grad.accent}" letter-spacing="0.8">
      ${category.toUpperCase()}
    </text>
  </g>
  
  <!-- ===== TITLE ===== -->
  <g transform="translate(90, 230)">
    ${titleLines.map((line, i) => `
      <text x="0" y="${i * 60}" font-family="'Plus Jakarta Sans', 'Segoe UI', Arial, sans-serif" font-size="50" font-weight="800" fill="#ffffff" filter="url(#textShadow)">
        ${escapeXml(line)}
      </text>
    `).join('')}
  </g>
  
  <!-- ===== DESCRIPTION ===== -->
  <g transform="translate(90, ${230 + titleLines.length * 60 + 20})">
    <!-- Accent line -->
    <rect x="0" y="-5" width="3" height="50" rx="1.5" fill="url(#accentGrad)"/>
    
    <text x="20" y="10" font-family="'Segoe UI', Arial, sans-serif" font-size="17" fill="rgba(255,255,255,0.7)" line-height="1.4">
      ${escapeXml(description)}
    </text>
  </g>
  
  <!-- ===== STATS PILLS ===== -->
  <g transform="translate(90, 465)">
    <!-- Read time pill -->
    <rect width="110" height="30" rx="15" fill="rgba(255,255,255,0.06)" stroke="rgba(255,255,255,0.08)" stroke-width="1"/>
    <svg x="12" y="8" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="${grad.accent}" stroke-width="2">
      <circle cx="12" cy="12" r="10"/>
      <polyline points="12 6 12 12 16 14"/>
    </svg>
    <text x="32" y="19" font-family="'Segoe UI', Arial, sans-serif" font-size="12" fill="rgba(255,255,255,0.6)">${readTime}</text>
    
    <!-- Views pill -->
    <rect x="122" width="100" height="30" rx="15" fill="rgba(255,255,255,0.06)" stroke="rgba(255,255,255,0.08)" stroke-width="1"/>
    <svg x="12" y="8" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="${grad.accent}" stroke-width="2">
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
      <circle cx="12" cy="12" r="3"/>
    </svg>
    <text x="32" y="19" font-family="'Segoe UI', Arial, sans-serif" font-size="12" fill="rgba(255,255,255,0.6)">${views}</text>
    
    <!-- Perspectives pill -->
    <rect x="234" width="150" height="30" rx="15" fill="rgba(255,255,255,0.06)" stroke="rgba(255,255,255,0.08)" stroke-width="1"/>
    <svg x="12" y="8" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="${grad.accent2}" stroke-width="2">
      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
      <circle cx="9" cy="7" r="4"/>
      <path d="M23 21v-2a4 4 0 0 0-3-3.87"/>
    </svg>
    <text x="32" y="19" font-family="'Segoe UI', Arial, sans-serif" font-size="12" fill="rgba(255,255,255,0.6)">5 Perspectives</text>
  </g>
  
  <!-- ===== FOOTER ===== -->
  <g transform="translate(90, 540)">
    <line x1="0" y1="-10" x2="1020" y2="-10" stroke="rgba(255,255,255,0.06)" stroke-width="1"/>
    
    <!-- Domain -->
    <text x="0" y="5" font-family="'Segoe UI', Arial, sans-serif" font-size="14" fill="rgba(255,255,255,0.5)">
      ${escapeXml(domain)}
    </text>
    
    <!-- Read button -->
    <g transform="translate(930, -25)">
      <rect width="90" height="40" rx="20" fill="url(#accentGrad)" filter="url(#softShadow)"/>
      <text x="45" y="26" font-family="'Segoe UI', Arial, sans-serif" font-size="14" font-weight="700" fill="#ffffff" text-anchor="middle">Read →</text>
    </g>
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

function generateGrid() {
  let lines = '';
  for (let x = 0; x < 1200; x += 40) {
    lines += `<line x1="${x}" y1="0" x2="${x}" y2="630" stroke="#ffffff" stroke-width="0.3"/>`;
  }
  for (let y = 0; y < 630; y += 40) {
    lines += `<line x1="0" y1="${y}" x2="1200" y2="${y}" stroke="#ffffff" stroke-width="0.3"/>`;
  }
  return lines;
}

function escapeXml(text) {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}