//@ts-check
const { defineConfig } = require('@zardoy/vscode-utils/build/defineConfig.cjs')
const { patchPackageJson } = require('@zardoy/vscode-utils/build/patchPackageJson.cjs')

patchPackageJson({})

module.exports = defineConfig({
    consoleStatements: false,
    development: {
        executable: 'code-insiders',
    },
    target: {
        desktop: true,
        web: true,
    },
})
