'use strict'
let TestRailClient = require('node-testrail')

function TestRailManager({testRailUrl, testRailUser, testRailPassword, debug, console}) {
    let console = console || global.console

    // Authenticate and create the TestRail client.
    let testRailClient = new TestRailClient(testRailUrl, testRailUser, testRailPassword)
    let planId = undefined
    let defaultRunId = 0

    this.setup = async ({runId, planId}) => {
        defaultRunId = runId
        // TODO load test plan info
    }

    this.resolveCaseTestRunsFromPlan = caseId => {
        if (planId === undefined) {
            return [defaultRunId]
        } else {
            // TODO get info from set up map
        }
    }

    function addResultsForCases(runId, testResults) {
        return new Promise(fulfill => {
            testRailClient.addResultsForCases(runId, {results: testResults}, function (response) {
                fulfill(response)
            })
        })
    }

    async function sendReportAttempt({runId, testResults, attemptsLeft}) {
        debug('Attempting to send case results to TestRail')

        let response = await addResultsForCases(runId, testResults)
        response = typeof response === 'string' ? JSON.parse(response) : response

        debug('Received response from TestRail.')

        if (response instanceof Array && response.length) {
            console.log('Successfully uploaded ' + response.length + ' test case results to TestRail.')
            debug(response)
        }
        else {
            if (attemptsLeft > 0) {
                attemptsLeft -= 1
                debug('Failed to upload case runs. Attempts left: #' + attemptsLeft)
                await sendReportAttempt({runId, testResults, attemptsLeft})
            }
            else {
                debug(response)
                debug(testResults)
                throw new Error('There was an error uploading test results to TestRail: ' + response.error)
            }
        }
    }

    this.sendReport = async ({runId, testResults, attempts}) => {
        await sendReportAttempt({runId, testResults, attemptsLeft: attempts})
    }
}

module.exports = TestRailManager