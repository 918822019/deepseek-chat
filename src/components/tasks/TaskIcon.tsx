const paths = {
  folder: 'M3 18V6a2 2 0 0 1 2-2h5l2 3h7a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2ZM3 10h18',
  file: 'M6 3h8l4 4v14H6z M14 3v5h4 M9 12h6 M9 16h6',
  tasks:
    'M7 3h11a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z M8 9l1 1 2-2 M13 9h4 M8 15l1 1 2-2 M13 15h4',
  history: 'M3 11a9 9 0 1 1 2.6 7 M3 5v6h6 M12 7v5l3 2',
  arrow: 'M5 12h14 M14 7l5 5-5 5',
  add: 'M12 5v14 M5 12h14',
} as const

export const TaskIcon = ({ name, size = 18 }: { name: keyof typeof paths; size?: number }) => (
  <svg
    aria-hidden="true"
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.65"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d={paths[name]} />
  </svg>
)
