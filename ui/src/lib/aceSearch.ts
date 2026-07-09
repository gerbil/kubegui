type AceCommand = {
  name: string
  bindKey?: { win?: string; mac?: string }
  exec: (editor: unknown) => void
  readOnly?: boolean
}

type AceCommandHost = {
  addCommand?: (command: AceCommand) => void
}

type AceLikeEditor = {
  commands?: AceCommandHost
}

type AceSearchboxModule = {
  Search: (editor: unknown, isReplace?: boolean) => void
}

type AceWindow = Window & typeof globalThis & {
  ace?: {
    config?: {
      loadModule?: (name: string, onLoad: (module: AceSearchboxModule) => void) => void
    }
  }
}

export function attachSimpleAceSearch(editor: unknown) {
  const aceEditor = editor as AceLikeEditor

  aceEditor.commands?.addCommand?.({
    name: 'find',
    bindKey: { win: 'Ctrl-F', mac: 'Command-F' },
    readOnly: true,
    exec: (ed) => {
      ;(window as AceWindow).ace?.config?.loadModule?.('ace/ext/searchbox', (e) => {
        e.Search(ed)
      })
    },
  })

  aceEditor.commands?.addCommand?.({
    name: 'replace',
    bindKey: { win: 'Ctrl-H', mac: 'Command-Option-F' },
    readOnly: false,
    exec: (ed) => {
      ;(window as AceWindow).ace?.config?.loadModule?.('ace/ext/searchbox', (e) => {
        e.Search(ed, true)
      })
    },
  })
}
