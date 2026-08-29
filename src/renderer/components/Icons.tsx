interface Props {
  size?: number
}

const stroke = {
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.6,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const
}

export function ChatIcon({ size = 18 }: Props): JSX.Element {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" {...stroke}>
      <path d="M3 5.5A1.5 1.5 0 0 1 4.5 4h11A1.5 1.5 0 0 1 17 5.5v7a1.5 1.5 0 0 1-1.5 1.5H8l-4 3v-3H4.5A1.5 1.5 0 0 1 3 12.5z" />
    </svg>
  )
}

export function TasksIcon({ size = 18 }: Props): JSX.Element {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" {...stroke}>
      <path d="M3 5.5l1.6 1.6L7.5 4.2M3 12.5l1.6 1.6 2.9-2.9M10.5 6h6.5M10.5 13h6.5" />
    </svg>
  )
}

export function ScoreIcon({ size = 18 }: Props): JSX.Element {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" {...stroke}>
      <path d="M4 16V9M10 16V4M16 16v-4" />
    </svg>
  )
}

export function SettingsIcon({ size = 18 }: Props): JSX.Element {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" {...stroke}>
      <circle cx="10" cy="10" r="2.6" />
      <path d="M10 2.6v2M10 15.4v2M17.4 10h-2M4.6 10h-2M15.2 4.8l-1.4 1.4M6.2 13.8l-1.4 1.4M15.2 15.2l-1.4-1.4M6.2 6.2 4.8 4.8" />
    </svg>
  )
}

export function ExpandIcon({ size = 14 }: Props): JSX.Element {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" {...stroke}>
      <path d="M12 3h5v5M8 17H3v-5M17 3l-6 6M3 17l6-6" />
    </svg>
  )
}

export function CollapseIcon({ size = 14 }: Props): JSX.Element {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" {...stroke}>
      <path d="M4 9h5V4M16 11h-5v5M9 9 3 3M11 11l6 6" />
    </svg>
  )
}

export function PlusIcon({ size = 14 }: Props): JSX.Element {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" {...stroke}>
      <path d="M10 4v12M4 10h12" />
    </svg>
  )
}

export function CloseIcon({ size = 12 }: Props): JSX.Element {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" {...stroke}>
      <path d="M5 5l10 10M15 5 5 15" />
    </svg>
  )
}

export function BackIcon({ size = 14 }: Props): JSX.Element {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" {...stroke}>
      <path d="M12 4 6 10l6 6" />
    </svg>
  )
}

export function FileIcon({ size = 13 }: Props): JSX.Element {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" {...stroke}>
      <path d="M11 2.5H6A1.5 1.5 0 0 0 4.5 4v12A1.5 1.5 0 0 0 6 17.5h8a1.5 1.5 0 0 0 1.5-1.5V7z" />
      <path d="M11 2.5V7h4.5" />
    </svg>
  )
}

export function LinkIcon({ size = 13 }: Props): JSX.Element {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" {...stroke}>
      <path d="M8.5 11.5a3 3 0 0 0 4.2 0l2.6-2.6a3 3 0 0 0-4.2-4.2l-1 1" />
      <path d="M11.5 8.5a3 3 0 0 0-4.2 0L4.7 11.1a3 3 0 0 0 4.2 4.2l1-1" />
    </svg>
  )
}

export function NoteIcon({ size = 13 }: Props): JSX.Element {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" {...stroke}>
      <path d="M4.5 4.5h11v11h-11z" />
      <path d="M7 8h6M7 11h4" />
    </svg>
  )
}
