'use strict'

let jUnitReportsManager = require('./jUnitReports')
let caseRunMapManager   = require('./caseRunMap')
let TestRailClient = require('node-testrail')

/**
 * Instantiates a "core" object with given dependencies. The object consists of
 * properties that represent methods to be run on corresponding commands.
 *
 * @param {object} configs
 * @returns {{report: Function}}
 */
function Core({testRailUrl, testRailUser, testRailPassword, console, debugMode}) {
    let console = console || global.console

    let apiCallsAttempted = 0
    let maxCallAttemptsAllowed = 5
    let debug = function (message) {
        if (debugMode) {
            console.error(message)
        }
    }
    let coverage = { // a collection of case and suit names, used by _resolveCaseIdsFrom method, for coverage analysis
            caseNameUsed: {},
            caseClassAndNameUsed: {}
        }

    // Read in any/all configuration files.
    let caseMapRunToRail = caseRunMapManager.loadMapFromFile('./testrail-cli.json')

    // Authenticate and create the testRailClient client.
    let testRailClient = new TestRailClient(testRailUrl, testRailUser, testRailPassword)

    /**
     * Helper method to map a testcase (xUnit) to a testRailClient caseId. Uses caseMapRunToRail
     *
     * @param {String} testClass - The class associated with test case.
     * @param {String} testName - The name of the test run.
     *
     * @return {int[]}
     *   Returns caseIds or empty array on failure to match.
     */
    function resolveCaseIdFromTestCase(testClass, testName) {
        let railCaseIds = undefined

        debug(testName)

        //First try to find case id in case name; it should be enclosed in square brackets with a number sign attached at left side
        if (testName.match(/#\[\d{1,6}]/) !== null) {
            railCaseIds = [testName.match(/#\[\d{1,6}]/)[0].match(/\d{1,6}/)[0]]
        }

        // Then check if there's a matching caseClassAndNameToIdMap class.
        if (railCaseIds === undefined && caseMapRunToRail.caseClassAndNameToIdMap && caseMapRunToRail.caseClassAndNameToIdMap[testClass]) {
            // If there's a matching name nested underneath the class, return it.
            if (caseMapRunToRail.caseClassAndNameToIdMap[testClass][testName]) {
                if (coverage.caseClassAndNameUsed[testClass] === undefined) {
                    coverage.caseClassAndNameUsed[testClass] = {}
                }
                coverage.caseClassAndNameUsed[testClass][testName] = true
                railCaseIds = caseMapRunToRail.caseClassAndNameToIdMap[testClass][testName]
            }
        }

        // Then check if there's a matching caseNameToIdMap name.
        if (railCaseIds === undefined && caseMapRunToRail.caseNameToIdMap && caseMapRunToRail.caseNameToIdMap[testName]) {
            coverage.caseNameUsed[testName] = true
            railCaseIds = caseMapRunToRail.caseNameToIdMap[testName]
        }

        if (railCaseIds === undefined) {
            railCaseIds = []
        }

        if (!Array.isArray(railCaseIds)) {
            railCaseIds = [railCaseIds]
        }

        return railCaseIds
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


        let runCases = jUnitReportsManager.loadCasesFromReportsPath(reportsPath)

        for (let runCase of runCases) {
            let runResult = {
                testName   : runCase.testName,
                railCaseIds: resolveCaseIdFromTestCase(runCase.testClass, runCase.testName),
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
            Object.keys(caseMapRunToRail.caseNameToIdMap).forEach(function (caseName) {
                if (coverage.caseNameUsed[caseName] === undefined) {
                    console.log('Case "' + caseName + '" mapping to ' + caseMapRunToRail.caseNameToIdMap[caseName] + ' has not been used')
                }
            })
            Object.keys(caseMapRunToRail.caseClassAndNameToIdMap).forEach(function (caseClass) {
                if (coverage.caseClassAndNameUsed[caseClass] === undefined) {
                    console.log('Class "' + caseClass + '" mapping has not been used at all')
                    return
                }
                Object.keys(caseMapRunToRail.caseClassAndNameToIdMap[caseClass]).forEach(function (caseName) {
                    if (coverage.caseNameUsed[caseName] === undefined) {
                        console.log('Class "' + caseClass + '" and case "' + caseName + '" mapping to ' + caseMapRunToRail.caseClassAndNameToIdMap[caseClass][caseName] + ' has not been used')
                    }
                })
            })
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
            (function addResultsForCasesAttempt() {
                debug('Attempting to send case results to testRailClient')

                testRailClient.addResultsForCases(runId, {results: caseResults}, function (response) {
                    response = typeof response === 'string' ? JSON.parse(response) : response

                    debug('Received response from testRailClient.')

                    if (response instanceof Array && response.length) {
                        console.log('Successfully uploaded ' + response.length + ' test case results to testRailClient.')
                        debug(response)
                    }
                    else {
                        if (apiCallsAttempted < maxCallAttemptsAllowed) {
                            apiCallsAttempted++
                            debug('Failed to upload case runs. Attempt #' + apiCallsAttempted)
                            addResultsForCasesAttempt()
                        }
                        else {
                            debug(response)
                            debug(caseResults)
                            throw new Error('There was an error uploading test results to testRailClient: ' + response.error)
                        }
                    }
                })
            })()
        }
        else {
            console.log('Could not map any result')
        }
    }
}

module.exports = Core