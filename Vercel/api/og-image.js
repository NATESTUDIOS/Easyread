// api/og-image.js
// Dynamic OG Image Generator for EasyRead Articles
// Usage: /api/og-image?title=Article+Title&domain=source.com&category=Technology

export const config = {
  runtime: 'edge', // Use Edge runtime for faster response
};

export default async function handler(req) {
  try {
    const { searchParams } = new URL(req.url);
    
    // Get parameters with defaults
    const title = searchParams.get('title') || 'EasyRead - Simplified Articles';
    const domain = searchParams.get('domain') || 'easytoread.vercel.app';
    const category = searchParams.get('category') || 'Article';
    const theme = searchParams.get('theme') || 'dark'; // dark | light
    
    // Theme configurations
    const themes = {
      dark: {
        bg: ['#0f0f1a', '#1a1a2e', '#16213e'],
        text: '#ffffff',
        secondary: 'rgba(255,255,255,0.7)',
        accent: '#f59847',
        badgeBg: 'rgba(245,152,71,0.15)',
        badgeBorder: 'rgba(245,152,71,0.4)',
        logoColor: '#ffffff'
      },
      light: {
        bg: ['#f6f7f9', '#ffffff', '#e8e8ec'],
        text: '#1c1c1e',
        secondary: 'rgba(0,0,0,0.6)',
        accent: '#f59847',
        badgeBg: 'rgba(245,152,71,0.15)',
        badgeBorder: 'rgba(245,152,71,0.4)',
        logoColor: '#1c1c1e'
      }
    };
    
    const t = themes[theme] || themes.dark;
    
    // Truncate title if too long
    const truncatedTitle = title.length > 100 ? title.substring(0, 97) + '...' : title;
    
    // Generate SVG
    const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg width="1200" height="630" viewBox="0 0 1200 630" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="bgGrad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" style="stop-color:${t.bg[0]};stop-opacity:1" />
      <stop offset="50%" style="stop-color:${t.bg[1]};stop-opacity:1" />
      <stop offset="100%" style="stop-color:${t.bg[2]};stop-opacity:1" />
    </linearGradient>
    
    <linearGradient id="accentGrad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" style="stop-color:#f59847;stop-opacity:1" />
      <stop offset="100%" style="stop-color:#ff6b6b;stop-opacity:1" />
    </linearGradient>
    
    <radialGradient id="glow1" cx="20%" cy="80%" r="50%">
      <stop offset="0%" style="stop-color:${t.accent};stop-opacity:0.15" />
      <stop offset="100%" style="stop-color:${t.accent};stop-opacity:0" />
    </radialGradient>
    
    <radialGradient id="glow2" cx="80%" cy="20%" r="40%">
      <stop offset="0%" style="stop-color:#ff6b6b;stop-opacity:0.1" />
      <stop offset="100%" style="stop-color:#ff6b6b;stop-opacity:0" />
    </radialGradient>
    
    <filter id="shadow" x="-20%" y="-20%" width="140%" height="140%">
      <feDropShadow dx="0" dy="4" stdDeviation="8" flood-opacity="0.3"/>
    </filter>
  </defs>
  
  <!-- Background -->
  <rect width="1200" height="630" fill="url(#bgGrad)"/>
  <rect width="1200" height="630" fill="url(#glow1)"/>
  <rect width="1200" height="630" fill="url(#glow2)"/>
  
  <!-- Decorative pattern -->
  <g opacity="0.03">
    ${Array.from({length: 30}, (_, i) => `
      <circle cx="${(i * 137) % 1200}" cy="${(i * 89) % 630}" r="${30 + (i * 13) % 100}" fill="${t.accent}" stroke="none"/>
    `).join('')}
  </g>
  
  <!-- Border -->
  <rect x="20" y="20" width="1160" height="590" rx="24" fill="none" stroke="rgba(255,255,255,0.1)" stroke-width="2"/>
  
  <!-- Logo Section -->
  <g transform="translate(60, 50)">
    <!-- Logo icon -->
    <rect width="48" height="48" rx="12" fill="url(#accentGrad)" filter="url(#shadow)"/>
    <text x="24" y="33" font-family="Arial, Helvetica, sans-serif" font-size="24" font-weight="bold" fill="#ffffff" text-anchor="middle">E</text>
    
    <!-- Logo text -->
    <text x="64" y="33" font-family="Arial, Helvetica, sans-serif" font-size="28" font-weight="bold" fill="${t.logoColor}">
      Easy<span fill="${t.accent}">Read</span>
    </text>
  </g>
  
  <!-- Category Badge -->
  <g transform="translate(60, 130)">
    <rect width="${Math.min(category.length * 14 + 40, 300)}" height="40" rx="20" fill="${t.badgeBg}" stroke="${t.badgeBorder}" stroke-width="1.5"/>
    <circle cx="20" cy="20" r="5" fill="${t.accent}"/>
    <text x="35" y="26" font-family="Arial, Helvetica, sans-serif" font-size="16" font-weight="bold" fill="${t.accent}" letter-spacing="1.5">${category.toUpperCase()}</text>
  </g>
  
  <!-- Title -->
  <g transform="translate(60, 220)">
    <text x="0" y="0" font-family="Arial, Helvetica, sans-serif" font-size="52" font-weight="bold" fill="${t.text}" line-height="1.3">
      ${wrapTitle(truncatedTitle).map((line, i) => 
        `<tspan x="0" dy="${i === 0 ? 0 : 65}">${escapeXml(line)}</tspan>`
      ).join('')}
    </text>
  </g>
  
  <!-- Bottom Section -->
  <g transform="translate(60, 560)">
    <!-- Divider line -->
    <line x1="0" y1="-20" x2="1080" y2="-20" stroke="rgba(255,255,255,0.1)" stroke-width="1"/>
    
    <!-- Source domain with icon -->
    <svg x="0" y="-5" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="${t.accent}" stroke-width="2">
      <circle cx="12" cy="12" r="10"/>
      <line x1="2" y1="12" x2="22" y2="12"/>
      <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>
    </svg>
    <text x="30" y="10" font-family="Arial, Helvetica, sans-serif" font-size="18" fill="${t.secondary}">${escapeXml(domain)}</text>
    
    <!-- Reading time -->
    <svg x="400" y="-5" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="${t.accent}" stroke-width="2">
      <circle cx="12" cy="12" r="10"/>
      <polyline points="12 6 12 12 16 14"/>
    </svg>
    <text x="430" y="10" font-family="Arial, Helvetica, sans-serif" font-size="18" fill="${t.secondary}">5 min read</text>
    
    <!-- EasyRead tag -->
    <text x="1080" y="10" font-family="Arial, Helvetica, sans-serif" font-size="18" fill="${t.secondary}" text-anchor="end">Simplified Reading</text>
  </g>
</svg>`;

    return new Response(svg, {
      headers: {
        'Content-Type': 'image/svg+xml',
        'Cache-Control': 'public, max-age=3600, s-maxage=3600',
        'CDN-Cache-Control': 'public, max-age=3600',
        'Vercel-CDN-Cache-Control': 'public, max-age=3600',
      },
    });
    
  } catch (error) {
    console.error('OG Image generation error:', error);
    return new Response('Failed to generate image', { status: 500 });
  }
}

// Helper function to wrap title into multiple lines
function wrapTitle(title) {
  const words = title.split(' ');
  const lines = [];
  let currentLine = '';
  
  for (const word of words) {
    if ((currentLine + ' ' + word).trim().length <= 25) {
      currentLine = (currentLine + ' ' + word).trim();
    } else {
      if (currentLine) lines.push(currentLine);
      currentLine = word;
    }
  }
  
  if (currentLine) lines.push(currentLine);
  
  // Limit to 3 lines
  if (lines.length > 3) {
    lines[2] = lines[2].substring(0, 22) + '...';
    return lines.slice(0, 3);
  }
  
  return lines;
}

// Helper to escape XML special characters
function escapeXml(text) {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}