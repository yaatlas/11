const PATHS = {
  headphones: `<path d="M16 30v-6a12 12 0 0 1 24 0v6"/><rect x="10" y="28" width="8" height="16" rx="3"/><rect x="38" y="28" width="8" height="16" rx="3"/>`,
  bottle: `<path d="M26 10h12v6l5 6v22a5 5 0 0 1-5 5H26a5 5 0 0 1-5-5V22l5-6z"/><path d="M26 24h12"/>`,
  shoe: `<path d="M8 36c8-1 14-10 20-10h8l10 5 8 2v5c0 5-8 10-18 10H16c-6 0-10-4-10-8z"/><path d="M28 26c3-6 8-8 14-8"/>`,
  bricks: `<rect x="10" y="14" width="18" height="12" rx="2"/><rect x="32" y="14" width="20" height="12" rx="2"/><rect x="18" y="32" width="24" height="12" rx="2"/>`,
  mouse: `<rect x="18" y="10" width="24" height="38" rx="12"/><path d="M30 10v14"/>`,
  battery: `<rect x="10" y="20" width="36" height="20" rx="4"/><path d="M46 26h6v8h-6"/><path d="M18 30h12"/>`,
  ball: `<circle cx="32" cy="32" r="16"/><path d="M16 32h32"/><path d="M32 16c6 7 6 25 0 32"/><path d="M32 16c-6 7-6 25 0 32"/>`,
};

export function productArt(icon, accent) {
  const drawing = PATHS[icon] ?? PATHS.ball;
  return `<svg viewBox="0 0 64 64" class="art" aria-hidden="true">
    <rect width="64" height="64" rx="16" fill="${accent}1a"/>
    <g fill="none" stroke="${accent}" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">${drawing}</g>
  </svg>`;
}

export function storeArt(channel) {
  const drawing = channel === "online"
    ? `<rect x="8" y="12" width="32" height="22" rx="3"/><path d="M8 30h32"/><path d="M18 34v6h12v-6"/><circle cx="14" cy="20" r="2"/>`
    : `<path d="M6 20 24 8l18 12"/><path d="M10 20v18h28V20"/><path d="M20 38V26h8v12"/>`;
  const color = channel === "online" ? "#1d6a8a" : "#0c6b58";
  return `<svg viewBox="0 0 48 48" class="art" aria-hidden="true">
    <rect width="48" height="48" rx="14" fill="${color}1a"/>
    <g fill="none" stroke="${color}" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">${drawing}</g>
  </svg>`;
}
