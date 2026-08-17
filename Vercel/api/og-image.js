// api/og-image.js
// EasyRead OG Image Generator - Matches the app's card design

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
    
    const svg = generateCardStyleOG({
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

function generateCardStyleOG({ title, description, domain, category, readTime, views, theme }) {
  const isDark = theme !== 'light';
  
  // Beautiful card-like gradient backgrounds
  const gradients = [
    ['#1a1a2e', '#16213e', '#0f3460'], // Deep blue
    ['#2c1a1a', '#1a1a2e', '#16213e'], // Red-purple
    ['#1b2838', '#101820', '#0f3460'], // Ocean
    ['#1e3a2a', '#0f2017', '#16213e'], // Forest
    ['#2d1b2e', '#170d18', '#1a1a2e'], // Purple
    ['#2a2015', '#140f0a', '#16213e'], // Warm
  ];
  
  // Pick gradient based on title hash
  const hash = title.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
  const gradient = gradients[hash % gradients.length];
  
  const colors = {
    text: '#ffffff',
    textSecondary: 'rgba(255,255,255,0.75)',
    textMuted: 'rgba(255,255,255,0.5)',
    accent: '#f59847',
    accentLight: 'rgba(245,152,71,0.15)',
    border: 'rgba(255,255,255,0.08)',
    borderSubtle: 'rgba(255,255,255,0.04)',
    tagBg: 'rgba(255,255,255,0.06)',
    tagText: 'rgba(255,255,255,0.7)',
  };
  
  const titleLines = wrapText(title, 30);
  
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg width="1200" height="630" viewBox="0 0 1200 630" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="cardBg" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" style="stop-color:${gradient[0]}"/>
      <stop offset="50%" style="stop-color:${gradient[1]}"/>
      <stop offset="100%" style="stop-color:${gradient[2]}"/>
    </linearGradient>
    
    <linearGradient id="brandGrad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" style="stop-color:#f59847"/>
      <stop offset="100%" style="stop-color:#ffd700"/>
    </linearGradient>
    
    <radialGradient id="glowTop" cx="50%" cy="0%" r="60%">
      <stop offset="0%" style="stop-color:#f59847;stop-opacity:0.08"/>
      <stop offset="100%" style="stop-color:#f59847;stop-opacity:0"/>
    </radialGradient>
    
    <radialGradient id="glowBottom" cx="50%" cy="100%" r="50%">
      <stop offset="0%" style="stop-color:#ff6b6b;stop-opacity:0.06"/>
      <stop offset="100%" style="stop-color:#ff6b6b;stop-opacity:0"/>
    </radialGradient>
    
    <filter id="cardShadow">
      <feDropShadow dx="0" dy="8" stdDeviation="24" flood-opacity="0.3"/>
    </filter>
    
    <filter id="textShadow">
      <feDropShadow dx="0" dy="2" stdDeviation="4" flood-opacity="0.2"/>
    </filter>
  </defs>
  
  <!-- Background -->
  <rect width="1200" height="630" fill="${gradient[0]}"/>
  <rect width="1200" height="630" fill="url(#cardBg)"/>
  <rect width="1200" height="630" fill="url(#glowTop)"/>
  <rect width="1200" height="630" fill="url(#glowBottom)"/>
  
  <!-- Subtle pattern overlay -->
  <g opacity="0.02">
    ${generatePattern()}
  </g>
  
  <!-- Main Card Container -->
  <g filter="url(#cardShadow)">
    <rect x="60" y="40" width="1080" height="550" rx="28" fill="rgba(255,255,255,0.03)" stroke="${colors.border}" stroke-width="1"/>
    <rect x="60" y="40" width="1080" height="550" rx="28" fill="none" stroke="rgba(255,255,255,0.02)" stroke-width="8"/>
  </g>
  
  <!-- ===== HEADER INSIDE CARD ===== -->
  <g transform="translate(100, 80)">
    <!-- Avatar/Icon -->
    <rect width="48" height="48" rx="14" fill="url(#brandGrad)"/>
    <svg x="12" y="12" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#ffffff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/>
      <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/>
    </svg>
    
    <!-- Brand Info -->
    <text x="64" y="24" font-family="'Segoe UI', Arial, sans-serif" font-size="22" font-weight="bold" fill="#ffffff">
      Easy<span fill="#f59847">Read</span>
    </text>
    <text x="64" y="42" font-family="'Segoe UI', Arial, sans-serif" font-size="12" fill="${colors.textMuted}" letter-spacing="1">
      YOUR FRIEND WHO MAKES YOU UNDERSTAND
    </text>
    
    <!-- Category Badge -->
    <g transform="translate(880, 8)">
      <rect width="${Math.min(category.length * 10 + 40, 200)}" height="32" rx="16" fill="${colors.accentLight}" stroke="rgba(245,152,71,0.3)" stroke-width="1"/>
      <circle cx="16" cy="16" r="4" fill="#f59847"/>
      <text x="28" y="21" font-family="'Segoe UI', Arial, sans-serif" font-size="13" font-weight="600" fill="#f59847" letter-spacing="0.5">
        ${category.toUpperCase()}
      </text>
    </g>
  </g>
  
  <!-- ===== TITLE SECTION ===== -->
  <g transform="translate(100, 180)">
    ${titleLines.map((line, i) => `
      <text x="0" y="${i * 58}" font-family="'Segoe UI', Arial, sans-serif" font-size="46" font-weight="bold" fill="${colors.text}" filter="url(#textShadow)">
        ${escapeXml(line)}
      </text>
    `).join('')}
  </g>
  
  <!-- ===== DESCRIPTION ===== -->
  <g transform="translate(100, ${180 + titleLines.length * 58 + 15})">
    <text font-family="'Segoe UI', Arial, sans-serif" font-size="18" fill="${colors.textSecondary}" line-height="1.5">
      ${escapeXml(description)}
    </text>
  </g>
  
  <!-- ===== TAGS ROW ===== -->
  <g transform="translate(100, 440)">
    <rect width="120" height="28" rx="14" fill="${colors.tagBg}" stroke="${colors.borderSubtle}" stroke-width="1"/>
    <text x="60" y="19" font-family="'Segoe UI', Arial, sans-serif" font-size="12" fill="${colors.tagText}" text-anchor="middle">${readTime}</text>
    
    <rect x="132" width="100" height="28" rx="14" fill="${colors.tagBg}" stroke="${colors.borderSubtle}" stroke-width="1"/>
    <text x="182" y="19" font-family="'Segoe UI', Arial, sans-serif" font-size="12" fill="${colors.tagText}" text-anchor="middle">${views} views</text>
    
    <rect x="244" width="140" height="28" rx="14" fill="${colors.tagBg}" stroke="${colors.borderSubtle}" stroke-width="1"/>
    <text x="314" y="19" font-family="'Segoe UI', Arial, sans-serif" font-size="12" fill="${colors.tagText}" text-anchor="middle">Multiple Perspectives</text>
  </g>
  
  <!-- ===== BOTTOM BAR ===== -->
  <g transform="translate(100, 530)">
    <line x1="0" y1="-15" x2="1000" y2="-15" stroke="${colors.border}" stroke-width="1"/>
    
    <!-- Avatar stack -->
    <circle cx="16" cy="0" r="14" fill="#e83e8c" stroke="rgba(255,255,255,0.3)" stroke-width="2"/>
    <text x="16" y="5" font-family="'Segoe UI', Arial, sans-serif" font-size="11" font-weight="bold" fill="#fff" text-anchor="middle">ER</text>
    
    <circle cx="42" cy="0" r="14" fill="#0d6efd" stroke="rgba(255,255,255,0.3)" stroke-width="2"/>
    <text x="42" y="5" font-family="'Segoe UI', Arial, sans-serif" font-size="11" font-weight="bold" fill="#fff" text-anchor="middle">AI</text>
    
    <circle cx="68" cy="0" r="14" fill="#20c997" stroke="rgba(255,255,255,0.3)" stroke-width="2"/>
    <text x="68" y="5" font-family="'Segoe UI', Arial, sans-serif" font-size="11" font-weight="bold" fill="#fff" text-anchor="middle">⚡</text>
    
    <!-- Domain -->
    <text x="100" y="5" font-family="'Segoe UI', Arial, sans-serif" font-size="14" fill="${colors.textMuted}">
      ${escapeXml(domain)}
    </text>
    
    <!-- Open button style -->
    <g transform="translate(920, -18)">
      <rect width="80" height="36" rx="12" fill="url(#brandGrad)"/>
      <text x="40" y="24" font-family="'Segoe UI', Arial, sans-serif" font-size="13" font-weight="bold" fill="#ffffff" text-anchor="middle">Read</text>
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
  return lines.slice(0, 2); // Max 2 lines for title
}

function generatePattern() {
  let circles = '';
  for (let i = 0; i < 60; i++) {
    const x = (i * 47) % 1200;
    const y = (i * 73) % 630;
    const r = 20 + (i * 11) % 60;
    circles += `<circle cx="${x}" cy="${y}" r="${r}" fill="none" stroke="#ffffff" stroke-width="0.5"/>`;
  }
  return circles;
}

function escapeXml(text) {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}