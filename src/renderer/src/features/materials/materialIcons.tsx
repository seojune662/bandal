import type { SVGProps } from 'react'

type MaterialsIconName = 'fileImport' | 'folderPlus'

const PATHS: Record<MaterialsIconName, JSX.Element> = {
  fileImport: (
    <>
      <path d="M12 3.5v9M8.5 9l3.5 3.5L15.5 9" />
      <path d="M4 14.5h4l1.5 2h5l1.5-2h4l-1.25 5.5H5.25z" />
    </>
  ),
  folderPlus: (
    <>
      <path d="M3.5 6h6l2 2h9v11h-17z" />
      <path d="M17 13.5v5M14.5 16h5" />
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
