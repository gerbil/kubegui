import ReactMarkdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { type ReactNode } from 'react'
import hljs from 'highlight.js/lib/core'
import hljsJson from 'highlight.js/lib/languages/json'
import hljsBash from 'highlight.js/lib/languages/bash'
import hljsYaml from 'highlight.js/lib/languages/yaml'
import hljsAccesslog from 'highlight.js/lib/languages/accesslog'
import 'highlight.js/styles/atom-one-dark.css'

hljs.registerLanguage('json', hljsJson)
hljs.registerLanguage('bash', hljsBash)
hljs.registerLanguage('sh', hljsBash)
hljs.registerLanguage('shell', hljsBash)
hljs.registerLanguage('yaml', hljsYaml)
hljs.registerLanguage('yml', hljsYaml)
hljs.registerLanguage('accesslog', hljsAccesslog)

function escapeHtml(code: string): string {
  return code.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/** Outer wrapper for fenced code blocks. */
function PreBlock({ children }: { children?: ReactNode }) {
  return <pre className="md-code-block">{children}</pre>
}

/** Inline code, or highlighted fenced code (identified by a `language-*` class). */
function CodeComponent({ className, children }: { className?: string; children?: ReactNode }) {
  const match = /language-([\w-]+)/.exec(className || '')
  const language = match ? match[1] : ''

  // Inline code (no language class) — render inline.
  if (!language) {
    return <code className="md-inline-code">{children}</code>
  }

  const code = String(children ?? '').replace(/\n$/, '')
  let html = escapeHtml(code)
  if (hljs.getLanguage(language)) {
    try {
      html = hljs.highlight(code, { language }).value
    } catch {
      html = escapeHtml(code)
    }
  }

  return <code dangerouslySetInnerHTML={{ __html: html }} />
}

type MarkdownProps = {
  /** Raw markdown string (`.md` suggestion text) to render. */
  markdown: string
  className?: string
}

export function Markdown({ markdown, className }: MarkdownProps) {
  return (
    <div className={className ? `md-content ${className}` : 'md-content'}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={
          {
            pre: PreBlock,
            code: CodeComponent,
            a: ({ href, children }) => (
              <a href={href} target="_blank" rel="noreferrer noopener">
                {children}
              </a>
            ),
          } as Components
        }
      >
        {markdown}
      </ReactMarkdown>
    </div>
  )
}