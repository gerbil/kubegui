const e = require('esbuild')
const fs = require('fs')
const r = e.buildSync({
  entryPoints: ['src/components/ui/Markdown.tsx'],
  bundle: true,
  format: 'cjs',
  platform: 'node',
  write: false,
  loader: { '.css': 'empty' },
  external: ['react', 'react-dom'],
  absWorkingDir: `${__dirname}`,
})
fs.writeFileSync('md-bundle.cjs', r.outputFiles[0].text)
console.log('BUILT', r.outputFiles[0].path)