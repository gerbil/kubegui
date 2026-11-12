import { memo } from 'react'

// React 19 rewrites innerHTML on every re-render of an element using
// dangerouslySetInnerHTML, which destroys the user's text selection.
// Memoizing on the html string leaves unchanged log lines untouched.
export const MemoHtml = memo(function MemoHtml({ html, className }: { html: string; className?: string }) {
  return <span className={className} dangerouslySetInnerHTML={{ __html: html }} />
})
