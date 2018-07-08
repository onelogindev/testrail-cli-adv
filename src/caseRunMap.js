'use strict'
let YAML = require('yamljs')
let fs = require('fs')

function CaseRunMapManager() {
    this.loadMapFromFile = (filePath) => {
        let ext = path.extname(filePath)
        let configs = {projectId: null, caseNameToIdMap: {}, caseClassAndNameToIdMap: {}}
        switch (ext) {
            case '.yml':
                configs = YAML.load(filePath)
                break
            case '.json':
                configs = JSON.parse(fs.readFileSync(filePath, 'utf8'))
                break
            default:
                throw new Error('Map parsing for ' + ext + ' is not implemented yet')
        }
        return configs
    }
}

module.exports = new CaseRunMapManager()