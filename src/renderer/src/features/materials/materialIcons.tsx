import type { SVGProps } from 'react'

type MaterialsIconName = 'fileImport' | 'folderPlus'

const PATHS: Record<MaterialsIconName, JSX.Element> = {
  fileImport: (
    <>
      <path d="M6.5 3.5h7L18 8v12.5H6.5z" />
      <path d="M13.5 3.5V8H18M12 10.5v6M9.5 14l2.5 2.5 2.5-2.5" />
    </>
  ),
  folderPlus: (
    <>
      <path d="M3.5 6.5h6l2-2h3l2 2h4v12.5h-17z" />
      <path d="M12 9.5v6M9 12.5h6" />
    </>
  )
}

export function MaterialsIcon({
  name,
  ...props
}: SVGProps<SVGSVGElement> & { name: MaterialsIconName }): JSX.Element {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      width="1em"
      height="1em"
      {...props}
    >
      <g
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.75"
      >
        {PATHS[name]}
      </g>
    </svg>
  )
}
