/** Iconos de línea minimalistas (inline SVG, sin dependencias). */

const base = {
  width: 20,
  height: 20,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.8,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
};

export function IconDashboard() {
  return (
    <svg {...base}>
      <rect x="3" y="3" width="7" height="7" rx="1" />
      <rect x="14" y="3" width="7" height="7" rx="1" />
      <rect x="14" y="14" width="7" height="7" rx="1" />
      <rect x="3" y="14" width="7" height="7" rx="1" />
    </svg>
  );
}

export function IconCalendar() {
  return (
    <svg {...base}>
      <rect x="3" y="4" width="18" height="17" rx="2" />
      <path d="M3 9h18M8 2v4M16 2v4" />
    </svg>
  );
}

export function IconWaiting() {
  return (
    <svg {...base}>
      <circle cx="9" cy="8" r="3" />
      <path d="M15 8a3 3 0 1 0 0-.01M3 20a6 6 0 0 1 12 0M15 14a6 6 0 0 1 6 6" />
    </svg>
  );
}

export function IconRecords() {
  return (
    <svg {...base}>
      <path d="M4 4a1 1 0 0 1 1-1h9l6 6v11a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1z" />
      <path d="M14 3v6h6M8 13h8M8 17h5" />
    </svg>
  );
}

export function IconReports() {
  return (
    <svg {...base}>
      <path d="M3 3v18h18" />
      <path d="M7 15l4-5 3 3 4-6" />
    </svg>
  );
}

export function IconSearch() {
  return (
    <svg {...base} width={18} height={18}>
      <circle cx="11" cy="11" r="7" />
      <path d="M21 21l-4-4" />
    </svg>
  );
}

export function IconBell() {
  return (
    <svg {...base}>
      <path d="M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9M13.7 21a2 2 0 0 1-3.4 0" />
    </svg>
  );
}

export function IconFinance() {
  return (
    <svg {...base}>
      <line x1="12" y1="2" x2="12" y2="22" />
      <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
    </svg>
  );
}
