interface LogoProps {
  variant?: "full" | "compact" | "icon"
  className?: string
}

function HubIcon({ size = 32 }: { size?: number }) {
  const id = "hubG"
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id={id} x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#2AB4A6" />
          <stop offset="100%" stopColor="#6366F1" />
        </linearGradient>
      </defs>
      {/* Spokes */}
      <line x1="20" y1="15" x2="20" y2="9.5"    stroke={`url(#${id})`} strokeWidth="1.8" strokeLinecap="round" />
      <line x1="24.3" y1="17.5" x2="29.1" y2="14.8" stroke={`url(#${id})`} strokeWidth="1.8" strokeLinecap="round" />
      <line x1="24.3" y1="22.5" x2="29.1" y2="25.2" stroke={`url(#${id})`} strokeWidth="1.8" strokeLinecap="round" />
      <line x1="20" y1="25"  x2="20" y2="30.5"  stroke={`url(#${id})`} strokeWidth="1.8" strokeLinecap="round" />
      <line x1="15.7" y1="22.5" x2="10.9" y2="25.2" stroke={`url(#${id})`} strokeWidth="1.8" strokeLinecap="round" />
      <line x1="15.7" y1="17.5" x2="10.9" y2="14.8" stroke={`url(#${id})`} strokeWidth="1.8" strokeLinecap="round" />
      {/* Outer nodes */}
      <circle cx="20"   cy="7"    r="2.8" fill={`url(#${id})`} />
      <circle cx="31.3" cy="13.5" r="2.8" fill={`url(#${id})`} />
      <circle cx="31.3" cy="26.5" r="2.8" fill={`url(#${id})`} />
      <circle cx="20"   cy="33"   r="2.8" fill={`url(#${id})`} />
      <circle cx="8.7"  cy="26.5" r="2.8" fill={`url(#${id})`} />
      <circle cx="8.7"  cy="13.5" r="2.8" fill={`url(#${id})`} />
      {/* Centre node */}
      <circle cx="20" cy="20" r="5.5" fill={`url(#${id})`} />
    </svg>
  )
}

export default function Logo({ variant = "full", className = "" }: LogoProps) {
  if (variant === "icon") {
    return <HubIcon size={32} />
  }

  if (variant === "compact") {
    return (
      <div className={`flex items-center gap-2 ${className}`}>
        <HubIcon size={24} />
        <span className="text-white font-bold text-sm tracking-wide">Vectis Hub</span>
      </div>
    )
  }

  // full
  return (
    <div className={`flex flex-col items-center gap-3 ${className}`}>
      <HubIcon size={56} />
      <div className="text-center">
        <p className="text-white font-bold text-3xl tracking-tight">Vectis Hub</p>
        <p className="text-gray-400 text-sm mt-0.5">Internal Platform</p>
      </div>
    </div>
  )
}
