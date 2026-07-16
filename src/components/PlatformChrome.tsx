import { ChevronLeft } from 'lucide-react'

type Props = {
  homeHref?: string
}

export function PlatformChrome({ homeHref = '/' }: Props) {
  return (
    <nav aria-label="Platform navigation">
      <a
        href={homeHref}
        aria-label="Back to CDL Field Tools home"
        className="inline-flex items-center gap-0.5 text-xs font-medium text-slate-500 hover:text-slate-800 transition-colors rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2"
      >
        <ChevronLeft className="w-3.5 h-3.5 shrink-0" aria-hidden />
        CDL Field Tools
      </a>
    </nav>
  )
}
