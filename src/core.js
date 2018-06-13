"use strict";

var Promise = require('promise'),
    fs = require('fs'),
    readFile = Promise.denodeify(fs.readFile),
    XmlParser = require('xml-js'),
    HtmlEntitiesFactory = require('html-entities').AllHtmlEntities,
    HtmlEntities = new HtmlEntitiesFactory();

/**
 * Instantiates a "core" object with given dependencies. The object consists of
 * properties that represent methods to be run on corresponding commands.
 *
 * @param TestRail
 * @param {object} configs
 * @param process
 * @param console
 * @returns {{init: Function, finish: Function, report: Function}}
 */
module.exports = function constructCore(TestRail, configs, process, console) {
  process = process || global.process;
  console = console || global.console;

  var apiCallsAttempted = 0,
      maxCallAttemptsAllowed = 5,
      debug = function debug(message) {
        if (configs.debug) {
          console.error(message);
        }
      },
      commands,
      // TODO coverage should be reported if needed
      coverage = { // a collection of case and suit names, used by _resolveCaseIdsFrom method, for coverage analysis
          caseNameUsed: {},
          caseClassAndNameUsed: {}
      };

  commands = {
    /**
     * Initializes/adds a run to TestRail for the given project ID.
     *
     * @param {int} projectId
     *   Required. The project ID for which a new run should be added.
     * @param {string} name
     *   Required. The name of the run to be added.
     * @param {int} suiteId
     *   Optional. The ID of the test suite to be run.
     * @param {string} description
     *   Optional. A description to go along with the test run.
     * @param {int} milestoneId
     *   Optional. The ID of a milestone with which to associate this run.
     */
    init: function initializeTestRun(projectId, name, suiteId, description, milestoneId) {
      debug('Attempting to initialize test run.');

      if (!projectId || !name) {
        console.error('You must supply a projectId (-p or --projectId=) and runName (-n or --runName=).');
        debug('projectId: "' + projectId + '", name: "' + name + '"');
        process.exit(1);
      }

      TestRail.addRun(projectId, suiteId, name, description, milestoneId, function (response) {
        debug('Received response from TestRail.');

        response = typeof response === 'string' ? JSON.parse(response) : response;
        if (response.id) {
          console.log(response.id);
          debug(response);
          process.exit(0);
        }
        else {
          // Retry if we're under the limit.
          if (apiCallsAttempted < maxCallAttemptsAllowed) {
            apiCallsAttempted++;
            debug('Failed to initialize run. Attempt #' + apiCallsAttempted);
            initializeTestRun(projectId, name, suiteId, description, milestoneId);
          }
          else {
            console.error('Error initializing test run in TestRail: ' + response.error);
            debug(response);
            process.exit(1);
          }
        }
      });
    },

    /**
     * Marks a given test run as closed on TestRail.
     *
     * @param {int} runId
     *   Required. The ID of the test run to close.
     */
    finish: function closeTestRun(runId) {
      debug('Attempting to close test run.');

      if (!runId) {
        console.error('You must supply a runId (-r or --runId=).');
        debug('runId: ' + runId);
        process.exit(1);
      }

      TestRail.closeRun(runId, function (response) {
        debug('Received response from TestRail.');

        response = typeof response === 'string' ? JSON.parse(response) : response;
        if (response.completed_on) {
          console.log('Successfully closed test run ' + runId + '.');
          debug(response);
          process.exit(0);
        }
        else {
          if (apiCallsAttempted < maxCallAttemptsAllowed) {
            apiCallsAttempted++;
            debug('Failed to close test run. Attempt #' + apiCallsAttempted);
            closeTestRun(runId);
          }
          else {
            console.error('There was an error closing the test run: ' + response.error);
            debug(response);
            process.exit(1);
          }
        }
      });
    },

    /**
     * Given a junit XML file (or a directory of files), processes all test
     * results, maps them to cases, and pushes the results to TestRail.
     *
     * @param {int} runId
     *   The ID of the run with which to associate the cases.
     * @param {string} fileOrDir
     *   The path to the junit XML file or directory of files.
     */
    report: function reportXml(runId, fileOrDir) {
      var files = [],
          caseResultsMap = {},
          fsStat;

      debug('Attempting to report runs for test cases.');

      if (!fileOrDir || !runId) {
        console.error('You must supply a file (-f or --file=) and runId (-r or --runId=).');
        debug('file: "' + fileOrDir + '", runId: "' + runId + '"');
        process.exit(1);
      }

      // Stat the file.
      fsStat = fs.statSync(fileOrDir);

      if (fsStat.isFile()) {
        // Make sure the provided file is an XML file.
        if (fileOrDir.substring(fileOrDir.length - 4) === '.xml') {
          files.push(fileOrDir);
        }
      }
      else if (fsStat.isDirectory()) {
        // Filter down to just those files that are XML.
        files = fs.readdirSync(fileOrDir).filter(function(dirContent) {
          return dirContent.substring(dirContent.length - 4) === '.xml';
        }).map(function (dirContent) {
          return fileOrDir + (fileOrDir.substring(fileOrDir.length - 1) === '/' ? '' : '/') + dirContent
        });
      }

      // Asynchronously read in all files in the file array.
      debug('Attempting to parse files:');
      Promise.all(files.map(function readFilesPromises(file) {
        return readFile(file, 'utf8');
      })).done(function (fileContents) {
        fileContents.forEach(function (rawXml) {
          var report = XmlParser.xml2js(rawXml);
          report.elements.forEach(function(element) {
            (function parseXmlIntoCaseResults(reportElement) {
              // If the root represents a single testsuite, treat it as such.
              if (reportElement.name === 'testsuite') {
                var testSuiteElement = reportElement;
                if (!Array.isArray(testSuiteElement.elements)) {
                  return
                }
                testSuiteElement.elements.forEach(function (testCaseElement) {
                  if (testCaseElement.name !== 'testcase') {
                      return
                  }
                  var testClass = HtmlEntities.decode(testCaseElement.attributes.classname),
                      testName = HtmlEntities.decode(testCaseElement.attributes.name);
                  var runResult = {
                    testName: testName,
                    railCaseIds: commands._resolveCaseIdsFrom(testClass, testName),
                    statusId: undefined,
                    comment: ''
                  };

                  // Only supply an elapsed time if a time was reported.
                  if (testCaseElement.attributes.hasOwnProperty('time')) {
                    debug('attributes.time = ' + testCaseElement.attributes.time);
                    var elapsed = parseInt(testCaseElement.attributes.time);
                    debug('elapsed = ' + elapsed);
                    if (isNaN(elapsed)) {
                      elapsed = 0
                    }
                    debug('elapsed = ' + elapsed);
                    // It's possible a time was provided, but it's 0. Round up!
                    if (elapsed === 0) {
                      elapsed = 1;
                    }
                    runResult.elapsed = elapsed;
                  }

                  if (Array.isArray(testCaseElement.elements)) {
                    var failureElements = testCaseElement.elements.filter(function (testCaseResultElement) {
                      return testCaseResultElement.name === 'failure'
                    });
                    var skippedElements = testCaseElement.elements.filter(function (testCaseResultElement) {
                        return testCaseResultElement.name === 'skipped'
                    });
                    if (failureElements.length > 0) {
                      // If test case failure elements exist, there was a failure. 5 means failure. Add failure messages
                      runResult.statusId = 5;
                      failureElements.forEach(function(failureElement) {
                        if (failureElement.attributes && failureElement.attributes.message) {
                          runResult.comment += '  ' +  HtmlEntities.decode(failureElement.attributes.message) + '\n';
                        }
                        //look for CDATA as well
                        if (Array.isArray(failureElement.elements)) {
                          var cDataElements = failureElement.elements.filter(function(failureElementChild) {
                            return failureElementChild.type === 'cdata'
                          });
                          cDataElements.forEach(function(cDataElement) {
                            runResult.comment += HtmlEntities.decode(cDataElement.cdata).replace(/\n/g, '\n  ') + '\n';
                          });
                        }
                      })
                    }
                    else if (skippedElements.length > 0) {
                      // TODO: what TestRail status to map?
                    }
                  }
                  // Otherwise, the test case passed. 1 means pass.
                  else {
                      runResult.statusId = 1;
                  }

                  // Only append tests we've mapped to a TestRail status.
                  if (runResult.statusId) {
                    debug('Result: ' + JSON.stringify(runResult, undefined, 4));
                    debug('Appending result to cases: ' + runResult.railCaseIds);
                    runResult.railCaseIds.forEach(function(caseId) {
                      if (caseResultsMap[caseId] === undefined) {
                        caseResultsMap[caseId] = []
                      }
                      caseResultsMap[caseId].push(runResult)
                    });
                  }
                  else {
                    debug('Unable to map testCase to TestRail CaseID:');
                    debug(testCaseElement);
                  }
                });
              }
              // If the root consists of multiple test suites, recurse.
              else if (reportElement.name === "testsuites" && reportElement.elements) {
                  reportElement.elements.forEach(function (testSuiteElement) {
                    parseXmlIntoCaseResults(testSuiteElement);
                });
              }
              // If we map to neither of the above expectations, abort.
              else {
                console.error('Invalid xml. Expected element name "testsuite" or "testsuites"');
                debug(reportElement);
                process.exit(1);
              }
            })(element);
          })
        });

        // Post results if we had any.
        if (Object.keys(caseResultsMap).length > 0) {
          var caseResults = [];
          Object.keys(caseResultsMap).forEach(function(caseId) {
            debug('caseId = ' + caseId);
            var caseResult = {
                case_id  : caseId,
                status_id: 1,
                elapsed  : 0,
                comment  : ''
            };
            caseResultsMap[caseId].forEach(function(runResult) {
              debug('runResult: ' + JSON.stringify(runResult, undefined, 4));
              caseResult.elapsed += runResult.elapsed;
              if (runResult.statusId > caseResult.status_id) {
                caseResult.status_id = runResult.statusId;
              }
              if (runResult.comment !== '') {
                caseResult.comment += runResult.testName + ': ' + runResult.comment + '\n'
              }
            });
            caseResult.elapsed = '' + caseResult.elapsed + 's';
              debug('caseResult.elapsed = ' + caseResult.elapsed);
            caseResults.push(caseResult);
          });
          (function addResultsForCasesAttempt() {
            debug('Attempting to send case results to TestRail');

            TestRail.addResultsForCases(runId, {results: caseResults}, function (response) {
              response = typeof response === 'string' ? JSON.parse(response) : response;

              debug('Received response from TestRail.');

              if (response instanceof Array && response.length) {
                console.log('Successfully uploaded ' + response.length + ' test case results to TestRail.');
                debug(response);
                process.exit(0);
              }
              else {
                if (apiCallsAttempted < maxCallAttemptsAllowed) {
                  apiCallsAttempted++;
                  debug('Failed to upload case runs. Attempt #' + apiCallsAttempted);
                  addResultsForCasesAttempt();
                }
                else {
                  debug(response);
                  debug(caseResults);
                  console.error('There was an error uploading test results to TestRail: ' + response.error);
                  process.exit(1);
                }
              }
            });
          })();
        }
        else {
          console.log('Did not parse any test XML files.');
        }
        if (configs.coverage) {
          Object.keys(configs.caseNameToIdMap).forEach(function(caseName) {
            if (coverage.caseNameUsed[caseName] === undefined) {
              console.log('Case "' + caseName + '" mapping to ' + configs.caseNameToIdMap[caseName] + ' has not been used')
            }
          });
          Object.keys(configs.caseClassAndNameToIdMap).forEach(function(caseClass) {
            if (coverage.caseClassAndNameUsed[caseClass] === undefined) {
              console.log('Class "' + caseClass + '" mapping has not been used at all');
              return
            }
            Object.keys(configs.caseClassAndNameToIdMap[caseClass]).forEach(function(caseName) {
              if (coverage.caseNameUsed[caseName] === undefined) {
                console.log('Class "' + caseClass + '" and case "' + caseName + '" mapping to ' + configs.caseClassAndNameToIdMap[caseClass][caseName] + ' has not been used')
              }
            });
          });
        }
      });
    },

    /**
     * Helper method to map a testcase (xUnit) to a TestRail caseId. Uses config
     *
     * @param {String} testClass - The class associated with test case.
     * @param {String} testName - The name of the test run.
     *
     * @return {int[]}
     *   Returns caseIds or empty array on failure to match.
     */
    _resolveCaseIdsFrom: function resolveCaseIdFromTestCase(testClass, testName) {
      var railCaseIds = undefined;

      debug(testName);

      //First try to find case id in case name; it should be enclosed in square brackets with a number sign attached at left side
      if(testName.match(/#\[\d{1,6}]/) !== null) {
          railCaseIds = [testName.match(/#\[\d{1,6}]/)[0].match(/\d{1,6}/)[0]];
      }

      // Then check if there's a matching caseClassAndNameToIdMap class.
      if (railCaseIds === undefined && configs.caseClassAndNameToIdMap && configs.caseClassAndNameToIdMap[testClass]) {
        // If there's a matching name nested underneath the class, return it.
        if (configs.caseClassAndNameToIdMap[testClass][testName]) {
          if (coverage.caseClassAndNameUsed[testClass] === undefined) {
            coverage.caseClassAndNameUsed[testClass] = {}
          }
          coverage.caseClassAndNameUsed[testClass][testName] = true;
          railCaseIds = configs.caseClassAndNameToIdMap[testClass][testName];
        }
      }

      // Then check if there's a matching caseNameToIdMap name.
      if (railCaseIds === undefined && configs.caseNameToIdMap && configs.caseNameToIdMap[testName]) {
        coverage.caseNameUsed[testName] = true;
        railCaseIds = configs.caseNameToIdMap[testName];
      }

      if (railCaseIds === undefined) {
        railCaseIds = []
      }

      if (!Array.isArray(railCaseIds)) {
        railCaseIds = [railCaseIds]
      }

      return railCaseIds;
    }
  };

  return commands;
};
