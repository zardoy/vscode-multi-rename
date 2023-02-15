import * as vscode from 'vscode'
import _ from 'lodash'
import { registerExtensionCommand } from 'vscode-framework'

const SCHEME = 'multiRename'

// const compact = <T>(arr: (T | undefined)[]): T[] => arr.filter(Boolean) as T[]

export const activate = () => {
    type RenameLocation =
        | {
              placeholder: string
              range: vscode.Range
          }
        | undefined
    let currentRenameSession: { document: vscode.TextDocument; locations: RenameLocation[] } | undefined

    let version = 0
    const emitter = new vscode.EventEmitter<vscode.FileChangeEvent[]>()
    vscode.workspace.registerFileSystemProvider(SCHEME, {
        createDirectory() {},
        delete() {},
        onDidChangeFile: emitter.event,
        readDirectory() {
            return []
        },
        readFile() {
            const text = currentRenameSession ? currentRenameSession.locations.map(loc => (loc ? loc.placeholder : '')).join('\n') : ''
            return new TextEncoder().encode(text)
        },
        rename() {},
        stat() {
            return { ctime: 0, mtime: version, size: 0, type: 0 }
        },
        watch(uri) {
            return new vscode.Disposable(() => {})
        },
        writeFile(uri, content) {},
    })

    const RENAME_URI = vscode.Uri.from({ scheme: SCHEME, path: '/multi-rename' })
    function fireFileChange() {
        version++
        emitter.fire([{ type: vscode.FileChangeType.Changed, uri: RENAME_URI }])
    }

    function showMultiRenameSession(justFocus = false) {
        return vscode.window.showTextDocument(RENAME_URI, justFocus ? {} : { preview: false, viewColumn: vscode.ViewColumn.Beside })
    }

    registerExtensionCommand('startRename', async () => {
        const existingTab = findRenamingEditorTab()
        if (existingTab) {
            const choice = await vscode.window.showWarningMessage(
                'There is already a rename session in progress.',
                {
                    modal: true,
                },
                {
                    title: 'Cancel',
                    isCloseAffordance: true,
                },
                {
                    title: 'Close and continue',
                },
                {
                    title: 'Focus',
                },
            )
            if (choice?.title === 'Focus') {
                void showMultiRenameSession(true)
                return
            }

            if (choice?.title !== 'Close previous and continue') {
                return
            }
        }

        const editor = vscode.window.activeTextEditor
        if (!editor) return
        const errors: Array<[number, string]> = []
        const renameLocation: Array<RenameLocation | undefined> = []
        for (const [i, selection] of editor.selections.entries()) {
            try {
                // eslint-disable-next-line no-await-in-loop
                const { placeholder, range } = await vscode.commands.executeCommand<{ placeholder: string; range }>(
                    'vscode.prepareRename',
                    editor.document.uri,
                    selection.active,
                )
                renameLocation.push({ placeholder, range })
            } catch (err) {
                errors.push([i, err.message])
                renameLocation.push(undefined)
            }
        }

        if (errors.length > 0) {
            const choice = await vscode.window.showErrorMessage(
                'Rename errors in following positions:',
                {
                    modal: true,
                    detail: errors
                        .map(([i, err]) => {
                            const { line, character } = editor.selections[i]!.active
                            return `${line + 1}:${character + 1}: ${err}`
                        })
                        .join('\n'),
                },
                {
                    title: 'Cancel',
                    isCloseAffordance: true,
                },
                {
                    title: 'Ignore',
                },
            )
            if (choice?.title !== 'Ignore') {
                return
            }
        }

        const selectionRangesMapped = editor.selections
            .map((selection, i) => {
                const renameLoc = renameLocation[i]
                if (!renameLoc) return undefined!
                let start: vscode.Position
                try {
                    start = new vscode.Position(selection.start.line - renameLoc.range.start.line, selection.start.character - renameLoc.range.start.character)
                } catch {
                    start = new vscode.Position(i, 0)
                }

                let end: vscode.Position
                try {
                    end = new vscode.Position(selection.end.line - renameLoc.range.end.line, selection.end.character - renameLoc.range.end.character)
                } catch {
                    end = new vscode.Position(i, 0)
                }

                return new vscode.Selection(start, end)
            })
            .filter(Boolean)
        currentRenameSession = {
            document: editor.document,
            locations: renameLocation,
        }
        fireFileChange()
        await showMultiRenameSession()
        // vscode.window.activeTextEditor!.selections = selectionRangesMapped
    })

    vscode.workspace.onDidCloseTextDocument(doc => {
        if (doc.uri.scheme === SCHEME) {
            currentRenameSession = undefined
            fireFileChange()
        }
    })

    const selections: vscode.Selection[] = []
    vscode.window.onDidChangeTextEditorSelection(({ textEditor, selections }) => {
        if (textEditor.document.uri.scheme !== SCHEME) return
        if (selections.length !== 1) return
        const targetEditor = vscode.window.visibleTextEditors.find(editor => editor.document === currentRenameSession?.document)
        // if (!targetEditor) return
    })

    registerExtensionCommand('processRename', async () => {
        if (!currentRenameSession) {
            void vscode.window.showWarningMessage('There is no rename session in progress.')
            return
        }

        const renameEditor = vscode.window.visibleTextEditors.find(editor => editor.document.uri.scheme === SCHEME)
        if (!renameEditor) {
            throw new Error('No rename editor is visible!')
        }

        const lines = renameEditor.document.getText().split('\n')

        const globalEdit = new vscode.WorkspaceEdit()
        for (const [i, line] of lines.entries()) {
            const renameLoc = currentRenameSession.locations[i]
            if (!renameLoc) continue
            // eslint-disable-next-line no-await-in-loop
            const edit = await vscode.commands.executeCommand<vscode.WorkspaceEdit>(
                'vscode.executeDocumentRenameProvider',
                currentRenameSession.document.uri,
                renameLoc.range.start,
                line.trim(),
            )
            for (const [uri, edits] of edit.entries()) {
                // it actually adds
                globalEdit.set(uri, edits)
            }
        }

        await vscode.workspace.applyEdit(globalEdit)
        await showMultiRenameSession(true)
        await vscode.commands.executeCommand('workbench.action.revertAndCloseActiveEditor')
        currentRenameSession = undefined
    })
}

function findRenamingEditorTab() {
    for (const { tabs } of vscode.window.tabGroups.all) {
        for (const tab of tabs) {
            if (tab.input instanceof vscode.TabInputText && tab.input.uri.scheme === SCHEME) {
                return tab
            }
        }
    }

    return undefined
}
