// api/og-image.js
// EasyRead OG Image Generator - Premium Glassmorphism Social Card Engine

export const config = {
  runtime: 'edge',
};

export default async function handler(req) {
  try {
    const { searchParams } = new URL(req.url);

    const title = searchParams.get('title') || 'How Marine Propellers Work: Understanding the Wageningen B-Series Model';
    const description = searchParams.get('description') || searchParams.get('summary') || 'A marine propeller is a screw that pushes water backward to move a ship forward — simple concept, brutal physics.';
    const domain = searchParams.get('domain') || 'easytoread.vercel.app';
    const category = searchParams.get('category') || 'Science & Tech';
    const readTime = searchParams.get('readTime') || '6 min read';
    const views = searchParams.get('views') || '1.4k';
    const perspectives = searchParams.get('perspectives') || '6';
    const theme = searchParams.get('theme') || 'dark';

    const svg = generatePremiumOG({
      title,
      description,
      domain,
      category,
      readTime,
      views,
      perspectives,
      theme,
    });

    return new Response(svg, {
      headers: {
        'Content-Type': 'image/svg+xml; charset=utf-8',
        'Cache-Control': 'public, max-age=86400, s-maxage=604800, stale-while-revalidate=86400',
      },
    });
  } catch (error) {
    return new Response('Failed to generate Open Graph image', { status: 500 });
  }
}

function generatePremiumOG({ title, description, domain, category, readTime, views, perspectives, theme }) {
  // Deterministic dynamic gradient palettes
  const PALETTES = [
    { bg: ['#0c0b10', '#18141f', '#09080d'], accent: '#f59847', accent2: '#ffd166', glow: 'rgba(245,152,71,0.22)' }, // Amber Flame (Brand)
    { bg: ['#080e1a', '#101d36', '#060a14'], accent: '#38bdf8', accent2: '#818cf8', glow: 'rgba(56,189,248,0.22)' }, // Oceanic Sapphire
    { bg: ['#06130e', '#0d281e', '#040d0a'], accent: '#10b981', accent2: '#6ee7b7', glow: 'rgba(16,185,129,0.22)' }, // Emerald Horizon
    { bg: ['#140816', '#2b1030', '#0a040b'], accent: '#e879f9', accent2: '#f43f5e', glow: 'rgba(232,121,249,0.22)' }, // Cyber Violet
    { bg: ['#160b08', '#2e140d', '#0c0503'], accent: '#ff6b6b', accent2: '#f59847', glow: 'rgba(255,107,107,0.22)' }, // Twilight Crimson
    { bg: ['#081419', '#102a36', '#050c10'], accent: '#2dd4bf', accent2: '#38bdf8', glow: 'rgba(45,212,191,0.22)' }, // Cosmic Cyan
  ];

  let hash = 0;
  for (let i = 0; i < title.length; i++) {
    hash = title.charCodeAt(i) + ((hash << 5) - hash);
  }
  const pal = PALETTES[Math.abs(hash) % PALETTES.length];

  const titleLines = wrapText(title, 34, 3);
  const descLines = wrapText(description, 68, 2);

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg width="1200" height="630" viewBox="0 0 1200 630" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <style>
      @import url('https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@500;600;700;800&amp;family=JetBrains+Mono:wght@600;700&amp;display=swap');
      
      .font-sans { font-family: 'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; }
      .font-mono { font-family: 'JetBrains Mono', monospace; }
      
      .title-text {
        font-family: 'Plus Jakarta Sans', -apple-system, sans-serif;
        font-weight: 800;
        letter-spacing: -0.035em;
        line-height: 1.15;
      }
      .brand-title {
        font-family: 'Plus Jakarta Sans', -apple-system, sans-serif;
        font-weight: 800;
        letter-spacing: -0.04em;
      }
    </style>

    <!-- Canvas Background Gradient -->
    <linearGradient id="canvasBg" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="${pal.bg[0]}"/>
      <stop offset="50%" stop-color="${pal.bg[1]}"/>
      <stop offset="100%" stop-color="${pal.bg[2]}"/>
    </linearGradient>

    <!-- Brand Accent Gradient -->
    <linearGradient id="brandAccentGrad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="${pal.accent}"/>
      <stop offset="100%" stop-color="${pal.accent2}"/>
    </linearGradient>

    <!-- Primary Glass Card Fill -->
    <linearGradient id="glassCardFill" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="rgba(255, 255, 255, 0.07)"/>
      <stop offset="100%" stop-color="rgba(255, 255, 255, 0.02)"/>
    </linearGradient>

    <!-- Pill Glass Fill -->
    <linearGradient id="pillGlass" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="rgba(255, 255, 255, 0.08)"/>
      <stop offset="100%" stop-color="rgba(255, 255, 255, 0.03)"/>
    </linearGradient>

    <!-- Ambient Glow 1 -->
    <radialGradient id="ambientGlow1" cx="20%" cy="15%" r="65%">
      <stop offset="0%" stop-color="${pal.accent}" stop-opacity="0.30"/>
      <stop offset="60%" stop-color="${pal.accent}" stop-opacity="0.04"/>
      <stop offset="100%" stop-color="${pal.bg[0]}" stop-opacity="0"/>
    </radialGradient>

    <!-- Ambient Glow 2 -->
    <radialGradient id="ambientGlow2" cx="85%" cy="85%" r="55%">
      <stop offset="0%" stop-color="${pal.accent2}" stop-opacity="0.25"/>
      <stop offset="60%" stop-color="${pal.accent2}" stop-opacity="0.03"/>
      <stop offset="100%" stop-color="${pal.bg[2]}" stop-opacity="0"/>
    </radialGradient>

    <!-- Drop Shadows -->
    <filter id="cardShadow" x="-10%" y="-10%" width="120%" height="125%">
      <feDropShadow dx="0" dy="20" stdDeviation="30" flood-color="#000000" flood-opacity="0.65"/>
    </filter>
    
    <filter id="badgeGlow">
      <feDropShadow dx="0" dy="0" stdDeviation="8" flood-color="${pal.accent}" flood-opacity="0.4"/>
    </filter>

    <filter id="textGlow">
      <feDropShadow dx="0" dy="2" stdDeviation="4" flood-color="#000000" flood-opacity="0.5"/>
    </filter>
  </defs>

  <!-- Base Ambient Canvas -->
  <rect width="1200" height="630" fill="url(#canvasBg)"/>
  <rect width="1200" height="630" fill="url(#ambientGlow1)"/>
  <rect width="1200" height="630" fill="url(#ambientGlow2)"/>

  <!-- Decorative Orbit Rings -->
  <g opacity="0.08" stroke="#ffffff" fill="none">
    <circle cx="1120" cy="120" r="260" stroke-width="1.5" stroke-dasharray="4 8"/>
    <circle cx="1120" cy="120" r="180" stroke-width="1"/>
    <circle cx="100" cy="550" r="220" stroke-width="1.5" stroke-dasharray="6 6"/>
  </g>

  <!-- Ambient Light Orbs -->
  <circle cx="1080" cy="140" r="120" fill="${pal.accent2}" opacity="0.12" filter="url(#cardShadow)"/>
  <circle cx="140" cy="520" r="140" fill="${pal.accent}" opacity="0.10" filter="url(#cardShadow)"/>

  <!-- MAIN FROSTED GLASS CARD -->
  <g filter="url(#cardShadow)">
    <rect x="50" y="40" width="1100" height="550" rx="28" fill="url(#glassCardFill)" stroke="rgba(255, 255, 255, 0.12)" stroke-width="1.5"/>
    <!-- Inset Top Light Highlight -->
    <rect x="52" y="42" width="1096" height="546" rx="26" fill="none" stroke="rgba(255, 255, 255, 0.05)" stroke-width="1"/>
  </g>

  <!-- ═══════════ TOP HEADER ═══════════ -->
  <g transform="translate(95, 82)">
    <!-- Logo Emblem -->
    <g filter="url(#badgeGlow)">
      <rect width="48" height="48" rx="15" fill="url(#brandAccentGrad)"/>
      <svg x="11" y="11" width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#ffffff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/>
        <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/>
        <line x1="9" y1="7" x2="16" y2="7"/>
        <line x1="9" y1="11" x2="14" y2="11"/>
      </svg>
    </g>

    <!-- Brand Typography -->
    <text x="64" y="28" class="brand-title" font-size="25" fill="#ffffff">
      Easy<tspan fill="${pal.accent}">Read</tspan>
    </text>
    <text x="64" y="44" class="font-mono" font-size="10" font-weight="700" fill="rgba(255,255,255,0.45)" letter-spacing="1.5">
      KNOWLEDGE, SIMPLIFIED
    </text>

    <!-- Category Pill Badge -->
    <g transform="translate(770, 4)">
      <rect width="${Math.min(category.length * 11 + 46, 240)}" height="38" rx="19" fill="url(#pillGlass)" stroke="${pal.accent}" stroke-opacity="0.4" stroke-width="1.2"/>
      <circle cx="18" cy="19" r="4" fill="${pal.accent}" filter="url(#badgeGlow)"/>
      <text x="30" y="24" class="font-sans" font-size="12" font-weight="700" fill="${pal.accent}" letter-spacing="0.8">
        ${escapeXml(category.toUpperCase())}
      </text>
    </g>
  </g>

  <!-- ═══════════ MAIN HEADLINE (TITLE) ═══════════ -->
  <g transform="translate(95, 200)" filter="url(#textGlow)">
    ${titleLines.map((line, i) => `
      <text x="0" y="${i * 54}" class="title-text" font-size="44" fill="#ffffff">
        ${escapeXml(line)}
      </text>
    `).join('')}
  </g>

  <!-- ═══════════ DESCRIPTION / TAKEAWAY ═══════════ -->
  <g transform="translate(95, ${200 + titleLines.length * 54 + 18})">
    <!-- Left Neon Accent Bar -->
    <rect x="0" y="2" width="3.5" height="${Math.max(34, descLines.length * 24)}" rx="2" fill="url(#brandAccentGrad)"/>
    
    ${descLines.map((line, i) => `
      <text x="18" y="${i * 24 + 18}" class="font-sans" font-size="16.5" font-weight="500" fill="rgba(255,255,255,0.68)" letter-spacing="-0.01em">
        ${escapeXml(line)}
      </text>
    `).join('')}
  </g>

  <!-- ═══════════ STATS & METRICS PILLS ═══════════ -->
  <g transform="translate(95, 475)">
    <!-- Reading Time Pill -->
    <g>
      <rect width="118" height="34" rx="17" fill="url(#pillGlass)" stroke="rgba(255,255,255,0.08)" stroke-width="1"/>
      <svg x="12" y="9" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="${pal.accent}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <circle cx="12" cy="12" r="10"/>
        <polyline points="12 6 12 12 16 14"/>
      </svg>
      <text x="34" y="22" class="font-sans" font-size="12" font-weight="700" fill="rgba(255,255,255,0.85)">${escapeXml(readTime)}</text>
    </g>

    <!-- Views Pill -->
    <g transform="translate(128, 0)">
      <rect width="105" height="34" rx="17" fill="url(#pillGlass)" stroke="rgba(255,255,255,0.08)" stroke-width="1"/>
      <svg x="12" y="9" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="${pal.accent}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
        <circle cx="12" cy="12" r="3"/>
      </svg>
      <text x="34" y="22" class="font-sans" font-size="12" font-weight="700" fill="rgba(255,255,255,0.85)">${escapeXml(views)} views</text>
    </g>

    <!-- Perspectives Pill -->
    <g transform="translate(243, 0)">
      <rect width="160" height="34" rx="17" fill="url(#pillGlass)" stroke="rgba(255,255,255,0.08)" stroke-width="1"/>
      <svg x="12" y="9" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="${pal.accent2}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>
      </svg>
      <text x="34" y="22" class="font-sans" font-size="12" font-weight="700" fill="${pal.accent2}">${escapeXml(perspectives)} Perspectives</text>
    </g>

    <!-- Verified Badge -->
    <g transform="translate(413, 0)">
      <rect width="112" height="34" rx="17" fill="rgba(16, 185, 129, 0.12)" stroke="rgba(16, 185, 129, 0.3)" stroke-width="1"/>
      <svg x="12" y="9" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#10b981" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
        <polyline points="20 6 9 17 4 12"/>
      </svg>
      <text x="34" y="22" class="font-sans" font-size="12" font-weight="700" fill="#10b981">Verified</text>
    </g>
  </g>

  <!-- ═══════════ FOOTER DOCK ═══════════ -->
  <g transform="translate(95, 545)">
    <line x1="0" y1="0" x2="1010" y2="0" stroke="rgba(255,255,255,0.08)" stroke-width="1"/>
    
    <!-- Domain Tag -->
    <text x="0" y="22" class="font-mono" font-size="13" font-weight="600" fill="rgba(255,255,255,0.45)">
      ${escapeXml(domain)}
    </text>
    
    <!-- Read CTA Button -->
    <g transform="translate(860, 4)">
      <rect width="150" height="36" rx="18" fill="url(#brandAccentGrad)" filter="url(#badgeGlow)"/>
      <text x="75" y="23" class="font-sans" font-size="13.5" font-weight="800" fill="#ffffff" text-anchor="middle" letter-spacing="-0.01em">
        Read Article →
      </text>
    </g>
  </g>
</svg>`;
}

function wrapText(text, maxChars, maxLines = 3) {
  if (!text) return [];
  const clean = text.replace(/[*_#`]/g, '').trim();
  const words = clean.split(/\s+/);
  const lines = [];
  let currentLine = '';

  for (const word of words) {
    if ((currentLine + ' ' + word).trim().length <= maxChars) {
      currentLine = (currentLine + ' ' + word).trim();
    } else {
      if (currentLine) lines.push(currentLine);
      currentLine = word;
      if (lines.length >= maxLines - 1) break;
    }
  }

  if (currentLine && lines.length < maxLines) {
    lines.push(currentLine);
  }

  // Ellipsize last line if truncated
  if (lines.length === maxLines && words.length > lines.join(' ').split(/\s+/).length) {
    lines[maxLines - 1] = lines[maxLines - 1].substring(0, maxChars - 3) + '...';
  }

  return lines;
}

function escapeXml(text) {
  if (!text) return '';
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}