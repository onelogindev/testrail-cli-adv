'use strict'

let Core = require('./core.js')

module.exports = function testrailCliFactory(argv, process, console) {
    process = process || global.process
    console = console || global.console
    let url      = process.env.TESTRAIL_URL || argv.url
    let username = process.env.TESTRAIL_UN  || argv.username
    let password = process.env.TESTRAIL_PW  || argv.password

    // Ensure we have a URL, username, and password to work with.
    if (!url || !username || !password) {
        console.error('Couldn\'t find testrail API credentials.')
        console.error('URL:      Either TESTRAIL_URL env variable or --url flag.')
        console.error('Username: Either TESTRAIL_UN env variable or --username flag.')
        console.error('Password: Either TESTRAIL_PW env variable or --password flag.')
        process.exit(1)
    }

    let configs = {}

    // Global configs to pull in.
    configs.debug       = argv.debug || false
    configs.logCoverage = argv.coverage || false
    configs.url         = url
    configs.username    = username
    configs.password    = password
    configs.console     = console

    // Instantiate the core.
    let core = new Core(configs)

    return {
        report: () => {
            let runId  = argv.r || argv.runId
            let planId = argv.p || argv.planId
            let files  = argv.f || argv.file
            if (!files || !runId || !planId) {
                console.error('You must supply a file (-f or --file=) and either runId (-r or --runId=) or planId (-p or --planId=).')
                debug('files: "' + files + '", runId: "' + runId + '", planId: "' + planId + '"')
                process.exit(1)
            }

            core.report(runId, planId, files)
        }
    }
}
