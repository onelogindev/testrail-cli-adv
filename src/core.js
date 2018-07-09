'use strict'

let JUnitReportsManager = require('./jUnitReports')
let CaseRunMapManager   = require('./caseRunMap')
let TestRailManager     = require('./testRail')

/**
 * Instantiates a "core" object with given dependencies. The object consists of
 * properties that represent methods to be run on corresponding commands.
 *
 * @param {object} configs
 * @returns {{report: Function}}
 */
function Core({testRailUrl, testRailUser, testRailPassword, console, debugMode}) {
    let console = console || global.console
    let debug = function (message) {
        if (debugMode) {
            console.error(message)
        }
    }

    /**
     * Given a junit XML file (or a directory of files), processes all test
     * results, maps them to cases, and pushes the results to testRailClient.
     *
     * @param {int} runId
     *   The ID of the run with which to associate the cases.
     * @param {int} planId
     *   The ID of the test plan which should be analyzed to associate results with single run cases.
     * @param {string} reportsPath
     *   The path to the junit XML file or directory of files.
     * @param {boolean} logCoverage
     *   whether to log coverage info into console
     */
    this.report = function({runId, planId, reportsPath, logCoverage}) {
        let caseResultsMap = {}

        debug('Attempting to report runs for test cases.')

        if (!runId) {

        }

        let testRailManager = new TestRailManager({testRailUrl, testRailUser, testRailPassword, debug})

        // Read in any/all configuration files.
        let caseRunMapManager = new CaseRunMapManager()
        caseRunMapManager.loadMapFromFile('./testrail-cli.json')

        let jUnitReportsManager = new JUnitReportsManager({debug})
        let runCases = jUnitReportsManager.loadCasesFromReportsPath(reportsPath)

        for (let runCase of runCases) {
            let runResult = {
                testName   : runCase.testName,
                railCaseIds: caseRunMapManager.resolveCaseIdFromTestCase(runCase.testClass, runCase.testName),
                elapsed    : runCase.time,
                statusId   : undefined,
                comment    : ''
            }

            if (runCase.failures.length > 0) {
                // If test case failure elements exist, there was a failure. 5 means failure. Add failure messages
                runResult.statusId = 5
                runResult.comment += runCase.failures.join('\n')
            } else if (runCase.skipped.length > 0) {
                // TODO: what testRailClient status to map for skipped cases? skip reporting for now
            } else {
                // Otherwise, the test case passed. 1 means pass.
                runResult.statusId = 1
            }

            if (runResult.statusId !== undefined) {
                debug('Result: ' + JSON.stringify(runResult, undefined, 4))
                debug('Appending result to cases: ' + runResult.railCaseIds)
                for (let caseId of runResult.railCaseIds)  {
                    if (caseResultsMap[caseId] === undefined) {
                        caseResultsMap[caseId] = []
                    }
                    caseResultsMap[caseId].push(runResult)
                }
            }
        }

        if (logCoverage) {
            caseRunMapManager.logCoverage()
        }

        // Post results if we had any.
        if (Object.keys(caseResultsMap).length > 0) {
            let caseResults = []
            for (let caseId of Object.keys(caseResultsMap)) {
                debug('caseId = ' + caseId)
                let caseResult = {
                    case_id: caseId,
                    status_id: 1,
                    elapsed: 0,
                    comment: ''
                }
                for (let runResult of caseResultsMap[caseId]) {
                    debug('runResult: ' + JSON.stringify(runResult, undefined, 4))
                    caseResult.elapsed += runResult.elapsed
                    if (runResult.statusId > caseResult.status_id) {
                        caseResult.status_id = runResult.statusId
                    }
                    if (runResult.comment !== '') {
                        caseResult.comment += runResult.testName + ': ' + runResult.comment + '\n'
                    }
                }
                caseResult.elapsed = '' + caseResult.elapsed + 's'
                debug('caseResult.elapsed = ' + caseResult.elapsed)
                caseResults.push(caseResult)
            }
            testRailManager.sendReport({runId, caseResults, attempts: 3})
        }
        else {
            console.log('Could not map any result')
        }
    }
}

module.exports = Core