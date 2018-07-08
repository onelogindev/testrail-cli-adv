'use strict'
let caseRunMapManager = require('./caseRunMap')

module.exports = function testrailCliFactory(coreFactory, TestRailFactory, argv, process, console) {
    process = process || global.process
    console = console || global.console

    let url = process.env.TESTRAIL_URL || argv.url,
        username = process.env.TESTRAIL_UN || argv.username,
        password = process.env.TESTRAIL_PW || argv.password,
        configs,
        testRailClient,
        core

    // Ensure we have a URL, username, and password to work with.
    if (!url || !username || !password) {
        console.error('Couldn\'t find testrail API credentials.')
        console.error('URL:      Either TESTRAIL_URL env variable or --url flag.')
        console.error('Username: Either TESTRAIL_UN env variable or --username flag.')
        console.error('Password: Either TESTRAIL_PW env variable or --password flag.')
        process.exit(1)
    }

    // Read in any/all configuration files.
    configs = caseRunMapManager.loadMapFromFile('./testrail-cli.json')

    // Global configs to pull in.
    configs.debug = argv.debug || false
    configs.coverage = argv.coverage || false

    // Authenticate and create the TestRail client.
    testRailClient = new TestRailFactory(url, username, password)

    // Instantiate the core.
    core = coreFactory(testRailClient, configs, process, console)

    return {
        report: () => {
            let runId = argv.r || argv.runId,
                planId = argv.p || argv.planId,
                files = argv.f || argv.file

            core.report(runId, planId, files)
        }
    }
}
