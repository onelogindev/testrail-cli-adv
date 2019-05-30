"use strict";

var YAML = require('yamljs');
var fs = require('fs');

module.exports = function testrailCliFactory(coreFactory, TestRailFactory, argv, process, console) {
  process = process || global.process;
  console = console || global.console;

  var url = process.env.TESTRAIL_URL || argv.url,
      username = process.env.TESTRAIL_UN || argv.username,
      password = process.env.TESTRAIL_PW || argv.password,
      configs,
      testRailClient,
      core;

  // Ensure we have a URL, username, and password to work with.
  if (!url || !username || !password) {
    console.error("Couldn't find testrail API credentials.");
    console.error('URL:      Either TESTRAIL_URL env variable or --url flag.');
    console.error('Username: Either TESTRAIL_UN env variable or --username flag.');
    console.error('Password: Either TESTRAIL_PW env variable or --password flag.');
    process.exit(1);
  }

  // Read in any/all configuration files.
  try {
    var configPath = process.cwd() + '/.testrail-cli.yml';
    if (fs.existsSync(configPath)) {
      configs = YAML.load(configPath)
    } else {
      configPath = process.cwd() + '/.testrail-cli.json';
      if (fs.existsSync(configPath)) {
        configs = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      } else {
        configs = {projectId: null, caseNameToIdMap: {}, caseClassAndNameToIdMap: {}};
      }
    }
  }
  catch (Exception) {
    configs = {projectId: null, caseNameToIdMap: {}, caseClassAndNameToIdMap: {}};
  }

  // Set configs defaults.
  configs.caseIdRegExp = configs.caseIdRegExp || '#\\[(\\d{1,6})]';
  configs.caseIdRegExp = new RegExp(configs.caseIdRegExp); // Pre-compile regexp for better performance

  // Global configs to pull in.
  configs.debug = argv.debug || false;
  configs.coverage = argv.coverage || false;

  // Authenticate and create the TestRail client.
  testRailClient = new TestRailFactory(url, username, password);

  // Instantiate the core.
  core = coreFactory(testRailClient, configs, process, console);

  return {
    init: function initializeTestRunFromConsole() {
      var projectId = argv.p || argv.projectId || configs.projectId,
          name = argv.n || argv.runName,
          suiteId = argv.s || argv.suiteId || configs.suiteId,
          description = argv.d || argv.description,
          milestoneId = argv.m || argv.milestoneId;

      core.init(projectId, name, suiteId, description, milestoneId);
    },
    finish: function finishTestRunFromConsole() {
      var runId = argv.r || argv.runId;

      core.finish(runId);
    },
    report: function reportXmlFromConsole() {
      var runId = argv.r || argv.runId,
          files = argv.f || argv.file;

      core.report(runId, files);
    }
  }
};
