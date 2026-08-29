/**
 * A plexus: two nodes, independent, joined by a shared network of nerves.
 */
export default function Logo({ size = 20 }: { size?: number }): JSX.Element {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none" aria-hidden="true">
      <g stroke="currentColor" strokeWidth="1.4" opacity="0.45">
        <path d="M8 10 L16 16 L24 10" />
        <path d="M8 22 L16 16 L24 22" />
        <path d="M8 10 L8 22" />
        <path d="M24 10 L24 22" />
      </g>
      <circle cx="8" cy="10" r="3" fill="#d97757" />
      <circle cx="8" cy="22" r="3" fill="#d97757" opacity="0.55" />
      <circle cx="24" cy="10" r="3" fill="#58a6ff" opacity="0.55" />
      <circle cx="24" cy="22" r="3" fill="#58a6ff" />
      <circle cx="16" cy="16" r="3.6" fill="#0d1017" stroke="currentColor" strokeWidth="1.6" />
    </svg>
  )
}
