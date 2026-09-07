const React = require('react')
const { renderToStaticMarkup } = require('react-dom/server')
const { Markdown } = require('./md-bundle.cjs')

const sample = [
  '### Issue detected',
  '',
  '**CrashLoopBackOff** on pod `nginx-abc`. The container keeps **restarting**.',
  '',
  '**Suggested fix:**',
  '',
  '```yaml',
  'spec:',
  '  template:',
  '    spec:',
  '      resources:',
  '        limits:',
  '          memory: 512Mi',
  '```',
  '',
  'Also check logs for OOM:',
  '',
  '- `kubectl logs -f deploy/nginx`',
  '- [x] Confirm memory limits',
  '- [ ] Reduce replicas',
  '',
  '| step | command |',
  '| --- | --- |',
  '| restart | `kubectl rollout restart deploy/nginx` |',
  '| logs | kubectl logs |',
  '',
  '> Note: restart the deployment.',
  '',
  'See [docs](https://example.com).',
].join('\n')

const html = renderToStaticMarkup(React.createElement(Markdown, { markdown: sample }))
console.log(html)