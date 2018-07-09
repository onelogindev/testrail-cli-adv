'use strict'
let TestRailClient = require('node-testrail')

function TestRailManager({testRailUrl, testRailUser, testRailPassword, debug}) {

    // Authenticate and create the testRailClient client.
    let testRailClient = new TestRailClient(testRailUrl, testRailUser, testRailPassword)

    function sendReportAttempt({runId, caseResults, attemptsLeft}) {
        debug('Attempting to send case results to testRailClient')

        testRailClient.addResultsForCases(runId, {results: caseResults}, function (response) {
            response = typeof response === 'string' ? JSON.parse(response) : response

            debug('Received response from testRailClient.')

            if (response instanceof Array && response.length) {
                console.log('Successfully uploaded ' + response.length + ' test case results to testRailClient.')
                debug(response)
            }
            else {
                if (attemptsLeft > 0) {
                    attemptsLeft -= 1
                    debug('Failed to upload case runs. Attempts left: #' + attemptsLeft)
                    sendReportAttempt({runId, caseResults, attemptsLeft})
                }
                else {
                    debug(response)
                    debug(caseResults)
                    throw new Error('There was an error uploading test results to testRailClient: ' + response.error)
                }
            }
        })
    }

    this.sendReport = ({runId, caseResults, attempts}) => {
        sendReportAttempt({runId, caseResults, attemptsLeft: attempts})
    }
}

module.exports = TestRailManager