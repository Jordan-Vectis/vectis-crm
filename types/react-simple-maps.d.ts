declare module "react-simple-maps" {
  import { ReactNode, CSSProperties, MouseEvent } from "react"

  interface ComposableMapProps {
    projection?: string
    projectionConfig?: Record<string, unknown>
    style?: CSSProperties
    className?: string
    children?: ReactNode
  }
  export function ComposableMap(props: ComposableMapProps): JSX.Element

  interface GeographiesProps {
    geography: string
    children: (args: { geographies: any[] }) => ReactNode
  }
  export function Geographies(props: GeographiesProps): JSX.Element

  interface GeographyProps {
    key?: string
    geography: any
    fill?: string
    stroke?: string
    strokeWidth?: number
    style?: CSSProperties | Record<string, unknown>
    onMouseEnter?: (e: MouseEvent) => void
    onMouseLeave?: (e: MouseEvent) => void
  }
  export function Geography(props: GeographyProps): JSX.Element

  interface MarkerProps {
    key?: string
    coordinates: [number, number]
    children?: ReactNode
  }
  export function Marker(props: MarkerProps): JSX.Element
}
