// api/og-image.js
// EasyRead OG Image Generator - Clean Editorial Card Engine

export const config = {
  runtime: 'edge',
};

export default async function handler(req) {
  try {
    const { searchParams } = new URL(req.url);

    // Check if icon request is requested
    const isIcon = searchParams.get('icon') === 'true';

    if (isIcon) {
      const size = parseInt(searchParams.get('size')) || 64;
      const title = searchParams.get('title') || 'EasyRead';
      const domain = searchParams.get('domain') || 'easytoread.vercel.app';
      const theme = searchParams.get('theme') || 'dark';

      const iconSvg = generateIconOG({ title, domain, theme, size });

      return new Response(iconSvg, {
        headers: {
          'Content-Type': 'image/svg+xml; charset=utf-8',
          'Cache-Control': 'public, max-age=604800, immutable',
        },
      });
    }

    // Dynamic Parameters with your base fallback text
    const title = searchParams.get('title') || 'EasyRead — Understand at your own pace';
    const description = searchParams.get('description') || searchParams.get('summary') || 'EasyRead explains complex topics in a way tailored just for you. Ask questions, paste notes, or read websites with crystal clarity.';
    const domain = searchParams.get('domain') || 'easytoread.vercel.app';
    const rawTags = searchParams.get('tags') || searchParams.get('category') || 'Personalized Learning,Blog,Web Reader,Smart Notes';
    const perspectives = searchParams.get('perspectives') || 'Multiple';
    const views = searchParams.get('views') || '1.4k';
    const theme = searchParams.get('theme') || 'dark';

    // Parse comma-separated tags
    const tags = rawTags.split(',').map(t => t.trim()).filter(Boolean);

    const svg = generateEditorialOG({
      title,
      description,
      domain,
      tags,
      perspectives,
      views,
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

// ============================================
// EDITORIAL OG IMAGE GENERATOR (1200x630)
// ============================================
function generateEditorialOG({ title, description, domain, tags, perspectives, views, theme }) {
  // Deterministic theme palettes based on title hash
  const PALETTES = [
    { accent: '#f59847', accent2: '#ffb85a', glow: 'rgba(245,152,71,0.14)' },
    { accent: '#38bdf8', accent2: '#818cf8', glow: 'rgba(56,189,248,0.14)' },
    { accent: '#10b981', accent2: '#6ee7b7', glow: 'rgba(16,185,129,0.14)' },
    { accent: '#e879f9', accent2: '#f43f5e', glow: 'rgba(232,121,249,0.14)' },
  ];

  let hash = 0;
  for (let i = 0; i < title.length; i++) {
    hash = title.charCodeAt(i) + ((hash << 5) - hash);
  }
  const pal = PALETTES[Math.abs(hash) % PALETTES.length];

  // Dynamic text wrapping
  const titleLines = wrapText(title, 38, 2);
  const descLines = wrapText(description, 68, 2);

  // Compute tag badge positions dynamically
  let tagOffset = 0;
  const tagElements = tags.slice(0, 4).map((tag, index) => {
    const isPrimary = index === 0;
    const tagWidth = Math.max(70, tag.length * 8.5 + 26);
    const currentX = tagOffset;
    tagOffset += tagWidth + 10;

    const bg = isPrimary ? 'rgba(245, 152, 71, 0.1)' : 'rgba(255, 255, 255, 0.05)';
    const stroke = isPrimary ? pal.accent : 'rgba(255, 255, 255, 0.08)';
    const textColor = isPrimary ? pal.accent : '#d4d4d8';

    return `
      <g transform="translate(${currentX}, 0)">
        <rect width="${tagWidth}" height="28" rx="14" fill="${bg}" stroke="${stroke}" stroke-width="${isPrimary ? '1.2' : '1'}"/>
        <text x="${tagWidth / 2}" y="18" font-family="'Plus Jakarta Sans', sans-serif" font-size="12" font-weight="600" fill="${textColor}" text-anchor="middle">
          ${escapeXml(tag)}
        </text>
      </g>
    `;
  }).join('');

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg width="1200" height="630" viewBox="0 0 1200 630" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <style>
      @import url('https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&amp;family=JetBrains+Mono:wght@500;600;700&amp;display=swap');
      
      .font-sans { font-family: 'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, sans-serif; }
      .font-mono { font-family: 'JetBrains Mono', monospace; }
      
      .title-text {
        font-family: 'Plus Jakarta Sans', -apple-system, sans-serif;
        font-weight: 800;
        letter-spacing: -0.035em;
        line-height: 1.18;
      }
      .brand-title {
        font-family: 'Plus Jakarta Sans', -apple-system, sans-serif;
        font-weight: 800;
        letter-spacing: -0.04em;
      }
    </style>

    <!-- Brand Accent Gradient -->
    <linearGradient id="brandAccentGrad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="${pal.accent}"/>
      <stop offset="100%" stop-color="${pal.accent2}"/>
    </linearGradient>

    <!-- Card Specular Highlight Stroke -->
    <linearGradient id="cardBorderGrad" x1="0%" y1="0%" x2="0%" y2="100%">
      <stop offset="0%" stop-color="rgba(255, 255, 255, 0.18)"/>
      <stop offset="100%" stop-color="rgba(255, 255, 255, 0.05)"/>
    </linearGradient>

    <!-- Top Ambient Radial Glow -->
    <radialGradient id="topGlow" cx="50%" cy="0%" r="60%">
      <stop offset="0%" stop-color="${pal.accent}" stop-opacity="0.14"/>
      <stop offset="70%" stop-color="#09090b" stop-opacity="0"/>
    </radialGradient>

    <!-- Spaced Background Grid Pattern -->
    <pattern id="spacedGrid" width="56" height="56" patternUnits="userSpaceOnUse">
      <path d="M 56 0 L 0 0 0 56" fill="none" stroke="rgba(255, 255, 255, 0.045)" stroke-width="1"/>
    </pattern>

    <!-- Radial Mask for Background Grid -->
    <mask id="gridMask">
      <radialGradient id="gridMaskGrad" cx="50%" cy="30%" r="55%">
        <stop offset="25%" stop-color="#ffffff"/>
        <stop offset="100%" stop-color="#000000"/>
      </radialGradient>
      <rect width="1200" height="630" fill="url(#gridMaskGrad)"/>
    </mask>

    <!-- Floating Box Shadow -->
    <filter id="cardElevation" x="-10%" y="-10%" width="120%" height="130%">
      <feDropShadow dx="0" dy="24" stdDeviation="30" flood-color="#000000" flood-opacity="0.85"/>
    </filter>
  </defs>

  <!-- ═══════════ CANVAS BACKGROUND ═══════════ -->
  <rect width="1200" height="630" fill="#09090b"/>
  <rect width="1200" height="630" fill="url(#spacedGrid)" mask="url(#gridMask)"/>
  <rect width="1200" height="630" fill="url(#topGlow)"/>

  <!-- ═══════════ CANVAS TOP BAR ═══════════ -->
  <g transform="translate(58, 48)">
    <!-- Logo -->
    <text x="0" y="20" class="brand-title" font-size="23" fill="#ffffff">
      Easy<tspan fill="url(#brandAccentGrad)">Read</tspan>
    </text>
    
    <!-- Subtitle -->
    <text x="114" y="19" class="font-mono" font-size="11.5" font-weight="600" fill="rgba(255,255,255,0.45)" letter-spacing="1.5">
      • KNOWLEDGE, SIMPLIFIED
    </text>

    <!-- Domain Badge (Right aligned) -->
    <g transform="translate(900, 0)">
      <rect width="184" height="30" rx="15" fill="rgba(255, 255, 255, 0.03)" stroke="rgba(255, 255, 255, 0.07)" stroke-width="1"/>
      <text x="92" y="19" class="font-mono" font-size="11.5" font-weight="600" fill="rgba(255,255,255,0.5)" text-anchor="middle">
        ${escapeXml(domain)}
      </text>
    </g>
  </g>

  <!-- ═══════════ ELEVATED FOREGROUND ARTICLE BOX ═══════════ -->
  <g filter="url(#cardElevation)">
    <!-- Card Frame -->
    <rect x="58" y="102" width="1084" height="476" rx="24" fill="#121216" fill-opacity="0.94" stroke="url(#cardBorderGrad)" stroke-width="1.2"/>
  </g>

  <!-- Content Layer inside Box -->
  <g transform="translate(108, 150)">
    
    <!-- 1. Title -->
    ${titleLines.map((line, i) => `
      <text x="0" y="${i * 48 + 36}" class="title-text" font-size="39" fill="#f2f2f5">
        ${escapeXml(line)}
      </text>
    `).join('')}

    <!-- 2. Summary -->
    <g transform="translate(0, ${titleLines.length * 48 + 52})">
      ${descLines.map((line, i) => `
        <text x="0" y="${i * 26}" class="font-sans" font-size="17" font-weight="400" fill="#a1a1aa" letter-spacing="-0.01em">
          ${escapeXml(line)}
        </text>
      `).join('')}
    </g>

    <!-- 3. Tags Row -->
    <g transform="translate(0, 260)">
      ${tagElements}
    </g>

    <!-- 4. Footer Divider & Stats -->
    <g transform="translate(0, 328)">
      <!-- Divider Line -->
      <line x1="0" y1="0" x2="984" y2="0" stroke="rgba(255, 255, 255, 0.07)" stroke-width="1"/>

      <!-- Overlapping Avatar Stack -->
      <g transform="translate(0, 20)">
        <!-- Circle 1 -->
        <circle cx="12" cy="12" r="13" fill="#e83e8c" stroke="#121216" stroke-width="2"/>
        <text x="12" y="16" class="font-sans" font-size="9" font-weight="700" fill="#ffffff" text-anchor="middle">ER</text>

        <!-- Circle 2 -->
        <circle cx="30" cy="12" r="13" fill="#3b82f6" stroke="#121216" stroke-width="2"/>
        <text x="30" y="16" class="font-sans" font-size="9" font-weight="700" fill="#ffffff" text-anchor="middle">AI</text>

        <!-- Circle 3 -->
        <circle cx="48" cy="12" r="13" fill="#10b981" stroke="#121216" stroke-width="2"/>
        <text x="48" y="16" class="font-sans" font-size="9" font-weight="700" fill="#ffffff" text-anchor="middle">⚡</text>

        <!-- Perspectives Label -->
        <text x="74" y="17" class="font-sans" font-size="13.5" font-weight="600" fill="#a1a1aa">
          ${escapeXml(perspectives)} Tailored Perspectives
        </text>
      </g>

      <!-- View Counter (Right aligned) -->
      <g transform="translate(890, 24)">
        <!-- Eye Icon -->
        <svg x="0" y="0" width="16" height="16" viewBox="0 0 24 24" fill="#71717a">
          <path d="M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5zM12 17c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5zm0-8c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3z"/>
        </svg>
        <text x="24" y="13" class="font-sans" font-size="13.5" font-weight="500" fill="#71717a">
          <tspan font-weight="700" fill="#f2f2f5">${escapeXml(views)}</tspan> views
        </text>
      </g>
    </g>

  </g>
</svg>`;
}

// ============================================
// ICON GENERATOR (Scaled)
// ============================================
function generateIconOG({ title, domain, theme, size }) {
  const scale = size / 512;

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <style>
      @import url('https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@800&amp;display=swap');
      .brand-title { font-family: 'Plus Jakarta Sans', -apple-system, sans-serif; font-weight: 800; }
    </style>
    <linearGradient id="iconAccentGrad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#f59847"/>
      <stop offset="100%" stop-color="#ffb85a"/>
    </linearGradient>
  </defs>

  <rect width="${size}" height="${size}" rx="${Math.round(size * 0.22)}" fill="#09090b"/>
  <rect width="${size}" height="${size}" rx="${Math.round(size * 0.22)}" fill="#121216" stroke="rgba(255,255,255,0.1)" stroke-width="${Math.max(1, Math.round(2 * scale))}"/>

  <!-- Logo Mark -->
  <g transform="translate(${size / 2}, ${size / 2}) scale(${scale})">
    <rect x="-120" y="-120" width="240" height="240" rx="54" fill="url(#iconAccentGrad)"/>
    <path d="M-50 40 A 25 25 0 0 1 -25 15 H 50 V -50 H -25 A 25 25 0 0 0 -50 -25 Z" fill="#ffffff" transform="scale(1.2) translate(-5, -5)"/>
  </g>
</svg>`;
}

// ============================================
// HELPER FUNCTIONS
// ============================================
function wrapText(text, maxChars, maxLines = 2) {
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
